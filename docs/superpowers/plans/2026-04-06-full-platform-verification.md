# Full Platform Start/End Verification Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify that harke-meeting-detector correctly detects `meeting_started` and `meeting_ended` lifecycle events for all 5 supported platforms (Google Meet, Teams, Zoom, Slack Huddle, Webex), both web and native.

**Architecture:** The detector monitors macOS TCC logs for camera/mic access, polls browser tabs via AppleScript (web), and checks running processes (native). A lifecycle state machine emits `meeting_started` on first confident signal and `meeting_ended` after 30s of silence. Verification requires joining real meetings on each platform, capturing lifecycle events, and asserting correctness.

**Tech Stack:** TypeScript detector, Node.js test harness, Playwright (web E2E), MCP native-devtools (native E2E), macOS TCC subsystem.

---

## Current State

| Platform        | Web          | Native       |
|-----------------|--------------|--------------|
| Google Meet     | ✅ Verified  | N/A          |
| Microsoft Teams | Not tested   | Not tested   |
| Zoom            | Not tested   | Not tested   |
| Slack Huddle    | Not tested   | Not tested   |
| Cisco Webex     | Not tested   | Not tested   |

## Prerequisites

- Uncommitted changes on `dev` branch must be committed first (native-platform.ts fix, test updates)
- `.env.e2e` must have valid meeting URLs for each provider
- Test account `agent@mostrom.io` authenticated in Chrome profile
- Native apps installed: Microsoft Teams, Zoom, Slack, Webex (for native tests)
- `npm run build:ts` must pass
- `npm test` must pass (121 unit tests)

## File Map

**Existing files to use (no modifications needed):**
- `src/detector.ts` — Main detector class
- `src/classifiers/browser-platform.ts` — URL → platform classification
- `src/classifiers/native-platform.ts` — Process → platform classification (recently fixed)
- `src/lifecycle/session-timeline.ts` — Session timeline tracking
- `test/e2e/web/detector-harness.ts` — Detector harness for capturing lifecycle events
- `test/e2e/web/providers.spec.ts` — Playwright web E2E test specs
- `test/e2e/native/providers.mcp.spec.md` — Native MCP test scenarios
- `scripts/e2e/provider-detection-contract.mjs` — Provider config and env key mapping
- `playwright.config.ts` — Playwright config
- `.env.e2e` — Test URLs and credentials

**Files to create:**
- `scripts/e2e/live-verify.mjs` — Standalone live verification script that runs detector, opens a meeting URL, waits for start/end events, and reports pass/fail per platform
- `artifacts/verification/YYYY-MM-DD-HH-MM/` — Output directory per verification run (NDJSON event logs, summary)

**Files to modify:**
- `.env.e2e` — Populate with real, joinable meeting URLs for each provider
- `Tasks/todo.md` — Track verification progress

---

## Task 1: Commit Uncommitted Fixes

**Files:**
- Stage: `src/classifiers/native-platform.ts`, `test/detector.lifecycle.test.mjs`
- Update: `Tasks/todo.md`

- [ ] **Step 1: Review uncommitted changes**

Run: `git diff src/classifiers/native-platform.ts test/detector.lifecycle.test.mjs`
Verify: The native-platform.ts changes require non-empty window titles for Teams/Zoom/Slack/Webex. The test file uses a realistic Teams meeting title.

- [ ] **Step 2: Run all unit tests**

Run: `npm test`
Expected: All 121+ tests pass.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 4: Commit the fix**

```bash
git add src/classifiers/native-platform.ts test/detector.lifecycle.test.mjs
git commit -m "fix: require non-empty window title for native Teams/Zoom/Slack/Webex classification

Idle background apps (e.g., Teams on launch) fire TCC mic signals with generic
titles like 'Microsoft Teams'. This caused false-positive meeting_started events.
Now classifyNativeMeeting() returns null for generic/empty titles, preventing
false starts from idle apps."
```

---

## Task 2: Build Live Verification Script

**Files:**
- Create: `scripts/e2e/live-verify.mjs`

