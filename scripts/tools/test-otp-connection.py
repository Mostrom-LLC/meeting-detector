#!/usr/bin/env python3
"""
Test OTP listener email connection

This script tests if we can connect to Gmail with the credentials from .env.test
"""

import imaplib
import os
from pathlib import Path

# Load environment from .env.test
def load_env_file():
    """Load environment variables from .env.test"""
    env_file = Path(__file__).parent.parent / '.env.test'
    if env_file.exists():
        print(f"📄 Loading credentials from: {env_file}")
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    # Remove quotes from value
                    value = value.strip().strip('"').strip("'")
                    os.environ[key] = value
    else:
        print(f"❌ .env.test not found at: {env_file}")
        return False
    return True

# Load .env.test
if not load_env_file():
    exit(1)

# Get credentials
EMAIL = os.environ.get('GOOGLE_EMAIL', os.environ.get('OTP_EMAIL', ''))
PASSWORD = os.environ.get('GOOGLE_APP_PASSWORD', os.environ.get('OTP_EMAIL_PASSWORD', ''))
# Remove spaces from app password (Gmail provides them with spaces but they need to be removed)
PASSWORD = PASSWORD.replace(' ', '') if PASSWORD else ''
IMAP_SERVER = os.environ.get('OTP_IMAP_SERVER', 'imap.gmail.com')

print()
print("🔍 Testing Gmail Connection...")
print(f"📧 Email: {EMAIL}")
print(f"🔑 Password: {'*' * len(PASSWORD) if PASSWORD else '(not set)'}")
print(f"🌐 Server: {IMAP_SERVER}")
print()

if not EMAIL or not PASSWORD:
    print("❌ Error: Credentials not found in .env.test")
    print("   Make sure GOOGLE_EMAIL and GOOGLE_APP_PASSWORD are set")
    exit(1)

try:
    print("🔌 Connecting to Gmail...")
    mail = imaplib.IMAP4_SSL(IMAP_SERVER)

    print("🔐 Logging in...")
    mail.login(EMAIL, PASSWORD)

    print("📥 Selecting inbox...")
    mail.select('inbox')

    print("🔍 Searching for Google Voice messages...")
    _, messages = mail.search(None, '(FROM "voice-noreply@google.com")')

    if messages[0]:
        count = len(messages[0].split())
        print(f"✅ Found {count} Google Voice messages in inbox")
    else:
        print("⚠️  No Google Voice messages found (this is OK if you haven't received any yet)")

    print()
    print("✅ CONNECTION SUCCESSFUL!")
    print()
    print("The OTP listener is ready to use. Run:")
    print("  ./tools/start-otp-listener.sh")

    mail.close()
    mail.logout()

except imaplib.IMAP4.error as e:
    print(f"❌ IMAP Error: {e}")
    print()
    print("Common issues:")
    print("1. Make sure you're using an App Password, not your regular Gmail password")
    print("   → Go to myaccount.google.com/security")
    print("   → Enable 2-factor authentication")
    print("   → Generate an App password for 'Mail'")
    print()
    print("2. Check that GOOGLE_EMAIL and GOOGLE_APP_PASSWORD are correct in .env.test")
    exit(1)

except Exception as e:
    print(f"❌ Error: {e}")
    exit(1)
