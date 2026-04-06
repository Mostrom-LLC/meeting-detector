# Live Provider Matrix Test Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute and prove full live meeting lifecycle detection (`meeting_started` and `meeting_ended`) across web and native providers with reproducible evidence and regression checks.

**Architecture:** Launch Google Chrome once with `--remote-debugging-port=9222` using the persistent `openclaw` profile (`Profile 28`). The Chrome data dir must be moved to a non-default path (Chrome rejects `--remote-debugging-port` with the default data dir) and launched via `open -a` (so macOS TCC attributes Chrome to LaunchServices, not cmux). Connect to the running Chrome via CDP using Playwright `connectOverCDP()`. The browser stays open and logged in between test runs — cookies, sessions, and permissions persist.

**Critical TCC requirement:** Before each provider test, reset Chrome's mic TCC grant with `tccutil reset Microphone com.google.Chrome` and grant browser-level permissions via `ctx.grantPermissions(['camera', 'microphone'])`. This forces a fresh TCC access request on page reload, generating the TCC signals the detector monitors. Without this reset, cached grants produce zero TCC signals and the detector sees nothing.

**Why not cmux?** cmux's embedded browser uses WKWebView which is missing `com.apple.security.device.camera` and `com.apple.security.device.audio-input` entitlements. This means `navigator.mediaDevices` is `undefined` — meeting platforms cannot access mic/camera. Additionally, any process launched from cmux's terminal inherits cmux as the "responsible process" for TCC, which blocks mic/camera access even for Chrome.

**Why not Playwright fresh launch?** Launching a fresh Chromium instance on every test run triggers captchas, requires re-authentication, and is slow. CDP connection to an existing Chrome profile avoids all of this.

**Tech Stack:** Node.js, Playwright `connectOverCDP()` (connects to existing Chrome, no launch), `test/e2e/web/detector-harness.ts`, `scripts/e2e/run-web-e2e.mjs`, native-devtools MCP (`scripts/e2e/run-native-mcp-e2e.mjs`), OTP helper scripts in `scripts/tools`.

**Chrome Profile:**
- Profile name: `openclaw`
- Profile directory: `Profile 28`
- Full path: `~/Library/Application Support/Google/Chrome/Profile 28`
- Account: `agent@mostrom.io` (Openclaw Agent)

---

### Task 1: Preflight Environment and Credentials

**Files:**
- Verify: `.env`, `.env.e2e` (or `.env.e2e.example` for reference)
- Verify: `scripts/tools/start-otp-listener.sh`
- Verify: `scripts/tools/get-otp.sh`
- Verify: `scripts/media-state`
- Verify: `test/e2e/web/providers.spec.ts`
- Verify: `test/e2e/web/detector-harness.ts`
- Verify: `scripts/e2e/run-web-e2e.mjs`

- [ ] **Step 1: Confirm required credentials and URLs are present in `.env` / `.env.e2e`**

Run:
```bash
rg -n "GMAIL_|GOOGLE_|E2E_|OTP_" .env .env.e2e 2>/dev/null
```
Expected: account/env keys are visible (do not print secrets into reports). At minimum, `E2E_GOOGLE_MEET_URL` must be set. Other `E2E_*_URL` vars enable their respective provider tests.

- [ ] **Step 2: Start OTP listener if any provider triggers OTP**

Run:
```bash
bash scripts/tools/start-otp-listener.sh
```
Expected: listener starts and writes `.otp-codes/latest.txt`.

- [ ] **Step 3: Validate OTP retrieval path**

Run:
```bash
bash scripts/tools/get-otp.sh
```
Expected: latest code output or explicit "no OTP yet" message.

- [ ] **Step 4: Confirm detector media gate baseline**

Run:
```bash
./scripts/media-state
```
Expected before joined call: typically `{"camera":false|true,"mic":false}`.

- [ ] **Step 5: Confirm TypeScript builds cleanly**

Run:
```bash
npm run build:ts
```
Expected: clean build, `dist/` updated.

### Task 2: Launch Chrome with CDP and Verify Session

**Files:**
- Runtime only (no files created)

Chrome must be launched with `--remote-debugging-port=9222` using the `openclaw` profile. Once running, it stays open for all web test runs.

- [ ] **Step 1: Quit any existing Chrome instances**

