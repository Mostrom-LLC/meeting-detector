/**
 * Native detector engine.
 * 
 * Responsible for detecting native desktop meeting applications:
 * - Microsoft Teams native
 * - Zoom native
 * - Slack native/huddles
 * - Discord
 * - FaceTime
 * - Cisco Webex native
 */

import { EventEmitter } from 'node:events';
import type { MeetingPlatform } from '../types.js';
import type {
  NativeMeetingCandidate,
  NativeEvidence,
  CandidateCallback,
  NativeEngineOptions,
  ConfidenceLevel,
} from './types.js';

/**
 * TCC signal input for testing/injection.
 */
export interface TccSignalInput {
  process: string;
  processPath?: string;
  windowTitle?: string;
  micActive: boolean;
  cameraActive: boolean;
  verdict?: 'requested' | 'allowed' | 'denied' | '';
  preflight?: boolean;
  timestamp?: number;
}

/**
 * Process patterns for native meeting app detection.
 */
const NATIVE_MEETING_PROCESSES: Array<[string[], MeetingPlatform]> = [
  [['msteams', 'microsoft teams'], 'Microsoft Teams'],
  [['slack'], 'Slack'],
  [['zoom.us', 'zoom'], 'Zoom'],
  [['webex', 'cisco webex'], 'Cisco Webex'],
  [['discord'], 'Discord'],
  [['facetime'], 'FaceTime'],
  [['skype'], 'Skype'],
  [['google meet'], 'Google Meet'],
];

/**
 * Recorder/screencast processes that should be suppressed.
 */
const RECORDER_PROCESSES = new Set([
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
  'quicktime player',
  'quicktime playerx',
]);

/**
 * Services prone to preflight checks that should be filtered without strong evidence.
 */
const PRECHECK_PRONE_SERVICES = new Set([
  'microsoft teams',
  'zoom',
  'cisco webex',
  'slack',
  'jitsi meet',
]);

/**
 * Native detector engine.
 */
export class NativeDetectorEngine extends EventEmitter {
  private options: Required<NativeEngineOptions>;
  private running = false;
  private callbacks: Set<CandidateCallback> = new Set();
  
  // TCC signal tracking
  private lastTccMicSignalAt = 0;
  private lastTccCameraSignalAt = 0;
  
  // Media state cache
  private cachedMediaState = {
    camera: false,
    mic: false,
    updatedAt: 0,
  };

  constructor(options: NativeEngineOptions = {}) {
    super();
    this.options = {
      debug: options.debug ?? false,
      emitUnknown: options.emitUnknown ?? false,
      includeSensitiveMetadata: options.includeSensitiveMetadata ?? false,
      pollingIntervalMs: options.pollingIntervalMs ?? 2500,
      tccSignalWindowMs: options.tccSignalWindowMs ?? 60000,
    };
  }

  /**
   * Start the native detection engine.
   */
  start(): void {
    if (this.running) {
      throw new Error('Engine is already running');
    }
    this.running = true;
  }

  /**
   * Stop the native detection engine.
   */
  stop(): void {
    this.running = false;
  }

  /**
   * Check if the engine is running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Register a callback for native meeting candidates.
   */
  onCandidate(callback: CandidateCallback): void {
    this.callbacks.add(callback);
  }

  /**
   * Remove a candidate callback.
   */
  offCandidate(callback: CandidateCallback): void {
    this.callbacks.delete(callback);
  }

  /**
   * Get the last TCC mic signal timestamp.
   */
  getLastTccMicSignalAt(): number {
    return this.lastTccMicSignalAt;
  }

  /**
   * Get the last TCC camera signal timestamp.
   */
  getLastTccCameraSignalAt(): number {
    return this.lastTccCameraSignalAt;
  }

  /**
   * Get the cached media state.
   */
  getCachedMediaState(): { camera: boolean; mic: boolean; updatedAt: number } {
    return { ...this.cachedMediaState };
  }

  /**
   * Set the cached media state (for testing).
   */
  setCachedMediaState(state: { camera: boolean; mic: boolean }): void {
    this.cachedMediaState = {
      ...state,
      updatedAt: Date.now(),
    };
  }

