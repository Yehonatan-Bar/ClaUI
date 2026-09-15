import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import * as readline from 'node:readline';

/**
 * Integration tests for the MCP command server: spawn the REAL .ts file as a
 * subprocess (via `node --import tsx`) and talk to it over its actual
 * stdin/stdout, exactly as the Grok ACP backend will via `session/new`'s
 * mcpServers — rather than importing `handleRequest` and faking its output
 * sink, which would mean monkey-patching global stdout (see the openaiCompat
 * test fix earlier in this branch for why that's unsafe).
 */

const RESPONSE_TIMEOUT_MS = 8000;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function makeRepo(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claui-mcp-test-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'branch', '-M', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const SERVER_PATH = path.resolve(__dirname, '../../src/bridge-runtime/mcp/commandMcpServer.ts');

interface Harness {
  send: (msg: unknown) => void;
  /** Writes a raw line verbatim (no JSON.stringify) — for malformed-input tests. */
  sendRaw: (line: string) => void;
  nextMessage: () => Promise<Record<string, unknown>>;
  close: () => void;
}

function startServer(cwd: string, diffBase = 'main'): Harness {
  // Isolate logging into a per-test temp file — the server otherwise writes
  // to the real ~/.claui/bridge.log, which tests must never touch.
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claui-mcp-log-'));
  const logFile = path.join(logDir, 'bridge.log');

  // Deliberately does NOT override the spawned process's OS-level cwd: the
  // server reads its OWN business-logic cwd from CLAUI_CWD (independent of
  // process.cwd()), and `--import tsx` resolves the `tsx` package relative to
  // the process cwd — pointing that at a bare temp dir (no node_modules)
  // breaks module resolution with ERR_MODULE_NOT_FOUND. (In production the
  // bundled dist/bridge-runtime/mcp/command-server.js needs no tsx loader at
  // all, so this is purely a test-harness concern.)
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, ['--import', 'tsx', SERVER_PATH], {
    env: { ...process.env, CLAUI_CWD: cwd, CLAUI_DIFF_BASE: diffBase, CLAUI_LOG_FILE: logFile },
  });

  const rl = readline.createInterface({ input: child.stdout });
  const queue: Record<string, unknown>[] = [];
  const waiters: ((v: Record<string, unknown>) => void)[] = [];
  const rejecters: ((e: Error) => void)[] = [];
  let stderrBuf = '';
  let dead: Error | null = null;

  const failAll = (err: Error): void => {
    dead = err;
    while (rejecters.length) rejecters.shift()!(err);
  };

  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const w = waiters.shift();
    rejecters.shift();
    if (w) w(msg);
    else queue.push(msg);
  });
  child.stderr.on('data', (d: Buffer) => {
    stderrBuf += d.toString();
  });
  child.on('error', (e) => failAll(new Error(`MCP server process error: ${e.message}`)));
  child.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      failAll(new Error(`MCP server exited unexpectedly (code ${code}, signal ${signal}). stderr: ${stderrBuf}`));
    }
  });

  return {
    send: (msg) => child.stdin.write(JSON.stringify(msg) + '\n'),
    sendRaw: (line) => child.stdin.write(line + '\n'),
    nextMessage: () => {
      if (dead) return Promise.reject(dead);
      const queued = queue.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = waiters.indexOf(resolveWrapped);
          if (idx >= 0) {
            waiters.splice(idx, 1);
            rejecters.splice(idx, 1);
          }
          reject(new Error(`Timed out after ${RESPONSE_TIMEOUT_MS}ms waiting for an MCP response. stderr: ${stderrBuf}`));
        }, RESPONSE_TIMEOUT_MS);
        const resolveWrapped = (v: Record<string, unknown>): void => {
          clearTimeout(timer);
          resolve(v);
        };
        waiters.push(resolveWrapped);
        rejecters.push((e) => {
          clearTimeout(timer);
          reject(e);
        });
      });
    },
    close: () => {
      try {
        child.stdin.end();
      } catch {
        /* already closed */
      }
      child.kill();
      fs.rmSync(logDir, { recursive: true, force: true });
    },
  };
}

