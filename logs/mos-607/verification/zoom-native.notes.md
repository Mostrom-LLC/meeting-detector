2026-04-07T10:10:45-04:00
RUNNER START 2026-04-07T10:10:45-04:00
LAUNCH AT 2026-04-07T10:10:51-04:00
MEETING START 2026-04-07T10:11:37-04:00
LEAVE AT 2026-04-07T10:12:19-04:00
RUNNER STOP 2026-04-07T14:13:30Z

SCENARIO: Zoom (native macOS app)
PLATFORM: Zoom
APP: /Applications/zoom.us.app (installed via brew install --cask zoom)

OBSERVED LIFECYCLE:
- meeting_started: 2026-04-07T14:12:04.411Z (after click on New meeting in Zoom Home view)
- meeting_ended:   2026-04-07T14:13:06.822Z (timeout fired ~62s after End Meeting + Chrome refocus)
- session_id:      "Zoom:zoom.us"
- confidence:      high
- started_at matches across both events ✓

DRIVING:
- native-devtools MCP launch_app("zoom.us") → focus Home tab (1095, 191) → click "New meeting" icon (1310, 425)
- After meeting_started captured, click End button (1584, 1100) → click "End meeting for all" (1497, 1002)
- focus_window(Chrome) to release Zoom from front-app — this is the critical step that
  lets the camera-active fallback stop emitting Zoom signals so meetingEndTimeoutMs
  can elapse without a fresh signal.

EVIDENCE FILES:
- zoom-native.ndjson, zoom-native.lifecycle.json, zoom-native.audit.log,
  zoom-native.window.png, zoom-native.notes.md
