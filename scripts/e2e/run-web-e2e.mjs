import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const shellEnvKeys = new Set(Object.keys(process.env));
const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const artifactRoot =
  process.env.E2E_ARTIFACT_DIR ||
  resolve(projectRoot, `artifacts/web/${new Date().toISOString().replace(/[:.]/g, '-')}`);

loadEnvFile(resolve(projectRoot, '.env'));
loadEnvFile(resolve(projectRoot, '.env.e2e'));

const forwardedArgs = process.argv.slice(2);

await runCommand('npm', ['run', 'build:ts'], {
  cwd: projectRoot,
  env: process.env,
});

// Resolve CDP WebSocket endpoint if Chrome is running with remote debugging
let cdpWsEndpoint = process.env.PLAYWRIGHT_CDP_ENDPOINT || '';
if (!cdpWsEndpoint) {
  try {
    const resp = await fetch('http://localhost:9222/json/version');
    const info = await resp.json();
    cdpWsEndpoint = info.webSocketDebuggerUrl || '';
    if (cdpWsEndpoint) {
      console.log(`[e2e] Detected Chrome CDP at ${cdpWsEndpoint}`);
    }
  } catch {
    // No CDP Chrome running — Playwright will launch its own browser
  }
}

await runCommand(
  'npx',
  ['playwright', 'test', 'test/e2e/web/providers.spec.ts', ...forwardedArgs],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      E2E_ARTIFACT_DIR: artifactRoot,
      GOOGLE_EMAIL: process.env.GOOGLE_EMAIL || process.env.GMAIL_EMAIL || '',
      GOOGLE_APP_PASSWORD: process.env.GOOGLE_APP_PASSWORD || process.env.GMAIL_APP_PASSWORD || '',
      ...(cdpWsEndpoint ? { PLAYWRIGHT_CDP_ENDPOINT: cdpWsEndpoint } : {}),
    },
  }
);

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

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

function runCommand(command, args, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      ...options,
      stdio: 'inherit',
    });

    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(
        new Error(
          `${command} ${args.join(' ')} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`
        )
      );
    });
    child.on('error', rejectPromise);
  });
}
