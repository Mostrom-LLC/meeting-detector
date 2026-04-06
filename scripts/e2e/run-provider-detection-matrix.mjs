import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeetingDetector } from '../../dist/detector.js';
import { getProviderById, getProvidersForMode } from './provider-detection-contract.mjs';

const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const runId = new Date().toISOString().replace(/[:.]/g, '-');

loadEnvFile(resolve(projectRoot, '.env'));
loadEnvFile(resolve(projectRoot, '.env.e2e'));

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const providers = resolveProviders(options);
  const artifactRoot = resolve(
    options.artifactRoot || process.env.E2E_ARTIFACT_DIR || join(projectRoot, 'artifacts', 'provider-detection', runId)
  );
  mkdirSync(artifactRoot, { recursive: true });

  const results = [];
  for (const provider of providers) {
    const result = await runProviderCheck(provider, options, artifactRoot);
    results.push(result);
    console.log(`${provider.id}: ${result.status} (started=${result.started_count}, ended=${result.ended_count})`);
  }

  const summary = {
    generated_at: new Date().toISOString(),
    mode: options.mode,
    execution_style: options.executionStyle,
    dry_run: options.dryRun,
    artifact_root: artifactRoot,
    totals: {
      total: results.length,
      pass: results.filter((r) => r.pass).length,
      fail: results.filter((r) => r.status === 'fail').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      blocked: results.filter((r) => r.status === 'blocked').length,
    },
    providers: results,
  };

  const summaryPath = join(artifactRoot, 'matrix-summary.json');
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(`Summary written: ${summaryPath}`);
  // Force CLI termination in case detector child-process handles linger.
  process.exit(0);
}

function resolveProviders(options) {
  if (options.provider) {
    const provider = getProviderById(options.provider);
    if (!provider) {
      throw new Error(`Unknown --provider value: ${options.provider}`);
    }
    if (options.mode !== 'all' && !provider.modes.includes(options.mode)) {
      throw new Error(`Provider '${provider.id}' does not support mode '${options.mode}'.`);
    }
    return [provider];
  }
  return getProvidersForMode(options.mode);
}

async function runProviderCheck(provider, options, artifactRoot) {
  const providerDir = join(artifactRoot, provider.id);
  mkdirSync(providerDir, { recursive: true });
  const eventsPath = join(providerDir, 'events.ndjson');

  const mode = resolveProviderMode(provider, options.mode);
  const envKey = mode === 'web' ? provider.webEnvKey : provider.nativeEnvKey;
  const meetingUrl = envKey ? (process.env[envKey] || '').trim() : '';

  if (!envKey || !meetingUrl) {
    return writeProviderSummary(providerDir, {
      provider: provider.id,
      platform: provider.platform,
      mode,
      status: 'skipped',
      reason: `Missing ${envKey || 'provider env key'}`,
      started_count: 0,
      ended_count: 0,
      started_platforms: [],
      ended_platforms: [],
      pass: false,
      events_path: eventsPath,
    });
  }

  if (options.dryRun) {
    return writeProviderSummary(providerDir, {
      provider: provider.id,
      platform: provider.platform,
      mode,
      status: 'skipped',
      reason: 'Dry-run mode: detector flow not executed',
      started_count: 0,
      ended_count: 0,
      started_platforms: [],
      ended_platforms: [],
      pass: false,
      events_path: eventsPath,
      target_url: redactUrl(meetingUrl),
    });
  }

  if (options.executionStyle === 'auto') {
    return writeProviderSummary(providerDir, {
      provider: provider.id,
      platform: provider.platform,
      mode,
      status: 'blocked',
      reason: 'Auto mode requires external provider automation orchestration. Re-run with --manual.',
      started_count: 0,
      ended_count: 0,
      started_platforms: [],
      ended_platforms: [],
      pass: false,
      events_path: eventsPath,
      target_url: redactUrl(meetingUrl),
    });
  }

  const detector = new MeetingDetector({
    startupProbe: false,
    includeRawSignalInLifecycle: true,
    meetingEndTimeoutMs: options.meetingEndTimeoutMs,
  });

  const lifecycleEvents = [];
  detector.on('meeting_lifecycle', (event) => {
    lifecycleEvents.push(event);
    appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
  });

  detector.start();

  try {
    printManualPrompt(provider, mode, meetingUrl, options);

    const started = await waitForLifecycleEvent(
      detector,
      'meeting_started',
      options.joinTimeoutMs,
      (event) => event.platform === provider.platform
    );
    const ended = await waitForLifecycleEvent(
      detector,
      'meeting_ended',
      options.leaveTimeoutMs,
      (event) => event.platform === provider.platform && event.started_at === started.started_at
    );

    const startedPlatforms = lifecycleEvents
      .filter((event) => event.event === 'meeting_started')
      .map((event) => event.platform);
    const endedPlatforms = lifecycleEvents
      .filter((event) => event.event === 'meeting_ended')
      .map((event) => event.platform);

    const pass =
      startedPlatforms.includes(provider.platform) &&
      endedPlatforms.includes(provider.platform) &&
      Boolean(started.started_at) &&
      Boolean(ended.ended_at) &&
      Date.parse(ended.ended_at || '') > Date.parse(started.started_at || '');

    return writeProviderSummary(providerDir, {
      provider: provider.id,
      platform: provider.platform,
      mode,
      status: pass ? 'pass' : 'fail',
      reason: pass ? '' : 'Lifecycle invariants failed',
      started_count: startedPlatforms.length,
      ended_count: endedPlatforms.length,
      started_platforms: uniqueValues(startedPlatforms),
      ended_platforms: uniqueValues(endedPlatforms),
      pass,
      events_path: eventsPath,
      target_url: redactUrl(meetingUrl),
    });
  } catch (error) {
    return writeProviderSummary(providerDir, {
      provider: provider.id,
      platform: provider.platform,
      mode,
      status: 'fail',
      reason: error instanceof Error ? error.message : String(error),
      started_count: lifecycleEvents.filter((event) => event.event === 'meeting_started').length,
      ended_count: lifecycleEvents.filter((event) => event.event === 'meeting_ended').length,
      started_platforms: uniqueValues(
        lifecycleEvents.filter((event) => event.event === 'meeting_started').map((event) => event.platform)
      ),
      ended_platforms: uniqueValues(
        lifecycleEvents.filter((event) => event.event === 'meeting_ended').map((event) => event.platform)
      ),
      pass: false,
      events_path: eventsPath,
      target_url: redactUrl(meetingUrl),
    });
  } finally {
    detector.stop();
  }
}

