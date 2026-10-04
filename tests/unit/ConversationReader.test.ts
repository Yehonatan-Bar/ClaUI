import { test, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConversationReader } from '../../src/extension/session/ConversationReader';

// A session that was last active days ago: reloading it today must keep these times.
const USER_TIME = '2026-09-27T08:00:00.000Z';
const ASSISTANT_FIRST_BLOCK_TIME = '2026-09-27T08:00:05.000Z';
const ASSISTANT_LAST_BLOCK_TIME = '2026-09-27T08:00:09.000Z';
const SYNTHETIC_TIME = '2026-09-27T08:01:00.000Z';
const SECOND_USER_TIME = '2026-09-28T10:30:00.000Z';

let claudeConfigDir: string;

before(() => {
  claudeConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claui-conversation-reader-'));
  fs.mkdirSync(path.join(claudeConfigDir, 'projects', 'test-project'), { recursive: true });
});

after(() => {
  fs.rmSync(claudeConfigDir, { recursive: true, force: true });
});

function readEntries(sessionId: string, entries: Array<Record<string, unknown>>) {
  const jsonlPath = path.join(claudeConfigDir, 'projects', 'test-project', `${sessionId}.jsonl`);
  fs.writeFileSync(jsonlPath, entries.map((entry) => JSON.stringify(entry)).join('\n'), 'utf-8');
  return new ConversationReader().readSession(sessionId, undefined, claudeConfigDir);
}

const userEntry = (text: string, timestamp?: unknown, extra: Record<string, unknown> = {}) => ({
  type: 'user',
  timestamp,
  message: { role: 'user', content: text },
  ...extra,
});

const assistantEntry = (id: string, block: Record<string, unknown>, timestamp?: unknown) => ({
  type: 'assistant',
  timestamp,
  message: { id, role: 'assistant', model: 'claude-test', content: [block] },
});

test('restored messages keep the original JSONL timestamps, not the reload time', () => {
  const messages = readEntries('keeps-original-times', [
    userEntry('hello', USER_TIME),
    assistantEntry('msg_1', { type: 'text', text: 'hi there' }, ASSISTANT_LAST_BLOCK_TIME),
    userEntry('second question', SECOND_USER_TIME),
  ]);

  assert.deepEqual(
    messages.map((message) => message.role),
    ['user', 'assistant', 'user'],
  );
  assert.equal(messages[0].timestamp, Date.parse(USER_TIME));
  assert.equal(messages[1].timestamp, Date.parse(ASSISTANT_LAST_BLOCK_TIME));
  assert.equal(messages[2].timestamp, Date.parse(SECOND_USER_TIME));
});

test('an assistant message split over several entries is stamped with its last entry', () => {
  const messages = readEntries('merged-assistant', [
    userEntry('question', USER_TIME),
    assistantEntry('msg_1', { type: 'thinking', thinking: 'hmm' }, ASSISTANT_FIRST_BLOCK_TIME),
    assistantEntry('msg_1', { type: 'text', text: 'answer' }, ASSISTANT_LAST_BLOCK_TIME),
  ]);

  const assistantMessages = messages.filter((message) => message.role === 'assistant');
  assert.equal(assistantMessages.length, 1);
  assert.equal(assistantMessages[0].timestamp, Date.parse(ASSISTANT_LAST_BLOCK_TIME));
});

test('CLI-injected synthetic messages keep their own timestamp', () => {
  const messages = readEntries('synthetic-message', [
    userEntry('question', USER_TIME),
    userEntry('<system-reminder>skill body</system-reminder>', SYNTHETIC_TIME, { isMeta: true }),
  ]);

  const synthetic = messages.find((message) => message.synthetic === true);
  assert.ok(synthetic, 'expected a synthetic message');
  assert.equal(synthetic.timestamp, Date.parse(SYNTHETIC_TIME));
});

test('an entry without a usable timestamp inherits the previous message time, in order', () => {
  const messages = readEntries('missing-timestamps', [
    userEntry('question', USER_TIME),
    assistantEntry('msg_1', { type: 'text', text: 'answer' }), // no timestamp field
    userEntry('follow-up', 'not-a-date'), // unparseable timestamp
  ]);

  const userTime = Date.parse(USER_TIME);
  assert.deepEqual(
    messages.map((message) => message.timestamp),
    [userTime, userTime + 1, userTime + 2],
  );
});

test('with no timestamp anywhere the first message falls back to the current time', () => {
  const startedAtMs = Date.now();
  const messages = readEntries('no-timestamps-at-all', [userEntry('question')]);
  const finishedAtMs = Date.now();

  assert.equal(messages.length, 1);
  assert.ok(messages[0].timestamp >= startedAtMs && messages[0].timestamp <= finishedAtMs);
});
