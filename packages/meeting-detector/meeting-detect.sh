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
    local ppid
    ppid=$(ps -o ppid= -p "$pid" 2>/dev/null || true)
    printf '%s' "${ppid// /}"
  else
    echo ""
  fi
}

# --- util: get process executable path (preserves spaces when possible) ---
process_path() {
  local pid="$1"
  if [[ -n "$pid" ]]; then
    # lsof txt entry gives the executable path and handles app bundles with spaces.
    local path
    path=$(lsof -p "$pid" 2>/dev/null | awk '$4=="txt" {
      for (i = 9; i <= NF; i++) {
        printf "%s%s", $i, (i < NF ? " " : "")
      }
      print ""
      exit
    }' || true)

    if [[ -n "$path" ]]; then
      echo "$path"
    else
      # Fallback when lsof cannot resolve path for the PID.
      ps -o comm= -p "$pid" 2>/dev/null || echo ""
    fi
  else
    echo ""
  fi
}

# --- util: get session ID ---
session_id() {
  # Return tty/console identifier when available; otherwise return empty string.
  who -m 2>/dev/null | awk '{
    for (i = 1; i <= NF; i++) {
      if ($i ~ /^(tty|console)/) {
        print $i
        exit
      }
    }
  }' | head -1 || echo ""
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
current_preflight=""
current_parent_pid=""
current_process_path=""

reset_current_state() {
  current_svc=""
  current_pid=""
  current_app=""
  current_verdict=""
  current_preflight=""
  current_parent_pid=""
  current_process_path=""
}

emit_signal_if_ready() {
  if [[ -z "$current_svc" ]] || [[ -z "$current_pid" ]]; then
    return
  fi

  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  fg_app="$(front_app)"
  cam_now="$(camera_active)"
  win_title="$(window_title)"
  sess_id="$(session_id)"

  # For Chrome Helper processes, query the active tab URL directly so the
  # TypeScript layer can identify the meeting service without relying on front_app.
  chrome_url=""
  if [[ "$current_app" == *"Chrome Helper"* ]] || [[ "$current_app" == *"Google Chrome"* ]]; then
    chrome_url=$(/usr/bin/osascript \
      -e 'tell application "Google Chrome" to get URL of active tab of front window' \
      2>/dev/null || echo "")
  fi

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
  # This allows new meetings while preventing helper process spam.
  if [[ "$current_state" != "$previous_state" ]] || [[ $time_diff -ge 10 ]]; then
    json \
      event="meeting_signal" \
      timestamp="$ts" \
      service="$current_svc" \
      verdict="$current_verdict" \
      preflight="${current_preflight:-}" \
      process="$current_app" \
      pid="$current_pid" \
      parent_pid="$current_parent_pid" \
      process_path="$current_process_path" \
      front_app="$fg_app" \
      window_title="$win_title" \
      session_id="$sess_id" \
      camera_active="$cam_now" \
      chrome_url="$chrome_url"

    # Update previous state
    prev_camera_active="$cam_now"
    prev_front_app="$fg_app"
    prev_service="$current_svc"
    prev_verdict="$current_verdict"
    prev_process="$current_app"
    prev_pid="$current_pid"
    prev_main_app="$normalized_app"
    last_log_time="$current_time"
  fi

  reset_current_state
}

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

  # Capture preflight signal when present.
  if [[ "$line" == *"preflight=yes"* ]]; then
    current_preflight="true"
  elif [[ "$line" == *"preflight=no"* ]]; then
    current_preflight="false"
  fi

  # Parse target PID on FORWARD lines.
  if [[ "$line" =~ target_token=\{pid:([0-9]+) ]]; then
    current_pid="${BASH_REMATCH[1]}"
  fi

  # Parse direct grant lines (seen for some system-signed processes).
  if [[ "$line" =~ Granting\ TCCDProcess:.*pid=([0-9]+).*access\ to\ kTCCService(Microphone|Camera) ]]; then
    current_pid="${BASH_REMATCH[1]}"
    if [[ "${BASH_REMATCH[2]}" == "Microphone" ]]; then
      current_svc="microphone"
    else
      current_svc="camera"
    fi
    current_verdict="allowed"
    current_preflight="false"
  fi

  # Parse direct access checks keyed by msgID=<pid>.<counter>.
  # Only accept PIDs > 500 to skip forwarded tccd message IDs (like 187.XXXX).
  if [[ "$line" =~ AUTHREQ_CTX:\ msgID=([0-9]+)\.[0-9]+,.*service=kTCCService(Microphone|Camera),\ preflight=(yes|no) ]]; then
    candidate_pid="${BASH_REMATCH[1]}"
    if [[ "$candidate_pid" -gt 500 ]]; then
      current_pid="$candidate_pid"
      if [[ "${BASH_REMATCH[2]}" == "Microphone" ]]; then
        current_svc="microphone"
      else
        current_svc="camera"
      fi
      if [[ "${BASH_REMATCH[3]}" == "yes" ]]; then
        current_preflight="true"
        current_verdict="${current_verdict:-requested}"
      else
        current_preflight="false"
        current_verdict="${current_verdict:-allowed}"
      fi
    fi
  fi

  # Emit when both service and pid are available.
  if [[ -n "$current_svc" ]] && [[ -n "$current_pid" ]]; then
    current_app_full=$(ps -p "$current_pid" -o comm= 2>/dev/null || true)
    current_app=$(basename "${current_app_full:-}" 2>/dev/null || echo "${current_app_full:-}")
    if [[ -z "$current_app" ]]; then
      reset_current_state
      continue
    fi
    current_parent_pid=$(parent_pid "$current_pid")
    current_process_path=$(process_path "$current_pid")
    emit_signal_if_ready
  fi
done
