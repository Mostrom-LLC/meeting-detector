/**
 * Meeting arbitrator.
 * 
 * Receives candidates from native and web engines, applies precedence rules,
 * and emits lifecycle events (meeting_started, meeting_changed, meeting_ended).
 */

import type { MeetingPlatform, MeetingLifecycleEvent } from '../types.js';
import type { MeetingCandidate, ConfidenceLevel, DetectionSource } from '../engines/types.js';
import type {
  ActiveMeetingState,
  ArbitrationState,
  ArbitrationResult,
  LifecycleEventCallback,
  ArbitratorOptions,
} from './types.js';

/**
 * Confidence level numeric values for comparison.
 */
const CONFIDENCE_VALUES: Record<ConfidenceLevel, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Meeting arbitrator.
 */
export class MeetingArbitrator {
  private options: Required<ArbitratorOptions>;
  private callbacks: Set<LifecycleEventCallback> = new Set();
  
  // Active meeting state
  private activeMeeting: ActiveMeetingState | null = null;
  private preferredSource: DetectionSource | null = null;
  private lastCandidateAt = 0;

  constructor(options: ArbitratorOptions = {}) {
    this.options = {
      debug: options.debug ?? false,
      meetingEndTimeoutMs: options.meetingEndTimeoutMs ?? 30000,
      platformSwitchWindowMs: options.platformSwitchWindowMs ?? 5000,
    };
  }

  /**
   * Register a callback for lifecycle events.
   */
  onLifecycleEvent(callback: LifecycleEventCallback): void {
    this.callbacks.add(callback);
  }

  /**
   * Remove a lifecycle event callback.
   */
  offLifecycleEvent(callback: LifecycleEventCallback): void {
    this.callbacks.delete(callback);
  }

  /**
   * Get the current arbitration state.
   */
  getState(): ArbitrationState {
    return {
      activeMeeting: this.activeMeeting ? { ...this.activeMeeting } : null,
      preferredSource: this.preferredSource,
      lastCandidateAt: this.lastCandidateAt,
    };
  }

  /**
   * Process a meeting candidate.
   */
  processCandidate(candidate: MeetingCandidate): ArbitrationResult {
    const now = Date.now();
    this.lastCandidateAt = now;

    // No active meeting - start one
    if (!this.activeMeeting) {
      return this.startMeeting(candidate);
    }

    // Same platform - refresh or update
    if (this.activeMeeting.platform === candidate.platform) {
      return this.refreshMeeting(candidate);
    }

    // Different platform - check if we should switch
    return this.handlePlatformConflict(candidate);
  }

  /**
   * Check if meeting should end due to timeout.
   */
  checkMeetingEnd(): MeetingLifecycleEvent | null {
    if (!this.activeMeeting) {
      return null;
    }

    const now = Date.now();
    const idleMs = now - this.activeMeeting.lastSeen;

    if (idleMs >= this.options.meetingEndTimeoutMs) {
      return this.endMeeting('timeout');
    }

    return null;
  }

  /**
   * Stop the arbitrator and end any active meeting.
   */
  stop(): MeetingLifecycleEvent | null {
    if (!this.activeMeeting) {
      return null;
    }

    return this.endMeeting('stop');
  }

  /**
   * Reset the arbitrator state.
   */
  reset(): void {
    this.activeMeeting = null;
    this.preferredSource = null;
    this.lastCandidateAt = 0;
  }

  /**
   * Start a new meeting.
   */
  private startMeeting(candidate: MeetingCandidate): ArbitrationResult {
    const now = Date.now();
    
    this.activeMeeting = {
      platform: candidate.platform,
      confidence: candidate.confidence,
      source: candidate.source,
      lastSeen: now,
      startedAt: now,
    };
    this.preferredSource = candidate.source;

    const event: MeetingLifecycleEvent = {
      event: 'meeting_started',
      timestamp: new Date(now).toISOString(),
      platform: candidate.platform,
      confidence: candidate.confidence,
      reason: 'signal',
    };

    this.emitEvent(event);

    return {
      suppressed: false,
      event,
    };
  }

  /**
   * Refresh an existing meeting with a new signal.
   */
  private refreshMeeting(candidate: MeetingCandidate): ArbitrationResult {
    if (!this.activeMeeting) {
      return { suppressed: true, reason: 'no_active_meeting' };
    }

    // Check suppression for same-platform candidates
    // Web with lower confidence when native is preferred = suppress
    if (
      candidate.source === 'web' &&
      this.preferredSource === 'native' &&
      CONFIDENCE_VALUES[candidate.confidence] < CONFIDENCE_VALUES[this.activeMeeting.confidence]
    ) {
      return {
        suppressed: true,
        reason: 'native_higher_confidence',
      };
    }

    const now = Date.now();
    this.activeMeeting.lastSeen = now;

    // Update preferred source BEFORE updating confidence
    // so we can compare against the original confidence
    this.updatePreferredSource(candidate);

    // Update confidence if higher
    if (CONFIDENCE_VALUES[candidate.confidence] > CONFIDENCE_VALUES[this.activeMeeting.confidence]) {
      this.activeMeeting.confidence = candidate.confidence;
    }

    // Same platform refresh doesn't emit an event
    return {
      suppressed: false,
    };
  }

