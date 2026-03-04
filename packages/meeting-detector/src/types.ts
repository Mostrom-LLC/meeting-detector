export interface MeetingSignal {
  event: 'meeting_signal';
  timestamp: string;
  service: 'microphone' | 'camera' | '';
  verdict: 'requested' | 'allowed' | 'denied' | '';
  process: string;
  pid: string;
  parent_pid: string;
  process_path: string;
  front_app: string;
  window_title: string;
  session_id: string;
  camera_active: boolean;
}

export interface ProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface MeetingDetectorOptions {
  /**
   * Path to the meeting-detect.sh script
   * @default './meeting-detect.sh'
   */
  scriptPath?: string;

  /**
   * Enable debug logging
   * @default false
   */
  debug?: boolean;

  /**
   * Session deduplication window in milliseconds
   * Signals from the same session within this window will be ignored
   * @default 60000 (60 seconds)
   */
  sessionDeduplicationMs?: number;
}

export type MeetingEventCallback = (signal: MeetingSignal) => void;
export type ErrorEventCallback = (error: Error) => void;