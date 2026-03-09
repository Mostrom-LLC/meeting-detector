# Publishing @mostrom/meeting-detector - Implementation Checklist

## Phase 1: Package Metadata ✅
- [x] Update package.json name to @mostrom/meeting-detector
- [x] Add publishConfig with access: restricted
- [x] Add repository field with GitHub URL
- [x] Add homepage field
- [x] Add bugs field
- [x] Fill in author field

## Phase 2: Documentation ✅
- [x] Update README.md installation examples (line 18)
- [x] Update README.md dependency example (line 34)
- [x] Update README.md npm link example (line 42)
- [x] Update README.md import statements (lines 52, 53, 68, 69)

## Phase 3: GitHub Actions ✅
- [x] Create .github/workflows/publish.yml
- [ ] Add NPM_TOKEN secret to GitHub repository (manual step for user)

## Phase 4: Configuration ✅
- [x] Update .npmrc to remove always-auth deprecation warning

## Phase 5: Verification ✅
- [x] Test build: npm run build
- [x] Run dry-run: npm publish --dry-run
- [x] Create and inspect tarball: npm pack
- [x] Verify authentication: npm whoami (authenticated as kwhite102)
- [x] Verify .gitignore excludes .env

## Phase 6: Publishing ✅
- [x] Commit all changes
- [x] Updated publish script with auto-increment feature
- [x] Published using npm run publish:npm (auto-incremented to 1.0.2)
- [x] Verify package appears on npm (3 versions: 1.0.0, 1.0.1, 1.0.2)
- [x] Test installation: npm install @mostrom/meeting-detector

## Phase 7: Validation ✅
- [x] Test package import in separate test project (successful)
- [x] Verify TypeScript types work correctly (all types compile successfully)
- [x] Test automated publish workflow with auto-increment (verified with 1.0.0 → 1.0.2)

---

## ✅ Implementation Complete

**Published Package:** `@mostrom/meeting-detector@1.0.2`
**npm URL:** https://www.npmjs.com/package/@mostrom/meeting-detector
**Published Versions:** 1.0.0, 1.0.1, 1.0.2

### Verification Results

1. **Auto-increment Publishing:** ✅ Confirmed working
   - Script detects existing versions on npm
   - Automatically bumps to next patch version
   - Command: `npm run publish:npm`

2. **Package Registry:** ✅ Live on npm
   - Package name: @mostrom/meeting-detector
   - Access: restricted (private)
   - Maintainer: kwhite102

3. **Installation:** ✅ Verified
   - Installs successfully: `npm install @mostrom/meeting-detector`
   - No vulnerabilities

4. **TypeScript Types:** ✅ Working
   - All exports available: MeetingDetector, detector, MeetingSignal
   - Type definitions compile without errors
   - IntelliSense working correctly

### Future Publishing

Simply run:
```bash
npm run publish:npm
```

The script will:
1. Load NPM_TOKEN from .env
2. Authenticate with npm
3. Build the package
4. Auto-increment version if needed
5. Publish to npm as private package

---

# Meeting Detector Robustness Audit - 2026-03-07

## Plan
- [x] Create test harness and capture baseline detector output with debug logs
- [x] Validate detector signal generation with a known non-meeting mic/camera event
- [x] Test Google Meet meeting start path in browser via CMUX and capture timing/log payload
- [x] Test Microsoft Teams meeting start path (web/app) via CMUX and capture timing/log payload
- [x] Test Zoom meeting start path (web/app) via CMUX and capture timing/log payload
- [x] Test Webex meeting start path (web/app) via CMUX and capture timing/log payload
- [x] Compare platform behavior and identify false positives, false negatives, and deduplication issues
- [x] Implement the minimal high-impact robustness improvements in detector logic
- [x] Re-run targeted verification tests to confirm improvements
- [x] Document review results and prioritized follow-up improvements

## Review
- [x] Completed

### Results Summary
- CMUX browser panels are embedded web views; Google Meet/Teams web flows in CMUX did not produce mic/camera TCC events in this environment.
- Native app launches produced detectable meeting-like signals:
  - Microsoft Teams: detected at app launch with `requested` + `preflight=true`
  - Zoom (extracted app bundle): detected at app launch with `requested` + `preflight=true`
  - Webex: detected after parser update using `AUTHREQ_CTX msgID=<pid>` parsing
- Non-meeting camera app (`Photo Booth`) generated TCC grant lines (`Granting ...`) that were previously missed; after parser update they are now parsed and correctly filtered.

### Implemented Improvements
- `meeting-detect.sh`
  - Added parsing for multiple TCC formats:
    - `target_token={pid:...}`
    - `Granting ... pid=... access to kTCCService...`
    - `AUTHREQ_CTX: msgID=<pid>.<n> ... preflight=(yes|no)`
  - Added `preflight` to emitted JSON payload
  - Fixed `process_path` to preserve full command path (including spaces)
  - Fixed `session_id` extraction to avoid incorrect values like month names
