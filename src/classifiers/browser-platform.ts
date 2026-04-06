import type { MeetingPlatform } from '../types.js';

export interface BrowserTabInfo {
  browser: string;
  title: string;
  url: string;
}

function parseBrowserUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isGoogleMeetMeetingUrl(url: string): boolean {
  return /meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:[/?#]|$)/.test(url);
}

function isZoomMeetingUrl(url: string): boolean {
  const parsed = parseBrowserUrl(url);
  if (!parsed) {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== 'zoom.us' && host !== 'app.zoom.us') {
    return false;
  }

  const path = parsed.pathname.toLowerCase().replace(/\/+$/, '');
  return (
    /^\/wc\/\d+\/(?:join|start)$/.test(path) ||
    /^\/wc\/join\/\d+$/.test(path) ||
    /^\/j\/\d+$/.test(path)
  );
}

function isTeamsMeetingUrl(url: string): boolean {
  const parsed = parseBrowserUrl(url);
  if (!parsed) {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== 'teams.live.com' && host !== 'teams.microsoft.com') {
    return false;
  }

  const path = parsed.pathname.toLowerCase().replace(/\/+$/, '');
  if (path === '/light-meetings' || path === '/light-meetings/launch') {
    return true;
  }
  if (path.startsWith('/l/meetup-join')) {
    return true;
  }
  if (path.startsWith('/meet')) {
    return true;
  }
  if (path === '/dl/launcher/launcher.html') {
    const launchUrl = decodeURIComponent(parsed.searchParams.get('url') || '').toLowerCase();
    return parsed.searchParams.get('type') === 'meetup-join' || launchUrl.includes('/l/meetup-join/');
  }
  if (path === '/v2') {
    return parsed.searchParams.get('meetingjoin') === 'true';
  }

  return false;
}

function isTeamsMeetingTitle(title: string): boolean {
  if (!title.includes('microsoft teams')) {
    return false;
  }

  if (title.includes('meeting with')) {
    return true;
  }

  const segments = title
    .split('|')
    .map((segment) => segment.trim())
    .filter(Boolean);

  return segments.length >= 3 && segments[0] === 'meet' && segments.at(-1) === 'microsoft teams';
}

function isSlackHuddleTab(url: string, title: string): boolean {
  const looksLikeSlackHuddleWindow =
    title.startsWith('slack - huddle preview') ||
    title.startsWith('huddle:');

  if (url === 'about:blank') {
    return looksLikeSlackHuddleWindow;
  }

  if (!url.includes('app.slack.com/')) {
    return false;
  }

  const hasExplicitHuddleRoute =
    /\/huddle(?:[/?#]|$)/.test(url) ||
    /[?&]huddle_thread=/.test(url);

  return (
    (url.includes('app.slack.com/client/') && title.includes('huddle')) ||
    hasExplicitHuddleRoute ||
    looksLikeSlackHuddleWindow
  );
}

function isWebexMeetingUrl(url: string): boolean {
  const parsed = parseBrowserUrl(url);
  if (!parsed) {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  if (!host.endsWith('.webex.com')) {
    return false;
  }

  const path = parsed.pathname.toLowerCase();
  return path.startsWith('/meet/') || path.startsWith('/join/');
}

export function classifyBrowserMeeting(urlInput: string, titleInput = ''): MeetingPlatform | null {
  const url = (urlInput || '').trim().toLowerCase();
  const title = (titleInput || '').trim().toLowerCase();

  if (!url) {
    return null;
  }

  if (isGoogleMeetMeetingUrl(url)) {
    return 'Google Meet';
  }

  if (isZoomMeetingUrl(url)) {
    return 'Zoom';
  }

  if (isTeamsMeetingUrl(url) || (url.includes('teams.live.com/v2/') && isTeamsMeetingTitle(title))) {
    return 'Microsoft Teams';
  }

  if (isSlackHuddleTab(url, title)) {
    return 'Slack';
  }

  if (isWebexMeetingUrl(url)) {
    return 'Cisco Webex';
  }

  return null;
}

export function classifyBrowserMeetingTab(tab: Pick<BrowserTabInfo, 'url' | 'title'>): MeetingPlatform | null {
  return classifyBrowserMeeting(tab.url, tab.title);
}
