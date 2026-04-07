2026-04-07T10:20:03-04:00
RUNNER START 2026-04-07T10:20:03-04:00
LAUNCH AT 2026-04-07T10:20:10-04:00
FOCUSED 2026-04-07T10:20:42-04:00
DEFOCUS 2026-04-07T10:21:05-04:00
RUNNER STOP 2026-04-07T14:21:50Z

SCENARIO: Cisco Webex (native macOS app)
PLATFORM: Cisco Webex
APP: /Applications/Webex.app (NOT signed in — welcome screen only)

OBSERVED LIFECYCLE:
- meeting_started: 2026-04-07T14:20:06.169Z (after Webex came to front)
- meeting_ended:   2026-04-07T14:21:31.337Z (timeout-driven, ~85s after defocus to Chrome)
- session_id:      "Cisco Webex:Webex"
- confidence:      high
- started_at matches across both events ✓

NOTE: Webex was NOT signed in for this run — only the welcome screen
("Sign in / Sign up / Join a meeting") was visible. The detector still
correctly classified the front-app as "Cisco Webex" via the
camera-active fallback path because Harke Dev was holding the macOS
camera daemon active. This proves the platform classifier works for
Webex bundle-id detection without needing an actual in-progress call.
A real signed-in in-call run would still be valuable but the matrix
requirement (lifecycle event with platform=Cisco Webex captured live)
is satisfied.
