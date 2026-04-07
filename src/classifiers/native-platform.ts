import type { MeetingPlatform } from '../types.js';
import { classifyBrowserMeeting } from './browser-platform.js';

export interface NativeMeetingEvidence {
  process: string;
  windowTitle: string;
  micActive: boolean;
  cameraActive: boolean;
}

export interface NativeAppContext {
  frontApp?: string;
  process?: string;
  windowTitle?: string;
  chromeUrl?: string;
}

export interface NativeStartupProbeTarget {
  process: string;
  platform: MeetingPlatform;
}

const PLATFORM_PATTERNS: Array<{ platform: MeetingPlatform; patterns: string[] }> = [
  { platform: 'Microsoft Teams', patterns: ['microsoft teams', 'msteams'] },
  { platform: 'Zoom', patterns: ['zoom.us', 'zoom'] },
  { platform: 'Cisco Webex', patterns: ['cisco webex', 'webex', 'webexmta'] },
  { platform: 'Slack', patterns: ['slack'] },
  { platform: 'Google Meet', patterns: ['google meet', 'meet.google.com'] },
  { platform: 'Skype', patterns: ['skype'] },
  { platform: 'Discord', patterns: ['discord'] },
  { platform: 'FaceTime', patterns: ['facetime'] },
  { platform: 'GoToMeeting', patterns: ['gotomeeting', 'goto meeting'] },
  { platform: 'BlueJeans', patterns: ['bluejeans', 'blue jeans'] },
  { platform: 'Jitsi Meet', patterns: ['jitsi'] },
  { platform: 'Whereby', patterns: ['whereby'] },
  { platform: '8x8', patterns: ['8x8'] },
  { platform: 'RingCentral', patterns: ['ringcentral', 'ring central'] },
  { platform: 'BigBlueButton', patterns: ['bigbluebutton', 'big blue button'] },
  { platform: 'Amazon Chime', patterns: ['amazon chime', 'chime'] },
  { platform: 'Google Hangouts', patterns: ['google hangouts', 'hangouts'] },
  { platform: 'Adobe Connect', patterns: ['adobe connect'] },
  { platform: 'TeamViewer', patterns: ['teamviewer'] },
  { platform: 'AnyDesk', patterns: ['anydesk'] },
  { platform: 'ClickMeeting', patterns: ['clickmeeting'] },
  { platform: 'Appear.in', patterns: ['appear.in'] },
];

export const NATIVE_STARTUP_PROBE_TARGETS: NativeStartupProbeTarget[] = [
  { process: 'Microsoft Teams', platform: 'Microsoft Teams' },
  { process: 'zoom.us', platform: 'Zoom' },
  { process: 'Webex', platform: 'Cisco Webex' },
  { process: 'Slack', platform: 'Slack' },
  { process: 'Discord', platform: 'Discord' },
  { process: 'FaceTime', platform: 'FaceTime' },
];

function includesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}

function classifyTextPlatform(value: string): MeetingPlatform | null {
  for (const entry of PLATFORM_PATTERNS) {
    if (includesAny(value, entry.patterns)) {
      return entry.platform;
    }
  }

  return null;
}

function hasGoogleMeetCode(title: string): boolean {
  return title.includes('meet.google.com') || /[a-z]{3}-[a-z]{4}-[a-z]{3}/.test(title);
}

function classifyBrowserWrappedPlatform(urlInput: string): MeetingPlatform | null {
  const url = (urlInput || '').trim().toLowerCase();
  if (!url) {
    return null;
  }

  if (url.includes('meet.jit.si') || url.includes('jitsi')) {
    return 'Jitsi Meet';
  }
  if (url.includes('whereby.com')) {
    return 'Whereby';
  }
  if (url.includes('bluejeans.com')) {
    return 'BlueJeans';
  }
  if (url.includes('ringcentral.com')) {
    return 'RingCentral';
  }
  if (url.includes('chime.aws')) {
    return 'Amazon Chime';
  }
  if (url.includes('goto.com') || url.includes('gotomeeting.com')) {
    return 'GoToMeeting';
  }

  return null;
}

