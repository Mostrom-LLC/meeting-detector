#!/bin/bash
#
# Overnight Ralph Loop runner for MOS-607
# Breaks the work into 3 phases, each with its own loop + completion promise.
# Each phase logs to logs/mos-607/ with timestamps.
#
# Usage:
#   chmod +x scripts/overnight-mos-607.sh
#   ./scripts/overnight-mos-607.sh
#
# Review in the morning:
#   tail -100 logs/mos-607/phase-*.log
#   cat Tasks/backlog/MOS-607-progress.md

set -u  # undefined vars are errors, but DO NOT set -e — we want phases to continue on partial failure

REPO_ROOT="/Volumes/Samsung/repositories/mostrom/harke/harke-meeting-detector"
LOG_DIR="$REPO_ROOT/logs/mos-607"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

cd "$REPO_ROOT" || exit 1
mkdir -p "$LOG_DIR"

SUMMARY_LOG="$LOG_DIR/summary-$TIMESTAMP.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$SUMMARY_LOG"
}

run_phase() {
  local phase_name="$1"
  local promise="$2"
  local max_iter="$3"
  local prompt="$4"
  local phase_log="$LOG_DIR/phase-${phase_name}-$TIMESTAMP.log"

  log "=========================================="
  log "STARTING $phase_name (max $max_iter iterations)"
  log "Promise: $promise"
  log "Log: $phase_log"
  log "=========================================="

  local start_time=$(date +%s)

  claude -p "/ralph-loop:ralph-loop '$prompt' --completion-promise '$promise' --max-iterations $max_iter" \
    --dangerously-skip-permissions \
    > "$phase_log" 2>&1
  local exit_code=$?

  local end_time=$(date +%s)
  local duration=$((end_time - start_time))

  if grep -q "$promise" "$phase_log"; then
    log "✅ $phase_name COMPLETED in ${duration}s (promise found)"
    return 0
  else
    log "⚠️  $phase_name DID NOT EMIT PROMISE in ${duration}s (exit=$exit_code)"
    log "    Last 20 lines of $phase_log:"
    tail -20 "$phase_log" | sed 's/^/      /' | tee -a "$SUMMARY_LOG"
    return 1
  fi
}

log "########################################################"
log "# MOS-607 OVERNIGHT RUN — $TIMESTAMP"
log "# Repo: $REPO_ROOT"
log "# Branch: $(git rev-parse --abbrev-ref HEAD)"
log "# HEAD:   $(git rev-parse --short HEAD)"
log "########################################################"

# Sanity: ensure clean-ish working tree before we start
if [ -n "$(git status --porcelain | grep -v 'Tasks/backlog/MOS-607')" ]; then
  log "⚠️  Working tree has uncommitted changes outside MOS-607 task files."
  log "    Continuing anyway, but review git status in the morning."
  git status --short | tee -a "$SUMMARY_LOG"
fi

# ============================================================
# PHASE A — Audit + implement Rust macOS signal generation
# Steps 1-2 of MOS-607
# ============================================================
run_phase "A-rust-signals" "PHASE-A-COMPLETE" 25 \
"Execute Steps 1 and 2 of Tasks/backlog/MOS-607.md ONLY.

Step 1: Audit the gap between meeting-detect.sh and native/src/platform/macos.rs. Read both files end-to-end. Read native/src/detector.rs and native/src/lib.rs to understand the napi-rs interface. Read src/detector.ts to find every shell script reference and every native module call. Write the gap analysis to Tasks/backlog/MOS-607-progress.md under a Gap Analysis heading.

Step 2: Implement the missing macOS signal generation in Rust. Add TCC/OSLog streaming for mic/camera access, process enumeration, and window title extraction to native/src/platform/macos.rs. The output format must match what src/detector.ts expects from the native module. Browser tab enumeration may stay in JS — document that decision.

Verification gates:
- Tasks/backlog/MOS-607-progress.md exists and contains a Gap Analysis section
- cd native && cargo build succeeds (last line contains Finished, not error)
- npm run build:ts still succeeds

When BOTH steps are verified, output <promise>PHASE-A-COMPLETE</promise>.

Do NOT proceed to Steps 3+. Do NOT modify src/detector.ts beyond reading it. Do NOT delete meeting-detect.sh yet."

PHASE_A_RESULT=$?

# ============================================================
# PHASE B — Wire native into detector.ts + delete shell script
# Steps 3-5 of MOS-607
# ============================================================
if [ $PHASE_A_RESULT -ne 0 ]; then
  log "Phase A did not complete. Phase B may fail without Rust signal generation in place."
  log "Continuing anyway — Ralph in Phase B can self-correct."
fi

