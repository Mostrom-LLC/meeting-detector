# Provider Detection Native/Web Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the detector reliably emits correct `meeting_started`/`meeting_ended` events for web and native meeting sessions across Zoom, Google Meet, Slack (Huddle), Microsoft Teams, and Webex.

**Architecture:** Keep a single shared provider contract used by both browser and native attribution paths, then harden detector arbitration (browser hints vs native probe) around that contract. Add an operator-first live validation runner that verifies real detector output per provider without relying on Playwright test flow semantics. Persist per-run evidence as NDJSON + matrix summaries.

**Tech Stack:** TypeScript, Node.js, existing `MeetingDetector`, AppleScript/native probes on macOS, npm scripts, NDJSON artifacts.

---

## File Structure

**Core detection contract (single source of truth):**
- Modify: `src/classifiers/browser-platform.ts`
  - Responsibility: web route/title matching for target providers.
- Modify: `src/classifiers/native-platform.ts`
  - Responsibility: native process/title attribution for target providers.
- Modify: `src/detector.ts`
  - Responsibility: signal arbitration, browser-hint/native-probe reconciliation, lifecycle emission.

**Verification and evidence:**
- Create: `scripts/e2e/run-provider-detection-matrix.mjs`
  - Responsibility: run provider detection checks in `web`, `native`, or `all` mode and write matrix evidence.
- Create: `scripts/e2e/provider-detection-contract.mjs`
  - Responsibility: centralized provider definitions (env var, expected platform, mode, artifact key).
- Modify: `scripts/e2e/validate-env.sh`
  - Responsibility: validate new env contract needed by detection matrix runner.

**Tests (contract + detector behavior, not UI automation):**
- Modify: `test/browser-platform-classifier.test.mjs`
- Modify: `test/native-platform-classifier.test.mjs`
- Modify: `test/lifecycle.provider-matrix.test.mjs`
- Create: `test/detector.provider-arbitration.test.mjs`

**Docs and operator workflow:**
- Modify: `docs/testing/meeting-e2e.md`
- Modify: `README.md`
- Modify: `Tasks/todo.md`

---

### Task 1: Define Explicit 5-Provider Detection Contract

**Files:**
- Create: `scripts/e2e/provider-detection-contract.mjs`
- Modify: `src/classifiers/browser-platform.ts`
- Modify: `src/classifiers/native-platform.ts`
- Test: `test/browser-platform-classifier.test.mjs`
- Test: `test/native-platform-classifier.test.mjs`

- [ ] **Step 1: Write failing contract tests for the exact 5 providers**

Add/extend tests to assert both positive and negative examples for:
- Google Meet (`meet.google.com/<code>`)
- Zoom (`zoom.us/j/<id>`, `/wc/.../join`)
- Microsoft Teams (`teams.microsoft.com/l/meetup-join/...`, `teams.live.com/v2?meetingjoin=true`)
- Slack Huddle (`app.slack.com/.../huddle`, huddle preview titles)
- Webex (`*.webex.com/meet/...`, `*.webex.com/join/...`)

Run:
```bash
node --test test/browser-platform-classifier.test.mjs test/native-platform-classifier.test.mjs
```
Expected: FAIL on any missing/ambiguous mapping.

- [ ] **Step 2: Implement/normalize the provider contract file**

Create `scripts/e2e/provider-detection-contract.mjs` exporting exact provider keys and expected platform labels:
```js
export const PROVIDERS = [
  { id: 'google-meet', platform: 'Google Meet', mode: ['web'] },
  { id: 'zoom', platform: 'Zoom', mode: ['web', 'native'] },
  { id: 'teams', platform: 'Microsoft Teams', mode: ['web', 'native'] },
  { id: 'slack-huddle', platform: 'Slack', mode: ['web', 'native'] },
  { id: 'webex', platform: 'Cisco Webex', mode: ['web', 'native'] },
];
```

