import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MeetingDetector } from '../dist/detector.js';

function createNoopScript() {
  const dir = mkdtempSync(join(tmpdir(), 'meeting-arbitration-'));
  const scriptPath = join(dir, 'noop.sh');
  writeFileSync(scriptPath, '#!/bin/sh\nsleep 0.05\n', 'utf8');
  chmodSync(scriptPath, 0o755);
  return { dir, scriptPath };
}

function createDetector() {
  const { dir, scriptPath } = createNoopScript();
  const detector = new MeetingDetector({
    scriptPath,
    startupProbe: false,
  });

  return { detector, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('suppresses native candidate when same-platform browser hint is fresh', async () => {
  const { detector, cleanup } = createDetector();
  try {
    detector.lastTccMicSignalAt = Date.now();
    detector.cachedMediaState = { camera: true, mic: true, updatedAt: Date.now() };
    detector.browserMeetingHints = new Map([
      [
        'Google Chrome',
        [
          {
            browser: 'Google Chrome',
            platform: 'Microsoft Teams',
            title: 'Meet | Daily Sync | Microsoft Teams',
            url: 'https://teams.live.com/v2/?meetingjoin=true',
            seenAt: Date.now(),
          },
        ],
      ],
    ]);
    detector.findRunningMeetingProcesses = async () => [
      { process: 'MSTeams', platform: 'Microsoft Teams' },
    ];

    const signal = await detector.detectActiveNativeMeetingSignal();
    assert.equal(signal, null);
  } finally {
    cleanup();
  }
});

test('allows native candidate when same-platform browser hint is stale', async () => {
  const { detector, cleanup } = createDetector();
  try {
    detector.lastTccMicSignalAt = Date.now();
    detector.cachedMediaState = { camera: true, mic: true, updatedAt: Date.now() };
    detector.browserMeetingHints = new Map([
      [
        'Google Chrome',
        [
          {
            browser: 'Google Chrome',
            platform: 'Microsoft Teams',
            title: 'Meet | Daily Sync | Microsoft Teams',
            url: 'https://teams.live.com/v2/?meetingjoin=true',
            seenAt: Date.now() - 12_000,
          },
        ],
      ],
    ]);
    detector.findRunningMeetingProcesses = async () => [
      { process: 'MSTeams', platform: 'Microsoft Teams' },
    ];
    detector.probeFrontmostAppName = async () => 'Microsoft Teams';
    detector.probeFrontWindowTitle = async () => 'Daily Sync | Microsoft Teams';

    const signal = await detector.detectActiveNativeMeetingSignal();
    assert.ok(signal);
    assert.equal(signal.service, 'Microsoft Teams');
  } finally {
    cleanup();
  }
});

test('allows cross-platform native switch when candidate platform is frontmost', async () => {
  const { detector, cleanup } = createDetector();
  try {
    detector.lastTccMicSignalAt = Date.now();
    detector.cachedMediaState = { camera: true, mic: true, updatedAt: Date.now() };
    detector.activeMeeting = {
      platform: 'Google Meet',
      lastSeen: Date.now(),
      confidence: 'high',
      signal: {
        event: 'meeting_signal',
        timestamp: new Date().toISOString(),
        service: 'Google Meet',
        verdict: 'allowed',
        process: 'Google Chrome',
        pid: '',
        parent_pid: '',
        process_path: '',
        front_app: 'Google Chrome',
        window_title: 'abc-defg-hij - Google Meet',
        session_id: 'active-google-meet',
        camera_active: true,
        mic_active: true,
        chrome_url: 'https://meet.google.com/abc-defg-hij',
      },
      timeline: {
        sessionId: 'active-google-meet',
        startedAt: new Date().toISOString(),
      },
    };
    detector.findRunningMeetingProcesses = async () => [
      { process: 'MSTeams', platform: 'Microsoft Teams' },
    ];
    detector.probeFrontmostAppName = async () => 'Microsoft Teams';
    detector.probeFrontWindowTitle = async () => 'Meet | Daily Sync | Microsoft Teams';

    const signal = await detector.detectActiveNativeMeetingSignal();
    assert.ok(signal);
    assert.equal(signal.service, 'Microsoft Teams');
  } finally {
    cleanup();
  }
});

