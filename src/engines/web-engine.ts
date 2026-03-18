/**
 * Web detector engine.
 * 
 * Responsible for detecting browser-based meeting platforms:
 * - Google Meet
 * - Zoom web
 * - Microsoft Teams web
 * - Slack web huddles
 * - Cisco Webex web
 * - Jitsi Meet
 */

import { EventEmitter } from 'node:events';
import type { MeetingPlatform } from '../types.js';
import type {
  WebMeetingCandidate,
  WebEvidence,
  CandidateCallback,
  WebEngineOptions,
  ConfidenceLevel,
} from './types.js';

/**
 * Browser tab input for testing/injection.
 */
export interface BrowserTabInput {
  browser: string;
  url: string;
  title: string;
  micActive: boolean;
  cameraActive: boolean;
  timestamp?: number;
}

/**
 * Internal browser meeting hint structure.
 */
interface BrowserMeetingHint {
  browser: string;
  platform: MeetingPlatform;
  title: string;
  url: string;
  seenAt: number;
  micActive: boolean;
  cameraActive: boolean;
}

/**
 * Web detector engine.
 */
export class WebDetectorEngine extends EventEmitter {
  private options: Required<WebEngineOptions>;
  private running = false;
  private callbacks: Set<CandidateCallback> = new Set();
  
  // Browser meeting hints by browser name
  private browserMeetingHints: Map<string, BrowserMeetingHint[]> = new Map();
  
  // Active meeting platform (for hint selection)
  private activeMeetingPlatform: MeetingPlatform | null = null;

  constructor(options: WebEngineOptions = {}) {
    super();
    this.options = {
      debug: options.debug ?? false,
      emitUnknown: options.emitUnknown ?? false,
      includeSensitiveMetadata: options.includeSensitiveMetadata ?? false,
      pollingIntervalMs: options.pollingIntervalMs ?? 2500,
      browserHintWindowMs: options.browserHintWindowMs ?? 10000,
    };
  }

  /**
   * Start the web detection engine.
   */
  start(): void {
    if (this.running) {
      throw new Error('Engine is already running');
    }
    this.running = true;
  }

  /**
   * Stop the web detection engine.
   */
  stop(): void {
    this.running = false;
    this.browserMeetingHints.clear();
  }

  /**
   * Check if the engine is running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Register a callback for web meeting candidates.
   */
  onCandidate(callback: CandidateCallback): void {
    this.callbacks.add(callback);
  }

  /**
   * Remove a candidate callback.
   */
  offCandidate(callback: CandidateCallback): void {
    this.callbacks.delete(callback);
  }

  /**
   * Set the active meeting platform (for hint selection).
   */
  setActiveMeetingPlatform(platform: MeetingPlatform | null): void {
    this.activeMeetingPlatform = platform;
  }

  /**
   * Get a browser meeting hint for a specific browser.
   */
  getBrowserMeetingHint(browser: string): BrowserMeetingHint | null {
    const now = Date.now();
    const hints = this.browserMeetingHints.get(browser) || [];
    
    // Filter to fresh hints
    const fresh = hints.filter(h => now - h.seenAt <= this.options.browserHintWindowMs);
    
    if (fresh.length === 0) {
      return null;
    }
    
    return fresh[0];
  }

  /**
   * Pick the strongest browser meeting hint across all browsers.
   */
  pickStrongestBrowserMeetingHint(): BrowserMeetingHint | null {
    const now = Date.now();
    const fresh: BrowserMeetingHint[] = [];
    
    for (const hints of this.browserMeetingHints.values()) {
      for (const hint of hints) {
        if (now - hint.seenAt <= this.options.browserHintWindowMs) {
          fresh.push(hint);
        }
      }
    }
    
    if (fresh.length === 0) {
      return null;
    }
    
    if (fresh.length === 1) {
      return fresh[0];
    }
    
    // When multiple meeting tabs are open and there's an active meeting,
    // prefer the current platform to prevent ping-ponging
    if (this.activeMeetingPlatform) {
      const sameAsActive = fresh.find(h => h.platform === this.activeMeetingPlatform);
      if (sameAsActive) {
        return sameAsActive;
      }
    }
    
    // Prefer hints with active mic
    const withMic = fresh.filter(h => h.micActive);
    if (withMic.length > 0) {
      // Sort by most recent
      withMic.sort((a, b) => b.seenAt - a.seenAt);
      return withMic[0];
    }
    
    // Fall back to most recent
    fresh.sort((a, b) => b.seenAt - a.seenAt);
    return fresh[0];
  }

