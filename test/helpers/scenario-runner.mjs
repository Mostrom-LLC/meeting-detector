import { MeetingDetector } from '../../dist/detector.js';
import { createProviderSignal } from './signal-fixtures.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runScenario(lines, options = {}) {
  const {
    tailSleepMs = 0,
    timeoutMs = 3000,
    meetingEndTimeoutMs = 80,
    detectorOptions = {},
  } = options;

  const detector = new MeetingDetector({
    sessionDeduplicationMs: 200,
    meetingEndTimeoutMs,
    startupProbe: false,
    ...detectorOptions,
  });

  detector.listBrowserTabs = async () => [];
  detector.detectActiveNativeMeetingSignal = async () => null;

  const rawEvents = [];
  const started = [];
  const changed = [];
  const ended = [];
  const errors = [];

  detector.on('meeting', (event) => rawEvents.push(event));
  detector.on('meeting_started', (event) => started.push(event));
  detector.on('meeting_changed', (event) => changed.push(event));
  detector.on('meeting_ended', (event) => ended.push(event));
  detector.on('error', (error) => errors.push(error));

  detector.startManual();

  // Feed signals with timing
  for (const item of lines) {
    detector.feedSignal(item.signal);
    if (item.sleepMs && item.sleepMs > 0) {
      await sleep(item.sleepMs);
    }
  }

  // Wait for tail sleep (allows meeting_ended timeouts to fire)
  if (tailSleepMs > 0) {
    await sleep(tailSleepMs);
  }

  detector.stop();

  return { rawEvents, started, changed, ended, errors };
}

export async function runProviderMatrixScenario(provider, options = {}) {
  const signal = createProviderSignal(provider, options.signalOverrides);
  return runScenario([{ signal }], {
    ...options,
    tailSleepMs: options.tailSleepMs ?? 220,
    timeoutMs: options.timeoutMs ?? 4000,
    meetingEndTimeoutMs: options.meetingEndTimeoutMs ?? 80,
  });
}
