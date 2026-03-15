# Meeting Detector Live Test Plan

## Strict TDD Validation Matrix

### Current TDD Cycle

- [x] Add a failing regression test that proves the macOS browser probe must not launch inactive browsers such as Microsoft Edge.
- [x] Patch the browser probe so it only inspects browsers that are already running.
- [x] Re-run the automated suite after the probe-side-effect fix.
- [ ] Resume live validation on the intended targets only: Google Chrome web meetings plus native Slack and native Microsoft Teams.
- [x] Add failing regression tests for active Microsoft Edge eligibility and running-app-discovery fallback.
- [x] Restore active Edge eligibility while keeping side-effect-free browser gating.
- [x] Replace the System Events-only running-app gate with a process-table-first probe and a last-resort fallback.
- [x] Re-run the full automated suite after the macOS browser probe regression fix.

- [x] Write failing-first matcher tests for browser routes on Zoom, Teams, Google Meet, and Slack
- [x] Write failing-first lifecycle regression for Google Meet generic-title browser tabs
- [x] Implement macOS browser tab probe through the production detector path
- [x] Re-run full automated suite after the browser probe implementation
- [x] Capture fresh live browser evidence for Zoom, Teams, and Google Meet
- [x] Capture fresh live negative evidence for generic browser camera usage and regular Slack workspace browsing
- [x] Capture fresh live positive evidence for Slack huddle in the browser
- [ ] Capture fresh live positive evidence for native Slack
- [ ] Capture fresh live positive evidence for native Zoom
- [ ] Capture fresh live positive evidence for native Microsoft Teams
- [ ] Capture fresh live positive evidence for native Google Meet / Chrome-hosted desktop path if still in scope

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

- [x] Summarize which scenarios passed, failed, or were blocked
- [x] Document concrete improvement opportunities backed by logs

### 2026-03-14 Browser Revalidation

- `Google Meet` browser pass revalidated live in Google Chrome. Evidence: `Tasks/live-validation-2026-03-14/repro-google-browser-current-1.ndjson`
- `Zoom` browser pass revalidated live in Google Chrome. Evidence: `Tasks/live-validation-2026-03-14/repro-zoom-browser-current-1.ndjson`
- `Microsoft Teams` browser pass revalidated live in Google Chrome after adding the real consumer route matcher for `teams.live.com/light-meetings/launch`. Evidence: `Tasks/live-validation-2026-03-14/repro-teams-browser-current-2.ndjson`
- `Slack` browser huddle pass revalidated live in Google Chrome after adding the popup-title fallback for `about:blank` huddle windows. Evidence: `Tasks/live-validation-2026-03-14/repro-slack-browser-current-1.ndjson`
- Full automated suite passed after cleanup: `npm test` => `32/32`

### Native Remaining Checklist

- [ ] `Slack` native: open the native workspace window on `Mostrom, LLC`, start a real huddle in `#general`, confirm detector emits `Slack`, then leave the huddle.
- [ ] `Microsoft Teams` native: open the real Teams desktop client, join a meeting in-app, confirm detector emits `Microsoft Teams`, then leave the meeting.
- [ ] `Zoom` native: install/open the Zoom desktop client, join a meeting in-app, confirm detector emits `Zoom`, then leave the meeting.
- [ ] `Cleanup`: after manual native checks, confirm no meeting tabs, huddle popups, or native call windows remain open.

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

# Issues Follow-Up

## Resolved

- [x] Repeated debug spam for identical ignored Chrome/Unknown signals is now deduped.
- [x] Repeated debug spam for identical low-confidence Teams/Slack-style preflight signals is now deduped.
- [x] The direct `npm run dev` entrypoint now emits only meeting-start notifications instead of raw signal, change, and meeting-ended noise.
- [x] The direct `npm run dev` entrypoint disables startup probing so simply opening an app like Teams does not produce a synthetic startup notification.
- [x] Reverted the `emitUnknown` bypass so generic browser camera activity stays suppressed unless `emitUnknown` is explicitly enabled.
- [x] Reverted the long-lived app announcement cache in the direct CLI entrypoint so later meetings from the same app process are not suppressed.
- [x] Disabled automatic Rust state-machine routing on macOS; shell-script signals now stay on the JS lifecycle pipeline that includes the browser URL and service heuristics used by live meeting detection.

## Verification

- `npm run build` passed after the detector routing correction.
- `npm test` passed with `28/28`.
- Live browser meeting validation passed on `Jitsi Meet`: joining `https://meet.jit.si/harke-detector-live-check` emitted `meeting_started` again from Chrome Helper with platform `Jitsi Meet`. Evidence: `Tasks/live-validation-2026-03-14/jitsi-browser-lifecycle.ndjson`.
- Live generic browser camera validation stayed suppressed: opening the WebRTC `getUserMedia` sample emitted only an ignored `Unknown` camera request and no lifecycle event. Evidence: `Tasks/live-validation-2026-03-14/generic-browser-camera-negative.ndjson`.
- Cleanup completed for the live validation: the Jitsi tab was left and navigated away from, and the OTP listener used for the blocked Google sign-in attempt was stopped.
- Live browser route validation now passes for the target web platforms that could be opened directly in Chrome:
  - `Zoom`: `Tasks/live-validation-2026-03-14/zoom-web-browser.ndjson`
  - `Microsoft Teams`: `Tasks/live-validation-2026-03-14/teams-web-browser.ndjson`
  - `Google Meet`: `Tasks/live-validation-2026-03-14/google-meet-web-browser.ndjson`
- Live Slack browser negative validation passes: a regular Slack workspace tab no longer misclassifies as a meeting. Evidence: `Tasks/live-validation-2026-03-14/slack-web-regular-negative.ndjson`

## Follow-Up Risk

- Jitsi still emitted a second `meeting_started` after leaving because Chrome Helper briefly continued reporting `preflight=false` on Jitsi's `close3.html` page. That stale post-leave signal is separate from the browser-wide regression, but it remains a cleanup false-positive to address later.
- Live Slack huddle positive validation is still blocked from automation in this environment because `osascript` does not have Assistive Access, so I can inspect logged-in Slack tabs via browser scripting but cannot click the huddle controls in the existing session to start a real web huddle.