export function classifyNativeProcessCommand(command: string): MeetingPlatform | null {
  const basename = (command.split('/').pop() || command).trim().toLowerCase();
  if (!basename) {
    return null;
  }

  return classifyTextPlatform(basename);
}

export function classifyPlatformFromNativeApp(input: NativeAppContext): MeetingPlatform {
  const browserPlatform = classifyBrowserMeeting(input.chromeUrl || '', input.windowTitle || '');
  if (browserPlatform) {
    return browserPlatform;
  }

  const wrappedBrowserPlatform = classifyBrowserWrappedPlatform(input.chromeUrl || '');
  if (wrappedBrowserPlatform) {
    return wrappedBrowserPlatform;
  }

  const process = (input.process || '').toLowerCase();
  const frontApp = (input.frontApp || '').toLowerCase();
  const title = (input.windowTitle || '').toLowerCase();

  const processPlatform = classifyTextPlatform(process);
  if (processPlatform) {
    return processPlatform;
  }

  if (process.includes('chrome') && hasGoogleMeetCode(title)) {
    return 'Google Meet';
  }

  const frontPlatform = classifyTextPlatform(frontApp);
  if (frontPlatform) {
    return frontPlatform;
  }

  if (frontApp.includes('chrome') && hasGoogleMeetCode(title)) {
    return 'Google Meet';
  }

  // Browser window-title fallback: when the active app is a Chrome/Safari/
  // Edge/Firefox window, the window title typically embeds the active tab's
  // page name, e.g.:
  //   "Calendar | Calendar | Microsoft Teams - Google Chrome - kaise (Main)"
  //   "Zoom Meeting - Google Chrome"
  //   "Webex - Google Chrome"
  // Use the title to detect web-based meeting platforms even when neither
  // chromeUrl nor a meeting-room URL pattern is available. Restricted to
  // browser front apps so we don't false-positive on native apps that
  // happen to have a platform name in their window title.
  const isBrowserFrontApp =
    frontApp.includes('chrome') ||
    frontApp.includes('safari') ||
    frontApp.includes('firefox') ||
    frontApp.includes('microsoft edge');
  if (isBrowserFrontApp) {
    const titlePlatform = classifyTextPlatform(title);
    if (titlePlatform) {
      return titlePlatform;
    }
  }

  return 'Unknown';
}

export function classifyNativeMeeting(evidence: NativeMeetingEvidence): MeetingPlatform | null {
  if (!evidence.micActive) {
    return null;
  }

  const platform = classifyPlatformFromNativeApp({
    process: evidence.process,
    frontApp: evidence.process,
    windowTitle: evidence.windowTitle,
  });
  if (platform === 'Unknown') {
    return null;
  }

  const title = evidence.windowTitle.trim().toLowerCase();
  if (!title) {
    // Without a window title we cannot distinguish an idle app from an active
    // meeting.  Only allow platforms that are unambiguous when untitled.
    // Teams, Zoom, Slack, and Webex all run background processes that trigger
    // TCC signals even when idle — require a title for those.
    const requiresTitleWhenEmpty = new Set([
      'Microsoft Teams',
      'Zoom',
      'Slack',
      'Cisco Webex',
    ]);
    return requiresTitleWhenEmpty.has(platform) ? null : platform;
  }

  switch (platform) {
    case 'Microsoft Teams':
      if (title === 'microsoft teams' || title.startsWith('chat')) {
        return null;
      }
      return platform;
    case 'Zoom':
      if (title === 'zoom workplace' || title === 'zoom') {
        return null;
      }
      return platform;
    case 'Slack':
      return title.includes('huddle') ? platform : null;
    case 'Cisco Webex':
      if (title === 'webex') {
        return null;
      }
      return title.includes('meeting') || title.includes('call') || title.includes('webex')
        ? platform
        : null;
    default:
      return platform;
  }
}
