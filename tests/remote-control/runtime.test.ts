import { test, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  ensureToken,
  listInstances,
  readToken,
  regenerateToken,
  removeInstance,
  selectInstance,
  tokensEqual,
  writeInstance,
  type RegistryPaths,
} from '../../src/remote-control-shared/instanceRegistry';
import type { InstanceInfo } from '../../src/remote-control-shared/protocol';
import { RemoteControlHttpServer, type RemoteControlBackend } from '../../src/extension/remote-control/core/RemoteControlHttpServer';
import { EventLog } from '../../src/extension/remote-control/core/EventLog';
import { TOOL_CATALOG } from '../../src/remote-control-shared/toolCatalog';

/**
 * Instance registry unit tests + end-to-end tests of the REAL stdio MCP server
 * and CLI (spawned via `node --import tsx`) against a live control server with
 * a fake backend, in an isolated CLAUI_REMOTE_CONTROL_HOME.
 */

const ROOT = path.resolve(__dirname, '../..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claui-rc-test-'));
const paths: RegistryPaths = { instancesDir: path.join(home, 'instances'), tokenFile: path.join(home, 'token') };

function info(overrides: Partial<InstanceInfo>): InstanceInfo {
  return {
    instanceId: 'id',
    pid: process.pid,
    port: 1,
    host: '127.0.0.1',
    workspaceFolders: [],
    workspaceName: 'ws',
    extensionVersion: '0.0.0',
    accessLevel: 'full',
    startedAt: '2026-10-08T10:00:00.000Z',
    heartbeatAt: '2026-10-08T10:00:00.000Z',
    ...overrides,
  };
}

test('registry: write / list / dead-pid cleanup / remove', () => {
  const regPaths: RegistryPaths = { instancesDir: path.join(home, 'reg-instances'), tokenFile: path.join(home, 'reg-token') };
  writeInstance(info({ instanceId: 'alive', lastFocusedAt: '2026-10-08T10:05:00.000Z' }), regPaths);
  writeInstance(info({ instanceId: 'older' }), regPaths);
  writeInstance(info({ instanceId: 'dead', pid: 999_999_999 }), regPaths);
  fs.writeFileSync(path.join(regPaths.instancesDir, 'corrupt.json'), '{not json');
  const listed = listInstances(regPaths);
  assert.deepEqual(listed.map((i) => i.instanceId), ['alive', 'older'], 'most recent first, dead skipped');
  assert.ok(!fs.existsSync(path.join(regPaths.instancesDir, 'dead.json')), 'dead record garbage-collected');
  removeInstance('alive', regPaths);
  assert.deepEqual(listInstances(regPaths).map((i) => i.instanceId), ['older']);
});

test('registry: instance selection by id, workspace, cwd (deepest) and recency', () => {
  const a = info({ instanceId: 'a', workspaceName: 'claude-code-mirror', workspaceFolders: ['C:\\projects\\claude-code-mirror'] });
  const b = info({ instanceId: 'b', workspaceName: 'Executive_Copilot', workspaceFolders: ['C:\\projects\\Executive_Copilot'] });
  const nested = info({ instanceId: 'n', workspaceName: 'server', workspaceFolders: ['C:\\projects\\claude-code-mirror\\server'] });
  const all = [b, a, nested];
  assert.equal(selectInstance(all)?.instanceId, 'b', 'most recent = first');
  assert.equal(selectInstance(all, { preferred: 'a' })?.instanceId, 'a');
  assert.equal(selectInstance(all, { preferred: 'executive' })?.instanceId, 'b', 'workspace name substring');
  assert.equal(selectInstance(all, { preferred: 'c:/PROJECTS/claude-code-mirror' })?.instanceId, 'a', 'path, case/sep-insensitive');
  assert.equal(selectInstance(all, { preferred: 'nothing-like-this' }), undefined, 'explicit preference never falls back');
  assert.equal(selectInstance(all, { cwd: 'C:/projects/claude-code-mirror/src' })?.instanceId, 'a');
  assert.equal(selectInstance(all, { cwd: 'C:\\projects\\claude-code-mirror\\server\\src' })?.instanceId, 'n', 'deepest workspace wins');
  assert.equal(selectInstance(all, { cwd: 'C:/projects/claude-code-mirrorX' })?.instanceId, 'b', 'no prefix false-match');
});

test('token: create once, stable, regenerate, constant-time compare', () => {
  const tokPaths: RegistryPaths = { instancesDir: path.join(home, 'tok-i'), tokenFile: path.join(home, 'tok', 'token') };
  const first = ensureToken(tokPaths);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(ensureToken(tokPaths), first);
  const second = regenerateToken(tokPaths);
  assert.notEqual(second, first);
  assert.equal(readToken(tokPaths), second);
  assert.ok(tokensEqual(second, second));
  assert.ok(!tokensEqual(second, first));
  assert.ok(!tokensEqual(second, 'short'));
});

// ---------------------------------------------------------------------------
// End-to-end: stdio MCP server + CLI against a live control server
// ---------------------------------------------------------------------------

let server: RemoteControlHttpServer;
const eventLog = new EventLog();
const forwarded: string[] = [];

