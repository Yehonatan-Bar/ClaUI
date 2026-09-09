import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { once } from 'node:events';
import { parseBridgeModel, BridgeConfig } from '../../src/bridge-runtime/config';
import {
  CouncilBackend,
  CouncilMember,
  MemberResult,
  parseMemberToken,
  buildRoster,
  buildSynthesisPrompt,
  cliExists,
  invokeCodexCouncil,
  invokeOpenAiCouncil,
  reapChildrenThenCleanup,
} from '../../src/bridge-runtime/backends/council';
import { spawnCli } from '../../src/bridge-runtime/procUtils';
import { SessionStore } from '../../src/bridge-runtime/sessionStore';
import { BridgePrompt, StreamEmitter } from '../../src/bridge-runtime/protocol';

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpStore(): { store: SessionStore; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claui-council-test-'));
  return { store: new SessionStore(dir), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** Config whose openai providers (referenced by member tokens) are keyless →
 *  available, without any real server being reachable (dispatch is faked). */
function councilConfig(members: string[], timeoutMs = 100): BridgeConfig {
  const ids = new Set<string>();
  for (const m of members) {
    const p = parseMemberToken(m);
    if (p?.engine === 'openai' && p.providerId) ids.add(p.providerId);
  }
  return {
    version: 1,
    council: { members, timeoutMs },
    openai: [...ids].map((id) => ({ id, baseUrl: 'http://127.0.0.1:9/v1', models: ['m'] })),
  };
}

/** Run a council turn, capturing the emitted stream-json objects at the emitter
 *  (its `out` method) rather than touching the global process.stdout — so the
 *  test runner's own TAP output is never intercepted. Returns the transcript
 *  plus every emitted object (so we can assert the exact protocol sequence). */
async function runCouncil(
  backend: CouncilBackend,
  emitter: StreamEmitter,
  prompt: BridgePrompt,
  opts?: { emitResult?: boolean; before?: () => void },
): Promise<{ transcript: string; lines: Record<string, unknown>[] }> {
  const lines: Record<string, unknown>[] = [];
  (emitter as unknown as { out: (obj: unknown) => void }).out = (obj: unknown) => {
    lines.push(obj as Record<string, unknown>);
  };
  const startedAt = Date.now();
  const p = backend.runTurn(prompt, emitter);
  opts?.before?.();
  const transcript = await p;
  if (opts?.emitResult) emitter.result({ text: transcript, startedAt });
  return { transcript, lines };
}

// ---------------------------------------------------------------------------
// parseBridgeModel — council value parsing
// ---------------------------------------------------------------------------

test('parseBridgeModel: bare council', () => {
  assert.deepEqual(parseBridgeModel('bridge:council'), { backend: 'council' });
});

test('parseBridgeModel: council with chair', () => {
  assert.deepEqual(parseBridgeModel('bridge:council/grok'), { backend: 'council', chair: 'grok' });
});

test('parseBridgeModel: council chair keeps embedded slashes', () => {
  assert.deepEqual(parseBridgeModel('bridge:council/openai/or/x/y'), {
    backend: 'council',
    chair: 'openai/or/x/y',
  });
});

test('parseBridgeModel: council/ with empty chair -> no chair', () => {
  assert.deepEqual(parseBridgeModel('bridge:council/'), { backend: 'council' });
});

// ---------------------------------------------------------------------------
// parseMemberToken / buildRoster
// ---------------------------------------------------------------------------

test('parseMemberToken: cli engines with and without a model', () => {
  assert.deepEqual(parseMemberToken('codex'), {
    engine: 'codex',
    model: '',
    token: 'codex',
    displayId: 'codex',
  });
  assert.deepEqual(parseMemberToken('grok/grok-4.5'), {
    engine: 'grok',
    model: 'grok-4.5',
    token: 'grok/grok-4.5',
    displayId: 'grok/grok-4.5',
  });
  assert.deepEqual(parseMemberToken('claude/opus'), {
    engine: 'claude',
    model: 'opus',
    token: 'claude/opus',
    displayId: 'claude/opus',
  });
});

test('parseMemberToken: openai needs provider AND model; model may contain slash', () => {
  assert.equal(parseMemberToken('openai/or'), null);
  assert.deepEqual(parseMemberToken('openai/or/x/y'), {
    engine: 'openai',
    providerId: 'or',
    model: 'x/y',
    token: 'openai/or/x/y',
    displayId: 'openai/or/x/y',
  });
});

test('parseMemberToken: rejects unknown / empty tokens', () => {
  assert.equal(parseMemberToken('bogus'), null);
  assert.equal(parseMemberToken(''), null);
});

test('buildRoster: dedupes by display id and caps at 6', () => {
  const r = buildRoster([
    'codex',
    'codex',
    'grok',
    'openai/a/m',
    'openai/b/m',
    'openai/c/m',
    'openai/d/m',
    'openai/e/m',
  ]);
  assert.equal(r.length, 6);
  assert.deepEqual(r.map((m) => m.displayId), [
    'codex',
    'grok',
    'openai/a/m',
    'openai/b/m',
    'openai/c/m',
    'openai/d/m',
  ]);
});

test('buildRoster: drops unrecognized tokens', () => {
  assert.deepEqual(buildRoster(['codex', 'bogus', 'openai/x']).map((m) => m.displayId), ['codex']);
});

// ---------------------------------------------------------------------------
// cliExists — availability detection
// ---------------------------------------------------------------------------

test('cliExists: absolute existing path / known location / missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claui-cli-'));
  const abs = path.join(dir, 'tool.exe');
  fs.writeFileSync(abs, '');
  assert.equal(cliExists(abs, 'fallback', []), true);
  assert.equal(cliExists('claui-definitely-not-a-real-cli-xyz', 'claui-definitely-not-a-real-cli-xyz', []), false);
  assert.equal(cliExists('nope', 'nope', [abs]), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cliExists: resolves a Windows .cmd shim via the PATH probe', { skip: process.platform !== 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claui-shim-'));
  const shim = path.join(dir, 'clauicouncilshim.cmd');
  fs.writeFileSync(shim, '@echo off\r\n');
  const prevPath = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${prevPath || ''}`;
  try {
    assert.equal(cliExists('clauicouncilshim', 'clauicouncilshim', []), true);
  } finally {
    process.env.PATH = prevPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// buildSynthesisPrompt — stable roster order
// ---------------------------------------------------------------------------

test('buildSynthesisPrompt: lists opinions in roster order and includes the question', () => {
  const a = parseMemberToken('codex')!;
  const b = parseMemberToken('grok')!;
  const results = new Map<CouncilMember, MemberResult>([
    [b, { ok: true, text: 'answer-B' }],
    [a, { ok: true, text: 'answer-A' }],
  ]);
  const prompt = buildSynthesisPrompt('the question', [a, b], results);
  const ai = prompt.indexOf('### codex');
  const bi = prompt.indexOf('### grok');
  assert.ok(ai >= 0 && bi >= 0 && ai < bi, 'codex section must precede grok section');
  assert.ok(prompt.includes('answer-A') && prompt.includes('answer-B'));
  assert.ok(prompt.includes('the question'));
});

// ---------------------------------------------------------------------------
// CouncilBackend state machine (dispatch faked via the test invoke seam)
// ---------------------------------------------------------------------------

test('council: >=2 successes -> chair synthesizes a ruling', async () => {
  const { store, cleanup } = tmpStore();
  const cfg = councilConfig(['openai/a/m', 'openai/b/m']);
  const invoke = async (m: CouncilMember, q: string) =>
    q.includes('Council opinions:') ? 'FINAL-RULING' : `ans-${m.displayId}`;
  const backend = new CouncilBackend(cfg, undefined, 'sid', store, '', () => {}, { invoke, minTimeoutMs: 50 });
  const { transcript } = await runCouncil(backend, new StreamEmitter('sid', 'council'), {
    text: 'Q',
    images: [],
  });
  assert.ok(transcript.includes('### openai/a/m'));
  assert.ok(transcript.includes('### openai/b/m'));
  assert.ok(transcript.includes('Chair ruling'));
  assert.ok(transcript.includes('FINAL-RULING'));
  cleanup();
});

test('council: synthesis input is roster-ordered even when members settle out of order', async () => {
  const { store, cleanup } = tmpStore();
  const cfg = councilConfig(['openai/a/m', 'openai/b/m']);
  let chairQ = '';
  const invoke = (m: CouncilMember, q: string) =>
    new Promise<string>((resolve) => {
      if (q.includes('Council opinions:')) {
        chairQ = q;
        resolve('RULING');
        return;
      }
      // openai/a/m settles LATER than openai/b/m
      const delay = m.displayId === 'openai/a/m' ? 30 : 5;
      setTimeout(() => resolve(`ans-${m.displayId}`), delay);
    });
  const backend = new CouncilBackend(cfg, undefined, 'sid', store, '', () => {}, { invoke, minTimeoutMs: 50 });
  await runCouncil(backend, new StreamEmitter('sid', 'council'), { text: 'Q', images: [] });
  const ai = chairQ.indexOf('### openai/a/m');
  const bi = chairQ.indexOf('### openai/b/m');
  assert.ok(ai >= 0 && bi >= 0 && ai < bi, 'roster order (a before b) must hold in synthesis input');
  cleanup();
});

test('council: exactly 1 success -> degraded note, no synthesis', async () => {
  const { store, cleanup } = tmpStore();
  const cfg = councilConfig(['openai/a/m', 'openai/b/m']);
  const invoke = (m: CouncilMember) =>
    m.displayId === 'openai/a/m' ? Promise.resolve('only-A') : Promise.reject(new Error('boom'));
  const backend = new CouncilBackend(cfg, undefined, 'sid', store, '', () => {}, { invoke, minTimeoutMs: 50 });
  const { transcript } = await runCouncil(backend, new StreamEmitter('sid', 'council'), {
    text: 'Q',
    images: [],
  });
  assert.ok(transcript.includes('only-A'));
  assert.ok(transcript.includes('Degraded'));
  assert.ok(!transcript.includes('Chair ruling'));
  cleanup();
});

test('council: 0 successes -> all-failed message, no chair', async () => {
  const { store, cleanup } = tmpStore();
  const cfg = councilConfig(['openai/a/m', 'openai/b/m']);
  const invoke = () => Promise.reject(new Error('kaboom'));
  const backend = new CouncilBackend(cfg, undefined, 'sid', store, '', () => {}, { invoke, minTimeoutMs: 50 });
  const { transcript } = await runCouncil(backend, new StreamEmitter('sid', 'council'), {
    text: 'Q',
    images: [],
  });
  assert.ok(transcript.includes('No council member produced an answer'));
  assert.ok(transcript.includes('kaboom'));
  assert.ok(!transcript.includes('Chair ruling'));
  cleanup();
});

test('council: chair fails -> deterministic fallback to first successful member', async () => {
  const { store, cleanup } = tmpStore();
  const cfg = councilConfig(['openai/a/m', 'openai/b/m']);
  // Chair defaults to the first available member (openai/a/m); fail its
  // synthesis call, succeed for the fallback (openai/b/m).
  const invoke = (m: CouncilMember, q: string) => {
    if (q.includes('Council opinions:')) {
      return m.displayId === 'openai/a/m'
        ? Promise.reject(new Error('chair-down'))
        : Promise.resolve('FALLBACK-RULING');
    }
    return Promise.resolve(`ans-${m.displayId}`);
  };
  const backend = new CouncilBackend(cfg, undefined, 'sid', store, '', () => {}, { invoke, minTimeoutMs: 50 });
  const { transcript } = await runCouncil(backend, new StreamEmitter('sid', 'council'), {
    text: 'Q',
    images: [],
  });
  assert.ok(transcript.includes('falling back to openai/b/m'));
  assert.ok(transcript.includes('FALLBACK-RULING'));
  cleanup();
});

test('council: chair and fallback both fail -> labelled collation preserves opinions', async () => {
  const { store, cleanup } = tmpStore();
  const cfg = councilConfig(['openai/a/m', 'openai/b/m']);
  const invoke = (m: CouncilMember, q: string) =>
    q.includes('Council opinions:') ? Promise.reject(new Error('down')) : Promise.resolve(`ans-${m.displayId}`);
  const backend = new CouncilBackend(cfg, undefined, 'sid', store, '', () => {}, { invoke, minTimeoutMs: 50 });
  const { transcript } = await runCouncil(backend, new StreamEmitter('sid', 'council'), {
    text: 'Q',
    images: [],
  });
  assert.ok(transcript.includes('Synthesis unavailable'));
  assert.ok(transcript.includes('ans-openai/a/m') && transcript.includes('ans-openai/b/m'));
  cleanup();
});

test('council: explicit external chair (not in roster) is used and labelled', async () => {
  const { store, cleanup } = tmpStore();
  const cfg: BridgeConfig = {
    version: 1,
    council: { members: ['openai/a/m', 'openai/b/m'], timeoutMs: 100 },
    openai: [
      { id: 'a', baseUrl: 'http://127.0.0.1:9/v1', models: ['m'] },
      { id: 'b', baseUrl: 'http://127.0.0.1:9/v1', models: ['m'] },
      { id: 'judge', baseUrl: 'http://127.0.0.1:9/v1', models: ['m'] },
    ],
  };
  const invoke = (m: CouncilMember, q: string) =>
    q.includes('Council opinions:') ? Promise.resolve('EXTERNAL-RULING') : Promise.resolve(`ans-${m.displayId}`);
  const backend = new CouncilBackend(cfg, 'openai/judge/m', 'sid', store, '', () => {}, {
    invoke,
    minTimeoutMs: 50,
  });
  const { transcript } = await runCouncil(backend, new StreamEmitter('sid', 'council'), {
    text: 'Q',
    images: [],
  });
  assert.ok(transcript.includes('external judge'));
  assert.ok(transcript.includes('EXTERNAL-RULING'));
  cleanup();
});

test('council: claude member is available when its CLI resolves, and becomes the default chair', async () => {
  const { store, cleanup } = tmpStore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claui-claude-'));
  const fakeCli = path.join(dir, process.platform === 'win32' ? 'claude.exe' : 'claude');
  fs.writeFileSync(fakeCli, '');
  const cfg: BridgeConfig = {
    version: 1,
    claude: { cliPath: fakeCli }, // absolute + existing -> cliExists() true
    council: { members: ['claude/opus', 'openai/a/m'], timeoutMs: 100 },
    openai: [{ id: 'a', baseUrl: 'http://127.0.0.1:9/v1', models: ['m'] }],
  };
  const invoke = async (m: CouncilMember, q: string) =>
    q.includes('Council opinions:') ? 'RULING' : `ans-${m.displayId}`;
  const backend = new CouncilBackend(cfg, undefined, 'sid', store, '', () => {}, { invoke, minTimeoutMs: 50 });
  const { transcript } = await runCouncil(backend, new StreamEmitter('sid', 'council'), { text: 'Q', images: [] });
  assert.ok(transcript.includes('### claude/opus'), 'claude member is available and fans out');
  assert.ok(transcript.includes('Chair ruling (claude/opus)'), 'available claude is the default chair');
  assert.ok(transcript.includes('RULING'));
  fs.rmSync(dir, { recursive: true, force: true });
  cleanup();
});

test('council: fewer than 2 available members -> diagnostic, no fan-out', async () => {
  const { store, cleanup } = tmpStore();
  delete process.env.__CLAUI_COUNCIL_MISSING__;
  const cfg: BridgeConfig = {
    version: 1,
    // antigravity is the always-deferred (never available) engine, so this stays
    // deterministic regardless of which CLIs happen to be installed on the host.
    council: { members: ['openai/ok/m', 'openai/nokey/m', 'antigravity'] },
    openai: [
      { id: 'ok', baseUrl: 'http://127.0.0.1:9/v1', models: ['m'] },
      { id: 'nokey', baseUrl: 'http://127.0.0.1:9/v1', apiKeyEnv: '__CLAUI_COUNCIL_MISSING__', models: ['m'] },
    ],
  };
  let invoked = false;
  const invoke = async () => {
    invoked = true;
    return 'x';
  };
  const backend = new CouncilBackend(cfg, undefined, 'sid', store, '', () => {}, { invoke, minTimeoutMs: 50 });
  const { transcript } = await runCouncil(backend, new StreamEmitter('sid', 'council'), {
    text: 'Q',
    images: [],
  });
  assert.ok(transcript.includes('needs at least 2 available'));
  assert.ok(transcript.includes('deferred to v2'), 'antigravity (deferred) reason surfaced');
  assert.ok(transcript.includes('API key not resolved'), 'declared-but-empty key surfaced');
  assert.equal(invoked, false, 'must not fan out with <2 available members');
  cleanup();
});

test('council: image attachments never dropped silently (text-only note appended)', async () => {
  const { store, cleanup } = tmpStore();
  const cfg = councilConfig(['openai/a/m', 'openai/b/m']);
  const seen: string[] = [];
  const invoke = async (m: CouncilMember, q: string) => {
    seen.push(q);
    return q.includes('Council opinions:') ? 'RULING' : 'ans';
  };
  const backend = new CouncilBackend(cfg, undefined, 'sid', store, '', () => {}, { invoke, minTimeoutMs: 50 });
  await runCouncil(backend, new StreamEmitter('sid', 'council'), {
    text: 'describe this',
    images: [{ mediaType: 'image/png', data: 'AAAA' }],
  });
  assert.ok(seen.some((q) => q.includes('council bridge is text-only')), 'image omit-note reached members');
  cleanup();
});

test('council: interrupt before synthesis suppresses sections and chair ruling', async () => {
  const { store, cleanup } = tmpStore();
  const cfg = councilConfig(['openai/a/m', 'openai/b/m']);
  const invoke = (_m: CouncilMember, _q: string, signal: AbortSignal) =>
    new Promise<string>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  const backend = new CouncilBackend(cfg, undefined, 'sid', store, '', () => {}, { invoke, minTimeoutMs: 50 });
  const { transcript } = await runCouncil(
    backend,
    new StreamEmitter('sid', 'council'),
    { text: 'Q', images: [] },
    { before: () => backend.interrupt() },
  );
  assert.ok(transcript.includes('## Council'), 'header emitted before interrupt');
  assert.ok(!transcript.includes('Chair ruling'), 'no synthesis after interrupt');
  assert.ok(!transcript.includes('### openai/a/m'), 'late member sections suppressed');
  cleanup();
});

test('council: per-member timeout marks members failed and skips synthesis', async () => {
  const { store, cleanup } = tmpStore();
  const cfg = councilConfig(['openai/a/m', 'openai/b/m'], 60);
  const invoke = (_m: CouncilMember, _q: string, signal: AbortSignal) =>
    new Promise<string>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  const backend = new CouncilBackend(cfg, undefined, 'sid', store, '', () => {}, { invoke, minTimeoutMs: 50 });
  const { transcript } = await runCouncil(backend, new StreamEmitter('sid', 'council'), {
    text: 'Q',
    images: [],
  });
  assert.ok(transcript.includes('timed out'));
  assert.ok(!transcript.includes('Chair ruling'));
  cleanup();
});

test('council: a member that ignores the abort signal still settles via the deadline race', async () => {
  const { store, cleanup } = tmpStore();
  const cfg = councilConfig(['openai/a/m', 'openai/b/m'], 60);
  // Never settles and never listens for abort — the invokeMember race must
  // still resolve the member as timed out (guarantees the turn cannot hang).
  const invoke = () => new Promise<string>(() => {});
  const backend = new CouncilBackend(cfg, undefined, 'sid', store, '', () => {}, { invoke, minTimeoutMs: 50 });
  const { transcript } = await runCouncil(backend, new StreamEmitter('sid', 'council'), {
    text: 'Q',
    images: [],
  });
  assert.ok(transcript.includes('timed out'));
  assert.ok(!transcript.includes('Chair ruling'));
  cleanup();
});

test('council: emits exactly one successful result and never a tool_use block', async () => {
  const { store, cleanup } = tmpStore();
  const cfg = councilConfig(['openai/a/m', 'openai/b/m']);
  const invoke = async (m: CouncilMember, q: string) =>
    q.includes('Council opinions:') ? 'RULING' : `ans-${m.displayId}`;
  const backend = new CouncilBackend(cfg, undefined, 'sid', store, '', () => {}, { invoke, minTimeoutMs: 50 });
  const { lines } = await runCouncil(
    backend,
    new StreamEmitter('sid', 'council'),
    { text: 'Q', images: [] },
    { emitResult: true },
  );
  const results = lines.filter((l) => l.type === 'result');
  assert.equal(results.length, 1, 'exactly one result line');
  assert.equal(results[0].subtype, 'success');
  assert.equal(
    lines.some((l) => JSON.stringify(l).includes('"tool_use"')),
    false,
    'council must never emit a tool_use block',
  );
  const idxStart = lines.findIndex(
    (l) => l.type === 'stream_event' && (l.event as { type?: string })?.type === 'message_start',
  );
  const idxResult = lines.findIndex((l) => l.type === 'result');
  assert.ok(idxStart >= 0 && idxStart < idxResult, 'message_start precedes the result');
  cleanup();
});

// ---------------------------------------------------------------------------
// reapChildrenThenCleanup — never delete a cwd while a child is still alive
// ---------------------------------------------------------------------------

test('reapChildrenThenCleanup: does not clean while a child is alive, then cleans after it dies', async () => {
  // A child that ignores SIGTERM and exits on its own after ~350ms.
  const child = spawnCli(
    process.execPath,
    ['-e', "process.on('SIGTERM',()=>{}); setTimeout(()=>process.exit(0),350)"],
    { stdio: 'ignore' },
  );
  try {
    await once(child, 'spawn');
  } catch {
    /* some platforms may already have started */
  }
  let cleaned = 0;
  // forceKill disabled so the child is left to exit on its own; short timings.
  reapChildrenThenCleanup([child], () => (cleaned += 1), {
    firstDelayMs: 40,
    pollMs: 40,
    maxAttempts: 30,
    forceKill: () => {},
  });
  await delay(150); // past the first fallback ticks — child still alive
  assert.equal(cleaned, 0, 'must NOT clean while the child is alive');
  await once(child, 'close');
  await delay(120); // let the next tick / close listener fire
  assert.equal(cleaned, 1, 'cleans exactly once after the child terminates');
});

// ---------------------------------------------------------------------------
// invokeCodexCouncil — real subprocess argv (read-only sandbox, throwaway cwd)
// ---------------------------------------------------------------------------

test('invokeCodexCouncil: passes --skip-git-repo-check (throwaway cwd is never a git repo)', async () => {
  // Fake "codex" CLI: a node script that dumps its argv as one JSONL
  // item.completed/agent_message event, matching the real CLI's output shape.
  // Wrapped in a shim (.cmd/.sh) so invokeCodexCouncil can spawn it directly
  // as a single `cliPath`, exactly like a real installed CLI.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claui-codex-fake-'));
  const fakeCli = path.join(dir, 'fake-codex.js');
  fs.writeFileSync(
    fakeCli,
    `process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(process.argv.slice(2))}})+'\\n');`,
  );
  const shim = path.join(dir, process.platform === 'win32' ? 'fake-codex.cmd' : 'fake-codex.sh');
  if (process.platform === 'win32') {
    fs.writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${fakeCli}" %*\r\n`);
  } else {
    fs.writeFileSync(shim, `#!/bin/sh\n"${process.execPath}" "${fakeCli}" "$@"\n`);
    fs.chmodSync(shim, 0o755);
  }
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'claui-codex-cwd-'));

  const result = await invokeCodexCouncil(shim, '', 'question', cwd, new AbortController().signal, () => {}, () => {});
  const argv: string[] = JSON.parse(result);
  assert.ok(argv.includes('--skip-git-repo-check'), 'must pass --skip-git-repo-check for the throwaway cwd');
  assert.ok(argv.includes('--sandbox') && argv.includes('read-only'), 'must stay read-only sandboxed');

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(cwd, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// invokeOpenAiCouncil — real HTTP one-shot (no tools, stream:false)
// ---------------------------------------------------------------------------

interface ServerHandle {
  port: number;
  lastBody: () => Record<string, unknown> | null;
  close: () => Promise<void>;
}

function startServer(handler: (res: http.ServerResponse) => void): Promise<ServerHandle> {
  let lastBody: Record<string, unknown> | null = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        lastBody = JSON.parse(body);
      } catch {
        lastBody = null;
      }
      handler(res);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({ port, lastBody: () => lastBody, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

test('invokeOpenAiCouncil: posts stream:false with no tools and returns content', async () => {
  const server = await startServer((res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'HELLO' } }] }));
  });
  const provider = { id: 'x', baseUrl: `http://127.0.0.1:${server.port}/v1`, models: ['m'] };
  const text = await invokeOpenAiCouncil(
    provider,
    'm',
    [{ role: 'user', content: 'q' }],
    new AbortController().signal,
  );
  assert.equal(text, 'HELLO');
  const body = server.lastBody()!;
  assert.equal(body.stream, false);
  assert.equal('tools' in body, false, 'no tools param (structurally non-mutating)');
  await server.close();
});

test('invokeOpenAiCouncil: HTTP error rejects with a clear message', async () => {
  const server = await startServer((res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end('{"error":"boom"}');
  });
  const provider = { id: 'x', baseUrl: `http://127.0.0.1:${server.port}/v1`, models: ['m'] };
  await assert.rejects(
    () => invokeOpenAiCouncil(provider, 'm', [{ role: 'user', content: 'q' }], new AbortController().signal),
    /HTTP 500/,
  );
  await server.close();
});

test('invokeOpenAiCouncil: an aborted request rejects', async () => {
  // Server that accepts the request but never responds until closed.
  let heldRes: http.ServerResponse | null = null;
  const server = await startServer((res) => {
    heldRes = res;
  });
  const provider = { id: 'x', baseUrl: `http://127.0.0.1:${server.port}/v1`, models: ['m'] };
  const controller = new AbortController();
  const p = invokeOpenAiCouncil(provider, 'm', [{ role: 'user', content: 'q' }], controller.signal);
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(() => p, /aborted/);
  try {
    heldRes?.end();
  } catch {
    /* ignore */
  }
  await server.close();
});
