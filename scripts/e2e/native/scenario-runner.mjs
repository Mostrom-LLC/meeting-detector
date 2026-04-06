import { appendFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForOtpCode } from '../../tools/otp-client.mjs';
import { createArtifactWriter } from '../lib/artifact-writer.mjs';

const projectRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

export async function loadScenarioFromFile(filePath) {
  const absolutePath = resolve(filePath);
  const raw = await readFile(absolutePath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse scenario JSON at ${absolutePath}: ${error.message}`);
  }

  validateScenario(parsed, absolutePath);
  return {
    scenarioPath: absolutePath,
    scenario: expandEnvironment(parsed, absolutePath),
  };
}

export async function startDetectorHarness({ scenarioName, artifactWriter, meetingEndTimeoutMs = 4000 }) {
  let detectorModule;
  try {
    detectorModule = await import('../../../dist/detector.js');
  } catch (error) {
    throw new Error('Missing dist/detector.js. Run `npm run build:ts` before native E2E execution.', {
      cause: error,
    });
  }

  const { MeetingDetector } = detectorModule;
  const detector = new MeetingDetector({
    startupProbe: false,
    meetingEndTimeoutMs,
    includeRawSignalInLifecycle: true,
  });
  const events = [];
  const waiters = new Set();
  const eventLogPath = resolve(artifactWriter.scenarioDir, 'events.ndjson');

  const onLifecycle = (event) => {
    events.push(event);
    appendFileSync(eventLogPath, `${JSON.stringify(event)}\n`, 'utf8');
    for (const waiter of Array.from(waiters)) {
      if (waiter.eventName !== event.event || !waiter.predicate(event)) {
        continue;
      }
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      waiter.resolve(event);
    }
  };

  const onError = (error) => {
    artifactWriter.logError(error);
    for (const waiter of Array.from(waiters)) {
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      waiter.reject(error);
    }
  };

  detector.on('meeting_lifecycle', onLifecycle);
  detector.on('error', onError);
  detector.start();

  return {
    events,
    waitFor(eventName, timeoutMs = 60000, predicate = () => true) {
      const existing = events.find((event) => event.event === eventName && predicate(event));
      if (existing) {
        return Promise.resolve(existing);
      }
      return new Promise((resolvePromise, rejectPromise) => {
        const timer = setTimeout(() => {
          waiters.delete(waiter);
          rejectPromise(
            new Error(
              `Timed out after ${timeoutMs}ms waiting for ${eventName} in ${scenarioName}. Observed events: ${formatObservedEvents(events)}`
            )
          );
        }, timeoutMs);
        timer.unref?.();
        const waiter = { eventName, predicate, resolve: resolvePromise, reject: rejectPromise, timer };
        waiters.add(waiter);
      });
    },
    async stop() {
      for (const waiter of Array.from(waiters)) {
        clearTimeout(waiter.timer);
        waiters.delete(waiter);
        waiter.reject(new Error(`Detector harness stopped before ${waiter.eventName} arrived for ${scenarioName}.`));
      }
      detector.off('meeting_lifecycle', onLifecycle);
      detector.off('error', onError);
      detector.stop();
    },
  };
}

export async function runScenario({
  scenario,
  scenarioPath,
  driver,
  detectorHarness,
  artifactWriter = createArtifactWriter({ scenarioName: scenario.provider }),
  dryRun = false,
}) {
  const startedAt = new Date().toISOString();
  const stepResults = [];
  let lastStartedEvent = null;

  artifactWriter.writeJson('scenario.json', scenario);
  artifactWriter.writeJson('run-context.json', {
    scenarioPath,
    provider: scenario.provider,
    platform: scenario.platform,
    app_name: scenario.app_name,
    dryRun,
    startedAt,
  });

  for (let index = 0; index < scenario.steps.length; index += 1) {
    const step = scenario.steps[index];
    const stepLabel = `step-${String(index + 1).padStart(2, '0')}-${step.name || step.action}`;
    const entry = {
      index,
      stepLabel,
      action: step.action,
      startedAt: new Date().toISOString(),
      optional: Boolean(step.optional),
    };

    try {
      const result = await executeStep({
        step,
        scenario,
        driver,
        detectorHarness,
        dryRun,
        lastStartedEvent,
      });
      if (step.action === 'assert_event' && result?.event?.event === 'meeting_started') {
        lastStartedEvent = result.event;
      }
      entry.status = step.optional && result?.skipped ? 'skipped' : 'passed';
      entry.result = result;
      stepResults.push(entry);
      artifactWriter.recordStep(entry);
      await captureStepScreenshot({ artifactWriter, driver, scenario, stepLabel, error: null, optional: Boolean(step.optional) });
    } catch (error) {
      entry.status = step.optional ? 'skipped' : 'failed';
      entry.error = serializeError(error);
      stepResults.push(entry);
      artifactWriter.recordStep(entry);
      artifactWriter.logError(error);
      await captureStepScreenshot({ artifactWriter, driver, scenario, stepLabel: `${stepLabel}-failure`, error, optional: Boolean(step.optional) });
      if (!step.optional) {
        throw new Error(`Scenario ${scenario.provider} failed at ${stepLabel}: ${error.message}`, { cause: error });
      }
    }
  }

  const finishedAt = new Date().toISOString();
  const summary = {
    provider: scenario.provider,
    platform: scenario.platform,
    scenarioPath,
    dryRun,
    startedAt,
    finishedAt,
    stepCount: scenario.steps.length,
    eventsObserved: detectorHarness?.events ?? [],
    steps: stepResults,
  };
  artifactWriter.writeJson('summary.json', summary);
  return summary;
}

async function executeStep({ step, scenario, driver, detectorHarness, dryRun, lastStartedEvent }) {
  const attempts = Math.max(1, Number(step.retry?.attempts || 1));
  const delayMs = Math.max(0, Number(step.retry?.delay_ms || 0));
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await dispatchStep({ step, scenario, driver, detectorHarness, dryRun, lastStartedEvent });
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) {
        break;
      }
      await sleep(delayMs);
    }
  }

  throw lastError;
}

async function dispatchStep({ step, scenario, driver, detectorHarness, dryRun, lastStartedEvent }) {
  const args = step.args || {};
  if (dryRun) {
    if (step.action === 'assert_event') {
      return { dryRun: true, skipped: true, reason: 'assert_event skipped during dry-run' };
    }
    return { dryRun: true, action: step.action, args };
  }

  switch (step.action) {
    case 'launch_app':
      return (await driver.launchApp(args.app_name || scenario.app_name, args.args || [])).data;
    case 'focus_window':
      return (
        await driver.focusWindow({
          app_name: args.app_name || scenario.app_name,
          window_id: args.window_id,
          pid: args.pid,
        })
      ).data;
    case 'click_text':
      return (
        await driver.clickText(args.text, {
          appName: args.app_name || scenario.app_name,
          timeoutMs: args.timeout_ms,
          pollMs: args.poll_ms,
        })
      ).data;
    case 'type_text':
      return (await driver.typeText(args.text)).data;
    case 'press_key':
      return (await driver.pressKey(args.key, args.modifiers || [])).data;
    case 'wait':
      return (await driver.wait(Number(args.duration_ms || 0))).data;
    case 'take_screenshot':
      return (await driver.takeScreenshot(args.app_name || scenario.app_name)).data;
    case 'maybe_fill_otp': {
      const code = await waitForOtpCode({
        path: args.path,
        timeoutMs: args.timeout_ms,
        pollMs: args.poll_ms,
        minMtimeMs: Date.now(),
      });
      await driver.typeText(code);
      if (args.submit_key !== false) {
        await driver.pressKey(args.submit_key || 'return', args.modifiers || []);
      }
      return { filled: true, codeLength: code.length };
    }
    case 'assert_event': {
      if (!detectorHarness) {
        throw new Error('assert_event requires a detectorHarness instance.');
      }
      const expectedPlatform = args.platform || scenario.platform;
      const event = await detectorHarness.waitFor(
        args.event,
        Number(args.timeout_ms || 60000),
        (candidate) => !expectedPlatform || candidate.platform === expectedPlatform
      );
      if (args.event === 'meeting_started' && !event.started_at) {
        throw new Error(`meeting_started for ${expectedPlatform} is missing started_at.`);
      }
      if (args.event === 'meeting_ended') {
        if (!event.ended_at) {
          throw new Error(`meeting_ended for ${expectedPlatform} is missing ended_at.`);
        }
        if (lastStartedEvent && event.started_at !== lastStartedEvent.started_at) {
          throw new Error(
            `meeting_ended started_at ${event.started_at} did not match prior meeting_started ${lastStartedEvent.started_at}.`
          );
        }
      }
      return { event };
    }
    default:
      throw new Error(`Unsupported scenario action ${JSON.stringify(step.action)} in ${scenario.provider}.`);
  }
}

function validateScenario(scenario, filePath) {
  if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) {
    throw new Error(`Scenario at ${filePath} must be a JSON object.`);
  }
  if (typeof scenario.provider !== 'string' || !scenario.provider) {
    throw new Error(`Scenario at ${filePath} is missing a non-empty provider string.`);
  }
  if (typeof scenario.platform !== 'string' || !scenario.platform) {
    throw new Error(`Scenario at ${filePath} is missing a non-empty platform string.`);
  }
  if (typeof scenario.app_name !== 'string' || !scenario.app_name) {
    throw new Error(`Scenario at ${filePath} is missing a non-empty app_name string.`);
  }
  if (!Array.isArray(scenario.steps) || scenario.steps.length === 0) {
    throw new Error(`Scenario at ${filePath} must include a non-empty steps array.`);
  }
  for (const [index, step] of scenario.steps.entries()) {
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      throw new Error(`Step ${index + 1} in ${filePath} must be an object.`);
    }
    if (typeof step.action !== 'string' || !step.action) {
      throw new Error(`Step ${index + 1} in ${filePath} is missing a non-empty action string.`);
    }
    if (step.args != null && (typeof step.args !== 'object' || Array.isArray(step.args))) {
      throw new Error(`Step ${index + 1} in ${filePath} must use an object for args.`);
    }
  }
}

function expandEnvironment(value, filePath) {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key) => {
      const resolved = process.env[key];
      if (resolved == null || resolved === '') {
        throw new Error(
          `Missing environment variable ${key} required by ${filePath}. Set it in .env.e2e or export it before running the native scenario.`
        );
      }
      return resolved;
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => expandEnvironment(item, filePath));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, expandEnvironment(nested, filePath)])
    );
  }
  return value;
}

async function captureStepScreenshot({ artifactWriter, driver, scenario, stepLabel, optional }) {
  if (!driver || !artifactWriter) {
    return;
  }
  try {
    const screenshot = await driver.takeScreenshot(scenario.app_name);
    await artifactWriter.writeScreenshot(stepLabel, screenshot.raw || screenshot.data || screenshot);
  } catch (error) {
    if (!optional) {
      artifactWriter.logError(
        new Error(`Screenshot capture failed for ${stepLabel}: ${error.message}`, { cause: error })
      );
    }
  }
}

function serializeError(error) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error) };
}

function formatObservedEvents(events) {
  if (!events.length) {
    return 'none';
  }
  return events.map((event) => `${event.event}:${event.platform}`).join(', ');
}

async function sleep(ms) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
