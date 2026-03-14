import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  MeetingSignal,
  MeetingDetectorOptions,
  MeetingEventCallback,
  ErrorEventCallback,
  MeetingLifecycleEvent,
  MeetingLifecycleCallback,
  MeetingPlatform,
} from './types.js';
import {
  tryLoadNative,
  type NativeModule,
  type NativeDetector,
  isNativePlatformSupported,
} from './native-bridge.js';

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

interface ActiveMeetingState {
  platform: MeetingPlatform;
  lastSeen: number;
  confidence: MeetingLifecycleEvent['confidence'];
  signal: MeetingSignal;
}

export class MeetingDetector extends EventEmitter {
  private static readonly LOW_CONFIDENCE_WINDOW_MS = 45000;
  private static readonly LOW_CONFIDENCE_FALLBACK_MIN_SIGNALS = 4;
  private static readonly LOW_CONFIDENCE_FALLBACK_MIN_DURATION_MS = 30000;
  private static readonly PRECHECK_PRONE_SERVICES = new Set([
    'microsoft teams',
    'zoom',
    'cisco webex',
    'slack',
    'jitsi meet'
  ]);

  private process?: ChildProcess;
  private options: Required<MeetingDetectorOptions>;
  private activeSessions: Map<string, SessionInfo> = new Map();
  private pendingConfidence: Map<string, PendingConfidenceSignal> = new Map();
  private serviceContext: Map<string, ServiceContext> = new Map();
  private activeMeeting: ActiveMeetingState | null = null;
  private meetingEndTimer?: NodeJS.Timeout;
  
