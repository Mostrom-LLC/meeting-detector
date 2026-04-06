import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));

export function getDefaultOtpPath() {
  return resolve(process.env.OTP_CODE_FILE || `${projectRoot}/.otp-codes/latest.txt`);
}

export async function waitForOtpCode({
  path = getDefaultOtpPath(),
  timeoutMs = 120000,
  pollMs = 2000,
  minMtimeMs = Date.now(),
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid timeoutMs ${timeoutMs}. Provide a positive number of milliseconds.`);
  }
  if (!Number.isFinite(pollMs) || pollMs <= 0) {
    throw new Error(`Invalid pollMs ${pollMs}. Provide a positive number of milliseconds.`);
  }

  const startedAt = Date.now();
  const resolvedPath = resolve(path);
  let sawFile = false;
  let sawFreshTimestamp = false;
  let sawInvalidCode = false;
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const info = await stat(resolvedPath);
      sawFile = true;
      if (info.mtimeMs < minMtimeMs) {
        lastError = new Error(
          `OTP file ${resolvedPath} is older than the requested freshness threshold (${new Date(minMtimeMs).toISOString()}).`
        );
      } else {
        sawFreshTimestamp = true;
        const text = await readFile(resolvedPath, 'utf8');
        const code = text.split(/\r?\n/, 1)[0].trim();
        if (/^\d{6}$/.test(code)) {
          return code;
        }
        sawInvalidCode = true;
        lastError = new Error(
          `OTP file ${resolvedPath} does not contain a fresh 6-digit code on the first line.`
        );
      }
    } catch (error) {
      lastError = error;
    }

    await delay(pollMs);
  }

  if (!sawFile) {
    throw new Error(
      `OTP timeout after ${timeoutMs}ms: ${resolvedPath} was never created. Start the listener or set OTP_CODE_FILE.`
    );
  }
  if (!sawFreshTimestamp) {
    throw new Error(
      `OTP timeout after ${timeoutMs}ms: no fresh code appeared in ${resolvedPath}. Trigger a new OTP and ensure the listener is writing updates.`
    );
  }
  if (sawInvalidCode) {
    throw new Error(
      `OTP timeout after ${timeoutMs}ms: ${resolvedPath} updated but the first line never became a 6-digit code.`
    );
  }

  throw new Error(
    `OTP timeout after ${timeoutMs}ms: ${lastError instanceof Error ? lastError.message : 'unknown OTP polling failure'}`
  );
}

async function delay(ms) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  waitForOtpCode()
    .then((code) => {
      console.log(code);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