- [ ] **Step 3: Apply minimal classifier updates to satisfy contract tests**

- Keep route/title guards strict enough to avoid known false positives.
- Ensure native Slack requires huddle evidence, not generic Slack window presence.
- Ensure Teams/Zoom/Webex prejoin/landing pages do not classify as active meetings.

- [ ] **Step 4: Re-run classifier tests**

Run:
```bash
node --test test/browser-platform-classifier.test.mjs test/native-platform-classifier.test.mjs
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/e2e/provider-detection-contract.mjs src/classifiers/browser-platform.ts src/classifiers/native-platform.ts test/browser-platform-classifier.test.mjs test/native-platform-classifier.test.mjs
git commit -m "feat: codify 5-provider web/native detection contract"
```

### Task 2: Harden Detector Arbitration for Web vs Native Provider Attribution

**Files:**
- Modify: `src/detector.ts`
- Test: `test/lifecycle.provider-matrix.test.mjs`
- Create: `test/detector.provider-arbitration.test.mjs`

- [ ] **Step 1: Write failing arbitration tests**

Add tests that reproduce real-world ambiguity:
- Browser hint for provider A + idle native process for provider B => no false native switch.
- Active native meeting + stale browser hint for same provider => keep single provider session.
- Cross-platform switch (real signals) => emit `meeting_changed` then `meeting_ended`/new start semantics as designed.

Run:
```bash
node --test test/lifecycle.provider-matrix.test.mjs test/detector.provider-arbitration.test.mjs
```
Expected: FAIL on current arbitration gaps.

- [ ] **Step 2: Implement minimal arbitration fixes in `src/detector.ts`**

Focus areas:
- Browser hint freshness window.
- Native candidate suppression only when same-platform browser evidence is fresh and strong.
- Prevent provider ping-pong from stale context maps.

- [ ] **Step 3: Re-run detector behavior tests**

Run:
```bash
node --test test/lifecycle.provider-matrix.test.mjs test/detector.provider-arbitration.test.mjs test/detector.lifecycle.test.mjs
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/detector.ts test/lifecycle.provider-matrix.test.mjs test/detector.provider-arbitration.test.mjs
git commit -m "fix: stabilize provider arbitration across browser and native signals"
```

### Task 3: Build Operator-Focused Live Detection Matrix Runner (Non-Playwright-Centric)

**Files:**
- Create: `scripts/e2e/run-provider-detection-matrix.mjs`
- Modify: `scripts/e2e/validate-env.sh`
- Modify: `package.json`

- [ ] **Step 1: Write failing runner smoke test**

Add a script-level smoke check (or minimal node test) expecting:
- `--mode web|native|all`
- `--provider <id>` filter
- output matrix JSON with per-provider `started_count`, `ended_count`, `pass`

Run:
```bash
node scripts/e2e/run-provider-detection-matrix.mjs --help
```
Expected (before implementation): missing script / unsupported options.

- [ ] **Step 2: Implement the matrix runner**

`run-provider-detection-matrix.mjs` must:
- Load provider contract from `provider-detection-contract.mjs`.
- Start detector harness per provider run.
- Support two execution styles:
  - `--auto` for existing automated flows (when available)
  - `--manual` for operator-confirmed join/leave windows (countdown prompts, then assert events)
- Write artifacts:
  - `artifacts/provider-detection/<timestamp>/<provider>/events.ndjson`
  - `artifacts/provider-detection/<timestamp>/matrix-summary.json`

- [ ] **Step 3: Wire env validation and npm scripts**

Update `scripts/e2e/validate-env.sh` with required vars for detection runner (`E2E_*_URL`, native prerequisites, optional CDP endpoint).

Add scripts in `package.json`:
```json
{
  "scripts": {
    "detect:matrix": "node scripts/e2e/run-provider-detection-matrix.mjs",
    "detect:matrix:web": "node scripts/e2e/run-provider-detection-matrix.mjs --mode web",
    "detect:matrix:native": "node scripts/e2e/run-provider-detection-matrix.mjs --mode native"
  }
}
```

