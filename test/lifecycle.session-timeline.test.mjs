import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MeetingDetector } from '../dist/detector.js';

function meetingSignal(overrides = {}) {
  return {
    event: 'meeting_signal',
    timestamp: '2026-04-02T12:00:00.000Z',
    service: 'Zoom',
    verdict: 'allowed',
    preflight: false,
    process: 'zoom.us',
    pid: '1',
    parent_pid: '0',
    process_path: '/Applications/zoom.us.app',
    front_app: 'zoom.us',
    window_title: 'Zoom Meeting',
    session_id: 'zoom-session-1',
    camera_active: true,
    ...overrides,
  };
}

test('meeting lifecycle carries stable session metadata from start to end', () => {
  const detector = new MeetingDetector({
    startupProbe: false,
    meetingEndTimeoutMs: 1,
  });
  const events = [];

  detector.on('meeting_started', (event) => events.push(event));
  detector.on('meeting_ended', (event) => events.push(event));

  detector['updateMeetingLifecycle'](meetingSignal());

  assert.equal(events.length, 1);
  assert.equal(events[0].session_id, 'zoom-session-1');
  assert.equal(events[0].started_at, '2026-04-02T12:00:00.000Z');
  assert.equal(events[0].ended_at, undefined);

  detector.activeMeeting.lastSeen = Date.now() - 10;
  detector['handleMeetingEndTimeout']();

  assert.equal(events.length, 2);
  assert.equal(events[1].session_id, 'zoom-session-1');
  assert.equal(events[1].started_at, events[0].started_at);
  assert.ok(events[1].ended_at);
  assert.equal(events[1].platform, 'Zoom');
});
