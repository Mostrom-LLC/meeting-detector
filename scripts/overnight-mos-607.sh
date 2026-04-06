#!/bin/bash
#
# Overnight Ralph Loop runner for MOS-607
# Implements the Ralph Wiggum technique directly in bash:
#   while not_done; do claude -p "$PROMPT"; done
#
# Three phases, each with its own loop + completion promise + log file.
#
# Usage:
#   chmod +x scripts/overnight-mos-607.sh
#   ./scripts/overnight-mos-607.sh
#
# Review in the morning:
#   tail -100 logs/mos-607/summary-*.log
#   cat Tasks/backlog/MOS-607-progress.md

set -u  # undefined vars are errors. NO set -e — we want phases to continue on partial failure.

REPO_ROOT="/Volumes/Samsung/repositories/mostrom/harke/harke-meeting-detector"
LOG_DIR="$REPO_ROOT/logs/mos-607"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

cd "$REPO_ROOT" || exit 1
mkdir -p "$LOG_DIR"

SUMMARY_LOG="$LOG_DIR/summary-$TIMESTAMP.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$SUMMARY_LOG"
}

# run_phase: implements the Ralph Wiggum loop in bash
#   $1 = phase short name
#   $2 = completion promise string
#   $3 = max iterations
#   $4 = prompt
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
  local iteration=0

  while [ $iteration -lt $max_iter ]; do
    iteration=$((iteration + 1))

    log "  → $phase_name iteration $iteration / $max_iter"
    {
      echo ""
      echo "############################################################"
      echo "# ITERATION $iteration / $max_iter — $(date '+%Y-%m-%d %H:%M:%S')"
      echo "############################################################"
    } >> "$phase_log"

    # Run claude -p headlessly. The prompt is plain text (no slash command).
    # We rely on bash to re-feed the same prompt next iteration.
    claude -p "$prompt" \
      --dangerously-skip-permissions \
      --permission-mode bypassPermissions \
      >> "$phase_log" 2>&1
    local exit_code=$?

    if [ $exit_code -ne 0 ]; then
      log "    claude -p exited non-zero ($exit_code) on iteration $iteration"
    fi

    # Check if the promise tag appeared in this iteration's output (whole log scan is fine — promise should only appear when done)
    if grep -q "$promise" "$phase_log"; then
      local end_time=$(date +%s)
      local duration=$((end_time - start_time))
      log "✅ $phase_name COMPLETED on iteration $iteration in ${duration}s"
      return 0
    fi
  done

  local end_time=$(date +%s)
  local duration=$((end_time - start_time))
  log "⚠️  $phase_name HIT MAX ITERATIONS ($max_iter) in ${duration}s without promise"
  log "    Last 15 lines of $phase_log:"
  tail -15 "$phase_log" | sed 's/^/      /' | tee -a "$SUMMARY_LOG"
  return 1
}

log "########################################################"
log "# MOS-607 OVERNIGHT RUN — $TIMESTAMP"
log "# Repo: $REPO_ROOT"
log "# Branch: $(git rev-parse --abbrev-ref HEAD)"
log "# HEAD:   $(git rev-parse --short HEAD)"
log "########################################################"

if [ -n "$(git status --porcelain | grep -v 'Tasks/backlog/MOS-607\|scripts/overnight-mos-607')" ]; then
  log "⚠️  Working tree has uncommitted changes outside MOS-607 task files."
  log "    Continuing anyway, but review git status in the morning."
  git status --short | tee -a "$SUMMARY_LOG"
fi

# Smoke test: verify claude -p actually works at all before burning hours
log "Smoke testing claude -p..."
SMOKE_OUTPUT=$(claude -p "Reply with exactly the word OK and nothing else." --dangerously-skip-permissions 2>&1)
if echo "$SMOKE_OUTPUT" | grep -q "OK"; then
  log "✅ claude -p smoke test passed"
else
  log "❌ claude -p smoke test FAILED. Output:"
  echo "$SMOKE_OUTPUT" | sed 's/^/      /' | tee -a "$SUMMARY_LOG"
  log "Aborting — fix claude -p before running overnight."
  exit 1
fi

# Ralph-style prompt wrapper: every prompt gets a self-orienting preamble so each
# iteration knows to check existing progress before starting fresh work.
RALPH_PREAMBLE='You are running inside an automated bash loop that will re-invoke you with this exact same prompt repeatedly until you output the completion promise tag. Your previous work persists in files and git history.

ON EVERY ITERATION:
1. First, read Tasks/backlog/MOS-607-progress.md (if it exists) to see what previous iterations completed.
2. Run git log --oneline -5 and git status to see recent work.
3. Identify the next incomplete sub-step within the steps assigned to THIS phase.
4. Do that ONE sub-step. Update MOS-607-progress.md with what you did and the verification output.
5. If a verification command fails, fix the underlying issue before exiting — do not declare a step done with failing verification.
6. If ALL steps for this phase are complete and verified, output the completion promise tag exactly as specified.

Do not ask clarifying questions. Do not request human input. Make the best decision you can with available information and proceed.

YOUR TASK FOR THIS PHASE:
'