- [ ] **Step 4: Verify runner entrypoints**

Run:
```bash
node scripts/e2e/run-provider-detection-matrix.mjs --help
npm run detect:matrix:web -- --dry-run
npm run detect:matrix:native -- --dry-run
```
Expected: commands complete and produce summary scaffolds.

- [ ] **Step 5: Commit**

```bash
git add scripts/e2e/run-provider-detection-matrix.mjs scripts/e2e/validate-env.sh package.json package-lock.json
git commit -m "feat: add live provider detection matrix runner"
```

### Task 4: End-to-End Detection Verification for Web and Native Providers

**Files:**
- Runtime artifacts only under `artifacts/provider-detection/`
- Modify: `Tasks/todo.md`

- [ ] **Step 1: Validate env readiness**

Run:
```bash
bash scripts/e2e/validate-env.sh all
```
Expected: all required vars/dependencies reported present (or explicit missing blockers).

- [ ] **Step 2: Run web detection matrix (goal-focused)**

Run:
```bash
npm run detect:matrix:web -- --manual
```
Expected per enabled provider: at least one `meeting_started` and one `meeting_ended` with matching platform.

- [ ] **Step 3: Run native detection matrix (goal-focused)**

Run:
```bash
npm run detect:matrix:native -- --manual
```
Expected per enabled provider: same lifecycle expectations as web.

- [ ] **Step 4: Validate lifecycle invariants from matrix summary**

For each provider pass:
- `started_count >= 1`
- `ended_count >= 1`
- `started_platforms`/`ended_platforms` contain expected provider only
- `ended_at > started_at` for each completed session pair

- [ ] **Step 5: Record results in tracking doc**

Update `Tasks/todo.md` with:
- pass/fail for each of 10 surfaces (5 providers x web/native, except where provider supports only one mode)
- blocker list with artifact paths
- final detection readiness verdict

- [ ] **Step 6: Commit**

```bash
git add Tasks/todo.md artifacts/provider-detection
git commit -m "chore: publish provider detection matrix evidence"
```

### Task 5: Documentation Refresh Around Detection Goal

**Files:**
- Modify: `docs/testing/meeting-e2e.md`
- Modify: `README.md`

- [ ] **Step 1: Document goal-first workflow**

Clarify that the primary objective is provider detection correctness, not UI test framework success:
- use `detect:matrix:*` commands
- explain manual vs auto modes
- explain artifact interpretation

- [ ] **Step 2: Add provider readiness table template**

Include a markdown table for:
- provider
- web/native status
- last verified date
- evidence path
- blocker notes

- [ ] **Step 3: Verify docs reference valid commands**

Run:
```bash
npm run detect:matrix -- --help
```
Expected: command exists and docs are executable as written.

- [ ] **Step 4: Commit**

```bash
git add docs/testing/meeting-e2e.md README.md
git commit -m "docs: align runbook to provider detection objective"
```

---

## Verification Checklist (Before Completion)

- [ ] `npm run build:ts`
- [ ] `npm test`
- [ ] `node --test test/browser-platform-classifier.test.mjs test/native-platform-classifier.test.mjs test/lifecycle.provider-matrix.test.mjs test/detector.provider-arbitration.test.mjs`
- [ ] `npm run detect:matrix:web -- --dry-run`
- [ ] `npm run detect:matrix:native -- --dry-run`
- [ ] At least one real web provider and one real native provider validated with artifact evidence in `artifacts/provider-detection/...`

## Definition of Done

- Detector can attribute meeting lifecycle correctly for the target five providers on both web and native paths (where supported).
- Provider attribution is driven by shared contract and verified by deterministic tests plus live matrix evidence.
- Operator can run one command to produce a matrix summary and artifacts for detection readiness.
- Documentation reflects the goal-first (detection) workflow and no longer over-weights Playwright test mechanics.
