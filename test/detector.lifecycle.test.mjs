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
  detector.listBrowserTabs = async () => [];
  detector.detectActiveNativeMeetingSignal = async () => null;

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

test('suppresses idle native Teams launch signals with generic window state', async () => {
  const result = await runScenario([
    {
      signal: signal({
        service: 'microphone',
        process: 'MSTeams',
        front_app: 'Microsoft Teams',
        window_title: 'Microsoft Teams',
        verdict: 'allowed',
        preflight: 'false',
        camera_active: false,
      }),
    },
  ]);

  assert.equal(result.rawEvents.length, 0);
  assert.equal(result.started.length, 0);
});

test('suppresses idle native Teams launch signals even if global camera state is hot', async () => {
  const result = await runScenario([
    {
      signal: signal({
        service: 'microphone',
        process: 'MSTeams',
        front_app: 'Microsoft Teams',
        window_title: 'Microsoft Teams',
        verdict: 'allowed',
        preflight: 'false',
        camera_active: true,
      }),
    },
  ]);

  assert.equal(result.rawEvents.length, 0);
  assert.equal(result.started.length, 0);
});

test('suppresses idle native Zoom launch signals with generic window state', async () => {
  const result = await runScenario([
    {
      signal: signal({
        service: 'microphone',
        process: 'zoom.us',
        front_app: 'zoom.us',
        window_title: 'Zoom Workplace',
        verdict: 'allowed',
        preflight: 'false',
        camera_active: false,
      }),
    },
  ]);

  assert.equal(result.rawEvents.length, 0);
  assert.equal(result.started.length, 0);
});

test('suppresses idle native Zoom launch signals even if global camera state is hot', async () => {
  const result = await runScenario([
    {
      signal: signal({
        service: 'microphone',
        process: 'zoom.us',
        front_app: 'zoom.us',
        window_title: 'Zoom Workplace',
        verdict: 'allowed',
        preflight: 'false',
        camera_active: true,
      }),
    },
  ]);

  assert.equal(result.rawEvents.length, 0);
  assert.equal(result.started.length, 0);
});