  /**
   * Inject a browser tab (for testing or manual signal injection).
   */
  injectBrowserTab(input: BrowserTabInput): void {
    const now = Date.now();
    const timestamp = input.timestamp ?? now;

    // Match platform from URL and title
    const platform = this.matchBrowserMeetingUrl(input.url, input.title);
    
    // Store as hint regardless of platform
    if (platform !== 'Unknown') {
      const hint: BrowserMeetingHint = {
        browser: input.browser,
        platform,
        title: input.title,
        url: input.url,
        seenAt: now,
        micActive: input.micActive,
        cameraActive: input.cameraActive,
      };
      
      const existing = this.browserMeetingHints.get(input.browser) || [];
      // Update or add hint for this platform
      const idx = existing.findIndex(h => h.platform === platform);
      if (idx >= 0) {
        existing[idx] = hint;
      } else {
        existing.push(hint);
      }
      this.browserMeetingHints.set(input.browser, existing);
    }

    // Don't emit candidates without mic activity (requirement for web meetings)
    if (!input.micActive) {
      if (this.options.debug) {
        console.log('[WebEngine] No mic activity, not emitting candidate:', input.url);
      }
      return;
    }

    // Unknown platform check
    if (platform === 'Unknown' && !this.options.emitUnknown) {
      if (this.options.debug) {
        console.log('[WebEngine] Unknown platform, skipping:', input.url);
      }
      return;
    }

    // Build evidence
    const evidence: WebEvidence = {
      browser: input.browser,
      tabUrl: this.options.includeSensitiveMetadata ? input.url : '',
      tabTitle: this.options.includeSensitiveMetadata ? input.title : '',
      micActive: input.micActive,
      cameraActive: input.cameraActive,
      timestamp,
    };

    // Calculate confidence
    const confidence = this.calculateConfidence(input, platform);

    // Build candidate
    const candidate: WebMeetingCandidate = {
      platform,
      confidence,
      source: 'web',
      timestamp,
      evidence,
    };

    // Emit to all callbacks
    this.emitCandidate(candidate);
  }

  /**
   * Match a platform from URL and title.
   */
  matchBrowserMeetingUrl(urlInput: string, titleInput = ''): MeetingPlatform {
    const url = (urlInput || '').trim().toLowerCase();
    const title = (titleInput || '').trim().toLowerCase();

    if (!url) {
      // For about:blank, rely on title
      if (this.isSlackHuddleTitle(title)) {
        return 'Slack';
      }
      return 'Unknown';
    }

    // Google Meet
    if (this.isGoogleMeetMeetingUrl(url)) {
      return 'Google Meet';
    }

    // Zoom
    if (this.isZoomMeetingUrl(url)) {
      return 'Zoom';
    }

    // Microsoft Teams
    if (this.isTeamsMeetingUrl(url, title)) {
      return 'Microsoft Teams';
    }

    // Slack huddle
    if (this.isSlackHuddleTab(url, title)) {
      return 'Slack';
    }

    // Cisco Webex
    if (url.includes('webex.com/meet') || url.includes('web.webex.com')) {
      return 'Cisco Webex';
    }

    // Jitsi Meet
    if (url.includes('meet.jit.si') || url.includes('jitsi')) {
      return 'Jitsi Meet';
    }

    // Whereby
    if (url.includes('whereby.com')) {
      return 'Whereby';
    }

    // BlueJeans
    if (url.includes('bluejeans.com')) {
      return 'BlueJeans';
    }

    return 'Unknown';
  }

