import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MeetingDetector } from '../dist/detector.js';

function signal(overrides = {}) {
  return {
    event: 'meeting_signal',
    timestamp: new Date().toISOString(),
    service: 'microphone',
    verdict: 'allowed',
    preflight: 'false',
    process: 'MSTeams',
    pid: '11111',
    parent_pid: '1',
    process_path: '/Applications/Microsoft Teams.app/Contents/MacOS/MSTeams',
    front_app: 'Microsoft Teams',
    window_title: 'Planning Sync | Microsoft Teams',
    session_id: 'console',
    camera_active: 'true',
    ...overrides,
  };
}

function createEmitterScript(lines, tailSleepMs = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'meeting-test-'));
  const scriptPath = join(dir, 'emit.sh');
  const content = ['#!/bin/sh', 'set -eu'];
  for (const item of lines) {
    const payload = JSON.stringify(item.signal).replace(/'/g, `'\\''`);
    content.push(`echo '${payload}'`);
    if (item.sleepMs && item.sleepMs > 0) {
      content.push(`sleep ${(item.sleepMs / 1000).toFixed(3)}`);
    }
  }
  if (tailSleepMs > 0) {
    content.push(`sleep ${(tailSleepMs / 1000).toFixed(3)}`);
  }
  writeFileSync(scriptPath, `${content.join('\n')}\n`, 'utf8');
  chmodSync(scriptPath, 0o755);
  return { dir, scriptPath };
}

async function runScenario(lines, options = {}, tailSleepMs = 0, timeoutMs = 3000) {
  const { dir, scriptPath } = createEmitterScript(lines, tailSleepMs);
  const detector = new MeetingDetector({
    scriptPath,
    sessionDeduplicationMs: 200,
    meetingEndTimeoutMs: 80,
    startupProbe: false,
    ...options,
  });

  const rawEvents = [];
  const started = [];
  const changed = [];
  const ended = [];
  const errors = [];

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        detector.stop();
        reject(new Error('scenario timeout'));
      }, timeoutMs);

      detector.on('meeting', (event) => rawEvents.push(event));
      detector.on('meeting_started', (event) => started.push(event));
      detector.on('meeting_changed', (event) => changed.push(event));
      detector.on('meeting_ended', (event) => ended.push(event));
      detector.on('error', (error) => errors.push(error));
      detector.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      detector.start();
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  return { rawEvents, started, changed, ended, errors };
}

test('does not emit a meeting for low-confidence launch preflight only', async () => {
  const result = await runScenario([
    { signal: signal({ verdict: 'requested', preflight: 'true', window_title: '' }) },
  ]);

  assert.equal(result.rawEvents.length, 0);
  assert.equal(result.started.length, 0);
  assert.equal(result.errors.length, 0);
});

test('emits meeting_started on strong evidence and infers meeting_ended after timeout', async () => {
  const result = await runScenario(
    [{ signal: signal() }],
    {},
    200,
    4000
  );

  assert.equal(result.started.length, 1);
  assert.equal(result.started[0].platform, 'Microsoft Teams');
  assert.equal(result.ended.length, 1);
  assert.equal(result.ended[0].reason, 'timeout');
});

test('emits meeting_changed when platform switches', async () => {
  const result = await runScenario([
    { signal: signal({ process: 'MSTeams', front_app: 'Microsoft Teams' }), sleepMs: 30 },
    { signal: signal({ process: 'zoom.us', front_app: 'zoom.us', pid: '22222' }) },
  ]);

  assert.equal(result.started.length, 1);
  assert.equal(result.changed.length, 1);
  assert.equal(result.changed[0].previous_platform, 'Microsoft Teams');
  assert.equal(result.changed[0].platform, 'Zoom');
});

test('does not guess unknown platforms by default', async () => {
  const result = await runScenario([
    { signal: signal({ process: 'SomeRandomCameraApp', front_app: 'SomeRandomCameraApp', window_title: 'Camera Demo' }) },
  ]);

  assert.equal(result.rawEvents.length, 0);
  assert.equal(result.started.length, 0);
});

test('can emit Unknown lifecycle when configured', async () => {
  const result = await runScenario(
    [{ signal: signal({ process: 'SomeRandomCameraApp', front_app: 'SomeRandomCameraApp', window_title: 'Camera Demo' }) }],
    { emitUnknown: true }
  );

  assert.equal(result.started.length, 1);
  assert.equal(result.started[0].platform, 'Unknown');
});

test('redacts sensitive metadata from emitted raw meeting events by default', async () => {
  const result = await runScenario([{ signal: signal({ window_title: 'Secret Team Name - Standup' }) }]);

  assert.equal(result.rawEvents.length, 1);
  assert.equal(result.rawEvents[0].window_title, '');
  assert.equal(result.rawEvents[0].chrome_url, undefined);
});

test('handles repeated join/leave cycles without stale state', async () => {
  const result = await runScenario(
    [
      { signal: signal({ pid: '30001' }), sleepMs: 120 },
      { signal: signal({ pid: '30002' }) },
    ],
    {},
    220,
    5000
  );

  assert.equal(result.started.length, 2);
  assert.equal(result.ended.length, 2);
  assert.equal(result.started[0].platform, 'Microsoft Teams');
  assert.equal(result.started[1].platform, 'Microsoft Teams');
});

test('startup probe does not emit lifecycle events after detector is stopped immediately', async () => {
  // P2 guard: async probe callbacks must abort if stop() was already called.
  const dir = mkdtempSync(join(tmpdir(), 'meeting-test-'));
  const scriptPath = join(dir, 'emit.sh');
  // Script that blocks long enough for the probe callbacks to fire
  writeFileSync(scriptPath, '#!/bin/sh\nsleep 5\n', 'utf8');
  chmodSync(scriptPath, 0o755);

  const detector = new MeetingDetector({
    scriptPath,
    startupProbe: true,
    sessionDeduplicationMs: 200,
    meetingEndTimeoutMs: 80,
  });

  const events = [];
  detector.on('meeting_started', e => events.push(e));
  detector.on('meeting', e => events.push(e));

  detector.start();
  // Immediately stop — probe sub-processes are still running
  detector.stop();

  // Wait long enough for both cameraProbe and procProbe callbacks to complete
  await new Promise(r => setTimeout(r, 2000));

  assert.equal(events.length, 0, 'No events should fire after immediate stop()');
  rmSync(dir, { recursive: true, force: true });
});

test('maintains platform identity when meeting is backgrounded and front app is unrelated', async () => {
  const result = await runScenario([
    {
      signal: signal({
        front_app: 'Slack',
        process: 'MSTeams',
        window_title: '',
      }),
    },
  ]);

  assert.equal(result.rawEvents.length, 1);
  assert.equal(result.rawEvents[0].service, 'Microsoft Teams');
});
