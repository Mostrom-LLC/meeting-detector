#!/usr/bin/env python3
"""
Test OTP listener - check once for messages
"""

import imaplib
import email
import re
import os
from pathlib import Path

# Load environment from .env.test with proper parsing
def load_env_file():
    env_file = Path(__file__).parent.parent / '.env.test'
    if env_file.exists():
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                if '=' in line:
                    key, value = line.split('=', 1)
                    key = key.strip()
                    value = value.split('#')[0].strip()
                    value = value.strip('"').strip("'")
                    os.environ[key] = value

load_env_file()

EMAIL = os.environ.get('GOOGLE_EMAIL', '').strip()
PASSWORD = os.environ.get('GOOGLE_APP_PASSWORD', '').strip().replace(' ', '')

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
OTP_FILE = PROJECT_ROOT / '.otp-codes' / 'latest.txt'

def extract_otp_code(body):
    """Extract 6-digit code from email body"""
    patterns = [
        r'\b(\d{6})\b',
        r'code[:\s]+(\d{6})',
        r'verification[:\s]+(\d{6})',
        r'verify[:\s]+(\d{6})',
    ]
    for pattern in patterns:
        match = re.search(pattern, body, re.IGNORECASE)
        if match:
            return match.group(1)
    return None

print("🔍 Checking for OTP codes in Gmail...")
print(f"📧 Email: {EMAIL}")
print()

try:
    mail = imaplib.IMAP4_SSL('imap.gmail.com')
    mail.login(EMAIL, PASSWORD)
    mail.select('inbox')

    # Check for unread Google Voice messages
    _, messages = mail.search(None, '(FROM "voice-noreply@google.com" UNSEEN)')

    if messages[0]:
        msg_nums = messages[0].split()
        print(f"📨 Found {len(msg_nums)} unread Google Voice message(s)")
        print()

        for num in msg_nums:
            _, msg_data = mail.fetch(num, '(RFC822)')
            email_body = msg_data[0][1]
            email_message = email.message_from_bytes(email_body)

            # Get subject
            subject = email_message.get('subject', 'No subject')
            print(f"Subject: {subject}")

            # Get email body
            body = ""
            if email_message.is_multipart():
                for part in email_message.walk():
                    if part.get_content_type() == "text/plain":
                        body = part.get_payload(decode=True).decode()
                        break
            else:
                body = email_message.get_payload(decode=True).decode()

            # Extract OTP
            otp_code = extract_otp_code(body)
            if otp_code:
                # Write to file
                OTP_FILE.parent.mkdir(exist_ok=True)
                with open(OTP_FILE, 'w') as f:
                    f.write(f"{otp_code}\n")

                print(f"✅ OTP code extracted: {otp_code}")
                print(f"📁 Saved to: {OTP_FILE}")
                print()
                print("Body preview:")
                print(body[:200])
            else:
                print("⚠️  No OTP code found in message")
                print()
                print("Body preview:")
                print(body[:200])

    else:
        print("✅ No unread Google Voice messages")
        print("   (This is OK - waiting for new OTP codes)")

    # Also check total Google Voice messages
    _, all_gv = mail.search(None, '(FROM "voice-noreply@google.com")')
    total = len(all_gv[0].split()) if all_gv[0] else 0
    print()
    print(f"📊 Total Google Voice messages in inbox: {total}")

    mail.close()
    mail.logout()

    print()
    print("=" * 60)
    print("✅ OTP Listener is working correctly!")
    print("=" * 60)
    print()
    print("To run continuously:")
    print("  ./tools/start-otp-listener.sh")
    print()
    print("I can now read OTP codes from:")
    print(f"  {OTP_FILE}")

except Exception as e:
    print(f"❌ Error: {e}")
    exit(1)
