/**
 * live-verify.mjs — Standalone CLI tool for per-platform lifecycle verification.
 *
 * Opens a URL in Chrome (web mode) or launches a native app, waits for
 * meeting_started, closes the tab/app, waits for meeting_ended, and reports
 * pass/fail with timing. Writes NDJSON event log to artifacts directory.
 *
 * Usage:
 *   node scripts/e2e/live-verify.mjs --provider "Google Meet" --mode web
 *   node scripts/e2e/live-verify.mjs --provider "Microsoft Teams" --mode native
 *   node scripts/e2e/live-verify.mjs --all --mode web
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { MeetingDetector } from '../../dist/index.js';

const execAsync = promisify(exec);

const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const runId = new Date().toISOString().replace(/[:.]/g, '-');

loadEnvFile(resolve(projectRoot, '.env'));
loadEnvFile(resolve(projectRoot, '.env.e2e'));

// ---------------------------------------------------------------------------
// Provider map
// ---------------------------------------------------------------------------

const PROVIDERS = {
  'Google Meet': {
    web: process.env.E2E_GOOGLE_MEET_URL,
    nativeApp: null,
  },
  'Microsoft Teams': {
    web: process.env.E2E_TEAMS_WEB_URL,
    nativeApp: 'Microsoft Teams',
  },
  'Zoom': {
    web: process.env.E2E_ZOOM_WEB_URL,
    nativeApp: 'zoom.us',
  },
  'Slack': {
    web: process.env.E2E_SLACK_HUDDLE_WEB_URL,
    nativeApp: 'Slack',
  },
  'Cisco Webex': {
    web: process.env.E2E_WEBEX_WEB_URL,
    nativeApp: 'Webex',
  },
};

// Mapping from provider display name to the platform string emitted by the detector.
// These must match MeetingPlatform values in types.ts.
const PROVIDER_PLATFORM_MAP = {
  'Google Meet': 'Google Meet',
  'Microsoft Teams': 'Microsoft Teams',
  'Zoom': 'Zoom',
  'Slack': 'Slack',
  'Cisco Webex': 'Cisco Webex',
};

const STARTED_TIMEOUT_MS = 120_000;
const ENDED_TIMEOUT_MS = 45_000;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

await main().catch((err) => {
  console.error('[live-verify] Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const providersToRun = resolveProviders(options);
  const artifactRoot = resolve(
    join(projectRoot, 'artifacts', 'verification', runId)
  );
  mkdirSync(artifactRoot, { recursive: true });

  console.log(`[live-verify] Artifact dir: ${artifactRoot}`);
  console.log(`[live-verify] Providers to run: ${providersToRun.join(', ')}`);
  console.log('');

  const results = [];

  // Run sequentially (one provider at a time).
  for (const providerName of providersToRun) {
    const result = await verifyProvider(providerName, options.mode, artifactRoot);
    results.push(result);

    const icon = result.pass ? 'PASS' : result.status === 'skipped' ? 'SKIP' : 'FAIL';
    console.log(`[live-verify] ${icon} ${providerName} (${options.mode}): ${result.reason || 'ok'}`);
    if (result.startedAt && result.endedAt) {
      const durationMs = Date.parse(result.endedAt) - Date.parse(result.startedAt);
      console.log(`             Meeting duration: ${Math.round(durationMs / 1000)}s`);
    }
    console.log('');
  }

  // Write top-level summary.
  const summary = {
    generated_at: new Date().toISOString(),
    mode: options.mode,
    artifact_root: artifactRoot,
    totals: {
      total: results.length,
      pass: results.filter((r) => r.pass).length,
      fail: results.filter((r) => r.status === 'fail').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
    },
    providers: results,
  };

  const summaryPath = join(artifactRoot, 'summary.json');
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(`[live-verify] Summary written: ${summaryPath}`);

  const anyFailed = results.some((r) => r.status === 'fail');
  process.exit(anyFailed ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Per-provider verification
// ---------------------------------------------------------------------------

async function verifyProvider(providerName, mode, artifactRoot) {
  const providerDir = join(artifactRoot, providerName.replace(/\s+/g, '-'));
  mkdirSync(providerDir, { recursive: true });
  const eventsPath = join(providerDir, 'events.ndjson');

  const config = PROVIDERS[providerName];
  if (!config) {
    return writeResult(providerDir, {
      provider: providerName,
      mode,
      status: 'skipped',
      reason: `Unknown provider: ${providerName}`,
      pass: false,
      events_path: eventsPath,
    });
  }

  const url = mode === 'web' ? config.web : null;
  const nativeApp = mode === 'native' ? config.nativeApp : null;

  if (mode === 'web' && !url) {
    return writeResult(providerDir, {
      provider: providerName,
      mode,
      status: 'skipped',
      reason: `No web URL configured for ${providerName}`,
      pass: false,
      events_path: eventsPath,
    });
  }

  if (mode === 'native' && !nativeApp) {
    return writeResult(providerDir, {
      provider: providerName,
      mode,
      status: 'skipped',
      reason: `No native app configured for ${providerName}`,
      pass: false,
      events_path: eventsPath,
    });
  }

  const expectedPlatform = PROVIDER_PLATFORM_MAP[providerName];
  const rawSignals = [];

  const detector = new MeetingDetector({
    startupProbe: false,
    includeRawSignalInLifecycle: true,
  });

  // Log raw signals for debugging.
  detector.on('meeting', (signal) => {
    rawSignals.push({ type: 'raw', ts: new Date().toISOString(), signal });
    appendFileSync(
      eventsPath,
      `${JSON.stringify({ type: 'raw', ts: new Date().toISOString(), signal })}\n`,
      'utf8'
    );
  });

  // Log lifecycle events.
  detector.on('meeting_started', (event) => {
    appendFileSync(
      eventsPath,
      `${JSON.stringify({ type: 'meeting_started', ts: new Date().toISOString(), event })}\n`,
      'utf8'
    );
  });
  detector.on('meeting_ended', (event) => {
    appendFileSync(
      eventsPath,
      `${JSON.stringify({ type: 'meeting_ended', ts: new Date().toISOString(), event })}\n`,
      'utf8'
    );
  });

  detector.start();

  console.log(`[live-verify] Starting: ${providerName} (${mode})`);

  let startedEvent = null;
  let endedEvent = null;

  try {
    // Open the URL or launch the native app.
    if (mode === 'web') {
      console.log(`[live-verify]   Opening Chrome: ${url}`);
      await openInChrome(url);
    } else {
      console.log(`[live-verify]   Launching native app: ${nativeApp}`);
      await launchNativeApp(nativeApp);
    }

    // Wait for meeting_started.
    console.log(`[live-verify]   Waiting for meeting_started (timeout: ${STARTED_TIMEOUT_MS / 1000}s)...`);
    startedEvent = await waitForEvent(detector, 'meeting_started', STARTED_TIMEOUT_MS, (event) => {
      return !expectedPlatform || event.platform === expectedPlatform;
    });
    console.log(`[live-verify]   meeting_started received: platform=${startedEvent.platform}`);

    // Close the tab or quit the native app.
    if (mode === 'web') {
      console.log(`[live-verify]   Closing Chrome tab for: ${url}`);
      await closeChromTab(url);
    } else {
      console.log(`[live-verify]   Quitting native app: ${nativeApp}`);
      await quitNativeApp(nativeApp);
    }

    // Wait for meeting_ended.
    console.log(`[live-verify]   Waiting for meeting_ended (timeout: ${ENDED_TIMEOUT_MS / 1000}s)...`);
    endedEvent = await waitForEvent(detector, 'meeting_ended', ENDED_TIMEOUT_MS, (event) => {
      return (
        (!expectedPlatform || event.platform === expectedPlatform) &&
        (!startedEvent || event.started_at === startedEvent.started_at)
      );
    });
    console.log(`[live-verify]   meeting_ended received: platform=${endedEvent.platform}`);

    const pass =
      Boolean(startedEvent?.started_at) &&
      Boolean(endedEvent?.ended_at) &&
      Date.parse(endedEvent.ended_at) > Date.parse(startedEvent.started_at);

    return writeResult(providerDir, {
      provider: providerName,
      mode,
      status: pass ? 'pass' : 'fail',
      reason: pass ? '' : 'Lifecycle timing invariants failed',
      pass,
      startedAt: startedEvent?.started_at,
      endedAt: endedEvent?.ended_at,
      platform: startedEvent?.platform,
      events_path: eventsPath,
      raw_signal_count: rawSignals.length,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[live-verify]   Error: ${reason}`);
    return writeResult(providerDir, {
      provider: providerName,
      mode,
      status: 'fail',
      reason,
      pass: false,
      startedAt: startedEvent?.started_at,
      endedAt: endedEvent?.ended_at,
      platform: startedEvent?.platform,
      events_path: eventsPath,
      raw_signal_count: rawSignals.length,
    });
  } finally {
    detector.stop();
  }
}

// ---------------------------------------------------------------------------
// Browser / native helpers
// ---------------------------------------------------------------------------

async function openInChrome(url) {
  const script = `tell application "Google Chrome"
    activate
    open location "${url}"
  end tell`;
  await runAppleScript(script);
  // Brief settle time to allow Chrome to navigate.
  await sleep(2000);
}

async function closeChromTab(url) {
  const hostname = safeHostname(url);
  const script = `tell application "Google Chrome"
    set tabClosed to false
    repeat with w in windows
      repeat with t in tabs of w
        if URL of t contains "${hostname}" then
          close t
          set tabClosed to true
          exit repeat
        end if
      end repeat
      if tabClosed then exit repeat
    end repeat
  end tell`;
  await runAppleScript(script);
}

async function launchNativeApp(appName) {
  const script = `tell application "${appName}"
    activate
  end tell`;
  await runAppleScript(script);
  await sleep(2000);
}

async function quitNativeApp(appName) {
  const script = `tell application "${appName}"
    quit
  end tell`;
  await runAppleScript(script);
}

async function runAppleScript(script) {
  await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
}

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Event waiting
// ---------------------------------------------------------------------------

function waitForEvent(detector, eventName, timeoutMs, predicate) {
  return new Promise((resolveP, rejectP) => {
    const onEvent = (event) => {
      if (!predicate(event)) {
        return;
      }
      cleanup();
      resolveP(event);
    };

    const timer = setTimeout(() => {
      cleanup();
      rejectP(new Error(`Timed out waiting for ${eventName} after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    timer.unref?.();

    const cleanup = () => {
      clearTimeout(timer);
      detector.off(eventName, onEvent);
    };

    detector.on(eventName, onEvent);
  });
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const parsed = {
    help: false,
    all: false,
    provider: '',
    mode: 'web',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      case '--all':
        parsed.all = true;
        break;
      case '--provider':
        parsed.provider = argv[++i] || '';
        break;
      case '--mode':
        parsed.mode = argv[++i] || 'web';
        break;
      default:
        throw new Error(`Unknown argument: ${arg}. Run with --help for usage.`);
    }
  }

  if (!parsed.help && !parsed.all && !parsed.provider) {
    throw new Error('Specify --provider <name> or --all. Run with --help for usage.');
  }
  if (!['web', 'native'].includes(parsed.mode)) {
    throw new Error(`Invalid --mode '${parsed.mode}'. Expected web|native.`);
  }

  return parsed;
}

function resolveProviders(options) {
  if (options.all) {
    return Object.keys(PROVIDERS);
  }
  if (!PROVIDERS[options.provider]) {
    throw new Error(
      `Unknown provider: "${options.provider}". Known providers: ${Object.keys(PROVIDERS).join(', ')}`
    );
  }
  return [options.provider];
}

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

function writeResult(providerDir, result) {
  writeFileSync(join(providerDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return result;
}

// ---------------------------------------------------------------------------
// .env file loader (no external deps)
// ---------------------------------------------------------------------------

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const shellEnvKeys = new Set(Object.keys(process.env));
  const content = readFileSync(filePath, 'utf8');

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!key || shellEnvKeys.has(key)) {
      continue;
    }

    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`
Usage: node scripts/e2e/live-verify.mjs [options]

Opens a URL in Chrome or launches a native app, waits for the meeting detector
to emit meeting_started, closes the tab/app, then waits for meeting_ended.
Reports pass/fail with timing and writes NDJSON logs to artifacts/.

Options:
  --help, -h               Show this help message
  --provider <name>        Single provider to verify (see below)
  --all                    Run all configured providers sequentially
  --mode <web|native>      Launch mode (default: web)

Providers:
  "Google Meet"            web only
  "Microsoft Teams"        web + native
  "Zoom"                   web + native
  "Slack"                  web + native
  "Cisco Webex"            web + native

Environment (.env.e2e):
  E2E_GOOGLE_MEET_URL
  E2E_TEAMS_WEB_URL
  E2E_ZOOM_WEB_URL
  E2E_SLACK_HUDDLE_WEB_URL
  E2E_WEBEX_WEB_URL

Examples:
  node scripts/e2e/live-verify.mjs --provider "Google Meet" --mode web
  node scripts/e2e/live-verify.mjs --provider "Microsoft Teams" --mode native
  node scripts/e2e/live-verify.mjs --all --mode web
`);
}
