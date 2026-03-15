import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCliNotifier, getCliDetectorOptions } from '../dist/index.js';

function lifecycleEvent(overrides = {}) {
  return {
    event: 'meeting_started',
    timestamp: '2026-03-14T16:00:00.000Z',
    platform: 'Microsoft Teams',
    confidence: 'high',
    reason: 'signal',
    ...overrides,
  };
}

function signal(overrides = {}) {
  return {
    event: 'meeting_signal',
    timestamp: '2026-03-14T16:00:05Z',
    service: 'Microsoft Teams',
    verdict: 'requested',
    preflight: false,
    process: 'Google Chrome Helper',
    pid: '12345',
    parent_pid: '12300',
    process_path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    front_app: 'Google Chrome',
    window_title: '',
    session_id: '',
    camera_active: true,
    chrome_url: 'https://teams.microsoft.com/l/meetup-join/abc',
    ...overrides,
  };
}

test('CLI detector options preserve startup probing for mid-call launches', () => {
  const options = getCliDetectorOptions();
  assert.notEqual(options.startupProbe, false);
  assert.equal(options.debug, false);
});

test('CLI notifier reports starts, platform changes, and same-platform raw handoffs', () => {
  const announcements = [];
  let currentTime = 0;
  const notifier = createCliNotifier((message, payload) => {
    announcements.push({ message, payload });
  }, () => currentTime);

  notifier.handleMeetingStarted(lifecycleEvent());
  assert.equal(announcements.length, 1);
  assert.deepEqual(announcements[0], {
    message: '✅ Meeting detected:',
    payload: {
      timestamp: '2026-03-14T16:00:00.000Z',
      platform: 'Microsoft Teams',
      confidence: 'high',
      reason: 'signal',
    },
  });

  currentTime = 100;
  notifier.handleMeetingSignal(signal());
  assert.equal(announcements.length, 1);

  currentTime = 5000;
  notifier.handleMeetingChanged(lifecycleEvent({
    event: 'meeting_changed',
    platform: 'Zoom',
    reason: 'switch',
    timestamp: '2026-03-14T16:00:10.000Z',
  }));
  assert.equal(announcements.length, 2);
  assert.deepEqual(announcements[1], {
    message: '✅ Meeting detected:',
    payload: {
      timestamp: '2026-03-14T16:00:10.000Z',
      platform: 'Zoom',
      confidence: 'high',
      reason: 'switch',
    },
  });

  currentTime = 12000;
  notifier.handleMeetingSignal(signal({
    service: 'Zoom',
    pid: '99999',
    parent_pid: '12301',
    chrome_url: 'https://app.zoom.us/wc/123456/join',
    timestamp: '2026-03-14T16:00:17Z',
  }));
  assert.equal(announcements.length, 3);
  assert.deepEqual(announcements[2], {
    message: '✅ Meeting detected:',
    payload: {
      timestamp: '2026-03-14T16:00:17Z',
      platform: 'Zoom',
      confidence: 'high',
      reason: 'signal',
    },
  });

  currentTime = 13000;
  notifier.handleMeetingSignal(signal({
    service: 'Zoom',
    pid: '99999',
    parent_pid: '12301',
    chrome_url: 'https://app.zoom.us/wc/123456/join',
    timestamp: '2026-03-14T16:00:18Z',
  }));
  assert.equal(announcements.length, 3);
});
