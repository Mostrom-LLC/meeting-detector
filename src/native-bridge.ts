/**
 * Native module bridge.
 * 
 * This module provides a bridge to the Rust native core when available,
 * with fallback to the shell script implementation on macOS.
 */

import { createRequire } from 'node:module';
import type { MeetingSignal, MeetingLifecycleEvent, MeetingPlatform } from './types.js';

// The compiled output is ESM (`"module": "ES2020"`), so bare `require()`
// is not defined. createRequire bridges CJS-style require for the napi
// .node binary lookup below.
const requireFromHere = createRequire(import.meta.url);

/**
 * Native detector interface matching the Rust exports.
 */
export interface NativeDetector {
  start(): void;
  stop(): MeetingLifecycleEvent | null;
  detect(): MeetingSignal | null;
  isRunning(): boolean;
  platformName(): string;
  isSupported(): boolean;
  /**
   * @deprecated Internal use only — do NOT call from JS. The JS pipeline
   * (handleIncomingSignal → updateMeetingLifecycle → emitMeetingLifecycle)
   * owns lifecycle. Feeding a JS-normalized snake_case signal here causes
   * a `Missing field "parentPid"` napi crash because napi-rs auto-renames
   * Rust struct fields to camelCase. Will be removed in the next major.
   */
  processSignal(signal: MeetingSignal): MeetingLifecycleEvent[];
  /** @deprecated Internal use only — see `processSignal` above. */
  checkMeetingEnd(): MeetingLifecycleEvent | null;
  cleanupSessions(): void;
}

/**
 * Native module exports.
 */
export interface NativeModule {
  NativeMeetingDetector: new (options?: NativeDetectorOptions) => NativeDetector;
  matchPlatform(
    processName: string,
    windowTitle: string,
    url?: string,
    cameraActive?: boolean
  ): string;
  version(): string;
  supportedPlatforms(): string[];
}

/**
 * Options for the native detector.
 */
export interface NativeDetectorOptions {
  debug?: boolean;
  sessionDeduplicationMs?: number;
  meetingEndTimeoutMs?: number;
  emitUnknown?: boolean;
  includeSensitiveMetadata?: boolean;
  includeRawSignalInLifecycle?: boolean;
  startupProbe?: boolean;
}

/**
 * Try to load the native module.
 * Returns null if not available.
 */
export function tryLoadNative(): NativeModule | null {
  try {
    // Try platform-specific binary first
    const platform = process.platform;
    const arch = process.arch;
    
    // Attempt to load the native module.
    // napi-rs generates platform-specific binaries.
    const binding = requireFromHere(`../native/meeting-detector-native.${platform}-${arch}.node`);
    return binding as NativeModule;
  } catch (e1) {
    try {
      // Fallback to the napi-generated index shim, which dispatches to the
      // right platform binary at runtime.
      const binding = requireFromHere('../native/index.js');
      return binding as NativeModule;
    } catch (e2) {
      // Native module not available
      return null;
    }
  }
}

/**
 * Check if native module is available.
 */
export function isNativeAvailable(): boolean {
  return tryLoadNative() !== null;
}

/**
 * Get the native module version, or null if not available.
 */
export function getNativeVersion(): string | null {
  const native = tryLoadNative();
  return native ? native.version() : null;
}

/**
 * Check if current platform is supported by native detection.
 */
export function isNativePlatformSupported(): boolean {
  const native = tryLoadNative();
  if (!native) return false;
  
  try {
    const detector = new native.NativeMeetingDetector();
    return detector.isSupported();
  } catch {
    return false;
  }
}
