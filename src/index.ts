import { MeetingDetector, detector } from './detector.js';
import type {
  MeetingLifecycleEvent,
  MeetingPlatform,
  MeetingSignal,
  MeetingDetectorOptions,
} from './types.js';

// Main exports
export { MeetingDetector, detector } from './detector.js';
export * from './types.js';

const CLI_SIGNAL_DEDUPE_MS = 15000;
const CLI_LIFECYCLE_SUPPRESSION_MS = 1500;

function getSignalConfidence(signal: MeetingSignal): MeetingLifecycleEvent['confidence'] {
  if (signal.verdict === 'allowed' || signal.preflight === false) {
    return 'high';
  }
  if ((signal.window_title && signal.window_title.trim() !== '') || signal.camera_active) {
    return 'medium';
  }
  return 'low';
}

function getSignalPlatform(signal: MeetingSignal): MeetingPlatform | null {
  const platform = (signal.service || '').trim();
  if (!platform || platform === 'Unknown') {
    return null;
  }
  return platform as MeetingPlatform;
}

export function getCliDetectorOptions(): MeetingDetectorOptions {
  return {
    debug: false,
  };
}

export function createCliNotifier(
  log: (message: string, payload: Record<string, string>) => void = console.log,
  now: () => number = Date.now
) {
  let lastLifecycleAnnouncementAt = 0;
  let lastSignalAnnouncementAt = 0;
  let lastSignalKey = '';

  const announce = (payload: Record<string, string>) => {
    log('✅ Meeting detected:', payload);
  };

  return {
    handleMeetingStarted(event: MeetingLifecycleEvent) {
      lastLifecycleAnnouncementAt = now();
      announce({
        timestamp: event.timestamp,
        platform: event.platform,
        confidence: event.confidence,
        reason: event.reason,
      });
    },

    handleMeetingChanged(event: MeetingLifecycleEvent) {
      lastLifecycleAnnouncementAt = now();
      announce({
        timestamp: event.timestamp,
        platform: event.platform,
        confidence: event.confidence,
        reason: event.reason,
      });
    },

    handleMeetingSignal(signal: MeetingSignal) {
      const platform = getSignalPlatform(signal);
      if (!platform) {
        return;
      }

      const currentTime = now();
      if (currentTime - lastLifecycleAnnouncementAt < CLI_LIFECYCLE_SUPPRESSION_MS) {
        return;
      }

      const signalKey = [
        platform,
        signal.pid,
        signal.parent_pid,
        signal.process,
        signal.process_path,
        signal.session_id,
        signal.chrome_url || '',
      ].join('|');

      if (signalKey === lastSignalKey && currentTime - lastSignalAnnouncementAt < CLI_SIGNAL_DEDUPE_MS) {
        return;
      }

      lastSignalKey = signalKey;
      lastSignalAnnouncementAt = currentTime;
      announce({
        timestamp: signal.timestamp,
        platform,
        confidence: getSignalConfidence(signal),
        reason: 'signal',
      });
    },
  };
}

// Example usage (only when run directly)
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🔍 Starting meeting detector...');

  const meetingDetector = new MeetingDetector(getCliDetectorOptions());
  const notifier = createCliNotifier();

  meetingDetector.onMeetingStarted((event) => {
    notifier.handleMeetingStarted(event);
  });

  meetingDetector.onMeetingChanged((event) => {
    notifier.handleMeetingChanged(event);
  });

  meetingDetector.onMeeting((signal) => {
    notifier.handleMeetingSignal(signal);
  });

  meetingDetector.onError((error) => {
    console.error('❌ Detector error:', error.message);
  });

  meetingDetector.start();

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