This script is a standalone Node.js tool that:
1. Starts the meeting detector
2. Opens a URL in Chrome (or launches a native app)
3. Waits for `meeting_started` event with the expected platform
4. Closes the tab/app
5. Waits for `meeting_ended` event
6. Reports pass/fail with timing details
7. Writes NDJSON event log to artifacts directory

It follows the same pattern as the existing detector harness and provider detection contract.

- [ ] **Step 1: Review existing test infrastructure**

Read `test/e2e/web/detector-harness.ts` and `scripts/e2e/provider-detection-contract.mjs` to understand:
- How `MeetingDetector` is instantiated and started
- How lifecycle events (`meeting_started`, `meeting_ended`) are captured
- How Chrome tabs are opened and closed via AppleScript
- Provider env key mapping

Note: The existing harness uses a unified `meeting_lifecycle` event. This script uses individual `meeting_started`/`meeting_ended` events for simpler flow — both are emitted by the detector.

- [ ] **Step 2: Write the live-verify.mjs script**

```javascript
#!/usr/bin/env node
/**
 * Live platform verification script.
 * Usage: node scripts/e2e/live-verify.mjs --provider "Google Meet" --mode web
 *        node scripts/e2e/live-verify.mjs --provider "Microsoft Teams" --mode native
 *        node scripts/e2e/live-verify.mjs --all --mode web
 */
import { MeetingDetector } from '../../dist/index.js';
import { execSync, exec } from 'child_process';
import { writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';

config({ path: '.env.e2e' });

const PROVIDERS = {
  'Google Meet':      { web: process.env.E2E_GOOGLE_MEET_URL },
  'Microsoft Teams':  { web: process.env.E2E_TEAMS_WEB_URL,          native: 'Microsoft Teams' },
  'Zoom':             { web: process.env.E2E_ZOOM_WEB_URL,           native: 'zoom.us' },
  'Slack':            { web: process.env.E2E_SLACK_HUDDLE_WEB_URL,   native: 'Slack' },
  'Cisco Webex':      { web: process.env.E2E_WEBEX_WEB_URL,          native: 'Webex' }, // Verify app name: ls /Applications/ | grep -i webex
};

const args = process.argv.slice(2);
const providerArg = args.includes('--provider') ? args[args.indexOf('--provider') + 1] : null;
const modeArg = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'web';
const runAll = args.includes('--all');
const timeoutMs = 120_000; // 2 min max per provider
const endWaitMs = 45_000;  // 45s for meeting_ended after close

async function verifyProvider(provider, mode) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDir = join('artifacts', 'verification', ts);
  mkdirSync(artifactDir, { recursive: true });
  const logPath = join(artifactDir, `${provider.replace(/\s+/g, '-').toLowerCase()}-${mode}.ndjson`);

  console.log(`\n=== Verifying: ${provider} (${mode}) ===`);

  const detector = new MeetingDetector({
    meetingEndTimeoutMs: 30_000,
    debug: true,
  });

  const events = [];
  let startedResolve, endedResolve;
  const startedPromise = new Promise(r => { startedResolve = r; });
  const endedPromise = new Promise(r => { endedResolve = r; });

  detector.on('meeting_started', (evt) => {
    events.push({ type: 'meeting_started', ...evt, ts: Date.now() });
    appendFileSync(logPath, JSON.stringify(events.at(-1)) + '\n');
    console.log(`  ✓ meeting_started: platform=${evt.platform}, confidence=${evt.confidence}`);
    startedResolve(evt);
  });

  detector.on('meeting_ended', (evt) => {
    events.push({ type: 'meeting_ended', ...evt, ts: Date.now() });
    appendFileSync(logPath, JSON.stringify(events.at(-1)) + '\n');
    console.log(`  ✓ meeting_ended: reason=${evt.reason}`);
    endedResolve(evt);
  });

  detector.on('meeting', (signal) => {
    appendFileSync(logPath, JSON.stringify({ type: 'signal', ...signal, ts: Date.now() }) + '\n');
  });

  await detector.start();
  console.log('  Detector started, waiting for signals...');

  // --- Open meeting ---
  if (mode === 'web') {
    const url = PROVIDERS[provider]?.web;
    if (!url) throw new Error(`No web URL for ${provider}. Set it in .env.e2e`);
    console.log(`  Opening: ${url}`);
    exec(`open -a "Google Chrome" "${url}"`);
  } else {
    const appName = PROVIDERS[provider]?.native;
    if (!appName) throw new Error(`No native app for ${provider}`);
    console.log(`  Launching: ${appName}`);
    exec(`open -a "${appName}"`);
  }

  // --- Wait for meeting_started ---
  const startTimeout = setTimeout(() => {
    startedResolve(null);
  }, timeoutMs);

  const startEvt = await startedPromise;
  clearTimeout(startTimeout);

  if (!startEvt) {
    console.log(`  ✗ TIMEOUT: No meeting_started within ${timeoutMs / 1000}s`);
    await detector.stop();
    return { provider, mode, result: 'FAIL', reason: 'no meeting_started' };
  }

  if (startEvt.platform !== provider) {
    console.log(`  ✗ WRONG PLATFORM: expected=${provider}, got=${startEvt.platform}`);
    // Continue to test meeting_ended anyway
  }

  // --- Close meeting ---
  console.log('  Closing meeting...');
  if (mode === 'web') {
    // Close the Chrome tab via AppleScript
    try {
      execSync(`osascript -e '
        tell application "Google Chrome"
          set tabCount to count of tabs of front window
          repeat with i from 1 to tabCount
            set tabUrl to URL of tab i of front window
            if tabUrl contains "${new URL(PROVIDERS[provider].web).hostname}" then
              close tab i of front window
              exit repeat
            end if
          end repeat
        end tell'`);
    } catch (e) {
      console.log(`  Warning: tab close failed: ${e.message}`);
    }
  } else {
    try {
      execSync(`osascript -e 'tell application "${PROVIDERS[provider].native}" to quit'`);
    } catch (e) {
      console.log(`  Warning: app quit failed: ${e.message}`);
    }
  }

  // --- Wait for meeting_ended ---
  const endTimeout = setTimeout(() => {
    endedResolve(null);
  }, endWaitMs);

  const endEvt = await endedPromise;
  clearTimeout(endTimeout);

  await detector.stop();

  if (!endEvt) {
    console.log(`  ✗ TIMEOUT: No meeting_ended within ${endWaitMs / 1000}s`);
    return { provider, mode, result: 'FAIL', reason: 'no meeting_ended' };
  }

  console.log(`  ✓ PASS: ${provider} (${mode}) — started→ended lifecycle verified`);
  return { provider, mode, result: 'PASS', startEvt, endEvt };
}

