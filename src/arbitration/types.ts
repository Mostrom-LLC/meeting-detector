/**
 * Arbitration layer types.
 */

import type { MeetingPlatform, MeetingLifecycleEvent } from '../types.js';
import type { MeetingCandidate, ConfidenceLevel, DetectionSource } from '../engines/types.js';

/**
 * Active meeting state tracked by the arbitrator.
 */
export interface ActiveMeetingState {
  platform: MeetingPlatform;
  confidence: ConfidenceLevel;
  source: DetectionSource;
  lastSeen: number;
  startedAt: number;
}

/**
 * Arbitration state for debugging/inspection.
 */
export interface ArbitrationState {
  activeMeeting: ActiveMeetingState | null;
  preferredSource: DetectionSource | null;
  lastCandidateAt: number;
}

/**
 * Result of processing a candidate.
 */
export interface ArbitrationResult {
  suppressed: boolean;
  reason?: string;
  event?: MeetingLifecycleEvent;
}

/**
 * Callback for lifecycle events.
 */
export type LifecycleEventCallback = (event: MeetingLifecycleEvent) => void;

/**
 * Options for the arbitrator.
 */
export interface ArbitratorOptions {
  debug?: boolean;
  meetingEndTimeoutMs?: number;
  platformSwitchWindowMs?: number;
}
