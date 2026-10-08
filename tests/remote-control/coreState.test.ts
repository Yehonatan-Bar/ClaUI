import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { EventLog } from '../../src/extension/remote-control/core/EventLog';
import { TabStateTracker } from '../../src/extension/remote-control/core/TabStateTracker';
import { armTurnWaiter } from '../../src/extension/remote-control/core/TurnWaiter';
import { compactPayload } from '../../src/extension/remote-control/core/payloadCompactor';
import { formatBlocksAsText, extractText } from '../../src/extension/remote-control/core/contentFormat';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// EventLog
// ---------------------------------------------------------------------------

test('event log: seq, query, tail, live-only types not stored', () => {
  const log = new EventLog(5);
  const live: string[] = [];
  log.subscribe((e) => live.push(e.type));
  log.record({ tabId: 't1', direction: 'out', type: 'processBusy', data: { busy: true } });
  log.record({ tabId: 't1', direction: 'out', type: 'streamingText', data: { text: 'he' } });
  log.record({ tabId: 't2', direction: 'in', type: 'sendMessage', data: { text: 'x' } });
  assert.equal(log.lastSeq, 3);
  assert.deepEqual(live, ['processBusy', 'streamingText', 'sendMessage']);
  assert.deepEqual(log.query(0).map((e) => e.type), ['processBusy', 'sendMessage']);
  assert.deepEqual(log.query(0, { tabId: 't2' }).map((e) => e.seq), [3]);
  assert.deepEqual(log.query(0, { direction: 'out' }).map((e) => e.seq), [1]);
  for (let i = 0; i < 10; i++) log.record({ tabId: null, direction: 'system', type: 'x', data: i });
  assert.equal(log.query(0, {}, 100).length, 5, 'ring capacity');
  assert.deepEqual(log.tail({}, 2).map((e) => e.data), [8, 9]);
});

test('event log: long-poll resolves on the first matching stored event', async () => {
  const log = new EventLog();
  const since = log.lastSeq;
  const pending = log.waitForEvents(since, { types: ['turnComplete'] }, 10, 2000);
  setTimeout(() => {
    log.record({ tabId: 't', direction: 'out', type: 'streamingText', data: {} });
    log.record({ tabId: 't', direction: 'out', type: 'processBusy', data: {} });
    log.record({ tabId: 't', direction: 'out', type: 'turnComplete', data: { turn: {} } });
  }, 30);
  const events = await pending;
  assert.deepEqual(events.map((e) => e.type), ['turnComplete']);
  assert.deepEqual(await log.waitForEvents(log.lastSeq, {}, 10, 50), [], 'times out empty');
});

test('payload compaction truncates, elides blobs and redacts secrets', () => {
  const out = compactPayload({
    text: 'a'.repeat(5000),
    list: Array.from({ length: 150 }, (_, i) => i),
    images: [{ base64: 'x'.repeat(1000), mediaType: 'image/png' }],
    apiKey: 'sk-short',
  }) as Record<string, unknown>;
  assert.match(String(out.text), /truncated 1000 chars/);
  assert.equal((out.list as unknown[]).length, 101);
  assert.equal((out.images as Array<Record<string, unknown>>)[0].base64, '[1000 chars elided]');
  assert.equal(out.apiKey, '[redacted]');
});

// ---------------------------------------------------------------------------
// Content formatting
// ---------------------------------------------------------------------------

test('content formatting handles strings, tools and thinking', () => {
  assert.equal(extractText('plain'), 'plain');
  const blocks = [
    { type: 'thinking', thinking: 'hmm' },
    { type: 'text', text: 'Reading the file.' },
    { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'a.ts' } },
  ];
  const results = new Map([['tu1', { content: 'file body', isError: false }]]);
  const text = formatBlocksAsText(blocks, {}, results);
  assert.match(text, /Reading the file\./);
  assert.match(text, /\[tool: Read\] \{"file_path":"a.ts"\}/);
  assert.match(text, /\[tool result\] file body/);
  assert.doesNotMatch(text, /hmm/);
  assert.match(formatBlocksAsText(blocks, { includeThinking: true, includeTools: false }), /\[thinking\] hmm/);
});

// ---------------------------------------------------------------------------
// TabStateTracker
// ---------------------------------------------------------------------------

