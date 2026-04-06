const PROVIDER_FIXTURES = {
  'Google Meet': {
    process: 'Google Chrome Helper',
    front_app: 'Google Chrome',
    window_title: 'Meet',
    chrome_url: 'https://meet.google.com/abc-defg-hij',
    verdict: 'requested',
    preflight: false,
    camera_active: true,
    session_id: 'google-meet-session-1',
    pid: '1001',
    parent_pid: '1',
    process_path: '/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper',
  },
  Zoom: {
    process: 'zoom.us',
    front_app: 'zoom.us',
    window_title: 'Zoom Meeting',
    verdict: 'allowed',
    preflight: false,
    camera_active: true,
    session_id: 'zoom-session-1',
    pid: '1002',
    parent_pid: '1',
    process_path: '/Applications/zoom.us.app/Contents/MacOS/zoom.us',
  },
  'Microsoft Teams': {
    process: 'MSTeams',
    front_app: 'Microsoft Teams',
    window_title: 'Meet | Daily Sync | Microsoft Teams',
    verdict: 'allowed',
    preflight: false,
    camera_active: true,
    session_id: 'teams-session-1',
    pid: '1003',
    parent_pid: '1',
    process_path: '/Applications/Microsoft Teams.app/Contents/MacOS/MSTeams',
  },
  Slack: {
    process: 'Slack',
    front_app: 'Slack',
    window_title: 'Huddle in #engineering',
    verdict: 'allowed',
    preflight: false,
    camera_active: true,
    session_id: 'slack-session-1',
    pid: '1004',
    parent_pid: '1',
    process_path: '/Applications/Slack.app/Contents/MacOS/Slack',
  },
  'Cisco Webex': {
    process: 'Webex',
    front_app: 'Webex',
    window_title: 'Webex Meeting',
    verdict: 'allowed',
    preflight: false,
    camera_active: true,
    session_id: 'webex-session-1',
    pid: '1005',
    parent_pid: '1',
    process_path: '/Applications/Webex.app/Contents/MacOS/Webex',
  },
};

export const PROVIDER_MATRIX = Object.freeze([
  'Google Meet',
  'Zoom',
  'Microsoft Teams',
  'Slack',
  'Cisco Webex',
]);

export function createProviderSignal(provider, overrides = {}) {
  const fixture = PROVIDER_FIXTURES[provider];
  if (!fixture) {
    throw new Error(`Unsupported provider fixture: ${provider}`);
  }

  return {
    event: 'meeting_signal',
    timestamp: new Date().toISOString(),
    service: provider,
    ...fixture,
    ...overrides,
  };
}
