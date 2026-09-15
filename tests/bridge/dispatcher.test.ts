import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  dispatchCommand,
  DispatchCtx,
  isToolPathActive,
  normalizeDiffBase,
} from '../../src/bridge-runtime/commands/dispatcher';
import { BridgeConfig } from '../../src/bridge-runtime/config';
import { BridgePrompt } from '../../src/bridge-runtime/protocol';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function makeRepo(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claui-dispatch-test-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'branch', '-M', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function ctx(cwd: string, overrides: Partial<DispatchCtx> = {}, config: BridgeConfig = { version: 1 }): DispatchCtx {
  return {
    backendKind: 'openai',
    toolCapable: false,
    permissionMode: 'supervised',
    config,
    cwd,
    log: () => {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

const prompt = (text: string): BridgePrompt => ({ text, images: [] });

test('dispatchCommand: unknown command passes through unchanged', async () => {
  const { dir, cleanup } = makeRepo();
  try {
    const outcome = await dispatchCommand(prompt('/not-a-real-command'), ctx(dir));
    assert.deepEqual(outcome, { kind: 'passthrough', writeWindow: false });
  } finally {
    cleanup();
  }
});

test('dispatchCommand: non-slash text passes through unchanged', async () => {
  const { dir, cleanup } = makeRepo();
  try {
    const outcome = await dispatchCommand(prompt('just chatting, no command'), ctx(dir));
    assert.deepEqual(outcome, { kind: 'passthrough', writeWindow: false });
  } finally {
    cleanup();
  }
});

test('dispatchCommand: /code-review rewrites the prompt and sets persistAs to the original text', async () => {
  const { dir, cleanup } = makeRepo();
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\nworld\n');
    const outcome = await dispatchCommand(prompt('/code-review'), ctx(dir));
    assert.equal(outcome.kind, 'rewrite');
    if (outcome.kind !== 'rewrite') return;
    assert.equal(outcome.prompt.persistAs, '/code-review');
    assert.notEqual(outcome.prompt.text, '/code-review');
    assert.match(outcome.prompt.text, /## Diff/);
    assert.match(outcome.prompt.text, /\+world/);
  } finally {
    cleanup();
  }
});

test('dispatchCommand: commandTools.enabled=false passes through', async () => {
  const { dir, cleanup } = makeRepo();
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\nworld\n');
    const outcome = await dispatchCommand(
      prompt('/code-review'),
      ctx(dir, {}, { version: 1, commandTools: { enabled: false } }),
    );
    assert.deepEqual(outcome, { kind: 'passthrough', writeWindow: false });
  } finally {
    cleanup();
  }
});

test('dispatchCommand: commandTools missing entirely still defaults to enabled', async () => {
  const { dir, cleanup } = makeRepo();
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\nworld\n');
    const outcome = await dispatchCommand(prompt('/code-review'), ctx(dir, {}, { version: 1 }));
    assert.equal(outcome.kind, 'rewrite');
  } finally {
    cleanup();
  }
});

test('dispatchCommand: a tool-capable backend on strategy=auto passes through (Layer B calls the tool itself)', async () => {
  const { dir, cleanup } = makeRepo();
  try {
    const outcome = await dispatchCommand(prompt('/code-review'), ctx(dir, { toolCapable: true }, { version: 1 }));
    assert.deepEqual(outcome, { kind: 'passthrough', writeWindow: false });
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Write window (Section 6): --fix on a mutating command, tool strategy only
// ---------------------------------------------------------------------------

test('dispatchCommand: /simplify --fix under supervised opens a write window', async () => {
  const { dir, cleanup } = makeRepo();
  try {
    const outcome = await dispatchCommand(
      prompt('/simplify --fix'),
      ctx(dir, { toolCapable: true, permissionMode: 'supervised' }, { version: 1 }),
    );
    assert.deepEqual(outcome, { kind: 'passthrough', writeWindow: true });
  } finally {
    cleanup();
  }
});

test('dispatchCommand: /simplify without --fix under supervised does NOT open a write window', async () => {
  const { dir, cleanup } = makeRepo();
  try {
    const outcome = await dispatchCommand(
      prompt('/simplify'),
      ctx(dir, { toolCapable: true, permissionMode: 'supervised' }, { version: 1 }),
    );
    assert.deepEqual(outcome, { kind: 'passthrough', writeWindow: false });
  } finally {
    cleanup();
  }
});

test('dispatchCommand: /simplify under full-access opens a write window even without --fix', async () => {
  const { dir, cleanup } = makeRepo();
  try {
    const outcome = await dispatchCommand(
      prompt('/simplify'),
      ctx(dir, { toolCapable: true, permissionMode: 'full-access' }, { version: 1 }),
    );
    assert.deepEqual(outcome, { kind: 'passthrough', writeWindow: true });
  } finally {
    cleanup();
  }
});

test('dispatchCommand: /code-review --fix never opens a write window (code-review is not marked mutates)', async () => {
  const { dir, cleanup } = makeRepo();
  try {
    const outcome = await dispatchCommand(
      prompt('/code-review --fix'),
      ctx(dir, { toolCapable: true, permissionMode: 'full-access' }, { version: 1 }),
    );
    assert.deepEqual(outcome, { kind: 'passthrough', writeWindow: false });
  } finally {
    cleanup();
  }
});

test('dispatchCommand: --fix as a substring of another token does not count as the flag', async () => {
  const { dir, cleanup } = makeRepo();
  try {
    const outcome = await dispatchCommand(
      prompt('/simplify --fixup-later'),
      ctx(dir, { toolCapable: true, permissionMode: 'supervised' }, { version: 1 }),
    );
    assert.deepEqual(outcome, { kind: 'passthrough', writeWindow: false });
  } finally {
    cleanup();
  }
});

test('dispatchCommand: /simplify --fix on a non-tool-capable backend never opens a write window (macro has no write mechanism)', async () => {
  const { dir, cleanup } = makeRepo();
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\nworld\n');
    const outcome = await dispatchCommand(
      prompt('/simplify --fix'),
      ctx(dir, { toolCapable: false, permissionMode: 'full-access' }, { version: 1 }),
    );
    // toolCapable=false -> macro strategy -> 'rewrite', which has no
    // writeWindow field at all (Layer A write-back is deferred).
    assert.equal(outcome.kind, 'rewrite');
  } finally {
    cleanup();
  }
});

test('dispatchCommand: strategy=tool on a non-tool-capable backend falls back to macro', async () => {
  const { dir, cleanup } = makeRepo();
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\nworld\n');
    const outcome = await dispatchCommand(
      prompt('/code-review'),
      ctx(dir, { toolCapable: false }, { version: 1, commandTools: { strategy: 'tool' } }),
    );
    assert.equal(outcome.kind, 'rewrite');
  } finally {
    cleanup();
  }
});

test('dispatchCommand: strategy=offload degrades to macro when the offload CLI is not available', async () => {
  const { dir, cleanup } = makeRepo();
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\nworld\n');
    const outcome = await dispatchCommand(
      prompt('/code-review'),
      ctx(dir, {}, {
        version: 1,
        commandTools: { strategy: 'offload', offload: true },
        // Absolute + guaranteed-nonexistent, so offloadCliAvailable() is
        // false regardless of whether this machine happens to have a real
        // `claude` on PATH (a dev machine running ClaUi tests very plausibly
        // does) — this test must never depend on host-machine state, and
        // must never actually spawn a real claude process (see the plan's
        // own "do not shell out to a real claude in CI" instruction).
        claude: { cliPath: path.join(dir, 'definitely-does-not-exist', 'claude.exe') },
      }),
    );
    assert.equal(outcome.kind, 'rewrite');
    if (outcome.kind !== 'rewrite') return;
    // Both a successful offload and a degraded-to-macro fallback are now
    // 'rewrite' outcomes (offload injects its result as a relay prompt,
    // same shape as macro) — distinguish them by content, not just kind.
    assert.match(outcome.prompt.text, /## Diff/, 'expected the macro packet, not an offload relay prompt');
    assert.ok(!/co-processor/.test(outcome.prompt.text), 'must not claim to be an offload result');
  } finally {
    cleanup();
  }
});

test('dispatchCommand: a truthy-but-not-boolean-true commandTools.offload value (hand-edited bridge.json) never enables offload', async () => {
  const { dir, cleanup } = makeRepo();
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\nworld\n');
    for (const garbageOffload of ['false', 'true', {}, 1] as unknown[]) {
      const outcome = await dispatchCommand(
        prompt('/code-review'),
        ctx(dir, {}, {
          version: 1,
          commandTools: { strategy: 'offload', offload: garbageOffload as unknown as boolean },
        }),
      );
      assert.equal(outcome.kind, 'rewrite', `garbage offload value ${JSON.stringify(garbageOffload)} should not enable offload`);
      if (outcome.kind === 'rewrite') {
        assert.match(outcome.prompt.text, /## Diff/, JSON.stringify(garbageOffload));
      }
    }
  } finally {
    cleanup();
  }
});

test('dispatchCommand: strategy=macro forces the macro path even on a tool-capable backend', async () => {
  const { dir, cleanup } = makeRepo();
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\nworld\n');
    const outcome = await dispatchCommand(
      prompt('/code-review'),
      ctx(dir, { toolCapable: true }, { version: 1, commandTools: { strategy: 'macro' } }),
    );
    assert.equal(outcome.kind, 'rewrite');
  } finally {
    cleanup();
  }
});

test('dispatchCommand: a garbage strategy value from a hand-edited bridge.json falls back to auto', async () => {
  const { dir, cleanup } = makeRepo();
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\nworld\n');
    const garbageConfig: BridgeConfig = {
      version: 1,
      commandTools: { strategy: 'not-a-real-strategy' as unknown as 'auto' },
    };
    // toolCapable defaults to false in ctx(), so 'auto' behaves like 'macro' here.
    const outcome = await dispatchCommand(prompt('/code-review'), ctx(dir, {}, garbageConfig));
    assert.equal(outcome.kind, 'rewrite');
  } finally {
    cleanup();
  }
});

test('isToolPathActive: enabled + auto/tool/offload -> true; disabled or forced macro -> false', () => {
  assert.equal(isToolPathActive({ version: 1 }), true); // missing commandTools -> default enabled
  assert.equal(isToolPathActive({ version: 1, commandTools: { enabled: true } }), true);
  assert.equal(isToolPathActive({ version: 1, commandTools: { enabled: true, strategy: 'tool' } }), true);
  assert.equal(isToolPathActive({ version: 1, commandTools: { enabled: true, strategy: 'offload' } }), true);
  assert.equal(isToolPathActive({ version: 1, commandTools: { enabled: false } }), false);
  assert.equal(isToolPathActive({ version: 1, commandTools: { enabled: true, strategy: 'macro' } }), false);
  // Both conditions must fail together for a correct AND, not just either one.
  assert.equal(isToolPathActive({ version: 1, commandTools: { enabled: false, strategy: 'macro' } }), false);
});

test('isToolPathActive: strategy=macro suppresses the tool path even though dispatchCommand would still macro-rewrite the same command either way', async () => {
  // Regression for the exact bug: registering Grok's MCP server should be
  // gated the SAME way dispatchCommand's own per-command decision is, so
  // forcing macro actually stops the server from ever being registered
  // (not just stops the dispatcher from choosing 'tool' for a given turn).
  const config: BridgeConfig = { version: 1, commandTools: { strategy: 'macro' } };
  assert.equal(isToolPathActive(config), false);

  const { dir, cleanup } = makeRepo();
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\nworld\n');
    const outcome = await dispatchCommand(prompt('/code-review'), ctx(dir, { toolCapable: true }, config));
    assert.equal(outcome.kind, 'rewrite');
  } finally {
    cleanup();
  }
});