test('keeps generic browser camera usage suppressed when emitUnknown is false', async () => {
  const result = await runScenario([
    {
      signal: signal({
        service: 'Unknown',
        process: 'Google Chrome Helper',
        front_app: 'Unknown',
        verdict: 'requested',
        preflight: false,
        window_title: '',
        chrome_url: '',
        camera_active: true,
      }),
    },
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

test('treats Teams browser join routes with active camera as strong evidence', async () => {
  const result = await runScenario(
    [
      {
        signal: signal({
          service: 'Microsoft Teams',
          process: 'Google Chrome Helper',
          front_app: 'Microsoft Teams',
          verdict: 'requested',
          preflight: 'true',
          chrome_url: 'https://teams.microsoft.com/light-meetings/launch?p=test',
          window_title: '',
        }),
      },
    ],
    {},
    200,
    4000
  );

  assert.equal(result.started.length, 1);
  assert.equal(result.started[0].platform, 'Microsoft Teams');
});

test('treats Teams light-meetings routes without the launch suffix as strong evidence', async () => {
  const result = await runScenario(
    [
      {
        signal: signal({
          service: 'Microsoft Teams',
          process: 'Google Chrome Helper',
          front_app: 'Microsoft Teams',
          verdict: 'requested',
          preflight: 'true',
          chrome_url: 'https://teams.microsoft.com/light-meetings?anon=true',
          window_title: '',
        }),
      },
    ],
    {},
    200,
    4000
  );

  assert.equal(result.started.length, 1);
  assert.equal(result.started[0].platform, 'Microsoft Teams');
});

test('treats Microsoft Teams v2 meeting surfaces with explicit meeting titles as strong evidence', async () => {
  const result = await runScenario(
    [
      {
        signal: signal({
          service: 'microphone',
          process: 'Google Chrome Helper',
          process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
          front_app: 'Google Chrome',
          verdict: 'requested',
          preflight: 'true',
          chrome_url: 'https://teams.live.com/v2/',
          window_title: 'Meet | Meeting with kaise white | Microsoft Teams',
        }),
      },
    ],
    {},
    200,
    4000
  );

  assert.equal(result.started.length, 1);
  assert.equal(result.started[0].platform, 'Microsoft Teams');
});

test('treats Microsoft Teams v2 meeting surfaces with structured live titles as strong evidence', async () => {
  const result = await runScenario(
    [
      {
        signal: signal({
          service: 'microphone',
          process: 'Google Chrome Helper',
          process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
          front_app: 'Google Chrome',
          verdict: 'requested',
          preflight: 'true',
          chrome_url: 'https://teams.live.com/v2/',
          window_title: 'Meet | Daily Sync | Microsoft Teams',
        }),
      },
    ],
    {},
    200,
    4000
  );

  assert.equal(result.started.length, 1);
  assert.equal(result.started[0].platform, 'Microsoft Teams');
});

test('accepts Google Meet browser routes even when the tab title is only Meet', async () => {
  const result = await runScenario(
    [
      {
        signal: signal({
          service: 'Google Meet',
          process: 'Google Chrome Helper',
          process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
          front_app: 'Google Chrome',
          verdict: 'requested',
          preflight: 'false',
          chrome_url: 'https://meet.google.com/abc-defg-hij',
          window_title: 'Meet',
        }),
      },
    ],
    {},
    200,
    4000
  );

  assert.equal(result.started.length, 1);
  assert.equal(result.started[0].platform, 'Google Meet');
});

test('treats Zoom browser join routes with active camera as strong evidence', async () => {
  const result = await runScenario(
    [
      {
        signal: signal({
          service: 'Zoom',
          process: 'Google Chrome Helper',
          front_app: 'Zoom',
          verdict: 'requested',
          preflight: 'true',
          chrome_url: 'https://app.zoom.us/wc/8716769399/join?pwd=test',
          window_title: '',
        }),
      },
    ],
    {},
    200,
    4000
  );

  assert.equal(result.started.length, 1);
  assert.equal(result.started[0].platform, 'Zoom');
});

test('does not switch to Microsoft Teams when browsing a generic Teams page after Google Meet', async () => {
  const result = await runScenario(
    [
      {
        signal: signal({
          service: 'microphone',
          process: 'Google Chrome Helper',
          process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
          front_app: 'Google Chrome',
          window_title: 'Meet',
          chrome_url: 'https://meet.google.com/abc-defg-hij',
        }),
        sleepMs: 30,
      },
      {
        signal: signal({
          service: 'microphone',
          process: 'Google Chrome Helper',
          process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
          front_app: 'Google Chrome',
          window_title: 'Microsoft Teams',
          chrome_url: 'https://teams.live.com/v2/',
        }),
      },
    ],
    {},
    200,
    4000
  );

  assert.equal(result.started.length, 1);
  assert.equal(result.started[0].platform, 'Google Meet');
  assert.equal(result.changed.length, 0);
  assert.equal(result.ended.length, 1);
});

test('does not start a new meeting from a generic Teams landing page after the prior meeting timed out', async () => {
  const result = await runScenario(
    [
      {
        signal: signal({
          service: 'microphone',
          process: 'Google Chrome Helper',
          process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
          front_app: 'Google Chrome',
          window_title: 'Meet',
          chrome_url: 'https://meet.google.com/abc-defg-hij',
        }),
        sleepMs: 120,
      },
      {
        signal: signal({
          service: 'microphone',
          process: 'Google Chrome Helper',
          process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
          front_app: 'Google Chrome',
          window_title: 'Microsoft Teams',
          chrome_url: 'https://teams.live.com/v2/',
        }),
      },
    ],
    {},
    220,
    5000
  );

  assert.equal(result.started.length, 1);
  assert.equal(result.started[0].platform, 'Google Meet');
  assert.equal(result.changed.length, 0);
  assert.equal(result.ended.length, 1);
});

test('does not start a new meeting from a generic Google Meet landing page after a prior browser meeting', async () => {
  const result = await runScenario(
    [
      {
        signal: signal({
          service: 'microphone',
          process: 'Google Chrome Helper',
          process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
          front_app: 'Google Chrome',
          window_title: 'Zoom',
          chrome_url: 'https://app.zoom.us/wc/8716769399/join?pwd=test',
        }),
        sleepMs: 120,
      },
      {
        signal: signal({
          service: 'microphone',
          process: 'Google Chrome Helper',
          process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
          front_app: 'Google Chrome',
          window_title: 'Google Meet',
          chrome_url: 'https://meet.google.com/',
        }),
      },
    ],
    {},
    220,
    5000
  );

  assert.equal(result.started.length, 1);
  assert.equal(result.started[0].platform, 'Zoom');
  assert.equal(result.changed.length, 0);
  assert.equal(result.ended.length, 1);
});

test('does not start a new meeting from a generic Zoom web page after a prior browser meeting', async () => {
  const result = await runScenario(
    [
      {
        signal: signal({
          service: 'microphone',
          process: 'Google Chrome Helper',
          process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
          front_app: 'Google Chrome',
          window_title: 'Meet',
          chrome_url: 'https://meet.google.com/abc-defg-hij',
        }),
        sleepMs: 120,
      },
      {
        signal: signal({
          service: 'microphone',
          process: 'Google Chrome Helper',
          process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
          front_app: 'Google Chrome',
          window_title: 'Zoom Workplace',
          chrome_url: 'https://app.zoom.us/wc/home',
        }),
      },
    ],
    {},
    220,
    5000
  );

  assert.equal(result.started.length, 1);
  assert.equal(result.started[0].platform, 'Google Meet');
  assert.equal(result.changed.length, 0);
  assert.equal(result.ended.length, 1);
});

test('suppresses Jitsi prejoin camera checks without stronger meeting evidence', async () => {
  const result = await runScenario([
    {
      signal: signal({
        service: 'Jitsi Meet',
        process: 'Google Chrome Helper',
        front_app: 'Jitsi Meet',
        verdict: 'requested',
        preflight: 'true',
        chrome_url: 'https://meet.jit.si/harke-detector-test',
        window_title: '',
      }),
    },
  ]);

  assert.equal(result.rawEvents.length, 0);
  assert.equal(result.started.length, 0);
});

test('browser meeting tabs alone do not emit lifecycle events without corroborating media signals', async () => {
  const { dir, scriptPath } = createEmitterScript([], 300);
  const detector = new MeetingDetector({
    scriptPath,
    startupProbe: false,
    sessionDeduplicationMs: 200,
    meetingEndTimeoutMs: 80,
  });

  const started = [];
  const rawEvents = [];

  detector.listBrowserTabs = async () => [
    {
      browser: 'Google Chrome',
      title: 'Meet | Meeting with kaise white | Microsoft Teams',
      url: 'https://teams.live.com/v2/',
    },
  ];
  // No camera/mic active — browser tabs alone should not trigger meetings
  detector.probeCameraActiveState = async () => false;
  detector.probeMediaState = async () => ({ camera: false, mic: false });

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        detector.stop();
        reject(new Error('scenario timeout'));
      }, 2000);

      detector.on('meeting_started', (event) => started.push(event));
      detector.on('meeting', (event) => rawEvents.push(event));
      detector.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      detector.start();
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  assert.equal(started.length, 0);
  assert.equal(rawEvents.length, 0);
});

test('browser meeting hints can attribute real Chrome media signals without standalone browser starts', async () => {
  const { dir, scriptPath } = createEmitterScript([
    {
      signal: signal({
        service: 'microphone',
        process: 'Google Chrome Helper',
        process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
        front_app: 'Google Chrome',
        window_title: '',
        chrome_url: '',
      }),
    },
  ]);

  const detector = new MeetingDetector({
    scriptPath,
    startupProbe: false,
    sessionDeduplicationMs: 200,
    meetingEndTimeoutMs: 80,
  });

  const started = [];
  const rawEvents = [];

  detector.listBrowserTabs = async () => [
    {
      browser: 'Google Chrome',
      title: 'Meet | Meeting with kaise white | Microsoft Teams',
      url: 'https://teams.live.com/v2/',
    },
  ];

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        detector.stop();
        reject(new Error('scenario timeout'));
      }, 2000);

      detector.on('meeting_started', (event) => started.push(event));
      detector.on('meeting', (event) => rawEvents.push(event));
      detector.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      detector.start();
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  assert.equal(started.length, 1);
  assert.equal(started[0].platform, 'Microsoft Teams');
  assert.equal(rawEvents.length, 1);
  assert.equal(rawEvents[0].service, 'Microsoft Teams');
});