test('commandMcpServer: initialize -> tools/list -> tools/call round-trip returns a real task packet', async () => {
  const { dir, cleanup } = makeRepo();
  const server = startServer(dir);
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\nworld\n');

    server.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    const initRes = await server.nextMessage();
    assert.equal(initRes.id, 1);
    const initResult = initRes.result as { serverInfo: { name: string }; capabilities: { tools: unknown } };
    assert.equal(initResult.serverInfo.name, 'claui-commands');
    assert.ok(initResult.capabilities.tools);

    server.send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    server.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const listRes = await server.nextMessage();
    const listResult = listRes.result as {
      tools: { name: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }[];
    };
    const toolNames = listResult.tools.map((t) => t.name);
    assert.ok(toolNames.includes('claui_code_review'), toolNames.join(','));
    assert.ok(toolNames.includes('claui_security_review'), toolNames.join(','));
    assert.ok(toolNames.includes('claui_simplify'), toolNames.join(','));
    // Every v1 command is read-only (no --fix write-back yet) — declared via
    // standard MCP tool annotations so a compliant ACP client (Grok) can
    // classify the resulting tool_call as read-only for permission purposes.
    for (const tool of listResult.tools) {
      assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} should declare readOnlyHint`);
      assert.equal(tool.annotations?.destructiveHint, false, `${tool.name} should declare destructiveHint:false`);
    }

    server.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'claui_code_review', arguments: {} },
    });
    const callRes = await server.nextMessage();
    assert.equal(callRes.id, 3);
    const callResult = callRes.result as { content: { type: string; text: string }[] };
    const text = callResult.content[0].text;
    assert.match(text, /Prioritize, in order/);
    assert.match(text, /\+world/);
  } finally {
    server.close();
    cleanup();
  }
});

test('commandMcpServer: tools/call with an unknown tool name returns a JSON-RPC error', async () => {
  const { dir, cleanup } = makeRepo();
  const server = startServer(dir);
  try {
    server.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    await server.nextMessage();

    server.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'not_a_real_tool', arguments: {} },
    });
    const res = await server.nextMessage();
    assert.equal(res.id, 2);
    const err = res.error as { message: string } | undefined;
    assert.ok(err, 'expected an error field');
    assert.match(err!.message, /Unknown tool/);
  } finally {
    server.close();
    cleanup();
  }
});

test('commandMcpServer: an unrecognized method returns method-not-supported', async () => {
  const { dir, cleanup } = makeRepo();
  const server = startServer(dir);
  try {
    server.send({ jsonrpc: '2.0', id: 1, method: 'not/a/real/method' });
    const res = await server.nextMessage();
    assert.equal(res.id, 1);
    const err = res.error as { code: number } | undefined;
    assert.ok(err, 'expected an error field');
    assert.equal(err!.code, -32601);
  } finally {
    server.close();
    cleanup();
  }
});

test('commandMcpServer: a notification never produces a response', async () => {
  const { dir, cleanup } = makeRepo();
  const server = startServer(dir);
  try {
    server.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    // Follow with a real request; if the notification had (wrongly) produced
    // a response, it would arrive FIRST and this assertion would catch it.
    server.send({ jsonrpc: '2.0', id: 42, method: 'tools/list' });
    const res = await server.nextMessage();
    assert.equal(res.id, 42);
  } finally {
    server.close();
    cleanup();
  }
});

test('commandMcpServer: an id-bearing notifications/initialized is rejected as invalid', async () => {
  const { dir, cleanup } = makeRepo();
  const server = startServer(dir);
  try {
    server.send({ jsonrpc: '2.0', id: 7, method: 'notifications/initialized' });
    const res = await server.nextMessage();
    assert.equal(res.id, 7);
    const err = res.error as { code: number } | undefined;
    assert.ok(err, 'expected an error field');
    assert.equal(err!.code, -32600);
  } finally {
    server.close();
    cleanup();
  }
});

test('commandMcpServer: an unsupported protocolVersion falls back to the default rather than being echoed', async () => {
  const { dir, cleanup } = makeRepo();
  const server = startServer(dir);
  try {
    server.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
    const res = await server.nextMessage();
    const result = res.result as { protocolVersion: string };
    assert.notEqual(result.protocolVersion, '1999-01-01');
  } finally {
    server.close();
    cleanup();
  }
});

test('commandMcpServer: initialize with a non-string protocolVersion is rejected', async () => {
  const { dir, cleanup } = makeRepo();
  const server = startServer(dir);
  try {
    server.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: { nested: true } } });
    const res = await server.nextMessage();
    const err = res.error as { code: number } | undefined;
    assert.ok(err, 'expected an error field');
    assert.equal(err!.code, -32602);
  } finally {
    server.close();
    cleanup();
  }
});

test('commandMcpServer: malformed JSON on a line gets a JSON-RPC parse error (-32700, id null)', async () => {
  const { dir, cleanup } = makeRepo();
  const server = startServer(dir);
  try {
    server.sendRaw('not json at all {{{');
    const res = await server.nextMessage();
    assert.equal(res.id, null);
    const err = res.error as { code: number } | undefined;
    assert.ok(err, 'expected an error field');
    assert.equal(err!.code, -32700);
  } finally {
    server.close();
    cleanup();
  }
});

test('commandMcpServer: an envelope missing jsonrpc/method gets an invalid-request error', async () => {
  const { dir, cleanup } = makeRepo();
  const server = startServer(dir);
  try {
    server.sendRaw(JSON.stringify({ id: 5, notMethod: 'tools/list' }));
    const res = await server.nextMessage();
    assert.equal(res.id, 5);
    const err = res.error as { code: number } | undefined;
    assert.ok(err, 'expected an error field');
    assert.equal(err!.code, -32600);
  } finally {
    server.close();
    cleanup();
  }
});

test('commandMcpServer: a non-"2.0" jsonrpc version is rejected as invalid', async () => {
  const { dir, cleanup } = makeRepo();
  const server = startServer(dir);
  try {
    server.sendRaw(JSON.stringify({ jsonrpc: '1.0', id: 9, method: 'tools/list' }));
    const res = await server.nextMessage();
    assert.equal(res.id, 9);
    const err = res.error as { code: number } | undefined;
    assert.ok(err, 'expected an error field');
    assert.equal(err!.code, -32600);
  } finally {
    server.close();
    cleanup();
  }
});

test('commandMcpServer: a non-finite numeric id (1e400 -> Infinity) is rejected, not silently correlated to null', async () => {
  const { dir, cleanup } = makeRepo();
  const server = startServer(dir);
  try {
    server.sendRaw('{"jsonrpc":"2.0","id":1e400,"method":"tools/list"}');
    const res = await server.nextMessage();
    assert.equal(res.id, null);
    const err = res.error as { code: number } | undefined;
    assert.ok(err, 'expected an error field');
    assert.equal(err!.code, -32600);
  } finally {
    server.close();
    cleanup();
  }
});

test('commandMcpServer: a boolean id is rejected (only number/string ids are valid)', async () => {
  const { dir, cleanup } = makeRepo();
  const server = startServer(dir);
  try {
    server.sendRaw(JSON.stringify({ jsonrpc: '2.0', id: true, method: 'tools/list' }));
    const res = await server.nextMessage();
    assert.equal(res.id, null); // the malformed id itself is not trusted as a valid response id
    const err = res.error as { code: number } | undefined;
    assert.ok(err, 'expected an error field');
    assert.equal(err!.code, -32600);
  } finally {
    server.close();
    cleanup();
  }
});
