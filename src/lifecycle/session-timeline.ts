import type { MeetingSignal } from '../types.js';

export interface SessionTimelineState {
  session_id: string;
  started_at: string;
  ended_at?: string;
  last_seen_at: number;
}

function normalizeSessionSeed(
  signal: Pick<MeetingSignal, 'session_id' | 'service' | 'pid' | 'process' | 'timestamp'>
): string {
  const sessionId = signal.session_id.trim();
  if (sessionId) {
    return sessionId;
  }

  const service = signal.service.trim();
  const pid = signal.pid.trim();
  const process = signal.process.trim();

  if (service && pid) {
    return `${service}:${pid}`;
  }
  if (service && process) {
    return `${service}:${process}`;
  }
  if (service) {
    return `${service}:${signal.timestamp}`;
  }
  if (process && pid) {
    return `${process}:${pid}`;
  }
  if (process) {
    return `${process}:${signal.timestamp}`;
  }

  return signal.timestamp;
}

export function createSessionId(
  signal: Pick<MeetingSignal, 'session_id' | 'service' | 'pid' | 'process' | 'timestamp'>
): string {
  return normalizeSessionSeed(signal);
}

export function createSessionTimeline(
  signal: Pick<MeetingSignal, 'session_id' | 'service' | 'pid' | 'process' | 'timestamp'>,
  now = Date.now()
): SessionTimelineState {
  return {
    session_id: createSessionId(signal),
    started_at: signal.timestamp || new Date(now).toISOString(),
    last_seen_at: now,
  };
}

export function touchSessionTimeline(
  timeline: SessionTimelineState,
  now = Date.now()
): SessionTimelineState {
  return {
    ...timeline,
    last_seen_at: now,
  };
}

export function endSessionTimeline(
  timeline: SessionTimelineState,
  endedAt = new Date().toISOString()
): SessionTimelineState {
  return {
    ...timeline,
    ended_at: endedAt,
  };
}