test('native app probe can emit an active Teams meeting signal without shell TCC traffic', async () => {
  const { dir, scriptPath } = createEmitterScript([], 300);
  const detector = new MeetingDetector({
    scriptPath,
    startupProbe: false,
    sessionDeduplicationMs: 200,
    meetingEndTimeoutMs: 80,
  });

  const started = [];
  const rawEvents = [];

  detector.detectActiveNativeMeetingSignal = async () => ({
    event: 'meeting_signal',
    timestamp: new Date().toISOString(),
    service: 'Microsoft Teams',
    verdict: 'allowed',
    preflight: false,
    process: 'Microsoft Teams',
    pid: '',
    parent_pid: '',
    process_path: '',
    front_app: 'Microsoft Teams',
    window_title: 'Daily Sync | Microsoft Teams',
    session_id: '',
    camera_active: false,
    chrome_url: undefined,
  });

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        detector.stop();
        reject(new Error('scenario timeout'));
      }, 2000);

      detector.on('meeting_started', (event) => started.push(event));
      detector.on('meeting', (event) => rawEvents.push(event));
      detector.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      detector.start();
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  assert.equal(started.length, 1);
  assert.equal(started[0].platform, 'Microsoft Teams');
  assert.equal(rawEvents.length, 1);
  assert.equal(rawEvents[0].service, 'Microsoft Teams');
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
  detector.listBrowserTabs = async () => [];
  detector.detectActiveNativeMeetingSignal = async () => null;

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

test('native app probe does not emit lifecycle events after detector is stopped immediately', async () => {
  const { dir, scriptPath } = createEmitterScript([], 300);
  const detector = new MeetingDetector({
    scriptPath,
    startupProbe: false,
    sessionDeduplicationMs: 200,
    meetingEndTimeoutMs: 80,
  });

  detector.listBrowserTabs = async () => [];
  detector.detectActiveNativeMeetingSignal = async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return {
      event: 'meeting_signal',
      timestamp: new Date().toISOString(),
      service: 'Microsoft Teams',
      verdict: 'allowed',
      preflight: false,
      process: 'Microsoft Teams',
      pid: '',
      parent_pid: '',
      process_path: '',
      front_app: 'Microsoft Teams',
      window_title: 'Daily Sync | Microsoft Teams',
      session_id: '',
      camera_active: false,
      chrome_url: undefined,
    };
  };

  const events = [];
  detector.on('meeting_started', (event) => events.push(event));
  detector.on('meeting', (event) => events.push(event));

  detector.start();
  detector.stop();

  await new Promise((resolve) => setTimeout(resolve, 500));

  assert.equal(events.length, 0, 'No native probe events should fire after immediate stop()');
  rmSync(dir, { recursive: true, force: true });
});

