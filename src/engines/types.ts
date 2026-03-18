/**
 * Engine types for native and web meeting detection.
 * 
 * These types define the contract between detector engines and the arbitration layer.
 */

import type { MeetingPlatform } from '../types.js';

/**
 * Confidence level for meeting detection.
 * - high: Strong evidence (TCC allowed, valid meeting URL, etc.)
 * - medium: Moderate evidence (window title matches, camera active)
 * - low: Weak evidence (process running, preflight request)
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

/**
 * Source of the meeting detection signal.
 */
export type DetectionSource = 'native' | 'web';

/**
 * Base evidence interface shared by all detection sources.
 */
export interface BaseEvidence {
  micActive: boolean;
  cameraActive: boolean;
  timestamp: number;
}

/**
 * Evidence collected from native process detection.
 */
export interface NativeEvidence extends BaseEvidence {
  processName: string;
  processPath?: string;
  windowTitle?: string;
  pid?: string;
  parentPid?: string;
  tccSignal?: boolean;
  verdict?: 'requested' | 'allowed' | 'denied' | '';
  preflight?: boolean;
}

/**
 * Evidence collected from browser/web detection.
 */
export interface WebEvidence extends BaseEvidence {
  browser: string;
  tabUrl: string;
  tabTitle: string;
}

/**
 * Base meeting candidate interface.
 */
export interface MeetingCandidate {
  platform: MeetingPlatform;
  confidence: ConfidenceLevel;
  source: DetectionSource;
  timestamp: number;
  evidence: BaseEvidence;
}

/**
 * Meeting candidate from native detection.
 */
export interface NativeMeetingCandidate extends MeetingCandidate {
  source: 'native';
  evidence: NativeEvidence;
}

/**
 * Meeting candidate from web/browser detection.
 */
export interface WebMeetingCandidate extends MeetingCandidate {
  source: 'web';
  evidence: WebEvidence;
}

/**
 * Callback for receiving meeting candidates from an engine.
 */
export type CandidateCallback = (candidate: MeetingCandidate) => void;

/**
 * Configuration options shared by detector engines.
 */
export interface EngineOptions {
  debug?: boolean;
  emitUnknown?: boolean;
  includeSensitiveMetadata?: boolean;
}

/**
 * Interface for a detector engine.
 */
export interface DetectorEngine {
  /**
   * Start the detection engine.
   */
  start(): void;
  
  /**
   * Stop the detection engine.
   */
  stop(): void;
  
  /**
   * Check if the engine is currently running.
   */
  isRunning(): boolean;
  
  /**
   * Register a callback for meeting candidates.
   */
  onCandidate(callback: CandidateCallback): void;
  
  /**
   * Remove a candidate callback.
   */
  offCandidate(callback: CandidateCallback): void;
}

/**
 * Options specific to the native detector engine.
 */
export interface NativeEngineOptions extends EngineOptions {
  /**
   * Polling interval for native app detection (ms).
   * @default 2500
   */
  pollingIntervalMs?: number;
  
  /**
   * Time window for TCC signal validity (ms).
   * @default 60000
   */
  tccSignalWindowMs?: number;
}

/**
 * Options specific to the web detector engine.
 */
export interface WebEngineOptions extends EngineOptions {
  /**
   * Polling interval for browser tab detection (ms).
   * @default 2500
   */
  pollingIntervalMs?: number;
  
  /**
   * Time window for browser hint validity (ms).
   * @default 10000
   */
  browserHintWindowMs?: number;
}
