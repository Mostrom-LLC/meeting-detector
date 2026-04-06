# Remaining Work

## 2026-04-06 Disable Branch-Triggered Workflows

- [x] Identify which `.github/workflows/*.yml` files are triggered by branch activity.
- [x] Comment out the branch-trigger blocks without deleting them.
- [x] Verify the edited workflow files and record the result.

### Review

- Commented the branch-trigger `on:` blocks in `.github/workflows/ci.yml` and `.github/workflows/claude-code-review.yml`.
- Left non-branch workflows unchanged: `publish.yml` is tag-triggered, `meeting-e2e.yml` is schedule/dispatch-triggered, and `claude.yml` is comment/review/issue-triggered.
- Verification: inspected both files after patching and confirmed the branch trigger lines remain present as comments rather than being deleted.

## 2026-04-04 Full Live Provider Matrix (Resume)

- [x] Reconfirm idle baseline on patched detector in live runtime.
- [x] Run Google Meet web live join/leave and capture lifecycle artifacts.
- [x] Run Zoom web live join/leave and capture lifecycle artifacts.
- [x] Run Teams web live flow to joined state (or capture auth blocker evidence) with artifacts.
- [x] Run Slack huddle web flow and capture lifecycle artifacts.
- [x] Run Webex web flow to joined state (or capture blocker evidence) with artifacts.
- [ ] Run native matrix entrypoints (Teams/Zoom/Slack/Webex) and capture pass/fail evidence per provider.
- [x] Produce consolidated matrix report with regression verdicts.

### 2026-04-04 Resume Review

- Added/verified regression coverage for Teams virtual audio driver artifacts and patched detector filtering in `src/detector.ts` (`process/front_app/process_path/session_id` marker suppression).
- Verification passed: `npm test` => `104/104`.
- Live web matrix executed on existing `cmux` browser `surface:3` with artifacts at:
  - `artifacts/live-web/20260404-085434-matrix-live-baseurls/matrix-summary.json`
  - Per-provider logs under `artifacts/live-web/20260404-085434-matrix-live-baseurls/*`.
- Live matrix outcome: `0/5` providers emitted lifecycle events (`meeting_started`/`meeting_ended` all zero).
- Focused Google Meet re-run (`artifacts/live-web/20260404-090723-google-meet-focused/`) successfully clicked:
  - `video_call New meeting`
  - `Start an instant meeting`
  - still emitted `0` lifecycle events.
- Runtime evidence suggests meeting media activation did not satisfy detector mic gate during these flows:
  - `./scripts/media-state` returned `{"camera":true,"mic":false}` immediately after the focused run.

## 2026-04-02 Robust Meeting Start/End + Automation Plan

- [x] Capture spec for robust native + web meeting lifecycle detection and full provider matrix coverage.
- [x] Write implementation plan at `docs/superpowers/plans/2026-04-02-meeting-detection-robustness.md`.
- [x] Execute Task 1: session timeline model with explicit `started_at` / `ended_at`.
- [x] Execute Task 2: unified browser classifier with Webex parity.
- [x] Execute Task 3: hardened native attribution for Teams/Zoom/Slack Huddle/Webex.
- [x] Execute Task 4: provider-matrix lifecycle end correctness.
- [x] Execute Task 5: Playwright web E2E suite for Meet/Zoom/Teams/Slack/Webex.
- [x] Execute Task 6: native-devtools MCP native E2E suite for Teams/Zoom/Slack/Webex.
- [ ] Execute Task 7: CI wiring + docs + verification bundle.

## 2026-04-03 Idle Slack False-Positive Bugfix

- [x] Add a failing regression test that reproduces native probe false-positive Slack detection with idle window evidence.
- [x] Delegate at least two fix strategies to subagents and compare outcomes.
- [x] Integrate minimal-risk fix: suppress Slack native classification when title evidence is empty.
- [x] Rework native probe Slack tests to assert real probe behavior rather than fully mocked signals.
- [x] Run targeted regression tests and full `npm test` to verify no CI breakage.

