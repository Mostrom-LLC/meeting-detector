# Remaining Work

## Release Blockers

- [ ] `Slack` native: start a real native huddle in the signed-in `Mostrom, LLC` workspace, confirm detector emits `Slack`, then leave the huddle.
- [ ] `Microsoft Teams` native: join a real meeting in the actual Teams desktop client, confirm detector emits `Microsoft Teams`, then leave the meeting.
- [ ] `Zoom` native: join a real meeting in `/Users/kaisewhite/Applications/zoom.us.app`, confirm detector emits `Zoom`, then leave the meeting.
- [ ] Cleanup verification: after each native pass, confirm no meeting tabs, popups, or native call windows remain open.

## Remaining Edge-Case Validation

- [ ] Post-call cleanup routes: leaving or close/thanks/redirect pages must not emit a second `meeting_started`.
- [ ] Preview, lobby, waiting-room, and guest-name-entry surfaces must stay non-meeting until actual join/admission.
- [ ] Browser probe parity: every browser route matcher must behave the same in the AppleScript tab probe, `transformAppName()`, and `hasStrongBrowserMeetingRoute()`.
- [ ] Same-platform rejoin: leaving and rejoining the same platform quickly must still emit a new meeting lifecycle instead of being hidden by session dedupe.
- [ ] Multi-tab/browser overlap: prejoin, live, and post-call tabs for the same platform must not keep the wrong state alive.
- [ ] Cross-platform overlap: with multiple meeting apps/tabs open, only the truly active meeting should win.
- [ ] Idle native helpers/webviews: Teams/Slack helper processes requesting media while idle must stay suppressed.
- [ ] Auth and redirect trampolines: sign-in, launcher, and deep-link pages must neither prematurely start meetings nor hide real joins.
- [ ] Title/URL dropouts: meeting detection should still work when one of `window_title` or `chrome_url` disappears.
- [ ] Audio-only and screen-share-first flows: meetings without strong camera evidence must still be validated.
- [ ] Permission prompts and hardware test pages: generic media-access pages must stay non-meetings even after a prior real call.
- [ ] Meeting-end timeout tuning: timeout must be short enough to avoid stale carryover and long enough not to end real meetings mid-call.
- [ ] Service-context reuse: stale cached `front_app` or `window_title` must not keep old platforms alive after navigation.
- [ ] Wrapper identity drift: browser, PWA, and native-wrapper variants of the same product must normalize consistently.
- [ ] Private/managed browser modes: incognito, guest profiles, or enterprise restrictions should not collapse detection into false positives or silence.

## Current Notes

- Browser false positives for generic `Teams`, `Meet`, and `Zoom` pages are fixed and verified.
- `Microsoft Teams` web prejoin on `teams.live.com/v2/` now stays silent; browser tabs are attribution hints only and no longer emit standalone meetings.
- `Microsoft Teams` web meetings on the current `teams.live.com/v2/` route are still attributable once a real browser media signal arrives.
- Idle native `Microsoft Teams` no longer emits false meetings just from opening the app while no call is active.
- Native meeting-start attribution on macOS now depends on active microphone use; global camera-daemon state alone is no longer enough.
- Automated verification is green: `npm test` passed `47/47`.
- Native prerequisites already confirmed:
  - `Slack` native is signed into `Mostrom, LLC`.
  - `Microsoft Teams` native can open a real pre-join window from stored join links.
  - `Zoom` native is installed at `/Users/kaisewhite/Applications/zoom.us.app`.

## 2026-03-17 Teams Browser Regression

- [x] Add failing regression coverage for live Teams browser join routes that should still match after the generic-page tightening.
- [x] Restore Teams browser meeting attribution without reintroducing generic `teams.live.com/v2/` false positives.
- [x] Fix the currently broken lifecycle regressions around backgrounded native meetings and probe shutdown behavior.
- [x] Re-run `npm test` and record the verification result.

### Review

- Restored Teams browser matching for the current live surfaces the user called out: `https://teams.live.com/v2/` and `https://teams.microsoft.com/light-meetings`, while keeping plain `Meet | Microsoft Teams` and generic `teams.live.com/v2/` landing pages negative.
- Hardened adjacent route handling so equivalent Teams launcher/query forms and root-host Zoom join URLs still classify as real meetings instead of regressing silently.
- Fixed the branch-red lifecycle fallout at the same time: backgrounded Teams/Zoom calls with empty titles are no longer dropped, and async native probe results are ignored after `stop()`.
- Verification: `npm test` passed `57/57`.

## 2026-03-17 Native Detection Regression Analysis

- [x] Inspect the current native detection architecture and identify every gate a native Teams/Slack meeting must pass.
- [x] Correlate the native gates with existing tests and live-validation evidence.
- [x] Pause code changes and document the likely drop points before further detector edits.

### Review

- Native meetings currently depend on two brittle paths:
  - shell/TCC signals must survive `shouldIgnoreSignal()` and low-confidence suppression
  - or the macOS native-app probe must pass frontmost-app, mic/camera, title-shape, and browser-hint gates
- The native-app probe still has an overbroad browser-hint suppression at `detectActiveNativeMeetingSignal()`: any meeting-shaped browser tab blocks native inference entirely, even when the frontmost app is native Slack or Teams.
- Slack native is additionally under-specified in the probe: `looksLikeActiveNativeMeeting()` only accepts titles containing `huddle`, which is likely too strict for real native huddle window/title variants.
- Existing tests do not currently prove native Slack detection or native Teams/Slack detection in the presence of stale browser hints, so the suite is giving false confidence for the exact surface now reported as broken.
- No further detector logic was changed in this analysis pass.

## 2026-03-17 Native Detection Redesign Plan

- [ ] Replace `frontmost app` as a hard gate in the macOS native probe.
- [ ] Redefine native meeting evidence around concurrent microphone + camera activity.
- [ ] Use process/app/window metadata only for platform attribution and false-positive suppression.
- [ ] Add explicit negative handling for recorder/screencast workflows that also use mic + camera.
- [ ] Add failing regression tests before implementation for native Teams and native Slack with non-frontmost workflows.
- [ ] Add failing regression tests for stale browser hints coexisting with a real native Teams/Slack meeting.
- [ ] Add failing regression tests for recorder-style false positives so the redesign does not turn every mic+camera workflow into a meeting.
- [ ] Implement the native probe redesign with minimal impact to the browser path.
- [ ] Re-run the automated suite and capture which native/browser paths are still only synthetically covered.

### Design Document

Full technical design: [`tasks/signal-detection-hardening.md`](./signal-detection-hardening.md)

## Code Review: c72b073b4d89f46ced1ecf7cea977a9702dc386b
- [x] Inspect the target commit diff and list touched files / behaviors.
- [x] Analyze changed meeting-detection logic against adjacent code for regressions.
- [x] Verify candidate issues with targeted tests or executable reasoning.
- [x] Record review outcome with prioritized findings and overall correctness.

### Review Notes
- Verified with `npm test`; suite currently fails the pre-existing backgrounded-platform test after this commit.
- Reproduced a new stop/shutdown race where an in-flight native app probe still emits `meeting_started` after `stop()`.
