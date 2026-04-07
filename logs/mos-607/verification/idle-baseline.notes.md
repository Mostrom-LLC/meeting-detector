2026-04-07T10:45:56-04:00
RUNNER START 2026-04-07T10:45:56-04:00 — Zoom/Teams/Webex apps killed; Harke Dev still active (camera holder)
RUNNER STOP 2026-04-07T14:53Z (10 min runtime)

RESULT: 1 false-positive lifecycle pair captured.

EVENTS:
- meeting_started platform=Slack reason=signal
- meeting_ended   platform=Slack reason=timeout

ROOT CAUSE: Slack briefly came to the front during the 10-minute window
(probably from a desktop notification grabbing focus, or a stray click).
With Harke Dev holding the macOS camera daemon active throughout the
session (its ongoing recording), the camera-active fallback in
MacOSDetector::detect() emitted a `front_app=Slack camera_active=true`
signal. The classifier tagged it `service: "Slack"` (Slack is in
KNOWN_MEETING_SERVICES), the lifecycle pipeline emitted
`meeting_started`, and then `meeting_ended` fired ~30s later when
Slack lost focus and the dedupe-driven signal stream went silent.

This is the SAME camera-active fallback false-positive bug that was
documented as a P1 follow-up in MOS-607-verification.md Open Items.
The first idle baseline run (before Zoom/Teams/Webex apps were quit)
captured 4 false-positive events for Google Meet/Zoom/Microsoft Teams.
After quitting those apps, the only remaining meeting app on the Mac
was Slack, and it produced exactly the same kind of false positive
once it briefly came to front.

INTERPRETATION FOR THE MATRIX:
- The plan's idle-baseline criterion is "Zero meeting_started events".
- This run produced 1 such event, so by the strict criterion: FAIL.
- However, the FAIL is the EXPECTED outcome of a known production
  bug already documented in Open Items, not a regression caused by
  any of the MOS-607 commits. The pre-MOS-607 shell-script pipeline
  had the same false-positive class (different mechanism, same effect):
  it would emit a Slack signal whenever Slack accessed the mic for any
  reason (incoming call ringing, huddle preview, even some
  notification sound effects per CLAUDE.md memory).
- Until the camera-active fallback is gated by something stronger
  than `front_app + camera_active`, idle baselines will always
  produce false positives if any meeting app comes to front during
  the window AND the camera is held active by another app.

FOLLOW-UP TICKET: tighten the camera-active fallback gating. Options:
  a) require a TCC mic event from the same PID within the last N
     seconds before classifying;
  b) require the active window to have a meeting-specific title
     (not the generic app name);
  c) only fire the fallback when no other camera-using app is
     detectable as the daemon owner (use IORegistry to find which
     PID is keeping VDCAssistant alive);
  d) drop the camera-active fallback entirely and rely solely on TCC
     events — at the cost of missing meetings whose mic/cam grant
     was already approved before the detector started.

EVIDENCE FILES:
- idle-baseline.ndjson  — 9 lines (1 session_start, 5 meeting_signal,
                          2 meeting_lifecycle, 1 session_stop)
- idle-baseline.audit.log
- idle-baseline.notes.md — this file
