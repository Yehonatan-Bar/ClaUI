import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodexSessionTruncator } from '../../src/extension/session/CodexSessionTruncator';

const SESSIONS_DIR = path.join(os.homedir(), '.codex', 'sessions');
const TEST_CWD = 'c:\\projects\\codex-truncator-test';

/**
 * Write a synthetic Codex rollout into ~/.codex/sessions so the truncator can
 * discover it by scanning for the thread id (exactly how `codex exec resume`
 * locates a session). Returns the thread id and a cleanup callback.
 */
function setupRollout(): { threadId: string; cleanup: () => void } {
  const threadId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date();
  const dir = path.join(
    SESSIONS_DIR,
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  );
  const filePath = path.join(dir, `rollout-test-${threadId}.jsonl`);

  const lines = [
    { type: 'session_meta', payload: { id: threadId, timestamp: now.toISOString(), cwd: TEST_CWD, cli_version: 'test' } },
    { type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<permissions>' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'question one' }] } },
    { type: 'response_item', payload: { type: 'reasoning', content: [] } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'answer one' }] } },
    { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'c1', input: 'ls' } },
    { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'c1', output: 'files' } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'answer one continued' }] } },
    { type: 'event_msg', payload: { type: 'token_count' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'question two' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'answer two' }] } },
  ];

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf-8');

  return {
    threadId,
    cleanup: () => { try { fs.unlinkSync(filePath); } catch { /* ignore */ } },
  };
}

function readLines(p: string): Record<string, any>[] {
  return fs.readFileSync(p, 'utf-8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

describe('CodexSessionTruncator', () => {
  const truncator = new CodexSessionTruncator();

  it('creates an isolated truncated rollout ending on an assistant message', () => {
    const { threadId, cleanup } = setupRollout();
    let outPath: string | null = null;
    try {
      // Fork from "question two" (UI index 3: user q1=0, assistant a1=1,
      // assistant a1-continued=2, user q2=3).
      const result = truncator.truncateSession(threadId, 3, TEST_CWD);
      assert.ok(result, 'truncation should succeed');
      outPath = result.rolloutPath;

      // New, distinct thread id, and the old id is fully rewritten.
      assert.notEqual(result.newThreadId, threadId);
      const raw = fs.readFileSync(result.rolloutPath, 'utf-8');
      assert.ok(!raw.includes(threadId), 'old thread id must be fully rewritten');

      const lines = readLines(result.rolloutPath);
      const meta = lines.find((l) => l.type === 'session_meta');
      assert.equal(meta?.payload?.id, result.newThreadId, 'session_meta id must be the new thread id');

      // Kept the first turn (q1 + both assistant messages), dropped q2 onward.
      assert.equal(result.uiMessagesKept, 3);

      // Ends on an assistant message.
      const items = lines.filter((l) => l.type === 'response_item');
      const last = items[items.length - 1];
      assert.equal(last?.payload?.type, 'message');
      assert.equal(last?.payload?.role, 'assistant');

      // "question two" must be gone.
      const hasQ2 = items.some((l) =>
        l.payload?.type === 'message' &&
        JSON.stringify(l.payload?.content ?? '').includes('question two'));
      assert.equal(hasQ2, false, 'forked-from user message must be excluded');
    } finally {
      cleanup();
      if (outPath) { try { fs.unlinkSync(outPath); } catch { /* ignore */ } }
    }
  });

  it('returns null for a non-existent thread', () => {
    const result = truncator.truncateSession('does-not-exist-thread-id', 2, TEST_CWD);
    assert.equal(result, null);
  });
});