```bash
osascript -e 'tell application "Google Chrome" to quit' 2>/dev/null
sleep 3
pkill -9 -f "Google Chrome" 2>/dev/null; sleep 2
```

- [ ] **Step 2: Move Chrome data dir to non-default path (required for --remote-debugging-port)**

```bash
CHROME_DATA="$HOME/Library/Application Support/Google/Chrome"
CDP_DIR="$HOME/Library/Application Support/Google/ChromeCDP2"
rm -rf "$CDP_DIR"
mv "$CHROME_DATA" "$CDP_DIR"
ln -s "$CDP_DIR" "$CHROME_DATA"  # symlink so other tools find Chrome data
```

- [ ] **Step 3: Launch Chrome via `open -a` (sets LaunchServices as responsible process for TCC)**

```bash
open -a "Google Chrome" --args \
  --remote-debugging-port=9222 \
  --user-data-dir="$CDP_DIR" \
  --profile-directory="Profile 28" \
  --no-first-run \
  --no-default-browser-check \
  --restore-last-session
```
Expected: Chrome opens with the `openclaw` profile (agent@mostrom.io), CDP listening on port 9222.

**Important:** Must use `open -a` not direct binary launch. If launched directly from cmux terminal, macOS TCC will attribute Chrome to cmux (which lacks mic/camera entitlements), blocking all media access.

- [ ] **Step 4: Verify CDP is accessible**

```bash
curl -s http://localhost:9222/json/version | head -5
```
Expected: JSON with `Browser`, `Protocol-Version`, `webSocketDebuggerUrl` fields.

- [ ] **Step 5: Verify logged-in session and mic/camera via CDP**

```bash
# Verify login
node -e "
const pw = require('playwright');
(async () => {
  const browser = await pw.chromium.connectOverCDP('http://localhost:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://meet.google.com/landing', { waitUntil: 'domcontentloaded', timeout: 15000 });
  console.log('Title:', await page.title());
  console.log('Signed in:', !page.url().includes('accounts.google.com'));
})().catch(e => console.error(e.message));
"

# Verify mic/camera by resetting TCC, granting permissions, and running detector
tccutil reset Microphone com.google.Chrome
node -e "
const pw = require('playwright');
(async () => {
  const browser = await pw.chromium.connectOverCDP('http://localhost:9222');
  const ctx = browser.contexts()[0];
  await ctx.grantPermissions(['camera', 'microphone'], { origin: 'https://meet.google.com' });
  const page = ctx.pages()[0];
  await page.locator('button', { hasText: 'New meeting' }).click();
  await page.locator('[role=menuitem]', { hasText: 'Start an instant meeting' }).click();
  await page.waitForURL(/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/, { timeout: 15000 });
  console.log('Meeting:', page.url());
})().catch(e => console.error(e.message));
"
```
Expected: Google Meet loads signed in; detector captures `meeting_started` with `mic=true`.

### Task 3: Adapt Web E2E Tests for CDP Connection

**Files:**
- Modify: `scripts/e2e/run-web-e2e.mjs`
- Modify: `test/e2e/web/providers.spec.ts` (if needed)
- Modify: playwright config (if needed)

The existing Playwright tests use `context.grantPermissions()` and launch fresh Chromium. They need to be adapted to connect to the existing Chrome via CDP instead.

- [ ] **Step 1: Update run-web-e2e.mjs to pass CDP endpoint**

Set `PLAYWRIGHT_CDP_ENDPOINT=http://localhost:9222` in the environment so the test suite connects to the running Chrome instead of launching a new browser.

- [ ] **Step 2: Update providers.spec.ts to use the existing browser context**

Key changes:
- Remove `context.grantPermissions()` calls (permissions are already granted in the persistent profile)
- Use the existing browser context from the CDP connection
- Navigate using existing tabs or new tabs (not new contexts)
- Ensure cleanup closes tabs but NOT the browser

- [ ] **Step 3: Verify a single provider test works end-to-end**

Run:
```bash
E2E_GOOGLE_MEET_URL=<url> node scripts/e2e/run-web-e2e.mjs --grep "Google Meet"
```
Expected: Google Meet test passes with `meeting_started` and `meeting_ended` events captured.

### Task 4: Provision Meeting URLs and Run Full Web Matrix

**Files:**
- Create/update: `.env.e2e`
- Capture artifacts: `artifacts/web/<timestamp>/`

