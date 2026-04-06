# Live Meeting Detector Test Report (2026-04-03)

## Environment Constraints Used
- Reused existing authenticated `cmux` browser surface (`surface:3`), no new browser profiles.
- Idle native apps remained open (Slack/Teams), matching real-user behavior.

## Results

### 1) Idle Baseline (No Meeting Active)
- Status: FAIL
- Expected: no `meeting_started`
- Actual: `meeting_started` + `meeting_ended` emitted for `Slack`
- Evidence: `artifacts/live-web/20260403-061215-regression/idle-baseline/`

### 2) Google Meet Web (Back-to-Back Runs)
- Status: FAIL
- Expected: provider `Google Meet`
- Actual: provider emitted as `Slack` for both runs
- Evidence:
  - `artifacts/live-web/20260403-061215-regression/google-meet-b2b-1/`
  - `artifacts/live-web/20260403-061215-regression/google-meet-b2b-2/`

### 3) Zoom Web (Live Join/Leave Path)
- Status: FAIL
- Expected: provider `Zoom`
- Actual: provider emitted as `Slack`
- Evidence: `artifacts/live-web/20260403-062005-zoom/zoom-web/`

### 4) Slack Web (Workspace Access + Huddle Attempts)
- Status: INCONCLUSIVE/FUNCTIONAL FAIL
- Slack workspace access succeeded (`app.slack.com/client/...`)
- Huddle controls were unstable with intermittent Slack load failure panel
- Detector still emitted Slack start/end from generic signal pattern
- Evidence: `artifacts/live-web/20260403-062519-slack/slack-huddle-web/`

### 5) Microsoft Teams Web
- Status: BLOCKED (auth flow)
- Reached Microsoft login and account verification step (`Send code` path for `agent@mostrom.io`)
- Verification code email did not arrive during run window
- No meeting session launched yet

### 6) Webex Web
- Status: BLOCKED/INCONCLUSIVE
- `app.webex.com` returned connection refused in this browser context
- `webex.com` reachable; signup page reachable and email fill works
- Signup submit did not progress to verification/meeting state

## Primary Regression Confirmed
- Detector emits Slack lifecycle events when Slack app is merely open/idle.
- This causes false positives in idle state and provider misclassification during non-Slack meetings.

## Most Relevant Artifacts
- `artifacts/live-web/20260403-061215-regression/report.json`
- `artifacts/live-web/20260403-061215-regression/*/events.ndjson`
- `artifacts/live-web/20260403-062005-zoom/zoom-web/summary.json`
- `artifacts/live-web/20260403-062519-slack/slack-huddle-web/summary.json`