  /**
   * Inject a TCC signal (for testing or manual signal injection).
   */
  injectTccSignal(input: TccSignalInput): void {
    const now = Date.now();
    const timestamp = input.timestamp ?? now;

    // Track TCC signal timestamps
    if (input.micActive) {
      this.lastTccMicSignalAt = now;
    }
    if (input.cameraActive) {
      this.lastTccCameraSignalAt = now;
    }

    // Match platform from process name
    const platform = this.matchPlatform(input.process);
    if (platform === 'Unknown' && !this.options.emitUnknown) {
      if (this.options.debug) {
        console.log('[NativeEngine] Unknown platform, skipping:', input.process);
      }
      return;
    }

    // Check if this is a recorder process
    if (this.isRecorderProcess(input.process)) {
      if (this.options.debug) {
        console.log('[NativeEngine] Recorder process, suppressing:', input.process);
      }
      return;
    }

    // Filter low-confidence preflight signals
    if (!this.hasStrongEvidence(input, platform)) {
      if (this.options.debug) {
        console.log('[NativeEngine] Low confidence signal, filtering:', input);
      }
      return;
    }

    // Build evidence - always include windowTitle for internal logic
    const evidence: NativeEvidence = {
      processName: input.process,
      processPath: input.processPath,
      windowTitle: input.windowTitle,
      micActive: input.micActive,
      cameraActive: input.cameraActive,
      timestamp,
      tccSignal: true,
      verdict: input.verdict,
      preflight: input.preflight,
    };

    // Calculate confidence
    const confidence = this.calculateConfidence(input);

    // Build candidate
    const candidate: NativeMeetingCandidate = {
      platform,
      confidence,
      source: 'native',
      timestamp,
      evidence,
    };

    // Emit to all callbacks
    this.emitCandidate(candidate);
  }

  /**
   * Match a platform from process name.
   */
  private matchPlatform(processName: string): MeetingPlatform {
    const proc = (processName || '').toLowerCase();
    
    for (const [patterns, platform] of NATIVE_MEETING_PROCESSES) {
      if (patterns.some(p => proc.includes(p))) {
        return platform;
      }
    }
    
    return 'Unknown';
  }

  /**
   * Check if a process is a recorder/screencast app.
   */
  private isRecorderProcess(processName: string): boolean {
    const proc = (processName || '').toLowerCase();
    return RECORDER_PROCESSES.has(proc);
  }

  /**
   * Check if the signal has strong evidence of an active meeting.
   * 
   * Per lessons learned: mic being active (TCC signal) is the most reliable
   * indicator of an active meeting on macOS.
   */
  private hasStrongEvidence(input: TccSignalInput, platform: MeetingPlatform): boolean {
    // Strong verdict (allowed, not preflight) with mic active = strong evidence
    // This is the TCC "allowed" signal which means macOS granted mic access
    if (input.verdict === 'allowed' && !input.preflight && input.micActive) {
      return true;
    }

    // Mic active with non-generic title = strong evidence
    if (input.micActive && input.windowTitle && !this.isGenericIdleWindow(input, platform)) {
      return true;
    }

    // Camera active with non-generic title = medium evidence (might be preview)
    if (input.cameraActive && input.windowTitle && !this.isGenericIdleWindow(input, platform)) {
      return true;
    }

    // Preflight with empty/generic title = low confidence, filter out
    if (input.preflight && (!input.windowTitle || this.isGenericIdleWindow(input, platform))) {
      return false;
    }

    // Requested verdict without mic/camera = low confidence
    if (input.verdict === 'requested' && !input.micActive && !input.cameraActive) {
      return false;
    }

    // For precheck-prone services without mic, require non-generic window title
    const platformLower = platform.toLowerCase();
    if (PRECHECK_PRONE_SERVICES.has(platformLower)) {
      if (!input.micActive) {
        // Without mic, need non-generic window title
        if (!input.windowTitle || this.isGenericIdleWindow(input, platform)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Check if the window title indicates an idle/generic state.
   */
  private isGenericIdleWindow(input: TccSignalInput, platform: MeetingPlatform): boolean {
    const title = (input.windowTitle || '').toLowerCase().trim();
    
    if (!title) {
      return true;
    }

    switch (platform) {
      case 'Microsoft Teams':
        // Generic Teams titles
        if (title === 'microsoft teams') return true;
        if (title.startsWith('chat')) return true;
        break;
        
      case 'Zoom':
        // Generic Zoom titles
        if (title === 'zoom' || title === 'zoom workplace') return true;
        break;
        
      case 'Slack':
        // Slack needs "huddle" in title for meetings
        if (!title.includes('huddle')) return true;
        break;
        
      case 'Cisco Webex':
        // Generic Webex titles
        if (title === 'webex' || title === 'cisco webex') return true;
        break;
    }

    return false;
  }

  /**
   * Calculate confidence level for a signal.
   */
  private calculateConfidence(input: TccSignalInput): ConfidenceLevel {
    // High confidence: allowed verdict, not preflight, mic active
    if (input.verdict === 'allowed' && !input.preflight && input.micActive) {
      return 'high';
    }

    // High confidence: both mic and camera active
    if (input.micActive && input.cameraActive) {
      return 'high';
    }

    // Medium confidence: mic active or camera active with window title
    if (input.micActive || (input.cameraActive && input.windowTitle)) {
      return 'medium';
    }

    // Low confidence: everything else
    return 'low';
  }

  /**
   * Emit a candidate to all registered callbacks.
   */
  private emitCandidate(candidate: NativeMeetingCandidate): void {
    for (const callback of this.callbacks) {
      try {
        callback(candidate);
      } catch (error) {
        if (this.options.debug) {
          console.error('[NativeEngine] Callback error:', error);
        }
      }
    }
  }
}