- `detector.ts`
  - Added `preflight` parsing
  - Reduced helper-process noise with service-centric deduplication key
  - Added filtering for known non-meeting/helper processes (`caphost`, `webview helper`) and non-meeting services (`photo booth`, `quicktime`)
- `types.ts`
  - Updated `service` to `string`
  - Added optional `preflight` field

### Verification Outcome (session 1)
- After patch:
  - Teams: 1 signal on launch (reduced duplicate helper events)
  - Zoom: 1 signal on launch (helper events filtered)
  - Webex: 1 signal on launch (newly captured)
  - Photo Booth: parsed but filtered (no emitted meeting event)
  - Google Meet via CMUX browser: still no signal due environment/browser-surface limitation

---

## Deep-Test Findings — 2026-03-07 (session 2)

### Methodology
- Live Chrome browser tests (not CMUX WKWebView — WKWebView does not produce WebRTC TCC events)
- Audit runner (`meeting-audit-runner.mjs`) + parallel raw TCC stream captured for each scenario
- Google Meet, Photo Booth, Teams, Slack tested; Webex/Zoom tested at app-launch level

### Platform Results

| Platform | TCC events seen | Detected (pre-fix) | Detected (post-fix) | Notes |
|---|---|---|---|---|
| Microsoft Teams (native) | FORWARD `target_token={pid}` | ✅ Yes (on app launch) | ✅ Yes | Fires on launch, not just when in a call |
| Google Meet (Chrome) | FORWARD `target_token={pid}` via Chrome Helper | ❌ No (2 bugs) | ✅ Yes | See bugs below |
| Webex (native) | No TCC events on launch | ❌ No | ❌ No | Only detectable during active call |
| Photo Booth | `Granting TCCDProcess pid=` | ❌ No (pattern unrecognized) | ✅ Parsed, correctly filtered | Non-meeting app |
| Slack (via Slack app) | `AUTHREQ_CTX msgID=<pid>` | Depends | ✅ Yes | Front-app heuristic labels it "Slack" |

### Root Cause Bugs Fixed (session 2)

**Bug 1 — CRITICAL — Google Meet blocked by `chrome helper` process filter**
- `systemProcessPatterns` included `'chrome helper'` (partial match)
- `'google chrome helper'.includes('chrome helper')` = TRUE → ALL Chrome Helper signals filtered
- Fix: removed `'chrome helper'` from `systemProcessPatterns`

**Bug 2 — CRITICAL — Google Meet window title filter blocks backgrounded calls**
- `shouldIgnoreSignal` required Google Meet signals to have a window title containing meeting code
- When Chrome is not the frontmost app, `window_title()` returns `""` → signal blocked
- Fix: changed to only apply the window title check when `window_title` is non-empty

**Bug 3 — MODERATE — Script crash on gone-PID with `set -euo pipefail`**
- `ps -p $pid -o comm= 2>/dev/null | tail -1` — with `pipefail`, failed ps exits the script
- Reproduced when Photo Booth quit before the TCC parsing loop got to it
- Fix: changed to `ps -p "$current_pid" -o comm= 2>/dev/null || true`

**Bug 4 — MINOR — AUTHREQ_CTX parser captured forwarded message IDs as PIDs**
- `AUTHREQ_CTX: msgID=187.6088` → parser captured `187` (tccd system message ID, not a PID)
- Fix: only accept PIDs > 500 from AUTHREQ_CTX msgID pattern

**Bug 5 — MINOR — process_path included full command-line arguments**
- `ps -o command= | sed ...` included hundreds of characters of flags for Teams WebView
- Fix: switched to `ps -o comm=` which gives just the process name

### Remaining Known Issues (lower priority)

1. **Teams fires on app launch, not just during meetings** — Teams requests mic/camera when it starts (probably for call readiness). This is a false positive if the goal is "in a meeting" detection. Mitigation: use `window_title` presence as confirmation, or require `camera_active=true` AND `window_title` contains known meeting patterns.

2. **Chrome front_app heuristic mis-labels signals** — When Google Meet is running in a background Chrome tab and Slack is frontmost, the signal gets `service=Slack` instead of `service=Google Meet`. The `transformAppName` method uses `front_app` for Chrome-based service identification, which is unreliable. A more robust approach would query Chrome's active tab URL via AppleScript at detection time.

3. **No Zoom or Webex actual-call testing** — Both apps were only tested at launch level. An actual Zoom/Webex call would need a test account and joining a live meeting to validate TCC event patterns. Expected to work via same FORWARD mechanism as Teams.

4. **`set -euo pipefail` still active** — `set -e` remains; any new unguarded pipeline using a gone PID could still crash the script. All known call sites now use `|| true`, but future changes should be careful.

