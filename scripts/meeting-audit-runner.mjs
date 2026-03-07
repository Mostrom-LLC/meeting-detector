import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { MeetingDetector } from '../packages/meeting-detector/dist/detector.js';

function getArg(name, fallback = '') {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) {
    return fallback;
  }
  return process.argv[idx + 1];
}

const outPath = resolve(getArg('--out', `./todo/meeting-audit-${new Date().toISOString().slice(0, 10)}/events.ndjson`));
const dedupeMsRaw = getArg('--dedupe-ms', '60000');
const dedupeMs = Number.isFinite(Number(dedupeMsRaw)) ? Number(dedupeMsRaw) : 60000;
const debug = getArg('--debug', 'true') !== 'false';

mkdirSync(dirname(outPath), { recursive: true });
const stream = createWriteStream(outPath, { flags: 'a' });

function writeRecord(type, payload = {}) {
  const record = {
    type,
    recorded_at: new Date().toISOString(),
    ...payload
  };
  stream.write(`${JSON.stringify(record)}\n`);
}

const detector = new MeetingDetector({
  debug,
  sessionDeduplicationMs: dedupeMs
});

writeRecord('session_start', {
  pid: process.pid,
  out_path: outPath,
  dedupe_ms: dedupeMs,
  debug
});

console.log(`[audit] writing detector events to: ${outPath}`);
console.log(`[audit] dedupe window: ${dedupeMs}ms`);

let eventCount = 0;
let errorCount = 0;

detector.onMeeting((signal) => {
  eventCount += 1;
  writeRecord('meeting_signal', { event_index: eventCount, signal });
  console.log(`[audit] meeting_signal #${eventCount}: ${signal.service} | ${signal.process} | pid=${signal.pid} | front=${signal.front_app}`);
});

detector.onError((error) => {
  errorCount += 1;
  writeRecord('detector_error', { error_index: errorCount, message: error.message });
  console.error(`[audit] detector_error #${errorCount}: ${error.message}`);
});

detector.on('exit', ({ code, signal }) => {
  writeRecord('detector_exit', { code, signal });
  console.error(`[audit] detector_exit: code=${code} signal=${signal}`);
});

detector.start();

function shutdown(reason) {
  writeRecord('session_stop', { reason, event_count: eventCount, error_count: errorCount });
  detector.stop();
  stream.end(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
