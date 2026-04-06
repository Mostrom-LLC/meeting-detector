import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MeetingDetector } from '../../dist/detector.js';
import { createProviderSignal } from './signal-fixtures.mjs';

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

export async function runScenario(lines, options = {}) {
  const {
    tailSleepMs = 0,
    timeoutMs = 3000,
    meetingEndTimeoutMs = 80,
    detectorOptions = {},
  } = options;

  const { dir, scriptPath } = createEmitterScript(lines, tailSleepMs);
  const detector = new MeetingDetector({
    scriptPath,
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

  let settled = false;
  let stopRequested = false;

  const requestStop = () => {
    if (stopRequested) {
      return;
    }
    stopRequested = true;
    detector.stop();
  };

  try {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        requestStop();
        reject(new Error('scenario timeout'));
      }, timeoutMs);

      detector.on('meeting', (event) => rawEvents.push(event));
      detector.on('meeting_started', (event) => started.push(event));
      detector.on('meeting_changed', (event) => changed.push(event));
      detector.on('meeting_ended', (event) => {
        ended.push(event);
        setImmediate(requestStop);
      });
      detector.on('error', (error) => errors.push(error));
      detector.on('exit', () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve({ rawEvents, started, changed, ended, errors });
      });

      detector.start();
    });
  } finally {
    requestStop();
    rmSync(dir, { recursive: true, force: true });
  }
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