# ============================================================
# PHASE A — Audit + implement Rust macOS signal generation (Steps 1-2)
# ============================================================
PHASE_A_TASK='Execute Steps 1 and 2 of Tasks/backlog/MOS-607.md ONLY.

Step 1: Audit the gap between meeting-detect.sh and native/src/platform/macos.rs. Read both files end-to-end. Read native/src/detector.rs and native/src/lib.rs to understand the napi-rs interface. Read src/detector.ts to find every shell script reference and every native module call. Write the gap analysis to Tasks/backlog/MOS-607-progress.md under a Gap Analysis heading.

Step 2: Implement the missing macOS signal generation in Rust. Add TCC/OSLog streaming for mic/camera access, process enumeration, and window title extraction to native/src/platform/macos.rs. The output format must match what src/detector.ts expects from the native module. Browser tab enumeration may stay in JS — document that decision.

Verification gates (run these before declaring done):
- Tasks/backlog/MOS-607-progress.md exists and contains a Gap Analysis section
- cd native && cargo build succeeds (last line contains Finished, not error)
- npm run build:ts still succeeds

When BOTH steps are verified, output exactly this on a line by itself: <promise>PHASE-A-COMPLETE</promise>

Do NOT proceed to Steps 3+. Do NOT modify src/detector.ts beyond reading it. Do NOT delete meeting-detect.sh yet.'

run_phase "A-rust-signals" "PHASE-A-COMPLETE" 25 "${RALPH_PREAMBLE}${PHASE_A_TASK}"
PHASE_A_RESULT=$?

# ============================================================
# PHASE B — Wire native into detector.ts + delete shell script (Steps 3-5)
# ============================================================
if [ $PHASE_A_RESULT -ne 0 ]; then
  log "Phase A did not complete. Phase B may fail without Rust signal generation. Continuing — Ralph in B can self-correct."
fi

PHASE_B_TASK='Execute Steps 3, 4, and 5 of Tasks/backlog/MOS-607.md ONLY. Phase A should have already implemented Rust signal generation — verify by running cd native && cargo build first. If it fails, document the blocker in MOS-607-progress.md and stop.

Step 3: In src/detector.ts, change the line "this.useNative = process.platform !== \"darwin\" && this.nativeDetector.isSupported();" to "this.useNative = this.nativeDetector.isSupported();". Remove any other macOS gating that disables native.

Step 4: Remove all shell script spawn/management code from src/detector.ts. Delete every reference to meeting-detect.sh, child_process spawn for the script, stdout/stderr handlers for it, and fallback paths. Keep classifier and lifecycle code untouched.

Step 5: Delete meeting-detect.sh from the repo. Search the entire codebase for any remaining references and remove them. Check package.json scripts.

Verification gates:
- grep -n "process.platform.*darwin" src/detector.ts shows no gating matches
- grep -rn "meeting-detect.sh" src/ scripts/ package.json shows zero matches
- ls meeting-detect.sh fails (file gone)
- npm run build:ts succeeds
- npm run typecheck succeeds

When all three steps are verified, output exactly this on a line by itself: <promise>PHASE-B-COMPLETE</promise>

Do NOT run npm test in this phase — that is Phase C. Do NOT commit yet — also Phase C.'

run_phase "B-wire-and-delete" "PHASE-B-COMPLETE" 25 "${RALPH_PREAMBLE}${PHASE_B_TASK}"
PHASE_B_RESULT=$?

# ============================================================
# PHASE C — Test, commit, and MOS-112 decision (Steps 6-8)
# ============================================================
if [ $PHASE_B_RESULT -ne 0 ]; then
  log "Phase B did not complete. Phase C tests will likely fail. Continuing for diagnostic value."
fi

PHASE_C_TASK='Execute Steps 6, 7, and 8 of Tasks/backlog/MOS-607.md ONLY.

Step 6: Run the full test suite. npm test must pass (121 tests should still pass). npm run build:ts must succeed. npm run typecheck must succeed. If any test fails: read the failure carefully. If it tests shell-script behavior that no longer exists, update the test to test the equivalent native module behavior. If it is a regression in classifier or lifecycle code, fix the regression. Iterate until all tests pass.

Step 7: Commit all changes to the dev branch. Use message: "feat: remove meeting-detect.sh — Rust native module is sole detection backend". Working tree must be clean after commit (excluding MOS-607 task and progress files).

Step 8: Address MOS-112 engine split decision. Verify src/engines/ and src/arbitration/ directories do not exist. Document in MOS-607-progress.md whether the current classifier split (browser-platform.ts / native-platform.ts) is sufficient or whether MOS-112 needs a follow-up ticket. No code changes if classifiers are sufficient.

Verification gates:
- npm test exits 0 with all tests passing
- npm run build:ts succeeds
- git log --oneline -1 shows the new commit
- git status is clean (or only MOS-607 progress file modified)
- MOS-607-progress.md has a section documenting the MOS-112 decision

When all three steps are verified AND the original MOS-607 completion criteria are met, output exactly this on a line by itself: <promise>PHASE-C-COMPLETE</promise>'

run_phase "C-test-commit" "PHASE-C-COMPLETE" 30 "${RALPH_PREAMBLE}${PHASE_C_TASK}"
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