### Task 7 Checklist

- [x] Add `scripts/e2e/validate-env.sh` with `web`, `native`, and `all` modes.
- [x] Wire `npm run e2e:validate-env` in `package.json`.
- [x] Create `docs/testing/meeting-e2e.md` with web/native commands, dry-run behavior, and env requirements.
- [x] Update `README.md` with operator-facing E2E entry points and validation notes.
- [x] Add `.github/workflows/meeting-e2e.yml` with macOS web E2E and workflow-dispatch-only self-hosted native E2E.
- [x] Verify `bash scripts/e2e/validate-env.sh web` fails in the current environment because the web URL contract is not populated.
- [x] Verify `npm run build:ts`.
- [x] Verify `npm test`.

### Task 6 Checklist

- [x] Define the native MCP scenario contract and provider scenario files for Teams, Zoom, Slack Huddle, and Webex.
- [x] Implement the stdio MCP client, native driver, scenario runner, artifact writer, and native CLI entrypoint.
- [x] Implement bounded OTP polling for fresh codes with explicit configuration errors.
- [x] Add `e2e:native` script plus MCP SDK dependency in `package.json`.
- [x] Verify `npm run build:ts`.
- [x] Verify `node scripts/e2e/run-native-mcp-e2e.mjs --help`.
- [x] Verify `node --input-type=module -e "import('./scripts/tools/otp-client.mjs').then(()=>console.log('otp-client-ok'))"`.

### Review

- Plan authored and staged for execution handoff; pending plan-review subagent approval.
- Task 2 and Task 3 completed with shared browser/native classifier modules and detector call-site migration.
- Added Webex browser coverage while preserving Meet, Zoom, Teams, and Slack browser matching parity.
- Task 4 completed with shared test helpers plus provider-matrix lifecycle coverage for Google Meet, Zoom, Microsoft Teams, Slack, and Cisco Webex.
- Task 5 completed with a Playwright provider matrix, an in-process detector harness exposing `waitFor(event)`, a web E2E runner, and an explicit `.env.e2e` contract for Google Meet, Zoom, Teams, Slack Huddle, and Webex.
- Task 6 completed with a native MCP scaffold: provider scenario JSON contracts, a guarded native CLI, stdio MCP client and driver wrappers, per-step artifact capture, and detector-harness assertions for `meeting_started` and `meeting_ended`.
- The native runner is non-destructive by default: live automation requires `--confirm-live` or `E2E_NATIVE_CONFIRM=1`, while `--dry-run` validates scenarios without touching native apps.
- OTP polling now waits for a fresh six-digit code using bounded timeout and retry semantics, and missing native scenario env vars fail with explicit actionable errors.
- Task 7 landed with an env validator, an operator guide, README entry points, and a workflow that keeps web E2E on macOS while gating native E2E behind workflow dispatch on self-hosted runners.
- Verification: `npm run build:ts` passed; `node --test test/lifecycle.session-timeline.test.mjs test/lifecycle.provider-matrix.test.mjs test/detector.lifecycle.test.mjs` passed `60/60`; `npm test` passed `97/97`.
- Verification: `npm run build:ts` passed; `node --test test/browser-tab-match.test.mjs test/browser-platform-classifier.test.mjs test/browser-probe-targets.test.mjs test/native-platform-classifier.test.mjs` passed `35/35`; `node --test test/detector.lifecycle.test.mjs` passed `54/54`.
- Verification: `npm run build:ts` passed; `node --test test/detector.lifecycle.test.mjs` passed `54/54`; `npx playwright test test/e2e/web/providers.spec.ts --list` listed 5 provider tests.
- Verification: `npm run build:ts` passed; `node scripts/e2e/run-native-mcp-e2e.mjs --help` printed native runner usage; `node --input-type=module -e "import('./scripts/tools/otp-client.mjs').then(()=>console.log('otp-client-ok'))"` printed `otp-client-ok`.
- Verification: `env E2E_TEAMS_NATIVE_URL= node scripts/e2e/run-native-mcp-e2e.mjs --dry-run --provider teams-native` failed with `Missing environment variable E2E_TEAMS_NATIVE_URL ...`, confirming actionable config errors without starting a real meeting.
- Verification: `bash scripts/e2e/validate-env.sh web` is expected to fail until the web contract is populated; `npm run build:ts` and `npm test` remain green after Task 7 wiring.

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

