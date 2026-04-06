export const PROVIDERS = Object.freeze([
  {
    id: 'google-meet',
    platform: 'Google Meet',
    modes: ['web'],
    webEnvKey: 'E2E_GOOGLE_MEET_URL',
  },
  {
    id: 'zoom',
    platform: 'Zoom',
    modes: ['web', 'native'],
    webEnvKey: 'E2E_ZOOM_WEB_URL',
    nativeEnvKey: 'E2E_ZOOM_NATIVE_URL',
  },
  {
    id: 'teams',
    platform: 'Microsoft Teams',
    modes: ['web', 'native'],
    webEnvKey: 'E2E_TEAMS_WEB_URL',
    nativeEnvKey: 'E2E_TEAMS_NATIVE_URL',
  },
  {
    id: 'slack-huddle',
    platform: 'Slack',
    modes: ['web', 'native'],
    webEnvKey: 'E2E_SLACK_HUDDLE_WEB_URL',
    nativeEnvKey: 'E2E_SLACK_HUDDLE_NATIVE_URL',
  },
  {
    id: 'webex',
    platform: 'Cisco Webex',
    modes: ['web', 'native'],
    webEnvKey: 'E2E_WEBEX_WEB_URL',
    nativeEnvKey: 'E2E_WEBEX_NATIVE_URL',
  },
]);

export function getProvidersForMode(mode = 'all') {
  if (mode === 'all') {
    return PROVIDERS;
  }

  return PROVIDERS.filter((provider) => provider.modes.includes(mode));
}

export function getProviderById(id) {
  return PROVIDERS.find((provider) => provider.id === id) || null;
}
