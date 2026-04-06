import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

export function createArtifactWriter({
  suite = 'native',
  scenarioName,
  artifactRoot,
  runId = new Date().toISOString().replace(/[:.]/g, '-'),
}) {
  if (!scenarioName) {
    throw new Error('createArtifactWriter requires scenarioName');
  }

  const root = resolve(
    artifactRoot || process.env.E2E_ARTIFACT_DIR || join(projectRoot, 'artifacts', suite, runId)
  );
  const scenarioDir = join(root, scenarioName);
  const screenshotDir = join(scenarioDir, 'screenshots');

  mkdirSync(scenarioDir, { recursive: true });
  mkdirSync(screenshotDir, { recursive: true });

  const stepsLogPath = join(scenarioDir, 'steps.ndjson');
  const errorsLogPath = join(scenarioDir, 'errors.log');

  return {
    root,
    scenarioDir,
    screenshotDir,
    stepsLogPath,
    errorsLogPath,
    appendNdjson(name, value) {
      appendFileSync(join(scenarioDir, name), `${JSON.stringify(value)}\n`, 'utf8');
    },
    writeJson(name, value) {
      writeFileSync(join(scenarioDir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    },
    writeText(name, value) {
      writeFileSync(join(scenarioDir, name), value, 'utf8');
    },
    logError(error) {
      const message = error instanceof Error ? error.stack || error.message : String(error);
      appendFileSync(errorsLogPath, `${message}\n`, 'utf8');
    },
    recordStep(entry) {
      appendFileSync(stepsLogPath, `${JSON.stringify(entry)}\n`, 'utf8');
    },
    async writeScreenshot(stepLabel, response) {
      const safeLabel = sanitizeFileComponent(stepLabel);
      const jsonName = `${safeLabel}.json`;
      this.writeJson(join('screenshots', jsonName), response);

      const base64 = extractBase64Image(response);
      if (!base64) {
        return null;
      }

      const pngName = `${safeLabel}.png`;
      const pngPath = join(screenshotDir, pngName);
      await writeFile(pngPath, Buffer.from(base64, 'base64'));
      return pngPath;
    },
  };
}

function sanitizeFileComponent(value) {
  return String(value || 'unnamed').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
}

function extractBase64Image(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    const match = value.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
    return match ? match[1] : null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractBase64Image(item);
      if (found) {
        return found;
      }
    }
    return null;
  }

  if (typeof value !== 'object') {
    return null;
  }

  for (const key of ['imageBase64', 'base64', 'data', 'image']) {
    if (typeof value[key] === 'string') {
      const direct = extractBase64Image(value[key]);
      if (direct) {
        return direct;
      }
      if (/^[A-Za-z0-9+/=\r\n]+$/.test(value[key])) {
        return value[key].replace(/\s+/g, '');
      }
    }
  }

  for (const nested of Object.values(value)) {
    const found = extractBase64Image(nested);
    if (found) {
      return found;
    }
  }

  return null;
}
