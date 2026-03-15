import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getBrowserProbeTargets } from '../dist/detector.js';

test('probes only browsers that are already running', () => {
  const targets = getBrowserProbeTargets(['Google Chrome', 'Slack', 'Finder']);

  assert.deepEqual(targets.map(([browser]) => browser), ['Google Chrome']);
});

test('includes Microsoft Edge when it is already running', () => {
  const targets = getBrowserProbeTargets(['Google Chrome', 'Safari', 'Microsoft Edge']);

  assert.equal(targets.some(([browser]) => browser === 'Microsoft Edge'), true);
});

test('falls back to probing the supported browser list when running-app discovery is unavailable', () => {
  const targets = getBrowserProbeTargets(null);

  assert.deepEqual(
    targets.map(([browser]) => browser),
    ['Google Chrome', 'Microsoft Edge', 'Safari']
  );
});
