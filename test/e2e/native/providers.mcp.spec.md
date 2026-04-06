# Native MCP Provider Suite Contract

This document defines the scaffold contract for the native provider E2E suite driven by a native-devtools MCP server.

## Scenario Files

The runner loads JSON scenarios from `test/e2e/native/scenarios/`.

- `teams-native.json`
- `zoom-native.json`
- `slack-huddle-native.json`
- `webex-native.json`

Each scenario must be a JSON object with this shape:

```json
{
  "$schema": "internal/native-provider-scenario-v1",
  "provider": "teams-native",
  "platform": "Microsoft Teams",
  "app_name": "Microsoft Teams",
  "description": "Optional human-readable summary",
  "steps": [
    {
      "action": "launch_app",
      "args": { "app_name": "Microsoft Teams" },
      "optional": false,
      "retry": { "attempts": 1, "delay_ms": 0 }
    }
  ]
}
```

## Supported Actions

All actions accept an `args` object. Every step may also set:

- `optional`: boolean. If `true`, the runner records the failure and continues.
- `retry.attempts`: positive integer. Defaults to `1`.
- `retry.delay_ms`: delay between attempts. Defaults to `0`.
- `name`: optional label used in artifact filenames and logs.

Supported action names and required arguments:

- `launch_app`
  - `app_name`: string
  - `args`: string array, optional process arguments passed to the app launcher
- `focus_window`
  - Any of: `app_name`, `window_id`, `pid`
- `click_text`
  - `text`: string or regex source string to search for
  - `app_name`: string, optional search scope
  - `timeout_ms`: number, optional
  - `poll_ms`: number, optional
- `type_text`
  - `text`: string. `${ENV_VAR}` placeholders are expanded before execution.
- `press_key`
  - `key`: string
  - `modifiers`: string array, optional
- `wait`
  - `duration_ms`: number
- `take_screenshot`
  - `app_name`: string, optional
  - `label`: string, optional artifact label
- `maybe_fill_otp`
  - `path`: string, optional OTP file override
  - `timeout_ms`: number, optional
  - `poll_ms`: number, optional
  - `submit_key`: string, optional, defaults to `return`
- `assert_event`
  - `event`: `meeting_started` or `meeting_ended`
  - `platform`: detector platform string, optional. Defaults to scenario `platform`.
  - `timeout_ms`: number, optional

## Detector Assertions

`assert_event` is evaluated against an in-process detector harness backed by `dist/detector.js`.

Required semantics:

- `meeting_started` must match the expected provider platform.
- `meeting_started.started_at` must be present.
- `meeting_ended` must match the expected provider platform.
- `meeting_ended.started_at` must equal the prior `meeting_started.started_at` for the same scenario run.
- `meeting_ended.ended_at` must be present.

## Artifacts

Each scenario run must produce artifacts under `artifacts/native/<timestamp>/<provider>/` unless `E2E_ARTIFACT_DIR` or `--artifact-root` overrides the base path.

Required artifacts:

- `events.ndjson`: raw lifecycle events observed by the detector harness
- `errors.log`: detector or runner errors
- `summary.json`: scenario outcome, step results, and assertion metadata
- `steps.ndjson`: per-step execution records
- `screenshots/step-XX-*.json`: raw screenshot responses for every step
- `screenshots/step-XX-*.png`: decoded image when the MCP server returns screenshot bytes

## Environment Contract

Live execution depends on these environment variables:

- `NATIVE_MCP_SERVER_CMD`
- `NATIVE_MCP_SERVER_ARGS` (optional)
- `E2E_TEAMS_NATIVE_URL`
- `E2E_ZOOM_NATIVE_URL`
- `E2E_SLACK_HUDDLE_NATIVE_URL`
- `E2E_WEBEX_NATIVE_URL`
- `OTP_CODE_FILE` (optional; defaults to `.otp-codes/latest.txt` at project root)

The runner also maps `GOOGLE_EMAIL` and `GOOGLE_APP_PASSWORD` from `GMAIL_EMAIL` and `GMAIL_APP_PASSWORD` when present so existing OTP setup still works.

## Safety

`npm run e2e:native` is intentionally gated. Live automation only starts when either `--confirm-live` or `E2E_NATIVE_CONFIRM=1` is provided. Use `--dry-run` to validate scenarios, environment expansion, and artifact output without touching native apps.
