// Example: using @mostrom/meeting-detector with the native Rust backend
import { MeetingDetector } from './dist/index.js';

const detector = new MeetingDetector({ debug: true });

detector.onMeetingStarted((event) => {
  console.log('Meeting started:', event.platform, event.confidence);
});

detector.onMeetingEnded((event) => {
  console.log('Meeting ended:', event.platform);
});

detector.onMeeting((signal) => {
  console.log('Meeting signal:', {
    service: signal.service,
    process: signal.process,
    camera_active: signal.camera_active,
    timestamp: signal.timestamp,
  });
});

detector.start();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  detector.stop();
  process.exit(0);
});
