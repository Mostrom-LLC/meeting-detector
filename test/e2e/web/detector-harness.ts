import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MeetingDetector } from '../../../dist/detector.js';
import type { MeetingDetectorOptions, MeetingLifecycleEvent } from '../../../dist/types.js';

type LifecycleEventName = MeetingLifecycleEvent['event'];
type LifecyclePredicate = (event: MeetingLifecycleEvent) => boolean;

interface StartDetectorHarnessOptions {
  artifactRoot?: string;
  detectorOptions?: MeetingDetectorOptions;
  meetingEndTimeoutMs?: number;
}

interface PendingWaiter {
  eventName: LifecycleEventName;
  predicate: LifecyclePredicate;
  resolve: (event: MeetingLifecycleEvent) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface DetectorHarness {
  artifactDir: string;
  eventLogPath: string;
  events: readonly MeetingLifecycleEvent[];
  waitFor(
    eventName: LifecycleEventName,
    timeoutMs?: number,
    predicate?: LifecyclePredicate
  ): Promise<MeetingLifecycleEvent>;
  stop(): Promise<void>;
}

export async function startDetectorHarness(
  scenarioName: string,
  options: StartDetectorHarnessOptions = {}
): Promise<DetectorHarness> {
  const artifactDir = prepareArtifactDir(options.artifactRoot, scenarioName);
  const eventLogPath = join(artifactDir, 'events.ndjson');
  const errorLogPath = join(artifactDir, 'errors.log');
  const events: MeetingLifecycleEvent[] = [];
  const pendingWaiters = new Set<PendingWaiter>();
  const detector = new MeetingDetector({
    startupProbe: false,
    meetingEndTimeoutMs: options.meetingEndTimeoutMs ?? 4_000,
    includeRawSignalInLifecycle: true,
    ...options.detectorOptions,
  });

  const onLifecycle = (event: MeetingLifecycleEvent) => {
    events.push(event);
    appendFileSync(eventLogPath, `${JSON.stringify(event)}\n`, 'utf8');

    for (const waiter of Array.from(pendingWaiters)) {
      if (waiter.eventName !== event.event || !waiter.predicate(event)) {
        continue;
      }
      clearTimeout(waiter.timer);
      pendingWaiters.delete(waiter);
      waiter.resolve(event);
    }
  };

  const onError = (error: Error) => {
    appendFileSync(errorLogPath, `${error.stack || error.message}\n`, 'utf8');
    rejectPendingWaiters(pendingWaiters, error);
  };

  detector.on('meeting_lifecycle', onLifecycle);
  detector.on('error', onError);
  detector.start();

  return {
    artifactDir,
    eventLogPath,
    get events() {
      return events;
    },
    async waitFor(
      eventName: LifecycleEventName,
      timeoutMs = 60_000,
      predicate: LifecyclePredicate = () => true
    ): Promise<MeetingLifecycleEvent> {
      const existing = events.find((event) => event.event === eventName && predicate(event));
      if (existing) {
        return existing;
      }

      return new Promise<MeetingLifecycleEvent>((resolveWait, rejectWait) => {
        const timer = setTimeout(() => {
          pendingWaiters.delete(waiter);
          rejectWait(
            new Error(
              `Timed out after ${timeoutMs}ms waiting for ${eventName} in ${scenarioName}. ` +
                `Observed events: ${formatObservedEvents(events)}`
            )
          );
        }, timeoutMs);
        timer.unref?.();

        const waiter: PendingWaiter = {
          eventName,
          predicate,
          resolve: resolveWait,
          reject: rejectWait,
          timer,
        };

        pendingWaiters.add(waiter);
      });
    },
    async stop(): Promise<void> {
      rejectPendingWaiters(
        pendingWaiters,
        new Error(`Detector harness stopped before the awaited lifecycle event arrived for ${scenarioName}.`)
      );
      detector.off('meeting_lifecycle', onLifecycle);
      detector.off('error', onError);
      detector.stop();
      writeFileSync(
        join(artifactDir, 'summary.json'),
        JSON.stringify(
          {
            scenarioName,
            eventCount: events.length,
            events,
          },
          null,
          2
        ),
        'utf8'
      );
    },
  };
}

function prepareArtifactDir(artifactRoot: string | undefined, scenarioName: string): string {
  const root = resolve(
    artifactRoot || process.env.E2E_ARTIFACT_DIR || `artifacts/web/${new Date().toISOString().replace(/[:.]/g, '-')}`
  );
  const artifactDir = join(root, scenarioName);
  mkdirSync(artifactDir, { recursive: true });
  return artifactDir;
}

function rejectPendingWaiters(waiters: Set<PendingWaiter>, error: Error): void {
  for (const waiter of Array.from(waiters)) {
    clearTimeout(waiter.timer);
    waiters.delete(waiter);
    waiter.reject(error);
  }
}

function formatObservedEvents(events: readonly MeetingLifecycleEvent[]): string {
  if (!events.length) {
    return 'none';
  }

  return events.map((event) => `${event.event}:${event.platform}`).join(', ');
}
