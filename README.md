# Meeting Detector

Meeting lifecycle detection for desktop meeting apps and browser-hosted meetings.

## Status

This package currently ships a TypeScript/Node detector with a production macOS path.

What it does today:
- emits normalized raw meeting signals
- emits lifecycle events: `meeting_started`, `meeting_changed`, `meeting_ended`
- detects browser-hosted meeting platforms on macOS through TCC/media signals plus browser route/title heuristics
- supports a direct CLI/dev mode for local validation

What is still being hardened:
- native Slack and native Microsoft Teams reliability on macOS
- cross-platform parity
- a scored multi-signal detector core

The active hardening plan lives in [tasks/signal-detection-hardening.md](/Volumes/Samsung/repositories/mostrom/harke/harke-meeting-detector/tasks/signal-detection-hardening.md).

## Current Detection Model

The current implementation combines:
- macOS TCC/media-use signals from `meeting-detect.sh`
- process attribution and normalization
- browser meeting route/title matching
- lifecycle state tracking with dedupe and timeout handling

Supported meeting platforms in the public type surface include:
- `Microsoft Teams`
- `Zoom`
- `Google Meet`
- `Slack`
- `Cisco Webex`
- additional normalized platforms listed in [src/types.ts](/Volumes/Samsung/repositories/mostrom/harke/harke-meeting-detector/src/types.ts)

## Installation

### npm

```bash
npm install @mostrom/meeting-detector
```

### Local development

```bash
git clone <repo-url>
cd harke-meeting-detector
npm install
npm run build
```

## Requirements

- Node.js `>=18`
- macOS for the current production detection path

The package metadata lists `darwin`, `win32`, and `linux`, but the actively validated implementation today is the macOS path. The long-term cross-platform direction is the Rust `napi-rs` core described in [tasks/signal-detection-hardening.md](/Volumes/Samsung/repositories/mostrom/harke/harke-meeting-detector/tasks/signal-detection-hardening.md).

## Quick Start

### Simple API

```ts
import { detector } from '@mostrom/meeting-detector';
import type { MeetingSignal } from '@mostrom/meeting-detector';

const meetingDetector = detector((signal: MeetingSignal) => {
  console.log('Meeting signal:', signal.service, signal.verdict);
}, {
  debug: true,
});

process.on('SIGINT', () => {
  meetingDetector.stop();
  process.exit(0);
});
```

### Lifecycle API

```ts
import { MeetingDetector } from '@mostrom/meeting-detector';

const detector = new MeetingDetector({
  debug: false,
  includeRawSignalInLifecycle: true,
});

detector.onMeetingStarted((event) => {
  console.log('started', event.platform, event.confidence);
});

detector.onMeetingChanged((event) => {
  console.log('changed', event.previous_platform, '->', event.platform);
});

detector.onMeetingEnded((event) => {
  console.log('ended', event.platform, event.reason);
});

detector.onError((error) => {
  console.error(error.message);
});

detector.start();
```

## CLI / Local Validation

Run the built-in notifier:

```bash
npm run dev
```

or after build:

```bash
npm run build
npm start
```

The CLI prints only positive meeting detections and suppresses duplicate/raw noise where possible.

## Repeatable E2E Checks

The operator guide for repeatable web/native verification lives in [docs/testing/meeting-e2e.md](docs/testing/meeting-e2e.md).
Detailed required rules and provider checklists live in [docs/testing/meeting-test-rules.md](docs/testing/meeting-test-rules.md).

Detection-first commands (recommended):

```bash
npm run detect:matrix -- --help
npm run e2e:validate-env -- all
npm run detect:matrix:web -- --dry-run
npm run detect:matrix:native -- --dry-run
npm run detect:matrix:web -- --manual
npm run detect:matrix:native -- --manual
```

Legacy scenario runner commands:

```bash
npm run e2e:validate-env -- web
npm run e2e:web
npm run e2e:validate-env -- native
npm run e2e:native -- --dry-run
E2E_NATIVE_CONFIRM=1 npm run e2e:native
```

- Detector readiness is judged by provider lifecycle evidence in `artifacts/provider-detection/<timestamp>/matrix-summary.json`.
- `detect:matrix` supports `--manual`, `--auto`, and `--dry-run` execution styles.
- Native E2E supports `--dry-run` for non-destructive validation and requires `--confirm-live` or `E2E_NATIVE_CONFIRM=1` for live automation.
- The runners accept Google auth values from either `GOOGLE_EMAIL` / `GOOGLE_APP_PASSWORD` or the legacy `GMAIL_EMAIL` / `GMAIL_APP_PASSWORD` aliases.
- `OTP_CODE_FILE` defaults to `.otp-codes/latest.txt` when unset.

## API

### Exports

- `detector(callback, options?)`
- `MeetingDetector`
- all public types from [src/types.ts](/Volumes/Samsung/repositories/mostrom/harke/harke-meeting-detector/src/types.ts)

### `MeetingDetector` methods

- `start(callback?)`
- `stop()`
- `isRunning()`
- `isUsingNative()`
- `getNativeVersion()`
- `getSupportedPlatforms()`
- `onMeeting(callback)`
- `onMeetingStarted(callback)`
- `onMeetingChanged(callback)`
- `onMeetingEnded(callback)`
- `onError(callback)`

### Events

- `meeting`
- `meeting_started`
- `meeting_changed`
- `meeting_ended`
- `error`
- `exit`

### Options

```ts
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

## Emitted Types

```ts
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
  mic_active?: boolean;
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
```

## Known Limitations

- macOS is the only actively validated detection path right now.
- Browser meeting detection without an extension depends on route/title heuristics and can miss minimized/inactive-tab edge cases.
- Native Slack and native Microsoft Teams detection are under active hardening.
- The current implementation is heuristic-driven; it is being redesigned toward a weighted scoring model instead of single-signal gates.

## Success Criteria

The active release checklist lives in [tasks/success-criteria.md](/Volumes/Samsung/repositories/mostrom/harke/harke-meeting-detector/tasks/success-criteria.md). It includes:
- core meeting lifecycle behavior
- browser/native support expectations
- edge-case gates such as stale browser handoff, preview/lobby suppression, popup windows, same-platform rejoins, and timeout stability

## Development

```bash
npm run build
npm run build:all
npm test
npm run e2e:validate-env -- all
npm run test:native
npm run dev
```

Useful files:
- [src/detector.ts](/Volumes/Samsung/repositories/mostrom/harke/harke-meeting-detector/src/detector.ts)
- [src/index.ts](/Volumes/Samsung/repositories/mostrom/harke/harke-meeting-detector/src/index.ts)
- [src/types.ts](/Volumes/Samsung/repositories/mostrom/harke/harke-meeting-detector/src/types.ts)
- [tasks/signal-detection-hardening.md](/Volumes/Samsung/repositories/mostrom/harke/harke-meeting-detector/tasks/signal-detection-hardening.md)
- [tasks/success-criteria.md](/Volumes/Samsung/repositories/mostrom/harke/harke-meeting-detector/tasks/success-criteria.md)

## License

MIT
