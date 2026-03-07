# OTP Listener - Quick Setup

**Goal**: Give Claude automatic access to OTP codes without manual forwarding

## 5-Minute Setup

### Step 1: Configure Google Voice Email Forwarding

1. Go to [voice.google.com/settings](https://voice.google.com/settings)
2. Under "Messages" section:
   - ✅ Enable "Email notifications for text messages"
   - ✅ Choose "Send an email for each text message"
3. Verify the email address is correct (the one you'll use below)

### Step 2: Get Gmail App Password

**You need an "App Password" (not your regular Gmail password):**

1. Go to [myaccount.google.com/security](https://myaccount.google.com/security)
2. Enable "2-Step Verification" if not already enabled
3. Scroll down to "App passwords" section
4. Click "App passwords" (or "Generate new app password")
5. Select:
   - App: **Mail**
   - Device: **Mac** (or whatever you're using)
6. Click "Generate"
7. **Copy the 16-character password** (looks like: `xxxx xxxx xxxx xxxx`)

### Step 3: Set Environment Variables

Add these to your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
# OTP Listener Configuration
export OTP_EMAIL="your-email@gmail.com"           # Your Gmail address
export OTP_EMAIL_PASSWORD="xxxx xxxx xxxx xxxx"   # The app password you just generated
```

**Then reload your shell**:
```bash
source ~/.zshrc  # or source ~/.bashrc
```

### Step 4: Start the Listener

```bash
cd /Volumes/Samsung/repositories/mostrom/SPI/spi-react-native
./tools/start-otp-listener.sh
```

You should see:
```
🔍 OTP Listener Started
📧 Monitoring: your-email@gmail.com
📁 Output file: /Volumes/Samsung/repositories/mostrom/SPI/spi-react-native/.otp-codes/latest.txt
⏰ Checking every 10 seconds...
```

**Keep this running in a terminal tab!**

---

## How It Works

1. **You trigger OTP**: Sign in with phone or add phone in settings
2. **Google Voice receives SMS**: Real OTP code sent to your number
3. **Google Voice forwards to email**: Email sent to your Gmail
4. **Listener extracts code**: Python script finds 6-digit code in email
5. **Code written to file**: Saved to `.otp-codes/latest.txt`
6. **Claude reads code**: I can read the file and see current OTP

**Total delay**: Usually 2-5 seconds from SMS arrival to file update

---

## Testing the Setup

### Test 1: Verify Listener is Running

In one terminal:
```bash
./tools/start-otp-listener.sh
```

### Test 2: Send Test SMS to Google Voice

From your phone or another service, send an SMS to your Google Voice number:
```
Your verification code is 123456
```

You should see in the listener output:
```
✅ [2026-03-03 14:23:45] OTP code saved: 123456
```

### Test 3: Check the File

```bash
cat .otp-codes/latest.txt
```

Should show:
```
123456
# Received at 2026-03-03 14:23:45
```

### Test 4: Real OTP Flow

1. Start listener (if not already running)
2. Go to app: `npm run web`
3. Click "Sign in with phone"
4. Enter your Google Voice number
5. Wait for SMS
6. Check listener output - should see OTP code extracted
7. Check file: `cat .otp-codes/latest.txt`

---

## Claude Can Now Access OTP Codes

Once the listener is running, I can:

```bash
# Read the latest OTP code
cat .otp-codes/latest.txt

# Use it in tests
npm run test:e2e  # (when E2E tests are configured to read from file)
```

**No more manual forwarding needed!** 🎉

---

## Troubleshooting

### "Environment variables not set"
- Make sure you added exports to `~/.zshrc` or `~/.bashrc`
- Run `source ~/.zshrc` to reload
- Verify: `echo $OTP_EMAIL` should show your email

### "IMAP Error: Authentication failed"
- You need an **App Password**, not your regular Gmail password
- Go to [myaccount.google.com/security](https://myaccount.google.com/security)
- Generate a new App Password under "App passwords" section
- Make sure 2-factor authentication is enabled first

### "Email received but no OTP code found"
- The script looks for 6-digit numbers in email body
- Check that Google Voice is actually forwarding the SMS content
- Check the listener output - it shows a preview of the email body

### Listener not detecting emails
- Check Google Voice settings - email forwarding enabled?
- Check your Gmail inbox - do you see emails from "voice-noreply@google.com"?
- Try marking an old Google Voice email as "unread" - listener should detect it

### Want to test without real OTP?
Send a test email to yourself:
```
From: voice-noreply@google.com
Subject: New text message
Body: Your verification code is 999888
```

Mark it as unread, listener should detect it.

---

## Alternative: Using Twilio Instead

If you prefer, you can use Twilio's API instead (see `/docs/testing/automated-otp-access.md` for full guide).

**Pros**:
- Official API (no email scraping)
- More reliable
- Can make direct API calls

**Cons**:
- Costs money (but trial includes $15 credit)
- Need new phone number

---

## Files Created

- `tools/otp-listener.py` - Python script that monitors email
- `tools/start-otp-listener.sh` - Quick start script
- `.otp-codes/latest.txt` - Where current OTP code is stored (gitignored)
- `.gitignore` - Updated to ignore `.otp-codes/` directory

---

## Security Notes

- ✅ `.otp-codes/` is in `.gitignore` - won't be committed
- ✅ Use App Password, not your main Gmail password
- ✅ OTP codes expire quickly (usually 5-10 minutes)
- ⚠️ Don't share your App Password or commit it to the repo
- ⚠️ Anyone with access to `.otp-codes/latest.txt` can see recent codes

---

**Ready to start?** Run `./tools/start-otp-listener.sh` and test it out!