## 2026-03-17 README Refresh

- [ ] Review current package metadata, exported API, success criteria, and design docs for documentation drift.
- [ ] Rewrite `README.md` to reflect the current macOS-focused implementation, public API, CLI usage, known limitations, and the signal-hardening roadmap.
- [ ] Verify the README against `package.json`, `src/index.ts`, and `/tasks` documentation so it does not overstate shipped behavior.

## Code Review: c72b073b4d89f46ced1ecf7cea977a9702dc386b
- [x] Inspect the target commit diff and list touched files / behaviors.
- [x] Analyze changed meeting-detection logic against adjacent code for regressions.
- [x] Verify candidate issues with targeted tests or executable reasoning.
- [x] Record review outcome with prioritized findings and overall correctness.

### Review Notes
- Verified with `npm test`; suite currently fails the pre-existing backgrounded-platform test after this commit.
- Reproduced a new stop/shutdown race where an in-flight native app probe still emits `meeting_started` after `stop()`.

## 2026-04-04 Live Provider Matrix Checklist Execution (this run)

- [x] Task 1 preflight environment and credentials
- [x] Task 2 launch Chrome CDP session and verify
- [ ] Task 3 verify web E2E CDP adaptation and single-provider run
- [ ] Task 4 provisioned URL check and web matrix run
- [ ] Task 5 native matrix run (MCP)
- [x] Task 6 lifecycle evidence + idle regression validation
- [x] Task 7 command/policy verification and consolidated report

### Review (this run)

- Task 1:
  - `npm run build:ts` passed.
  - `./scripts/media-state` baseline: `{"camera":true,"mic":false}`.
  - OTP listener blocked: `start-otp-listener.sh` requires `OTP_EMAIL` / `OTP_EMAIL_PASSWORD`.
  - OTP retrieval path works: `scripts/tools/get-otp.sh` returned a 6-digit code.
- Task 2:
  - Chrome CDP profile mapping already configured (`Chrome -> ChromeCDP2` symlink).
  - Relaunch via `open -a "Google Chrome" --args --remote-debugging-port=9222` succeeded.
  - `curl http://localhost:9222/json/version` returned Browser + `webSocketDebuggerUrl`.
  - CDP smoke checks passed: Google Meet title loaded as signed-in and instant meeting URL opened.
- Task 3 blocker:
  - Live Playwright `Google Meet` test starts, then stalls with no further output; process had to be terminated twice.
  - Reproduced both via `node scripts/e2e/run-web-e2e.mjs --grep "Google Meet"` and direct `npx playwright test ... --grep "Google Meet"`.
- Task 4 blocker:
  - `.env/.env.e2e` missing all `E2E_*_URL` provider variables.
  - Full `node scripts/e2e/run-web-e2e.mjs` also stalls immediately after worker start; terminated.
- Task 5 blocker:
  - `node scripts/e2e/run-native-mcp-e2e.mjs --help` works.
  - Live run blocked early: missing required `NATIVE_MCP_SERVER_CMD`.
- Task 6:
  - Idle regression rerun passed: `node scripts/live-test.mjs --duration 25 ...` -> `Started: 0`, `Ended: 0`.
  - Lifecycle correctness verified from existing artifact `artifacts/live-web/google-meet-web/events.ndjson`:
    - one `meeting_started` + one `meeting_ended`
    - matching `started_at`
    - `ended_at` later than `started_at`
- Task 7:
  - Consolidated execution report written to `artifacts/live-web/20260404-checklist-execution-report.md`.

