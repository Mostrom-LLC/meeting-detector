import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
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
  createSessionTimeline,
  endSessionTimeline,
  touchSessionTimeline,
  type SessionTimelineState,
} from './lifecycle/session-timeline.js';
import {
  tryLoadNative,
  type NativeModule,
  type NativeDetector,
  isNativePlatformSupported,
} from './native-bridge.js';
import {
  classifyBrowserMeeting,
  classifyBrowserMeetingTab,
  type BrowserTabInfo,
} from './classifiers/browser-platform.js';
import {
  classifyNativeMeeting,
  classifyNativeProcessCommand,
  classifyPlatformFromNativeApp,
  NATIVE_STARTUP_PROBE_TARGETS,
} from './classifiers/native-platform.js';

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
  timeline: SessionTimelineState;
}

interface BrowserMeetingHint {
  browser: string;
  platform: MeetingPlatform;
  title: string;
  url: string;
  seenAt: number;
}

const execFileAsync = promisify(execFile);

const BROWSER_PROBE_SCRIPTS: Array<[string, string[]]> = [
  ['Google Chrome', [
    'set outText to ""',
    'tell application "Google Chrome"',
    'repeat with w in windows',
    'repeat with t in tabs of w',
    'set outText to outText & "Google Chrome" & (ASCII character 9) & (title of t) & (ASCII character 9) & (URL of t) & linefeed',
    'end repeat',
    'end repeat',
    'end tell',
    'return outText',
  ]],
  ['Microsoft Edge', [
    'set outText to ""',
    'tell application "Microsoft Edge"',
    'repeat with w in windows',
    'repeat with t in tabs of w',
    'set outText to outText & "Microsoft Edge" & (ASCII character 9) & (title of t) & (ASCII character 9) & (URL of t) & linefeed',
    'end repeat',
    'end repeat',
    'end tell',
    'return outText',
  ]],
  ['Safari', [
    'set outText to ""',
    'tell application "Safari"',
    'repeat with w in windows',
    'repeat with t in tabs of w',
    'set outText to outText & "Safari" & (ASCII character 9) & (name of t) & (ASCII character 9) & (URL of t) & linefeed',
    'end repeat',
    'end repeat',
    'end tell',
    'return outText',
  ]],
];

export function getBrowserProbeTargets(
  runningApps?: Iterable<string> | null
): Array<[string, string[]]> {
  if (!runningApps) {
    return [...BROWSER_PROBE_SCRIPTS];
  }

  const running = new Set(
    Array.from(runningApps, (app) => app.trim().toLowerCase()).filter(Boolean)
  );

  return BROWSER_PROBE_SCRIPTS.filter(([browser]) => running.has(browser.toLowerCase()));
}

export function matchBrowserMeetingUrl(urlInput: string, titleInput = ''): MeetingPlatform | null {
  return classifyBrowserMeeting(urlInput, titleInput);
}

export function matchBrowserMeetingTab(tab: BrowserTabInfo): MeetingPlatform | null {
  return classifyBrowserMeetingTab(tab);
}

export class MeetingDetector extends EventEmitter {
  private static readonly LOW_CONFIDENCE_WINDOW_MS = 45000;
  private static readonly LOW_CONFIDENCE_FALLBACK_MIN_SIGNALS = 4;
  private static readonly LOW_CONFIDENCE_FALLBACK_MIN_DURATION_MS = 30000;
  private static readonly DEBUG_SIGNAL_LOG_DEDUPE_MS = 15000;
  private static readonly PRECHECK_PRONE_SERVICES = new Set([
    'microsoft teams',
    'zoom',
    'cisco webex',
    'slack',
    'jitsi meet'
  ]);

  private static readonly RECORDER_PROCESSES = new Set([
    'obs',
    'obs studio',
    'obs helper',
    'screenflow',
    'camtasia',
    'loom',
    'loom helper',
    'screen recording',
    'kap',
    'cleanshot',
    'cleanshot x',
    'snagit',
  ]);

  private options: Required<MeetingDetectorOptions>;
  private activeSessions: Map<string, SessionInfo> = new Map();
  private pendingConfidence: Map<string, PendingConfidenceSignal> = new Map();
  private serviceContext: Map<string, ServiceContext> = new Map();
  private activeMeeting: ActiveMeetingState | null = null;
  private browserMeetingHints: Map<string, BrowserMeetingHint[]> = new Map();
  private meetingEndTimer?: NodeJS.Timeout;
  private debugSignalLogTimes: Map<string, number> = new Map();
  private browserProbeInterval?: NodeJS.Timeout;
  private browserProbeInFlight = false;
  private nativeAppProbeInterval?: NodeJS.Timeout;
  private nativeAppProbeInFlight = false;
  private cachedMediaState: { camera: boolean; mic: boolean; updatedAt: number } = { camera: false, mic: false, updatedAt: 0 };
  private lastTccMicSignalAt = 0;
  private lastTccCameraSignalAt = 0;

