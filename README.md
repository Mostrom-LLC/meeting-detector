# Meeting Detector

Real-time meeting detection for macOS desktop apps using TCC (Transparency, Consent, and Control) logs.

## Features

- 🎯 **App-agnostic**: Works with Zoom, Slack, Teams, Chrome, and any desktop meeting app
- ⚡ **Real-time**: Detects meeting start/stop events as they happen
- 🔍 **Process attribution**: Identifies which app is using camera/microphone with PID
- 🎛️ **Event-driven**: Clean Node.js API with TypeScript support
- 🚫 **Smart deduplication**: Prevents spam from multi-process apps like Teams
- 📱 **Front app correlation**: Shows which app is currently in focus

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
  console.log(`${signal.process} is using ${signal.service}`);
  if (signal.verdict === 'requested') {
    console.log('🔴 Meeting started');
  }
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
- `onError(callback)` - Add error event listener

#### Events
- `meeting` - Emitted when meeting state changes
- `error` - Emitted on errors
- `exit` - Emitted when process exits

## Example Output

```json
{
  "event": "meeting_signal",
  "timestamp": "2025-09-01T14:30:29Z",
  "service": "microphone",
  "verdict": "requested", 
  "process": "Microsoft Teams WebView Helper",
  "pid": "7390",
  "front_app": "MSTeams",
  "camera_active": true
}
```

## TypeScript Types

```typescript
interface MeetingSignal {
  event: 'meeting_signal';
  timestamp: string;
  service: 'microphone' | 'camera' | '';
  verdict: 'requested' | 'allowed' | 'denied' | '';
  process: string;
  pid: string;
  front_app: string;
  camera_active: boolean;
}

interface MeetingDetectorOptions {
  scriptPath?: string;  // Path to bash script (default: './meeting-detect.sh')
  debug?: boolean;      // Enable debug logging (default: false)
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