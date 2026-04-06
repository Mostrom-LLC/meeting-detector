import { test, expect, type Locator, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import { startDetectorHarness } from './detector-harness';
import { needsGoogleLogin, loginWithGoogle } from './google-auth';
import { loadEnvFile } from './env-loader';

loadEnvFile('.env.e2e');

interface ProviderConfig {
  id: string;
  title: string;
  envKey: string;
  platform: string;
  /** Steps to create an instant meeting from the landing page. */
  createMeeting: (page: Page) => Promise<void>;
  /** Labels to click before joining (e.g. "Continue on this browser"). */
  preJoinLabels: readonly RegExp[];
  /** Labels to click to join the meeting. */
  joinLabels: readonly RegExp[];
  /** Labels to click after joining (e.g. "Join audio"). */
  postJoinLabels: readonly RegExp[];
  /** Labels to click to leave the meeting. */
  leaveLabels: readonly RegExp[];
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'google-meet-web',
    title: 'Google Meet web emits meeting_started and meeting_ended',
    envKey: 'E2E_GOOGLE_MEET_URL',
    platform: 'Google Meet',
    createMeeting: async (page) => {
      // Click "New meeting" button
      await clickFirst(page, [/new meeting/i]);
      await page.waitForTimeout(1_000);
      // Click "Start an instant meeting" from dropdown
      await clickFirst(page, [/start an instant meeting/i, /create a meeting for later/i]);
      await page.waitForTimeout(3_000);
    },
    preJoinLabels: [],
    joinLabels: [/join now/i, /ask to join/i],
    postJoinLabels: [],
    leaveLabels: [/leave call/i, /hang up/i],
  },
  {
    id: 'teams-web',
    title: 'Microsoft Teams web emits meeting_started and meeting_ended',
    envKey: 'E2E_TEAMS_WEB_URL',
    platform: 'Microsoft Teams',
    createMeeting: async (page) => {
      // Teams landing → click "Meet now" or "Meet" in sidebar
      await clickFirst(page, [/meet now/i, /meet$/i, /start a meeting/i]);
      await page.waitForTimeout(3_000);
    },
    preJoinLabels: [/continue on this browser/i, /join on the web instead/i],
    joinLabels: [/join now/i],
    postJoinLabels: [],
    leaveLabels: [/leave/i, /hang up/i],
  },
  {
    id: 'zoom-web',
    title: 'Zoom web emits meeting_started and meeting_ended',
    envKey: 'E2E_ZOOM_WEB_URL',
    platform: 'Zoom',
    createMeeting: async (page) => {
      // Zoom home → "Host a Meeting" or "New Meeting"
      await clickFirst(page, [/host a meeting/i, /new meeting/i, /start meeting/i]);
      await page.waitForTimeout(3_000);
    },
    preJoinLabels: [/join from your browser/i, /launch meeting/i],
    joinLabels: [/join audio by computer/i, /join/i],
    postJoinLabels: [],
    leaveLabels: [/leave meeting/i, /leave/i, /end meeting/i],
  },
  {
    id: 'slack-huddle-web',
    title: 'Slack Huddle web emits meeting_started and meeting_ended',
    envKey: 'E2E_SLACK_HUDDLE_WEB_URL',
    platform: 'Slack',
    createMeeting: async (page) => {
      // Slack client → find and start a Huddle in the current channel
      // The headphone icon or "Start a huddle" button in channel header
      await page.waitForTimeout(5_000); // Let Slack fully load
      await clickFirst(page, [
        /start a huddle/i,
        /huddle/i,
      ]);
      // If there's a headphone icon button, try clicking it
      const headphoneBtn = page.locator(
        'button[aria-label*="huddle" i], button[data-qa="huddle-trigger"]'
      ).first();
      if (await headphoneBtn.isVisible().catch(() => false)) {
        await headphoneBtn.click();
      }
      await page.waitForTimeout(3_000);
    },
    preJoinLabels: [],
    joinLabels: [/join huddle/i, /join/i],
    postJoinLabels: [/join audio/i],
    leaveLabels: [/leave/i, /end huddle/i],
  },
  {
    id: 'webex-web',
    title: 'Cisco Webex web emits meeting_started and meeting_ended',
    envKey: 'E2E_WEBEX_WEB_URL',
    platform: 'Cisco Webex',
    createMeeting: async (page) => {
      // Webex home → "Start a Meeting" or "Meet Now"
      await clickFirst(page, [/start a meeting/i, /meet now/i, /start meeting/i]);
      await page.waitForTimeout(3_000);
    },
    preJoinLabels: [/join from your browser/i],
    joinLabels: [/join meeting/i, /start meeting/i, /join/i],
    postJoinLabels: [],
    leaveLabels: [/leave meeting/i, /end meeting/i, /leave/i],
  },
];

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(20_000);

  // Reset Chrome's TCC mic/camera grants so the next access generates fresh TCC
  // log signals that the detector monitors.
  if (process.platform === 'darwin') {
    try {
      execSync('tccutil reset Microphone com.google.Chrome', { stdio: 'ignore' });
      execSync('tccutil reset Camera com.google.Chrome', { stdio: 'ignore' });
    } catch {
      // tccutil may fail in CI or non-macOS
    }
  }
});

