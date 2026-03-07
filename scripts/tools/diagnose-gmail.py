#!/usr/bin/env python3
"""
Gmail Connection Diagnostics

Helps diagnose Gmail authentication issues
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
    return env_file.exists()

load_env_file()

EMAIL = os.environ.get('GOOGLE_EMAIL', '').strip()
PASSWORD = os.environ.get('GOOGLE_APP_PASSWORD', '').strip().replace(' ', '')

print("=" * 60)
print("GMAIL CONNECTION DIAGNOSTICS")
print("=" * 60)
print()

print("📋 STEP 1: Checking credentials in .env.test")
print("-" * 60)
print(f"Email: {EMAIL}")
print(f"Password length: {len(PASSWORD)} characters")
print(f"Password (masked): {'*' * min(len(PASSWORD), 40)}")
print()

if not EMAIL:
    print("❌ GOOGLE_EMAIL is not set in .env.test")
    print("   Add: GOOGLE_EMAIL=\"your-email@gmail.com\"")
    exit(1)

if not PASSWORD:
    print("❌ GOOGLE_APP_PASSWORD is not set in .env.test")
    print("   Add: GOOGLE_APP_PASSWORD=\"your app password\"")
    exit(1)

if '@' not in EMAIL:
    print("❌ Email appears invalid (no @ symbol)")
    exit(1)

print("✅ Credentials found in .env.test")
print()

print("📋 STEP 2: Checking Gmail account settings")
print("-" * 60)
print()
print("Please verify these settings for agent@mostrom.io:")
print()
print("1. Go to: https://myaccount.google.com/security")
print()
print("2. Check 2-Step Verification:")
print("   ✅ Should be: ON")
print("   ❌ If OFF: Enable it first")
print()
print("3. Check App Passwords:")
print("   → Scroll down to 'App passwords'")
print("   → Make sure you created an app password for 'Mail'")
print("   → App password format: 16 characters (xxxx xxxx xxxx xxxx)")
print(f"   → Your password length: {len(PASSWORD)} characters")
print()
print("4. Check IMAP access:")
print("   → Go to: https://mail.google.com/mail/u/0/#settings/fwdandpop")
print("   → Look for 'IMAP access'")
print("   → Should be: 'Enable IMAP'")
print()
print("5. Check 'Less secure app access' (might be needed):")
print("   → Go to: https://myaccount.google.com/lesssecureapps")
print("   → Try turning this ON if still getting errors")
print()

input("Press Enter after checking the above settings...")
print()

print("📋 STEP 3: Testing IMAP connection")
print("-" * 60)

try:
    print("🔌 Connecting to imap.gmail.com:993...")
    mail = imaplib.IMAP4_SSL('imap.gmail.com', 993)
    print("✅ Connected to server")
    print()

    print("🔐 Attempting login...")
    print(f"   Email: {EMAIL}")
    print(f"   Password: {PASSWORD[:4]}...{PASSWORD[-4:]} ({len(PASSWORD)} chars)")
    print()

    mail.login(EMAIL, PASSWORD)
    print("✅ Login successful!")
    print()

    mail.select('inbox')
    print("✅ Inbox selected")
    print()

    # Check for any emails
    _, total = mail.search(None, 'ALL')
    count = len(total[0].split()) if total[0] else 0
    print(f"📬 Total emails in inbox: {count}")
    print()

    # Check for Google Voice emails
    _, gv_msgs = mail.search(None, '(FROM "voice-noreply@google.com")')
    gv_count = len(gv_msgs[0].split()) if gv_msgs[0] else 0
    print(f"📱 Google Voice emails found: {gv_count}")
    print()

    mail.close()
    mail.logout()

    print("=" * 60)
    print("✅ ALL CHECKS PASSED!")
    print("=" * 60)
    print()
    print("The OTP listener should work. Run:")
    print("  ./tools/start-otp-listener.sh")
    print()

except imaplib.IMAP4.error as e:
    print(f"❌ IMAP Authentication Error: {e}")
    print()
    print("=" * 60)
    print("TROUBLESHOOTING STEPS:")
    print("=" * 60)
    print()
    print("1. Verify the app password is correct:")
    print(f"   Current password in .env.test: {PASSWORD}")
    print("   → Go to https://myaccount.google.com/apppasswords")
    print("   → Delete the old app password")
    print("   → Create a NEW app password for 'Mail'")
    print("   → Copy it WITHOUT spaces: blqcctvfeqjarom (16 chars)")
    print("   → Update .env.test with the new password")
    print()
    print("2. Check if IMAP is enabled:")
    print("   → Go to https://mail.google.com/mail/u/0/#settings/fwdandpop")
    print("   → Enable IMAP")
    print("   → Save changes")
    print()
    print("3. Try 'Less secure app access':")
    print("   → Go to https://myaccount.google.com/lesssecureapps")
    print("   → Turn it ON")
    print("   → Try again")
    print()
    print("4. Alternative: Use a different Gmail account")
    print("   → Or contact Google Support if this is a workspace/org account")
    print()
    exit(1)

except Exception as e:
    print(f"❌ Unexpected Error: {e}")
    print()
    print("This might be a network or firewall issue.")
    print("Try:")
    print("  - Check your internet connection")
    print("  - Disable VPN if using one")
    print("  - Check firewall settings")
    exit(1)