  /**
   * Handle a candidate for a different platform.
   */
  private handlePlatformConflict(candidate: MeetingCandidate): ArbitrationResult {
    if (!this.activeMeeting) {
      return { suppressed: true, reason: 'no_active_meeting' };
    }

    const now = Date.now();
    const timeSinceStart = now - this.activeMeeting.startedAt;
    const timeSinceLastSeen = now - this.activeMeeting.lastSeen;

    // Check suppression rules first
    const suppressionCheck = this.checkSuppression(candidate);
    if (suppressionCheck.suppressed) {
      return suppressionCheck;
    }

    // Time-based precedence: newer candidate wins if >5s apart
    if (timeSinceLastSeen > this.options.platformSwitchWindowMs) {
      return this.switchPlatform(candidate);
    }

    // Confidence-based precedence within the window
    const currentConfidence = CONFIDENCE_VALUES[this.activeMeeting.confidence];
    const candidateConfidence = CONFIDENCE_VALUES[candidate.confidence];

    if (candidateConfidence > currentConfidence) {
      return this.switchPlatform(candidate);
    }

    // Equal confidence with mic active - different platforms can coexist
    // For now, newer high-confidence candidate with mic can trigger a switch
    if (candidateConfidence === currentConfidence && candidate.evidence.micActive) {
      // Native with mic is stronger than web with mic
      if (candidate.source === 'native') {
        return this.switchPlatform(candidate);
      }
      // Web with mic vs native: allow the switch if both are high confidence
      // This supports multi-meeting scenarios per Kaise's recommendation
      if (candidateConfidence >= CONFIDENCE_VALUES['high']) {
        return this.switchPlatform(candidate);
      }
    }

    // Don't switch - keep current meeting
    return {
      suppressed: true,
      reason: 'current_meeting_preferred',
    };
  }

  /**
   * Check if a candidate should be suppressed.
   */
  private checkSuppression(candidate: MeetingCandidate): ArbitrationResult {
    if (!this.activeMeeting) {
      return { suppressed: false };
    }

    // Same platform, lower confidence from web when native is active
    if (
      candidate.platform === this.activeMeeting.platform &&
      candidate.source === 'web' &&
      this.preferredSource === 'native' &&
      CONFIDENCE_VALUES[candidate.confidence] < CONFIDENCE_VALUES[this.activeMeeting.confidence]
    ) {
      return {
        suppressed: true,
        reason: 'native_higher_confidence',
      };
    }

    // Low confidence candidate for different platform while high confidence meeting active
    if (
      candidate.platform !== this.activeMeeting.platform &&
      candidate.confidence === 'low' &&
      this.activeMeeting.confidence === 'high'
    ) {
      return {
        suppressed: true,
        reason: 'low_confidence_vs_high',
      };
    }

    // No mic activity = likely idle/preflight
    if (!candidate.evidence.micActive && !candidate.evidence.cameraActive) {
      return {
        suppressed: true,
        reason: 'no_media_activity',
      };
    }

    return { suppressed: false };
  }

  /**
   * Switch to a new platform.
   */
  private switchPlatform(candidate: MeetingCandidate): ArbitrationResult {
    if (!this.activeMeeting) {
      return this.startMeeting(candidate);
    }

    const now = Date.now();
    const previousPlatform = this.activeMeeting.platform;

    this.activeMeeting = {
      platform: candidate.platform,
      confidence: candidate.confidence,
      source: candidate.source,
      lastSeen: now,
      startedAt: now,
    };
    this.preferredSource = candidate.source;

    const event: MeetingLifecycleEvent = {
      event: 'meeting_changed',
      timestamp: new Date(now).toISOString(),
      platform: candidate.platform,
      previous_platform: previousPlatform,
      confidence: candidate.confidence,
      reason: 'switch',
    };

    this.emitEvent(event);

    return {
      suppressed: false,
      event,
    };
  }

  /**
   * End the active meeting.
   */
  private endMeeting(reason: 'timeout' | 'stop' | 'signal'): MeetingLifecycleEvent | null {
    if (!this.activeMeeting) {
      return null;
    }

    const event: MeetingLifecycleEvent = {
      event: 'meeting_ended',
      timestamp: new Date().toISOString(),
      platform: this.activeMeeting.platform,
      confidence: this.activeMeeting.confidence,
      reason,
    };

    this.activeMeeting = null;
    this.preferredSource = null;

    this.emitEvent(event);

    return event;
  }

  /**
   * Update preferred source based on candidate quality.
   */
  private updatePreferredSource(candidate: MeetingCandidate): void {
    if (!this.activeMeeting) {
      return;
    }

    const candidateConfidence = CONFIDENCE_VALUES[candidate.confidence];
    const activeConfidence = CONFIDENCE_VALUES[this.activeMeeting.confidence];

    // Higher confidence always updates preference
    if (candidateConfidence > activeConfidence) {
      this.preferredSource = candidate.source;
      this.activeMeeting.source = candidate.source;
      return;
    }

    // Equal confidence: native with TCC signal is preferred
    if (candidateConfidence === activeConfidence) {
      if (candidate.source === 'native' && 'tccSignal' in candidate.evidence && candidate.evidence.tccSignal) {
        this.preferredSource = 'native';
        this.activeMeeting.source = 'native';
      }
    }
  }

  /**
   * Emit an event to all callbacks.
   */
  private emitEvent(event: MeetingLifecycleEvent): void {
    for (const callback of this.callbacks) {
      try {
        callback(event);
      } catch (error) {
        if (this.options.debug) {
          console.error('[Arbitrator] Callback error:', error);
        }
      }
    }
  }
}
