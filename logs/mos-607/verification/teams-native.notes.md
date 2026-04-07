2026-04-07T10:16:25-04:00
RUNNER START 2026-04-07T10:16:25-04:00
LAUNCH AT 2026-04-07T10:16:34-04:00
MEET NOW 2026-04-07T10:17:22-04:00
START MEETING 2026-04-07T10:17:49-04:00
LEAVE AT 2026-04-07T10:18:08-04:00
RUNNER STOP 2026-04-07T14:19:30Z

SCENARIO: Microsoft Teams (native macOS app)
PLATFORM: Microsoft Teams
APP: /Applications/Microsoft Teams.app (signed in to NIH M365 — whitekb@nih.gov)

OBSERVED LIFECYCLE:
- meeting_started: 2026-04-07T14:16:40.963Z (after Calendar → Meet now → Start meeting)
- meeting_ended:   2026-04-07T14:19:04.645Z (timeout-driven, ~80s after Cmd+W close + Chrome refocus)
- session_id:      "Microsoft Teams:27135"
- confidence:      medium → high
- started_at matches across both events ✓

DRIVING:
- launch_app("Microsoft Teams") → click Calendar tab (993, 537) → click Meet now (2065, 357)
  → click Start meeting (2064, 561)
- After meeting_started captured: Cmd+W to close meeting window → focus_window(Chrome)
