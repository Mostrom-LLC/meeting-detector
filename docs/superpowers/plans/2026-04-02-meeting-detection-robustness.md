# Meeting Detection Robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship robust native + web meeting detection that records reliable meeting start/end boundaries and proves behavior with fully automated provider-level tests.

**Architecture:** Keep the existing TypeScript detector as the production path on macOS, but split provider classification and lifecycle session timing into focused modules with shared logic across parser/probe filters. Build a layered test pyramid: deterministic unit/lifecycle tests, automated browser E2E driven by Playwright, and automated native-client E2E driven by native-devtools MCP orchestration. Persist per-scenario artifacts (NDJSON + raw logs) so failures are debuggable and attributable.

**Tech Stack:** TypeScript, Node test runner (`node --test`), Playwright, native-devtools MCP, existing OTP listener scripts in `scripts/tools`, existing detector NDJSON logging utilities.

---

## Scope Check
This request spans two coupled subsystems that should ship together in one plan:
1. Detection correctness (start/end boundaries + provider attribution).
2. End-to-end automated verification (web + native) across the same provider matrix.

They are tightly coupled via acceptance criteria, so this remains one implementation plan with isolated tasks and clear interfaces.

## File Structure Map

### New files
- `src/classifiers/browser-platform.ts`
  - Single source of truth for browser URL/title matching (Meet, Teams, Zoom, Slack Huddle, Webex).
- `src/classifiers/native-platform.ts`
  - Native process/window evidence scoring and platform attribution helpers.
- `src/lifecycle/session-timeline.ts`
  - Tracks active meeting session IDs and canonical `started_at`/`ended_at` timestamps.
- `test/helpers/signal-fixtures.mjs`
  - Shared raw signal fixtures for provider scenarios.
- `test/helpers/scenario-runner.mjs`
  - Shared detector scenario runner for lifecycle tests.
- `test/browser-platform-classifier.test.mjs`
  - Classifier parity tests for every provider route/title shape.
- `test/native-platform-classifier.test.mjs`
  - Native attribution tests for Teams, Zoom, Slack Huddle, Webex.
- `test/lifecycle.session-timeline.test.mjs`
  - Start/end boundary semantics and duration checks.
- `test/e2e/web/providers.spec.ts`
  - Playwright E2E suite for browser meetings (5 providers).
- `test/e2e/web/detector-harness.ts`
  - Starts/stops detector and captures lifecycle NDJSON during browser tests.
- `test/e2e/native/providers.mcp.spec.md`
  - Native suite contract and assertion semantics.
- `test/e2e/native/scenarios/teams-native.json`
  - Action graph for Teams native join/leave automation.
- `test/e2e/native/scenarios/zoom-native.json`
  - Action graph for Zoom native join/leave automation.
- `test/e2e/native/scenarios/slack-huddle-native.json`
  - Action graph for Slack Huddle join/leave automation.
- `test/e2e/native/scenarios/webex-native.json`
  - Action graph for Webex native join/leave automation.
- `scripts/e2e/run-web-e2e.mjs`
  - CLI wrapper for Playwright suite + artifact collation.
- `scripts/e2e/run-native-mcp-e2e.mjs`
  - Orchestrates native-devtools MCP automation flow + artifact capture.
- `scripts/e2e/native/mcp-client.mjs`
  - MCP JSON-RPC client (stdio transport) for native-devtools tool calls.
- `scripts/e2e/native/mcp-driver.mjs`
  - Concrete native-devtools MCP bridge (launch/focus/find/click/type/screenshot/assert).
- `scripts/e2e/native/scenario-runner.mjs`
  - Loads scenario JSON and executes action graph through MCP driver.
- `scripts/e2e/lib/artifact-writer.mjs`
  - Standardized output paths for logs, NDJSON, and screenshots.
- `scripts/tools/otp-client.mjs`
  - Reads OTP codes from `.otp-codes/latest.txt` with timeout/retry semantics.