test('normalizeDiffBase: coerces non-string/garbage config values into a safe string, never throws', () => {
  assert.equal(normalizeDiffBase(undefined), 'main');
  assert.equal(normalizeDiffBase(null), 'main');
  assert.equal(normalizeDiffBase(''), 'main');
  assert.equal(normalizeDiffBase('   '), 'main');
  assert.equal(normalizeDiffBase('develop'), 'develop');
  assert.equal(normalizeDiffBase('  develop  '), 'develop');
  // A hand-edited bridge.json could carry a non-string here (schema-free
  // JSON) — must fall back to 'main' rather than coercing a number/object
  // into a bogus-but-"valid-looking" git ref (e.g. "123" or
  // "[object Object]"), which would silently replace the documented default
  // with garbage instead of actually defaulting.
  assert.equal(normalizeDiffBase(123), 'main');
  assert.equal(normalizeDiffBase({ nested: true }), 'main');
  assert.equal(normalizeDiffBase([1, 2, 3]), 'main');
  assert.equal(normalizeDiffBase(true), 'main');
});

test('dispatchCommand: an alias resolves to the same command', async () => {
  const { dir, cleanup } = makeRepo();
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\nworld\n');
    const outcome = await dispatchCommand(prompt('/review extra text'), ctx(dir));
    assert.equal(outcome.kind, 'rewrite');
    if (outcome.kind !== 'rewrite') return;
    assert.equal(outcome.prompt.persistAs, '/review extra text');
  } finally {
    cleanup();
  }
});
