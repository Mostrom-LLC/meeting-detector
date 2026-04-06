import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createArtifactWriter } from './lib/artifact-writer.mjs';
import { loadScenarioFromFile, runScenario, startDetectorHarness } from './native/scenario-runner.mjs';

const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const scenarioDir = resolve(projectRoot, 'test/e2e/native/scenarios');
const availableProviders = readdirSync(scenarioDir)
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.replace(/\.json$/, ''))
  .sort();

loadEnvFile(resolve(projectRoot, '.env'));
loadEnvFile(resolve(projectRoot, '.env.e2e'));
process.env.GOOGLE_EMAIL = process.env.GOOGLE_EMAIL || process.env.GMAIL_EMAIL || '';
process.env.GOOGLE_APP_PASSWORD = process.env.GOOGLE_APP_PASSWORD || process.env.GMAIL_APP_PASSWORD || '';

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

  const selectedProviders = options.provider ? [options.provider] : availableProviders;
  const scenarioPaths = options.scenario
    ? [resolve(projectRoot, options.scenario)]
    : selectedProviders.map((provider) => resolve(scenarioDir, `${provider}.json`));

  for (const scenarioPath of scenarioPaths) {
    if (!existsSync(scenarioPath)) {
      throw new Error(
        `Scenario file not found: ${scenarioPath}. Use one of: ${availableProviders.join(', ')}`
      );
    }
  }

  if (!options.dryRun && !options.confirmLive && process.env.E2E_NATIVE_CONFIRM !== '1') {
    throw new Error(
      'Refusing to start live native automation without confirmation. Re-run with `--confirm-live`, set `E2E_NATIVE_CONFIRM=1`, or use `--dry-run`.'
    );
  }

  let client = null;
  let driver = null;
  let createNativeMcpClient;
  let NativeMcpDriver;

  if (!options.dryRun) {
    ({ createNativeMcpClient } = await import('./native/mcp-client.mjs'));
    ({ NativeMcpDriver } = await import('./native/mcp-driver.mjs'));
    client = await createNativeMcpClient();
  }

  const runResults = [];
  let artifactRoot = options.artifactRoot;

  try {
    for (const scenarioPath of scenarioPaths) {
      const { scenario } = await loadScenarioFromFile(scenarioPath);
      const artifactWriter = createArtifactWriter({
        suite: 'native',
        scenarioName: scenario.provider,
        artifactRoot,
      });
      artifactRoot = artifactWriter.root;

      const detectorHarness = options.dryRun
        ? { events: [], waitFor: async () => null, stop: async () => {} }
        : await startDetectorHarness({ scenarioName: scenario.provider, artifactWriter });

      if (!options.dryRun) {
        driver = new NativeMcpDriver(client, { defaultAppName: scenario.app_name });
      }

      try {
        const summary = await runScenario({
          scenario,
          scenarioPath,
          driver,
          detectorHarness,
          artifactWriter,
          dryRun: options.dryRun,
        });
        runResults.push({
          provider: scenario.provider,
          ok: true,
          summaryPath: join(artifactWriter.scenarioDir, 'summary.json'),
        });
        console.log(`${scenario.provider}: ok`);
      } finally {
        await detectorHarness.stop();
      }
    }

    const suiteSummary = {
      dryRun: options.dryRun,
      artifactRoot: artifactRoot || null,
      results: runResults,
    };
    if (artifactRoot) {
      const suiteWriter = createArtifactWriter({
        suite: 'native',
        scenarioName: '_suite',
        artifactRoot,
      });
      suiteWriter.writeJson('summary.json', suiteSummary);
    }
  } finally {
    if (client) {
      await client.close();
    }
  }
}

function parseArgs(argv) {
  const parsed = {
    help: false,
    provider: '',
    scenario: '',
    artifactRoot: '',
    dryRun: false,
    confirmLive: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    switch (value) {
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      case '--provider':
        parsed.provider = argv[++index] || '';
        break;
      case '--scenario':
        parsed.scenario = argv[++index] || '';
        break;
      case '--artifact-root':
        parsed.artifactRoot = argv[++index] || '';
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      case '--confirm-live':
        parsed.confirmLive = true;
        break;
      default:
        throw new Error(`Unknown argument ${value}. Run with --help for usage.`);
    }
  }

  if (parsed.provider && parsed.scenario) {
    throw new Error('Use either --provider or --scenario, not both.');
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/e2e/run-native-mcp-e2e.mjs [options]\n\nOptions:\n  --help, -h           Show this help text\n  --provider <name>    Run a single provider scenario (${availableProviders.join(', ')})\n  --scenario <path>    Run an explicit scenario file path\n  --artifact-root <p>  Override artifact output root\n  --dry-run            Validate scenarios and write artifacts without launching apps or MCP\n  --confirm-live       Allow live native automation for this invocation\n\nSafety:\n  Live automation is blocked unless --confirm-live is supplied or E2E_NATIVE_CONFIRM=1.\n\nExamples:\n  node scripts/e2e/run-native-mcp-e2e.mjs --dry-run --provider teams-native\n  E2E_NATIVE_CONFIRM=1 node scripts/e2e/run-native-mcp-e2e.mjs --provider zoom-native\n`);
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
