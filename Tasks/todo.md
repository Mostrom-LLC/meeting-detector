# Meeting Detector Live Test Plan

## Scope

- [x] Review acceptance criteria and prior lessons before execution
- [x] Verify local prerequisites: installed apps, credentials presence, detector scripts, permissions/runtime
- [x] Run baseline automated tests before live manual testing

## Verification Matrix

- [x] Validate detector logging with a controlled browser media-access probe
- [x] Test Google Meet in Google Chrome
- [x] Test Microsoft Teams in web browser and document blocker
- [x] Test Microsoft Teams native macOS app path and document blocker
- [x] Test additional available platform(s) where account setup is feasible in-session
- [x] Confirm meetings are closed cleanly after each scenario

## Evidence Capture

- [x] Capture detector event logs for each scenario
- [x] Compare observed behavior to `Tasks/success-criteria.md`
- [x] Record false positives, missed detections, timing issues, and attribution quality
- [x] Note any platform/account blockers separately from detector failures

## Review

- [x] Summarize which scenarios passed, failed, or were blocked
- [x] Document concrete improvement opportunities backed by logs

### Results Summary

- Baseline build passed with `npm run build`, but `npm test` is currently broken on this machine because `node --test test/` resolves to `MODULE_NOT_FOUND` under Node 22.
- Controlled Chrome media probe produced a Chrome Helper camera request that the detector suppressed as `Unknown`, which is the correct outcome for non-meeting media access.
- Google Meet web in Chrome passed end-to-end: `meeting_started` emitted as `Google Meet` with `confidence=high`, then `meeting_ended` fired on inactivity timeout after leaving the call.
- Jitsi web produced a likely false positive: the page reported `You need to enable microphone and camera access`, but the detector still emitted `meeting_started` for `Jitsi Meet` on a `requested` + `preflight=true` signal.
- Slack startup probe produced a likely false positive: with Slack merely running, startup probing emitted `meeting_started` for `Slack` with empty PID/process path metadata.
- Microsoft Teams web could not be completed with project credentials because `.env` does not contain a usable Google web-login password and Microsoft consumer signup/login flows did not accept synthetic submission in the fresh browser session.
- Microsoft Teams native app path could not be completed in this session because the app window was not interactable on the active desktop space and native UI automation was blocked by missing Accessibility access for `osascript`.

### Evidence

- Google Meet pass: `todo/meeting-audit-2026-03-14/google-meet-web/events.ndjson`
- Jitsi false positive: `todo/meeting-audit-2026-03-14/jitsi-web/events.ndjson`
- Slack startup false positive: `todo/meeting-audit-2026-03-14/slack-startup-probe/events.ndjson`
- Controlled probe session: `todo/meeting-audit-2026-03-14/controlled-probe/custom-events.ndjson`

### Improvement Priorities

- Tighten preflight handling for browser platforms beyond Google Meet; Jitsi should not start a meeting when the page still says media access is unavailable.
- Harden startup probing for Slack/native apps; require stronger evidence than `camera_active=true` with empty PID/path fields.
- Fix the package test script so baseline verification is reliable on current Node versions.
- Expose a first-class audit runner option for `startupProbe=false` so manual scenario testing can avoid startup inference noise.
