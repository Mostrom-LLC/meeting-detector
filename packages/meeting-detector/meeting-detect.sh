# detect-meeting.sh
# Purpose: Heuristically detect when *any* desktop meeting app starts a meeting by
# watching for microphone/camera access grants in macOS Unified Logs (TCC)
# and correlating with the frontmost app at that moment. Prints compact JSON lines.
#
# Notes:
# - This is app-agnostic: Zoom, Slack Huddles, Meet (via Chrome), Teams, Webex, etc.
# - Triggers on first-time (or resumed) mic/camera usage events emitted by TCC.
# - Requires no special entitlements; may miss events if the app had continuous access
#   without re-requesting. That’s why we also add a lightweight camera process probe.
#
# Usage: bash detect-meeting.sh
# Stop  : Ctrl+C

set -euo pipefail

# --- util: print JSON safely ---
json() {
  # args: key=value ...
  # converts to {"key":"value", ...} with basic escaping
  local kv out="{" first=1
  for kv in "$@"; do
    key="${kv%%=*}"; val="${kv#*=}"
    # escape quotes and backslashes
    val="${val//\\/\\\\}"; val="${val//\"/\\\"}"
    if [[ $first -eq 0 ]]; then out+=", "; fi
    out+="\"$key\":\"$val\""; first=0
  done
  out+="}"
  printf '%s\n' "$out"
}

# --- util: get frontmost app name (best-effort) ---
front_app() {
  /usr/bin/osascript -e 'tell application "System Events" to get name of first process whose frontmost is true' 2>/dev/null || echo ""
}

# --- util: get active window title ---
window_title() {
  /usr/bin/osascript -e 'tell application "System Events" to get title of front window of first process whose frontmost is true' 2>/dev/null || echo ""
}

# --- util: get parent PID ---
parent_pid() {
  local pid="$1"
  if [[ -n "$pid" ]]; then
    ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ' || echo ""
  else
    echo ""
  fi
}

# --- util: get process path ---
process_path() {
  local pid="$1"
  if [[ -n "$pid" ]]; then
    ps -o command= -p "$pid" 2>/dev/null | awk '{print $1}' || echo ""
  else
    echo ""
  fi
}

# --- util: get session ID ---
session_id() {
  who -m 2>/dev/null | awk '{print $2}' | head -1 || echo ""
}

# --- util: quick camera-in-use heuristic (VDCAssistant/AppleCameraAssistant presence) ---
camera_active() {
  if pgrep -xq "VDCAssistant" || pgrep -xq "AppleCameraAssistant"; then
    echo "true"
  else
    echo "false"
  fi
}

# --- util: normalize app names to main app (reduces Teams/Chrome helper noise) ---
normalize_app() {
  local process_name="$1"
  
  # Microsoft Teams - all helpers normalize to "Microsoft Teams"
  if [[ "$process_name" == *"Microsoft Teams"* ]]; then
    echo "Microsoft Teams"
  # Google Chrome - all helpers normalize to "Google Chrome"  
  elif [[ "$process_name" == *"Google Chrome"* ]] || [[ "$process_name" == *"Chrome Helper"* ]]; then
    echo "Google Chrome"
  # Slack - all helpers normalize to "Slack"
  elif [[ "$process_name" == *"Slack"* ]]; then
    echo "Slack"
  # Default - return as-is
  else
    echo "$process_name"
  fi
}

# --- state tracking variables to prevent duplicate logs ---
prev_camera_active=""
prev_front_app=""
prev_service=""
prev_verdict=""
prev_process=""
prev_pid=""
prev_main_app=""
last_log_time=0

# --- multi-line TCC parsing state ---
current_svc=""
current_pid=""
current_app=""
current_verdict=""

# --- stream TCC (privacy) log events for mic/camera access ---
# We look for kTCCServiceMicrophone / kTCCServiceCamera "Access Allowed"/"Auth Granted".
/usr/bin/log stream \
  --style syslog \
  --predicate 'subsystem == "com.apple.TCC" AND (eventMessage CONTAINS[c] "kTCCServiceMicrophone" OR eventMessage CONTAINS[c] "kTCCServiceCamera")' \
  2>/dev/null | \
while IFS= read -r line; do
  # --- accumulate multi-line TCC log info ---
  
  # Parse service type and save to current state
  if [[ "$line" == *"kTCCServiceMicrophone"* ]]; then
    current_svc="microphone"
  elif [[ "$line" == *"kTCCServiceCamera"* ]]; then
    current_svc="camera"
  fi

  # Parse verdict and save to current state
  if [[ "$line" == *"Access Allowed"* ]] || [[ "$line" == *"Auth Granted"* ]] || [[ "$line" == *"Allow"* ]]; then
    current_verdict="allowed"
  elif [[ "$line" == *"Denied"* ]]; then
    current_verdict="denied"
  elif [[ "$line" == *"FORWARD"* ]]; then
    current_verdict="requested"
  fi

  # Parse target PID - when we find this, we have enough info to emit
  if [[ "$line" =~ target_token=\{pid:([0-9]+) ]]; then
    current_pid="${BASH_REMATCH[1]}"
    # Get process info from PID
    if [[ -n "$current_pid" ]]; then
      current_app_full=$(ps -p "$current_pid" -o comm= 2>/dev/null | tail -1)
      # Extract just the app name from full path (e.g., "Google Chrome Helper" from long path)
      current_app=$(basename "$current_app_full" 2>/dev/null || echo "$current_app_full")
      
      # Get additional process details
      current_parent_pid=$(parent_pid "$current_pid")
      current_process_path=$(process_path "$current_pid")
    fi
    
    # --- we now have complete info, check if we should emit ---
    if [[ -n "$current_svc" ]] && [[ -n "$current_pid" ]]; then
      ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      fg_app="$(front_app)"
      cam_now="$(camera_active)"
      win_title="$(window_title)"
      sess_id="$(session_id)"
      
      # Normalize app name to reduce Teams/Chrome helper noise
      normalized_app=$(normalize_app "$current_app")
      
      # Get current timestamp for time-based deduplication
      current_time=$(date +%s)
      
      # Create state string focusing on actual meeting process, not front app switching
      # Only track: camera status + service + normalized app (ignore front_app changes)
      current_state="${cam_now}|${current_svc}|${normalized_app}"
      previous_state="${prev_camera_active}|${prev_service}|${prev_main_app}"
      
      # Calculate time since last log
      time_diff=$((current_time - last_log_time))
      
      # Log if there's a meaningful change OR enough time has passed (10 seconds cooldown)
      # This allows new meetings while preventing Teams helper process spam
      if [[ "$current_state" != "$previous_state" ]] || [[ $time_diff -ge 10 ]]; then
        # State changed - emit JSON
        json \
          event="meeting_signal" \
          timestamp="$ts" \
          service="$current_svc" \
          verdict="$current_verdict" \
          process="$current_app" \
          pid="$current_pid" \
          parent_pid="$current_parent_pid" \
          process_path="$current_process_path" \
          front_app="$fg_app" \
          window_title="$win_title" \
          session_id="$sess_id" \
          camera_active="$cam_now"
        
        # Update previous state
        prev_camera_active="$cam_now"
        prev_front_app="$fg_app"  # Still track for JSON output
        prev_service="$current_svc"
        prev_verdict="$current_verdict"
        prev_process="$current_app"
        prev_pid="$current_pid"
        prev_main_app="$normalized_app"
        last_log_time="$current_time"
      fi
      
      # Reset current state for next TCC entry
      current_svc=""
      current_pid=""
      current_app=""
      current_verdict=""
      current_parent_pid=""
      current_process_path=""
    fi
  fi
done
