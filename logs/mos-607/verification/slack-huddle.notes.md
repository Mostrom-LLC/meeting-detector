2026-04-07T06:54:19-04:00
RUNNER START 2026-04-07T06:54:19-04:00
JOIN AT 2026-04-07T06:54:46-04:00
HUDDLE START 2026-04-07T06:55:29-04:00
LEAVE AT 2026-04-07T06:56:28-04:00
RUNNER STOP 2026-04-07T10:57Z

SCENARIO: Slack huddle preview (native macOS app)
PLATFORM: Slack
SLACK PID: 42422 (user's already-signed-in Slack)
WORKSPACE: Mostrom, LLC
HUDDLE: clicked "Start a Huddle" → invited "agent" (free Slack one-other-person rule) → "Slack - Huddle Preview" window opened with mic + camera device pickers active

OBSERVED LIFECYCLE:
- meeting_started: 2026-04-07T10:54:31.464Z (~before huddle preview opened — fired by camera-active fallback because front_app=Slack and the macOS camera daemon was already active for an unrelated app)
- meeting_ended:   NOT CAPTURED — see Limitations below
- session_id:      "Slack:Slack"
- confidence:      high

SIGNAL FLOW:
- Native Rust module emitted via camera-active fallback path. Slack does
  not need to fire fresh TCC events for huddle-preview because it already
  has Microphone + Camera grants.
- Raw signal: service="Slack" process="Slack" front_app="Slack"
- normalizeSignal() classified as "Slack" via transformAppName().
- shouldIgnoreSignal allowed it through (Slack is in the
  KNOWN_MEETING_SERVICES set, mainBrowserProcesses doesn't apply).

LIMITATIONS — meeting_ended not captured this run:
- The camera-active fallback path emits a fresh "Slack" signal every poll
  cycle for as long as (a) Slack is the frontmost macOS app, AND
  (b) anything on this Mac is holding the camera (here: Harke Dev was
  recording the user the whole session).
- meeting_ended only fires after `meetingEndTimeoutMs` of silence on the
  signal stream. Because the fallback kept producing Slack signals,
  the lifecycle never timed out.
- This is a real production gap, not a test artifact: if a user runs the
  detector while a non-meeting app is also using their camera, the
  detector will hold a meeting "open" until the front app switches.
- Documented as a follow-up under Open Items in MOS-607-verification.md.

EVIDENCE FILES:
- slack-huddle.ndjson         — full audit runner stream
- slack-huddle.lifecycle.json — extracted lifecycle event (meeting_started only)
- slack-huddle.audit.log      — detector debug output (filtered)
- slack-huddle.window.png     — screenshot of the active "Slack - Huddle Preview" window