for (const provider of PROVIDERS) {
  test(provider.title, async ({ page, context }) => {
    const url = process.env[provider.envKey];
    test.skip(
      !url,
      `Missing ${provider.envKey}; set it in .env.e2e or the environment to enable ${provider.id}.`
    );

    const harness = await startDetectorHarness(provider.id, {
      meetingEndTimeoutMs: 4_000,
    });

    try {
      // Navigate to the provider landing page
      await page.goto(url as string, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3_000);

      // Handle Google login if needed (storageState may have expired or provider
      // redirects to its own login page with a "Sign in with Google" option)
      await handleLoginIfNeeded(page);

      // Grant browser camera/mic permissions for whatever origin we end up on
      try {
        const currentOrigin = new URL(page.url()).origin;
        await context.grantPermissions(['camera', 'microphone'], {
          origin: currentOrigin,
        });
      } catch {
        // Some origins may not support permission grants
      }

      // Create an instant meeting from the landing page
      await provider.createMeeting(page);

      // Grant permissions again — meeting creation may have navigated to a new origin
      try {
        const meetingOrigin = new URL(page.url()).origin;
        await context.grantPermissions(['camera', 'microphone'], {
          origin: meetingOrigin,
        });
      } catch {
        // Best effort
      }

      // Standard join flow
      await clickOptionalLabels(page, provider.preJoinLabels);
      await ensureJoined(page, provider);
      await clickOptionalLabels(page, provider.postJoinLabels);

      // Verify meeting_started
      const started = await harness.waitFor(
        'meeting_started',
        60_000,
        (event) => event.platform === provider.platform
      );
      expect(started.platform).toBe(provider.platform);
      expect(started.started_at).toBeTruthy();

      // Leave the meeting
      await leaveMeeting(page, provider);

      // Verify meeting_ended
      const ended = await harness.waitFor(
        'meeting_ended',
        60_000,
        (event) => event.platform === provider.platform
      );
      expect(ended.platform).toBe(provider.platform);
      expect(ended.started_at).toBe(started.started_at);
      expect(ended.ended_at).toBeTruthy();
    } finally {
      await harness.stop();
    }
  });
}

// ---------------------------------------------------------------------------
// Login helper
// ---------------------------------------------------------------------------

