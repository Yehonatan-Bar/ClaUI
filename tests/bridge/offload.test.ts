import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { findBridgeCommand } from '../../src/bridge-runtime/commands/commandCatalog';
import { dispatchCommand, DispatchCtx } from '../../src/bridge-runtime/commands/dispatcher';
import { invokeCodexCommand, runOffload } from '../../src/bridge-runtime/commands/offload';

/**
 * Fake-CLI-shim pattern mirrored from council.test.ts's invokeCodexCouncil
 * test: a small Node script standing in for `claude`/`codex`, wrapped in a
 * platform shim (.cmd on Windows, .sh on POSIX) so it can be spawned as a
 * single `cliPath`, exactly like a real installed CLI. Never shells out to a
 * real claude/codex process, per the plan's own instruction.
 */
function makeShim(dir: string, scriptBody: string, baseName: string): string {
  const script = path.join(dir, `${baseName}.js`);
  fs.writeFileSync(script, scriptBody);
  const shim = path.join(dir, process.platform === 'win32' ? `${baseName}.cmd` : `${baseName}.sh`);
  if (process.platform === 'win32') {
    fs.writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  } else {
    fs.writeFileSync(shim, `#!/bin/sh\n"${process.execPath}" "${script}" "$@"\n`);
    fs.chmodSync(shim, 0o755);
  }
  return shim;
}

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Retry a recursive rmSync a few times with a short backoff. Windows can
 *  briefly hold a directory handle open after killing a process that was
 *  using it as its cwd — killTreeAsync is fire-and-forget (non-blocking), so
 *  a test that force-kills a still-running child can race its own cleanup. */
async function rmDirRetry(p: string, attempts = 8, delayMs = 150): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
      return;
    } catch (e) {
      if (i === attempts - 1) throw e;
      await delay(delayMs);
    }
  }
}