- [ ] **Step 1: Create meeting URLs for each provider**

Create live meeting rooms and set in `.env.e2e`:
```
E2E_GOOGLE_MEET_URL=https://meet.google.com/<room-code>
E2E_ZOOM_WEB_URL=https://zoom.us/j/<meeting-id>
E2E_TEAMS_WEB_URL=https://teams.microsoft.com/l/meetup-join/...
E2E_SLACK_HUDDLE_WEB_URL=https://app.slack.com/huddle/...
E2E_WEBEX_WEB_URL=https://meet.webex.com/...
```

Note: Providers without a URL set will be skipped gracefully by the test suite.

- [ ] **Step 2: Run the full web matrix**

```bash
node scripts/e2e/run-web-e2e.mjs
```
Expected: Each enabled provider test runs serially in the existing Chrome, writes artifacts to `artifacts/web/<timestamp>/`.

- [ ] **Step 3: If specific providers fail, run them individually**

```bash
node scripts/e2e/run-web-e2e.mjs --grep "Google Meet"
node scripts/e2e/run-web-e2e.mjs --grep "Zoom"
node scripts/e2e/run-web-e2e.mjs --grep "Teams"
node scripts/e2e/run-web-e2e.mjs --grep "Slack"
node scripts/e2e/run-web-e2e.mjs --grep "Webex"
```

- [ ] **Step 4: Build web matrix summary JSON**

Required per provider:
```json
{
  "provider": "...",
  "started_count": 1,
  "ended_count": 1,
  "started_platforms": ["..."],
  "ended_platforms": ["..."],
  "pass": true
}
```

### Task 5: Run Full Live Native Provider Matrix (MCP)

**Files:**
- Verify/Run: `scripts/e2e/run-native-mcp-e2e.mjs`
- Verify scenarios: `test/e2e/native/scenarios/*.json`
- Capture artifacts: `artifacts/native-e2e/`

- [ ] **Step 1: Validate native runner prerequisites**

Run:
```bash
node scripts/e2e/run-native-mcp-e2e.mjs --help
```

- [ ] **Step 2: Run Teams native live scenario**

Run:
```bash
E2E_NATIVE_CONFIRM=1 node scripts/e2e/run-native-mcp-e2e.mjs --provider teams-native
```
Expected: `meeting_started` + `meeting_ended` for `Microsoft Teams`.

- [ ] **Step 3: Run Zoom native live scenario**
Expected: started/ended for `Zoom`.

- [ ] **Step 4: Run Slack native huddle scenario**
Expected: started/ended for `Slack`.

- [ ] **Step 5: Run Webex native scenario**
Expected: started/ended for `Cisco Webex`.

### Task 6: Evidence and Success Criteria Validation

**Files:**
- Verify artifacts: `artifacts/web/...`, `artifacts/native-e2e/...`
- Update tracking: `Tasks/todo.md`

- [ ] **Step 1: Validate lifecycle correctness for each run**

For every provider run, assert:
```text
1) meeting_started.platform == expected provider
2) meeting_ended.platform == expected provider
3) meeting_started.started_at exists
4) meeting_ended.ended_at exists
5) meeting_ended.started_at matches the started event for same session
6) meeting_ended.ended_at > meeting_started.started_at
```

- [ ] **Step 2: Validate regression criteria (idle/open apps)**

Run idle check with native apps open but no active meeting:
```bash
node scripts/live-test.mjs --duration 25 --out artifacts/idle-regression/events.ndjson --label idle-regression
```
Expected: `Started: 0`, `Ended: 0`.

- [ ] **Step 3: Publish consolidated matrix report**

Include:
```text
- Web matrix pass/fail per provider
- Native matrix pass/fail per provider
- Mic gate status (confirmed working via Chrome CDP + persistent profile)
- Remaining blockers with exact evidence paths
```

### Task 7: Reference Commands and Policies

**Files:**
- Reference only (commands below)

- [ ] **Step 1: Key commands for this runbook**

