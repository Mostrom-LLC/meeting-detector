2026-04-07T06:49:39-04:00
RUNNER START 2026-04-07T06:49:39-04:00
JOIN AT 2026-04-07T06:49:45-04:00
LEAVE AT 2026-04-07T06:50:35-04:00
RUNNER STOP 2026-04-07T10:51:30Z

SCENARIO: Google Meet (Chrome web)
PLATFORM: Google Meet
CHROME PID: 49279 (user's signed-in primary Chrome)
URL: meet.google.com/hdq-xpdw-ivj (auto-created via /new)

OBSERVED LIFECYCLE:
- meeting_started: 2026-04-07T10:49:40.566Z (~13s after JOIN)
- meeting_ended:   2026-04-07T10:51:05.853Z (~38s after LEAVE, fired by 4s meetingEndTimeoutMs)
- session_id:      "Google Meet:Google Chrome"
- confidence:      high
- started_at == both events ✓

SIGNAL FLOW:
- Native Rust module emitted via camera-active fallback path (no fresh
  TCC events fired because Chrome already had Camera/Microphone permission
  for meet.google.com from prior sessions). Window-title path triggered
  classification.
- Raw signal: service="Google Meet" process="Google Chrome" front_app="Google Meet"
- normalizeSignal() re-classified via transformAppName() which read the
  Meet window title and returned "Google Meet"
- shouldIgnoreSignal mainBrowserProcesses filter relaxed to allow
  classified signals through (Google Chrome process + Google Meet service)

EVIDENCE FILES:
- meet-chrome.ndjson         — full audit runner stream (signals + lifecycle)
- meet-chrome.lifecycle.json — extracted lifecycle events
- meet-chrome.audit.log      — detector debug output
- meet-chrome.window.png     — screencapture taken during the active meeting
