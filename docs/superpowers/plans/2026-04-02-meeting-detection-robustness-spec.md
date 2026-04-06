# Meeting Detection Robustness Spec (2026-04-02)

## Problem
Current meeting detection is not robust enough for real native and web meetings.

## Required Outcomes
1. Detect live meetings for both native apps and web meetings.
2. Emit reliable lifecycle boundaries for each meeting:
   - meeting start timestamp
   - meeting end timestamp
3. Cover the following providers in both web/native surfaces where available:
   - Google Meet
   - Cisco Webex
   - Microsoft Teams
   - Slack Huddle
   - Zoom
4. Deliver fully automated testing for web and native scenarios using the most appropriate tooling from:
   - native-devtools MCP
   - Playwright MCP / Playwright
   - Puppeteer MCP / Puppeteer
   - Cypress
5. Use credentials already stored in `.env` and existing OTP listener scripts in `scripts/tools` for auth flows.

## Acceptance Criteria
1. Deterministic unit/integration tests prove lifecycle correctness and platform attribution.
2. Automated web E2E tests prove start/end for all five providers.
3. Automated native E2E tests prove start/end for Teams, Slack Huddle, Zoom, and Webex native clients (Meet native client is optional unless available; browser Meet is required).
4. Test artifacts (logs + NDJSON) are produced for every scenario.
5. `npm test` remains green and E2E suites have documented commands and expected outputs.
