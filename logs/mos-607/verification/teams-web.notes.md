2026-04-07T10:29:15-04:00
RUNNER START 2026-04-07T10:29:15-04:00
FOCUS CHROME (Teams tab) 2026-04-07T10:29:23-04:00
DEFOCUS 2026-04-07T10:29:53-04:00
RUNNER STOP 2026-04-07T14:30:30Z

SCENARIO: Microsoft Teams (web client in Chrome)
PLATFORM: Microsoft Teams
CHROME: PID 49279, signed into NIH M365 (whitekb@nih.gov)
URL: teams.cloud.microsoft (Calendar tab)

OBSERVED LIFECYCLE:
- meeting_started: 2026-04-07T14:29:16.573Z (camera-active fallback path)
- meeting_ended:   2026-04-07T14:30:17.307Z (timeout, ~62s after defocus to VS Code)
- session_id:      "Microsoft Teams:Google Chrome"
- confidence:      high
- started_at matches across both events ✓

This row was unblocked by adding a browser-window-title fallback to
classifyPlatformFromNativeApp() in src/classifiers/native-platform.ts:
when the front app is a known browser (Chrome/Safari/Edge/Firefox) and
the title matches one of the platform patterns (microsoft teams, zoom,
cisco webex, slack, google meet, etc.), classify based on the title.
This complements the existing Google-Meet-room-code matcher and
unblocks every web client whose tab title contains the platform name.