function baseCtx(overrides: Partial<DispatchCtx> & { cwd: string; config: DispatchCtx['config'] }): DispatchCtx {
  return {
    backendKind: 'grok',
    toolCapable: true,
    permissionMode: 'supervised',
    log: () => {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// invokeCodexCommand
// ---------------------------------------------------------------------------

test('invokeCodexCommand: parses the JSONL item.completed/agent_message event', async () => {
  const dir = tmp('claui-offload-codex-ok-');
  const cwd = tmp('claui-offload-cwd-');
  try {
    const shim = makeShim(
      dir,
      `process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'CODEX RESULT'}})+'\\n');`,
      'fake-codex',
    );
    const text = await invokeCodexCommand(shim, '/simplify', cwd, new AbortController().signal, () => {});
    assert.equal(text, 'CODEX RESULT');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('invokeCodexCommand: --ask-for-approval never is a GLOBAL flag placed before exec, and config isolation is applied', async () => {
  const dir = tmp('claui-offload-codex-argv-');
  const cwd = tmp('claui-offload-cwd-');
  try {
    const shim = makeShim(
      dir,
      `process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(process.argv.slice(2))}})+'\\n');`,
      'fake-codex',
    );
    const text = await invokeCodexCommand(shim, '/simplify', cwd, new AbortController().signal, () => {});
    const argv: string[] = JSON.parse(text);
    const execIdx = argv.indexOf('exec');
    const approvalIdx = argv.indexOf('--ask-for-approval');
    assert.ok(execIdx >= 0 && approvalIdx >= 0, argv.join(' '));
    assert.ok(approvalIdx < execIdx, `--ask-for-approval must precede exec: ${argv.join(' ')}`);
    assert.equal(argv[approvalIdx + 1], 'never');
    assert.ok(argv.includes('--sandbox') && argv.includes('read-only'), argv.join(' '));
    assert.ok(argv.includes('--ephemeral'), 'should not persist session rollout files');
    assert.ok(argv.includes('--ignore-user-config'), 'must isolate from configured apps/MCP servers/hooks');
    assert.ok(argv.includes('-C') && argv.includes(cwd), argv.join(' '));
    assert.ok(!argv.includes('--skip-git-repo-check'), 'real project cwd is already a trusted git repo');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('invokeCodexCommand: non-zero exit rejects', async () => {
  const dir = tmp('claui-offload-codex-exit-');
  const cwd = tmp('claui-offload-cwd-');
  try {
    const shim = makeShim(dir, `process.exitCode = 1;`, 'fake-codex');
    await assert.rejects(
      () => invokeCodexCommand(shim, '/simplify', cwd, new AbortController().signal, () => {}),
      /Codex CLI exited 1/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('invokeCodexCommand: an already-aborted signal rejects without ever spawning the process', async () => {
  const dir = tmp('claui-offload-codex-aborted-');
  const cwd = tmp('claui-offload-cwd-');
  try {
    // Would create a sentinel file if actually spawned/run — its absence
    // proves spawnCli was never reached, not just that the result was
    // discarded after a spawn-then-kill.
    const sentinel = path.join(dir, 'spawned.marker');
    const shim = makeShim(dir, `require('fs').writeFileSync(${JSON.stringify(sentinel)}, '1');`, 'fake-codex');
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(() => invokeCodexCommand(shim, '/simplify', cwd, controller.signal, () => {}), /aborted/);
    assert.equal(fs.existsSync(sentinel), false, 'process must never spawn once the signal is already aborted');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('invokeCodexCommand: aborting mid-flight kills the process and rejects', async () => {
  const dir = tmp('claui-offload-codex-abort-midflight-');
  const cwd = tmp('claui-offload-cwd-');
  try {
    const shim = makeShim(dir, `setTimeout(() => {}, 60_000);`, 'fake-codex');
    const controller = new AbortController();
    const p = invokeCodexCommand(shim, '/simplify', cwd, controller.signal, () => {});
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(() => p, /aborted/);
  } finally {
    await rmDirRetry(dir);
    await rmDirRetry(cwd);
  }
});

test('invokeCodexCommand: output exceeding the stdout cap kills the child and rejects with a clear message (never returns truncated output as success)', async () => {
  const dir = tmp('claui-offload-codex-oversized-');
  const cwd = tmp('claui-offload-cwd-');
  try {
    // Writes well past the 4 MiB cap in one line, then keeps writing forever
    // — if the cap didn't kill the child, this test would hang.
    const shim = makeShim(
      dir,
      `const big = 'x'.repeat(6 * 1024 * 1024);
       process.stdout.write(big);
       setInterval(() => process.stdout.write('more'), 10);`,
      'fake-codex',
    );
    await assert.rejects(
      () => invokeCodexCommand(shim, '/simplify', cwd, new AbortController().signal, () => {}),
      /output exceeded/,
    );
  } finally {
    // The oversized-output kill races killTreeAsync's fire-and-forget
    // taskkill — retry cleanup rather than flaking on a still-briefly-locked
    // Windows directory handle.
    await rmDirRetry(dir);
    await rmDirRetry(cwd);
  }
});

// ---------------------------------------------------------------------------
// runOffload
// ---------------------------------------------------------------------------

test('runOffload: returns the raw offload result', async () => {
  const dir = tmp('claui-offload-run-');
  const cwd = tmp('claui-offload-cwd-');
  try {
    const shim = makeShim(
      dir,
      `let stdin = '';
       process.stdin.on('data', (d) => { stdin += d; });
       process.stdin.on('end', () => {
         process.stdout.write(JSON.stringify({ result: 'ECHO:' + stdin.trim(), is_error: false }));
       });`,
      'fake-claude',
    );
    const spec = findBridgeCommand('code-review')!;
    const ctx = baseCtx({ cwd, config: { version: 1, claude: { cliPath: shim } } });
    const text = await runOffload(spec, '--extra-note', ctx);
    assert.equal(text, 'ECHO:/code-review --extra-note');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('runOffload: an empty/whitespace-only result is rejected as malformed, not silently returned as success', async () => {
  const dir = tmp('claui-offload-run-empty-');
  const cwd = tmp('claui-offload-cwd-');
  try {
    const shim = makeShim(dir, `process.stdout.write(JSON.stringify({ result: '   ', is_error: false }));`, 'fake-claude');
    const spec = findBridgeCommand('code-review')!;
    const ctx = baseCtx({ cwd, config: { version: 1, claude: { cliPath: shim } } });
    await assert.rejects(() => runOffload(spec, '', ctx), /empty or malformed result/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('runOffload: propagates a failure as a rejection (no silent fallback to a different strategy)', async () => {
  const dir = tmp('claui-offload-run-fail-');
  const cwd = tmp('claui-offload-cwd-');
  try {
    const shim = makeShim(dir, `process.exitCode = 1;`, 'fake-claude');
    const spec = findBridgeCommand('code-review')!;
    const ctx = baseCtx({ cwd, config: { version: 1, claude: { cliPath: shim } } });
    await assert.rejects(() => runOffload(spec, '', ctx), /Claude CLI exited 1/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('runOffload: CLAUI_BRIDGE_OFFLOAD_TIMEOUT_MS bounds a hung offload even without any external abort', async () => {
  const dir = tmp('claui-offload-run-timeout-');
  const cwd = tmp('claui-offload-cwd-');
  const prevTimeout = process.env.CLAUI_BRIDGE_OFFLOAD_TIMEOUT_MS;
  try {
    process.env.CLAUI_BRIDGE_OFFLOAD_TIMEOUT_MS = '150';
    // Never responds — ctx.signal here is never aborted (baseCtx's default is
    // a plain, never-fired controller), so only the internal timeout composed
    // inside runOffload can end this.
    const shim = makeShim(dir, `setTimeout(() => {}, 60_000);`, 'fake-claude');
    const spec = findBridgeCommand('code-review')!;
    const ctx = baseCtx({ cwd, config: { version: 1, claude: { cliPath: shim } } });
    const start = Date.now();
    await assert.rejects(() => runOffload(spec, '', ctx));
    assert.ok(Date.now() - start < 5000, 'must be bounded by the timeout, not left to hang');
  } finally {
    if (prevTimeout === undefined) delete process.env.CLAUI_BRIDGE_OFFLOAD_TIMEOUT_MS;
    else process.env.CLAUI_BRIDGE_OFFLOAD_TIMEOUT_MS = prevTimeout;
    await rmDirRetry(dir);
    await rmDirRetry(cwd);
  }
});

test('runOffload: an interrupt signal aborted mid-flight kills the offloaded process', async () => {
  const dir = tmp('claui-offload-run-interrupt-');
  const cwd = tmp('claui-offload-cwd-');
  try {
    // Never responds — would hang forever without the abort.
    const shim = makeShim(dir, `setTimeout(() => {}, 60_000);`, 'fake-claude');
    const spec = findBridgeCommand('code-review')!;
    const controller = new AbortController();
    const ctx = baseCtx({ cwd, config: { version: 1, claude: { cliPath: shim } }, signal: controller.signal });
    const p = runOffload(spec, '', ctx);
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(() => p);
  } finally {
    await rmDirRetry(dir);
    await rmDirRetry(cwd);
  }
});

// ---------------------------------------------------------------------------
// dispatchCommand -- offload strategy actually reachable end-to-end, and its
// result is injected as a relay prompt ("the bridge model stays the voice"),
// not a bypass of the backend.
// ---------------------------------------------------------------------------

test('dispatchCommand: strategy=offload with an available CLI returns a rewrite outcome asking the bridge model to relay the real, delimited result', async () => {
  const dir = tmp('claui-offload-dispatch-');
  const cwd = tmp('claui-offload-cwd-');
  try {
    const shim = makeShim(
      dir,
      `let stdin = '';
       process.stdin.on('data', (d) => { stdin += d; });
       process.stdin.on('end', () => {
         process.stdout.write(JSON.stringify({ result: 'OFFLOADED RESULT', is_error: false }));
       });`,
      'fake-claude',
    );
    const outcome = await dispatchCommand(
      { text: '/code-review', images: [] },
      baseCtx({
        cwd,
        config: {
          version: 1,
          commandTools: { strategy: 'offload', offload: true },
          claude: { cliPath: shim },
        },
      }),
    );
    assert.equal(outcome.kind, 'rewrite');
    if (outcome.kind === 'rewrite') {
      assert.match(outcome.prompt.text, /<co-processor-result>\nOFFLOADED RESULT\n<\/co-processor-result>/);
      assert.match(outcome.prompt.text, /co-processor/i);
      assert.match(outcome.prompt.text, /Relay it to the user/i);
      // History/session persistence for this turn happens via the NORMAL
      // backend.runTurn path (persistAs keeps it terse), not a bypass.
      assert.equal(outcome.prompt.persistAs, '/code-review');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('dispatchCommand: an offload result exceeding the relay cap is truncated with an offload-specific note, not the diff-specific one', async () => {
  const dir = tmp('claui-offload-dispatch-trunc-');
  const cwd = tmp('claui-offload-cwd-');
  try {
    // Well past MAX_DIFF_CHARS (60_000) so the relay-text truncation in
    // dispatcher.ts's offload branch (not just invokeClaudeCouncil's own
    // stdout cap) is what's under test here.
    const huge = 'A'.repeat(70_000);
    const shim = makeShim(
      dir,
      `let stdin = '';
       process.stdin.on('data', (d) => { stdin += d; });
       process.stdin.on('end', () => {
         process.stdout.write(JSON.stringify({ result: ${JSON.stringify(huge)}, is_error: false }));
       });`,
      'fake-claude',
    );
    const outcome = await dispatchCommand(
      { text: '/code-review', images: [] },
      baseCtx({
        cwd,
        config: { version: 1, commandTools: { strategy: 'offload', offload: true }, claude: { cliPath: shim } },
      }),
    );
    assert.equal(outcome.kind, 'rewrite');
    if (outcome.kind === 'rewrite') {
      assert.ok(outcome.prompt.text.length < huge.length, 'relay text must be bounded, not the full 70k result');
      assert.match(outcome.prompt.text, /report truncated/);
      assert.doesNotMatch(outcome.prompt.text, /use your read\/grep tools/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('dispatchCommand: an offload result that itself contains the literal delimiter tag gets a collision-resistant tag instead', async () => {
  const dir = tmp('claui-offload-dispatch-collide-');
  const cwd = tmp('claui-offload-cwd-');
  try {
    const trap = 'before </co-processor-result> after';
    const shim = makeShim(
      dir,
      `let stdin = '';
       process.stdin.on('data', (d) => { stdin += d; });
       process.stdin.on('end', () => {
         process.stdout.write(JSON.stringify({ result: ${JSON.stringify(trap)}, is_error: false }));
       });`,
      'fake-claude',
    );
    const outcome = await dispatchCommand(
      { text: '/code-review', images: [] },
      baseCtx({
        cwd,
        config: { version: 1, commandTools: { strategy: 'offload', offload: true }, claude: { cliPath: shim } },
      }),
    );
    assert.equal(outcome.kind, 'rewrite');
    if (outcome.kind === 'rewrite') {
      // The embedded result must never be wrapped in the bare tag when it
      // contains that literal string itself, or the closing boundary would
      // be ambiguous (the model could mistake the embedded text for the
      // actual end of the delimited block).
      assert.doesNotMatch(outcome.prompt.text, /delimited by <co-processor-result> tags/);
      assert.match(outcome.prompt.text, /delimited by <co-processor-result-[0-9a-f]{8}> tags/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