before(async () => {
  const token = ensureToken(paths);
  const backend: RemoteControlBackend = {
    identity: { name: 'claui', version: 'e2e' },
    instanceId: 'e2e-instance',
    // A trimmed live catalog proves the runtime prefers it over the bundled one.
    listTools: () => TOOL_CATALOG.filter((t) => t.scope === 'instance' && ['get_status', 'list_tabs', 'send_message', 'get_events'].includes(t.name)),
    callTool: async (name, args) => {
      forwarded.push(name);
      if (name === 'list_tabs') {
        return { tabs: [{ id: 'tab-1', number: 1, provider: 'claude', model: 'claude-opus-5-5', name: 'Demo', active: true, busy: false, sleepState: 'awake' }] };
      }
      if (name === 'send_message') {
        await new Promise((r) => setTimeout(r, 50));
        return { tabId: 'tab-1', status: 'completed', response: `echo: ${String(args.text)}` };
      }
      return { ok: true, name };
    },
    getStatus: () => ({ instanceId: 'e2e-instance', protocolVersion: 1, accessLevel: 'full', tabCount: 1 }),
    eventLog,
    log: () => undefined,
  };
  server = new RemoteControlHttpServer(backend, { port: 0, getToken: () => readToken(paths) ?? token });
  const port = await server.start();
  writeInstance(info({ instanceId: 'e2e-instance', port, workspaceName: 'e2e', workspaceFolders: [ROOT] }), paths);
});

after(async () => {
  await server.stop();
  fs.rmSync(home, { recursive: true, force: true });
});

const childEnv = (): NodeJS.ProcessEnv => ({ ...process.env, CLAUI_REMOTE_CONTROL_HOME: home, CLAUI_INSTANCE: '' });

interface StdioHarness {
  send: (msg: unknown) => void;
  next: () => Promise<Record<string, unknown>>;
  close: () => void;
}

function startStdio(): StdioHarness {
  const child: ChildProcessWithoutNullStreams = spawn(
    process.execPath,
    ['--import', 'tsx', path.join(ROOT, 'src/remote-control-runtime/mcpServerMain.ts')],
    { env: childEnv(), cwd: ROOT },
  );
  const queue: Record<string, unknown>[] = [];
  const waiters: Array<(m: Record<string, unknown>) => void> = [];
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line) as Record<string, unknown>;
    const waiter = waiters.shift();
    if (waiter) waiter(msg);
    else queue.push(msg);
  });
  return {
    send: (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`),
    next: () =>
      new Promise((resolve, reject) => {
        const queued = queue.shift();
        if (queued) return resolve(queued);
        const timer = setTimeout(() => reject(new Error('timeout waiting for MCP response')), 15_000);
        waiters.push((m) => {
          clearTimeout(timer);
          resolve(m);
        });
      }),
    close: () => child.kill(),
  };
}

test('stdio MCP server: initialize, live tool list + local tools, forwarding, local tools', async () => {
  const mcp = startStdio();
  try {
    mcp.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
    const init = await mcp.next();
    assert.equal((init.result as { serverInfo: { name: string } }).serverInfo.name, 'claui');
    mcp.send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    mcp.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const list = await mcp.next();
    const names = (list.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name).sort();
    assert.deepEqual(names, ['get_events', 'get_status', 'list_instances', 'list_tabs', 'open_vscode_window', 'select_instance', 'send_message']);

    mcp.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'send_message', arguments: { text: 'hello' }, _meta: { progressToken: 'p1' } } });
    const sent = await mcp.next();
    assert.equal(sent.id, 3);
    const payload = JSON.parse((sent.result as { content: Array<{ text: string }> }).content[0].text);
    assert.equal(payload.response, 'echo: hello');

    mcp.send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_instances', arguments: {} } });
    const instances = JSON.parse(((await mcp.next()).result as { content: Array<{ text: string }> }).content[0].text);
    assert.equal(instances.selectedInstanceId, 'e2e-instance');
    assert.equal(instances.instances[0].reachable, true);

    mcp.send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'select_instance', arguments: { instance: 'no-such-window' } } });
    const bad = (await mcp.next()).result as { isError: boolean; content: Array<{ text: string }> };
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /no_instance/);

    mcp.send({ jsonrpc: '2.0', id: 6, method: 'ping' });
    assert.deepEqual((await mcp.next()).result, {});
    assert.ok(forwarded.includes('send_message'));
  } finally {
    mcp.close();
  }
});

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--import', 'tsx', path.join(ROOT, 'src/remote-control-runtime/cli.ts'), ...args],
      { env: childEnv(), cwd: ROOT, timeout: 30_000 },
      (err, stdout, stderr) => resolve({ code: err ? Number((err as { code?: number }).code ?? 1) : 0, stdout, stderr }),
    );
  });
}

test('CLI: tabs, send, call with --json, and a clear error without a window', async () => {
  const tabs = await runCli(['tabs']);
  assert.equal(tabs.code, 0, tabs.stderr);
  assert.match(tabs.stdout, /tab-1\s+#1\s+claude/);

  const sent = await runCli(['send', 'hi', 'there']);
  assert.equal(sent.code, 0, sent.stderr);
  assert.equal(sent.stdout.trim(), 'echo: hi there');

  const called = await runCli(['call', 'get_status', '--json', '{"x":1}']);
  assert.equal(called.code, 0, called.stderr);
  assert.equal(JSON.parse(called.stdout).name, 'get_status');

  const noWindow = await runCli(['status', '--instance', 'definitely-not-open']);
  assert.equal(noWindow.code, 4);
  assert.match(noWindow.stderr, /no_instance/);
});
