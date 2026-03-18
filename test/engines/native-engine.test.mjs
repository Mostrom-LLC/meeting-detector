/**
 * Native detector engine tests.
 * 
 * Tests for native desktop meeting detection including:
 * - Process detection for meeting apps
 * - TCC signal handling
 * - Recorder process suppression
 * - Generic window title filtering
 */

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Note: These tests are written first (TDD). The implementation will be created
// to make these tests pass.

describe('NativeDetectorEngine', () => {
  describe('process detection', () => {
    test('detects Microsoft Teams native process with mic active', async () => {
      // This test will verify that when MSTeams process is running
      // and mic is active (TCC signal received), a native candidate is emitted
      const { NativeDetectorEngine } = await import('../../dist/engines/native-engine.js');
      
      const engine = new NativeDetectorEngine({ debug: false });
      const candidates = [];
      
      engine.onCandidate((candidate) => candidates.push(candidate));
      
      // Simulate TCC mic signal for Teams
      engine.injectTccSignal({
        process: 'Microsoft Teams',
        processPath: '/Applications/Microsoft Teams.app/Contents/MacOS/MSTeams',
        micActive: true,
        cameraActive: false,
        verdict: 'allowed',
        preflight: false,
      });
      
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0].platform, 'Microsoft Teams');
      assert.equal(candidates[0].source, 'native');
      assert.equal(candidates[0].confidence, 'high');
      assert.equal(candidates[0].evidence.micActive, true);
    });

    test('detects Zoom native process with camera active', async () => {
      const { NativeDetectorEngine } = await import('../../dist/engines/native-engine.js');
      
      const engine = new NativeDetectorEngine({ debug: false });
      const candidates = [];
      
      engine.onCandidate((candidate) => candidates.push(candidate));
      
      engine.injectTccSignal({
        process: 'zoom.us',
        processPath: '/Applications/zoom.us.app/Contents/MacOS/zoom.us',
        micActive: true,
        cameraActive: true,
        verdict: 'allowed',
        preflight: false,
      });
      
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0].platform, 'Zoom');
      assert.equal(candidates[0].source, 'native');
      assert.equal(candidates[0].evidence.cameraActive, true);
    });

    test('detects Slack native huddle', async () => {
      const { NativeDetectorEngine } = await import('../../dist/engines/native-engine.js');
      
      const engine = new NativeDetectorEngine({ debug: false });
      const candidates = [];
      
      engine.onCandidate((candidate) => candidates.push(candidate));
      
      engine.injectTccSignal({
        process: 'Slack',
        processPath: '/Applications/Slack.app/Contents/MacOS/Slack',
        windowTitle: 'Huddle: #general',
        micActive: true,
        cameraActive: false,
        verdict: 'allowed',
        preflight: false,
      });
      
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0].platform, 'Slack');
      assert.equal(candidates[0].evidence.windowTitle, 'Huddle: #general');
    });
  });

  describe('recorder suppression', () => {
    test('suppresses OBS process', async () => {
      const { NativeDetectorEngine } = await import('../../dist/engines/native-engine.js');
      
      const engine = new NativeDetectorEngine({ debug: false });
      const candidates = [];
      
      engine.onCandidate((candidate) => candidates.push(candidate));
      
      engine.injectTccSignal({
        process: 'OBS',
        processPath: '/Applications/OBS.app/Contents/MacOS/OBS',
        micActive: true,
        cameraActive: true,
        verdict: 'allowed',
        preflight: false,
      });
      
      // No candidate should be emitted for recorder apps
      assert.equal(candidates.length, 0);
    });

    test('suppresses Loom process', async () => {
      const { NativeDetectorEngine } = await import('../../dist/engines/native-engine.js');
      
      const engine = new NativeDetectorEngine({ debug: false });
      const candidates = [];
      
      engine.onCandidate((candidate) => candidates.push(candidate));
      
      engine.injectTccSignal({
        process: 'Loom',
        processPath: '/Applications/Loom.app/Contents/MacOS/Loom',
        micActive: true,
        cameraActive: true,
        verdict: 'allowed',
        preflight: false,
      });
      
      assert.equal(candidates.length, 0);
    });

    test('suppresses ScreenFlow process', async () => {
      const { NativeDetectorEngine } = await import('../../dist/engines/native-engine.js');
      
      const engine = new NativeDetectorEngine({ debug: false });
      const candidates = [];
      
      engine.onCandidate((candidate) => candidates.push(candidate));
      
      engine.injectTccSignal({
        process: 'ScreenFlow',
        processPath: '/Applications/ScreenFlow.app/Contents/MacOS/ScreenFlow',
        micActive: true,
        cameraActive: true,
        verdict: 'allowed',
        preflight: false,
      });
      
      assert.equal(candidates.length, 0);
    });
  });

  describe('low confidence filtering', () => {
    test('filters preflight requests without window title', async () => {
      const { NativeDetectorEngine } = await import('../../dist/engines/native-engine.js');
      
      const engine = new NativeDetectorEngine({ debug: false });
      const candidates = [];
      
      engine.onCandidate((candidate) => candidates.push(candidate));
      
      engine.injectTccSignal({
        process: 'Microsoft Teams',
        processPath: '/Applications/Microsoft Teams.app/Contents/MacOS/MSTeams',
        windowTitle: '', // Empty window title
        micActive: false,
        cameraActive: false,
        verdict: 'requested',
        preflight: true,
      });
      
      // Preflight with empty window title should be filtered
      assert.equal(candidates.length, 0);
    });

    test('filters generic idle window titles', async () => {
      const { NativeDetectorEngine } = await import('../../dist/engines/native-engine.js');
      
      const engine = new NativeDetectorEngine({ debug: false });
      const candidates = [];
      
      engine.onCandidate((candidate) => candidates.push(candidate));
      
      // Generic "Microsoft Teams" title without mic = idle app
      engine.injectTccSignal({
        process: 'Microsoft Teams',
        processPath: '/Applications/Microsoft Teams.app/Contents/MacOS/MSTeams',
        windowTitle: 'Microsoft Teams',
        micActive: false,
        cameraActive: false,
        verdict: 'requested',
        preflight: true,
      });
      
      assert.equal(candidates.length, 0);
    });

    test('filters chat window titles for Teams', async () => {
      const { NativeDetectorEngine } = await import('../../dist/engines/native-engine.js');
      
      const engine = new NativeDetectorEngine({ debug: false });
      const candidates = [];
      
      engine.onCandidate((candidate) => candidates.push(candidate));
      
      // Chat windows should not trigger meeting detection
      engine.injectTccSignal({
        process: 'Microsoft Teams',
        processPath: '/Applications/Microsoft Teams.app/Contents/MacOS/MSTeams',
        windowTitle: 'Chat | John Doe',
        micActive: false,
        cameraActive: false,
        verdict: 'requested',
        preflight: true,
      });
      
      assert.equal(candidates.length, 0);
    });
  });

  describe('TCC signal tracking', () => {
    test('tracks last TCC mic signal timestamp', async () => {
      const { NativeDetectorEngine } = await import('../../dist/engines/native-engine.js');
      
      const engine = new NativeDetectorEngine({ debug: false });
      
      const before = engine.getLastTccMicSignalAt();
      assert.equal(before, 0);
      
      engine.injectTccSignal({
        process: 'Microsoft Teams',
        micActive: true,
        cameraActive: false,
        verdict: 'allowed',
        preflight: false,
      });
      
      const after = engine.getLastTccMicSignalAt();
      assert.ok(after > 0);
      assert.ok(after >= Date.now() - 1000);
    });

    test('tracks last TCC camera signal timestamp', async () => {
      const { NativeDetectorEngine } = await import('../../dist/engines/native-engine.js');
      
      const engine = new NativeDetectorEngine({ debug: false });
      
      const before = engine.getLastTccCameraSignalAt();
      assert.equal(before, 0);
      
      engine.injectTccSignal({
        process: 'Zoom',
        micActive: true,
        cameraActive: true,
        verdict: 'allowed',
        preflight: false,
      });
      
      const after = engine.getLastTccCameraSignalAt();
      assert.ok(after > 0);
    });
  });

  describe('media state caching', () => {
    test('caches media state from probes', async () => {
      const { NativeDetectorEngine } = await import('../../dist/engines/native-engine.js');
      
      const engine = new NativeDetectorEngine({ debug: false });
      
      // Inject cached media state
      engine.setCachedMediaState({ camera: true, mic: true });
      
      const state = engine.getCachedMediaState();
      assert.equal(state.camera, true);
      assert.equal(state.mic, true);
      assert.ok(state.updatedAt > 0);
    });
  });

  describe('platform normalization', () => {
    test('normalizes msteams to Microsoft Teams', async () => {
      const { NativeDetectorEngine } = await import('../../dist/engines/native-engine.js');
      
      const engine = new NativeDetectorEngine({ debug: false });
      const candidates = [];
      
      engine.onCandidate((candidate) => candidates.push(candidate));
      
      engine.injectTccSignal({
        process: 'msteams',
        micActive: true,
        cameraActive: false,
        verdict: 'allowed',
        preflight: false,
      });
      
      assert.equal(candidates[0].platform, 'Microsoft Teams');
    });

    test('normalizes zoom.us to Zoom', async () => {
      const { NativeDetectorEngine } = await import('../../dist/engines/native-engine.js');
      
      const engine = new NativeDetectorEngine({ debug: false });
      const candidates = [];
      
      engine.onCandidate((candidate) => candidates.push(candidate));
      
      engine.injectTccSignal({
        process: 'zoom.us',
        micActive: true,
        cameraActive: false,
        verdict: 'allowed',
        preflight: false,
      });
      
      assert.equal(candidates[0].platform, 'Zoom');
    });
  });
});
