#!/bin/bash
# Start OTP Listener - Quick setup script

echo "🔍 Starting OTP Listener..."
echo ""

# Make script executable if not already
chmod +x "$(dirname "$0")/otp-listener.py"

# The Python listener loads credentials from .env.test (GOOGLE_* or OTP_*),
# with environment variables taking precedence.
python3 "$(dirname "$0")/otp-listener.py"
