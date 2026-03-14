# Meeting Detector Live Test Plan

## Scope

- [x] Review acceptance criteria and prior lessons before execution
- [x] Verify local prerequisites: installed apps, credentials presence, detector scripts, permissions/runtime
- [x] Run baseline automated tests before live manual testing

## Verification Matrix

- [x] Validate detector logging with a controlled browser media-access probe
- [x] Test Google Meet in Google Chrome
- [ ] Test Microsoft Teams with a real live meeting pass
- [ ] Test Slack with a real live meeting pass
- [x] Test Zoom with a real live meeting pass
- [ ] Confirm meetings are closed cleanly after each live scenario

## Active Execution Plan

- [ ] Drive the existing Teams guest-join flow past preview and waiting-room state into an admitted live meeting, then capture the detector event trace.
- [x] Re-run Zoom against the patched detector and record a live `meeting_started` plus cleanup trace.
- [ ] Acquire a working Slack session using the provided Google credentials or workspace SSO flow, start a real huddle/call, and capture the detector trace.
- [ ] Re-verify that all meeting windows, tabs, and native apps are closed after each pass.

## Evidence Capture

- [x] Capture detector event logs for each scenario
- [x] Compare observed behavior to `tasks/success-criteria.md`
- [x] Record false positives, missed detections, timing issues, and attribution quality
- [x] Note any platform/account blockers separately from detector failures

## Review

- [ ] Summarize which scenarios passed, failed, or were blocked
- [ ] Document concrete improvement opportunities backed by logs

### Results Summary

- Baseline build passed with `npm run build`, but `npm test` is currently broken on this machine because `node --test test/` resolves to `MODULE_NOT_FOUND` under Node 22.
- Controlled Chrome media probe produced a Chrome Helper camera request that the detector suppressed as `Unknown`, which is the correct outcome for non-meeting media access.
- Google Meet web in Chrome passed end-to-end: `meeting_started` emitted as `Google Meet` with `confidence=high`, then `meeting_ended` fired on inactivity timeout after leaving the call.
- Zoom web now also passes end-to-end: after creating a Zoom account through Google SSO, the host meeting page emitted `meeting_started` as `Zoom` with `confidence=high`, then `meeting_ended` after media tracks were stopped and the page was closed.
- Slack still does not have a live-pass artifact. Workspace creation succeeded and the channel page is usable, but repeated DOM and raw CDP pointer/keyboard attempts against the visible `Start huddle in new-channel` control only surfaced Slack's onboarding tooltip and never transitioned into a live huddle state.
- Microsoft Teams still does not have a full-join live-pass artifact. The deeper host flow was blocked during Microsoft account creation by the `Let's prove you're human` press-and-hold verification challenge, which rejected synthetic input and prevented reaching a joined meeting state.
- Jitsi and Slack startup results remain useful defect evidence, but they are not substitutes for the required live-pass matrix.

### Evidence

- Google Meet pass: `todo/meeting-audit-2026-03-14/google-meet-web/events.ndjson`
- Zoom pass: `todo/meeting-audit-2026-03-14/zoom-web-pass-live/events.ndjson`
- Teams guest/waiting-room trace only: `todo/meeting-audit-2026-03-14/teams-web-pass/events.ndjson`
- Slack workspace setup attempt: `todo/meeting-audit-2026-03-14/slack-web-pass-live/events.ndjson`
- Jitsi false positive: `todo/meeting-audit-2026-03-14/jitsi-web/events.ndjson`
- Slack startup false positive: `todo/meeting-audit-2026-03-14/slack-startup-probe/events.ndjson`
- Controlled probe session: `todo/meeting-audit-2026-03-14/controlled-probe/custom-events.ndjson`

### Improvement Priorities

- Tighten preflight handling for browser platforms beyond Google Meet; Jitsi should not start a meeting when the page still says media access is unavailable.
- Harden startup probing for Slack/native apps; require stronger evidence than `camera_active=true` with empty PID/path fields.
- Fix the package test script so baseline verification is reliable on current Node versions.
- Expose a first-class audit runner option for `startupProbe=false` so manual scenario testing can avoid startup inference noise.

### Manual Completion Checklist

- [ ] Microsoft Teams web: on the existing `Let's prove you're human` page, complete the press-and-hold challenge, finish Microsoft account creation for `agent@mostrom.io`, start or join a Teams meeting, enter a display name if prompted, press `Join`, wait until fully admitted, then capture a detector trace showing `meeting_started` and `meeting_ended`.
- [ ] Slack web: from the `Mostrom` workspace in `#new-channel`, start a real huddle from the visible `Huddle` header control, wait for the live huddle UI to appear, confirm detector output records a live pass, then end the huddle and confirm cleanup.
- [ ] Native app coverage: if native Slack, Zoom, Teams, or Chrome-hosted desktop surfaces are in scope for the release gate, manually launch each native app path, enter a real meeting/huddle, verify detector attribution, then fully quit or leave each app/session.
- [ ] Cleanup check: confirm no meeting tabs, meeting windows, or native call surfaces remain open after the final manual pass.

### Reopened Execution Gate

- This task is not complete until `Google Meet` and `Zoom` remain recorded live passes, and `Slack` plus `Microsoft Teams` receive either recorded live meeting passes or an explicit manual verification sign-off with cleanup confirmation.

# Repo Cleanup Plan

## Scope

- [x] Convert repo references from `packages/meeting-detector` to the root package layout
- [x] Fix root package scripts for current Node/ESM behavior
- [x] Remove generated artifacts and stale local build output
- [x] Verify root package commands after cleanup

## Notes

- The package now lives at repository root, so CI, publish scripts, and local tooling should target `.` and `native/`.
- The root `dev` script must use the ESM ts-node entrypoint under Node 22.
- Verification after cleanup: `npm run build`, `npm test`, and a smoke-run of `npm run dev` all succeed from repository root.
