import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MeetingSignal, MeetingDetectorOptions, MeetingEventCallback, ErrorEventCallback } from './types.js';

interface SessionInfo {
  lastSeen: number;
  signal: MeetingSignal;
}

interface PendingConfidenceSignal {
  firstSeen: number;
  lastSeen: number;
  count: number;
  signal: MeetingSignal;
}

interface ServiceContext {
  frontApp?: string;
  windowTitle?: string;
}

export class MeetingDetector extends EventEmitter {
  private static readonly LOW_CONFIDENCE_WINDOW_MS = 45000;
  private static readonly LOW_CONFIDENCE_FALLBACK_MIN_SIGNALS = 4;
  private static readonly LOW_CONFIDENCE_FALLBACK_MIN_DURATION_MS = 30000;
  private static readonly PRECHECK_PRONE_SERVICES = new Set([
    'microsoft teams',
    'zoom',
    'webex',
    'slack'
  ]);

  private process?: ChildProcess;
  private options: Required<MeetingDetectorOptions>;
  private activeSessions: Map<string, SessionInfo> = new Map();
  private pendingConfidence: Map<string, PendingConfidenceSignal> = new Map();
  private serviceContext: Map<string, ServiceContext> = new Map();

  constructor(options: MeetingDetectorOptions = {}) {
    super();

    // Get the absolute path to the script relative to this package
    const defaultScriptPath = options.scriptPath || join(
      dirname(fileURLToPath(import.meta.url)),
      '../meeting-detect.sh'
    );

    this.options = {
      scriptPath: defaultScriptPath,
      debug: options.debug || false,
      sessionDeduplicationMs: options.sessionDeduplicationMs || 60000
    };
  }

  /**
   * Start monitoring for meeting signals
   * @param callback Optional callback function for meeting events
   */
  public start(callback?: MeetingEventCallback): void {
    if (this.process) {
      throw new Error('Detector is already running');
    }

    if (callback) {
      this.on('meeting', callback);
    }

    this.process = spawn('sh', [this.options.scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().trim().split('\n');

      for (const line of lines) {
        if (line.trim()) {
          try {
            const parsedSignal = this.parseSignal(line);
            const signal = this.stabilizeSignalContext(parsedSignal);
            if (this.shouldIgnoreSignal(signal)) {
              if (this.options.debug) {
                console.log('[MeetingDetector] Ignoring signal:', signal);
              }
              continue;
            }

            const confidentSignal = this.resolveConfidence(signal);
            if (!confidentSignal) {
              if (this.options.debug) {
                console.log('[MeetingDetector] Holding low-confidence signal:', signal);
              }
              continue;
            }

            if (this.isDuplicateSession(confidentSignal)) {
              if (this.options.debug) {
                console.log('[MeetingDetector] Skipping duplicate session:', confidentSignal);
              }
              continue;
            }

            if (this.options.debug) {
              console.log('[MeetingDetector] Parsed signal:', confidentSignal);
            }
            this.emit('meeting', confidentSignal);
          } catch (error) {
            if (this.options.debug) {
              console.log('[MeetingDetector] Failed to parse line:', line);
            }
            this.emit('error', new Error(`Failed to parse signal: ${line}`));
          }
        }
      }
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      if (this.options.debug) {
        console.log('[MeetingDetector] stderr:', data.toString());
      }
    });

    this.process.on('error', (error) => {
      this.emit('error', error);
    });

    this.process.on('exit', (code, signal) => {
      if (this.options.debug) {
        console.log(`[MeetingDetector] Process exited with code ${code}, signal ${signal}`);
      }
      this.process = undefined;
      this.emit('exit', { code, signal });
    });

    if (this.options.debug) {
      console.log('[MeetingDetector] Started monitoring');
    }
  }

