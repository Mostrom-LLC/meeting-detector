#!/bin/bash
# Quick helper to get the latest OTP code

# Get project root directory (parent of tools/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OTP_FILE="$PROJECT_ROOT/.otp-codes/latest.txt"

if [ ! -f "$OTP_FILE" ]; then
    echo "❌ No OTP code found"
    echo "   Make sure the listener is running: ./tools/start-otp-listener.sh"
    exit 1
fi

# Read first line (the actual code)
CODE=$(head -n 1 "$OTP_FILE")

if [ -z "$CODE" ]; then
    echo "❌ OTP file is empty"
    exit 1
fi

echo "✅ Latest OTP: $CODE"
echo "$CODE"
