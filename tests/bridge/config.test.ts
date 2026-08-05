import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseBridgeModel, resolveOpenAiApiKey } from '../../src/bridge-runtime/config';

test('parseBridgeModel: grok', () => {
  assert.deepEqual(parseBridgeModel('bridge:grok/grok-4.5'), {
    backend: 'grok',
    model: 'grok-4.5',
  });
});

test('parseBridgeModel: antigravity', () => {
  assert.deepEqual(parseBridgeModel('bridge:antigravity/gemini-3.6-flash-medium'), {
    backend: 'antigravity',
    model: 'gemini-3.6-flash-medium',
  });
});

test('parseBridgeModel: openai splits provider id from model', () => {
  assert.deepEqual(parseBridgeModel('bridge:openai/ollama/llama3.1:8b'), {
    backend: 'openai',
    providerId: 'ollama',
    model: 'llama3.1:8b',
  });
});

test('parseBridgeModel: rejects non-bridge and malformed values', () => {
  assert.equal(parseBridgeModel('sonnet'), null);
  assert.equal(parseBridgeModel(''), null);
  assert.equal(parseBridgeModel(null), null);
  assert.equal(parseBridgeModel('bridge:grok'), null); // no slash
  assert.equal(parseBridgeModel('bridge:openai/ollama'), null); // no model
  assert.equal(parseBridgeModel('bridge:unknown/x'), null);
});

test('resolveOpenAiApiKey: precedence apiKey > env > file > none', () => {
  assert.equal(resolveOpenAiApiKey({ id: 'x', baseUrl: 'u', apiKey: ' k1 ' }), 'k1');

  process.env.__CLAUI_TEST_KEY = ' envkey ';
  assert.equal(
    resolveOpenAiApiKey({ id: 'x', baseUrl: 'u', apiKeyEnv: '__CLAUI_TEST_KEY' }),
    'envkey',
  );
  delete process.env.__CLAUI_TEST_KEY;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claui-key-'));
  const file = path.join(dir, 'key.txt');
  fs.writeFileSync(file, 'filekey\n');
  assert.equal(resolveOpenAiApiKey({ id: 'x', baseUrl: 'u', apiKeyFile: file }), 'filekey');
  fs.rmSync(dir, { recursive: true, force: true });

  assert.equal(resolveOpenAiApiKey({ id: 'x', baseUrl: 'u' }), '');
});
