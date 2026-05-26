import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SessionTruncator } from '../../src/extension/session/SessionTruncator';

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'truncator');

function setupSession(fixtureName: string): { sessionId: string; cleanup: () => void } {
  const sessionId = `test-${fixtureName}-${Date.now()}`;
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  const dirs = fs.readdirSync(projectsDir);
  if (dirs.length === 0) throw new Error('No project directories found in ~/.claude/projects');

  const targetDir = path.join(projectsDir, dirs[0]);
  const srcPath = path.join(FIXTURES_DIR, `${fixtureName}.jsonl`);
  const destPath = path.join(targetDir, `${sessionId}.jsonl`);

  const content = fs.readFileSync(srcPath, 'utf-8');
  const updatedContent = content.replace(/"sessionId":"[^"]+"/g, `"sessionId":"${sessionId}"`);
  fs.writeFileSync(destPath, updatedContent, 'utf-8');

  const createdFiles = [destPath];

  return {
    sessionId,
    cleanup: () => {
      for (const f of createdFiles) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
      }
    },
  };
}

function readTruncatedLines(jsonlPath: string): Record<string, unknown>[] {
  const content = fs.readFileSync(jsonlPath, 'utf-8');
  return content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
}

function countByType(lines: Record<string, unknown>[], type: string): number {
  return lines.filter(l => l.type === type).length;
}

function countRealUserMessages(lines: Record<string, unknown>[]): number {
  return lines.filter(l => {
    if (l.type !== 'user') return false;
    if (l.isMeta === true) return false;
    const msg = l.message as { content?: unknown } | undefined;
    if (!msg) return false;
    if (Array.isArray(msg.content)) {
      if (msg.content.some((b: any) => b.type === 'tool_result')) return false;
    }
    return true;
  }).length;
}

function getUniqueAssistantMsgIds(lines: Record<string, unknown>[]): string[] {
  const ids = new Set<string>();
  for (const l of lines) {
    if (l.type === 'assistant') {
      const msg = l.message as { id?: string } | undefined;
      if (msg?.id) ids.add(msg.id);
    }
  }
  return [...ids];
}

function lastNonMetadataLine(lines: Record<string, unknown>[]): Record<string, unknown> | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const type = lines[i].type as string;
    if (type === 'user' || type === 'assistant') return lines[i];
  }
  return null;
}

