import { detector } from './detector.js';
import type { MeetingSignal } from './types.js';

// Main exports
export { MeetingDetector, detector } from './detector.js';
export * from './types.js';

// Example usage (only when run directly)
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🔍 Starting meeting detector...');
  
  const meetingDetector = detector((stateChange: MeetingSignal) => {
    console.log('📱 Meeting signal:', stateChange);
  }, { debug: true });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n⏹️  Stopping meeting detector...');
    meetingDetector.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    meetingDetector.stop();
    process.exit(0);
  });
}