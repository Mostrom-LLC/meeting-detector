#!/usr/bin/env python3
"""
Final test with proper .env parsing
"""

import imaplib
import os
from pathlib import Path
import re

# Load environment from .env.test with proper parsing
def load_env_file():
    env_file = Path(__file__).parent.parent / '.env.test'
    if env_file.exists():
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                # Skip empty lines and comments
                if not line or line.startswith('#'):
                    continue
                # Split on first =
                if '=' in line:
                    key, value = line.split('=', 1)
                    key = key.strip()
                    # Remove quotes and inline comments
                    value = value.split('#')[0].strip()  # Remove inline comments first
                    value = value.strip('"').strip("'")  # Then remove quotes
                    os.environ[key] = value

load_env_file()

EMAIL = os.environ.get('GOOGLE_EMAIL', '').strip()
APP_PASSWORD = os.environ.get('GOOGLE_APP_PASSWORD', '').strip().replace(' ', '')
REGULAR_PASSWORD = os.environ.get('GOOGLE_EMAIL_PASSWORD', '').strip()

print("=" * 60)
print("GMAIL CONNECTION TEST")
print("=" * 60)
print()
print(f"Email: {EMAIL}")
print(f"App password length: {len(APP_PASSWORD)} chars (should be 16)")
print(f"App password: {APP_PASSWORD}")
print(f"Regular password length: {len(REGULAR_PASSWORD)} chars")
print()

# Test app password first
print("Testing App Password...")
try:
    mail = imaplib.IMAP4_SSL('imap.gmail.com')
    mail.login(EMAIL, APP_PASSWORD)
    mail.select('inbox')

    _, msgs = mail.search(None, 'ALL')
    count = len(msgs[0].split()) if msgs[0] else 0

    _, gv = mail.search(None, '(FROM "voice-noreply@google.com")')
    gv_count = len(gv[0].split()) if gv[0] else 0

    mail.close()
    mail.logout()

    print("✅ SUCCESS!")
    print(f"📬 Total emails: {count}")
    print(f"📱 Google Voice emails: {gv_count}")
    print()
    print("=" * 60)
    print("The OTP listener is ready!")
    print("Run: ./tools/start-otp-listener.sh")
    print("=" * 60)
    exit(0)

except Exception as e:
    print(f"❌ App Password Failed: {e}")
    print()

# Try regular password
print("Testing Regular Password...")
try:
    mail = imaplib.IMAP4_SSL('imap.gmail.com')
    mail.login(EMAIL, REGULAR_PASSWORD)
    mail.select('inbox')

    _, msgs = mail.search(None, 'ALL')
    count = len(msgs[0].split()) if msgs[0] else 0

    _, gv = mail.search(None, '(FROM "voice-noreply@google.com")')
    gv_count = len(gv[0].split()) if gv[0] else 0

    mail.close()
    mail.logout()

    print("✅ SUCCESS with regular password!")
    print(f"📬 Total emails: {count}")
    print(f"📱 Google Voice emails: {gv_count}")
    print()
    print("⚠️  Update the OTP listener to use GOOGLE_EMAIL_PASSWORD")
    exit(0)

except Exception as e:
    print(f"❌ Regular Password Failed: {e}")
    print()

print("=" * 60)
print("Both passwords failed. Please:")
print()
print("1. Check agent@mostrom.io Gmail settings:")
print("   → IMAP must be enabled")
print("   → 2FA should be enabled")
print()
print("2. Generate a fresh App Password:")
print("   → myaccount.google.com/apppasswords")
print("   → Create for 'Mail'")
print("   → Copy WITHOUT spaces")
print()
print("3. Or try a different Gmail account")
print("=" * 60)
exit(1)
