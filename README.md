# Meeting Detector

Real-time meeting detection for macOS desktop apps using TCC (Transparency, Consent, and Control) logs.

## Quick Start

```bash
npm install @mostrom/meeting-detector
```

```typescript
import { detector } from '@mostrom/meeting-detector';

const meetingDetector = detector((signal) => {
  console.log('Meeting event:', signal);
}, { debug: true });

meetingDetector.onMeetingStarted((event) => {
  console.log('Meeting started:', event.platform);
});

meetingDetector.onMeetingEnded((event) => {
  console.log('Meeting ended:', event.platform);
});
```

Full documentation: [packages/meeting-detector/README.md](packages/meeting-detector/README.md)

---

## Monorepo Structure

- `packages/meeting-detector` → publishable package (`@mostrom/meeting-detector`)

## Development

```bash
npm install
npm run build
```

## Publish

```bash
npm run publish:npm
```

Version auto-increments. Default access is `public`.
