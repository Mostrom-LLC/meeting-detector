import { defineConfig } from 'cypress';
import {
  readFileSync,
  appendFileSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { resolve, join } from 'node:path';

// ---------------------------------------------------------------------------
// Env loader
// ---------------------------------------------------------------------------
function loadEnvFile(filePath: string): void {
  let content: string;
  try {
    content = readFileSync(resolve(filePath), 'utf8');
  } catch {
    return;
  }
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile('.env.e2e');

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Detector harness state (lives in Node, controlled via cy.task)
// ---------------------------------------------------------------------------
let detectorInstance: any = null;
let lifecycleEvents: any[] = [];
let eventResolvers: Map<string, { resolve: Function; timer: NodeJS.Timeout }> = new Map();
let artifactDir = '';
let eventsPath = '';

export default defineConfig({
  e2e: {
    specPattern: 'cypress/e2e/**/*.cy.{ts,js}',
    supportFile: 'cypress/support/e2e.ts',
    video: false,
    screenshotOnRunFailure: true,
    defaultCommandTimeout: 20_000,
    pageLoadTimeout: 30_000,
    testIsolation: false,
    experimentalModifyObstructiveThirdPartyCode: true,
    chromeWebSecurity: false,
    setupNodeEvents(on, config) {
      // Pass env vars to Cypress
      config.env.E2E_GOOGLE_MEET_URL =
        process.env.E2E_GOOGLE_MEET_URL || 'https://meet.google.com/landing';
      config.env.E2E_TEAMS_WEB_URL =
        process.env.E2E_TEAMS_WEB_URL || 'https://teams.live.com/v2/';
      config.env.E2E_ZOOM_WEB_URL =
        process.env.E2E_ZOOM_WEB_URL || 'https://app.zoom.us/wc/home';
      config.env.E2E_SLACK_HUDDLE_WEB_URL =
        process.env.E2E_SLACK_HUDDLE_WEB_URL || 'https://app.slack.com/client';
      config.env.E2E_WEBEX_WEB_URL =
        process.env.E2E_WEBEX_WEB_URL || 'https://web.webex.com/';

      on('task', {
        async startDetector(providerId: string) {
          const { MeetingDetector } = await import('./dist/index.js');
          const ts = new Date().toISOString().replace(/[:.]/g, '-');
          artifactDir = join('artifacts', 'cypress', ts, providerId);
          mkdirSync(artifactDir, { recursive: true });
          eventsPath = join(artifactDir, 'events.ndjson');
          lifecycleEvents = [];
          eventResolvers = new Map();

          detectorInstance = new MeetingDetector({
            startupProbe: false,
            meetingEndTimeoutMs: 30_000,
            includeRawSignalInLifecycle: true,
            debug: true,
          });

          detectorInstance.on('meeting_lifecycle', (event: any) => {
            lifecycleEvents.push(event);
            appendFileSync(eventsPath, JSON.stringify(event) + '\n');

            const key = event.event;
            const waiter = eventResolvers.get(key);
            if (waiter) {
              clearTimeout(waiter.timer);
              eventResolvers.delete(key);
              waiter.resolve(event);
            }
          });

          detectorInstance.on('meeting', (signal: any) => {
            appendFileSync(
              eventsPath,
              JSON.stringify({ type: 'raw', ts: new Date().toISOString(), signal }) + '\n'
            );
          });

          detectorInstance.start();
          return { artifactDir, eventsPath };
        },

        async waitForEvent({
          eventName,
          timeoutMs = 60_000,
        }: {
          eventName: string;
          timeoutMs?: number;
        }) {
          const existing = lifecycleEvents.find((e) => e.event === eventName);
          if (existing) return existing;

          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              eventResolvers.delete(eventName);
              reject(
                new Error(
                  `Timeout after ${timeoutMs}ms waiting for ${eventName}. ` +
                    `Events seen: ${lifecycleEvents.map((e) => e.event).join(', ') || 'none'}`
                )
              );
            }, timeoutMs);

            eventResolvers.set(eventName, { resolve, timer });
          });
        },

        stopDetector() {
          if (detectorInstance) {
            detectorInstance.stop();
            if (artifactDir) {
              writeFileSync(
                join(artifactDir, 'summary.json'),
                JSON.stringify({ events: lifecycleEvents }, null, 2)
              );
            }
            detectorInstance = null;
          }
          return null;
        },

        getLifecycleEvents() {
          return lifecycleEvents;
        },

        log(msg: string) {
          console.log(`  [cy] ${msg}`);
          return null;
        },
      });

      return config;
    },
  },
});
