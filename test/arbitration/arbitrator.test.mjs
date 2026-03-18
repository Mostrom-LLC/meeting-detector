/**
 * Arbitration layer tests.
 * 
 * Tests for meeting candidate arbitration including:
 * - Native vs web precedence
 * - Cross-platform conflict resolution
 * - Stale candidate cleanup
 * - Lifecycle event emission
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

describe('MeetingArbitrator', () => {
  describe('same-platform precedence', () => {
    test('prefers native over web when native has higher confidence', async () => {
      const { MeetingArbitrator } = await import('../../dist/arbitration/arbitrator.js');
      
      const arbitrator = new MeetingArbitrator({ debug: false });
      const events = [];
      
      arbitrator.onLifecycleEvent((event) => events.push(event));
      
      const now = Date.now();
      
      // First, web candidate arrives
      arbitrator.processCandidate({
        platform: 'Microsoft Teams',
        confidence: 'medium',
        source: 'web',
        timestamp: now,
        evidence: {
          browser: 'Google Chrome',
          tabUrl: 'https://teams.live.com/v2/',
          tabTitle: 'Meet | Meeting with John | Microsoft Teams',
          micActive: true,
          cameraActive: false,
          timestamp: now,
        },
      });
      
      assert.equal(events.length, 1);
      assert.equal(events[0].event, 'meeting_started');
      assert.equal(events[0].platform, 'Microsoft Teams');
      
      // Native candidate arrives with higher confidence
      arbitrator.processCandidate({
        platform: 'Microsoft Teams',
        confidence: 'high',
        source: 'native',
        timestamp: now + 1000,
        evidence: {
          processName: 'Microsoft Teams',
          micActive: true,
          cameraActive: true,
          timestamp: now + 1000,
          tccSignal: true,
          verdict: 'allowed',
          preflight: false,
        },
      });
      
      // Should not emit meeting_changed for same platform, just update confidence
      assert.equal(events.length, 1);
      
      // But internal state should prefer native
      const state = arbitrator.getState();
      assert.equal(state.preferredSource, 'native');
    });

    test('prefers web when it has valid meeting URL and native is generic', async () => {
      const { MeetingArbitrator } = await import('../../dist/arbitration/arbitrator.js');
      
      const arbitrator = new MeetingArbitrator({ debug: false });
      const now = Date.now();
      
      // Native with generic evidence
      const nativeResult = arbitrator.processCandidate({
        platform: 'Google Meet',
        confidence: 'low',
        source: 'native',
        timestamp: now,
        evidence: {
          processName: 'Google Chrome Helper',
          micActive: true,
          cameraActive: false,
          timestamp: now,
        },
      });
      
      // Web with strong URL evidence
      const webResult = arbitrator.processCandidate({
        platform: 'Google Meet',
        confidence: 'high',
        source: 'web',
        timestamp: now + 100,
        evidence: {
          browser: 'Google Chrome',
          tabUrl: 'https://meet.google.com/abc-defg-hij',
          tabTitle: 'Meeting',
          micActive: true,
          cameraActive: true,
          timestamp: now + 100,
        },
      });
      
      const state = arbitrator.getState();
      assert.equal(state.preferredSource, 'web');
    });
  });

  describe('cross-platform conflict resolution', () => {
    test('newer candidate wins when >5s apart', async () => {
      const { MeetingArbitrator } = await import('../../dist/arbitration/arbitrator.js');
      
      const arbitrator = new MeetingArbitrator({ debug: false });
      const events = [];
      
      arbitrator.onLifecycleEvent((event) => events.push(event));
      
      const now = Date.now();
      
      // Teams meeting starts
      arbitrator.processCandidate({
        platform: 'Microsoft Teams',
        confidence: 'high',
        source: 'native',
        timestamp: now,
        evidence: {
          processName: 'Microsoft Teams',
          micActive: true,
          cameraActive: false,
          timestamp: now,
        },
      });
      
      assert.equal(events.length, 1);
      assert.equal(events[0].event, 'meeting_started');
      assert.equal(events[0].platform, 'Microsoft Teams');
      
      // 6 seconds later, Zoom meeting starts
      arbitrator.processCandidate({
        platform: 'Zoom',
        confidence: 'high',
        source: 'native',
        timestamp: now + 6000,
        evidence: {
          processName: 'zoom.us',
          micActive: true,
          cameraActive: true,
          timestamp: now + 6000,
        },
      });
      
      // Should emit meeting_changed
      assert.equal(events.length, 2);
      assert.equal(events[1].event, 'meeting_changed');
      assert.equal(events[1].platform, 'Zoom');
      assert.equal(events[1].previous_platform, 'Microsoft Teams');
    });

    test('higher confidence wins when within 5s', async () => {
      const { MeetingArbitrator } = await import('../../dist/arbitration/arbitrator.js');
      
      const arbitrator = new MeetingArbitrator({ debug: false });
      const events = [];
      
      arbitrator.onLifecycleEvent((event) => events.push(event));
      
      const now = Date.now();
      
      // Low confidence Teams signal
      arbitrator.processCandidate({
        platform: 'Microsoft Teams',
        confidence: 'low',
        source: 'native',
        timestamp: now,
        evidence: {
          processName: 'Microsoft Teams',
          micActive: false,
          cameraActive: false,
          timestamp: now,
        },
      });
      
      // 2 seconds later, high confidence Zoom
      arbitrator.processCandidate({
        platform: 'Zoom',
        confidence: 'high',
        source: 'native',
        timestamp: now + 2000,
        evidence: {
          processName: 'zoom.us',
          micActive: true,
          cameraActive: true,
          timestamp: now + 2000,
        },
      });
      
      // Higher confidence should win
      const state = arbitrator.getState();
      assert.equal(state.activeMeeting?.platform, 'Zoom');
    });

    test('native wins ties when mic is active', async () => {
      const { MeetingArbitrator } = await import('../../dist/arbitration/arbitrator.js');
      
      const arbitrator = new MeetingArbitrator({ debug: false });
      const now = Date.now();
      
      // Web and native arrive nearly simultaneously with same confidence
      arbitrator.processCandidate({
        platform: 'Zoom',
        confidence: 'high',
        source: 'web',
        timestamp: now,
        evidence: {
          browser: 'Google Chrome',
          tabUrl: 'https://zoom.us/wc/123/join',
          tabTitle: 'Zoom Meeting',
          micActive: true,
          cameraActive: false,
          timestamp: now,
        },
      });
      
      arbitrator.processCandidate({
        platform: 'Microsoft Teams',
        confidence: 'high',
        source: 'native',
        timestamp: now + 100, // 100ms later
        evidence: {
          processName: 'Microsoft Teams',
          micActive: true,
          cameraActive: true,
          timestamp: now + 100,
        },
      });
      
      // Native with mic active should be preferred
      const state = arbitrator.getState();
      assert.equal(state.preferredSource, 'native');
    });
  });

  describe('stale candidate invalidation', () => {
    test('invalidates candidate after meetingEndTimeoutMs', async () => {
      const { MeetingArbitrator } = await import('../../dist/arbitration/arbitrator.js');
      
      const arbitrator = new MeetingArbitrator({ 
        debug: false,
        meetingEndTimeoutMs: 100, // Short timeout for testing
      });
      const events = [];
      
      arbitrator.onLifecycleEvent((event) => events.push(event));
      
      const now = Date.now();
      
      // Meeting starts
      arbitrator.processCandidate({
        platform: 'Zoom',
        confidence: 'high',
        source: 'native',
        timestamp: now,
        evidence: {
          processName: 'zoom.us',
          micActive: true,
          cameraActive: false,
          timestamp: now,
        },
      });
      
      assert.equal(events.length, 1);
      assert.equal(events[0].event, 'meeting_started');
      
      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Check for meeting end
      const endEvent = arbitrator.checkMeetingEnd();
      assert.ok(endEvent);
      assert.equal(endEvent.event, 'meeting_ended');
      assert.equal(endEvent.reason, 'timeout');
    });

    test('refreshes meeting when same platform candidate arrives', async () => {
      const { MeetingArbitrator } = await import('../../dist/arbitration/arbitrator.js');
      
      const arbitrator = new MeetingArbitrator({ 
        debug: false,
        meetingEndTimeoutMs: 200,
      });
      const events = [];
      
      arbitrator.onLifecycleEvent((event) => events.push(event));
      
      const now = Date.now();
      
      // Meeting starts
      arbitrator.processCandidate({
        platform: 'Zoom',
        confidence: 'high',
        source: 'native',
        timestamp: now,
        evidence: {
          processName: 'zoom.us',
          micActive: true,
          cameraActive: false,
          timestamp: now,
        },
      });
      
      // Wait 100ms (half the timeout)
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Refresh with new signal
      arbitrator.processCandidate({
        platform: 'Zoom',
        confidence: 'high',
        source: 'native',
        timestamp: Date.now(),
        evidence: {
          processName: 'zoom.us',
          micActive: true,
          cameraActive: false,
          timestamp: Date.now(),
        },
      });
      
      // Wait another 150ms (past original timeout)
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Should not have ended because it was refreshed
      const endEvent = arbitrator.checkMeetingEnd();
      assert.equal(endEvent, null);
    });
  });

  describe('suppression rules', () => {
    test('suppresses web candidate when native has same platform with higher confidence', async () => {
      const { MeetingArbitrator } = await import('../../dist/arbitration/arbitrator.js');
      
      const arbitrator = new MeetingArbitrator({ debug: false });
      const now = Date.now();
      
      // Native Teams with high confidence
      arbitrator.processCandidate({
        platform: 'Microsoft Teams',
        confidence: 'high',
        source: 'native',
        timestamp: now,
        evidence: {
          processName: 'Microsoft Teams',
          micActive: true,
          cameraActive: true,
          timestamp: now,
          tccSignal: true,
        },
      });
      
      // Web Teams with lower confidence
      const result = arbitrator.processCandidate({
        platform: 'Microsoft Teams',
        confidence: 'medium',
        source: 'web',
        timestamp: now + 100,
        evidence: {
          browser: 'Google Chrome',
          tabUrl: 'https://teams.live.com/v2/',
          tabTitle: 'Meet | Microsoft Teams',
          micActive: true,
          cameraActive: false,
          timestamp: now + 100,
        },
      });
      
      // Web candidate should be suppressed
      assert.equal(result.suppressed, true);
      assert.equal(result.reason, 'native_higher_confidence');
    });

    test('does not suppress web candidate for different platform', async () => {
      const { MeetingArbitrator } = await import('../../dist/arbitration/arbitrator.js');
      
      const arbitrator = new MeetingArbitrator({ debug: false });
      const now = Date.now();
      
      // Native Teams
      arbitrator.processCandidate({
        platform: 'Microsoft Teams',
        confidence: 'high',
        source: 'native',
        timestamp: now,
        evidence: {
          processName: 'Microsoft Teams',
          micActive: true,
          cameraActive: true,
          timestamp: now,
        },
      });
      
      // Web Google Meet
      const result = arbitrator.processCandidate({
        platform: 'Google Meet',
        confidence: 'high',
        source: 'web',
        timestamp: now + 100,
        evidence: {
          browser: 'Google Chrome',
          tabUrl: 'https://meet.google.com/abc-defg-hij',
          tabTitle: 'Meeting',
          micActive: true,
          cameraActive: true,
          timestamp: now + 100,
        },
      });
      
      // Different platform should not be suppressed
      assert.equal(result.suppressed, false);
    });
  });

  describe('lifecycle event emission', () => {
    test('emits meeting_started on first candidate', async () => {
      const { MeetingArbitrator } = await import('../../dist/arbitration/arbitrator.js');
      
      const arbitrator = new MeetingArbitrator({ debug: false });
      const events = [];
      
      arbitrator.onLifecycleEvent((event) => events.push(event));
      
      arbitrator.processCandidate({
        platform: 'Zoom',
        confidence: 'high',
        source: 'native',
        timestamp: Date.now(),
        evidence: {
          processName: 'zoom.us',
          micActive: true,
          cameraActive: false,
          timestamp: Date.now(),
        },
      });
      
      assert.equal(events.length, 1);
      assert.equal(events[0].event, 'meeting_started');
      assert.equal(events[0].platform, 'Zoom');
      assert.equal(events[0].confidence, 'high');
    });

    test('emits meeting_changed on platform switch', async () => {
      const { MeetingArbitrator } = await import('../../dist/arbitration/arbitrator.js');
      
      const arbitrator = new MeetingArbitrator({ debug: false });
      const events = [];
      
      arbitrator.onLifecycleEvent((event) => events.push(event));
      
      const now = Date.now();
      
      // Start with Teams
      arbitrator.processCandidate({
        platform: 'Microsoft Teams',
        confidence: 'high',
        source: 'native',
        timestamp: now,
        evidence: {
          processName: 'Microsoft Teams',
          micActive: true,
          cameraActive: false,
          timestamp: now,
        },
      });
      
      // Switch to Zoom
      arbitrator.processCandidate({
        platform: 'Zoom',
        confidence: 'high',
        source: 'native',
        timestamp: now + 6000,
        evidence: {
          processName: 'zoom.us',
          micActive: true,
          cameraActive: true,
          timestamp: now + 6000,
        },
      });
      
      assert.equal(events.length, 2);
      assert.equal(events[1].event, 'meeting_changed');
      assert.equal(events[1].platform, 'Zoom');
      assert.equal(events[1].previous_platform, 'Microsoft Teams');
    });

    test('emits meeting_ended on timeout', async () => {
      const { MeetingArbitrator } = await import('../../dist/arbitration/arbitrator.js');
      
      const arbitrator = new MeetingArbitrator({ 
        debug: false,
        meetingEndTimeoutMs: 50,
      });
      const events = [];
      
      arbitrator.onLifecycleEvent((event) => events.push(event));
      
      arbitrator.processCandidate({
        platform: 'Zoom',
        confidence: 'high',
        source: 'native',
        timestamp: Date.now(),
        evidence: {
          processName: 'zoom.us',
          micActive: true,
          cameraActive: false,
          timestamp: Date.now(),
        },
      });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const endEvent = arbitrator.checkMeetingEnd();
      
      assert.ok(endEvent);
      assert.equal(endEvent.event, 'meeting_ended');
      assert.equal(endEvent.platform, 'Zoom');
      assert.equal(endEvent.reason, 'timeout');
    });

    test('emits meeting_ended on stop', async () => {
      const { MeetingArbitrator } = await import('../../dist/arbitration/arbitrator.js');
      
      const arbitrator = new MeetingArbitrator({ debug: false });
      const events = [];
      
      arbitrator.onLifecycleEvent((event) => events.push(event));
      
      arbitrator.processCandidate({
        platform: 'Zoom',
        confidence: 'high',
        source: 'native',
        timestamp: Date.now(),
        evidence: {
          processName: 'zoom.us',
          micActive: true,
          cameraActive: false,
          timestamp: Date.now(),
        },
      });
      
      const endEvent = arbitrator.stop();
      
      assert.ok(endEvent);
      assert.equal(endEvent.event, 'meeting_ended');
      assert.equal(endEvent.reason, 'stop');
    });
  });
});
