# Meeting Test Rules

This document defines the required testing rules for meeting detection.

## 0) Normative Language

- `MUST` = mandatory.
- `MUST NOT` = prohibited.
- `SHOULD` = recommended unless a documented exception exists.
- Any `MUST` violation is an automatic **FAIL**.

## 1) Tooling Rules

- Web meeting tests must use **Cypress** as the primary runner.
- Native meeting tests must use the **native-devtools MCP** runner.
- Playwright is allowed only as temporary fallback for legacy web specs until Cypress parity is complete.

Canonical execution path today:
1. `npm run e2e:validate-env -- web`
2. `npm run e2e:web` (currently Playwright fallback runner)
3. `npm run e2e:validate-env -- native`
4. `npm run e2e:native -- --dry-run`
5. `E2E_NATIVE_CONFIRM=1 npm run e2e:native`
6. `npm test`

## 2) Required Evidence Per Scenario

Every scenario must produce all artifacts below:
- detector lifecycle events (`meeting_started`, `meeting_ended`) with timestamps
- provider name (`Google Meet`, `Zoom`, `Microsoft Teams`, `Slack`, `Cisco Webex`)
- matching `session_id` between start and end
- non-empty `ended_at`
- UI artifact (screenshot or video)
- step log with UTC timestamps

If any artifact is missing, the scenario is not complete.

## 3) Preflight Rules (Before Running Tests)

1. Run env validation first:
   - `npm run e2e:validate-env -- web`
   - `npm run e2e:validate-env -- native`
2. Confirm OTP listener path is valid (if OTP may be required):
   - default: `scripts/.otp-codes/latest.txt`
   - start listener: `bash scripts/tools/start-otp-listener.sh`
   - verify latest code: `bash scripts/tools/get-otp.sh`
3. Ensure the detector build is current:
   - `npm run build:ts`
4. For native runs, start with dry-run first:
   - `npm run e2e:native -- --dry-run --provider teams-native`

Preflight `MUST` rules:
- All required env keys for the chosen mode MUST be present.
- OTP listener MUST be running for flows that can trigger OTP.
- Detector build MUST succeed before any E2E run.
- If preflight fails, E2E execution MUST NOT continue.

## 4) Web Meeting Rules (Cypress)

## 4.1 Global

- Use credentials from `.env` / `.env.e2e`; do not hardcode credentials in tests.
- Login flow must complete inside the Cypress spec, including OTP if prompted.
- A meeting is considered started only after detector emits `meeting_started`.
- A meeting is considered ended only after detector emits `meeting_ended`.
- Do not pass a scenario on URL/title alone.

Web `MUST` rules:
- `meeting_started.platform` MUST equal expected provider.
- `meeting_ended.platform` MUST equal expected provider.
- `meeting_started.session_id` MUST equal `meeting_ended.session_id`.
- `meeting_started.started_at` MUST exist.
- `meeting_ended.ended_at` MUST exist.
- `meeting_ended.ended_at` MUST be later than `meeting_started.started_at`.
- During a single-provider run, unexpected `meeting_changed` MUST NOT occur.

## 4.2 Provider Checklist

Run each provider in isolation:

1. `Google Meet` (web)
2. `Zoom` (web)
3. `Microsoft Teams` (web)
4. `Slack Huddle` (web)
5. `Cisco Webex` (web)

For each provider, steps are required in this order:
1. open provider join URL
2. authenticate with provided credentials
3. join the meeting
4. assert detector emits exactly one `meeting_started` for provider
5. stay connected for a short stability window (no duplicate start)
6. leave the meeting
7. assert detector emits exactly one `meeting_ended` for same provider/session

Provider join-state definition (MUST):
- Prejoin/lobby/waiting-room alone is NOT a pass.
- Pass requires detector-confirmed joined state (`meeting_started`) and explicit leave (`meeting_ended`).

## 4.3 Cypress Reliability Rules

- Prefer stable selectors (`data-testid`/semantic role locators).
- Avoid fixed sleeps unless no deterministic wait is available.
- Use timeout-based waits for detector events.
- If a step flakes, retry once; if it fails twice, mark as failed and keep artifacts.

Timeouts and retries (MUST):
- `meeting_started` wait timeout: 90s max.
- `meeting_ended` wait timeout: 90s max after leave action.
- Per scenario max retries: 1 retry (2 total attempts).
- If both attempts fail, scenario status MUST be `FAIL`.

## 5) Native Meeting Rules (native-devtools MCP)

## 5.1 Global

- Run with `--dry-run` before any live run.
- Live automation requires explicit confirmation (`--confirm-live` or `E2E_NATIVE_CONFIRM=1`).
- Do not run destructive UI operations outside the scenario definition.

Native `MUST` rules:
- `--dry-run` MUST pass before live automation.
- Live run MUST include explicit confirmation guard.
- Native scenario MUST assert both lifecycle boundaries (`meeting_started`, `meeting_ended`) for expected provider.

## 5.2 Required Native Providers

1. `teams-native`
2. `zoom-native`
3. `slack-huddle-native`
4. `webex-native`

For each native provider:
1. launch app
2. focus app window
3. open meeting link
4. handle OTP (if prompted) using `scripts/tools/otp-client.mjs`
5. join meeting
6. assert `meeting_started` provider match
7. leave meeting
8. assert `meeting_ended` provider match and same `session_id`

OTP handling (MUST):
- Use `scripts/tools/otp-client.mjs` polling with bounded timeout.
- If no fresh OTP is available before timeout, scenario MUST fail with explicit OTP timeout error.

## 6) Pass/Fail Criteria

A provider scenario is **PASS** only if:
- join completed
- one valid `meeting_started`
- one valid `meeting_ended`
- same provider and session continuity
- required artifacts written

Otherwise scenario is **FAIL**.

Global suite pass criteria:
- All required provider scenarios pass.
- No required scenario is skipped.
- `npm test` passes after E2E execution.

## 7) Run Order

Recommended order:
1. web scenarios (Cypress)
2. native scenarios (native-devtools MCP)
3. final full detector regression (`npm test`)

## 8) Reporting Format

Each test report must include:
- provider
- start event timestamp
- end event timestamp
- session_id
- duration (`ended_at - started_at`)
- artifact directory path
- final status (PASS/FAIL)

## 9) Merge/Release Gate

A test cycle is merge-ready only if all below are true:
1. `npm run e2e:validate-env -- web` returns 0
2. `npm run e2e:web` returns 0 for required providers
3. `npm run e2e:validate-env -- native` returns 0
4. `npm run e2e:native -- --dry-run` returns 0
5. `E2E_NATIVE_CONFIRM=1 npm run e2e:native` returns 0 for required providers
6. `npm test` returns 0
7. All required artifacts are present and attached to run report