  /**
   * Stop monitoring
   */
  public stop(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = undefined;

      // Clear active sessions when stopping
      this.activeSessions.clear();
      this.pendingConfidence.clear();
      this.serviceContext.clear();

      if (this.options.debug) {
        console.log('[MeetingDetector] Stopped monitoring');
      }
    }
  }

  /**
   * Check if the detector is currently running
   */
  public isRunning(): boolean {
    return !!this.process;
  }

  /**
   * Add a meeting event listener
   */
  public onMeeting(callback: MeetingEventCallback): void {
    this.on('meeting', callback);
  }

  /**
   * Add an error event listener
   */
  public onError(callback: ErrorEventCallback): void {
    this.on('error', callback);
  }

  /**
   * Comprehensive filtering to prevent false positives
   * Filters out:
   * - System processes (WebKit, SiriNCService, Chrome Helper, etc.)
   * - Development tools (Electron, Terminal, Xcode)
   * - Generic browser services (Chrome, Safari, Firefox)
   * - Browser camera initialization (no window title + 'requested' verdict)
   * - Google Meet signals without valid meeting URL patterns
   */
  private shouldIgnoreSignal(signal: MeetingSignal): boolean {
    // System processes that should never trigger meeting detection
    const systemProcessPatterns = [
      'sirinc',            // SiriNCService
      'afplay',            // macOS audio file player
      'systemsoundserver', // System sound effects
      'wavelink',          // Audio routing software
      'granola helper',    // Screen recording helper
      'webkit.gpu',        // WebKit GPU process
      'webkit.networking', // WebKit networking
      // NOTE: 'chrome helper' intentionally NOT listed — Chrome Helper is the process
      // used by Google Meet, Zoom web, and other browser-based meeting platforms.
      'electron helper',   // Electron helper processes (not meeting-specific)
      'caphost',           // Zoom internal media helper (emitted separately)
      'webview helper',    // Generic WKWebView helper
    ];

    // Services/apps that are too generic or non-meeting
    const genericServices = [
      'electron',
      'terminal',
      'granola',
      'finder',
      'xcode',
      'tips',
      'google chrome',    // Generic Chrome (resolved to 'Google Meet' when in a call)
      'safari',
      'firefox',
      'microsoft edge',
      'photo booth',
      'quicktime player',
      'quicktime playerx',
    ];

    const processName = signal.process?.toLowerCase() || '';
    const serviceName = signal.service?.toLowerCase() || '';

    // Filter by process name patterns (partial match)
    if (systemProcessPatterns.some(pattern => processName.includes(pattern))) {
      return true;
    }

    // Filter by exact generic service names
    if (genericServices.includes(serviceName)) {
      return true;
    }

    // Camera initialization filter: if verdict is 'requested' and window_title is empty
    // AND the camera hardware is not yet active, it's a pre-check, not an active call.
    if (signal.verdict === 'requested' && (!signal.window_title || signal.window_title.trim() === '')) {
      if (!signal.camera_active) {
        return true;
      }
    }

    // For Google Meet (Chrome-based): validate title only when it is available.
    // When Chrome is backgrounded the title is empty — still allow the signal through
    // because the meeting is genuinely active (camera_active guard above already handles
    // the pre-check case).
    if (serviceName === 'google meet') {
      const windowTitle = signal.window_title?.trim() || '';
      if (windowTitle !== '') {
        // Title present → require it to look like an actual meeting room
        const hasValidMeetTitle =
          windowTitle.includes('meet.google.com') ||
          windowTitle.includes('Meet - ') ||
          /[a-z]{3}-[a-z]{4}-[a-z]{3}/.test(windowTitle);
        if (!hasValidMeetTitle) {
          return true;
        }
      }
      // Empty title → pass through (Chrome is backgrounded but meeting is active)
    }

    return false;
  }

  private getServiceKey(signal: MeetingSignal): string {
    return (signal.service || signal.front_app || signal.process || '').toLowerCase();
  }

  private isFrontAppConsistentWithService(frontApp: string, service: string): boolean {
    const f = (frontApp || '').toLowerCase();
    const s = (service || '').toLowerCase();
    if (!f || !s) return false;

    if (s === 'microsoft teams') {
      return f.includes('teams') || f.includes('msteams');
    }
    if (s === 'google meet') {
      return f.includes('chrome') || f.includes('google meet');
    }
    if (s === 'zoom') {
      return f.includes('zoom');
    }
    if (s === 'webex') {
      return f.includes('webex');
    }
    if (s === 'slack') {
      return f.includes('slack');
    }
    return f.includes(s);
  }

  private stabilizeSignalContext(signal: MeetingSignal): MeetingSignal {
    const key = this.getServiceKey(signal);
    const existing = this.serviceContext.get(key) || {};
    const next: MeetingSignal = { ...signal };

    const rawFront = (signal.front_app || '').trim();
    const rawTitle = (signal.window_title || '').trim();
    const frontConsistent = this.isFrontAppConsistentWithService(rawFront, signal.service);

    if (rawFront && frontConsistent) {
      next.front_app = rawFront;
      existing.frontApp = rawFront;
    } else if (existing.frontApp) {
      next.front_app = existing.frontApp;
    } else {
      // Keep context aligned with detected service when OS foreground sampling is stale.
      next.front_app = signal.service;
      existing.frontApp = signal.service;
    }

    if (rawTitle && frontConsistent) {
      next.window_title = rawTitle;
      existing.windowTitle = rawTitle;
    } else if (existing.windowTitle && this.isFrontAppConsistentWithService(next.front_app, signal.service)) {
      next.window_title = existing.windowTitle;
    } else {
      next.window_title = '';
    }

    this.serviceContext.set(key, existing);
    return next;
  }

  private isLowConfidenceSignal(signal: MeetingSignal): boolean {
    const serviceKey = this.getServiceKey(signal);
    if (!MeetingDetector.PRECHECK_PRONE_SERVICES.has(serviceKey)) {
      return false;
    }

    const hasNoWindowTitle = !signal.window_title || signal.window_title.trim() === '';
    return signal.verdict === 'requested' && signal.preflight === true && hasNoWindowTitle;
  }

  private hasStrongMeetingEvidence(signal: MeetingSignal): boolean {
    if (signal.verdict === 'allowed' || signal.preflight === false) {
      return true;
    }
    return !!signal.window_title && signal.window_title.trim() !== '';
  }

  private cleanupExpiredPendingConfidence(now: number): void {
    for (const [key, pending] of this.pendingConfidence.entries()) {
      if (now - pending.lastSeen > MeetingDetector.LOW_CONFIDENCE_WINDOW_MS) {
        this.pendingConfidence.delete(key);
      }
    }
  }

  private resolveConfidence(signal: MeetingSignal): MeetingSignal | null {
    const now = Date.now();
    this.cleanupExpiredPendingConfidence(now);

    const key = this.getServiceKey(signal);
    const pending = this.pendingConfidence.get(key);
    const lowConfidence = this.isLowConfidenceSignal(signal);
    const strongEvidence = this.hasStrongMeetingEvidence(signal);

    if (strongEvidence) {
      this.pendingConfidence.delete(key);
      return signal;
    }

    if (!lowConfidence) {
      return signal;
    }

    if (!pending) {
      this.pendingConfidence.set(key, {
        firstSeen: now,
        lastSeen: now,
        count: 1,
        signal
      });
      return null;
    }

    pending.lastSeen = now;
    pending.count += 1;
    pending.signal = signal;

    const duration = now - pending.firstSeen;
    if (
      pending.count >= MeetingDetector.LOW_CONFIDENCE_FALLBACK_MIN_SIGNALS &&
      duration >= MeetingDetector.LOW_CONFIDENCE_FALLBACK_MIN_DURATION_MS
    ) {
      this.pendingConfidence.delete(key);
      if (this.options.debug) {
        console.log('[MeetingDetector] Promoting low-confidence signal after sustained activity:', signal);
      }
      return signal;
    }

    return null;
  }

  /**
   * Generate a unique session key based on the signal properties
   */
  private getSessionKey(signal: MeetingSignal): string {
    // Session key is service-centric to collapse helper-process bursts from the same app.
    return signal.service || signal.front_app || signal.process;
  }

  /**
   * Check if this signal is a duplicate of an existing session
   * Returns true if duplicate, false if new or expired session
   */
  private isDuplicateSession(signal: MeetingSignal): boolean {
    const sessionKey = this.getSessionKey(signal);
    const now = Date.now();
    const existingSession = this.activeSessions.get(sessionKey);

    // Clean up expired sessions periodically
    this.cleanupExpiredSessions();

    if (existingSession) {
      const timeSinceLastSeen = now - existingSession.lastSeen;

      if (timeSinceLastSeen < this.options.sessionDeduplicationMs) {
        // Update last seen time for existing session
        existingSession.lastSeen = now;
        return true; // This is a duplicate
      }
    }

    // New session or expired session - track it
    this.activeSessions.set(sessionKey, {
      lastSeen: now,
      signal
    });

    return false; // This is not a duplicate
  }

  /**
   * Clean up sessions that have expired
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, session] of this.activeSessions.entries()) {
      if (now - session.lastSeen > this.options.sessionDeduplicationMs) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.activeSessions.delete(key);
      if (this.options.debug) {
        console.log(`[MeetingDetector] Cleaned up expired session: ${key}`);
      }
    }
  }

  private parseSignal(line: string): MeetingSignal {
    const signal = JSON.parse(line) as Record<string, any>;
    const chromeUrl = signal.chrome_url || '';

    // Use transformed app name as service if the original service is a system service like 'microphone' or 'camera'
    const originalService = signal.service || '';
    const transformedService = this.transformAppName(signal.front_app, signal.process, chromeUrl);
    const finalService = (originalService === 'microphone' || originalService === 'camera' || !originalService)
      ? transformedService
      : originalService;

    return {
      event: signal.event,
      timestamp: signal.timestamp,
      service: finalService,
      verdict: signal.verdict || '',
      preflight: signal.preflight === 'true' || signal.preflight === true,
      process: signal.process || '',
      pid: signal.pid || '',
      parent_pid: signal.parent_pid || '',
      process_path: signal.process_path || '',
      front_app: signal.front_app || '',
      window_title: signal.window_title || '',
      session_id: signal.session_id || '',
      camera_active: signal.camera_active === 'true' || signal.camera_active === true,
      chrome_url: chromeUrl
    };
  }

  private includesAny(value: string, patterns: string[]): boolean {
    return patterns.some((pattern) => value.includes(pattern));
  }

  private transformAppName(frontApp: string, process: string, chromeUrl = ''): string {
    const app = frontApp?.toLowerCase() || '';
    const proc = process?.toLowerCase() || '';
    const url = chromeUrl.toLowerCase();

    // For Chrome Helper processes, the active tab URL is the definitive source —
    // it does not depend on which app is currently frontmost.
    if (url && proc.includes('chrome')) {
      if (url.includes('meet.google.com')) return 'Google Meet';
      if (url.includes('zoom.us/wc/') || url.includes('zoom.us/j/')) return 'Zoom';
      if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return 'Microsoft Teams';
      if (url.includes('web.webex.com') || url.includes('webex.com/meet')) return 'Webex';
      if (url.includes('app.slack.com') && url.includes('huddle')) return 'Slack';
      if (url.includes('meet.jit.si') || url.includes('jitsi')) return 'Jitsi Meet';
      if (url.includes('whereby.com')) return 'Whereby';
      if (url.includes('bluejeans.com')) return 'BlueJeans';
      if (url.includes('ringcentral.com')) return 'RingCentral';
      if (url.includes('chime.aws')) return 'Amazon Chime';
      if (url.includes('goto.com') || url.includes('gotomeeting.com')) return 'GoToMeeting';
    }

    // Prefer process identity next because front_app sampling can be stale.
    if (this.includesAny(proc, ['microsoft teams', 'msteams'])) return 'Microsoft Teams';
    if (this.includesAny(proc, ['zoom'])) return 'Zoom';
    if (this.includesAny(proc, ['webex', 'cisco webex'])) return 'Webex';
    if (this.includesAny(proc, ['slack'])) return 'Slack';
    if (this.includesAny(proc, ['google meet', 'meet.google.com'])) return 'Google Meet';
    if (this.includesAny(proc, ['skype'])) return 'Skype';
    if (this.includesAny(proc, ['discord'])) return 'Discord';
    if (this.includesAny(proc, ['facetime'])) return 'FaceTime';
    if (this.includesAny(proc, ['gotomeeting', 'goto meeting'])) return 'GoToMeeting';
    if (this.includesAny(proc, ['bluejeans', 'blue jeans'])) return 'BlueJeans';
    if (this.includesAny(proc, ['jitsi'])) return 'Jitsi Meet';
    if (this.includesAny(proc, ['whereby'])) return 'Whereby';
    if (this.includesAny(proc, ['8x8'])) return '8x8';
    if (this.includesAny(proc, ['ringcentral', 'ring central'])) return 'RingCentral';
    if (this.includesAny(proc, ['bigbluebutton', 'big blue button'])) return 'BigBlueButton';
    if (this.includesAny(proc, ['amazon chime', 'chime'])) return 'Amazon Chime';
    if (this.includesAny(proc, ['google hangouts', 'hangouts'])) return 'Google Hangouts';
    if (this.includesAny(proc, ['adobe connect'])) return 'Adobe Connect';
    if (this.includesAny(proc, ['teamviewer'])) return 'TeamViewer';
    if (this.includesAny(proc, ['anydesk'])) return 'AnyDesk';
    if (this.includesAny(proc, ['clickmeeting'])) return 'ClickMeeting';
    if (this.includesAny(proc, ['appear.in'])) return 'Appear.in';

    // Fallback to front_app when process identity is generic/indirect (e.g., Chrome Helper
    // without a chrome_url resolved). front_app is unreliable when Chrome is backgrounded
    // — only use it when we have no better signal.
    if (this.includesAny(app, ['microsoft teams', 'msteams'])) return 'Microsoft Teams';
    if (this.includesAny(app, ['zoom'])) return 'Zoom';
    if (this.includesAny(app, ['webex'])) return 'Webex';
    if (this.includesAny(app, ['slack'])) return 'Slack';
    if (this.includesAny(app, ['google meet'])) return 'Google Meet';
    if (this.includesAny(app, ['chrome'])) return 'Google Meet';
    if (this.includesAny(app, ['skype'])) return 'Skype';
    if (this.includesAny(app, ['discord'])) return 'Discord';
    if (this.includesAny(app, ['facetime'])) return 'FaceTime';
    if (this.includesAny(app, ['gotomeeting'])) return 'GoToMeeting';
    if (this.includesAny(app, ['bluejeans'])) return 'BlueJeans';
    if (this.includesAny(app, ['jitsi'])) return 'Jitsi Meet';
    if (this.includesAny(app, ['whereby'])) return 'Whereby';
    if (this.includesAny(app, ['8x8'])) return '8x8';
    if (this.includesAny(app, ['ringcentral'])) return 'RingCentral';
    if (this.includesAny(app, ['chime'])) return 'Amazon Chime';
    if (this.includesAny(app, ['hangouts'])) return 'Google Hangouts';
    if (this.includesAny(app, ['adobe connect'])) return 'Adobe Connect';
    if (this.includesAny(app, ['teamviewer'])) return 'TeamViewer';
    if (this.includesAny(app, ['anydesk'])) return 'AnyDesk';
    if (this.includesAny(app, ['clickmeeting'])) return 'ClickMeeting';
    if (this.includesAny(app, ['appear.in'])) return 'Appear.in';

    // Final fallback.
    return frontApp || 'Meeting App';
  }
}

// Convenience function for simple usage
export function detector(callback: MeetingEventCallback, options?: MeetingDetectorOptions): MeetingDetector {
  const detector = new MeetingDetector(options);
  detector.start(callback);
  return detector;
}
