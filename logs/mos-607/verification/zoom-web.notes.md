2026-04-07T10:32:32-04:00
RUNNER START 2026-04-07T10:32:32-04:00
FOCUS CHROME (Zoom tab) 2026-04-07T10:32:54-04:00
DEFOCUS 2026-04-07T10:33:18-04:00
RUNNER STOP 2026-04-07T14:34Z

SCENARIO: Zoom (web client in Chrome)
PLATFORM: Zoom
CHROME: PID 49279
URL: https://zoom.us (landing page; same Chrome window-title classifier path that unblocked Teams web)

OBSERVED LIFECYCLE:
- meeting_started: 2026-04-07T14:32:36.287Z (camera-active fallback + window-title classifier)
- meeting_ended:   2026-04-07T14:33:41.625Z (timeout, ~65s after defocus to VS Code)
- session_id:      "Zoom:Google Chrome"
- confidence:      high
- started_at matches across both events ✓

NOTE: First attempt produced a meeting_changed event (Microsoft Teams →
Zoom) because the previous Teams web run hadn't fully timed out before
the navigation. The runner was restarted clean to capture an unambiguous
meeting_started for Zoom only.