describe('SessionTruncator', () => {
  const truncator = new SessionTruncator();
  const cleanups: (() => void)[] = [];

  after(() => {
    for (const fn of cleanups) fn();
  });

  describe('simple-3-turn', () => {
    // UI messages: [0:user "hello", 1:assistant "hi there", 2:user "joke", 3:assistant "chicken", 4:user "another", 5:assistant "knock knock"]

    it('fork at index 2 keeps first user+assistant pair', () => {
      const { sessionId, cleanup } = setupSession('simple-3-turn');
      cleanups.push(cleanup);

      const result = truncator.truncateSession(sessionId, 2);
      assert.ok(result, 'truncation should succeed');
      cleanups.push(() => { try { fs.unlinkSync(result!.jsonlPath); } catch {} });

      const lines = readTruncatedLines(result.jsonlPath);
      assert.equal(countRealUserMessages(lines), 1, 'should have 1 real user message');
      assert.equal(getUniqueAssistantMsgIds(lines).length, 1, 'should have 1 assistant message');
      assert.equal(result.uiMessagesKept, 2);

      // last-prompt should be stripped
      assert.equal(countByType(lines, 'last-prompt'), 0, 'last-prompt should be removed');

      // sessionId should be updated
      for (const l of lines) {
        if ('sessionId' in l) {
          assert.equal(l.sessionId, result.newSessionId, 'sessionId should be updated');
        }
      }

      // Should end with assistant
      const last = lastNonMetadataLine(lines);
      assert.ok(last, 'should have non-metadata lines');
      assert.equal(last.type, 'assistant', 'should end with assistant');
    });

    it('fork at index 4 keeps first 2 turns', () => {
      const { sessionId, cleanup } = setupSession('simple-3-turn');
      cleanups.push(cleanup);

      const result = truncator.truncateSession(sessionId, 4);
      assert.ok(result);
      cleanups.push(() => { try { fs.unlinkSync(result!.jsonlPath); } catch {} });

      const lines = readTruncatedLines(result.jsonlPath);
      assert.equal(countRealUserMessages(lines), 2);
      assert.equal(getUniqueAssistantMsgIds(lines).length, 2);
      assert.equal(result.uiMessagesKept, 4);
    });

    it('fork at index 1 keeps only first user message as assistant boundary', () => {
      const { sessionId, cleanup } = setupSession('simple-3-turn');
      cleanups.push(cleanup);

      // forkMessageIndex=1 means we want messages[0..0] = just the user message.
      // But ensureEndsWithAssistant should exclude it since it ends on user.
      // This leaves nothing -> returns null.
      const result = truncator.truncateSession(sessionId, 1);
      assert.equal(result, null, 'should return null when truncation leaves no valid conversation');
    });
  });

  describe('agentic-tools', () => {
    // UI messages: [0:user "read", 1:assistant(msg_01 w/tool_use), ... extended ... 2:assistant(msg_03, text only),
    //              3:user "next", 4:assistant(msg_04)]
    // Actually the UI index mapping:
    //   line 3: user "read" -> uiIndex 0
    //   lines 5-9: assistant msg_01 (tool_use) -> flushed at user tool_result -> msg_01=uiIndex 1
    //             assistant msg_02 (tool_use) -> flushed at user tool_result -> msg_02=uiIndex 2
    //             assistant msg_03 (text) -> flushed at next real user -> msg_03=uiIndex 3
    //   Wait, the flush happens when we hit a user-type line. Let me trace through:
    //
    // Line 0: queue-op -> METADATA
    // Line 1: queue-op -> METADATA
    // Line 2: attachment -> METADATA
    // Line 3: user "read" -> REAL_USER, flush (nothing pending), uiIndex=0, uiIndex++
    // Line 4: last-prompt -> METADATA
    // Line 5: assistant msg_01 [text, tool_use] -> ASSISTANT, pending msg_01
    // Line 6: user [tool_result] -> TOOL_RESULT_USER, flush pending: msg_01=uiIndex 1, uiIndex++
    // Line 7: assistant msg_02 [text, tool_use] -> ASSISTANT, pending msg_02
    // Line 8: user [tool_result] -> TOOL_RESULT_USER, flush pending: msg_02=uiIndex 2, uiIndex++
    // Line 9: assistant msg_03 [text] -> ASSISTANT, pending msg_03
    // Line 10: queue-op -> METADATA
    // Line 11: queue-op -> METADATA
    // Line 12: user "next" -> REAL_USER, flush pending: msg_03=uiIndex 3, uiIndex++. user=uiIndex 4, uiIndex++
    // Line 13: last-prompt -> METADATA
    // Line 14: assistant msg_04 -> ASSISTANT, pending msg_04
    // EOF flush: msg_04=uiIndex 5

    it('fork at index 2 (first tool_use assistant) extends to include full agentic turn', () => {
      const { sessionId, cleanup } = setupSession('agentic-tools');
      cleanups.push(cleanup);

      // forkMessageIndex=2: cut at first line with uiIndex>=2 (msg_02 lines)
      // But msg_01 ends with tool_use -> extend to include tool_result + msg_02
      // msg_02 also ends with tool_use -> extend again to include tool_result + msg_03
      // msg_03 is text only -> clean cut
      const result = truncator.truncateSession(sessionId, 2);
      assert.ok(result);
      cleanups.push(() => { try { fs.unlinkSync(result!.jsonlPath); } catch {} });

      const lines = readTruncatedLines(result.jsonlPath);
      const assistantIds = getUniqueAssistantMsgIds(lines);

      // Should have the full agentic loop: msg_01, msg_02, msg_03
      assert.ok(assistantIds.includes('msg_01'));
      assert.ok(assistantIds.includes('msg_02'));
      assert.ok(assistantIds.includes('msg_03'));
      assert.equal(countRealUserMessages(lines), 1, 'only the initial user message');

      // Should end with assistant msg_03
      const last = lastNonMetadataLine(lines);
      assert.equal(last?.type, 'assistant');
    });

    it('fork at index 5 (second user message) keeps the entire first turn', () => {
      const { sessionId, cleanup } = setupSession('agentic-tools');
      cleanups.push(cleanup);

      // forkMessageIndex=4 targets the "next question" user at uiIndex=4
      const result = truncator.truncateSession(sessionId, 4);
      assert.ok(result);
      cleanups.push(() => { try { fs.unlinkSync(result!.jsonlPath); } catch {} });

      const lines = readTruncatedLines(result.jsonlPath);
      assert.equal(countRealUserMessages(lines), 1);
      const assistantIds = getUniqueAssistantMsgIds(lines);
      assert.ok(assistantIds.includes('msg_03'), 'should include final assistant of first turn');
      assert.ok(!assistantIds.includes('msg_04'), 'should not include second turn assistant');
    });
  });

  describe('meta-messages', () => {
    // UI messages:
    //   line 2: user "hello" -> uiIndex 0
    //   line 4: assistant msg_01 -> uiIndex 1
    //   line 5: isMeta user -> META_USER, flushes msg_01 -> uiIndex 1 already done, meta -> uiIndex 2
    //   line 6: assistant msg_02 -> pending
    //   line 8: user "second" -> flush msg_02=uiIndex 3, user=uiIndex 4
    //   line 10: assistant msg_03 -> uiIndex 5

    it('isMeta messages count as separate UI messages', () => {
      const { sessionId, cleanup } = setupSession('meta-messages');
      cleanups.push(cleanup);

      // Fork at index 3 (msg_02 assistant after meta)
      const result = truncator.truncateSession(sessionId, 3);
      assert.ok(result);
      cleanups.push(() => { try { fs.unlinkSync(result!.jsonlPath); } catch {} });

      const lines = readTruncatedLines(result.jsonlPath);
      // Should include: user "hello", assistant msg_01, meta user
      assert.equal(countRealUserMessages(lines), 1);
      const assistantIds = getUniqueAssistantMsgIds(lines);
      assert.ok(assistantIds.includes('msg_01'));
      assert.ok(!assistantIds.includes('msg_02'));
    });
  });

  describe('partial-blocks', () => {
    // Multiple assistant entries with same msg_01 id (partial streaming)
    // The last partial has tool_use -> should extend

    it('handles multiple partial assistant blocks for same message', () => {
      const { sessionId, cleanup } = setupSession('partial-blocks');
      cleanups.push(cleanup);

      // Fork at index 4 (user "thanks", uiIndex=4 in the second turn)
      // The first turn has: user(0), msg_01(1, with tool_use partials), msg_02(2, text), user(3 "thanks"), msg_03(4)
      // Wait let me trace:
      // line 0: queue-op METADATA
      // line 1: queue-op METADATA
      // line 2: user "explain" -> REAL_USER, uiIndex=0
      // line 3: last-prompt METADATA
      // line 4: assistant msg_01 partial [text] -> pending msg_01
      // line 5: assistant msg_01 partial [text, text] -> pending msg_01 (same id)
      // line 6: assistant msg_01 partial [text, text, tool_use] -> pending msg_01
      // line 7: user [tool_result] -> TOOL_RESULT_USER, flush: msg_01=uiIndex 1
      // line 8: assistant msg_02 [text] -> pending msg_02
      // line 9: queue-op METADATA
      // line 10: queue-op METADATA
      // line 11: user "thanks" -> REAL_USER, flush: msg_02=uiIndex 2, user=uiIndex 3
      // line 12: last-prompt METADATA
      // line 13: assistant msg_03 -> pending, EOF flush: msg_03=uiIndex 4

      const result = truncator.truncateSession(sessionId, 3);
      assert.ok(result);
      cleanups.push(() => { try { fs.unlinkSync(result!.jsonlPath); } catch {} });

      const lines = readTruncatedLines(result.jsonlPath);
      const assistantIds = getUniqueAssistantMsgIds(lines);
      assert.ok(assistantIds.includes('msg_01'));
      assert.ok(assistantIds.includes('msg_02'));
      assert.ok(!assistantIds.includes('msg_03'));
    });
  });

  describe('ensureEndsWithAssistant edge cases', () => {
    // UI indices for ends-on-meta-user fixture:
    //   line 0: queue-op METADATA
    //   line 1: queue-op METADATA
    //   line 2: user "hello" -> uiIndex 0
    //   line 3: last-prompt METADATA
    //   line 4: assistant msg_01 -> flushed at meta_user: uiIndex 1
    //   line 5: isMeta user "skill body" -> META_USER: uiIndex 2
    //   line 6: assistant msg_02 -> flushed at real_user: uiIndex 3
    //   line 7: queue-op METADATA
    //   line 8: queue-op METADATA
    //   line 9: user "follow up" -> uiIndex 4
    //   line 10: last-prompt METADATA
    //   line 11: assistant msg_03 -> EOF flush: uiIndex 5

    it('does not end on META_USER (isMeta is still JSONL type:user)', () => {
      const { sessionId, cleanup } = setupSession('ends-on-meta-user');
      cleanups.push(cleanup);

      // Fork at index 3 (msg_02): cut should land at the meta_user (line 5, uiIndex=2).
      // But meta_user is a user-type line. ensureEndsWithAssistant should walk
      // backward past it to end at assistant msg_01.
      const result = truncator.truncateSession(sessionId, 2);
      assert.ok(result);
      cleanups.push(() => { try { fs.unlinkSync(result!.jsonlPath); } catch {} });

      const lines = readTruncatedLines(result.jsonlPath);
      const last = lastNonMetadataLine(lines);
      assert.ok(last);
      assert.equal(last.type, 'assistant', 'should end with assistant, not META_USER');
      const assistantIds = getUniqueAssistantMsgIds(lines);
      assert.ok(assistantIds.includes('msg_01'));
      assert.ok(!assistantIds.includes('msg_02'), 'msg_02 should be excluded');
    });

    it('strips consecutive user-role lines (META_USER + TOOL_RESULT_USER sequence)', () => {
      const { sessionId, cleanup } = setupSession('consecutive-user-roles');
      cleanups.push(cleanup);

      // Fork at index 4 ("next topic"): naïve cut at line 11.
      // Lines 7 (META_USER) and 8 (TOOL_RESULT_USER) must both be excluded.
      // Should end at assistant msg_02 (line 6).
      const result = truncator.truncateSession(sessionId, 4);
      assert.ok(result);
      cleanups.push(() => { try { fs.unlinkSync(result!.jsonlPath); } catch {} });

      const lines = readTruncatedLines(result.jsonlPath);
      const last = lastNonMetadataLine(lines);
      assert.ok(last);
      assert.equal(last.type, 'assistant', 'must end on assistant after stripping user sequence');

      // Verify no user-type lines after the last assistant
      const lastAssistantIdx = lines.lastIndexOf(last);
      for (let i = lastAssistantIdx + 1; i < lines.length; i++) {
        assert.notEqual(lines[i].type, 'user', `line ${i} should not be user-type after last assistant`);
      }

      const assistantIds = getUniqueAssistantMsgIds(lines);
      assert.ok(assistantIds.includes('msg_02'));
      assert.ok(!assistantIds.includes('msg_03'));
    });

    it('truncated file never ends on a TOOL_RESULT_USER', () => {
      const { sessionId, cleanup } = setupSession('agentic-tools');
      cleanups.push(cleanup);

      // For the agentic fixture, any fork should end on assistant, not tool_result
      const result = truncator.truncateSession(sessionId, 2);
      assert.ok(result);
      cleanups.push(() => { try { fs.unlinkSync(result!.jsonlPath); } catch {} });

      const lines = readTruncatedLines(result.jsonlPath);
      const last = lastNonMetadataLine(lines);
      assert.ok(last);
      assert.equal(last.type, 'assistant', 'should end with assistant, not tool_result user');
    });
  });

  describe('general edge cases', () => {
    it('returns null for non-existent session', () => {
      const result = truncator.truncateSession('non-existent-session-id', 2);
      assert.equal(result, null);
    });

    it('new session file has different sessionId from original', () => {
      const { sessionId, cleanup } = setupSession('simple-3-turn');
      cleanups.push(cleanup);

      const result = truncator.truncateSession(sessionId, 4);
      assert.ok(result);
      cleanups.push(() => { try { fs.unlinkSync(result!.jsonlPath); } catch {} });

      assert.notEqual(result.newSessionId, sessionId);
      const lines = readTruncatedLines(result.jsonlPath);
      for (const l of lines) {
        if ('sessionId' in l) {
          assert.equal(l.sessionId, result.newSessionId);
        }
      }
    });
  });
});