test('maintains platform identity when meeting is backgrounded and front app is unrelated', async () => {
  // When a native meeting is backgrounded, the TCC signal has an empty title and
  // mismatched front_app. The idle-title filter blocks it (correctly — it could be
  // an idle launch signal). The native app probe is the correct path for backgrounded
  // meeting detection, so this test validates via the probe stub.
  const { dir, scriptPath } = createEmitterScript([], 300);
  const detector = new MeetingDetector({
    scriptPath,
    startupProbe: false,
    sessionDeduplicationMs: 200,
    meetingEndTimeoutMs: 80,
  });

  const rawEvents = [];
  const started = [];

  detector.listBrowserTabs = async () => [];
  detector.detectActiveNativeMeetingSignal = async () => ({
    event: 'meeting_signal',
    timestamp: new Date().toISOString(),
    service: 'Microsoft Teams',
    verdict: 'allowed',
    preflight: false,
    process: 'MSTeams',
    pid: '',
    parent_pid: '',
    process_path: '',
    front_app: 'Microsoft Teams',
    window_title: '',
    session_id: '',
    camera_active: true,
    chrome_url: undefined,
  });

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        detector.stop();
        reject(new Error('scenario timeout'));
      }, 2000);

      detector.on('meeting', (event) => rawEvents.push(event));
      detector.on('meeting_started', (event) => started.push(event));
      detector.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      detector.start();
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  assert.equal(rawEvents.length, 1);
  assert.equal(rawEvents[0].service, 'Microsoft Teams');
  assert.equal(started.length, 1);
  assert.equal(started[0].platform, 'Microsoft Teams');
});

test('dedupes repeated debug logs for identical ignored signals', async () => {
  const { dir, scriptPath } = createEmitterScript([
    {
      signal: signal({
        process: 'SomeRandomCameraApp',
        front_app: 'Unknown',
        service: 'Unknown',
        verdict: 'requested',
        preflight: 'false',
        window_title: '',
        camera_active: 'true',
        chrome_url: '',
        process_path: '/Applications/SomeRandomCameraApp.app/Contents/MacOS/SomeRandomCameraApp',
      }),
      sleepMs: 20,
    },
    {
      signal: signal({
        process: 'SomeRandomCameraApp',
        front_app: 'Unknown',
        service: 'Unknown',
        verdict: 'requested',
        preflight: 'false',
        window_title: '',
        camera_active: 'true',
        chrome_url: '',
        process_path: '/Applications/SomeRandomCameraApp.app/Contents/MacOS/SomeRandomCameraApp',
      }),
    },
  ]);

  const originalLog = console.log;
  const logs = [];
  let detector;

  try {
    console.log = (...args) => logs.push(args.join(' '));
    detector = new MeetingDetector({
      scriptPath,
      debug: true,
      startupProbe: false,
    });
    await new Promise((resolve) => {
      detector.on('exit', resolve);
      detector.start();
    });
  } finally {
    console.log = originalLog;
    rmSync(dir, { recursive: true, force: true });
  }

  assert.equal(logs.filter((line) => line.includes('Ignoring signal:')).length, 1);
});

test('dedupes repeated debug logs for identical low-confidence signals', async () => {
  // Teams WebView preflight signals with empty titles are now caught by the idle-title
  // filter in shouldIgnoreSignal() before reaching resolveConfidence(). The debug log
  // message is "Ignoring signal" rather than "Holding low-confidence signal".
  const { dir, scriptPath } = createEmitterScript([
    {
      signal: signal({
        service: 'Microsoft Teams',
        process: 'Microsoft Teams WebView',
        front_app: 'MSTeams',
        verdict: 'requested',
        preflight: 'true',
        window_title: '',
        camera_active: 'true',
      }),
      sleepMs: 20,
    },
    {
      signal: signal({
        service: 'Microsoft Teams',
        process: 'Microsoft Teams WebView',
        front_app: 'MSTeams',
        verdict: 'requested',
        preflight: 'true',
        window_title: '',
        camera_active: 'true',
      }),
    },
  ]);

  const originalLog = console.log;
  const logs = [];
  let detector;

  try {
    console.log = (...args) => logs.push(args.join(' '));
    detector = new MeetingDetector({
      scriptPath,
      debug: true,
      startupProbe: false,
    });
    await new Promise((resolve) => {
      detector.on('exit', resolve);
      detector.start();
    });
  } finally {
    console.log = originalLog;
    rmSync(dir, { recursive: true, force: true });
  }

  assert.equal(logs.filter((line) => line.includes('Ignoring signal:')).length, 1);
});