function writeProviderSummary(providerDir, summary) {
  writeFileSync(join(providerDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return summary;
}

function resolveProviderMode(provider, requestedMode) {
  if (requestedMode === 'all') {
    if (provider.modes.includes('web')) {
      return 'web';
    }
    return provider.modes[0];
  }
  return requestedMode;
}

function waitForLifecycleEvent(detector, eventName, timeoutMs, predicate) {
  return new Promise((resolveEvent, rejectEvent) => {
    const onEvent = (event) => {
      if (!predicate(event)) {
        return;
      }
      cleanup();
      resolveEvent(event);
    };

    const timer = setTimeout(() => {
      cleanup();
      rejectEvent(new Error(`Timed out waiting for ${eventName} after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();

    const cleanup = () => {
      clearTimeout(timer);
      detector.off(eventName, onEvent);
    };

    detector.on(eventName, onEvent);
  });
}

function parseArgs(argv) {
  const parsed = {
    help: false,
    mode: 'all',
    provider: '',
    artifactRoot: '',
    dryRun: false,
    executionStyle: 'manual',
    joinTimeoutMs: 90_000,
    leaveTimeoutMs: 90_000,
    meetingEndTimeoutMs: 4_000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      case '--mode':
        parsed.mode = argv[++i] || '';
        break;
      case '--provider':
        parsed.provider = argv[++i] || '';
        break;
      case '--artifact-root':
        parsed.artifactRoot = argv[++i] || '';
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      case '--manual':
        parsed.executionStyle = 'manual';
        break;
      case '--auto':
        parsed.executionStyle = 'auto';
        break;
      case '--join-timeout-ms':
        parsed.joinTimeoutMs = Number(argv[++i] || '0');
        break;
      case '--leave-timeout-ms':
        parsed.leaveTimeoutMs = Number(argv[++i] || '0');
        break;
      case '--meeting-end-timeout-ms':
        parsed.meetingEndTimeoutMs = Number(argv[++i] || '0');
        break;
      default:
        throw new Error(`Unknown argument ${arg}. Run with --help for usage.`);
    }
  }

  if (!['web', 'native', 'all'].includes(parsed.mode)) {
    throw new Error(`Invalid --mode '${parsed.mode}'. Expected web|native|all.`);
  }
  if (parsed.joinTimeoutMs <= 0 || parsed.leaveTimeoutMs <= 0 || parsed.meetingEndTimeoutMs <= 0) {
    throw new Error('Timeout arguments must be positive integers.');
  }

  return parsed;
}

function printManualPrompt(provider, mode, meetingUrl, options) {
  console.log('');
  console.log(`[manual] Provider: ${provider.platform} (${mode})`);
  console.log(`[manual] URL: ${meetingUrl}`);
  console.log(`[manual] Join window: ${Math.round(options.joinTimeoutMs / 1000)}s`);
  console.log(`[manual] Leave window: ${Math.round(options.leaveTimeoutMs / 1000)}s`);
  console.log('[manual] Action required: join the meeting now, then leave once joined.');
}

function printHelp() {
  console.log(`Usage: node scripts/e2e/run-provider-detection-matrix.mjs [options]

Options:
  --help, -h                  Show help
  --mode <web|native|all>     Select mode (default: all)
  --provider <id>             Single provider id from contract
  --artifact-root <path>      Override artifact output root
  --manual                    Manual join/leave flow (default)
  --auto                      External automation flow gate
  --dry-run                   Validate env/contract and write scaffold summary
  --join-timeout-ms <ms>      Wait timeout for meeting_started (default: 90000)
  --leave-timeout-ms <ms>     Wait timeout for meeting_ended (default: 90000)
  --meeting-end-timeout-ms <ms> Detector timeout for inferring end (default: 4000)
`);
}

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

function uniqueValues(values) {
  return Array.from(new Set(values));
}

function redactUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}