  // Native module support
  private nativeModule: NativeModule | null = null;
  private nativeDetector: NativeDetector | null = null;
  private nativePollingInterval?: NodeJS.Timeout;
  private useNative: boolean = false;

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
      sessionDeduplicationMs: options.sessionDeduplicationMs || 60000,
      meetingEndTimeoutMs: options.meetingEndTimeoutMs || 30000,
      emitUnknown: options.emitUnknown || false,
      includeSensitiveMetadata: options.includeSensitiveMetadata || false,
      includeRawSignalInLifecycle: options.includeRawSignalInLifecycle || false,
      startupProbe: options.startupProbe !== false
    };

    // Try to load native module
    this.nativeModule = tryLoadNative();
    if (this.nativeModule) {
      try {
        this.nativeDetector = new this.nativeModule.NativeMeetingDetector({
          debug: this.options.debug,
          sessionDeduplicationMs: this.options.sessionDeduplicationMs,
          meetingEndTimeoutMs: this.options.meetingEndTimeoutMs,
          emitUnknown: this.options.emitUnknown,
          includeSensitiveMetadata: this.options.includeSensitiveMetadata,
          includeRawSignalInLifecycle: this.options.includeRawSignalInLifecycle,
          startupProbe: this.options.startupProbe,
        });
        this.useNative = this.nativeDetector.isSupported();
        if (this.options.debug) {
          console.log(`[MeetingDetector] Native module loaded, platform: ${this.nativeDetector.platformName()}, supported: ${this.useNative}`);
        }
      } catch (e) {
        if (this.options.debug) {
          console.log('[MeetingDetector] Native module available but detector creation failed:', e);
        }
        this.useNative = false;
      }
    } else if (this.options.debug) {
      console.log('[MeetingDetector] Native module not available, using shell script fallback');
    }
  }

  /**
   * Start monitoring for meeting signals
   * @param callback Optional callback function for meeting events
   */
  public start(callback?: MeetingEventCallback): void {
    if (this.process || this.nativePollingInterval) {
      throw new Error('Detector is already running');
    }

    if (callback) {
      this.on('meeting', callback);
    }

    // Use native detection if available
    if (this.useNative && this.nativeDetector) {
      this.startNativeDetection();
      return;
    }

    // Fall back to shell script detection
    this.process = spawn('sh', [this.options.scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Probe for an already-active meeting so detectors that start mid-call emit immediately.
    if (this.options.startupProbe) {
      this.probeActiveMeetingAtStartup();
    }

    let stderrBuffer = '';

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

            this.updateMeetingLifecycle(confidentSignal);

            if (this.isDuplicateSession(confidentSignal)) {
              if (this.options.debug) {
                console.log('[MeetingDetector] Skipping duplicate session:', confidentSignal);
              }
              continue;
            }

            const outputSignal = this.sanitizeSignalForOutput(confidentSignal);
            if (this.options.debug) {
              console.log('[MeetingDetector] Parsed signal:', outputSignal);
            }
            this.emit('meeting', outputSignal);
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
      const text = data.toString();
      stderrBuffer += text;
      if (this.options.debug) {
        console.log('[MeetingDetector] stderr:', text);
      }
    });

    this.process.on('error', (error) => {
      this.emit('error', error);
    });

    this.process.on('exit', (code, signal) => {
      if (this.options.debug) {
        console.log(`[MeetingDetector] Process exited with code ${code}, signal ${signal}`);
      }
      // Detect permission errors: log stream exits immediately with non-zero code and
      // a relevant message when macOS privacy access has not been granted.
      if (code !== 0 && code !== null && !signal) {
        const stderr = stderrBuffer.toLowerCase();
        if (
          stderr.includes('not allowed') ||
          stderr.includes('authorization') ||
          stderr.includes('permission denied') ||
          stderr.includes('operation not permitted')
        ) {
          this.emit('error', new Error(
            'Meeting detector failed to access macOS privacy logs (exit code ' + code + '). ' +
            'Grant Full Disk Access or Automation permissions in System Settings > Privacy & Security.'
          ));
        }
      }
      if (this.meetingEndTimer) {
        clearTimeout(this.meetingEndTimer);
        this.meetingEndTimer = undefined;
      }
      if (this.activeMeeting) {
        this.emitMeetingLifecycle('meeting_ended', this.activeMeeting.platform, this.activeMeeting.confidence, 'stop', this.activeMeeting.signal);
        this.activeMeeting = null;
      }
      this.process = undefined;
      this.emit('exit', { code, signal });
    });

    if (this.options.debug) {
      console.log('[MeetingDetector] Started monitoring');
    }
  }

  /**
   * Start native detection using Rust native module.
   * 
   * Note: Currently the native module provides state machine processing but
   * signal generation still uses shell scripts on macOS. On Linux, native
   * detection uses procfs and X11 directly.
   */
  private startNativeDetection(): void {
    if (!this.nativeDetector) {
      throw new Error('Native detector not available');
    }

    if (this.options.debug) {
      console.log('[MeetingDetector] Starting native detection');
    }

    this.nativeDetector.start();

    // For now, on macOS we still use shell script for signal generation
    // but process signals through native state machine
    if (process.platform === 'darwin') {
      this.startShellScriptWithNativeProcessing();
      return;
    }

    // On Linux/Windows, the native detector can poll directly
    // TODO: Implement native polling loop using PlatformDetector
    // For now, fall back to shell script approach
    this.startShellScriptWithNativeProcessing();
  }

  /**
   * Start shell script signal generation with native state machine processing.
   */
  private startShellScriptWithNativeProcessing(): void {
    this.process = spawn('sh', [this.options.scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stderrBuffer = '';

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

            // Use native state machine for processing
            if (this.nativeDetector) {
              const events = this.nativeDetector.processSignal(signal);
              for (const event of events) {
                this.emitNativeLifecycleEvent(event);
              }
            }

            // Emit raw signal for backward compatibility
            const outputSignal = this.sanitizeSignalForOutput(signal);
            this.emit('meeting', outputSignal);
          } catch (e) {
            if (this.options.debug) {
              console.error('[MeetingDetector] Parse error:', e);
            }
          }
        }
      }
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      stderrBuffer += data.toString();
      if (this.options.debug) {
        console.error('[MeetingDetector stderr]:', data.toString());
      }
    });

    this.process.on('close', (code) => {
      if (this.options.debug) {
        console.log(`[MeetingDetector] Shell script exited with code ${code}`);
      }
      if (code !== 0 && stderrBuffer) {
        this.emit('error', new Error(`Script error: ${stderrBuffer}`));
      }
      this.process = undefined;
    });

    // Set up meeting end check timer
    this.nativePollingInterval = setInterval(() => {
      if (!this.nativeDetector) return;
      const endEvent = this.nativeDetector.checkMeetingEnd();
      if (endEvent) {
        this.emitNativeLifecycleEvent(endEvent);
      }
    }, 1000);

    // Periodic session cleanup
    setInterval(() => {
      this.nativeDetector?.cleanupSessions();
    }, 60000);
  }

  /**
   * Emit a lifecycle event from native detector.
   */
  private emitNativeLifecycleEvent(event: MeetingLifecycleEvent): void {
    this.emit('lifecycle', event);

    switch (event.event) {
      case 'meeting_started':
        this.emit('meeting_started', event);
        break;
      case 'meeting_changed':
        this.emit('meeting_changed', event);
        break;
      case 'meeting_ended':
        this.emit('meeting_ended', event);
        break;
    }
  }

  /**
   * Stop monitoring
   */
  public stop(): void {
    // Stop native detection
    if (this.nativePollingInterval) {
      clearInterval(this.nativePollingInterval);
      this.nativePollingInterval = undefined;
    }
    if (this.nativeDetector) {
      const endEvent = this.nativeDetector.stop();
      if (endEvent) {
        this.emitNativeLifecycleEvent(endEvent);
      }
    }

    // Stop shell script detection
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = undefined;

      if (this.meetingEndTimer) {
        clearTimeout(this.meetingEndTimer);
        this.meetingEndTimer = undefined;
      }
      if (this.activeMeeting) {
        this.emitMeetingLifecycle('meeting_ended', this.activeMeeting.platform, this.activeMeeting.confidence, 'stop', this.activeMeeting.signal);
      }
      this.activeMeeting = null;

      // Clear active sessions when stopping
      this.activeSessions.clear();
      this.pendingConfidence.clear();
      this.serviceContext.clear();
    }

    if (this.options.debug) {
      console.log('[MeetingDetector] Stopped monitoring');
    }
  }

  /**
   * Check if the detector is currently running
   */
  public isRunning(): boolean {
    return !!this.process || !!this.nativePollingInterval;
  }

  /**
   * Check if native detection is being used.
   */
  public isUsingNative(): boolean {
    return this.useNative && !!this.nativePollingInterval;
  }

  /**
   * Get the native module version if available.
   */
  public getNativeVersion(): string | null {
    return this.nativeModule?.version() ?? null;
  }

  /**
   * Get list of supported platforms.
   */
  public getSupportedPlatforms(): string[] {
    return this.nativeModule?.supportedPlatforms() ?? [];
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
   * Add lifecycle event listeners
   */
  public onMeetingStarted(callback: MeetingLifecycleCallback): void {
    this.on('meeting_started', callback);
  }

  public onMeetingChanged(callback: MeetingLifecycleCallback): void {
    this.on('meeting_changed', callback);
  }

  public onMeetingEnded(callback: MeetingLifecycleCallback): void {
    this.on('meeting_ended', callback);
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

    if (serviceName === 'unknown' && !this.options.emitUnknown) {
      return true;
    }

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

  private sanitizeSignalForOutput(signal: MeetingSignal): MeetingSignal {
    if (this.options.includeSensitiveMetadata) {
      return { ...signal };
    }
    return {
      ...signal,
      window_title: '',
      chrome_url: undefined,
    };
  }

  private normalizePlatform(service: string): MeetingPlatform {
    const key = (service || '').trim().toLowerCase();
    if (!key) return 'Unknown';
    if (key === 'microsoft teams') return 'Microsoft Teams';
    if (key === 'zoom') return 'Zoom';
    if (key === 'google meet') return 'Google Meet';
    if (key === 'slack') return 'Slack';
    if (key === 'webex' || key === 'cisco webex') return 'Cisco Webex';
    if (key === 'discord') return 'Discord';
    if (key === 'facetime') return 'FaceTime';
    if (key === 'skype') return 'Skype';
    if (key === 'whereby') return 'Whereby';
    if (key === 'gotomeeting') return 'GoToMeeting';
    if (key === 'bluejeans') return 'BlueJeans';
    if (key === 'jitsi meet') return 'Jitsi Meet';
    if (key === '8x8') return '8x8';
    if (key === 'ringcentral') return 'RingCentral';
    if (key === 'bigbluebutton') return 'BigBlueButton';
    if (key === 'amazon chime') return 'Amazon Chime';
    if (key === 'google hangouts') return 'Google Hangouts';
    if (key === 'adobe connect') return 'Adobe Connect';
    if (key === 'teamviewer') return 'TeamViewer';
    if (key === 'anydesk') return 'AnyDesk';
    if (key === 'clickmeeting') return 'ClickMeeting';
    if (key === 'appear.in') return 'Appear.in';
    return 'Unknown';
  }

  private getSignalConfidence(signal: MeetingSignal): MeetingLifecycleEvent['confidence'] {
    if (signal.verdict === 'allowed' || signal.preflight === false) {
      return 'high';
    }
    if ((signal.window_title && signal.window_title.trim() !== '') || signal.camera_active) {
      return 'medium';
    }
    return 'low';
  }

  private emitMeetingLifecycle(
    event: MeetingLifecycleEvent['event'],
    platform: MeetingPlatform,
    confidence: MeetingLifecycleEvent['confidence'],
    reason: MeetingLifecycleEvent['reason'],
    signal: MeetingSignal,
    previousPlatform?: MeetingPlatform
  ): void {
    const payload: MeetingLifecycleEvent = {
      event,
      timestamp: new Date().toISOString(),
      platform,
      confidence,
      reason,
      previous_platform: previousPlatform,
      raw_signal: this.options.includeRawSignalInLifecycle ? this.sanitizeSignalForOutput(signal) : undefined,
    };
    this.emit(event, payload);
    this.emit('meeting_lifecycle', payload);
  }

  private scheduleMeetingEndCheck(): void {
    if (this.meetingEndTimer) {
      clearTimeout(this.meetingEndTimer);
    }
    if (!this.activeMeeting) {
      this.meetingEndTimer = undefined;
      return;
    }
    this.meetingEndTimer = setTimeout(() => {
      this.handleMeetingEndTimeout();
    }, this.options.meetingEndTimeoutMs);
    this.meetingEndTimer.unref?.();
  }

  private handleMeetingEndTimeout(): void {
    if (!this.activeMeeting) {
      this.meetingEndTimer = undefined;
      return;
    }

    const idleMs = Date.now() - this.activeMeeting.lastSeen;
    if (idleMs >= this.options.meetingEndTimeoutMs) {
      const ended = this.activeMeeting;
      this.activeMeeting = null;
      this.meetingEndTimer = undefined;
      this.emitMeetingLifecycle('meeting_ended', ended.platform, ended.confidence, 'timeout', ended.signal);
      return;
    }

    this.scheduleMeetingEndCheck();
  }

  private updateMeetingLifecycle(signal: MeetingSignal): void {
    const platform = this.normalizePlatform(signal.service);
    if (platform === 'Unknown' && !this.options.emitUnknown) {
      return;
    }

    const confidence = this.getSignalConfidence(signal);
    const now = Date.now();

    if (!this.activeMeeting) {
      this.activeMeeting = {
        platform,
        lastSeen: now,
        confidence,
        signal,
      };
      this.emitMeetingLifecycle('meeting_started', platform, confidence, 'signal', signal);
      this.scheduleMeetingEndCheck();
      return;
    }

    if (this.activeMeeting.platform !== platform) {
      const previousPlatform = this.activeMeeting.platform;
      this.activeMeeting = {
        platform,
        lastSeen: now,
        confidence,
        signal,
      };
      this.emitMeetingLifecycle('meeting_changed', platform, confidence, 'switch', signal, previousPlatform);
      this.scheduleMeetingEndCheck();
      return;
    }

    this.activeMeeting.lastSeen = now;
    this.activeMeeting.confidence = confidence;
    this.activeMeeting.signal = signal;
    this.scheduleMeetingEndCheck();
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
    if (s === 'cisco webex') {
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
    if (this.hasStrongBrowserMeetingRoute(signal)) {
      return true;
    }
    return !!signal.window_title && signal.window_title.trim() !== '';
  }

  private hasStrongBrowserMeetingRoute(signal: MeetingSignal): boolean {
    if (!signal.camera_active) {
      return false;
    }

    const url = (signal.chrome_url || '').toLowerCase();
    if (!url) {
      return false;
    }

    const platform = this.normalizePlatform(signal.service);
    switch (platform) {
      case 'Microsoft Teams':
        return (
          url.includes('teams.microsoft.com/light-meetings/launch') ||
          url.includes('teams.microsoft.com/meet/') ||
          url.includes('teams.microsoft.com/l/meetup-join/') ||
          url.includes('teams.microsoft.com/v2/?meetingjoin=true') ||
          url.includes('teams.live.com/meet/')
        );
      case 'Zoom':
        return (
          url.includes('app.zoom.us/wc/') ||
          url.includes('zoom.us/wc/') ||
          url.includes('zoom.us/j/')
        );
      case 'Cisco Webex':
        return (
          url.includes('web.webex.com/') ||
          url.includes('webex.com/meet/')
        );
      default:
        return false;
    }
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

    // For precheck-prone services (Teams, Zoom, Webex, Slack) only strong evidence
    // is trusted. These apps continuously send preflight checks even when idle, so
    // the burst+sparse-follow-up pattern would satisfy any time/count threshold.
    // Real meetings from these apps produce FORWARD events (preflight=false) which
    // are caught by hasStrongMeetingEvidence above.
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
    const transformedService = this.transformAppName(signal.front_app, signal.process, signal.window_title || '', chromeUrl);
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

  private transformAppName(frontApp: string, process: string, windowTitle = '', chromeUrl = ''): MeetingPlatform {
    const app = frontApp?.toLowerCase() || '';
    const proc = process?.toLowerCase() || '';
    const title = windowTitle?.toLowerCase() || '';
    const url = chromeUrl.toLowerCase();

    // For Chrome Helper processes, the active tab URL is the definitive source —
    // it does not depend on which app is currently frontmost.
    if (url && proc.includes('chrome')) {
      if (url.includes('meet.google.com')) return 'Google Meet';
      if (url.includes('zoom.us/wc/') || url.includes('zoom.us/j/')) return 'Zoom';
      if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return 'Microsoft Teams';
      if (url.includes('web.webex.com') || url.includes('webex.com/meet')) return 'Cisco Webex';
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
    if (this.includesAny(proc, ['webex', 'cisco webex'])) return 'Cisco Webex';
    if (this.includesAny(proc, ['slack'])) return 'Slack';
    if (this.includesAny(proc, ['google meet', 'meet.google.com'])) return 'Google Meet';
    if (proc.includes('chrome') && (title.includes('meet.google.com') || /[a-z]{3}-[a-z]{4}-[a-z]{3}/.test(title))) {
      return 'Google Meet';
    }
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
    if (this.includesAny(app, ['webex'])) return 'Cisco Webex';
    if (this.includesAny(app, ['slack'])) return 'Slack';
    if (this.includesAny(app, ['google meet'])) return 'Google Meet';
    if (this.includesAny(app, ['chrome']) && (title.includes('meet.google.com') || /[a-z]{3}-[a-z]{4}-[a-z]{3}/.test(title))) {
      return 'Google Meet';
    }
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

    // Final fallback: do not guess.
    return 'Unknown';
  }

  /**
   * Check at startup whether a supported meeting is already active.
   * Emits a synthetic meeting_started lifecycle event if found.
   * This handles the case where the detector starts while a call is already in progress.
   */
  private probeActiveMeetingAtStartup(): void {
    // Check whether the camera daemon is already running (indicates active camera use).
    const cameraProbe = spawn('sh', ['-c',
      'pgrep -xq VDCAssistant 2>/dev/null || pgrep -xq AppleCameraAssistant 2>/dev/null'
    ]);
    cameraProbe.on('close', (cameraCode) => {
      // P2 guard: abort if the detector was stopped before this callback fired.
      if (!this.process) return;
      if (cameraCode !== 0) return; // Camera not active — no meeting in progress.

      // Candidates in priority order. Run ALL checks independently (semicolons, not ||) so
      // every running app is discovered, then resolve ambiguity via front-app tiebreak.
      const candidates: Array<[string, MeetingPlatform]> = [
        ['Microsoft Teams', 'Microsoft Teams'],
        ['zoom.us', 'Zoom'],
        ['Webex', 'Cisco Webex'],
        ['Discord', 'Discord'],
        ['FaceTime', 'FaceTime'],
      ];

      // Query front app in parallel with process checks so we can resolve ambiguity
      // without adding extra latency.
      const procScript = candidates
        .map(([proc, label]) => `pgrep -xq "${proc}" 2>/dev/null && echo "${label}"; true`)
        .join('; ');
      const fullScript = `(${procScript}); echo "FRONTAPP=$(osascript -e 'tell application "System Events" to name of first application process whose frontmost is true' 2>/dev/null || echo '')"`;

      const procProbe = spawn('sh', ['-c', fullScript]);
      let output = '';
      procProbe.stdout?.on('data', (d: Buffer) => { output += d.toString(); });
      procProbe.on('close', () => {
        // P2 guard: abort if the detector was stopped while the probe was running.
        if (!this.process) return;

        const matched = candidates.filter(([, label]) => output.includes(label));
        if (matched.length === 0) return; // No known meeting process found.

        let selected = matched[0]; // Priority-order fallback (first in candidate list).

        if (matched.length > 1) {
          // Multiple meeting apps are running. Use the frontmost app to tiebreak:
          // the focused window is almost always the active meeting.
          const frontMatch = output.match(/FRONTAPP=(.+)/);
          const frontApp = (frontMatch?.[1] || '').trim().toLowerCase();
          const frontCandidate = matched.find(([proc]) =>
            proc.toLowerCase().includes(frontApp) || frontApp.includes(proc.toLowerCase())
          );
          if (frontCandidate) {
            selected = frontCandidate;
          }
          // If frontmost app is not a meeting app (e.g. user is in Zoom but looking at
          // a browser), fall through to priority-order selection (selected = matched[0]).
          if (this.options.debug) {
            console.log(
              '[MeetingDetector] Startup probe: multiple apps found, front app resolution',
              { matched: matched.map(([, l]) => l), frontApp, selected: selected[1] }
            );
          }
        }

        const [procName, platform] = selected;
        const now = new Date().toISOString().slice(0, 19) + 'Z';
        const syntheticSignal: MeetingSignal = {
          event: 'meeting_signal',
          timestamp: now,
          service: platform,
          verdict: 'allowed',
          preflight: false,
          process: procName,
          pid: '',
          parent_pid: '',
          process_path: '',
          front_app: procName,
          window_title: '',
          session_id: '',
          camera_active: true,
        };

        if (this.options.debug) {
          console.log('[MeetingDetector] Startup probe found active meeting:', platform);
        }

        this.updateMeetingLifecycle(syntheticSignal);
        const outputSignal = this.sanitizeSignalForOutput(syntheticSignal);
        this.emit('meeting', outputSignal);
      });
    });
  }
}

// Convenience function for simple usage
export function detector(callback: MeetingEventCallback, options?: MeetingDetectorOptions): MeetingDetector {
  const detector = new MeetingDetector(options);
  detector.start(callback);
  return detector;
}