## 2026-04-05 Provider Detection (Web + Native) Execution

- [x] Task 1: 5-provider detection contract + classifier coverage.
- [x] Task 2: detector arbitration hardening for cross-platform native handoff.
- [x] Task 3: provider detection matrix runner (`detect:matrix*`) + env wiring.
- [x] Task 4: run env validation and detection matrix commands; capture blockers/evidence.
- [x] Task 5: update docs to detection-first workflow.

### Detection Surface Status (Current Environment)

| Provider | Web | Native | Evidence | Notes |
|---|---|---|---|---|
| Google Meet | SKIPPED | N/A | `artifacts/provider-detection/2026-04-05T06-31-48-313Z/matrix-summary.json` | `E2E_GOOGLE_MEET_URL` missing |
| Zoom | SKIPPED | SKIPPED | `artifacts/provider-detection/2026-04-05T06-31-48-313Z/matrix-summary.json`, `artifacts/provider-detection/2026-04-05T06-31-48-416Z/matrix-summary.json` | web/native URLs missing |
| Microsoft Teams | SKIPPED | SKIPPED | `artifacts/provider-detection/2026-04-05T06-31-48-313Z/matrix-summary.json`, `artifacts/provider-detection/2026-04-05T06-31-48-416Z/matrix-summary.json` | web/native URLs missing |
| Slack (Huddle) | SKIPPED | SKIPPED | `artifacts/provider-detection/2026-04-05T06-31-48-313Z/matrix-summary.json`, `artifacts/provider-detection/2026-04-05T06-31-48-416Z/matrix-summary.json` | web/native URLs missing |
| Cisco Webex | SKIPPED | SKIPPED | `artifacts/provider-detection/2026-04-05T06-31-48-313Z/matrix-summary.json`, `artifacts/provider-detection/2026-04-05T06-31-48-416Z/matrix-summary.json` | web/native URLs missing |

### Blockers

- Missing env contract keys from `bash scripts/e2e/validate-env.sh all`:
  - `E2E_GOOGLE_MEET_URL`, `E2E_ZOOM_WEB_URL`, `E2E_TEAMS_WEB_URL`, `E2E_SLACK_HUDDLE_WEB_URL`, `E2E_WEBEX_WEB_URL`
  - `E2E_TEAMS_NATIVE_URL`, `E2E_ZOOM_NATIVE_URL`, `E2E_SLACK_HUDDLE_NATIVE_URL` (or `E2E_SLACK_NATIVE_URL`), `E2E_WEBEX_NATIVE_URL`
  - `NATIVE_MCP_SERVER_CMD`, `GOOGLE_VOICE_NUMBER`, Google auth keys

### Readiness Verdict

- **NOT READY FOR LIVE PASS CLAIM** in this environment due to missing provider URLs/native MCP prerequisites.
- **READY FOR EXECUTION** once env is populated: `detect:matrix:web -- --manual` and `detect:matrix:native -- --manual` now produce per-provider lifecycle artifacts and matrix summaries.

### 2026-04-05 Live Matrix Run (User-Requested Self-Filled Env)

- Populated `.env.e2e` with runnable defaults + credentials aliases + `NATIVE_MCP_SERVER_CMD=native-devtools-mcp`.
- Executed manual detection runs with 15s join/leave windows.

Web result:
- Artifact: `artifacts/provider-detection/2026-04-05T21-27-52-163Z/matrix-summary.json`
- Outcome: `0/5` pass, all providers timed out waiting for `meeting_started`.

Native result:
- Artifact: `artifacts/provider-detection/2026-04-05T21-33-41-076Z/matrix-summary.json`
- Outcome: `0/4` pass.
- Notable signal: during Webex-native window, one `meeting_started` was observed for `Microsoft Teams` (cross-platform false attribution in live environment), then timeout for expected Webex end-to-end lifecycle.

Runner reliability fix:
- Updated `scripts/e2e/run-provider-detection-matrix.mjs` to force CLI termination after summary write to avoid lingering detector handles.
