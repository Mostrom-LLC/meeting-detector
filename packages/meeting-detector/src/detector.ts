import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MeetingSignal, MeetingDetectorOptions, MeetingEventCallback, ErrorEventCallback } from './types.js';

interface SessionInfo {
  lastSeen: number;
  signal: MeetingSignal;
}

export class MeetingDetector extends EventEmitter {
  private process?: ChildProcess;
  private options: Required<MeetingDetectorOptions>;
  private activeSessions: Map<string, SessionInfo> = new Map();

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
            const signal = this.parseSignal(line);
            if (this.shouldIgnoreSignal(signal)) {
              if (this.options.debug) {
                console.log('[MeetingDetector] Ignoring signal:', signal);
              }
              continue;
            }

            if (this.isDuplicateSession(signal)) {
              if (this.options.debug) {
                console.log('[MeetingDetector] Skipping duplicate session:', signal);
              }
              continue;
            }

            if (this.options.debug) {
              console.log('[MeetingDetector] Parsed signal:', signal);
            }
            this.emit('meeting', signal);
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
      'sirinc',           // SiriNCService
      'afplay',           // macOS audio file player
      'systemsoundserver', // System sound effects
      'wavelink',         // Audio routing software
      'granola helper',   // Screen recording helper
      'webkit.gpu',       // WebKit GPU process
      'webkit.networking', // WebKit networking
      'chrome helper',    // Chrome helper processes (too generic)
      'electron helper',  // Electron helper processes
    ];

    // Services/apps that are too generic or development-related
    const genericServices = [
      'electron',
      'terminal',
      'granola',
      'finder',
      'xcode',
      'tips',
      'google chrome',   // Generic Chrome service (not a specific meeting)
      'safari',          // Generic Safari service
      'firefox',         // Generic Firefox service
      'microsoft edge',  // Generic Edge service
    ];

    const processName = signal.process?.toLowerCase() || '';
    const serviceName = signal.service?.toLowerCase() || '';

    // Filter by process name patterns (partial match for flexibility)
    if (systemProcessPatterns.some(pattern => processName.includes(pattern))) {
      return true;
    }

    // Filter by exact generic service names
    if (genericServices.includes(serviceName)) {
      return true;
    }

    // Camera initialization filter: if verdict is 'requested' and window_title is empty,
    // it's likely just camera initialization, not an actual meeting
    // This applies to ALL apps to prevent false positives during camera setup
    if (signal.verdict === 'requested' && (!signal.window_title || signal.window_title.trim() === '')) {
      // Exception: if camera is actively being used (not just requested), allow it through
      // This helps distinguish between "requesting permission" vs "actively in a call"
      if (!signal.camera_active) {
        return true;
      }
    }

    // For Google Meet specifically: require window title to contain meeting URL patterns
    // This prevents false positives from just opening Chrome with camera permissions
    if (serviceName === 'google meet') {
      const windowTitle = signal.window_title || '';

      // Valid Google Meet windows should contain:
      // - meet.google.com URL
      // - "Meet - " prefix in title
      // - Valid meeting code pattern (e.g., abc-defg-hij)
      const hasValidMeetTitle =
        windowTitle.includes('meet.google.com') ||
        windowTitle.includes('Meet - ') ||
        /[a-z]{3}-[a-z]{4}-[a-z]{3}/.test(windowTitle); // Meeting code pattern

      if (!hasValidMeetTitle) {
        return true;
      }
    }

    return false;
  }

  /**
   * Generate a unique session key based on the signal properties
   */
  private getSessionKey(signal: MeetingSignal): string {
    return `${signal.pid}:${signal.service}:${signal.front_app}`;
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
    
    // Use transformed app name as service if the original service is a system service like 'microphone' or 'camera'
    const originalService = signal.service || '';
    const transformedService = this.transformAppName(signal.front_app, signal.process);
    const finalService = (originalService === 'microphone' || originalService === 'camera' || !originalService) 
      ? transformedService 
      : originalService;
    
    return {
      event: signal.event,
      timestamp: signal.timestamp,
      service: finalService,
      verdict: signal.verdict || '',
      process: signal.process || '',
      pid: signal.pid || '',
      parent_pid: signal.parent_pid || '',
      process_path: signal.process_path || '',
      front_app: signal.front_app || '',
      window_title: signal.window_title || '',
      session_id: signal.session_id || '',
      camera_active: signal.camera_active === 'true' || signal.camera_active === true
    };
  }

  private transformAppName(frontApp: string, process: string): string {
    const app = frontApp?.toLowerCase() || '';
    const proc = process?.toLowerCase() || '';
    
    if (app.includes('slack') || proc.includes('slack')) {
      return 'Slack';
    } else if (app.includes('msteams') || proc.includes('microsoft teams') || proc.includes('teams')) {
      return 'Microsoft Teams';
    } else if (app.includes('zoom') || proc.includes('zoom')) {
      return 'Zoom';
    } else if (app.includes('webex') || proc.includes('webex') || proc.includes('cisco webex')) {
      return 'Webex';
    } else if (app.includes('google meet') || proc.includes('google meet') || proc.includes('meet.google.com') || (app.includes('chrome') && proc.includes('chrome'))) {
      return 'Google Meet';
    } else if (app.includes('skype') || proc.includes('skype')) {
      return 'Skype';
    } else if (app.includes('discord') || proc.includes('discord')) {
      return 'Discord';
    } else if (app.includes('facetime') || proc.includes('facetime')) {
      return 'FaceTime';
    } else if (app.includes('gotomeeting') || proc.includes('gotomeeting') || proc.includes('goto meeting')) {
      return 'GoToMeeting';
    } else if (app.includes('bluejeans') || proc.includes('bluejeans') || proc.includes('blue jeans')) {
      return 'BlueJeans';
    } else if (app.includes('jitsi') || proc.includes('jitsi')) {
      return 'Jitsi Meet';
    } else if (app.includes('whereby') || proc.includes('whereby')) {
      return 'Whereby';
    } else if (app.includes('8x8') || proc.includes('8x8')) {
      return '8x8';
    } else if (app.includes('ringcentral') || proc.includes('ringcentral') || proc.includes('ring central')) {
      return 'RingCentral';
    } else if (app.includes('bigbluebutton') || proc.includes('bigbluebutton') || proc.includes('big blue button')) {
      return 'BigBlueButton';
    } else if (app.includes('chime') || proc.includes('chime') || proc.includes('amazon chime')) {
      return 'Amazon Chime';
    } else if (app.includes('hangouts') || proc.includes('hangouts') || proc.includes('google hangouts')) {
      return 'Google Hangouts';
    } else if (app.includes('adobe connect') || proc.includes('adobe connect')) {
      return 'Adobe Connect';
    } else if (app.includes('teamviewer') || proc.includes('teamviewer')) {
      return 'TeamViewer';
    } else if (app.includes('anydesk') || proc.includes('anydesk')) {
      return 'AnyDesk';
    } else if (app.includes('clickmeeting') || proc.includes('clickmeeting')) {
      return 'ClickMeeting';
    } else if (app.includes('appear.in') || proc.includes('appear.in')) {
      return 'Appear.in';
    } else {
      // Fallback to front_app if no match
      return frontApp || 'Meeting App';
    }
  }
}

// Convenience function for simple usage
export function detector(callback: MeetingEventCallback, options?: MeetingDetectorOptions): MeetingDetector {
  const detector = new MeetingDetector(options);
  detector.start(callback);
  return detector;
}