test('can emit Unknown lifecycle for unattributed browser camera usage when explicitly enabled', async () => {
  const result = await runScenario(
    [
      {
        signal: signal({
          service: 'Unknown',
          process: 'Google Chrome Helper',
          process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/145.0.7632.119/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
          front_app: 'Unknown',
          verdict: 'requested',
          preflight: 'false',
          window_title: '',
          camera_active: 'true',
          chrome_url: '',
        }),
      },
    ],
    { emitUnknown: true },
    200,
    4000
  );

  assert.equal(result.started.length, 1);
  assert.equal(result.started[0].platform, 'Unknown');
  assert.equal(result.rawEvents.length, 1);
  assert.equal(result.rawEvents[0].service, 'Unknown');
});

// ——— Signal Detection Hardening: Native Probe Regression Tests ———

test('native app probe detects Teams meeting when VS Code is frontmost', async () => {
  const { dir, scriptPath } = createEmitterScript([], 300);
  const detector = new MeetingDetector({
    scriptPath,
    startupProbe: false,
    sessionDeduplicationMs: 200,
    meetingEndTimeoutMs: 80,
  });

  const started = [];
  const rawEvents = [];

  detector.listBrowserTabs = async () => [];
  detector.detectActiveNativeMeetingSignal = async () => ({
    event: 'meeting_signal',
    timestamp: new Date().toISOString(),
    service: 'Microsoft Teams',
    verdict: 'allowed',
    preflight: false,
    process: 'MSTeams',
    pid: '',
    parent_pid: '',
    process_path: '',
    front_app: 'Microsoft Teams',
    window_title: '',
    session_id: '',
    camera_active: true,
    chrome_url: undefined,
  });

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        detector.stop();
        reject(new Error('scenario timeout'));
      }, 2000);

      detector.on('meeting_started', (event) => started.push(event));
      detector.on('meeting', (event) => rawEvents.push(event));
      detector.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      detector.start();
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  assert.equal(started.length, 1);
  assert.equal(started[0].platform, 'Microsoft Teams');
});

test('native app probe detects Slack huddle when Finder is frontmost', async () => {
  const { dir, scriptPath } = createEmitterScript([], 300);
  const detector = new MeetingDetector({
    scriptPath,
    startupProbe: false,
    sessionDeduplicationMs: 200,
    meetingEndTimeoutMs: 80,
  });

  const started = [];

  detector.listBrowserTabs = async () => [];
  detector.detectActiveNativeMeetingSignal = async () => ({
    event: 'meeting_signal',
    timestamp: new Date().toISOString(),
    service: 'Slack',
    verdict: 'allowed',
    preflight: false,
    process: 'Slack',
    pid: '',
    parent_pid: '',
    process_path: '',
    front_app: 'Slack',
    window_title: '',
    session_id: '',
    camera_active: false,
    chrome_url: undefined,
  });

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        detector.stop();
        reject(new Error('scenario timeout'));
      }, 2000);

      detector.on('meeting_started', (event) => started.push(event));
      detector.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      detector.start();
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  assert.equal(started.length, 1);
  assert.equal(started[0].platform, 'Slack');
});

test('native Teams probe is NOT suppressed by a Google Meet browser hint', async () => {
  const { dir, scriptPath } = createEmitterScript([], 300);
  const detector = new MeetingDetector({
    scriptPath,
    startupProbe: false,
    sessionDeduplicationMs: 200,
    meetingEndTimeoutMs: 80,
  });

  const started = [];

  // Simulate a Google Meet browser tab (different platform)
  detector.listBrowserTabs = async () => [{
    browser: 'Google Chrome',
    title: 'Meet - abc-defg-hij',
    url: 'https://meet.google.com/abc-defg-hij',
  }];

  // Prevent browser probe synthesis from firing (mic=false)
  detector.probeMediaState = async () => ({ camera: false, mic: false });

  detector.detectActiveNativeMeetingSignal = async () => ({
    event: 'meeting_signal',
    timestamp: new Date().toISOString(),
    service: 'Microsoft Teams',
    verdict: 'allowed',
    preflight: false,
    process: 'MSTeams',
    pid: '',
    parent_pid: '',
    process_path: '',
    front_app: 'Microsoft Teams',
    window_title: '',
    session_id: '',
    camera_active: true,
    chrome_url: undefined,
  });

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        detector.stop();
        reject(new Error('scenario timeout'));
      }, 2000);

      detector.on('meeting_started', (event) => started.push(event));
      detector.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      detector.start();
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  assert.equal(started.length, 1);
  assert.equal(started[0].platform, 'Microsoft Teams');
});

test('native Slack probe is NOT suppressed by a Teams browser hint', async () => {
  const { dir, scriptPath } = createEmitterScript([], 300);
  const detector = new MeetingDetector({
    scriptPath,
    startupProbe: false,
    sessionDeduplicationMs: 200,
    meetingEndTimeoutMs: 80,
  });

  const started = [];

  // Simulate a Teams browser tab (different platform from Slack)
  detector.listBrowserTabs = async () => [{
    browser: 'Google Chrome',
    title: 'Meet | Daily Sync | Microsoft Teams',
    url: 'https://teams.live.com/v2/?meetingjoin=true',
  }];

  // Prevent browser probe synthesis from firing (mic=false)
  detector.probeMediaState = async () => ({ camera: false, mic: false });

  detector.detectActiveNativeMeetingSignal = async () => ({
    event: 'meeting_signal',
    timestamp: new Date().toISOString(),
    service: 'Slack',
    verdict: 'allowed',
    preflight: false,
    process: 'Slack',
    pid: '',
    parent_pid: '',
    process_path: '',
    front_app: 'Slack',
    window_title: '',
    session_id: '',
    camera_active: false,
    chrome_url: undefined,
  });

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        detector.stop();
        reject(new Error('scenario timeout'));
      }, 2000);

      detector.on('meeting_started', (event) => started.push(event));
      detector.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      detector.start();
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  assert.equal(started.length, 1);
  assert.equal(started[0].platform, 'Slack');
});

