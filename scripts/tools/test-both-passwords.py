#!/usr/bin/env python3
"""
Test both app password and regular password to see which works
"""

import imaplib
import os
from pathlib import Path

# Load environment from .env.test
def load_env_file():
    env_file = Path(__file__).parent.parent / '.env.test'
    if env_file.exists():
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    value = value.strip().strip('"').strip("'")
                    os.environ[key] = value

load_env_file()

EMAIL = os.environ.get('GOOGLE_EMAIL', '').strip()
APP_PASSWORD = os.environ.get('GOOGLE_APP_PASSWORD', '').strip().replace(' ', '')
REGULAR_PASSWORD = os.environ.get('GOOGLE_EMAIL_PASSWORD', '').strip()

print("=" * 60)
print("TESTING BOTH PASSWORDS")
print("=" * 60)
print()
print(f"Email: {EMAIL}")
print(f"App password: {APP_PASSWORD[:4]}...{APP_PASSWORD[-4:]} ({len(APP_PASSWORD)} chars)")
print(f"Regular password: {REGULAR_PASSWORD[:2]}...{REGULAR_PASSWORD[-2:]} ({len(REGULAR_PASSWORD)} chars)")
print()

# Test 1: App Password
print("=" * 60)
print("TEST 1: Trying App Password")
print("=" * 60)
try:
    mail = imaplib.IMAP4_SSL('imap.gmail.com')
    mail.login(EMAIL, APP_PASSWORD)
    mail.select('inbox')
    print("✅ SUCCESS with App Password!")
    print()

    # Check for emails
    _, msgs = mail.search(None, 'ALL')
    count = len(msgs[0].split()) if msgs[0] else 0
    print(f"📬 Total emails: {count}")

    _, gv = mail.search(None, '(FROM "voice-noreply@google.com")')
    gv_count = len(gv[0].split()) if gv[0] else 0
    print(f"📱 Google Voice emails: {gv_count}")

    mail.close()
    mail.logout()

    print()
    print("=" * 60)
    print("✅ Use GOOGLE_APP_PASSWORD - It works!")
    print("=" * 60)
    exit(0)

except Exception as e:
    print(f"❌ Failed with App Password: {e}")
    print()

# Test 2: Regular Password
print("=" * 60)
print("TEST 2: Trying Regular Password")
print("=" * 60)
try:
    mail = imaplib.IMAP4_SSL('imap.gmail.com')
    mail.login(EMAIL, REGULAR_PASSWORD)
    mail.select('inbox')
    print("✅ SUCCESS with Regular Password!")
    print()

    # Check for emails
    _, msgs = mail.search(None, 'ALL')
    count = len(msgs[0].split()) if msgs[0] else 0
    print(f"📬 Total emails: {count}")

    _, gv = mail.search(None, '(FROM "voice-noreply@google.com")')
    gv_count = len(gv[0].split()) if gv[0] else 0
    print(f"📱 Google Voice emails: {gv_count}")

    mail.close()
    mail.logout()

    print()
    print("=" * 60)
    print("✅ Use GOOGLE_EMAIL_PASSWORD - It works!")
    print("=" * 60)
    print()
    print("NOTE: You should enable 2FA and use an App Password for better security")
    exit(0)

except Exception as e:
    print(f"❌ Failed with Regular Password: {e}")
    print()

print("=" * 60)
print("❌ BOTH PASSWORDS FAILED")
print("=" * 60)
print()
print("Possible issues:")
print()
print("1. The App Password might be incorrect:")
print("   → Go to https://myaccount.google.com/apppasswords")
print("   → Generate a NEW app password for 'Mail'")
print("   → Copy it without spaces (16 characters)")
print("   → Update GOOGLE_APP_PASSWORD in .env.test")
print()
print("2. IMAP might not be enabled:")
print("   → Go to https://mail.google.com/mail/u/0/#settings/fwdandpop")
print("   → Enable IMAP")
print()
print("3. If this is a Google Workspace account:")
print("   → Admin might have disabled IMAP")
print("   → Contact your workspace admin")
print()
exit(1)