async function handleLoginIfNeeded(page: Page): Promise<void> {
  // Check for "Sign in with Google" or "Sign in" buttons
  const googleSignIn = page.locator(
    'button:has-text("Sign in with Google"), ' +
    'a:has-text("Sign in with Google"), ' +
    '[data-provider="google"], ' +
    'div[data-identifier="google"]'
  ).first();

  const hasGoogleSignIn = await googleSignIn.isVisible().catch(() => false);
  if (hasGoogleSignIn) {
    await googleSignIn.click();
    await page.waitForTimeout(3_000);
    // The Google OAuth flow should auto-complete with saved storageState.
    // If it doesn't (session expired), do a full login.
    if (await needsGoogleLogin(page)) {
      const email = process.env.GOOGLE_EMAIL!;
      const password = process.env.GOOGLE_PASSWORD!;
      await loginWithGoogle(page, { email, password });
    }
    return;
  }

  // Check for a generic "Sign in" that leads to Google
  if (await needsGoogleLogin(page)) {
    const signInLink = page.locator('a:has-text("Sign in"), button:has-text("Sign in")').first();
    if (await signInLink.isVisible().catch(() => false)) {
      await signInLink.click();
      await page.waitForTimeout(3_000);

      // Look for Google option on the login page
      const googleOpt = page.locator(
        'button:has-text("Google"), a:has-text("Google"), ' +
        'button:has-text("Continue with Google"), a:has-text("Continue with Google")'
      ).first();
      if (await googleOpt.isVisible().catch(() => false)) {
        await googleOpt.click();
        await page.waitForTimeout(3_000);
      }

      if (await needsGoogleLogin(page)) {
        const email = process.env.GOOGLE_EMAIL!;
        const password = process.env.GOOGLE_PASSWORD!;
        await loginWithGoogle(page, { email, password });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Click helpers (preserved from original)
// ---------------------------------------------------------------------------

async function ensureJoined(page: Page, provider: ProviderConfig): Promise<void> {
  if (await hasAnyVisibleLabel(page, provider.leaveLabels)) {
    return;
  }

  const joined = await clickFirstVisibleLabel(page, provider.joinLabels);
  if (!joined && !(await hasAnyVisibleLabel(page, provider.leaveLabels))) {
    throw new Error(
      `Could not find a visible join control for ${provider.id}. Tried: ${provider.joinLabels
        .map(String)
        .join(', ')}`
    );
  }
}

async function leaveMeeting(page: Page, provider: ProviderConfig): Promise<void> {
  const left = await clickFirstVisibleLabel(page, provider.leaveLabels);
  if (!left) {
    throw new Error(
      `Could not find a visible leave control for ${provider.id}. Tried: ${provider.leaveLabels
        .map(String)
        .join(', ')}`
    );
  }
}

async function clickOptionalLabels(page: Page, labels: readonly RegExp[]): Promise<void> {
  for (const label of labels) {
    await clickFirstVisibleLabel(page, [label]);
  }
}

async function hasAnyVisibleLabel(page: Page, labels: readonly RegExp[]): Promise<boolean> {
  for (const label of labels) {
    if (await isVisible(page, label)) {
      return true;
    }
  }
  return false;
}

async function clickFirst(page: Page, labels: readonly RegExp[]): Promise<void> {
  const clicked = await clickFirstVisibleLabel(page, labels);
  if (!clicked) {
    throw new Error(
      `Could not find a visible control. Tried: ${labels.map(String).join(', ')}`
    );
  }
}

async function clickFirstVisibleLabel(page: Page, labels: readonly RegExp[]): Promise<boolean> {
  for (const label of labels) {
    const locator = await findClickable(page, label);
    if (!locator) {
      continue;
    }
    await locator.click();
    return true;
  }
  return false;
}

async function isVisible(page: Page, label: RegExp): Promise<boolean> {
  return Boolean(await findClickable(page, label));
}

async function findClickable(page: Page, label: RegExp): Promise<Locator | null> {
  const candidates = [
    page.getByRole('button', { name: label }).first(),
    page.getByRole('link', { name: label }).first(),
    page.getByRole('menuitem', { name: label }).first(),
    page.getByText(label, { exact: false }).first(),
  ];

  for (const locator of candidates) {
    if (await locator.count()) {
      try {
        if (await locator.isVisible()) {
          return locator;
        }
      } catch {
        // Ignore detached candidates and continue searching.
      }
    }
  }

  return null;
}
