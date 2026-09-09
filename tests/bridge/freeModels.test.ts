import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  diffNewFreeModels,
  isFreeBridgeModel,
  splitBridgeModelOptions,
} from '../../src/shared/bridge/freeModels';

test('isFreeBridgeModel: provider flag marks every model free', () => {
  assert.equal(isFreeBridgeModel('big-pickle', true), true);
  assert.equal(isFreeBridgeModel('gpt-5.5', true), true);
});

test('isFreeBridgeModel: ":free" suffix is recognized case-insensitively', () => {
  assert.equal(isFreeBridgeModel('z-ai/glm-5.2:free'), true);
  assert.equal(isFreeBridgeModel('nvidia/nemotron:FREE '), true);
  assert.equal(isFreeBridgeModel('z-ai/glm-5.2:free', false), true);
});

test('isFreeBridgeModel: paid ids stay paid', () => {
  assert.equal(isFreeBridgeModel('gpt-5.5'), false);
  assert.equal(isFreeBridgeModel('llama3.1:8b'), false);
  assert.equal(isFreeBridgeModel('free-form-model'), false);
  assert.equal(isFreeBridgeModel(''), false);
});

test('splitBridgeModelOptions: preserves order within each group', () => {
  const { paid, free } = splitBridgeModelOptions([
    { label: 'Grok · grok-4.5', value: 'bridge:grok/grok-4.5' },
    { label: 'OpenRouter · glm:free', value: 'bridge:openai/or/glm:free', free: true },
    { label: 'Ollama · llama', value: 'bridge:openai/ollama/llama' },
    { label: 'Zen · pickle', value: 'bridge:openai/zen/pickle', free: true },
  ]);
  assert.deepEqual(paid.map((o) => o.value), ['bridge:grok/grok-4.5', 'bridge:openai/ollama/llama']);
  assert.deepEqual(free.map((o) => o.value), ['bridge:openai/or/glm:free', 'bridge:openai/zen/pickle']);
});

const FREE_A = { label: 'A', value: 'bridge:openai/or/a:free', free: true };
const FREE_B = { label: 'B', value: 'bridge:openai/zen/b', free: true };
const PAID = { label: 'P', value: 'bridge:grok/grok-4.5' };

test('diffNewFreeModels: first run seeds silently', () => {
  const { newFree, seenNext } = diffNewFreeModels(undefined, [PAID, FREE_A, FREE_B]);
  assert.deepEqual(newFree, []);
  assert.deepEqual(seenNext, [FREE_A.value, FREE_B.value]);
});

test('diffNewFreeModels: announces only unseen free models', () => {
  const { newFree, seenNext } = diffNewFreeModels([FREE_A.value], [PAID, FREE_A, FREE_B]);
  assert.deepEqual(newFree, [FREE_B]);
  assert.deepEqual(seenNext, [FREE_A.value, FREE_B.value]);
});

test('diffNewFreeModels: paid models are never announced', () => {
  const { newFree } = diffNewFreeModels([], [PAID]);
  assert.deepEqual(newFree, []);
});

test('diffNewFreeModels: removed model drops out of the seen set and is announced when re-added', () => {
  const removed = diffNewFreeModels([FREE_A.value, FREE_B.value], [FREE_A]);
  assert.deepEqual(removed.newFree, []);
  assert.deepEqual(removed.seenNext, [FREE_A.value]);
  const readded = diffNewFreeModels(removed.seenNext, [FREE_A, FREE_B]);
  assert.deepEqual(readded.newFree, [FREE_B]);
});