test('tracker builds the transcript and upserts partial assistant messages', () => {
  const tracker = new TabStateTracker();
  tracker.ingestInbound('t', { type: 'ready' });
  tracker.ingestOutbound('t', { type: 'sessionStarted', sessionId: 'pending', model: 'claude-opus-5-5' });
  tracker.ingestOutbound('t', { type: 'userMessage', content: [{ type: 'text', text: 'hello' }] });
  tracker.ingestOutbound('t', { type: 'processBusy', busy: true });
  tracker.ingestOutbound('t', { type: 'assistantMessage', messageId: 'm1', content: [{ type: 'text', text: 'Hi' }], model: 'claude-opus-5-5' });
  tracker.ingestOutbound('t', {
    type: 'assistantMessage',
    messageId: 'm1',
    content: [{ type: 'text', text: 'Hi' }, { type: 'tool_use', id: 'x', name: 'Bash', input: { command: 'ls' } }],
  });
  // A late, shorter partial must not overwrite the complete version.
  tracker.ingestOutbound('t', { type: 'assistantMessage', messageId: 'm1', content: [{ type: 'text', text: 'H' }] });
  tracker.ingestOutbound('t', { type: 'toolResult', toolId: 'x', content: 'a.txt', isError: false });
  tracker.ingestOutbound('t', { type: 'costUpdate', costUsd: 0.01, totalCostUsd: 0.05, inputTokens: 10, outputTokens: 20 });
  tracker.ingestOutbound('t', { type: 'turnComplete', turn: { turnIndex: 0 } });
  tracker.ingestOutbound('t', { type: 'processBusy', busy: false });

  const state = tracker.getState('t');
  assert.equal(state.webviewReady, true);
  assert.equal(state.sessionId, null, '"pending" is not a real session id');
  assert.equal(state.model, 'claude-opus-5-5');
  assert.equal(state.busy, false);
  assert.equal(state.turnCount, 1);
  assert.equal(state.cost?.totalUsd, 0.05);
  const transcript = tracker.getTranscript('t');
  assert.equal(transcript.length, 2);
  assert.equal(transcript[1].content.length, 2);
  assert.equal(tracker.getToolResults('t').get('x')?.content, 'a.txt');
  assert.equal(tracker.lastAssistantEntry('t')?.messageId, 'm1');
  assert.equal(tracker.entriesSince('t', 1).length, 1);
});

test('tracker replaces the transcript on history load and clears on reset', () => {
  const tracker = new TabStateTracker();
  tracker.ingestOutbound('t', { type: 'userMessage', content: 'old' });
  tracker.ingestOutbound('t', {
    type: 'conversationHistory',
    messages: [
      { id: 'u1', role: 'user', content: [{ type: 'text', text: 'q' }], timestamp: 1 },
      { id: 'a1', role: 'assistant', content: [{ type: 'tool_use', id: 'k', name: 'Read', input: {} }], timestamp: 2 },
      { id: 'u2', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'k', content: 'done' }], timestamp: 3 },
    ],
  });
  assert.equal(tracker.getTranscript('t').length, 3);
  assert.equal(tracker.getToolResults('t').get('k')?.content, 'done');
  const firstIndex = tracker.getTranscript('t')[0].index;
  assert.ok(firstIndex >= 1, 'indexes keep increasing across replacement');
  tracker.ingestOutbound('t', { type: 'conversationReset' });
  assert.equal(tracker.getTranscript('t').length, 0);
});

test('tracker pending approvals: plan, question details and clearing', () => {
  const tracker = new TabStateTracker();
  tracker.ingestOutbound('t', {
    type: 'assistantMessage',
    messageId: 'm',
    content: [{ type: 'tool_use', id: 'q', name: 'AskUserQuestion', input: { questions: [{ question: 'Which DB?', options: [{ label: 'Postgres' }] }] } }],
  });
  tracker.ingestOutbound('t', { type: 'planApprovalRequired', toolName: 'AskUserQuestion' });
  const q = tracker.describePendingApproval('t');
  assert.equal(q?.kind, 'question');
  assert.equal((q?.questions?.[0] as { question: string }).question, 'Which DB?');
  tracker.ingestInbound('t', { type: 'planApprovalResponse', action: 'questionAnswer' });
  assert.equal(tracker.describePendingApproval('t'), null);

  tracker.ingestOutbound('t', { type: 'planApprovalRequired', toolName: 'ExitPlanMode', planText: JSON.stringify({ plan: '1. do it' }) });
  const plan = tracker.describePendingApproval('t');
  assert.equal(plan?.kind, 'plan');
  assert.equal(plan?.plan, '1. do it');
  tracker.ingestOutbound('t', { type: 'planApprovalDismissed' });
  assert.equal(tracker.getState('t').pendingApproval, null);

  tracker.ingestOutbound('t', { type: 'planApprovalRequired', toolName: 'Bash', planText: '{"command":"rm -rf x"}' });
  const perm = tracker.describePendingApproval('t');
  assert.equal(perm?.kind, 'permission');
  assert.deepEqual(perm?.toolInput, { command: 'rm -rf x' });
  tracker.ingestInbound('t', { type: 'sendMessage', text: 'no' });
  assert.equal(tracker.getState('t').pendingApproval, null);
});