  // Native module support
  private nativeModule: NativeModule | null = null;
  private nativeDetector: NativeDetector | null = null;
  private nativePollingInterval?: NodeJS.Timeout;
  private useNative: boolean = false;

  constructor(options: MeetingDetectorOptions = {}) {
    super();

    this.options = {
      scriptPath: '',
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
    if (this.nativePollingInterval) {
      throw new Error('Detector is already running');
    }

    if (callback) {
      this.on('meeting', callback);
    }

    if (!this.useNative || !this.nativeDetector) {
      throw new Error('Native detector not available — native module is required on all platforms');
    }

    this.startNativeDetection();
  }

  private handleIncomingSignal(signal: MeetingSignal): void {
    // Track TCC signal timestamps — these are the most reliable indicator that
    // a process has actively requested mic/camera access from macOS.
    const now = Date.now();
    this.lastTccMicSignalAt = now;
    if (signal.camera_active) {
      this.lastTccCameraSignalAt = now;
    }

    // Enrich with cached camera state (VDCAssistant proxy) and mark mic as
    // active since we just received a TCC signal for it.
    signal.mic_active = true;
    const cacheAgeMs = now - this.cachedMediaState.updatedAt;
    if (this.cachedMediaState.updatedAt > 0 && cacheAgeMs < 5000) {
      signal.camera_active = this.cachedMediaState.camera;
    }

    const stabilizedSignal = this.stabilizeSignalContext(signal);
    if (this.shouldIgnoreSignal(stabilizedSignal)) {
      this.logSignalDebug('Ignoring signal', stabilizedSignal);
      return;
    }

    const confidentSignal = this.resolveConfidence(stabilizedSignal);
    if (!confidentSignal) {
      this.logSignalDebug('Holding low-confidence signal', stabilizedSignal);
      return;
    }

    this.updateMeetingLifecycle(confidentSignal);

    if (this.isDuplicateSession(confidentSignal)) {
      this.logSignalDebug('Skipping duplicate session', confidentSignal);
      return;
    }

    const outputSignal = this.sanitizeSignalForOutput(confidentSignal);
    if (this.options.debug) {
      console.log('[MeetingDetector] Parsed signal:', outputSignal);
    }
    this.emit('meeting', outputSignal);
  }

  private startBrowserTabProbe(): void {
    if (this.browserProbeInterval) {
      clearInterval(this.browserProbeInterval);
    }

    void this.pollBrowserMeetingTabs();
    this.browserProbeInterval = setInterval(() => {
      void this.pollBrowserMeetingTabs();
    }, 2500);
    this.browserProbeInterval.unref?.();
  }

  private startNativeAppProbe(): void {
    if (this.nativeAppProbeInterval) {
      clearInterval(this.nativeAppProbeInterval);
    }

    void this.pollNativeAppMeetings();
    this.nativeAppProbeInterval = setInterval(() => {
      void this.pollNativeAppMeetings();
    }, 2500);
    this.nativeAppProbeInterval.unref?.();
  }

  private async pollBrowserMeetingTabs(): Promise<void> {
    if (this.browserProbeInFlight || !this.isRunning()) {
      return;
    }

    this.browserProbeInFlight = true;
    try {
      const tabs = await this.listBrowserTabs();
      this.refreshBrowserMeetingHints(tabs);

      // Synthesize a meeting signal when a browser meeting tab is open AND
      // a TCC mic signal was received recently (within 60s). We cannot use
      // CoreAudio HAL kAudioDevicePropertyDeviceIsRunningSomewhere because
      // machines with audio interfaces (Elgato WaveLink, Loopback, etc.)
      // have always-running input devices. TCC signals are the reliable
      // indicator that an app actually requested mic access from macOS.
      const hint = this.pickStrongestBrowserMeetingHint();
      if (hint) {
        const now = Date.now();
        const recentTccMic = now - this.lastTccMicSignalAt < 60000;
        const cameraActive = this.cachedMediaState.updatedAt > 0
          ? this.cachedMediaState.camera
          : false;

        if (recentTccMic && this.isRunning()) {
          const syntheticSignal: MeetingSignal = {
            event: 'meeting_signal',
            timestamp: new Date().toISOString().slice(0, 19) + 'Z',
            service: hint.platform,
            verdict: 'allowed',
            preflight: false,
            process: hint.browser,
            pid: '',
            parent_pid: '',
            process_path: '',
            front_app: hint.browser,
            window_title: hint.title,
            session_id: '',
            camera_active: cameraActive,
            mic_active: true,
            chrome_url: hint.url,
          };

          this.updateMeetingLifecycle(syntheticSignal);
          if (!this.isDuplicateSession(syntheticSignal)) {
            const outputSignal = this.sanitizeSignalForOutput(syntheticSignal);
            this.emit('meeting', outputSignal);
          }
        }
      }
    } catch (error) {
      if (this.options.debug) {
        console.log('[MeetingDetector] Browser probe error:', error);
      }
    } finally {
      this.browserProbeInFlight = false;
    }
  }

  private async pollNativeAppMeetings(): Promise<void> {
    if (this.nativeAppProbeInFlight || !this.isRunning()) {
      return;
    }

    this.nativeAppProbeInFlight = true;
    try {
      const signal = await this.detectActiveNativeMeetingSignal();
      if (!this.isRunning()) {
        return;
      }
      if (signal) {
        // Native probe signals bypass shouldIgnoreSignal() — the probe has already
        // validated that mic is active and a known meeting process is running.
        // Going through handleIncomingSignal() would trigger the idle-title filter
        // which blocks signals with empty/generic window titles from precheck-prone
        // services, but that filter is designed for TCC log signals, not probe results.
        this.updateMeetingLifecycle(signal);
        if (!this.isDuplicateSession(signal)) {
          const outputSignal = this.sanitizeSignalForOutput(signal);
          this.emit('meeting', outputSignal);
        }
      }
    } catch (error) {
      if (this.options.debug) {
        console.log('[MeetingDetector] Native app probe error:', error);
      }
    } finally {
      this.nativeAppProbeInFlight = false;
    }
  }

  private async listBrowserTabs(): Promise<BrowserTabInfo[]> {
    const runningApps = await this.listRunningApplicationNames();
    const scripts = getBrowserProbeTargets(runningApps);
    const tabs: BrowserTabInfo[] = [];
    for (const [browser, scriptLines] of scripts) {
      try {
        const { stdout } = await execFileAsync('osascript', scriptLines.flatMap(line => ['-e', line]), {
          timeout: 5000,
          maxBuffer: 1024 * 1024,
        });
        for (const row of stdout.split('\n')) {
          const trimmed = row.trim();
          if (!trimmed) {
            continue;
          }
          const [rowBrowser, title = '', url = ''] = trimmed.split('\t');
          if (!url) {
            continue;
          }
          tabs.push({
            browser: rowBrowser || browser,
            title,
            url,
          });
        }
      } catch {
        // Browser may not be installed, running, or scriptable in the current session.
      }
    }

    return tabs;
  }

  private refreshBrowserMeetingHints(tabs: BrowserTabInfo[]): void {
    const nextHints = new Map<string, BrowserMeetingHint[]>();
    const now = Date.now();

    for (const tab of tabs) {
      const platform = classifyBrowserMeetingTab(tab);
      if (!platform) {
        continue;
      }

      const browser = tab.browser.trim();
      const existing = nextHints.get(browser) || [];
      existing.push({
        browser,
        platform,
        title: tab.title,
        url: tab.url,
        seenAt: now,
      });
      nextHints.set(browser, existing);
    }

    this.browserMeetingHints = nextHints;
  }

  private pickStrongestBrowserMeetingHint(): BrowserMeetingHint | null {
    const now = Date.now();
    const fresh: BrowserMeetingHint[] = [];
    for (const hints of this.browserMeetingHints.values()) {
      for (const hint of hints) {
        if (now - hint.seenAt <= 10000) {
          fresh.push(hint);
        }
      }
    }
    if (fresh.length === 0) return null;
    if (fresh.length === 1) return fresh[0];

    // When multiple meeting tabs are open and there's an active meeting,
    // prefer the current platform to prevent ping-ponging between platforms.
    if (this.activeMeeting) {
      const sameAsActive = fresh.find((h) => h.platform === this.activeMeeting!.platform);
      if (sameAsActive) return sameAsActive;
    }

    // No active meeting or active platform not in hints — pick most recent
    fresh.sort((a, b) => b.seenAt - a.seenAt);
    return fresh[0];
  }

  private inferBrowserHost(signal: Pick<MeetingSignal, 'process' | 'front_app' | 'process_path'>): string | null {
    const haystacks = [signal.front_app, signal.process, signal.process_path]
      .map((value) => (value || '').toLowerCase())
      .filter(Boolean);

    if (haystacks.some((value) => value.includes('google chrome'))) {
      return 'Google Chrome';
    }
    if (haystacks.some((value) => value.includes('microsoft edge'))) {
      return 'Microsoft Edge';
    }
    if (haystacks.some((value) => value.includes('safari'))) {
      return 'Safari';
    }
    return null;
  }

  private getBrowserMeetingHint(
    signal: Pick<MeetingSignal, 'process' | 'front_app' | 'process_path'>
  ): BrowserMeetingHint | null {
    const browser = this.inferBrowserHost(signal);
    if (!browser) {
      return null;
    }

    const hints = (this.browserMeetingHints.get(browser) || []).filter(
      (hint) => Date.now() - hint.seenAt <= 10000
    );
    if (hints.length === 0) {
      return null;
    }

    const uniquePlatforms = new Set(hints.map((hint) => hint.platform));
    if (uniquePlatforms.size !== 1) {
      return null;
    }

    return hints[0] || null;
  }

  private hasAnyBrowserMeetingHints(): boolean {
    const now = Date.now();
    for (const hints of this.browserMeetingHints.values()) {
      if (hints.some((hint) => now - hint.seenAt <= 10000)) {
        return true;
      }
    }
    return false;
  }

  private async probeMediaState(): Promise<{ camera: boolean; mic: boolean }> {
    try {
      const mediaStatePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'media-state');
      const { stdout } = await execFileAsync(mediaStatePath, [], {
        timeout: 2000,
        maxBuffer: 256,
      });
      const parsed = JSON.parse(stdout.trim());
      const result = {
        camera: parsed.camera === true,
        mic: parsed.mic === true,
      };
      this.cachedMediaState = { ...result, updatedAt: Date.now() };
      return result;
    } catch {
      return { camera: false, mic: false };
    }
  }

