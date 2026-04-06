import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDER_MATRIX } from './helpers/signal-fixtures.mjs';
import { runProviderMatrixScenario } from './helpers/scenario-runner.mjs';

for (const provider of PROVIDER_MATRIX) {
  test(`${provider} emits start then end`, async () => {
    const result = await runProviderMatrixScenario(provider);

    assert.equal(result.errors.length, 0);
    assert.equal(result.started.length, 1);
    assert.equal(result.ended.length, 1);
    assert.equal(result.started[0].platform, provider);
    assert.equal(result.ended[0].platform, provider);
    assert.equal(result.started[0].session_id, result.ended[0].session_id);
    assert.equal(result.started[0].started_at, result.ended[0].started_at);
    assert.equal(result.started[0].ended_at, undefined);
    assert.ok(result.ended[0].ended_at);
  });
}