- `docs/testing/meeting-e2e.md`
  - Operator guide for local/CI execution and troubleshooting.
- `.env.e2e.example`
  - Explicit credential and meeting-link variable contract for E2E tests.

### Modified files
- `src/types.ts`
  - Extend lifecycle payload shape with session boundary fields.
- `src/detector.ts`
  - Consume new classifier/session modules; emit robust lifecycle start/end metadata.
- `src/index.ts`
  - CLI notifier support for explicit session boundary timestamps.
- `test/detector.lifecycle.test.mjs`
  - Update assertions for session boundary behavior.
- `test/browser-tab-match.test.mjs`
  - Migrate assertions to shared classifier module.
- `scripts/live-test.mjs`
  - Include `started_at`/`ended_at` and `session_id` in artifact output.
- `package.json`
  - Add E2E scripts and Playwright dependency.
- `README.md`
  - Add robust lifecycle semantics and new E2E command set.
- `tasks/todo.md`
  - Track execution checklist and review outcomes.

### Optional native parity files (if Rust path is enabled later)
- `native/src/matchers/webex.rs` (create)
- `native/src/matchers/mod.rs` (modify)
- `native/src/detector.rs` (modify for lifecycle parity)

## Tooling Decision
- Web E2E: **Playwright** (deterministic route/tab control and network-aware waits).
- Native E2E: **native-devtools MCP** (reliable desktop app automation without brittle pixel scripts).
- This satisfies the required “fully automated testing” constraint while keeping existing Node test infrastructure.

## Detector Source-Of-Truth Rule
After Task 3, provider attribution must come from shared classifiers only:
- `src/classifiers/browser-platform.ts` is the only browser meeting matcher.
- `src/classifiers/native-platform.ts` is the only native meeting matcher.
- `src/detector.ts` call sites that must be migrated:
  - `matchBrowserMeetingUrl()`
  - `matchBrowserMeetingTab()`
  - `hasStrongBrowserMeetingRoute()`
  - `transformAppName()`
  - `detectActiveNativeMeetingSignal()`
- No provider-specific regexes or process-name mapping may remain outside classifier modules.

---

### Task 1: Add Session Timeline Model for Explicit Start/End Boundaries

**Files:**
- Create: `src/lifecycle/session-timeline.ts`
- Modify: `src/types.ts`
- Modify: `src/detector.ts`
- Test: `test/lifecycle.session-timeline.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MeetingDetector } from '../dist/detector.js';

test('meeting_ended includes matching started_at and explicit ended_at', async () => {
  const detector = new MeetingDetector({ startupProbe: false, meetingEndTimeoutMs: 60 });
  const events = [];

  detector.on('meeting_started', (e) => events.push(e));
  detector.on('meeting_ended', (e) => events.push(e));

  detector['updateMeetingLifecycle']({
    event: 'meeting_signal',
    timestamp: '2026-04-02T12:00:00.000Z',
    service: 'Zoom',
    verdict: 'allowed',
    process: 'zoom.us',
    pid: '1',
    parent_pid: '0',
    process_path: '/Applications/zoom.us.app',
    front_app: 'zoom.us',
    window_title: 'Zoom Meeting',
    session_id: 'zoom-session-1',
    camera_active: true,
    preflight: false,
  });

  await new Promise((r) => setTimeout(r, 120));
  detector['handleMeetingEndTimeout']();

  const started = events.find((e) => e.event === 'meeting_started');
  const ended = events.find((e) => e.event === 'meeting_ended');
  assert.ok(started.started_at);
  assert.equal(ended.started_at, started.started_at);
  assert.ok(ended.ended_at);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build:ts && node --test test/lifecycle.session-timeline.test.mjs`
Expected: FAIL with missing `started_at` / `ended_at` lifecycle properties.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lifecycle/session-timeline.ts
export interface SessionTimelineState {
  sessionId: string;
  platform: string;
  startedAt: string;
  lastSeenAt: number;
}

