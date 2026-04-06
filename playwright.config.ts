import { defineConfig, devices } from '@playwright/test';

const cdpEndpoint = process.env.PLAYWRIGHT_CDP_ENDPOINT;

export default defineConfig({
  testDir: './test/e2e/web',
  globalSetup: './test/e2e/web/global-setup.ts',
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    ...(cdpEndpoint
      ? { connectOptions: { wsEndpoint: cdpEndpoint } }
      : { ...devices['Desktop Chrome'] }),
    // Load saved Google auth state (created by global-setup.ts)
    ...(cdpEndpoint ? {} : { storageState: 'test/e2e/web/.auth-state.json' }),
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
});
