/**
 * Native module bridge.
 * 
 * This module provides a bridge to the Rust native core when available,
 * with fallback to the shell script implementation on macOS.
 */

import type { MeetingSignal, MeetingLifecycleEvent, MeetingPlatform } from './types.js';

/**
 * Native detector interface matching the Rust exports.
 */
export interface NativeDetector {
  start(): void;
  stop(): MeetingLifecycleEvent | null;
  isRunning(): boolean;
  platformName(): string;
  isSupported(): boolean;
  processSignal(signal: MeetingSignal): MeetingLifecycleEvent[];
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
    
    // Attempt to load the native module
    // napi-rs generates platform-specific binaries
    const binding = require(`../native/meeting-detector-native.${platform}-${arch}.node`);
    return binding as NativeModule;
  } catch (e1) {
    try {
      // Fallback to generic path
      const binding = require('../native/index.js');
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
