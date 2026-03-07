#!/usr/bin/env python3
"""
OTP Listener - Monitors email for Google Voice SMS and extracts OTP codes

This script monitors your Gmail inbox for Google Voice SMS forwarding emails
and automatically extracts OTP codes, writing them to .otp-codes/latest.txt

Setup:
1. Enable Google Voice SMS forwarding to email
2. Create Gmail App Password (myaccount.google.com/security)
3. Set environment variables:
   export OTP_EMAIL="your-email@gmail.com"
   export OTP_EMAIL_PASSWORD="your-app-password"
4. Run: python3 tools/otp-listener.py

Claude can then read .otp-codes/latest.txt to get current OTP codes automatically.
"""

import imaplib
import email
import re
import time
import os
from pathlib import Path
from datetime import datetime

# Load environment from .env.test if available
def load_env_file():
    """Load environment variables from .env.test (preserves existing runtime values)"""
    env_file = Path(__file__).parent.parent / '.env.test'
    if env_file.exists():
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    # Remove quotes from value
                    value = value.strip().strip('"').strip("'")
                    # Only set if not already defined (preserves runtime-provided credentials)
                    if key not in os.environ:
                        os.environ[key] = value

# Load .env.test first
load_env_file()

# Email configuration from environment
EMAIL = os.environ.get('GOOGLE_EMAIL', os.environ.get('OTP_EMAIL', ''))
PASSWORD = os.environ.get('GOOGLE_APP_PASSWORD', os.environ.get('OTP_EMAIL_PASSWORD', ''))
# Remove spaces from app password (Gmail provides them with spaces but they need to be removed)
PASSWORD = PASSWORD.replace(' ', '') if PASSWORD else ''
IMAP_SERVER = os.environ.get('OTP_IMAP_SERVER', 'imap.gmail.com')

# Output file
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
OTP_DIR = PROJECT_ROOT / '.otp-codes'
OTP_FILE = OTP_DIR / 'latest.txt'

def extract_otp_code(body):
    """Extract 6-digit code from email body"""
    # Match patterns like: "Your code is 424242" or just "424242"
    patterns = [
        r'\b(\d{6})\b',  # Any 6 digits
        r'code[:\s]+(\d{6})',  # "code: 123456"
        r'verification[:\s]+(\d{6})',  # "verification: 123456"
        r'verify[:\s]+(\d{6})',  # "verify: 123456"
    ]
    for pattern in patterns:
        match = re.search(pattern, body, re.IGNORECASE)
        if match:
            return match.group(1)
    return None

def check_for_otp():
    """Check email for new OTP codes and write to file"""
    try:
        # Connect to Gmail
        mail = imaplib.IMAP4_SSL(IMAP_SERVER)
        mail.login(EMAIL, PASSWORD)
        mail.select('inbox')

        # Search for recent Google Voice messages (unread)
        # Adjust FROM address if your Google Voice forwards from a different address
        _, messages = mail.search(None, '(FROM "voice-noreply@google.com" UNSEEN)')

        if messages[0]:
            for num in messages[0].split():
                _, msg_data = mail.fetch(num, '(RFC822)')
                email_body = msg_data[0][1]
                email_message = email.message_from_bytes(email_body)

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
                    # Write to file with timestamp
                    OTP_DIR.mkdir(exist_ok=True)
                    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                    with open(OTP_FILE, 'w') as f:
                        f.write(f"{otp_code}\n")
                        f.write(f"# Received at {timestamp}\n")

                    print(f"✅ [{timestamp}] OTP code saved: {otp_code}")
                    return otp_code
                else:
                    print(f"⚠️  Email received but no OTP code found")
                    print(f"    Body preview: {body[:100]}...")

        return None

    except imaplib.IMAP4.error as e:
        print(f"❌ IMAP Error: {e}")
        print("   Check your email/password or enable 'Less secure app access'")
        return None
    except Exception as e:
        print(f"❌ Error: {e}")
        return None
    finally:
        try:
            mail.close()
            mail.logout()
        except:
            pass

def main():
    """Main loop - continuously monitor for OTP codes"""
    if not EMAIL or not PASSWORD:
        print("❌ Error: Environment variables not set!")
        print()
        print("Please set:")
        print("  export OTP_EMAIL='your-email@gmail.com'")
        print("  export OTP_EMAIL_PASSWORD='your-app-password'")
        print()
        print("To get an app password:")
        print("  1. Go to https://myaccount.google.com/security")
        print("  2. Enable 2-factor authentication")
        print("  3. Generate an 'App password' for Mail")
        print("  4. Use that password (not your regular Gmail password)")
        return

    print("🔍 OTP Listener Started")
    print(f"📧 Monitoring: {EMAIL}")
    print(f"📁 Output file: {OTP_FILE}")
    print(f"⏰ Checking every 10 seconds...")
    print()

    while True:
        try:
            check_for_otp()
            time.sleep(10)  # Check every 10 seconds
        except KeyboardInterrupt:
            print("\n\n👋 OTP Listener stopped")
            break
        except Exception as e:
            print(f"❌ Unexpected error: {e}")
            time.sleep(10)

if __name__ == "__main__":
    main()
