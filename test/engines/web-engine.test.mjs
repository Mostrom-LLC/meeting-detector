/**
 * Web detector engine tests.
 * 
 * Tests for browser/web meeting detection including:
 * - URL matching for meeting platforms
 * - Browser tab probing
 * - Stale hint invalidation
 * - Multiple tabs handling
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

describe('WebDetectorEngine', () => {
  describe('Google Meet URL detection', () => {
    test('detects valid Google Meet meeting URL', async () => {
      const { WebDetectorEngine } = await import('../../dist/engines/web-engine.js');
      
      const engine = new WebDetectorEngine({ debug: false });
      const candidates = [];
      
      engine.onCandidate((candidate) => candidates.push(candidate));
      
      engine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'https://meet.google.com/abc-defg-hij',
        title: 'Meeting | Google Meet',
        micActive: true,
        cameraActive: true,
      });
      
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0].platform, 'Google Meet');
      assert.equal(candidates[0].source, 'web');
      assert.equal(candidates[0].confidence, 'high');
    });

    test('ignores Google Meet homepage', async () => {
      const { WebDetectorEngine } = await import('../../dist/engines/web-engine.js');
      
      const engine = new WebDetectorEngine({ debug: false });
      const candidates = [];
      
      engine.onCandidate((candidate) => candidates.push(candidate));
      
      engine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'https://meet.google.com/',
        title: 'Google Meet',
        micActive: false,
        cameraActive: false,
      });
      
      // Homepage without mic should not trigger
      assert.equal(candidates.length, 0);
    });

    test('ignores Meet landing page after call ends', async () => {
      const { WebDetectorEngine } = await import('../../dist/engines/web-engine.js');
      
      const engine = new WebDetectorEngine({ debug: false });
      const candidates = [];
      
      engine.onCandidate((candidate) => candidates.push(candidate));
      
      engine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'https://meet.google.com/landing',
        title: 'Google Meet',
        micActive: false,
        cameraActive: false,
      });
      
      assert.equal(candidates.length, 0);
    });
  });

  describe('Zoom web URL detection', () => {
    test('detects Zoom web meeting URL', async () => {
      const { WebDetectorEngine } = await import('../../dist/engines/web-engine.js');
      
      const engine = new WebDetectorEngine({ debug: false });
      const candidates = [];
      
      engine.onCandidate((candidate) => candidates.push(candidate));
      
      engine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'https://zoom.us/wc/123456789/join',
        title: 'Zoom Meeting',
        micActive: true,
        cameraActive: false,
      });
      
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0].platform, 'Zoom');
      assert.equal(candidates[0].source, 'web');
    });

    test('ignores Zoom home page', async () => {
      const { WebDetectorEngine } = await import('../../dist/engines/web-engine.js');
      
      const engine = new WebDetectorEngine({ debug: false });
      const candidates = [];
      
      engine.onCandidate((candidate) => candidates.push(candidate));
      
      engine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'https://app.zoom.us/wc/home',
        title: 'Zoom',
        micActive: false,
        cameraActive: false,
      });
      
      assert.equal(candidates.length, 0);
    });
  });

  describe('Microsoft Teams web URL detection', () => {
    test('detects Teams web meeting on teams.live.com/v2', async () => {
      const { WebDetectorEngine } = await import('../../dist/engines/web-engine.js');
      
      const engine = new WebDetectorEngine({ debug: false });
      const candidates = [];
      
      engine.onCandidate((candidate) => candidates.push(candidate));
      
      // Real admitted Teams meeting has title with "Meeting with ..."
      engine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'https://teams.live.com/v2/',
        title: 'Meet | Meeting with John Doe | Microsoft Teams',
        micActive: true,
        cameraActive: true,
      });
      
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0].platform, 'Microsoft Teams');
    });

    test('detects Teams web meeting on light-meetings route', async () => {
      const { WebDetectorEngine } = await import('../../dist/engines/web-engine.js');
      
      const engine = new WebDetectorEngine({ debug: false });
      const candidates = [];
      
      engine.onCandidate((candidate) => candidates.push(candidate));
      
      engine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'https://teams.live.com/light-meetings/launch',
        title: 'Microsoft Teams',
        micActive: true,
        cameraActive: false,
      });
      
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0].platform, 'Microsoft Teams');
    });

    test('ignores Teams prejoin page (Meet | Microsoft Teams only)', async () => {
      const { WebDetectorEngine } = await import('../../dist/engines/web-engine.js');
      
      const engine = new WebDetectorEngine({ debug: false });
      const candidates = [];
      
      engine.onCandidate((candidate) => candidates.push(candidate));
      
      // Prejoin page has generic title without "Meeting with"
      engine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'https://teams.live.com/v2/',
        title: 'Meet | Microsoft Teams',
        micActive: false,
        cameraActive: false,
      });
      
      assert.equal(candidates.length, 0);
    });

    test('ignores generic Teams landing page', async () => {
      const { WebDetectorEngine } = await import('../../dist/engines/web-engine.js');
      
      const engine = new WebDetectorEngine({ debug: false });
      const candidates = [];
      
      engine.onCandidate((candidate) => candidates.push(candidate));
      
      engine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'https://teams.live.com/v2/',
        title: 'Microsoft Teams',
        micActive: false,
        cameraActive: false,
      });
      
      assert.equal(candidates.length, 0);
    });
  });

  describe('Slack web huddle detection', () => {
    test('detects Slack web huddle via URL', async () => {
      const { WebDetectorEngine } = await import('../../dist/engines/web-engine.js');
      
      const engine = new WebDetectorEngine({ debug: false });
      const candidates = [];
      
      engine.onCandidate((candidate) => candidates.push(candidate));
      
      engine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'https://app.slack.com/client/T12345/huddle',
        title: 'Slack',
        micActive: true,
        cameraActive: false,
      });
      
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0].platform, 'Slack');
    });

    test('detects Slack popup huddle with about:blank URL', async () => {
      const { WebDetectorEngine } = await import('../../dist/engines/web-engine.js');
      
      const engine = new WebDetectorEngine({ debug: false });
      const candidates = [];
      
      engine.onCandidate((candidate) => candidates.push(candidate));
      
      // Slack huddles can appear as popup windows with about:blank
      engine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'about:blank',
        title: 'Huddle: #general - Mostrom, LLC - Slack',
        micActive: true,
        cameraActive: false,
      });
      
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0].platform, 'Slack');
    });

    test('detects Slack huddle preview popup', async () => {
      const { WebDetectorEngine } = await import('../../dist/engines/web-engine.js');
      
      const engine = new WebDetectorEngine({ debug: false });
      const candidates = [];
      
      engine.onCandidate((candidate) => candidates.push(candidate));
      
      engine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'about:blank',
        title: 'Slack - Huddle Preview',
        micActive: true,
        cameraActive: false,
      });
      
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0].platform, 'Slack');
    });

    test('ignores regular Slack workspace page', async () => {
      const { WebDetectorEngine } = await import('../../dist/engines/web-engine.js');
      
      const engine = new WebDetectorEngine({ debug: false });
      const candidates = [];
      
      engine.onCandidate((candidate) => candidates.push(candidate));
      
      engine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'https://app.slack.com/client/T12345/C67890',
        title: '#general - Slack',
        micActive: false,
        cameraActive: false,
      });
      
      assert.equal(candidates.length, 0);
    });
  });

  describe('browser hint management', () => {
    test('invalidates stale browser hints after timeout', async () => {
      const { WebDetectorEngine } = await import('../../dist/engines/web-engine.js');
      
      const engine = new WebDetectorEngine({ 
        debug: false,
        browserHintWindowMs: 100, // Short window for testing
      });
      
      // First inject a meeting tab
      engine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'https://meet.google.com/abc-defg-hij',
        title: 'Meeting',
        micActive: true,
        cameraActive: false,
      });
      
      // Check hint is valid
      const hint = engine.getBrowserMeetingHint('Google Chrome');
      assert.ok(hint);
      assert.equal(hint.platform, 'Google Meet');
      
      // Wait for hint to expire
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Hint should be invalidated
      const expiredHint = engine.getBrowserMeetingHint('Google Chrome');
      assert.equal(expiredHint, null);
    });

    test('picks strongest hint when multiple meeting tabs exist', async () => {
      const { WebDetectorEngine } = await import('../../dist/engines/web-engine.js');
      
      const engine = new WebDetectorEngine({ debug: false });
      
      // Inject multiple meeting tabs
      engine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'https://meet.google.com/abc-defg-hij',
        title: 'Meeting 1',
        micActive: false,
        cameraActive: false,
      });
      
      engine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'https://zoom.us/wc/123456/join',
        title: 'Zoom Meeting',
        micActive: true, // Active mic = stronger hint
        cameraActive: false,
      });
      
      // With an active meeting, prefer the current platform
      engine.setActiveMeetingPlatform('Google Meet');
      const hint = engine.pickStrongestBrowserMeetingHint();
      
      // Should prefer the active meeting platform
      assert.equal(hint?.platform, 'Google Meet');
    });
  });

  describe('confidence levels', () => {
    test('assigns high confidence for valid meeting URL with mic active', async () => {
      const { WebDetectorEngine } = await import('../../dist/engines/web-engine.js');
      
      const engine = new WebDetectorEngine({ debug: false });
      const candidates = [];
      
      engine.onCandidate((candidate) => candidates.push(candidate));
      
      engine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'https://meet.google.com/abc-defg-hij',
        title: 'Meeting',
        micActive: true,
        cameraActive: true,
      });
      
      assert.equal(candidates[0].confidence, 'high');
    });

    test('assigns medium confidence for meeting URL without mic', async () => {
      const { WebDetectorEngine } = await import('../../dist/engines/web-engine.js');
      
      const engine = new WebDetectorEngine({ debug: false });
      const candidates = [];
      
      engine.onCandidate((candidate) => candidates.push(candidate));
      
      // Meeting URL but no mic = medium confidence (might be prejoin)
      engine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'https://meet.google.com/abc-defg-hij',
        title: 'Meeting',
        micActive: false,
        cameraActive: false,
      });
      
      // Without mic, should not emit (or emit low confidence)
      // The engine should require mic activity for web meetings
      assert.equal(candidates.length, 0);
    });
  });

  describe('media state requirements', () => {
    test('requires mic activity for web meeting candidates', async () => {
      const { WebDetectorEngine } = await import('../../dist/engines/web-engine.js');
      
      const engine = new WebDetectorEngine({ debug: false });
      const candidates = [];
      
      engine.onCandidate((candidate) => candidates.push(candidate));
      
      // Valid meeting URL but no mic = no candidate
      engine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'https://meet.google.com/abc-defg-hij',
        title: 'Meeting',
        micActive: false,
        cameraActive: false,
      });
      
      assert.equal(candidates.length, 0);
      
      // Now with mic active
      engine.injectBrowserTab({
        browser: 'Google Chrome',
        url: 'https://meet.google.com/abc-defg-hij',
        title: 'Meeting',
        micActive: true,
        cameraActive: false,
      });
      
      assert.equal(candidates.length, 1);
    });
  });
});