export function createSessionId(platform: string, signal: { session_id: string; pid: string; timestamp: string }): string {
  if (signal.session_id) return `${platform}:${signal.session_id}`;
  if (signal.pid) return `${platform}:pid:${signal.pid}`;
  return `${platform}:ts:${signal.timestamp}`;
}
```

```typescript
// src/types.ts
export interface MeetingLifecycleEvent {
  // existing fields...
  session_id?: string;
  started_at?: string;
  ended_at?: string;
}
```

```typescript
// src/detector.ts (emitMeetingLifecycle)
const payload: MeetingLifecycleEvent = {
  event,
  timestamp: new Date().toISOString(),
  platform,
  confidence,
  reason,
  previous_platform: previousPlatform,
  session_id: timeline.sessionId,
  started_at: timeline.startedAt,
  ended_at: event === 'meeting_ended' ? new Date().toISOString() : undefined,
  raw_signal: this.options.includeRawSignalInLifecycle ? this.sanitizeSignalForOutput(signal) : undefined,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build:ts && node --test test/lifecycle.session-timeline.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lifecycle/session-timeline.ts src/types.ts src/detector.ts test/lifecycle.session-timeline.test.mjs
git commit -m "feat: add session timeline with explicit meeting start/end fields"
```

---

### Task 2: Unify Browser Provider Classification (Meet/Zoom/Teams/Slack/Webex)

**Files:**
- Create: `src/classifiers/browser-platform.ts`
- Modify: `src/detector.ts`
- Modify: `test/browser-tab-match.test.mjs`
- Test: `test/browser-platform-classifier.test.mjs`
- Test: `test/browser-probe-targets.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyBrowserMeeting } from '../dist/classifiers/browser-platform.js';

test('classifies webex browser meetings', () => {
  assert.equal(
    classifyBrowserMeeting('https://web.webex.com/meet/mostrom-room', 'Mostrom Room | Webex'),
    'Cisco Webex'
  );
});

