# Meeting Detector

Real-time meeting detection for macOS desktop apps using TCC (Transparency, Consent, and Control) logs.

## Features

- 🎯 **App-agnostic**: Works with Zoom, Slack, Teams, Chrome, and any desktop meeting app
- ⚡ **Real-time**: Detects meeting start/stop events as they happen
- 🔍 **Process attribution**: Identifies which app is using camera/microphone with PID
- 🎛️ **Event-driven**: Clean Node.js API with TypeScript support
- 🚫 **Smart deduplication**: Prevents spam from multi-process apps like Teams
- 🔁 **Lifecycle hooks**: Emits `meeting_started`, `meeting_changed`, and `meeting_ended`
- 🧠 **Uncertainty-safe**: Uses `Unknown`/no-detection instead of guessing
- 🔒 **Privacy-first**: Redacts sensitive metadata by default

## Installation

### From npm (when published)
```bash
npm install @mostrom/meeting-detector
```

### Local development
```bash
git clone <repo-url>
cd meeting-detector
npm install
npm run build
```

### As a local dependency
```bash
# In your project's package.json
{
  "dependencies": {
    "@mostrom/meeting-detector": "file:../path/to/meeting-detector"
  }
}
```

### Using npm link
```bash
# In meeting-detector directory
npm link

# In your project directory
npm link @mostrom/meeting-detector
```

## Quick Start

### Simple API
```typescript
import { detector } from '@mostrom/meeting-detector';
import type { MeetingSignal } from '@mostrom/meeting-detector';

const meetingDetector = detector((signal: MeetingSignal) => {
  console.log('Meeting event:', signal);
}, { debug: true });

// Graceful shutdown
process.on('SIGINT', () => {
  meetingDetector.stop();
  process.exit(0);
});
```

### Class API
```typescript
import { MeetingDetector } from '@mostrom/meeting-detector';
import type { MeetingSignal } from '@mostrom/meeting-detector';

const detector = new MeetingDetector({ debug: true });

detector.onMeeting((signal: MeetingSignal) => {
  console.log('Raw signal:', signal.service, signal.verdict);
});

detector.onMeetingStarted((event) => {
  console.log(`✅ Started: ${event.platform}`);
});

detector.onMeetingChanged((event) => {
  console.log(`🔄 Changed: ${event.previous_platform} -> ${event.platform}`);
});

detector.onMeetingEnded((event) => {
  console.log(`⏹️ Ended: ${event.platform} (${event.reason})`);
});

detector.onError((error) => {
  console.error('Detection error:', error);
});

detector.start();

// Later...
detector.stop();
```

## API Reference

### `detector(callback, options?)`
Convenience function for simple usage.

### `MeetingDetector` Class

#### Constructor
```typescript
new MeetingDetector(options?: MeetingDetectorOptions)
```

#### Methods
- `start(callback?)` - Start monitoring
- `stop()` - Stop monitoring  
- `isRunning()` - Check if running
- `onMeeting(callback)` - Add meeting event listener
- `onMeetingStarted(callback)` - Add meeting started listener
- `onMeetingChanged(callback)` - Add meeting changed listener
- `onMeetingEnded(callback)` - Add meeting ended listener
- `onError(callback)` - Add error event listener

#### Events
- `meeting` - Emitted for normalized raw meeting signals
- `meeting_started` - Emitted when active meeting starts
- `meeting_changed` - Emitted when active platform changes
- `meeting_ended` - Emitted when meeting ends (timeout/stop)
- `error` - Emitted on errors
- `exit` - Emitted when process exits

## Example Output

```json
{
  "event": "meeting_started",
  "timestamp": "2026-03-07T12:30:29.000Z",
  "platform": "Microsoft Teams",
  "confidence": "high",
  "reason": "signal"
}
```

## TypeScript Types

```typescript
type MeetingPlatform =
  | 'Microsoft Teams'
  | 'Zoom'
  | 'Google Meet'
  | 'Slack'
  | 'Cisco Webex'
  | 'Unknown';

interface MeetingSignal {
  event: 'meeting_signal';
  timestamp: string;
  service: string;
  verdict: 'requested' | 'allowed' | 'denied' | '';
  preflight?: boolean;
  process: string;
  pid: string;
  parent_pid: string;
  process_path: string;
  front_app: string;
  window_title: string;
  session_id: string;
  camera_active: boolean;
  chrome_url?: string;
}

interface MeetingLifecycleEvent {
  event: 'meeting_started' | 'meeting_changed' | 'meeting_ended';
  timestamp: string;
  platform: MeetingPlatform;
  previous_platform?: MeetingPlatform;
  confidence: 'high' | 'medium' | 'low';
  reason: 'signal' | 'switch' | 'timeout' | 'stop';
  raw_signal?: MeetingSignal;
}

interface MeetingDetectorOptions {
  scriptPath?: string;
  debug?: boolean;
  sessionDeduplicationMs?: number;
  meetingEndTimeoutMs?: number;
  emitUnknown?: boolean;
  includeSensitiveMetadata?: boolean;
  includeRawSignalInLifecycle?: boolean;
  startupProbe?: boolean;
}
```

## Development

```bash
# Run in development mode
npm run dev

# Build TypeScript
npm run build

# Watch for changes
npm run watch

# Prepare for publishing
npm run prepublishOnly
```

## Requirements

- macOS 10.14+ (uses TCC privacy logs)
- Node.js 14.0+
- TypeScript 4.5+ (for development)

## How It Works

The detector runs a bash script that monitors macOS TCC (privacy) logs for microphone and camera access events. It uses:

1. **TCC Log Streaming** - Monitors `com.apple.TCC` subsystem logs
2. **Process Attribution** - Extracts PIDs from `target_token` fields  
3. **Smart Deduplication** - Prevents spam from multi-process apps
4. **State Tracking** - Only emits when meaningful changes occur

## License

MIT