### process_path Field Note
After fix, `process_path` now contains the clean process name (e.g., `Google Chrome Helper`, `MSTeams`) instead of a truncated path or verbose command line. The full binary path is available at `/proc/$pid/exe` equivalent — use `lsof -p $pid` if full path is needed in a future enhancement.

---

# Meeting Detector Robustness Hardening - 2026-03-07 (session 3)

## Plan
- [x] Reconcile implementation targets with `Tasks/meeting-detector-audit-source-of-truth-2026-03-07.md` open issues
- [x] Implement confidence gate for launch-time preflight false positives (`requested + preflight=true + empty title`)
- [x] Stabilize `front_app` / `window_title` attribution during helper bursts with per-service context
- [x] Run deterministic detector behavior tests with synthetic signal streams
- [x] Run package build/typecheck and targeted runtime smoke verification
- [x] Document results and residual risks in review notes

## Review
- [x] Completed

### Results
- `npm --prefix ./packages/meeting-detector run build` passes after detector hardening changes.
- Synthetic stream tests verified confidence gate behavior:
  - single low-confidence launch preflight signal does not emit,
  - low-confidence followed by strong evidence emits,
  - sustained low-confidence activity promotes after threshold.
- Synthetic stale-context test verified native app attribution stabilization:
  - when a follow-up signal had stale `front_app=Slack` for `process=MSTeams`, emitted event remained `service=Microsoft Teams` with stabilized `front_app=Microsoft Teams`.
- Service classification was updated to process-first matching to reduce stale foreground-app mislabeling for native meeting apps.

### Baseline vs Current Proof (HEAD vs working tree)
- Baseline reference: `HEAD` commit `b59d4a63f40c851f0e0dbcaadf0d7f4e7af4728b` in isolated worktree.
- Scenario `launch-preflight-single`:
  - baseline emitted 1 event (`verdict=requested`, empty title)
  - current emitted 0 events (signal held as low-confidence)
- Scenario `preflight-then-allowed`:
  - baseline emitted first low-confidence event (`verdict=requested`)
  - current emitted strong-evidence event (`verdict=allowed`, `preflight=false`, titled meeting window)
- Scenario `stale-front-app-native` (`front_app=Slack`, `process=MSTeams`):
  - baseline labeled service as `Slack`
  - current labeled service as `Microsoft Teams`
- Debug log evidence for the same preflight sample:
  - baseline log: `Parsed signal` followed by meeting emission
  - current log: `Holding low-confidence signal` with no meeting emission

### Residual Risk
- Browser-based Chrome helper classification still depends on foreground context in some cases, so background Google Meet attribution can remain imperfect without URL-level browser introspection.

---

# Meeting Detector Criteria Completion - 2026-03-07 (session 4)

## Plan
- [x] Map `Tasks/success-criteria.md` requirements to concrete macOS-scoped implementation targets
- [x] Add lifecycle hooks and state machine (`meeting_started`, `meeting_changed`, `meeting_ended`) with end-timeout inference
- [x] Add uncertainty-safe classification behavior (`Unknown` or no detection) instead of fallback guessing
- [x] Add privacy-first output behavior to avoid exposing sensitive meeting metadata by default
- [x] Add automated detector tests covering join/start/end/switch/uncertain/rejoin scenarios
- [x] Update README/types to reflect final API and macOS scope
- [x] Run build + tests + behavior verification and document completion status

## Review
- [x] Completed

### What Was Implemented
- Added lifecycle API and state machine in detector:
  - `meeting_started`, `meeting_changed`, `meeting_ended`
  - end inference via `meetingEndTimeoutMs`
  - startup active-meeting probe (`startupProbe`)
- Added uncertainty-safe platform normalization:
  - unknown/ambiguous signals become `Unknown` (or are suppressed by default)
  - removed fallback guessing to arbitrary app names
  - normalized naming includes `Cisco Webex`
- Added privacy-first output behavior:
  - sensitive fields (`window_title`, `chrome_url`) are redacted in emitted raw signals by default
  - optional opt-in for sensitive/raw payload exposure
- Added API/options in types:
  - `MeetingLifecycleEvent`, `MeetingPlatform`
  - options: `meetingEndTimeoutMs`, `emitUnknown`, `includeSensitiveMetadata`, `includeRawSignalInLifecycle`, `startupProbe`
- Updated docs:
  - lifecycle hooks and new options documented in package README

### Verification
- Build + tests pass:
  - command: `npm run test`
  - result: 8/8 passing tests in `packages/meeting-detector/test/detector.lifecycle.test.mjs`
- Covered by automated tests:
  - launch preflight non-emit
  - start + timeout end
  - platform switch (`meeting_changed`)
  - unknown suppression + optional unknown emission
  - privacy redaction defaults
  - repeated join/leave cycle handling
  - background/stale-front-app native attribution stability

### macOS Success-Criteria Status
- Marked complete for the macOS-focused scope requested by user (cross-OS explicitly deferred).
