export type MeetingPlatform =
  | 'Microsoft Teams'
  | 'Zoom'
  | 'Google Meet'
  | 'Slack'
  | 'Cisco Webex'
  | 'Discord'
  | 'FaceTime'
  | 'Skype'
  | 'Whereby'
  | 'GoToMeeting'
  | 'BlueJeans'
  | 'Jitsi Meet'
  | '8x8'
  | 'RingCentral'
  | 'BigBlueButton'
  | 'Amazon Chime'
  | 'Google Hangouts'
  | 'Adobe Connect'
  | 'TeamViewer'
  | 'AnyDesk'
  | 'ClickMeeting'
  | 'Appear.in'
  | 'Unknown';

export interface MeetingSignal {
  event: 'meeting_signal';
  timestamp: string;
  service: string;
  verdict: 'requested' | 'allowed' | 'denied' | '';
  preflight?: boolean;
  process: string;
  pid: string;
  parent_pid: string;
  process_path: string;
  front_app: string;
  window_title: string;
  session_id: string;
  camera_active: boolean;
  mic_active?: boolean;
  chrome_url?: string;
}

export interface MeetingLifecycleEvent {
  event: 'meeting_started' | 'meeting_changed' | 'meeting_ended';
  timestamp: string;
  platform: MeetingPlatform;
  previous_platform?: MeetingPlatform;
  confidence: 'high' | 'medium' | 'low';
  reason: 'signal' | 'switch' | 'timeout' | 'stop';
  raw_signal?: MeetingSignal;
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

  /**
   * Time in milliseconds without meeting signals before inferring meeting end
   * @default 30000 (30 seconds)
   */
  meetingEndTimeoutMs?: number;

  /**
   * Emit "Unknown" platform lifecycle events when confidence is insufficient
   * @default false
   */
  emitUnknown?: boolean;

  /**
   * Include potentially sensitive fields (for example window title) in emitted signal payloads
   * @default false
   */
  includeSensitiveMetadata?: boolean;

  /**
   * Include the raw signal payload inside lifecycle events
   * @default false
   */
  includeRawSignalInLifecycle?: boolean;

  /**
   * Probe for already-active meetings when detector starts
   * @default true
   */
  startupProbe?: boolean;
}

export type MeetingEventCallback = (signal: MeetingSignal) => void;
export type ErrorEventCallback = (error: Error) => void;
export type MeetingLifecycleCallback = (event: MeetingLifecycleEvent) => void;