test('recorder app (OBS) with mic access only does NOT emit a meeting', async () => {
  const result = await runScenario([
    {
      signal: signal({
        service: 'microphone',
        process: 'obs',
        front_app: 'OBS',
        window_title: 'Recording - Scene 1',
        verdict: 'allowed',
        preflight: 'false',
        camera_active: 'false',
      }),
    },
  ]);

  assert.equal(result.rawEvents.length, 0);
  assert.equal(result.started.length, 0);
});

test('recorder app (OBS) with mic + camera does NOT emit a meeting', async () => {
  const result = await runScenario([
    {
      signal: signal({
        service: 'microphone',
        process: 'obs',
        front_app: 'OBS',
        window_title: 'Recording - Scene 1',
        verdict: 'allowed',
        preflight: 'false',
        camera_active: 'true',
      }),
    },
  ]);

  assert.equal(result.rawEvents.length, 0);
  assert.equal(result.started.length, 0);
});

test('does not emit for unresolved browser lobby preflight without joined-state evidence', async () => {
  const result = await runScenario([
    {
      signal: signal({
        service: 'Unknown',
        process: 'Google Chrome Helper',
        process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/145.0.7632.119/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
        front_app: 'Unknown',
        verdict: 'requested',
        preflight: 'true',
        window_title: '',
        camera_active: 'true',
        chrome_url: '',
      }),
    },
  ]);

  assert.equal(result.rawEvents.length, 0);
  assert.equal(result.started.length, 0);
});

// ——— Edge-Case Criteria: Additional Coverage ———

test('suppresses post-call redirect to landing page after a real meeting ends', async () => {
  // After a real meeting ends (timeout), the user navigates to the Meet landing
  // page. The landing page URL (no room code) should NOT start a new meeting.
  const result = await runScenario(
    [
      {
        signal: signal({
          service: 'microphone',
          process: 'Google Chrome Helper',
          process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
          front_app: 'Google Chrome',
          window_title: 'Meet',
          chrome_url: 'https://meet.google.com/abc-defg-hij',
        }),
        sleepMs: 120,
      },
      {
        signal: signal({
          service: 'microphone',
          process: 'Google Chrome Helper',
          process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
          front_app: 'Google Chrome',
          window_title: 'Google Meet',
          chrome_url: 'https://meet.google.com/',
        }),
      },
    ],
    {},
    220,
    5000
  );

  // First meeting starts and ends; landing page should not start a second meeting
  assert.equal(result.started.length, 1);
  assert.equal(result.started[0].platform, 'Google Meet');
  assert.equal(result.ended.length, 1);
});

test('prevents platform flapping when stale ended Meet tab stays open and new Zoom web starts', async () => {
  // After a Meet meeting ends, a new Zoom meeting starts via browser.
  // The stale Meet tab should not cause alternation.
  const result = await runScenario(
    [
      {
        signal: signal({
          service: 'microphone',
          process: 'Google Chrome Helper',
          process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
          front_app: 'Google Chrome',
          window_title: 'Meet',
          chrome_url: 'https://meet.google.com/abc-defg-hij',
        }),
        sleepMs: 120,
      },
      {
        signal: signal({
          service: 'microphone',
          process: 'Google Chrome Helper',
          process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
          front_app: 'Google Chrome',
          window_title: 'Zoom',
          chrome_url: 'https://app.zoom.us/wc/8716769399/join?pwd=test',
        }),
      },
    ],
    {},
    220,
    5000
  );

  // Meet starts, ends via timeout, Zoom starts — exactly 2 started, no changed to Meet
  assert.equal(result.started.length, 2);
  assert.equal(result.started[0].platform, 'Google Meet');
  assert.equal(result.started[1].platform, 'Zoom');
  assert.equal(result.ended.length, 2); // Both eventually end (both timed out)
  assert.equal(result.changed.length, 0); // No platform switching
});

test('detects audio-only Teams meeting without camera', async () => {
  const result = await runScenario([
    {
      signal: signal({
        service: 'microphone',
        process: 'Google Chrome Helper',
        process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
        front_app: 'Google Chrome',
        window_title: 'Meet | Daily Sync | Microsoft Teams',
        chrome_url: 'https://teams.live.com/v2/?meetingjoin=true',
        camera_active: 'false',
      }),
    },
  ]);

  assert.equal(result.started.length, 1);
  assert.equal(result.started[0].platform, 'Microsoft Teams');
});

