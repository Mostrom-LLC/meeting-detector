import { chromium, type FullConfig } from '@playwright/test';
import { loginWithGoogle } from './google-auth';
import { loadEnvFile } from './env-loader';

const AUTH_STATE_PATH = 'test/e2e/web/.auth-state.json';

/**
 * Playwright global setup: logs into Google once and saves browser state
 * so all test specs start with an authenticated session.
 *
 * Prerequisite: OTP listener must be running (`scripts/tools/otp-listener.py`).
 * Skip login when connecting to an existing CDP endpoint (user already authed).
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  // Load environment
  loadEnvFile('.env.e2e');

  // Skip auth setup when using CDP — the browser is already authenticated
  if (process.env.PLAYWRIGHT_CDP_ENDPOINT) {
    return;
  }

  const email = process.env.GOOGLE_EMAIL;
  const password = process.env.GOOGLE_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'GOOGLE_EMAIL and GOOGLE_PASSWORD must be set in .env.e2e for automated login. ' +
      'GOOGLE_PASSWORD is the account password (not the app password).'
    );
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await loginWithGoogle(page, { email, password });
    await context.storageState({ path: AUTH_STATE_PATH });
  } finally {
    await browser.close();
  }
}

export { AUTH_STATE_PATH };