  /**
   * Check for valid Google Meet meeting URL.
   */
  private isGoogleMeetMeetingUrl(url: string): boolean {
    // Valid meeting URL: meet.google.com/xxx-xxxx-xxx
    return /meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:[/?#]|$)/.test(url);
  }

  /**
   * Check for valid Zoom meeting URL.
   */
  private isZoomMeetingUrl(url: string): boolean {
    const parsed = this.parseUrl(url);
    if (!parsed) {
      return false;
    }

    const host = parsed.hostname.toLowerCase();
    if (host !== 'zoom.us' && host !== 'app.zoom.us') {
      return false;
    }

    const path = parsed.pathname.toLowerCase().replace(/\/+$/, '');
    
    // Valid meeting paths
    if (/^\/wc\/\d+\/(?:join|start)$/.test(path)) return true;
    if (/^\/wc\/join\/\d+$/.test(path)) return true;
    if (/^\/j\/\d+$/.test(path)) return true;
    
    // Reject home/generic pages
    if (path === '/wc/home' || path === '/wc') return false;
    
    return false;
  }

  /**
   * Check for valid Teams meeting URL.
   */
  private isTeamsMeetingUrl(url: string, title: string): boolean {
    const parsed = this.parseUrl(url);
    if (!parsed) {
      return false;
    }

    const host = parsed.hostname.toLowerCase();
    if (host !== 'teams.live.com' && host !== 'teams.microsoft.com') {
      return false;
    }

    const path = parsed.pathname.toLowerCase().replace(/\/+$/, '');

    // Explicit meeting routes
    if (path === '/light-meetings' || path === '/light-meetings/launch') {
      return true;
    }
    if (path.startsWith('/l/meetup-join')) {
      return true;
    }
    if (path.startsWith('/meet')) {
      return true;
    }

    // Launcher redirect
    if (path === '/dl/launcher/launcher.html') {
      const launchUrl = decodeURIComponent(parsed.searchParams.get('url') || '').toLowerCase();
      return parsed.searchParams.get('type') === 'meetup-join' || launchUrl.includes('/l/meetup-join/');
    }

    // /v2 route - needs title to distinguish prejoin from admitted
    if (path === '/v2' || path.startsWith('/v2/')) {
      // Query param check
      if (parsed.searchParams.get('meetingjoin') === 'true') {
        return true;
      }
      
      // Title-based check for admitted meeting
      return this.isTeamsMeetingTitle(title);
    }

    return false;
  }

  /**
   * Check if a title indicates an admitted Teams meeting.
   */
  private isTeamsMeetingTitle(title: string): boolean {
    if (!title.includes('microsoft teams')) {
      return false;
    }

    // "Meeting with ..." indicates admitted state
    if (title.includes('meeting with')) {
      return true;
    }

    // Pipe-separated format: "Meet | Something | Microsoft Teams"
    const segments = title
      .split('|')
      .map(s => s.trim())
      .filter(Boolean);

    // Need at least 3 segments with a middle segment (not just "Meet | Microsoft Teams")
    if (segments.length >= 3 && segments[0] === 'meet' && segments.at(-1) === 'microsoft teams') {
      // Has middle segment = admitted meeting
      return true;
    }

    return false;
  }

  /**
   * Check for Slack huddle tab.
   */
  private isSlackHuddleTab(url: string, title: string): boolean {
    // Popup huddles can have about:blank URL
    if (url === 'about:blank') {
      return this.isSlackHuddleTitle(title);
    }

    if (!url.includes('app.slack.com/')) {
      return false;
    }

    // Explicit huddle route
    if (/\/huddle(?:[/?#]|$)/.test(url) || /[?&]huddle_thread=/.test(url)) {
      return true;
    }

    // Client route with huddle in title
    if (url.includes('app.slack.com/client/') && title.includes('huddle')) {
      return true;
    }

    return false;
  }

  /**
   * Check if title indicates a Slack huddle.
   */
  private isSlackHuddleTitle(title: string): boolean {
    const lower = title.toLowerCase();
    return lower.startsWith('huddle:') || 
           lower.startsWith('slack - huddle preview') ||
           (lower.includes('huddle') && lower.includes('slack'));
  }

  /**
   * Parse a URL safely.
   */
  private parseUrl(url: string): URL | null {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  }

  /**
   * Calculate confidence level for a browser tab.
   */
  private calculateConfidence(input: BrowserTabInput, platform: MeetingPlatform): ConfidenceLevel {
    // High confidence: mic and camera active with valid meeting URL
    if (input.micActive && input.cameraActive) {
      return 'high';
    }

    // High confidence: mic active with valid meeting URL
    if (input.micActive) {
      return 'high';
    }

    // Medium confidence: camera only (might be preview)
    if (input.cameraActive) {
      return 'medium';
    }

    // Low confidence: no media activity
    return 'low';
  }

  /**
   * Emit a candidate to all registered callbacks.
   */
  private emitCandidate(candidate: WebMeetingCandidate): void {
    for (const callback of this.callbacks) {
      try {
        callback(candidate);
      } catch (error) {
        if (this.options.debug) {
          console.error('[WebEngine] Callback error:', error);
        }
      }
    }
  }
}