```bash
# Launch Chrome with CDP (one-time, stays open) — MUST use open -a for TCC
CDP_DIR="$HOME/Library/Application Support/Google/ChromeCDP2"
open -a "Google Chrome" --args \
  --remote-debugging-port=9222 \
  --user-data-dir="$CDP_DIR" \
  --profile-directory="Profile 28" \
  --no-first-run --no-default-browser-check --restore-last-session

# Verify CDP is alive
curl -s http://localhost:9222/json/version

# Reset TCC before each provider test (critical for detector signals)
tccutil reset Microphone com.google.Chrome

# Run full web matrix
node scripts/e2e/run-web-e2e.mjs

# Run single web provider
node scripts/e2e/run-web-e2e.mjs --grep "Google Meet"

# Run native provider
E2E_NATIVE_CONFIRM=1 node scripts/e2e/run-native-mcp-e2e.mjs --provider teams-native

# Check media state
./scripts/media-state

# Run idle regression
node scripts/live-test.mjs --duration 25 --out artifacts/idle-regression/events.ndjson --label idle-regression
```

- [ ] **Step 2: Credentials policy**

```text
Use credentials from `.env` and `.env.e2e` only.
Do not copy plaintext secrets into docs/artifacts/commits.
For reporting, reference env var names (e.g., GMAIL_EMAIL, GMAIL_APP_PASSWORD, E2E_*).
```

---

## Definition of Done

- Chrome launched once with CDP on port 9222 using `openclaw` profile (Profile 28, agent@mostrom.io).
- Full web matrix: all 5 providers pass with valid start/end lifecycle evidence using persistent Chrome session.
- Full native matrix: all 4 providers pass with valid start/end lifecycle evidence.
- Idle regression check passes (no false starts with apps open but not in call).
- Consolidated report produced with artifact links and blocker status.

---

## Consolidated Results (2026-04-04)

### Web Provider Matrix

| Provider | Status | started_count | ended_count | Evidence |
|---|---|---|---|---|
| Google Meet | **PASS** | 1 | 1 | `artifacts/live-web/google-meet-web/events.ndjson` |
| Zoom | SKIPPED | - | - | No `E2E_ZOOM_WEB_URL` provisioned |
| Microsoft Teams | SKIPPED | - | - | No `E2E_TEAMS_WEB_URL` provisioned |
| Slack Huddle | SKIPPED | - | - | No `E2E_SLACK_HUDDLE_WEB_URL` provisioned |
| Cisco Webex | SKIPPED | - | - | No `E2E_WEBEX_WEB_URL` provisioned |

### Native Provider Matrix

| Provider | Status | Notes |
|---|---|---|
| Microsoft Teams | SKIPPED | No native meeting URLs configured |
| Zoom | SKIPPED | No native meeting URLs configured |
| Slack | SKIPPED | No native meeting URLs configured |
| Cisco Webex | SKIPPED | No native meeting URLs configured |

### Idle Regression

| Check | Status | Events |
|---|---|---|
| Idle (no active meeting) | **PASS** | 0 started, 0 ended |

### Google Meet Lifecycle Validation

```
✓ meeting_started.platform == "Google Meet"
✓ meeting_ended.platform == "Google Meet"
✓ meeting_started.started_at == "2026-04-04T21:38:53Z"
✓ meeting_ended.ended_at == "2026-04-04T21:39:34.630Z"
✓ meeting_ended.started_at matches started event
✓ ended_at > started_at
✓ confidence == "high" for both events
✓ mic_active == true, camera_active == true at start
```

### Critical Findings

1. **Chrome must be killed and relaunched before each test run** — TCC signals are only generated on the first mic/camera access after Chrome starts. Subsequent accesses use cached grants and produce no signals.

2. **TCC must be reset before relaunch** — `tccutil reset Microphone com.google.Chrome && tccutil reset Camera com.google.Chrome` ensures fresh TCC requests are made.

3. **Chrome must be launched via `open -a`** — Direct launch from cmux terminal causes macOS to attribute Chrome to cmux's process, which lacks mic/camera entitlements.

4. **`media-state` binary is unreliable from cmux** — Always reports `mic:false` due to cmux's missing TCC entitlements. Use detector events or TCC logs to verify mic state.

5. **Playwright `grantPermissions` is required** — Grants browser-level site permissions so Chrome doesn't show the "Use microphone and camera" dialog.

### Remaining Work

- Provision meeting URLs for Zoom, Teams, Slack, Webex web providers
- Run remaining web provider tests
- Run native provider tests (requires installed native apps)
- Investigate Microsoft Teams false positive (Teams Audio device driver generates background signals)
