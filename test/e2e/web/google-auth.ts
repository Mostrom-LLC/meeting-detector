import type { Page } from '@playwright/test';
import { resolve } from 'node:path';
import { readFile, stat } from 'node:fs/promises';

const OTP_POLL_MS = 2_000;
const OTP_TIMEOUT_MS = 120_000;

/**
 * Sign into a Google account via the standard accounts.google.com flow.
 * Handles email → password → optional OTP (2FA via SMS/Google Voice).
 *
 * Expects the OTP listener (`scripts/tools/otp-listener.py`) to be running
 * in the background, writing 6-digit codes to `scripts/.otp-codes/latest.txt`.
 */
export async function loginWithGoogle(
  page: Page,
  opts: { email: string; password: string; otpFilePath?: string }
): Promise<void> {
  const { email, password } = opts;
  const otpPath = resolve(
    opts.otpFilePath ??
      process.env.OTP_CODE_FILE ??
      'scripts/.otp-codes/latest.txt'
  );

  // Navigate to Google sign-in
  await page.goto('https://accounts.google.com/signin');
  await page.waitForLoadState('domcontentloaded');

  // Enter email
  const emailInput = page.locator('input[type="email"]');
  await emailInput.waitFor({ state: 'visible', timeout: 15_000 });
  await emailInput.fill(email);
  await page.locator('#identifierNext button, [data-idom-class*="nCP5yc"]').first().click();
  await page.waitForTimeout(2_000);

  // Enter password
  const passwordInput = page.locator('input[type="password"]');
  await passwordInput.waitFor({ state: 'visible', timeout: 15_000 });
  await passwordInput.fill(password);
  await page.locator('#passwordNext button, [data-idom-class*="nCP5yc"]').last().click();
  await page.waitForTimeout(3_000);

  // Check if OTP / 2FA challenge appears
  const needsOtp = await page
    .locator('input[type="tel"], #idvPin, #totpPin')
    .isVisible()
    .catch(() => false);

  if (needsOtp) {
    const beforeOtp = Date.now();
    const code = await waitForOtpCode(otpPath, beforeOtp);
    const otpInput = page.locator('input[type="tel"], #idvPin, #totpPin').first();
    await otpInput.fill(code);
    // Click "Next" or submit
    const nextBtn = page.locator(
      '#idvPreregisteredPhoneNext button, button:has-text("Next"), [type="submit"]'
    ).first();
    await nextBtn.click();
    await page.waitForTimeout(3_000);
  }

  // Verify we landed on a logged-in page (myaccount, or redirect back to caller)
  await page.waitForURL(/myaccount\.google\.com|accounts\.google\.com\/b\/|.+/, {
    timeout: 15_000,
  });
}

/**
 * Check if the current page shows a Google sign-in state (not logged in).
 */
export async function needsGoogleLogin(page: Page): Promise<boolean> {
  const signInBtn = page.locator(
    'a[href*="accounts.google.com/ServiceLogin"], ' +
    'a:has-text("Sign in"), ' +
    'button:has-text("Sign in")'
  );
  return (await signInBtn.count()) > 0 && (await signInBtn.first().isVisible().catch(() => false));
}

/**
 * Poll a file for a fresh 6-digit OTP code.
 */
async function waitForOtpCode(filePath: string, minMtimeMs: number): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < OTP_TIMEOUT_MS) {
    try {
      const info = await stat(filePath);
      if (info.mtimeMs >= minMtimeMs) {
        const text = await readFile(filePath, 'utf8');
        const code = text.split(/\r?\n/, 1)[0].trim();
        if (/^\d{6}$/.test(code)) {
          return code;
        }
      }
    } catch {
      // File not found yet, keep polling
    }
    await new Promise((r) => setTimeout(r, OTP_POLL_MS));
  }
  throw new Error(`OTP timeout after ${OTP_TIMEOUT_MS}ms waiting for code in ${filePath}`);
}
