2026-04-07T10:35:54-04:00
LEGACY SHELL START 2026-04-07T10:35:54-04:00
JOIN AT 2026-04-07T10:36:16-04:00
LEAVE AT 2026-04-07T10:36:46-04:00
STOP 2026-04-07T10:37:00-04:00
RUNNER STOP 2026-04-07T14:36:50Z

SCENARIO: Live diff vs legacy meeting-detect.sh — Google Meet (Chrome) capture
LEGACY SCRIPT: /tmp/meeting-detect-legacy.sh (restored from `git show 652ee04^:meeting-detect.sh`)

OUTPUT SUMMARY (raw signal counts):
- Total NDJSON lines: 70 over ~30s of capture
- Unique processes seen: Google Chrome Helper, coreaudiod
- chrome_url field on every line: Cypress runner URL (NOT the real
  meet.google.com URL — see Critical Finding below)

DIFFERENCE FROM RUST PIPELINE:

1. Process identification fidelity (legacy WIN):
   - Legacy: process="Google Chrome Helper" pid=15133 parent_pid=49279
   - Rust  : process="Google Chrome" pid="" parent_pid=""
   - Reason: legacy parses TCC FORWARD/Granting/AUTHREQ_PROMPTING lines
     and resolves the renderer PID via ps/lsof. Rust currently hits the
     camera-active fallback path because the AUTHREQ_PROMPTING regex
     doesn't match every macOS log format (see Open Items in
     MOS-607-verification.md). The fallback path uses front_app as the
     process name, losing helper-process granularity.
   - Impact: lifecycle correctness is preserved (the JS classifier still
     resolves "Google Meet" via the window-title fallback added in
     bug #7), but per-signal forensic detail is reduced.
   - Follow-up: tighten the AUTHREQ_PROMPTING regex / add a multi-line
     accumulator so the Rust path also captures Chrome Helper PIDs.

2. Coreaudiod noise (both pipelines see, both filter):
   - Legacy: emits `process="coreaudiod" pid=594` once per second.
   - Rust  : sees the same TCC events but the JS-side
     shouldIgnoreSignal() filters them via systemProcessPatterns
     (`coreaudiod` is in the list).
   - Both pipelines filter at the same downstream layer; no
     differential behaviour.

3. CRITICAL: AppleScript Chrome URL targets the wrong Chrome instance
   (BOTH pipelines):
   - Legacy chrome_url: "https://myaccount.google.com/__/#/specs/runner?file=cypress/e2e/00-login.cy.ts"
   - Rust   chrome_url: same
   - Root cause: there are TWO Chrome processes on this Mac:
       PID 49279 — user's primary signed-in Google Chrome
       PID  1231 — Cypress-controlled Google Chrome with --remote-debugging-port=55024
     `tell application "Google Chrome" to get URL of active tab of front
     window` routes to whichever Chrome process macOS picks for the AX
     bus. It's hitting the Cypress instance (which has the spec runner
     loaded), not the user's main Chrome (which has the real Meet URL).
   - Impact: classifyBrowserMeeting() never matches the real Meet URL,
     so platform classification falls through to the window-title
     fallback (bug #7 fix). Lifecycle still emits the correct
     `meeting_started platform=Google Meet` because the title contains
     "Meet -" with a meeting-room code.
   - Follow-up: scope the AppleScript to a specific bundle ID + user
     data dir, OR fall back to per-window CDP, OR detect both Chrome
     processes and probe each.

4. Lifecycle equivalence:
   - Legacy is signal-only (no lifecycle state machine in shell). It
     emits every TCC event, downstream JS does the lifecycle.
   - Rust path runs the same JS lifecycle pipeline. Both produced
     `meeting_started platform=Google Meet` during this and the
     previous Google Meet runs. Lifecycle emission is unchanged.

NET ASSESSMENT: The Rust pipeline is functionally complete for
lifecycle detection (matrix rows #7–#13 all PASS) but loses some
per-signal forensic detail compared to the legacy shell (bullet 1).
Both pipelines share the AppleScript-Chrome-URL bug (bullet 3). No
regressions in lifecycle behaviour from the shell-script removal; the
gaps that exist are forensic/observability quality of life, not
correctness.

EVIDENCE FILES:
- legacy-shell-diff.ndjson — 70 raw signals from /tmp/meeting-detect-legacy.sh
- legacy-shell-diff.notes.md — this file
