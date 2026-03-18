#!/usr/bin/env node
// live-test.mjs — Runs the detector for a fixed duration, captures all events,
// and writes them to an NDJSON file for analysis.
//
// Usage: node scripts/live-test.mjs [--duration 30] [--out events.ndjson] [--label "test name"]

import { MeetingDetector } from '../dist/detector.js';

const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
}

const duration = parseInt(getArg('duration', '30'), 10) * 1000;
const outFile = getArg('out', null);
const label = getArg('label', 'live-test');

const events = [];

const detector = new MeetingDetector({
  debug: false,
  includeRawSignalInLifecycle: true,
  startupProbe: true,
});

detector.on('meeting_started', (e) => {
  const entry = { ts: Date.now(), type: 'started', ...e };
  events.push(entry);
  console.log(`[${label}] ✅ STARTED: ${e.platform} (${e.confidence}) mic=${e.raw_signal?.mic_active} cam=${e.raw_signal?.camera_active}`);
});

detector.on('meeting_changed', (e) => {
  const entry = { ts: Date.now(), type: 'changed', ...e };
  events.push(entry);
  console.log(`[${label}] 🔄 CHANGED: ${e.previous_platform} → ${e.platform} (${e.confidence})`);
});

detector.on('meeting_ended', (e) => {
  const entry = { ts: Date.now(), type: 'ended', ...e };
  events.push(entry);
  console.log(`[${label}] ⏹️  ENDED: ${e.platform} (reason: ${e.reason})`);
});

detector.on('error', (e) => {
  console.error(`[${label}] ❌ ERROR:`, e.message);
});

console.log(`[${label}] Starting detector for ${duration / 1000}s...`);
detector.start();

setTimeout(async () => {
  detector.stop();
  console.log(`[${label}] Stopped. Total events: ${events.length}`);

  if (outFile) {
    const fs = await import('node:fs');
    fs.writeFileSync(outFile, events.map(e => JSON.stringify(e)).join('\n') + '\n');
    console.log(`[${label}] Events written to ${outFile}`);
  }

  // Summary
  const started = events.filter(e => e.type === 'started');
  const changed = events.filter(e => e.type === 'changed');
  const ended = events.filter(e => e.type === 'ended');
  console.log(`\n[${label}] Summary:`);
  console.log(`  Started: ${started.length} (${started.map(e => e.platform).join(', ') || 'none'})`);
  console.log(`  Changed: ${changed.length}`);
  console.log(`  Ended: ${ended.length}`);

  process.exit(0);
}, duration);