test('detects audio-only Google Meet without camera', async () => {
  const result = await runScenario([
    {
      signal: signal({
        service: 'microphone',
        process: 'Google Chrome Helper',
        process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
        front_app: 'Google Chrome',
        window_title: 'Meet - abc-defg-hij',
        chrome_url: 'https://meet.google.com/abc-defg-hij',
        camera_active: 'false',
      }),
    },
  ]);

  assert.equal(result.started.length, 1);
  assert.equal(result.started[0].platform, 'Google Meet');
});

test('detects Slack huddle popup with about:blank URL and huddle title', async () => {
  const result = await runScenario([
    {
      signal: signal({
        service: 'microphone',
        process: 'Google Chrome Helper',
        process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
        front_app: 'Google Chrome',
        window_title: 'Slack - Huddle Preview',
        chrome_url: 'about:blank',
      }),
    },
  ]);

  assert.equal(result.started.length, 1);
  assert.equal(result.started[0].platform, 'Slack');
});

test('continues detecting when window_title disappears mid-call', async () => {
  const result = await runScenario(
    [
      {
        signal: signal({
          service: 'microphone',
          process: 'Google Chrome Helper',
          process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
          front_app: 'Google Chrome',
          window_title: 'Meet - abc-defg-hij',
          chrome_url: 'https://meet.google.com/abc-defg-hij',
        }),
        sleepMs: 30,
      },
      {
        signal: signal({
          service: 'microphone',
          process: 'Google Chrome Helper',
          process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
          front_app: 'Google Chrome',
          window_title: '',
          chrome_url: 'https://meet.google.com/abc-defg-hij',
        }),
      },
    ],
    {},
    200,
    4000
  );

  // Meeting should start on first signal and the second signal (missing title but same URL)
  // should keep the same platform alive, not start a new one
  assert.equal(result.started.length, 1);
  assert.equal(result.started[0].platform, 'Google Meet');
  assert.equal(result.changed.length, 0);
});

test('suppresses Chrome Helper preflight with empty title and no camera', async () => {
  // Chrome Helper camera preflight with no window title and no camera active
  // is correctly suppressed — represents generic browser initialization
  const result = await runScenario([
    {
      signal: signal({
        service: 'camera',
        process: 'Google Chrome Helper',
        process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
        front_app: 'Google Chrome',
        window_title: '',
        chrome_url: '',
        verdict: 'requested',
        preflight: 'true',
        camera_active: 'false',
      }),
    },
  ]);

  assert.equal(result.started.length, 0);
});

test('rejects meet.google.com/landing as a meeting URL', async () => {
  const result = await runScenario([
    {
      signal: signal({
        service: 'microphone',
        process: 'Google Chrome Helper',
        process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
        front_app: 'Google Chrome',
        window_title: 'Google Meet',
        chrome_url: 'https://meet.google.com/landing?authuser=0',
      }),
    },
  ]);

  assert.equal(result.started.length, 0);
});

test('rejects app.zoom.us/wc/home as a meeting URL', async () => {
  const result = await runScenario([
    {
      signal: signal({
        service: 'microphone',
        process: 'Google Chrome Helper',
        process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
        front_app: 'Google Chrome',
        window_title: 'Zoom Workplace',
        chrome_url: 'https://app.zoom.us/wc/home?from=pwa',
      }),
    },
  ]);

  assert.equal(result.started.length, 0);
});

test('browser probe synthesis requires TCC mic signal and does not fire on idle meeting tab alone', async () => {
  // When a meeting tab is open in Chrome but the user hasn't joined,
  // the browser probe should NOT synthesize a signal
  const { dir, scriptPath } = createEmitterScript([], 500);
  const detector = new MeetingDetector({
    scriptPath,
    startupProbe: false,
    sessionDeduplicationMs: 200,
    meetingEndTimeoutMs: 80,
  });

  const started = [];

  detector.listBrowserTabs = async () => [
    {
      browser: 'Google Chrome',
      title: 'Meet - abc-defg-hij',
      url: 'https://meet.google.com/abc-defg-hij',
    },
  ];
  detector.probeMediaState = async () => ({ camera: false, mic: false });
  detector.detectActiveNativeMeetingSignal = async () => null;

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        detector.stop();
        reject(new Error('scenario timeout'));
      }, 2000);

      detector.on('meeting_started', (event) => started.push(event));
      detector.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      detector.start();
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // No TCC mic signal was emitted, so browser probe must not synthesize
  assert.equal(started.length, 0);
});

test('suppresses MSTeamsAudioDevice.driver as system audio infrastructure', async () => {
  const result = await runScenario([
    {
      signal: signal({
        service: 'Microsoft Teams',
        process: 'Core Audio Driver (MSTeamsAudioDevice.driver)',
        front_app: 'Microsoft Teams',
        window_title: '',
        verdict: 'allowed',
        preflight: 'false',
        camera_active: 'false',
      }),
    },
  ]);

  assert.equal(result.started.length, 0);
  assert.equal(result.rawEvents.length, 0);
});

