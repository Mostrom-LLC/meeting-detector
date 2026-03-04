import { MeetingDetector } from './dist/detector.js';

// Test deduplication with a short window
const detector = new MeetingDetector({
  debug: true,
  sessionDeduplicationMs: 5000 // 5 seconds for testing
});

let eventCount = 0;

detector.onMeeting((signal) => {
  eventCount++;
  console.log(`\n=== Event ${eventCount} received ===`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Service: ${signal.service}`);
  console.log(`Process: ${signal.process} (PID: ${signal.pid})`);
  console.log(`Front App: ${signal.front_app}`);
  console.log(`Session Key: ${signal.pid}:${signal.service}:${signal.front_app}`);
});

detector.onError((error) => {
  console.error('Error:', error);
});

console.log('Starting meeting detector with 5-second deduplication window...');
console.log('Watching for meeting signals. Duplicate sessions will be filtered.\n');

detector.start();

// Stop after 2 minutes
setTimeout(() => {
  console.log('\n\nStopping detector...');
  console.log(`Total unique meeting events detected: ${eventCount}`);
  detector.stop();
  process.exit(0);
}, 120000);
