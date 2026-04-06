# Meeting E2E Guide

Primary objective: prove detector correctness for meeting lifecycle attribution, not UI-framework pass rates.

Use the env validator first so you fail fast on missing inputs instead of waiting for a browser or desktop app to launch.

Authoritative rules and provider checklists live in [meeting-test-rules.md](./meeting-test-rules.md).
Treat that file as normative (`MUST`/`FAIL` gate), not advisory.

## Validate the Environment

```bash
npm run e2e:validate-env -- web
npm run e2e:validate-env -- native
npm run e2e:validate-env -- all
```

The wrapper script is `scripts/e2e/validate-env.sh` and accepts the same `web`, `native`, or `all` mode argument.

## Goal-First Detection Matrix

Use the detection matrix runner to validate provider attribution and lifecycle events:

```bash
npm run detect:matrix -- --help
npm run detect:matrix:web -- --dry-run
npm run detect:matrix:native -- --dry-run
```

Manual live validation:

```bash
npm run detect:matrix:web -- --manual
npm run detect:matrix:native -- --manual
```

Modes:
- `--manual` waits for operator join/leave actions and asserts detector events.
- `--auto` is reserved for external automation orchestration integration.
- `--dry-run` writes scaffold summaries without starting live detection flow.

Artifacts are written under `artifacts/provider-detection/<timestamp>/` with per-provider `events.ndjson` and `summary.json`, plus `matrix-summary.json`.

## Legacy Web/Native E2E Runners

These runners still exist and are useful for scenario automation development:

- Web runner:

```bash
npm run e2e:web
```

- Native runner:

```bash
npm run e2e:native -- --dry-run
E2E_NATIVE_CONFIRM=1 npm run e2e:native -- --provider teams-native
```

They are not the canonical signal of readiness; detection matrix evidence is.

Required web environment keys:

- `E2E_GOOGLE_MEET_URL`
- `E2E_ZOOM_WEB_URL`
- `E2E_TEAMS_WEB_URL`
- `E2E_SLACK_HUDDLE_WEB_URL`
- `E2E_WEBEX_WEB_URL`

Required native environment keys:

- `E2E_TEAMS_NATIVE_URL`
- `E2E_ZOOM_NATIVE_URL`
- `E2E_SLACK_HUDDLE_NATIVE_URL` (or `E2E_SLACK_NATIVE_URL`)
- `E2E_WEBEX_NATIVE_URL`
- `NATIVE_MCP_SERVER_CMD`
- `GOOGLE_VOICE_NUMBER`

The native runner also accepts Google auth helpers through either naming convention:

- `GOOGLE_EMAIL` or `GMAIL_EMAIL`
- `GOOGLE_APP_PASSWORD` or `GMAIL_APP_PASSWORD`

Optional native environment keys:

- `NATIVE_MCP_SERVER_ARGS`
- `OTP_CODE_FILE` defaults to `scripts/.otp-codes/latest.txt` if unset

## Provider Readiness Table Template

Use this in release notes or run logs:

| Provider | Web Status | Native Status | Last Verified | Evidence Path | Blockers |
|---|---|---|---|---|---|
| Google Meet | TBD | N/A | YYYY-MM-DD | `artifacts/provider-detection/...` |  |
| Zoom | TBD | TBD | YYYY-MM-DD | `artifacts/provider-detection/...` |  |
| Microsoft Teams | TBD | TBD | YYYY-MM-DD | `artifacts/provider-detection/...` |  |
| Slack (Huddle) | TBD | TBD | YYYY-MM-DD | `artifacts/provider-detection/...` |  |
| Cisco Webex | TBD | TBD | YYYY-MM-DD | `artifacts/provider-detection/...` |  |

## OTP Listener (Required For OTP Flows)

Start the listener before native scenarios that may trigger verification codes:

```bash
bash scripts/tools/start-otp-listener.sh
```

Quick check that a code is available:

```bash
bash scripts/tools/get-otp.sh
cat scripts/.otp-codes/latest.txt
```

Full setup and troubleshooting:

- [scripts/tools/README-OTP-SETUP.md](../../scripts/tools/README-OTP-SETUP.md)

## Workflow

The GitHub Actions workflow lives in [`.github/workflows/meeting-e2e.yml`](../../.github/workflows/meeting-e2e.yml).

- Web E2E runs on macOS
- Native E2E only runs on `workflow_dispatch` and only on a self-hosted runner

## Artifact Locations

- Web artifacts: `artifacts/web/<timestamp>/<scenario>/`
- Native artifacts: `artifacts/native/<timestamp>/<provider>/`

Each scenario writes structured step logs, lifecycle events, and screenshots so failures can be debugged without rerunning blindly.
