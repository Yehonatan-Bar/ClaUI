import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { CLAUDE_MODEL_OPTIONS, getClaudeModelLabel } from '../../src/webview/utils/claudeModelDisplay';
import { getModelMaxContext } from '../../src/webview/utils/modelContextLimits';
import { DEFAULT_PRICES } from '../../server/src/usage/PriceDefaults';
import { resolvePriceKey } from '../../server/src/usage/CostCalculator';

test('CLAUDE_MODEL_OPTIONS: Sonnet 5.5 is listed directly above Sonnet 5', () => {
  const values = CLAUDE_MODEL_OPTIONS.map((option) => option.value);
  const sonnet55Index = values.indexOf('claude-sonnet-5-5');
  assert.ok(sonnet55Index >= 0, 'Sonnet 5.5 must be selectable');
  assert.equal(values[sonnet55Index + 1], 'claude-sonnet-5');
});

test('getClaudeModelLabel: Sonnet 5.5 is not shadowed by the shorter Sonnet 5 id', () => {
  assert.equal(getClaudeModelLabel('claude-sonnet-5-5'), 'Sonnet 5.5');
  // A dated variant must still resolve through the longest-prefix rule.
  assert.equal(getClaudeModelLabel('claude-sonnet-5-5-20260928'), 'Sonnet 5.5');
  assert.equal(getClaudeModelLabel('claude-sonnet-5'), 'Sonnet 5');
  assert.equal(getClaudeModelLabel('claude-sonnet-5-20260630'), 'Sonnet 5');
});

test('getModelMaxContext: Sonnet 5.5 has a 1M-token window', () => {
  assert.equal(getModelMaxContext('claude-sonnet-5-5'), 1_000_000);
  assert.equal(getModelMaxContext('claude-sonnet-5'), 1_000_000);
});

test('DEFAULT_PRICES: Sonnet 5.5 resolves to its own $2/$10 row', () => {
  assert.equal(resolvePriceKey('claude-sonnet-5-5', DEFAULT_PRICES), 'claude-sonnet-5-5');
  assert.equal(resolvePriceKey('claude-sonnet-5-5-20260928', DEFAULT_PRICES), 'claude-sonnet-5-5');
  assert.equal(resolvePriceKey('claude-sonnet-5', DEFAULT_PRICES), 'claude-sonnet-5');
  const expectedSonnetPrice = { input: 2, output: 10, cacheCreation: 2.5, cacheRead: 0.2 };
  assert.deepEqual(DEFAULT_PRICES['claude-sonnet-5-5'], expectedSonnetPrice);
  assert.deepEqual(DEFAULT_PRICES['claude-sonnet-5'], expectedSonnetPrice);
});
