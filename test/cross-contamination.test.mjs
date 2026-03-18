/**
 * Cross-contamination regression tests.
 * 
 * These tests specifically address the issues that motivated the MOS-112 refactor:
 * - Google Meet web detection flapping with Microsoft Teams
 * - Browser hints interfering with native app detection
 * - Post-call browser handoff false positives
 * - Generic platform landing pages inheriting previous platform
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

describe('Cross-contamination regression tests', () => {
  describe('Meet vs Teams flapping (lessons learned)', () => {
    test('does not flap between Meet web and Teams native', async () => {
      const { NativeDetectorEngine } = await import('../dist/engines/native-engine.js');
      const { WebDetectorEngine } = await import('../dist/engines/web-engine.js');
      const { MeetingArbitrator } = await import('../dist/arbitration/arbitrator.js');
      
      const nativeEngine = new NativeDetectorEngine({ debug: false });
      const webEngine = new WebDetectorEngine({ debug: false });
      const arbitrator = new MeetingArbitrator({ debug: false });
      
      const events = [];
      arbitrator.onLifecycleEvent((event) => events.push(event));
      
      nativeEngine.onCandidate((c) => arbitrator.processCandidate(c));
      webEngine.onCandidate((c) => arbitrator.processCandidate(c));
      
      const now = Date.now();
      
      // 1. User joins Google Meet in browser
      webEngine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'https://meet.google.com/abc-defg-hij',
        title: 'Meeting',
        micActive: true,
        cameraActive: true,
      });
      
      assert.equal(events.length, 1);
      assert.equal(events[0].event, 'meeting_started');
      assert.equal(events[0].platform, 'Google Meet');
      
      // 2. Teams native app is open in background (idle)
      nativeEngine.injectTccSignal({
        process: 'Microsoft Teams',
        windowTitle: 'Microsoft Teams', // Generic idle title
        micActive: false,
        cameraActive: false,
        verdict: 'requested',
        preflight: true,
      });
      
      // Should NOT trigger a platform change - Teams is idle
      assert.equal(events.length, 1);
      
      // 3. Teams does a preflight check while Meet is active
      nativeEngine.injectTccSignal({
        process: 'Microsoft Teams',
        windowTitle: 'Chat | John Doe',
        micActive: false,
        cameraActive: false,
        verdict: 'requested',
        preflight: true,
      });
      
      // Should still NOT change platform
      assert.equal(events.length, 1);
      assert.equal(arbitrator.getState().activeMeeting?.platform, 'Google Meet');
    });

    test('does not flap when Teams browser tab is open during native Meet', async () => {
      const { NativeDetectorEngine } = await import('../dist/engines/native-engine.js');
      const { WebDetectorEngine } = await import('../dist/engines/web-engine.js');
      const { MeetingArbitrator } = await import('../dist/arbitration/arbitrator.js');
      
      const nativeEngine = new NativeDetectorEngine({ debug: false });
      const webEngine = new WebDetectorEngine({ debug: false });
      const arbitrator = new MeetingArbitrator({ debug: false });
      
      const events = [];
      arbitrator.onLifecycleEvent((event) => events.push(event));
      
      nativeEngine.onCandidate((c) => arbitrator.processCandidate(c));
      webEngine.onCandidate((c) => arbitrator.processCandidate(c));
      
      // 1. User is in Google Meet via native/desktop
      nativeEngine.injectTccSignal({
        process: 'Google Meet',
        windowTitle: 'Meeting with Team',
        micActive: true,
        cameraActive: true,
        verdict: 'allowed',
        preflight: false,
      });
      
      assert.equal(events.length, 1);
      assert.equal(events[0].platform, 'Google Meet');
      
      // 2. User has a Teams meeting tab open (from earlier, not joined)
      webEngine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'https://teams.live.com/v2/',
        title: 'Meet | Microsoft Teams', // Prejoin title
        micActive: false, // Not joined = no mic
        cameraActive: false,
      });
      
      // Should NOT flap to Teams
      assert.equal(events.length, 1);
      assert.equal(arbitrator.getState().activeMeeting?.platform, 'Google Meet');
    });
  });

  describe('post-call browser handoff', () => {
    test('rejects stale browser hint after meeting ends', async () => {
      const { WebDetectorEngine } = await import('../dist/engines/web-engine.js');
      const { MeetingArbitrator } = await import('../dist/arbitration/arbitrator.js');
      
      const webEngine = new WebDetectorEngine({ 
        debug: false,
        browserHintWindowMs: 100,
      });
      const arbitrator = new MeetingArbitrator({ 
        debug: false,
        meetingEndTimeoutMs: 50,
      });
      
      const events = [];
      arbitrator.onLifecycleEvent((event) => events.push(event));
      webEngine.onCandidate((c) => arbitrator.processCandidate(c));
      
      // 1. User is in Google Meet
      webEngine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'https://meet.google.com/abc-defg-hij',
        title: 'Meeting',
        micActive: true,
        cameraActive: true,
      });
      
      assert.equal(events[0].event, 'meeting_started');
      assert.equal(events[0].platform, 'Google Meet');
      
      // 2. User leaves the meeting (mic goes inactive)
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 3. Check for meeting end
      const endEvent = arbitrator.checkMeetingEnd();
      assert.ok(endEvent);
      assert.equal(endEvent.event, 'meeting_ended');
      
      // 4. Browser hint should also be stale now
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // 5. User browses to generic Teams page
      webEngine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'https://teams.live.com/v2/',
        title: 'Microsoft Teams', // Generic landing page
        micActive: false,
        cameraActive: false,
      });
      
      // Should NOT start a new meeting
      const state = arbitrator.getState();
      assert.equal(state.activeMeeting, null);
    });

    test('does not inherit platform from previous meeting', async () => {
      const { WebDetectorEngine } = await import('../dist/engines/web-engine.js');
      const { MeetingArbitrator } = await import('../dist/arbitration/arbitrator.js');
      
      const webEngine = new WebDetectorEngine({ debug: false });
      const arbitrator = new MeetingArbitrator({ 
        debug: false,
        meetingEndTimeoutMs: 50,
      });
      
      const events = [];
      arbitrator.onLifecycleEvent((event) => events.push(event));
      webEngine.onCandidate((c) => arbitrator.processCandidate(c));
      
      // 1. Teams meeting
      webEngine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'https://teams.live.com/light-meetings/launch',
        title: 'Meeting with Team | Microsoft Teams',
        micActive: true,
        cameraActive: false,
      });
      
      assert.equal(events[0].platform, 'Microsoft Teams');
      
      // 2. Meeting ends
      await new Promise(resolve => setTimeout(resolve, 100));
      arbitrator.checkMeetingEnd();
      
      // 3. User browses to generic Zoom page
      webEngine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'https://app.zoom.us/wc/home',
        title: 'Zoom',
        micActive: false,
        cameraActive: false,
      });
      
      // Should NOT start a meeting and should NOT inherit Teams
      const newMeeting = events.find(e => 
        e.event === 'meeting_started' && 
        e.timestamp > events[0].timestamp
      );
      assert.equal(newMeeting, undefined);
    });
  });

  describe('multiple meeting apps open', () => {
    test('handles multiple native meeting apps correctly', async () => {
      const { NativeDetectorEngine } = await import('../dist/engines/native-engine.js');
      const { MeetingArbitrator } = await import('../dist/arbitration/arbitrator.js');
      
      const nativeEngine = new NativeDetectorEngine({ debug: false });
      const arbitrator = new MeetingArbitrator({ debug: false });
      
      const events = [];
      arbitrator.onLifecycleEvent((event) => events.push(event));
      nativeEngine.onCandidate((c) => arbitrator.processCandidate(c));
      
      // Both Teams and Zoom are running, but only Teams has active mic
      nativeEngine.injectTccSignal({
        process: 'Microsoft Teams',
        windowTitle: 'Meeting with John | Microsoft Teams',
        micActive: true,
        cameraActive: false,
        verdict: 'allowed',
        preflight: false,
      });
      
      // Zoom is running but idle
      nativeEngine.injectTccSignal({
        process: 'zoom.us',
        windowTitle: 'Zoom Workplace', // Generic idle title
        micActive: false,
        cameraActive: false,
        verdict: 'requested',
        preflight: true,
      });
      
      // Should only have Teams meeting
      assert.equal(events.length, 1);
      assert.equal(events[0].platform, 'Microsoft Teams');
    });

    test('handles multiple browser meeting tabs correctly', async () => {
      const { WebDetectorEngine } = await import('../dist/engines/web-engine.js');
      const { MeetingArbitrator } = await import('../dist/arbitration/arbitrator.js');
      
      const webEngine = new WebDetectorEngine({ debug: false });
      const arbitrator = new MeetingArbitrator({ debug: false });
      
      const events = [];
      arbitrator.onLifecycleEvent((event) => events.push(event));
      webEngine.onCandidate((c) => arbitrator.processCandidate(c));
      
      // Active Google Meet
      webEngine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'https://meet.google.com/abc-defg-hij',
        title: 'Meeting',
        micActive: true,
        cameraActive: true,
      });
      
      assert.equal(events.length, 1);
      assert.equal(events[0].platform, 'Google Meet');
      
      // Stale Teams tab (from earlier, no mic)
      webEngine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'https://teams.live.com/v2/',
        title: 'Meet | Microsoft Teams', // Prejoin
        micActive: false,
        cameraActive: false,
      });
      
      // Should not change to Teams
      assert.equal(events.length, 1);
      assert.equal(arbitrator.getState().activeMeeting?.platform, 'Google Meet');
    });
  });

  describe('browser hints vs native detection', () => {
    test('native Teams not blocked by stale Teams browser hint', async () => {
      const { NativeDetectorEngine } = await import('../dist/engines/native-engine.js');
      const { WebDetectorEngine } = await import('../dist/engines/web-engine.js');
      const { MeetingArbitrator } = await import('../dist/arbitration/arbitrator.js');
      
      const nativeEngine = new NativeDetectorEngine({ debug: false });
      const webEngine = new WebDetectorEngine({ 
        debug: false,
        browserHintWindowMs: 50, // Short for testing
      });
      const arbitrator = new MeetingArbitrator({ debug: false });
      
      const events = [];
      arbitrator.onLifecycleEvent((event) => events.push(event));
      nativeEngine.onCandidate((c) => arbitrator.processCandidate(c));
      webEngine.onCandidate((c) => arbitrator.processCandidate(c));
      
      // 1. User was browsing Teams earlier (no mic)
      webEngine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'https://teams.live.com/v2/',
        title: 'Meet | Microsoft Teams',
        micActive: false,
        cameraActive: false,
      });
      
      // No meeting yet
      assert.equal(events.length, 0);
      
      // 2. Wait for browser hint to expire
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 3. User opens native Teams meeting
      nativeEngine.injectTccSignal({
        process: 'Microsoft Teams',
        windowTitle: 'Meeting with Team',
        micActive: true,
        cameraActive: true,
        verdict: 'allowed',
        preflight: false,
      });
      
      // Native Teams should work
      assert.equal(events.length, 1);
      assert.equal(events[0].platform, 'Microsoft Teams');
      assert.equal(events[0].event, 'meeting_started');
    });

    test('native Slack huddle detected even with browser Slack open', async () => {
      const { NativeDetectorEngine } = await import('../dist/engines/native-engine.js');
      const { WebDetectorEngine } = await import('../dist/engines/web-engine.js');
      const { MeetingArbitrator } = await import('../dist/arbitration/arbitrator.js');
      
      const nativeEngine = new NativeDetectorEngine({ debug: false });
      const webEngine = new WebDetectorEngine({ debug: false });
      const arbitrator = new MeetingArbitrator({ debug: false });
      
      const events = [];
      arbitrator.onLifecycleEvent((event) => events.push(event));
      nativeEngine.onCandidate((c) => arbitrator.processCandidate(c));
      webEngine.onCandidate((c) => arbitrator.processCandidate(c));
      
      // 1. Browser Slack is open (regular workspace, not huddle)
      webEngine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'https://app.slack.com/client/T12345/C67890',
        title: '#general - Slack',
        micActive: false,
        cameraActive: false,
      });
      
      // No meeting yet
      assert.equal(events.length, 0);
      
      // 2. User joins native Slack huddle
      nativeEngine.injectTccSignal({
        process: 'Slack',
        windowTitle: 'Huddle: #general',
        micActive: true,
        cameraActive: false,
        verdict: 'allowed',
        preflight: false,
      });
      
      // Native Slack huddle should be detected
      assert.equal(events.length, 1);
      assert.equal(events[0].platform, 'Slack');
    });
  });

  describe('same-platform rejoin', () => {
    test('emits new lifecycle for same-platform rejoin after end', async () => {
      const { NativeDetectorEngine } = await import('../dist/engines/native-engine.js');
      const { MeetingArbitrator } = await import('../dist/arbitration/arbitrator.js');
      
      const nativeEngine = new NativeDetectorEngine({ debug: false });
      const arbitrator = new MeetingArbitrator({ 
        debug: false,
        meetingEndTimeoutMs: 50,
      });
      
      const events = [];
      arbitrator.onLifecycleEvent((event) => events.push(event));
      nativeEngine.onCandidate((c) => arbitrator.processCandidate(c));
      
      // 1. First Zoom meeting
      nativeEngine.injectTccSignal({
        process: 'zoom.us',
        windowTitle: 'Meeting 1',
        micActive: true,
        cameraActive: true,
        verdict: 'allowed',
        preflight: false,
      });
      
      assert.equal(events.length, 1);
      assert.equal(events[0].event, 'meeting_started');
      
      // 2. Meeting ends
      await new Promise(resolve => setTimeout(resolve, 100));
      const endEvent = arbitrator.checkMeetingEnd();
      assert.ok(endEvent);
      
      // 3. Rejoin same platform (new meeting)
      nativeEngine.injectTccSignal({
        process: 'zoom.us',
        windowTitle: 'Meeting 2',
        micActive: true,
        cameraActive: true,
        verdict: 'allowed',
        preflight: false,
      });
      
      // Should emit a NEW meeting_started
      const startEvents = events.filter(e => e.event === 'meeting_started');
      assert.equal(startEvents.length, 2);
    });
  });

  describe('rapid platform flapping prevention', () => {
    test('does not flap rapidly between platforms', async () => {
      const { NativeDetectorEngine } = await import('../dist/engines/native-engine.js');
      const { MeetingArbitrator } = await import('../dist/arbitration/arbitrator.js');
      
      const nativeEngine = new NativeDetectorEngine({ debug: false });
      const arbitrator = new MeetingArbitrator({ debug: false });
      
      const events = [];
      arbitrator.onLifecycleEvent((event) => events.push(event));
      nativeEngine.onCandidate((c) => arbitrator.processCandidate(c));
      
      const now = Date.now();
      
      // Rapid signals within <5s should not cause flapping
      nativeEngine.injectTccSignal({
        process: 'zoom.us',
        windowTitle: 'Meeting',
        micActive: true,
        cameraActive: false,
        verdict: 'allowed',
        preflight: false,
        timestamp: now,
      });
      
      nativeEngine.injectTccSignal({
        process: 'Microsoft Teams',
        windowTitle: 'Chat', // Not a meeting title
        micActive: false,
        cameraActive: false,
        verdict: 'requested',
        preflight: true,
        timestamp: now + 500,
      });
      
      nativeEngine.injectTccSignal({
        process: 'zoom.us',
        windowTitle: 'Meeting',
        micActive: true,
        cameraActive: false,
        verdict: 'allowed',
        preflight: false,
        timestamp: now + 1000,
      });
      
      // Should only have one meeting_started, no flapping
      assert.equal(events.filter(e => e.event === 'meeting_started').length, 1);
      assert.equal(events.filter(e => e.event === 'meeting_changed').length, 0);
    });
  });
});
