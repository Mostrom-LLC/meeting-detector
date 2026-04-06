#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/e2e/validate-env.sh [web|native|all]

Checks the E2E environment contract for the requested mode.
EOF
}

mode="${1:-all}"

case "$mode" in
  -h|--help)
    usage
    exit 0
    ;;
  web|native|all)
    ;;
  *)
    echo "Usage: scripts/e2e/validate-env.sh [web|native|all]" >&2
    exit 2
    ;;
esac

missing=()

check_required() {
  local key="$1"
  if [[ -z "${!key:-}" ]]; then
    missing+=("$key")
  fi
}

check_any_required() {
  local label="$1"
  shift

  for key in "$@"; do
    if [[ -n "${!key:-}" ]]; then
      return 0
    fi
  done

  missing+=("$label")
}

web_required=(
  E2E_GOOGLE_MEET_URL
  E2E_ZOOM_WEB_URL
  E2E_TEAMS_WEB_URL
  E2E_SLACK_HUDDLE_WEB_URL
  E2E_WEBEX_WEB_URL
)

native_required=(
  E2E_TEAMS_NATIVE_URL
  E2E_ZOOM_NATIVE_URL
  E2E_WEBEX_NATIVE_URL
  NATIVE_MCP_SERVER_CMD
  GOOGLE_VOICE_NUMBER
)

if [[ "$mode" == "web" || "$mode" == "all" ]]; then
  for key in "${web_required[@]}"; do
    check_required "$key"
  done
fi

if [[ "$mode" == "native" || "$mode" == "all" ]]; then
  for key in "${native_required[@]}"; do
    check_required "$key"
  done

  check_any_required "E2E_SLACK_HUDDLE_NATIVE_URL or E2E_SLACK_NATIVE_URL" \
    E2E_SLACK_HUDDLE_NATIVE_URL E2E_SLACK_NATIVE_URL

  check_any_required "GOOGLE_EMAIL or GMAIL_EMAIL" GOOGLE_EMAIL GMAIL_EMAIL
  check_any_required "GOOGLE_APP_PASSWORD or GMAIL_APP_PASSWORD" GOOGLE_APP_PASSWORD GMAIL_APP_PASSWORD

  if [[ -n "${OTP_CODE_FILE:-}" && ! -f "${OTP_CODE_FILE}" ]]; then
    missing+=("OTP_CODE_FILE (file not found: ${OTP_CODE_FILE})")
  fi
fi

if (( ${#missing[@]} > 0 )); then
  echo "Missing E2E environment values for mode '$mode':" >&2
  for key in "${missing[@]}"; do
    echo "  - $key" >&2
  done
  exit 1
fi

echo "E2E environment contract satisfied for mode '$mode'."