test('does not classify webex marketing pages', () => {
  assert.equal(
    classifyBrowserMeeting('https://www.webex.com/', 'Webex Suite'),
    null
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build:ts && node --test test/browser-platform-classifier.test.mjs`
Expected: FAIL because classifier module does not exist and Webex route coverage is missing.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/classifiers/browser-platform.ts
import type { MeetingPlatform } from '../types.js';

export function classifyBrowserMeeting(urlInput: string, titleInput = ''): MeetingPlatform | null {
  const url = (urlInput || '').trim().toLowerCase();
  const title = (titleInput || '').trim().toLowerCase();

  if (/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:[/?#]|$)/.test(url)) return 'Google Meet';
  if (/https:\/\/(?:app\.)?zoom\.us\/(?:wc\/\d+\/(?:join|start)|wc\/join\/\d+|j\/\d+)/.test(url)) return 'Zoom';
  if (url.includes('teams.microsoft.com/l/meetup-join') || url.includes('teams.live.com/light-meetings')) return 'Microsoft Teams';
  if (url.includes('app.slack.com/') && (url.includes('/huddle') || title.includes('huddle'))) return 'Slack';
  if (url.includes('web.webex.com/meet/') || /https:\/\/[^/]+\.webex\.com\/(?:meet|join)\//.test(url)) return 'Cisco Webex';

  return null;
}
```

```typescript
// src/detector.ts (all browser call-sites must delegate to classifyBrowserMeeting)
import { classifyBrowserMeeting } from './classifiers/browser-platform.js';

export function matchBrowserMeetingUrl(urlInput: string, titleInput = ''): MeetingPlatform | null {
  return classifyBrowserMeeting(urlInput, titleInput);
}

export function matchBrowserMeetingTab(tab: BrowserTabInfo): MeetingPlatform | null {
  return classifyBrowserMeeting(tab.url, tab.title);
}
```

- [ ] **Step 3a: Remove duplicate browser matching logic in detector internals**

Replace internal provider checks in:
- `hasStrongBrowserMeetingRoute()`
- `transformAppName()`

with calls to `classifyBrowserMeeting()`, then delete redundant regex/process route branches from `src/detector.ts`.

- [ ] **Step 4: Run full browser classifier test set**

Run: `npm run build:ts && node --test test/browser-tab-match.test.mjs test/browser-platform-classifier.test.mjs test/browser-probe-targets.test.mjs`
Expected: PASS with Google Meet, Zoom, Teams, Slack Huddle, and Webex route coverage.

- [ ] **Step 5: Commit**

```bash
git add src/classifiers/browser-platform.ts src/detector.ts test/browser-tab-match.test.mjs test/browser-platform-classifier.test.mjs
git commit -m "feat: centralize browser platform classifier with webex support"
```

---

### Task 3: Harden Native App Attribution for Teams/Zoom/Slack Huddle/Webex

**Files:**
- Create: `src/classifiers/native-platform.ts`
- Modify: `src/detector.ts`
- Test: `test/native-platform-classifier.test.mjs`
- Modify: `test/detector.lifecycle.test.mjs`
- Test: `test/lifecycle.provider-matrix.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyNativeMeeting } from '../dist/classifiers/native-platform.js';

test('classifies native slack huddle from process + title', () => {
  const result = classifyNativeMeeting({
    process: 'Slack',
    windowTitle: 'Huddle in #engineering',
    micActive: true,
    cameraActive: false,
  });
  assert.equal(result, 'Slack');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build:ts && node --test test/native-platform-classifier.test.mjs`
Expected: FAIL because native classifier module does not exist.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/classifiers/native-platform.ts
import type { MeetingPlatform } from '../types.js';

interface NativeEvidence {
  process: string;
  windowTitle: string;
  micActive: boolean;
  cameraActive: boolean;
}

export function classifyNativeMeeting(e: NativeEvidence): MeetingPlatform | null {
  const process = e.process.toLowerCase();
  const title = e.windowTitle.toLowerCase();
  if (!e.micActive) return null;

  if (process.includes('msteams') || process.includes('microsoft teams')) {
    if (title.startsWith('chat')) return null;
    return 'Microsoft Teams';
  }
  if (process.includes('zoom')) return 'Zoom';
  if (process.includes('slack') && title.includes('huddle')) return 'Slack';
  if ((process.includes('webex') || process.includes('cisco webex')) && (title.includes('meeting') || title.includes('call'))) {
    return 'Cisco Webex';
  }
  return null;
}
```

```typescript
// src/detector.ts (native attribution call-sites)
import { classifyNativeMeeting } from './classifiers/native-platform.js';

const inferred = classifyNativeMeeting({
  process: selected.process,
  windowTitle: frontWindowTitle,
  micActive,
  cameraActive,
});
if (!inferred) return null;
```

- [ ] **Step 3a: Remove duplicate native attribution branches**

Migrate these call-sites to `classifyNativeMeeting()` and delete local provider rules:
- `detectActiveNativeMeetingSignal()`
- `looksLikeActiveNativeMeeting()`
- native process-name mapping inside `transformAppName()`

- [ ] **Step 4: Run native attribution and lifecycle regressions**

Run: `npm run build:ts && node --test test/native-platform-classifier.test.mjs test/detector.lifecycle.test.mjs`
Expected: PASS with no native idle-launch false positives and correct platform attribution.

- [ ] **Step 5: Commit**

```bash
git add src/classifiers/native-platform.ts src/detector.ts test/native-platform-classifier.test.mjs test/detector.lifecycle.test.mjs
git commit -m "feat: harden native meeting attribution for teams zoom slack webex"
```

---

### Task 4: Guarantee Lifecycle End Correctness Across Provider Switches and Rejoins

**Files:**
- Modify: `src/detector.ts`
- Modify: `test/detector.lifecycle.test.mjs`
- Create: `test/lifecycle.provider-matrix.test.mjs`

- [ ] **Step 1: Write the failing provider-matrix lifecycle tests**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runProviderMatrixScenario } from './helpers/scenario-runner.mjs';

for (const provider of ['Google Meet', 'Zoom', 'Microsoft Teams', 'Slack', 'Cisco Webex']) {
  test(`${provider} emits start then end`, async () => {
    const result = await runProviderMatrixScenario(provider);
    assert.equal(result.started.length, 1);
    assert.equal(result.ended.length, 1);
    assert.equal(result.ended[0].started_at, result.started[0].started_at);
    assert.ok(result.ended[0].ended_at);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build:ts && node --test test/lifecycle.provider-matrix.test.mjs`
Expected: FAIL on missing boundary fields and/or provider matrix gaps.

- [ ] **Step 3: Implement minimal lifecycle fixes**

```typescript
// src/detector.ts (updateMeetingLifecycle)
if (!this.activeMeeting) {
  this.activeMeeting = { platform, lastSeen: now, confidence, signal };
  this.sessionTimeline.start(platform, signal);
  this.emitMeetingLifecycle('meeting_started', platform, confidence, 'signal', signal);
  this.scheduleMeetingEndCheck();
  return;
}

if (this.activeMeeting.platform !== platform) {
  const previous = this.activeMeeting;
  this.emitMeetingLifecycle('meeting_ended', previous.platform, previous.confidence, 'switch', previous.signal);
  this.sessionTimeline.start(platform, signal);
  this.activeMeeting = { platform, lastSeen: now, confidence, signal };
  this.emitMeetingLifecycle('meeting_started', platform, confidence, 'signal', signal);
  this.scheduleMeetingEndCheck();
  return;
}
```

- [ ] **Step 4: Run lifecycle test bundle**

Run: `npm run build:ts && node --test test/detector.lifecycle.test.mjs test/lifecycle.provider-matrix.test.mjs`
Expected: PASS with stable start/end boundaries and clean rejoin behavior.

- [ ] **Step 5: Commit**

```bash
git add src/detector.ts test/detector.lifecycle.test.mjs test/lifecycle.provider-matrix.test.mjs
git commit -m "fix: enforce explicit lifecycle end boundaries across provider matrix"
```

---

### Task 5: Add Automated Web Meeting E2E Suite (Playwright)

**Files:**
- Create: `test/e2e/web/providers.spec.ts`
- Create: `test/e2e/web/detector-harness.ts`
- Create: `scripts/e2e/run-web-e2e.mjs`
- Create: `.env.e2e.example`
- Modify: `package.json`
- Test: `test/e2e/web/providers.spec.ts`

- [ ] **Step 1: Write failing E2E smoke test for one provider**

```typescript
import { test, expect } from '@playwright/test';
import { startDetectorHarness } from './detector-harness';

test('Google Meet web emits meeting_started and meeting_ended', async ({ page }) => {
  const harness = await startDetectorHarness('google-meet-web');
  await page.goto(process.env.E2E_GOOGLE_MEET_URL!);
  await page.getByRole('button', { name: /join now/i }).click();

  const started = await harness.waitFor('meeting_started', 60000);
  expect(started.platform).toBe('Google Meet');

  await page.getByRole('button', { name: /leave call/i }).click();
  const ended = await harness.waitFor('meeting_ended', 60000);
  expect(ended.platform).toBe('Google Meet');

  await harness.stop();
});
```

- [ ] **Step 2: Run E2E test to verify it fails**

Run: `npx playwright test test/e2e/web/providers.spec.ts --grep "Google Meet web"`
Expected: FAIL because harness/env/scripts are not wired yet.

- [ ] **Step 3: Implement web E2E harness and env contract**

```javascript
// scripts/e2e/run-web-e2e.mjs
import { spawn } from 'node:child_process';

const child = spawn('npx', ['playwright', 'test', 'test/e2e/web/providers.spec.ts'], {
  stdio: 'inherit',
  env: { ...process.env, E2E_ARTIFACT_DIR: `artifacts/web/${new Date().toISOString().slice(0, 10)}` },
});

child.on('exit', (code) => process.exit(code ?? 1));
```

```dotenv
# .env.e2e.example
E2E_GOOGLE_MEET_URL=
E2E_ZOOM_WEB_URL=
E2E_TEAMS_WEB_URL=
E2E_SLACK_HUDDLE_WEB_URL=
E2E_WEBEX_WEB_URL=
E2E_TEAMS_NATIVE_URL=
E2E_ZOOM_NATIVE_URL=
E2E_SLACK_HUDDLE_NATIVE_URL=
E2E_WEBEX_NATIVE_URL=
NATIVE_MCP_SERVER_CMD=
NATIVE_MCP_SERVER_ARGS=
OTP_CODE_FILE=scripts/.otp-codes/latest.txt
GOOGLE_EMAIL=
GOOGLE_APP_PASSWORD=
GOOGLE_VOICE_NUMBER=
```

If local `.env` still uses `GMAIL_EMAIL` / `GMAIL_APP_PASSWORD`, map them in the runner before OTP steps:
`GOOGLE_EMAIL="${GOOGLE_EMAIL:-$GMAIL_EMAIL}"` and `GOOGLE_APP_PASSWORD="${GOOGLE_APP_PASSWORD:-$GMAIL_APP_PASSWORD}"`.

- [ ] **Step 4: Run full web provider matrix**

Run: `npm run e2e:web`
Expected: PASS for Meet, Zoom, Teams, Slack Huddle, Webex web scenarios; artifacts written to `artifacts/web/<date>/`.

- [ ] **Step 5: Commit**

```bash
git add test/e2e/web scripts/e2e/run-web-e2e.mjs .env.e2e.example package.json
git commit -m "test: add automated playwright web meeting provider matrix"
```

---

### Task 6: Add Automated Native Meeting E2E Suite (native-devtools MCP)

**Files:**
- Create: `test/e2e/native/providers.mcp.spec.md`
- Create: `test/e2e/native/scenarios/teams-native.json`
- Create: `test/e2e/native/scenarios/zoom-native.json`
- Create: `test/e2e/native/scenarios/slack-huddle-native.json`
- Create: `test/e2e/native/scenarios/webex-native.json`
- Create: `scripts/e2e/run-native-mcp-e2e.mjs`
- Create: `scripts/e2e/native/mcp-client.mjs`
- Create: `scripts/e2e/native/mcp-driver.mjs`
- Create: `scripts/e2e/native/scenario-runner.mjs`
- Create: `scripts/e2e/lib/artifact-writer.mjs`
- Create: `scripts/tools/otp-client.mjs`
- Modify: `package.json`
- Test: `scripts/e2e/run-native-mcp-e2e.mjs`

- [ ] **Step 1: Write failing native scenario schema + parser tests**

```json
// test/e2e/native/scenarios/teams-native.json
{
  "provider": "teams-native",
  "steps": [
    { "action": "launch_app", "args": { "app_name": "Microsoft Teams" } },
    { "action": "focus_window", "args": { "app_name": "Microsoft Teams" } },
    { "action": "type_text", "args": { "text": "${E2E_TEAMS_NATIVE_URL}" }, "target": "join_link_input" },
    { "action": "press_key", "args": { "key": "return" } },
    { "action": "maybe_fill_otp", "args": { "source": "scripts/tools/otp-client.mjs", "timeout_ms": 120000 } },
    { "action": "click_text", "args": { "text": "Join now" } },
    { "action": "assert_event", "args": { "event": "meeting_started", "platform": "Microsoft Teams", "timeout_ms": 60000 } },
    { "action": "click_text", "args": { "text": "Leave" } },
    { "action": "assert_event", "args": { "event": "meeting_ended", "platform": "Microsoft Teams", "timeout_ms": 60000 } }
  ]
}
```

- [ ] **Step 2: Run native runner to verify it fails**

Run: `node scripts/e2e/run-native-mcp-e2e.mjs --provider teams-native`
Expected: FAIL because scenario parser/driver is not yet implemented.

- [ ] **Step 3: Implement MCP orchestration runner**

```javascript
// scripts/e2e/native/mcp-client.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export async function createNativeMcpClient() {
  const command = process.env.NATIVE_MCP_SERVER_CMD;
  const args = (process.env.NATIVE_MCP_SERVER_ARGS || '').split(' ').filter(Boolean);
  if (!command) throw new Error('Missing NATIVE_MCP_SERVER_CMD');

  const transport = new StdioClientTransport({ command, args });
  const client = new Client({ name: 'meeting-native-e2e', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}
```

```json
// package.json (devDependencies excerpt)
{
  "devDependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "@playwright/test": "^1.53.0"
  }
}
```

```javascript
// scripts/e2e/native/mcp-driver.mjs
import { createNativeMcpClient } from './mcp-client.mjs';

export class NativeMcpDriver {
  constructor(client) { this.client = client; }
  async launchApp(appName) { return this.client.callTool({ name: 'launch_app', arguments: { app_name: appName } }); }
  async focusApp(appName) { return this.client.callTool({ name: 'focus_window', arguments: { app_name: appName } }); }
  async clickText(text, appName) { return this.client.callTool({ name: 'find_text', arguments: { app_name: appName, text } }); }
  async typeText(text) { return this.client.callTool({ name: 'type_text', arguments: { text } }); }
  async pressKey(key, modifiers = []) { return this.client.callTool({ name: 'press_key', arguments: { key, modifiers } }); }
  async takeScreenshot(mode = 'window', appName) { return this.client.callTool({ name: 'take_screenshot', arguments: { mode, app_name: appName } }); }
}

// scripts/e2e/native/scenario-runner.mjs
export async function runScenario({ scenario, detectorHarness, driver, artifactWriter }) {
  for (const step of scenario.steps) {
    // dispatch step.action -> driver call
    // for assert_event, read detector harness queue and enforce timeout
    // write per-step artifact snapshots for debugging
  }
}
```

```javascript
// scripts/e2e/run-native-mcp-e2e.mjs
import { createNativeMcpClient } from './native/mcp-client.mjs';
import { NativeMcpDriver } from './native/mcp-driver.mjs';
import { runScenario } from './native/scenario-runner.mjs';

process.env.GOOGLE_EMAIL = process.env.GOOGLE_EMAIL || process.env.GMAIL_EMAIL;
process.env.GOOGLE_APP_PASSWORD = process.env.GOOGLE_APP_PASSWORD || process.env.GMAIL_APP_PASSWORD;

const client = await createNativeMcpClient();
const driver = new NativeMcpDriver(client);
// load scenario json, start detector harness, execute runScenario(), assert artifacts, close client
```

```javascript
// scripts/tools/otp-client.mjs
import { readFile } from 'node:fs/promises';

export async function waitForOtpCode({
  path = 'scripts/.otp-codes/latest.txt',
  timeoutMs = 120000,
  pollMs = 2000,
  minMtimeMs = Date.now(),
}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const stat = await import('node:fs/promises').then((fs) => fs.stat(path));
      if (stat.mtimeMs < minMtimeMs) {
        await new Promise((r) => setTimeout(r, pollMs));
        continue;
      }
      const txt = await readFile(path, 'utf8');
      const code = txt.split('\n')[0].trim();
      if (/^\d{6}$/.test(code)) return code;
    } catch {}
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error('OTP timeout: no fresh 6-digit code found');
}
```

- [ ] **Step 3a: Implement native spec contract document**

`test/e2e/native/providers.mcp.spec.md` must define:
- supported action names and argument schema
- provider scenario file locations
- detector event assertions (`meeting_started`/`meeting_ended`)
- artifact requirements (`events.ndjson`, per-step screenshots, run summary JSON)

- [ ] **Step 4: Run native provider matrix**

Run: `npm run e2e:native`
Expected: PASS for `teams-native`, `zoom-native`, `slack-huddle-native`, `webex-native` with `meeting_started` + `meeting_ended` events; artifacts in `artifacts/native/<date>/`.

- [ ] **Step 5: Commit**

```bash
git add test/e2e/native scripts/e2e scripts/tools/otp-client.mjs package.json
git commit -m "test: add automated native meeting e2e via native-devtools mcp"
```

---

### Task 7: Wire CI and Operator Docs for Repeatable Robustness Checks

**Files:**
- Modify: `README.md`
- Create: `docs/testing/meeting-e2e.md`
- Modify: `.github/workflows/*` (create if missing: `.github/workflows/meeting-e2e.yml`)
- Modify: `package.json`

- [ ] **Step 1: Write failing doc-driven verification checklist test (script exits non-zero when env missing)**

```bash
# scripts/e2e/validate-env.sh
mode="${1:-all}" # web | native | all
web_required=(E2E_GOOGLE_MEET_URL E2E_ZOOM_WEB_URL E2E_TEAMS_WEB_URL E2E_SLACK_HUDDLE_WEB_URL E2E_WEBEX_WEB_URL)
native_required=(E2E_TEAMS_NATIVE_URL E2E_ZOOM_NATIVE_URL E2E_SLACK_HUDDLE_NATIVE_URL E2E_WEBEX_NATIVE_URL NATIVE_MCP_SERVER_CMD OTP_CODE_FILE GOOGLE_EMAIL GOOGLE_APP_PASSWORD GOOGLE_VOICE_NUMBER)

required=()
if [ "$mode" = "web" ] || [ "$mode" = "all" ]; then required+=("${web_required[@]}"); fi
if [ "$mode" = "native" ] || [ "$mode" = "all" ]; then required+=("${native_required[@]}"); fi

for key in "${required[@]}"; do
  [ -n "${!key}" ] || { echo "missing $key"; exit 1; }
done
```

- [ ] **Step 2: Run validation to verify it fails with incomplete env**

Run: `bash scripts/e2e/validate-env.sh all`
Expected: FAIL with `missing ...` until both web and native E2E inputs are populated.

- [ ] **Step 3: Add docs and CI workflow**

```yaml
# .github/workflows/meeting-e2e.yml
name: meeting-e2e
on:
  workflow_dispatch:
  schedule:
    - cron: '0 9 * * 1-5'
jobs:
  web-e2e:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: bash scripts/e2e/validate-env.sh web
      - run: npm run e2e:web
  native-e2e:
    if: github.event_name == 'workflow_dispatch'
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: bash scripts/e2e/validate-env.sh native
      - run: npm run e2e:native
```

- [ ] **Step 4: Run final verification bundle**

Run: `npm test && npm run e2e:web && npm run e2e:native`
Expected: All suites PASS; artifacts available for each provider scenario.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/testing/meeting-e2e.md .github/workflows/meeting-e2e.yml package.json scripts/e2e/validate-env.sh
git commit -m "chore: document and automate full meeting robustness verification"
```

---

## Verification Checklist (Required Before Merge)
- [ ] `npm run build:ts`
- [ ] `npm test`
- [ ] `npm run e2e:web`
- [ ] `npm run e2e:native`
- [ ] Confirm artifacts for all providers include both `meeting_started` and `meeting_ended` with matching `session_id`.
- [ ] Confirm no regression in existing browser route matcher tests.

## Review Section Template (to be filled during execution)
- Build status:
- Unit/integration test status:
- Web E2E status by provider:
- Native E2E status by provider:
- Remaining known gaps:

## Skills To Use During Execution
- `@superpowers:subagent-driven-development` (recommended task-by-task execution)
- `@superpowers:test-driven-development`
- `@superpowers:verification-before-completion`
- `@superpowers:systematic-debugging` (if any scenario fails)