  async probeCameraActiveState(): Promise<boolean> {
    const state = await this.probeMediaState();
    return state.camera;
  }

  async probeMicrophoneActiveState(): Promise<boolean> {
    const state = await this.probeMediaState();
    return state.mic;
  }

  private async probeFrontmostAppName(): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        'osascript',
        ['-e', 'tell application "System Events" to get name of first process whose frontmost is true'],
        { timeout: 1000 }
      );
      return stdout.trim();
    } catch {
      return '';
    }
  }

  private async probeFrontWindowTitle(): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        'osascript',
        ['-e', 'tell application "System Events" to get title of front window of first process whose frontmost is true'],
        { timeout: 1000 }
      );
      return stdout.trim();
    } catch {
      return '';
    }
  }

  private async findRunningMeetingProcesses(): Promise<Array<{ process: string; platform: MeetingPlatform }>> {
    try {
      const { stdout } = await execFileAsync(
        'ps',
        ['-axo', 'comm='],
        { timeout: 1000, maxBuffer: 512 * 1024 }
      );

      const commands = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      const found = new Map<MeetingPlatform, string>();

      for (const command of commands) {
        const basename = command.split('/').pop()?.toLowerCase() || '';
        if (!basename) continue;

        // Skip recorder processes
        if (MeetingDetector.RECORDER_PROCESSES.has(basename)) continue;

        const platform = classifyNativeProcessCommand(basename);
        if (platform) {
          if (!found.has(platform)) {
            found.set(platform, command.split('/').pop() || command);
          }
        }
      }

      return Array.from(found.entries()).map(([platform, process]) => ({ process, platform }));
    } catch {
      return [];
    }
  }

  private hasBrowserHintForPlatform(platform: MeetingPlatform): boolean {
    const now = Date.now();
    for (const hints of this.browserMeetingHints.values()) {
      if (hints.some((hint) => hint.platform === platform && now - hint.seenAt <= 10000)) {
        return true;
      }
    }
    return false;
  }

  private async detectActiveNativeMeetingSignal(): Promise<MeetingSignal | null> {
    const meetingProcesses = await this.findRunningMeetingProcesses();

    // Mic gate: require a TCC mic signal within the last 60s. We cannot use
    // CoreAudio HAL because machines with audio interfaces (Elgato WaveLink,
    // Loopback, etc.) have always-running input devices that create permanent
    // false positives. TCC signals are the reliable indicator.
    const now = Date.now();
    const micActive = now - this.lastTccMicSignalAt < 60000;
    const cameraActive = this.cachedMediaState.camera;

    if (!micActive) {
      return null;
    }

    if (meetingProcesses.length === 0) {
      return null;
    }

    const frontApp = await this.probeFrontmostAppName();
    const frontLower = frontApp.toLowerCase();

    // Suppress platforms that have a browser hint for the SAME platform (browser
    // detection handles those) and platforms that would conflict with an already-
    // active meeting on a different platform. An idle Teams process running while
    // a Meet call is active should NOT produce a Teams signal.
    const nativeCandidates = meetingProcesses.filter((mp) => {
      // Same-platform browser hint exists — let browser detection handle it
      if (this.hasBrowserHintForPlatform(mp.platform)) {
        return false;
      }
      // If there's an active meeting on a DIFFERENT platform, only allow this
      // candidate when frontmost app evidence indicates the user has actually
      // switched to that platform.
      if (this.activeMeeting && this.activeMeeting.platform !== mp.platform) {
        const processLower = mp.process.toLowerCase();
        const frontMatchesProcess =
          (frontLower && frontLower.includes(processLower)) ||
          (processLower && processLower.includes(frontLower));
        if (!frontMatchesProcess && !this.isFrontAppConsistentWithService(frontApp, mp.platform)) {
          return false;
        }
      }
      return true;
    });

    if (nativeCandidates.length === 0) {
      return null;
    }

    // Pick best candidate; use frontmost app as optional tiebreak
    let selected = nativeCandidates[0];
    if (nativeCandidates.length > 1) {
      const frontMatch = nativeCandidates.find(
        (c) => frontLower.includes(c.process.toLowerCase()) || c.process.toLowerCase().includes(frontLower)
      );
      if (frontMatch) {
        selected = frontMatch;
      }
    }

    const frontWindowTitle = this.isFrontAppConsistentWithService(frontApp, selected.platform)
      ? await this.probeFrontWindowTitle()
      : '';
    const inferredPlatform = classifyNativeMeeting({
      process: selected.process,
      windowTitle: frontWindowTitle,
      micActive,
      cameraActive,
    });
    if (!inferredPlatform) {
      return null;
    }

    return {
      event: 'meeting_signal',
      timestamp: new Date().toISOString().slice(0, 19) + 'Z',
      service: inferredPlatform,
      verdict: 'allowed',
      preflight: false,
      process: selected.process,
      pid: '',
      parent_pid: '',
      process_path: '',
      front_app: selected.platform,
      window_title: frontWindowTitle,
      session_id: '',
      camera_active: cameraActive,
      mic_active: micActive,
      chrome_url: undefined,
    };
  }

  private async listRunningApplicationNames(): Promise<string[] | null> {
    try {
      const { stdout } = await execFileAsync(
        'ps',
        ['-axo', 'comm='],
        {
          timeout: 1000,
          maxBuffer: 512 * 1024,
        }
      );

      const commands = stdout
        .split('\n')
        .map((line) => line.trim().toLowerCase())
        .filter(Boolean);

      return BROWSER_PROBE_SCRIPTS
        .map(([browser]) => browser)
        .filter((browser) => {
          const executable = `/macos/${browser.toLowerCase()}`;
          const bundleExecutable = `/${browser.toLowerCase()}.app/contents${executable}`;
          return commands.some((command) =>
            command.endsWith(executable) || command.includes(bundleExecutable)
          );
        });
    } catch {
      // Fall through to System Events if the process table probe fails.
    }

    try {
      const { stdout } = await execFileAsync(
        'osascript',
        [
          '-e',
          'set oldDelims to AppleScript\'s text item delimiters',
          '-e',
          'set AppleScript\'s text item delimiters to linefeed',
          '-e',
          'tell application "System Events" to set runningApps to name of every application process',
          '-e',
          'set outText to runningApps as text',
          '-e',
          'set AppleScript\'s text item delimiters to oldDelims',
          '-e',
          'return outText',
        ],
        {
          timeout: 1000,
          maxBuffer: 256 * 1024,
        }
      );

      return stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      return null;
    }
  }

  /**
   * Start native detection using Rust native module.
   * The native module handles TCC log streaming, signal generation,
   * and state machine processing on all supported platforms.
   */
  private startNativeDetection(): void {
    if (!this.nativeDetector) {
      throw new Error('Native detector not available');
    }

    if (this.options.debug) {
      console.log('[MeetingDetector] Starting native detection');
    }

    this.nativeDetector.start();

    if (process.platform === 'darwin') {
      this.startBrowserTabProbe();
      this.startNativeAppProbe();
    }

    // Probe for an already-active meeting so detectors that start mid-call emit immediately.
    if (this.options.startupProbe) {
      this.probeActiveMeetingAtStartup();
    }

    // Poll the native detector for signals
    this.nativePollingInterval = setInterval(() => {
      if (!this.nativeDetector) return;

      // Check for new signals from the native detector
      const signal = this.nativeDetector.detect();
      if (signal) {
        this.handleIncomingSignal(signal);

        // Also feed through native state machine for lifecycle events
        const events = this.nativeDetector.processSignal(signal);
        for (const event of events) {
          this.emitNativeLifecycleEvent(event);
        }
      }

      // Check for meeting end via timeout
      const endEvent = this.nativeDetector.checkMeetingEnd();
      if (endEvent) {
        this.emitNativeLifecycleEvent(endEvent);
      }
    }, 500);

    // Periodic session cleanup
    const cleanupInterval = setInterval(() => {
      this.nativeDetector?.cleanupSessions();
    }, 60000);
    cleanupInterval.unref?.();

    if (this.options.debug) {
      console.log('[MeetingDetector] Started monitoring');
    }
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
    if (this.nativePollingInterval) {
      clearInterval(this.nativePollingInterval);
      this.nativePollingInterval = undefined;
    }
    if (this.browserProbeInterval) {
      clearInterval(this.browserProbeInterval);
      this.browserProbeInterval = undefined;
    }
    if (this.nativeAppProbeInterval) {
      clearInterval(this.nativeAppProbeInterval);
      this.nativeAppProbeInterval = undefined;
    }
    if (this.nativeDetector) {
      const endEvent = this.nativeDetector.stop();
      if (endEvent) {
        this.emitNativeLifecycleEvent(endEvent);
      }
    }

    if (this.meetingEndTimer) {
      clearTimeout(this.meetingEndTimer);
      this.meetingEndTimer = undefined;
    }
    if (this.activeMeeting) {
      const endedTimeline = endSessionTimeline(this.activeMeeting.timeline);
      this.emitMeetingLifecycle(
        'meeting_ended',
        this.activeMeeting.platform,
        this.activeMeeting.confidence,
        'stop',
        this.activeMeeting.signal,
        undefined,
        endedTimeline
      );
    }
    this.activeMeeting = null;

    this.activeSessions.clear();
    this.pendingConfidence.clear();
    this.serviceContext.clear();
    this.browserMeetingHints.clear();

    if (this.options.debug) {
      console.log('[MeetingDetector] Stopped monitoring');
    }
  }

  /**
   * Check if the detector is currently running
   */
  public isRunning(): boolean {
    return !!this.nativePollingInterval || !!this.browserProbeInterval || !!this.nativeAppProbeInterval;
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
   * Feed a signal directly into the processing pipeline.
   * Normalizes the signal (service transform, boolean coercion, browser hints)
   * the same way parseSignal does. Used for testing without the native module.
   */
  public feedSignal(raw: Record<string, any>): void {
    this.handleIncomingSignal(this.normalizeSignal(raw));
  }

  /**
   * Start in manual/test mode — sets up browser and native app probes
   * and marks the detector as running, but does not require the native module.
   * Signals must be injected via feedSignal().
   */
  public startManual(): void {
    if (this.nativePollingInterval || this.browserProbeInterval || this.nativeAppProbeInterval) {
      throw new Error('Detector is already running');
    }

    // Use a no-op interval to mark the detector as running
    this.nativePollingInterval = setInterval(() => {}, 60000);
    this.nativePollingInterval.unref?.();

    if (process.platform === 'darwin') {
      this.startBrowserTabProbe();
      this.startNativeAppProbe();
    }

    if (this.options.startupProbe) {
      this.probeActiveMeetingAtStartup();
    }
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
      'coreaudiod',        // macOS system audio daemon — routes audio, not a meeting
      'core audio driver', // Virtual audio device drivers (e.g., MSTeamsAudioDevice.driver)
      'msteamsaudiodevice',// Teams virtual audio driver fires TCC even without active meeting
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
    const frontAppName = signal.front_app?.toLowerCase() || '';
    const processPath = signal.process_path?.toLowerCase() || '';
    const sessionId = signal.session_id?.toLowerCase() || '';
    const serviceName = signal.service?.toLowerCase() || '';
    const systemAudioHaystacks = [processName, frontAppName, processPath, sessionId].filter(Boolean);

    if (serviceName === 'unknown' && !this.options.emitUnknown) {
      return true;
    }

    // Filter system audio/daemon artifacts even when only front_app/session_id carries
    // the telltale marker (common for Core Audio Driver wrapper traffic).
    if (systemProcessPatterns.some((pattern) => systemAudioHaystacks.some((field) => field.includes(pattern)))) {
      return true;
    }

    // Recorder/screencast processes that use mic/camera but are not meetings
    if (MeetingDetector.RECORDER_PROCESSES.has(processName)) {
      return true;
    }

    // Block main browser processes — actual media signals come from Helper/Renderer
    // subprocesses (e.g., "Google Chrome Helper"). The main browser process makes TCC
    // requests for generic reasons (e.g., initial permission grant), not for active calls.
    // Must be exact-match to avoid blocking "Google Chrome Helper".
    const mainBrowserProcesses = new Set([
      'google chrome', 'safari', 'microsoft edge', 'firefox',
      'brave browser', 'arc', 'opera', 'vivaldi',
    ]);
    if (mainBrowserProcesses.has(processName)) {
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

    const genericWindowTitle = (signal.window_title || '').trim().toLowerCase();
    const nativeIdleTitleByPlatform =
      (serviceName === 'microsoft teams' && (genericWindowTitle === '' || genericWindowTitle === 'microsoft teams' || genericWindowTitle.startsWith('chat'))) ||
      (serviceName === 'zoom' && (genericWindowTitle === '' || genericWindowTitle === 'zoom' || genericWindowTitle === 'zoom workplace')) ||
      (serviceName === 'slack' && (genericWindowTitle === '' || !genericWindowTitle.includes('huddle')));

    if (
      MeetingDetector.PRECHECK_PRONE_SERVICES.has(serviceName) &&
      nativeIdleTitleByPlatform &&
      !signal.chrome_url
    ) {
      return true;
    }

    // For Google Meet (Chrome-based): validate title only when it is available.
    // When Chrome is backgrounded the title is empty — still allow the signal through
    // because the meeting is genuinely active (camera_active guard above already handles
    // the pre-check case).
    if (serviceName === 'google meet') {
      const windowTitle = signal.window_title?.trim() || '';
      const chromeUrl = (signal.chrome_url || '').trim().toLowerCase();
      const hasValidMeetUrl = /meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:[/?#]|$)/.test(chromeUrl);
      if (windowTitle !== '') {
        // Title present → require it to look like an actual meeting room
        const hasValidMeetTitle =
          windowTitle.includes('meet.google.com') ||
          windowTitle.includes('Meet - ') ||
          /[a-z]{3}-[a-z]{4}-[a-z]{3}/.test(windowTitle);
        if (!hasValidMeetTitle && !hasValidMeetUrl) {
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

  private logSignalDebug(message: string, signal: MeetingSignal): void {
    if (!this.options.debug) {
      return;
    }

    const key = [
      message,
      signal.service,
      signal.process,
      signal.pid,
      signal.parent_pid,
      signal.verdict,
      String(signal.preflight),
      signal.front_app,
      signal.window_title,
      signal.chrome_url || '',
    ].join('|');

    const now = Date.now();
    const lastLoggedAt = this.debugSignalLogTimes.get(key);
    if (lastLoggedAt && now - lastLoggedAt < MeetingDetector.DEBUG_SIGNAL_LOG_DEDUPE_MS) {
      return;
    }

    this.debugSignalLogTimes.set(key, now);
    console.log(`[MeetingDetector] ${message}:`, signal);
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
    previousPlatform?: MeetingPlatform,
    timeline?: SessionTimelineState
  ): void {
    const payload: MeetingLifecycleEvent = {
      event,
      timestamp: new Date().toISOString(),
      platform,
      confidence,
      reason,
      previous_platform: previousPlatform,
      session_id: timeline?.session_id,
      started_at: timeline?.started_at,
      ended_at: event === 'meeting_ended' ? timeline?.ended_at : undefined,
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
      const endedTimeline = endSessionTimeline(ended.timeline);
      this.activeMeeting = null;
      this.meetingEndTimer = undefined;
      this.emitMeetingLifecycle(
        'meeting_ended',
        ended.platform,
        ended.confidence,
        'timeout',
        ended.signal,
        undefined,
        endedTimeline
      );
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
      const timeline = createSessionTimeline(signal, now);
      this.activeMeeting = {
        platform,
        lastSeen: now,
        confidence,
        signal,
        timeline,
      };
      this.emitMeetingLifecycle('meeting_started', platform, confidence, 'signal', signal, undefined, timeline);
      this.scheduleMeetingEndCheck();
      return;
    }

    if (this.activeMeeting.platform !== platform) {
      const previousPlatform = this.activeMeeting.platform;
      const timeline = touchSessionTimeline(this.activeMeeting.timeline, now);
      this.activeMeeting = {
        platform,
        lastSeen: now,
        confidence,
        signal,
        timeline,
      };
      this.emitMeetingLifecycle('meeting_changed', platform, confidence, 'switch', signal, previousPlatform, timeline);
      this.scheduleMeetingEndCheck();
      return;
    }

    this.activeMeeting.lastSeen = now;
    this.activeMeeting.confidence = confidence;
    this.activeMeeting.signal = signal;
    this.activeMeeting.timeline = touchSessionTimeline(this.activeMeeting.timeline, now);
    this.scheduleMeetingEndCheck();
  }

  private getServiceKey(signal: MeetingSignal): string {
    return (signal.service || signal.front_app || signal.process || '').toLowerCase();
  }

  private isFrontAppConsistentWithService(frontApp: string, service: string): boolean {
    const f = (frontApp || '').toLowerCase();
    if (!f || !service) return false;

    return classifyPlatformFromNativeApp({ frontApp, windowTitle: '' }) === this.normalizePlatform(service);
  }

  private stabilizeSignalContext(signal: MeetingSignal): MeetingSignal {
    const key = this.getServiceKey(signal);
    const existing = this.serviceContext.get(key) || {};
    const next: MeetingSignal = { ...signal };

    const rawFront = (signal.front_app || '').trim();
    const rawTitle = (signal.window_title || '').trim();
    const frontConsistent = this.isFrontAppConsistentWithService(rawFront, signal.service);
    const browserTitleConsistent =
      !!signal.chrome_url &&
      !!rawTitle &&
      classifyBrowserMeeting(signal.chrome_url, rawTitle) === this.normalizePlatform(signal.service);

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

    if (rawTitle && (frontConsistent || browserTitleConsistent)) {
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

    const browserPlatform = classifyBrowserMeeting(url, signal.window_title || '');
    return browserPlatform === this.normalizePlatform(signal.service);
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
    return this.normalizeSignal(JSON.parse(line) as Record<string, any>);
  }

  private normalizeSignal(signal: Record<string, any>): MeetingSignal {
    const browserHint = this.getBrowserMeetingHint({
      process: signal.process || '',
      front_app: signal.front_app || '',
      process_path: signal.process_path || '',
    });
    const chromeUrl = signal.chrome_url || browserHint?.url || '';
    const windowTitle = signal.window_title || browserHint?.title || '';

    // Use transformed app name as service if the original service is a system service like 'microphone' or 'camera'
    const originalService = signal.service || '';
    const transformedService = this.transformAppName(signal.front_app, signal.process, windowTitle, chromeUrl);
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
      window_title: windowTitle,
      session_id: signal.session_id || '',
      camera_active: signal.camera_active === 'true' || signal.camera_active === true,
      chrome_url: chromeUrl
    };
  }

  private transformAppName(frontApp: string, process: string, windowTitle = '', chromeUrl = ''): MeetingPlatform {
    return classifyPlatformFromNativeApp({
      frontApp,
      process,
      windowTitle,
      chromeUrl,
    });
  }

  /**
   * Check at startup whether a supported meeting is already active.
   * Emits a synthetic meeting_started lifecycle event if found.
   * This handles the case where the detector starts while a call is already in progress.
   */
  private async probeActiveMeetingAtStartup(): Promise<void> {
    try {
      // Check whether the camera daemon is already running (indicates active camera use).
      await execFileAsync('sh', ['-c',
        'pgrep -xq VDCAssistant 2>/dev/null || pgrep -xq AppleCameraAssistant 2>/dev/null'
      ], { timeout: 2000 });
    } catch {
      return; // Camera not active — no meeting in progress.
    }

    if (!this.isRunning()) return;

    // Candidates in priority order. Run ALL checks independently so
    // every running app is discovered, then resolve ambiguity via front-app tiebreak.
    const candidates = NATIVE_STARTUP_PROBE_TARGETS.map(({ process, platform }) => [process, platform] as const);

    const procScript = candidates
      .map(([proc, label]) => `pgrep -xq "${proc}" 2>/dev/null && echo "${label}"; true`)
      .join('; ');
    const fullScript = `(${procScript}); echo "FRONTAPP=$(osascript -e 'tell application "System Events" to name of first application process whose frontmost is true' 2>/dev/null || echo '')"`;

    let output: string;
    try {
      const result = await execFileAsync('sh', ['-c', fullScript], { timeout: 5000 });
      output = result.stdout;
    } catch {
      return;
    }

    if (!this.isRunning()) return;

    const matched = candidates.filter(([, label]) => output.includes(label));
    if (matched.length === 0) return;

    let selected = matched[0];

    if (matched.length > 1) {
      const frontMatch = output.match(/FRONTAPP=(.+)/);
      const frontApp = (frontMatch?.[1] || '').trim().toLowerCase();
      const frontCandidate = matched.find(([proc]) =>
        proc.toLowerCase().includes(frontApp) || frontApp.includes(proc.toLowerCase())
      );
      if (frontCandidate) {
        selected = frontCandidate;
      }
      if (this.options.debug) {
        console.log(
          '[MeetingDetector] Startup probe: multiple apps found, front app resolution',
          { matched: matched.map(([, l]) => l), frontApp, selected: selected[1] }
        );
      }
    }

    const [procName, platform] = selected;
    const frontMatch = output.match(/FRONTAPP=(.+)/);
    const frontApp = (frontMatch?.[1] || '').trim();
    const frontWindowTitle = this.isFrontAppConsistentWithService(frontApp, platform)
      ? await this.probeFrontWindowTitle()
      : '';
    const inferredPlatform = this.shouldEmitStartupProbeMeeting(
      platform,
      procName,
      frontApp,
      frontWindowTitle
    );
    if (!inferredPlatform) {
      return;
    }

    const now = new Date().toISOString().slice(0, 19) + 'Z';
    const syntheticSignal: MeetingSignal = {
      event: 'meeting_signal',
      timestamp: now,
      service: inferredPlatform,
      verdict: 'allowed',
      preflight: false,
      process: procName,
      pid: '',
      parent_pid: '',
      process_path: '',
      front_app: frontApp || procName,
      window_title: frontWindowTitle,
      session_id: '',
      camera_active: true,
    };

    if (this.options.debug) {
      console.log('[MeetingDetector] Startup probe found active meeting:', platform);
    }

    this.updateMeetingLifecycle(syntheticSignal);
    const outputSignal = this.sanitizeSignalForOutput(syntheticSignal);
    this.emit('meeting', outputSignal);
  }

  private shouldEmitStartupProbeMeeting(
    platform: MeetingPlatform,
    processName: string,
    frontApp: string,
    frontWindowTitle: string
  ): MeetingPlatform | null {
    const normalized = this.normalizePlatform(platform);

    if (
      MeetingDetector.PRECHECK_PRONE_SERVICES.has(normalized.toLowerCase()) &&
      !this.isFrontAppConsistentWithService(frontApp, normalized)
    ) {
      return null;
    }

    return classifyNativeMeeting({
      process: processName,
      windowTitle: frontWindowTitle,
      micActive: true,
      cameraActive: true,
    });
  }
}

// Convenience function for simple usage
export function detector(callback: MeetingEventCallback, options?: MeetingDetectorOptions): MeetingDetector {
  const detector = new MeetingDetector(options);
  detector.start(callback);
  return detector;
}
