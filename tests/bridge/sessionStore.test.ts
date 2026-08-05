import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionStore } from '../../src/bridge-runtime/sessionStore';

function tmpStore(): { store: SessionStore; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claui-bridge-store-'));
  return { store: new SessionStore(dir), dir };
}

test('SessionStore: write then read round-trips and merges patches', () => {
  const { store, dir } = tmpStore();
  store.write('sid-1', { backend: 'grok', model: 'grok-4.5' });
  store.write('sid-1', { grokSessionId: 'acp-123' });
  const state = store.read('sid-1');
  assert.equal(state?.backend, 'grok');
  assert.equal(state?.model, 'grok-4.5');
  assert.equal(state?.grokSessionId, 'acp-123');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('SessionStore: read of unknown session is null', () => {
  const { store, dir } = tmpStore();
  assert.equal(store.read('nope'), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('SessionStore: appendHistory caps at 200 turns (keeps newest)', () => {
  const { store, dir } = tmpStore();
  for (let i = 0; i < 250; i++) {
    store.appendHistory('sid', i % 2 === 0 ? 'user' : 'assistant', `m${i}`);
  }
  const history = store.read('sid')?.history ?? [];
  assert.equal(history.length, 200);
  assert.equal(history[history.length - 1].content, 'm249');
  assert.equal(history[0].content, 'm50');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('SessionStore: session id with path separators cannot escape the dir', () => {
  const { store, dir } = tmpStore();
  store.write('../../evil', { backend: 'openai', model: 'x' });
  // Nothing was written outside the store directory.
  const parent = path.resolve(dir, '..');
  assert.ok(!fs.existsSync(path.join(parent, 'evil.json')));
  // And the sanitized name is readable back.
  assert.equal(store.read('../../evil')?.backend, 'openai');
  fs.rmSync(dir, { recursive: true, force: true });
});
