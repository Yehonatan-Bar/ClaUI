import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import type { CodexModelOption } from '../../src/extension/types/webview-messages';
import { CODEX_MODEL_FALLBACK, resolveCodexModelOption } from '../../src/webview/utils/codexModels';
import { getModelMaxContext } from '../../src/webview/utils/modelContextLimits';

test('CODEX_MODEL_FALLBACK: Astra fallback advertises the local capabilities', () => {
  const astra = CODEX_MODEL_FALLBACK.find((o) => o.value === 'gpt-6-astra');
  assert.ok(astra, 'Astra must be in the static fallback table');
  assert.equal(astra!.contextWindow, 272000);
  assert.equal(astra!.maxContextWindow, 872000);
  assert.equal(astra!.supportsFast, true);
  assert.equal(astra!.defaultReasoningEffort, 'medium');
  assert.deepEqual(astra!.supportedReasoningEfforts, ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
});

test('resolveCodexModelOption: prefers the live cache over the static fallback', () => {
  const cache: CodexModelOption[] = [
    { label: 'GPT-6 Astra', value: 'gpt-6-astra', contextWindow: 300000, supportsFast: false },
  ];
  const resolved = resolveCodexModelOption('gpt-6-astra', cache);
  assert.equal(resolved!.contextWindow, 300000);
  assert.equal(resolved!.supportsFast, false);
});

test('resolveCodexModelOption: falls back to the static table when cache is empty', () => {
  const resolved = resolveCodexModelOption('gpt-6-astra', []);
  assert.ok(resolved, 'should resolve from fallback');
  assert.equal(resolved!.contextWindow, 272000);
});

test('resolveCodexModelOption: unknown model returns undefined', () => {
  assert.equal(resolveCodexModelOption('gpt-does-not-exist', []), undefined);
  assert.equal(resolveCodexModelOption('', []), undefined);
  assert.equal(resolveCodexModelOption(undefined, undefined), undefined);
});

test('getModelMaxContext: Astra uses 272K from the fallback when no cache is present', () => {
  assert.equal(getModelMaxContext('gpt-6-astra'), 272000);
  assert.equal(getModelMaxContext('gpt-6-astra', []), 272000);
});

test('getModelMaxContext: Astra prefers the dynamic cache context window', () => {
  const cache: CodexModelOption[] = [
    { label: 'GPT-6 Astra', value: 'gpt-6-astra', contextWindow: 250000 },
  ];
  assert.equal(getModelMaxContext('gpt-6-astra', cache), 250000);
});

test('getModelMaxContext: unknown gpt-6 slug still falls back to 272K (never the API 1.05M)', () => {
  assert.equal(getModelMaxContext('gpt-6-mystery', []), 272000);
});

test('getModelMaxContext: non-Codex models are unaffected', () => {
  assert.equal(getModelMaxContext('claude-opus-4-8'), 1000000);
  assert.equal(getModelMaxContext('claude-3-5-sonnet'), 200000);
});