// ---------------------------------------------------------------------------
// TurnWaiter
// ---------------------------------------------------------------------------

function harness() {
  const log = new EventLog();
  let busy = false;
  let pending = false;
  const out = (type: string, data: Record<string, unknown> = {}) => {
    if (type === 'processBusy') busy = data.busy === true;
    log.record({ tabId: 'tab', direction: 'out', type, data });
  };
  const arm = (opts: Partial<Parameters<typeof armTurnWaiter>[1]> = {}) =>
    armTurnWaiter(log, {
      tabId: 'tab',
      timeoutMs: 3000,
      initiallyBusy: false,
      settleMs: 40,
      startGraceMs: 500,
      isBusy: () => busy,
      hasPendingApproval: () => pending,
      ...opts,
    });
  return { log, out, arm, setPending: (v: boolean) => (pending = v) };
}

test('turn waiter: busy cycle -> completed (ignores other tabs)', async () => {
  const h = harness();
  const waiter = h.arm();
  h.log.record({ tabId: 'other', direction: 'out', type: 'processBusy', data: { busy: false } });
  h.out('processBusy', { busy: true });
  h.out('assistantMessage', { messageId: 'm' });
  h.out('processBusy', { busy: false });
  assert.equal((await waiter.promise).status, 'completed');
});

test('turn waiter: busy:true after busy:false keeps waiting (settle cancelled)', async () => {
  const h = harness();
  const waiter = h.arm({ settleMs: 80 });
  h.out('processBusy', { busy: true });
  h.out('processBusy', { busy: false });
  await sleep(20);
  h.out('processBusy', { busy: true });
  let settled = false;
  void waiter.promise.then(() => (settled = true));
  await sleep(150);
  assert.equal(settled, false);
  h.out('turnComplete', { turn: {} });
  assert.equal((await waiter.promise).status, 'completed');
});

test('turn waiter: approval, session end, usage queue, cancel, idle, timeout, error', async () => {
  let h = harness();
  let w = h.arm();
  h.out('processBusy', { busy: true });
  h.out('processBusy', { busy: false });
  h.out('planApprovalRequired', { toolName: 'ExitPlanMode' });
  assert.equal((await w.promise).status, 'awaiting_approval');

  h = harness();
  w = h.arm();
  h.out('processBusy', { busy: true });
  h.out('sessionEnded', { reason: 'crashed' });
  assert.equal((await w.promise).status, 'session_ended');

  h = harness();
  w = h.arm();
  h.out('usageQueuedPromptState', { queued: true });
  assert.equal((await w.promise).status, 'queued_usage_limit');

  h = harness();
  w = h.arm();
  h.out('processBusy', { busy: true });
  h.log.record({ tabId: 'tab', direction: 'in', type: 'cancelRequest', data: {} });
  assert.equal((await w.promise).status, 'cancelled');

  h = harness();
  w = h.arm({ startGraceMs: 60 });
  assert.equal((await w.promise).status, 'idle');

  h = harness();
  w = h.arm({ timeoutMs: 60, initiallyBusy: true });
  assert.equal((await w.promise).status, 'timeout');

  h = harness();
  w = h.arm();
  h.out('error', { message: 'claude not found' });
  const outcome = await w.promise;
  assert.equal(outcome.status, 'error');
  assert.equal(outcome.error, 'claude not found');
});

test('turn waiter: completion with a pending approval reports awaiting_approval', async () => {
  const h = harness();
  const waiter = h.arm();
  h.out('processBusy', { busy: true });
  h.setPending(true);
  h.out('processBusy', { busy: false });
  assert.equal((await waiter.promise).status, 'awaiting_approval');
});

test('turn waiter: an already-aborted signal resolves immediately (abandoned caller)', async () => {
  const h = harness();
  const controller = new AbortController();
  controller.abort();
  const started = Date.now();
  const outcome = await h.arm({ signal: controller.signal, timeoutMs: 5000 }).promise;
  assert.equal(outcome.status, 'timeout');
  assert.ok(Date.now() - started < 200);
  assert.equal(h.log.subscriberCount, 0, 'no listener leak');
});

test('event log: long-poll with an aborted signal returns at once', async () => {
  const log = new EventLog();
  const controller = new AbortController();
  controller.abort();
  const started = Date.now();
  assert.deepEqual(await log.waitForEvents(0, {}, 10, 5000, controller.signal), []);
  assert.ok(Date.now() - started < 200);
});
