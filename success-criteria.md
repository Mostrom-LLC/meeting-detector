## Core Criteria

- [ ] Detect active meetings with normalized platform identity
- [ ] Support browser-based and native meeting sources (macOS path)
- [ ] Validate Google Meet for both web and native/desktop-hosted meeting paths
- [ ] Handle foreground/background/minimized attribution path for supported signals
- [ ] Trigger quickly on strong meeting evidence
- [ ] Infer/emit meeting end via inactivity timeout (`meeting_ended`)
- [ ] Suppress low-confidence launch preflight false positives
- [ ] Handle repeated join/leave cycles without stale state
- [ ] Provide stable consumer hooks: `meeting_started`, `meeting_changed`, `meeting_ended`
- [ ] Ensure uncertain signals are `Unknown` or suppressed by default (no blind guessing)
- [ ] Keep runtime stable with dedup + timeout state cleanup
- [ ] Redact sensitive metadata by default in emitted signals

## Edge-Case Criteria

- [ ] Reject stale browser handoff after a real meeting ends; browsing generic Teams, Meet, Zoom, or Slack pages after a call must emit nothing.
- [ ] Suppress post-call cleanup and redirect pages that briefly retain media access after leave/close flows.
- [ ] Keep preview, lobby, waiting-room, and guest-name-entry surfaces non-meetings until actual join/admission.
- [ ] Maintain browser-probe parity: every matcher must behave consistently in the AppleScript tab probe, `transformAppName()`, and `hasStrongBrowserMeetingRoute()`.
- [ ] Detect Slack/Chromium popup meetings that use `about:blank` or transient URLs when the title carries the meeting signal.
- [ ] Prevent generic platform landing pages, docs pages, and signed-in home surfaces from inheriting the previous meeting platform.
- [ ] Emit a new lifecycle for same-platform rejoins instead of hiding them behind service-level dedupe.
- [ ] Resolve multiple tabs or windows for the same platform without keeping the wrong prejoin/live/post-call state alive.
- [ ] Resolve cross-platform overlap correctly when multiple meeting apps or browser meeting tabs are open at the same time.
- [ ] Prevent rapid platform flapping when a stale ended browser meeting tab remains open and a new browser meeting starts; for example, an ended Google Meet tab must not alternate with a newly started Zoom web meeting.
- [ ] Prevent delayed dual-browser surfacing; starting a second browser meeting must not cause a missed first browser meeting to appear at the same time or within the next second.
- [ ] Suppress idle native helpers and webviews that request media without an actual meeting starting.
- [ ] Handle auth, redirect, launcher, and deep-link trampoline pages without premature starts or missed real joins.
- [ ] Continue detecting correctly when one of `window_title` or `chrome_url` disappears.
- [ ] Detect audio-only and screen-share-first meetings without requiring camera-first behavior.
- [ ] Suppress browser permission prompts, hardware test pages, and generic `getUserMedia` pages even after a prior real meeting.
- [ ] Tune meeting-end timeout to avoid both stale carryover and premature meeting end during temporary device renegotiation.
- [ ] Prevent stale `front_app` or `window_title` service context from keeping an old platform alive after navigation or handoff.
- [ ] Normalize browser, PWA, Electron/native-wrapper, and helper-process variants of the same meeting product consistently.
- [ ] Degrade safely in private/incognito or enterprise-managed browser modes where titles, URLs, or automation are reduced.