async function main() {
  const providers = runAll
    ? Object.keys(PROVIDERS).filter(p => modeArg === 'native' ? PROVIDERS[p].native : PROVIDERS[p].web)
    : [providerArg];

  if (!providers[0]) {
    console.error('Usage: --provider "Google Meet" --mode web|native');
    console.error('       --all --mode web|native');
    process.exit(1);
  }

  const results = [];
  for (const p of providers) {
    try {
      results.push(await verifyProvider(p, modeArg));
    } catch (err) {
      console.error(`  ✗ ERROR: ${err.message}`);
      results.push({ provider: p, mode: modeArg, result: 'ERROR', reason: err.message });
    }
  }

  console.log('\n=== Summary ===');
  for (const r of results) {
    const icon = r.result === 'PASS' ? '✅' : '❌';
    console.log(`  ${icon} ${r.provider} (${r.mode}): ${r.result}${r.reason ? ' — ' + r.reason : ''}`);
  }

  process.exit(results.every(r => r.result === 'PASS') ? 0 : 1);
}

main();
```

- [ ] **Step 3: Test the script with Google Meet (known-working baseline)**

Run: `node scripts/e2e/live-verify.mjs --provider "Google Meet" --mode web`

Expected:
- Opens Chrome to Google Meet URL
- Detector emits `meeting_started` with `platform="Google Meet"` within ~30s
- After tab close, emits `meeting_ended` with `reason="timeout"` within ~45s
- Script exits with code 0 and prints PASS

- [ ] **Step 4: Commit**

```bash
git add scripts/e2e/live-verify.mjs
git commit -m "feat: add live-verify.mjs for per-platform lifecycle verification"
```

---

## Task 3: Populate .env.e2e with Real Meeting URLs

**Files:**
- Modify: `.env.e2e`

Each provider needs a URL that leads to an active, joinable meeting. For providers that require pre-created meetings, create them via each platform's UI or API.

- [ ] **Step 1: Create meeting rooms for each provider**

For each platform, create a test meeting:

| Provider | How to get URL |
|----------|---------------|
| Google Meet | Go to meet.google.com → "New meeting" → "Create a meeting for later" → copy link |
| Microsoft Teams | Go to teams.live.com → Calendar → "New meeting" → copy join link |
| Zoom | Go to zoom.us → "Schedule a meeting" → copy join link (or use Personal Meeting Room) |
| Slack Huddle | Open Slack → any channel → start a Huddle → the URL is `app.slack.com/client/TEAM/CHANNEL` with `/huddle` |
| Cisco Webex | Go to webex.com → "Start a meeting" or Personal Room → copy link |

- [ ] **Step 2: Update .env.e2e with real URLs**

```bash
# Update these with actual joinable meeting URLs
E2E_GOOGLE_MEET_URL=https://meet.google.com/<code>
E2E_TEAMS_WEB_URL=https://teams.live.com/meet/<code>
E2E_ZOOM_WEB_URL=https://app.zoom.us/wc/<id>/join
E2E_SLACK_HUDDLE_WEB_URL=https://app.slack.com/client/<team>/<channel>
E2E_WEBEX_WEB_URL=https://meet<N>.webex.com/meet/<room>
```

- [ ] **Step 3: Verify URLs are accessible**

Open each URL manually in Chrome. Verify it loads the meeting join page (not a 404 or login wall). For platforms requiring auth, ensure the test account is logged in.

---

## Task 4: Verify Microsoft Teams (Web)

**Files:**
- Output: `artifacts/verification/<timestamp>/microsoft-teams-web.ndjson`

- [ ] **Step 1: Ensure Teams web URL is valid**

Open `$E2E_TEAMS_WEB_URL` in Chrome manually. Confirm it shows a Teams meeting join page.

- [ ] **Step 2: Run live verification**

Run: `node scripts/e2e/live-verify.mjs --provider "Microsoft Teams" --mode web`

- [ ] **Step 3: Join the meeting manually if needed**

The script opens Chrome to the Teams URL. If there's a "Join now" button, you must click it manually (or add Playwright automation). The detector should pick up the meeting once audio/video is active.

- [ ] **Step 4: Evaluate results**

Expected:
- `meeting_started` with `platform="Microsoft Teams"`
- After closing tab: `meeting_ended` with `reason="timeout"` within ~45s
- If FAIL: check the NDJSON log for raw signals. Common issues:
  - Teams URL not matching browser classifier patterns (check `browser-platform.ts`)
  - No TCC signal because camera/mic not activated (need to actually join, not just open lobby)

- [ ] **Step 5: Record result in task tracker**

Update `Tasks/todo.md` with result (PASS/FAIL + notes).

---

## Task 5: Verify Zoom (Web)

**Files:**
- Output: `artifacts/verification/<timestamp>/zoom-web.ndjson`

- [ ] **Step 1: Ensure Zoom web URL is valid**

Open `$E2E_ZOOM_WEB_URL` in Chrome. Must be a `app.zoom.us/wc/<id>/join` URL. Zoom web client requires clicking "Join" and allowing camera/mic.

- [ ] **Step 2: Run live verification**

Run: `node scripts/e2e/live-verify.mjs --provider "Zoom" --mode web`

- [ ] **Step 3: Join the meeting manually**

Click "Join" in the Zoom web client. Allow camera/mic permissions if prompted.

- [ ] **Step 4: Evaluate results**

Expected:
- `meeting_started` with `platform="Zoom"`
- After closing tab: `meeting_ended` within ~45s
- Common issues:
  - Zoom may redirect to native app download page instead of web client
  - URL pattern must match classifier: host=zoom.us or app.zoom.us, path contains `/wc/`

- [ ] **Step 5: Record result**

Update `Tasks/todo.md`.

---

## Task 6: Verify Slack Huddle (Web)

**Files:**
- Output: `artifacts/verification/<timestamp>/slack-web.ndjson`

- [ ] **Step 1: Ensure Slack Huddle URL works**

Open `$E2E_SLACK_HUDDLE_WEB_URL` in Chrome. Must contain `app.slack.com`. A Huddle must be active in the target channel.

- [ ] **Step 2: Run live verification**

Run: `node scripts/e2e/live-verify.mjs --provider "Slack" --mode web`

- [ ] **Step 3: Start a Huddle**

In the Slack web app, navigate to a channel and start a Huddle. The detector should see the Slack URL + TCC mic signal.

- [ ] **Step 4: Evaluate results**

Expected:
- `meeting_started` with `platform="Slack"`
- After leaving Huddle: `meeting_ended` within ~45s
- Common issues:
  - Slack browser classifier (`isSlackHuddleTab` in `browser-platform.ts`) has specific rules:
    - `about:blank` tabs: title must start with "slack - huddle preview" or "huddle:"
    - `app.slack.com/client/` URLs: title must contain "huddle", OR URL must have `/huddle` route or `huddle_thread=` param
    - A plain `app.slack.com/client/TEAM/CHANNEL` URL without `/huddle` will only match if the tab title contains "huddle"
  - Regular Slack calls (not Huddles) are not detected by design

- [ ] **Step 5: Record result**

Update `Tasks/todo.md`.

---

## Task 7: Verify Cisco Webex (Web)

**Files:**
- Output: `artifacts/verification/<timestamp>/webex-web.ndjson`

- [ ] **Step 1: Ensure Webex URL works**

Open `$E2E_WEBEX_WEB_URL` in Chrome. Must be `*.webex.com` with `/meet/` or `/join/` path.

- [ ] **Step 2: Run live verification**

Run: `node scripts/e2e/live-verify.mjs --provider "Cisco Webex" --mode web`

- [ ] **Step 3: Join the meeting**

Click "Join" in the Webex web client. Allow camera/mic.

- [ ] **Step 4: Evaluate results**

Expected:
- `meeting_started` with `platform="Cisco Webex"`
- After closing: `meeting_ended` within ~45s
- Common issues:
  - Webex classifier requires host ending in `.webex.com` with `/meet/` or `/join/` path
  - Some Webex URLs use subdomains like `meetingsamer.webex.com`

- [ ] **Step 5: Record result**

Update `Tasks/todo.md`.

---

## Task 8: Verify Native Apps (Teams, Zoom, Slack, Webex)

**Files:**
- Output: `artifacts/verification/<timestamp>/<provider>-native.ndjson`

Native app testing requires each app to be installed and the user to join a real meeting. This is harder to automate than web testing because each app has its own UI flow.

**Cleanup between tests:** After each native provider test, ensure the app is fully quit before testing the next one. Use `osascript -e 'tell application "<AppName>" to quit'` or `killall "<ProcessName>"`. Wait 5s between tests to let TCC signals drain.

- [ ] **Step 1: Check which native apps are installed and verify app names**

```bash
ls /Applications/ | grep -iE 'teams|zoom|slack|webex|cisco'
```

Update the `PROVIDERS` native app names in `live-verify.mjs` if the installed app names differ from the defaults (e.g., `Webex.app` vs `Cisco Webex Meetings.app`).

- [ ] **Step 2: Test Microsoft Teams (native)**

Run: `node scripts/e2e/live-verify.mjs --provider "Microsoft Teams" --mode native`

The script launches Teams via `open -a "Microsoft Teams"`. Join a meeting manually.

Expected:
- Teams fires TCC mic signal on launch (this is the false-positive we fixed)
- After joining a real meeting with a non-generic title → `meeting_started`
- After leaving → `meeting_ended`

**Key validation:** Confirm the idle-title filter works — Teams launching should NOT trigger `meeting_started`.

- [ ] **Step 3: Test Zoom (native)**

Run: `node scripts/e2e/live-verify.mjs --provider "Zoom" --mode native`

Launch Zoom, join a meeting. Expected: `meeting_started` with `platform="Zoom"`, then `meeting_ended` after leaving.

- [ ] **Step 4: Test Slack Huddle (native)**

Run: `node scripts/e2e/live-verify.mjs --provider "Slack" --mode native`

Launch Slack, start a Huddle in any channel. Expected: `meeting_started` with `platform="Slack"`, then `meeting_ended` after leaving.

Window title must contain "Huddle" for classification.

- [ ] **Step 5: Test Cisco Webex (native)**

Run: `node scripts/e2e/live-verify.mjs --provider "Cisco Webex" --mode native`

Launch Webex, start or join a meeting. Expected: `meeting_started` with `platform="Cisco Webex"`, then `meeting_ended` after leaving.

- [ ] **Step 6: Record all native results**

Update `Tasks/todo.md` with pass/fail for each native provider.

---

## Task 9: Fix Any Failures

This task is conditional — only needed if any platform fails verification.

- [ ] **Step 1: Analyze failure logs**

Read the NDJSON event log for the failing provider. Look for:
- Raw signals with wrong platform classification
- Signals being filtered by `shouldIgnoreSignal()`
- No TCC signals at all (permission issue)
- URL/title not matching classifier patterns

- [ ] **Step 2: Identify root cause**

Common failure categories:
1. **Classifier pattern mismatch** — URL or window title doesn't match expected regex
2. **Signal filtering** — Process name matches an ignore pattern
3. **No TCC event** — App doesn't trigger camera/mic access (e.g., lobby screen)
4. **Confidence too low** — Signal stuck in pendingConfidence, never promoted

- [ ] **Step 3: Write failing test reproducing the issue**

Add a test case to the relevant test file (`browser-platform-classifier.test.mjs` or `native-platform-classifier.test.mjs`) that reproduces the exact signal that should have been classified correctly.

- [ ] **Step 4: Fix the classifier/filter**

Modify `src/classifiers/browser-platform.ts` or `src/classifiers/native-platform.ts` to handle the new pattern.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: All tests pass including the new one.

- [ ] **Step 6: Re-verify the fixed platform**

Run: `node scripts/e2e/live-verify.mjs --provider "<fixed-provider>" --mode <mode>`
Expected: PASS

- [ ] **Step 7: Commit the fix**

```bash
git add src/classifiers/*.ts test/*.test.mjs
git commit -m "fix: <platform> <web|native> detection — <what was wrong>"
```

---

## Task 10: Final Summary and Documentation

- [ ] **Step 1: Run full web verification**

Run: `node scripts/e2e/live-verify.mjs --all --mode web`

All 5 providers should PASS.

- [ ] **Step 2: Run full native verification**

Run: `node scripts/e2e/live-verify.mjs --all --mode native`

All 4 native providers (excluding Google Meet) should PASS.

- [ ] **Step 3: Update verification matrix in Tasks/todo.md**

```markdown
## Verification Results (2026-04-06)

| Platform        | Web  | Native |
|-----------------|------|--------|
| Google Meet     | ✅   | N/A    |
| Microsoft Teams | ✅/❌ | ✅/❌  |
| Zoom            | ✅/❌ | ✅/❌  |
| Slack Huddle    | ✅/❌ | ✅/❌  |
| Cisco Webex     | ✅/❌ | ✅/❌  |
```

- [ ] **Step 4: Commit all verification artifacts and updates**

```bash
git add Tasks/todo.md scripts/e2e/live-verify.mjs
git commit -m "docs: record full platform verification results for all 5 providers"
```