run_phase "B-wire-and-delete" "PHASE-B-COMPLETE" 25 \
"Execute Steps 3, 4, and 5 of Tasks/backlog/MOS-607.md ONLY. Phase A should have already implemented Rust signal generation — verify that first by running cd native && cargo build. If it fails, stop and document the blocker in MOS-607-progress.md.

Step 3: In src/detector.ts, change the line 'this.useNative = process.platform !== \"darwin\" && this.nativeDetector.isSupported();' to 'this.useNative = this.nativeDetector.isSupported();'. Remove any other macOS gating that disables native.

Step 4: Remove all shell script spawn/management code from src/detector.ts. Delete every reference to meeting-detect.sh, child_process spawn for the script, stdout/stderr handlers for it, and fallback paths. Keep classifier and lifecycle code untouched.

Step 5: Delete meeting-detect.sh from the repo. Search the entire codebase for any remaining references and remove them. Check package.json scripts.

Verification gates:
- grep -n 'process.platform.*darwin' src/detector.ts shows no gating matches
- grep -rn 'meeting-detect.sh' src/ scripts/ package.json shows zero matches
- ls meeting-detect.sh fails (file gone)
- npm run build:ts succeeds
- npm run typecheck succeeds

When all three steps are verified, output <promise>PHASE-B-COMPLETE</promise>.

Do NOT run npm test in this phase — that's Phase C. Do NOT commit yet — also Phase C."

PHASE_B_RESULT=$?

# ============================================================
# PHASE C — Test, commit, and MOS-112 decision
# Steps 6-8 of MOS-607
# ============================================================
if [ $PHASE_B_RESULT -ne 0 ]; then
  log "Phase B did not complete. Phase C tests will likely fail. Continuing for diagnostic value."
fi

run_phase "C-test-commit" "PHASE-C-COMPLETE" 30 \
"Execute Steps 6, 7, and 8 of Tasks/backlog/MOS-607.md ONLY.

Step 6: Run the full test suite. npm test must pass — 121 tests should still pass. npm run build:ts must succeed. npm run typecheck must succeed. If any test fails, read the failure carefully: if it tests shell-script behavior that no longer exists, update the test to test the equivalent native module behavior. If it's a regression in classifier or lifecycle code, fix the regression. Iterate until all tests pass.

Step 7: Commit all changes to the dev branch. Use message: 'feat: remove meeting-detect.sh — Rust native module is sole detection backend'. Working tree must be clean after commit (excluding MOS-607 task and progress files).

Step 8: Address MOS-112 engine split decision. Verify src/engines/ and src/arbitration/ directories do not exist. Document in MOS-607-progress.md whether the current classifier split (browser-platform.ts / native-platform.ts) is sufficient or whether MOS-112 needs a follow-up ticket. No code changes if classifiers are sufficient.

Verification gates:
- npm test exits 0 with all tests passing
- npm run build:ts succeeds
- git log --oneline -1 shows the new commit
- git status is clean (or only MOS-607 progress file modified)
- MOS-607-progress.md has a section documenting the MOS-112 decision

When all three steps are verified AND the original MOS-607 completion criteria are met, output <promise>PHASE-C-COMPLETE</promise> followed by <promise>MOS-607 COMPLETE</promise>."

PHASE_C_RESULT=$?

# ============================================================
# FINAL REPORT
# ============================================================
log "########################################################"
log "# MOS-607 OVERNIGHT RUN COMPLETE"
log "########################################################"
log "Phase A (Rust signals):    $([ $PHASE_A_RESULT -eq 0 ] && echo '✅ DONE' || echo '❌ INCOMPLETE')"
log "Phase B (Wire + delete):   $([ $PHASE_B_RESULT -eq 0 ] && echo '✅ DONE' || echo '❌ INCOMPLETE')"
log "Phase C (Test + commit):   $([ $PHASE_C_RESULT -eq 0 ] && echo '✅ DONE' || echo '❌ INCOMPLETE')"
log ""
log "Final git status:"
git status --short | tee -a "$SUMMARY_LOG"
log ""
log "Last commit:"
git log --oneline -1 | tee -a "$SUMMARY_LOG"
log ""
log "Logs:           $LOG_DIR/"
log "Progress file:  Tasks/backlog/MOS-607-progress.md"
log "Summary log:    $SUMMARY_LOG"

if [ $PHASE_A_RESULT -eq 0 ] && [ $PHASE_B_RESULT -eq 0 ] && [ $PHASE_C_RESULT -eq 0 ]; then
  log ""
  log "🎉 MOS-607 COMPLETE — all phases verified."
  exit 0
else
  log ""
  log "⚠️  MOS-607 INCOMPLETE — review phase logs and progress file in the morning."
  exit 1
fi