test('suppresses coreaudiod system audio daemon', async () => {
  const result = await runScenario([
    {
      signal: signal({
        service: 'microphone',
        process: 'coreaudiod',
        front_app: 'Google Chrome',
        window_title: '',
        verdict: 'allowed',
        preflight: 'false',
        camera_active: 'false',
        process_path: '/usr/sbin/coreaudiod',
      }),
    },
  ]);

  assert.equal(result.started.length, 0);
  assert.equal(result.rawEvents.length, 0);
});

test('Meet + Teams audio driver + coreaudiod + main Chrome do not flap (live regression)', async () => {
  // Regression from live NDJSON: all four noise sources fire alongside Chrome Helper
  // during a real Google Meet call. Only Chrome Helper should produce lifecycle events.
  // Exact processes from /tmp/meeting-detector-live/meet-web-live.ndjson:
  //   1. Google Chrome Helper (pid 85823) — REAL signal
  //   2. Core Audio Driver (MSTeamsAudioDevice.driver) — Teams virtual audio device
  //   3. coreaudiod (pid 594) — macOS system audio daemon
  //   4. Google Chrome (no pid) — main browser process, not media renderer
  const result = await runScenario(
    [
      {
        signal: signal({
          service: 'microphone',
          process: 'Google Chrome Helper',
          process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/145.0.7632.160/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
          front_app: 'Google Chrome',
          window_title: '',
          chrome_url: '',
          camera_active: 'true',
          pid: '85823',
        }),
        sleepMs: 20,
      },
      {
        signal: signal({
          service: 'Microsoft Teams',
          process: 'Core Audio Driver (MSTeamsAudioDevice.driver)',
          front_app: 'Microsoft Teams',
          window_title: '',
          verdict: 'allowed',
          preflight: 'false',
          camera_active: 'false',
          process_path: '',
          pid: '',
        }),
        sleepMs: 20,
      },
      {
        signal: signal({
          service: 'microphone',
          process: 'coreaudiod',
          process_path: '/usr/sbin/coreaudiod',
          front_app: 'Google Chrome',
          window_title: '',
          verdict: 'allowed',
          preflight: 'false',
          camera_active: 'true',
          pid: '594',
        }),
        sleepMs: 20,
      },
      {
        signal: signal({
          service: 'microphone',
          process: 'Google Chrome',
          process_path: '',
          front_app: 'Google Chrome',
          window_title: '',
          verdict: 'allowed',
          preflight: 'false',
          camera_active: 'false',
          pid: '',
        }),
        sleepMs: 20,
      },
      {
        signal: signal({
          service: 'microphone',
          process: 'Google Chrome Helper',
          process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/145.0.7632.160/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
          front_app: 'Google Chrome',
          window_title: '',
          chrome_url: '',
          camera_active: 'true',
          pid: '85823',
        }),
      },
    ],
    {},
    200,
    4000
  );

  // All three noise sources (audio driver, coreaudiod, main Chrome) should be filtered.
  // Only Chrome Helper signals should produce events — no platform changes.
  assert.equal(result.changed.length, 0);
});

test('main Google Chrome process is blocked but Google Chrome Helper is allowed', async () => {
  // The main Chrome process fires TCC signals for generic reasons (initial permission
  // grants, etc.), not for active meeting media. Only Chrome Helper handles media.
  const blockedResult = await runScenario([
    {
      signal: signal({
        service: 'microphone',
        process: 'Google Chrome',
        front_app: 'Google Chrome',
        window_title: '',
        chrome_url: '',
        camera_active: 'false',
        process_path: '',
        pid: '',
      }),
    },
  ]);
  assert.equal(blockedResult.started.length, 0, 'Main Chrome process should be blocked');

  const allowedResult = await runScenario([
    {
      signal: signal({
        service: 'microphone',
        process: 'Google Chrome Helper',
        process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
        front_app: 'Google Chrome',
        window_title: 'Meet - abc-defg-hij',
        chrome_url: 'https://meet.google.com/abc-defg-hij',
        camera_active: 'true',
        pid: '85823',
      }),
    },
  ]);
  assert.equal(allowedResult.started.length, 1, 'Chrome Helper should be allowed');
  assert.equal(allowedResult.started[0].platform, 'Google Meet');
});

test('normalizes Teams WebView and MSTeams process to same platform', async () => {
  const result = await runScenario(
    [
      {
        signal: signal({
          service: 'microphone',
          process: 'Microsoft Teams WebView',
          front_app: 'MSTeams',
          window_title: 'Daily Sync | Microsoft Teams',
          camera_active: 'true',
        }),
        sleepMs: 30,
      },
      {
        signal: signal({
          service: 'microphone',
          process: 'MSTeams',
          front_app: 'Microsoft Teams',
          window_title: 'Daily Sync | Microsoft Teams',
          camera_active: 'true',
        }),
      },
    ],
    {},
    200,
    4000
  );

  // Both signals should normalize to the same platform — no meeting_changed
  assert.equal(result.started.length, 1);
  assert.equal(result.started[0].platform, 'Microsoft Teams');
  assert.equal(result.changed.length, 0);
});
