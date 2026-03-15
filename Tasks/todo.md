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
