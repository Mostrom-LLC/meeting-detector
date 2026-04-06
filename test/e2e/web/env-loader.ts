import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Load a .env file into process.env. Does not override existing values.
 */
export function loadEnvFile(filePath: string): void {
  let content: string;
  try {
    content = readFileSync(resolve(filePath), 'utf8');
  } catch {
    return; // File not found — skip silently
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
