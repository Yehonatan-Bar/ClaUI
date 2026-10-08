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
  takeStartRequests,
  tokensEqual,
  writeInstance,
  writeStartRequest,
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
const paths: RegistryPaths = {
  instancesDir: path.join(home, 'instances'),
  tokenFile: path.join(home, 'token'),
  requestsDir: path.join(home, 'requests'),
};

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
    mode: 'on',
    serving: true,
    startedAt: '2026-10-08T10:00:00.000Z',
    heartbeatAt: new Date().toISOString(),
    ...overrides,
  };
}

test('registry: write / list / dead-pid cleanup / remove', () => {
  const regPaths: RegistryPaths = { instancesDir: path.join(home, 'reg-instances'), tokenFile: path.join(home, 'reg-token'), requestsDir: path.join(home, 'reg-req') };
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
  const tokPaths: RegistryPaths = { instancesDir: path.join(home, 'tok-i'), tokenFile: path.join(home, 'tok', 'token'), requestsDir: path.join(home, 'tok-r') };
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

test('start requests: addressed, consumed once, stale ones dropped', () => {
  const reqPaths: RegistryPaths = { instancesDir: path.join(home, 'rq-i'), tokenFile: path.join(home, 'rq-t'), requestsDir: path.join(home, 'rq') };
  writeStartRequest('win-a', 'cli', reqPaths);
  writeStartRequest('win-a', 'stdio', reqPaths);
  const other = writeStartRequest('win-b', 'cli', reqPaths);
  assert.deepEqual(takeStartRequests('win-a', reqPaths).map((r) => r.client).sort(), ['cli', 'stdio']);
  assert.deepEqual(takeStartRequests('win-a', reqPaths), [], 'consumed');
  assert.ok(fs.existsSync(other), 'requests for other windows are left alone');
  const old = new Date(Date.now() - 10 * 60_000);
  fs.utimesSync(other, old, old);
  assert.deepEqual(takeStartRequests('win-a', reqPaths), []);
  assert.ok(!fs.existsSync(other), 'stale requests are garbage-collected');
});

let server: RemoteControlHttpServer;
const eventLog = new EventLog();
const forwarded: string[] = [];
let serverPort = 0;
let windowLoop: ReturnType<typeof setInterval> | null = null;
const e2eRecord = (serving: boolean): InstanceInfo =>
  info({ instanceId: 'e2e-instance', port: serving ? serverPort : 0, serving, mode: 'auto', workspaceName: 'e2e', workspaceFolders: [ROOT] });

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
  // Simulate a ClaUi window in mode 'auto': it serves only after a client asks.
  writeInstance(e2eRecord(false), paths);
  windowLoop = setInterval(() => {
    if (takeStartRequests('e2e-instance', paths).length > 0 && serverPort === 0) {
      void server.start().then((port) => {
        serverPort = port;
        writeInstance(e2eRecord(true), paths);
      });
    }
  }, 100);
  // A second window whose remote control is off.
  writeInstance(info({ instanceId: 'off-window', port: 0, serving: false, mode: 'off', workspaceName: 'locked', workspaceFolders: [path.join(home, 'locked')] }), paths);
});

after(async () => {
  if (windowLoop) clearInterval(windowLoop);
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

test('stdio MCP server: passive tool list, on-demand start on the first call, forwarding, local tools', async () => {
  const mcp = startStdio();
  try {
    mcp.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
    const init = await mcp.next();
    assert.equal((init.result as { serverInfo: { name: string } }).serverInfo.name, 'claui');
    mcp.send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    // Listing tools must NOT start the window's server: the bundled catalog is served.
    mcp.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const staticList = (await mcp.next()).result as { tools: Array<{ name: string }> };
    assert.equal(staticList.tools.length, TOOL_CATALOG.length);
    assert.equal(serverPort, 0, 'tools/list did not start the server');

    // The first real call asks the 'auto' window to start, then succeeds.
    mcp.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'send_message', arguments: { text: 'hello' }, _meta: { progressToken: 'p1' } } });
    const sent = await mcp.next();
    assert.equal(sent.id, 3);
    const payload = JSON.parse((sent.result as { content: Array<{ text: string }> }).content[0].text);
    assert.equal(payload.response, 'echo: hello');
    assert.ok(serverPort > 0, 'server started on demand');
    assert.equal(listInstances(paths).find((i) => i.instanceId === 'e2e-instance')?.serving, true);

    // Once serving, the live catalog of the window is used.
    mcp.send({ jsonrpc: '2.0', id: 4, method: 'tools/list' });
    const names = ((await mcp.next()).result as { tools: Array<{ name: string }> }).tools.map((t) => t.name).sort();
    assert.deepEqual(names, ['get_events', 'get_status', 'list_instances', 'list_tabs', 'open_vscode_window', 'select_instance', 'send_message']);

    mcp.send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_instances', arguments: {} } });
    const instances = JSON.parse(((await mcp.next()).result as { content: Array<{ text: string }> }).content[0].text);
    assert.equal(instances.selectedInstanceId, 'e2e-instance');
    const e2e = instances.instances.find((i: { instanceId: string }) => i.instanceId === 'e2e-instance');
    assert.equal(e2e.reachable, true);
    assert.equal(e2e.mode, 'auto');
    assert.equal(instances.instances.find((i: { instanceId: string }) => i.instanceId === 'off-window').serving, false);

    mcp.send({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'select_instance', arguments: { instance: 'no-such-window' } } });
    const bad = (await mcp.next()).result as { isError: boolean; content: Array<{ text: string }> };
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /no_instance/);

    mcp.send({ jsonrpc: '2.0', id: 7, method: 'ping' });
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

test('CLI: a window with mode off gives a clear error; mcp-config prints client configs', async () => {
  const off = await runCli(['status', '--instance', 'locked']);
  assert.equal(off.code, 4);
  assert.match(off.stderr, /turned off/);

  const codex = await runCli(['mcp-config', '--client', 'codex']);
  assert.equal(codex.code, 0, codex.stderr);
  assert.match(codex.stdout, /\[mcp_servers\.claui\]/);
  assert.match(codex.stdout, /claui-mcp\.js/);
  const all = await runCli(['mcp-config']);
  for (const client of ['claude-code', 'claude-desktop', 'cursor', 'windsurf', 'codex', 'vscode', 'generic']) {
    assert.match(all.stdout, new RegExp(`# ${client}:`));
  }
});

test('runtime installer: launchers, clients, current.json never downgrades, manifest', async () => {
  const { installRuntime, buildConnectionInfo, writeConnectionFiles, compareVersions } = await import('../../src/remote-control-shared/runtimeInstaller');
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'claui-rc-src-'));
  const bin = path.join(home, 'install-bin');
  for (const bundle of ['mcp-server.js', 'cli.js', 'client.js']) {
    fs.writeFileSync(path.join(src, bundle), bundle === 'client.js' ? 'module.exports = { hello: () => "hi" };\n' : `// ${bundle}\n`);
  }
  const first = installRuntime(src, '0.1.250', bin);
  assert.equal(first.becameCurrent, true);
  for (const file of ['claui-mcp.js', 'claui.js', 'claui-client.js', 'claui_client.py', 'current.json', path.join('0.1.250', 'client.js')]) {
    assert.ok(fs.existsSync(path.join(bin, file)), file);
  }
  // The stable library launcher resolves to the installed version.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  assert.equal(require(path.join(bin, 'claui-client.js')).hello(), 'hi');
  const older = installRuntime(src, '0.1.249', bin);
  assert.equal(older.becameCurrent, false, 'an older window never downgrades current.json');
  assert.equal(JSON.parse(fs.readFileSync(path.join(bin, 'current.json'), 'utf8')).version, '0.1.250');
  installRuntime(src, '0.1.251', bin);
  installRuntime(src, '0.1.252', bin);
  const versions = fs.readdirSync(bin).filter((d) => /^\d/.test(d)).sort();
  assert.deepEqual(versions, ['0.1.251', '0.1.252'], 'keeps current + one previous');
  assert.ok(compareVersions('0.1.10', '0.1.9') > 0);

  const manifestHome = path.join(home, 'manifest');
  fs.mkdirSync(manifestHome, { recursive: true });
  writeConnectionFiles(buildConnectionInfo({ command: process.execPath }, '0.1.252', bin), manifestHome);
  const manifest = JSON.parse(fs.readFileSync(path.join(manifestHome, 'connection.json'), 'utf8'));
  assert.equal(manifest.mcp.args[0], path.join(bin, 'claui-mcp.js'));
  assert.match(manifest.mcp.clients['claude-code'].config, /claude mcp add --scope user claui --/);
  assert.match(fs.readFileSync(path.join(manifestHome, 'CONNECT.md'), 'utf8'), /# ClaUi Remote Control - how to connect/);
  fs.rmSync(src, { recursive: true, force: true });
});

test('Node client library: connect() + call() against the live window', async () => {
  const script = [
    `const { connect } = require(${JSON.stringify(path.join(ROOT, 'src/remote-control-runtime/client.ts'))});`,
    `const claui = connect({ instance: 'e2e-instance' });`,
    `claui.call('list_tabs').then((r) => { process.stdout.write(JSON.stringify(r)); }, (e) => { process.stderr.write(String(e.code || e.message)); process.exit(3); });`,
  ].join('\n');
  const out = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, ['--import', 'tsx', '-e', script], { env: childEnv(), cwd: ROOT, timeout: 30_000 }, (err, stdout, stderr) =>
      resolve({ code: err ? Number((err as { code?: number }).code ?? 1) : 0, stdout, stderr }),
    );
  });
  assert.equal(out.code, 0, out.stderr);
  assert.equal(JSON.parse(out.stdout).tabs[0].id, 'tab-1');
});

test('Python client: discovery + call (skipped without Python)', async (t) => {
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const probe = await new Promise<boolean>((resolve) => execFile(python, ['--version'], (err) => resolve(!err)));
  if (!probe) {
    t.skip('python not available');
    return;
  }
  const { pythonClientSource } = await import('../../src/remote-control-shared/pythonClient');
  const pyDir = path.join(home, 'py');
  fs.mkdirSync(pyDir, { recursive: true });
  fs.writeFileSync(path.join(pyDir, 'claui_client.py'), pythonClientSource());
  const script = [
    'import json, sys',
    `sys.path.insert(0, ${JSON.stringify(pyDir)})`,
    'from claui_client import ClauiClient, ClauiError',
    `c = ClauiClient(cwd=${JSON.stringify(ROOT)})`,
    'print(json.dumps({"tabs": c.call("list_tabs")["tabs"], "sent": c.call("send_message", text="py")["response"], "tools": len(ClauiClient(instance="locked").tools())}))',
    'try:',
    '    ClauiClient(instance="locked").call("list_tabs")',
    'except ClauiError as e:',
    '    print(e.code)',
  ].join('\n');
  const out = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(python, ['-c', script], { env: childEnv(), timeout: 30_000 }, (err, stdout, stderr) =>
      resolve({ code: err ? Number((err as { code?: number }).code ?? 1) : 0, stdout, stderr }),
    );
  });
  assert.equal(out.code, 0, out.stderr);
  const [json, offCode] = out.stdout.trim().split(/\r?\n/);
  const parsed = JSON.parse(json);
  assert.equal(parsed.tabs[0].id, 'tab-1');
  assert.equal(parsed.sent, 'echo: py');
  assert.equal(parsed.tools, TOOL_CATALOG.length, 'tools() uses the embedded catalog (no server needed)');
  assert.equal(offCode, 'no_instance');
});

test('registry: stopped heartbeats are skipped (2 min) and deleted (15 min)', () => {
  const hbPaths: RegistryPaths = { instancesDir: path.join(home, 'hb-i'), tokenFile: path.join(home, 'hb-t'), requestsDir: path.join(home, 'hb-r') };
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  writeInstance(info({ instanceId: 'fresh', heartbeatAt: ago(10_000) }), hbPaths);
  writeInstance(info({ instanceId: 'quiet', heartbeatAt: ago(3 * 60_000) }), hbPaths);
  writeInstance(info({ instanceId: 'gone', heartbeatAt: ago(20 * 60_000) }), hbPaths);
  assert.deepEqual(listInstances(hbPaths).map((i) => i.instanceId), ['fresh']);
  assert.ok(fs.existsSync(path.join(hbPaths.instancesDir, 'quiet.json')), 'recently stale: kept (window may just be suspended)');
  assert.ok(!fs.existsSync(path.join(hbPaths.instancesDir, 'gone.json')), 'long stale: deleted');
});

test('client configs: env flags after the name, TOML values escaped', async () => {
  const { clientConfigs } = await import('../../src/remote-control-shared/runtimeInstaller');
  const configs = clientConfigs({ command: "C:\Users\O'Brien\Code.exe", env: { ELECTRON_RUN_AS_NODE: '1' } }, "C:\Users\O'Brien\.claui\remote-control\bin");
  assert.match(configs['claude-code'].config, /^claude mcp add --scope user claui -e ELECTRON_RUN_AS_NODE=1 -- "/);
  const toml = configs.codex.config;
  const command = /command = (".*")/.exec(toml)?.[1];
  assert.ok(command, toml);
  assert.equal(JSON.parse(command!), "C:\Users\O'Brien\Code.exe", 'TOML basic string round-trips');
  assert.match(toml, /env = \{ ELECTRON_RUN_AS_NODE = "1" \}/);
});

test('client: falls back to the next window only for a recency pick, never across a cwd match', async () => {
  if (serverPort === 0) {
    serverPort = await server.start();
    writeInstance(e2eRecord(true), paths);
  }
  const { InstanceClient } = await import('../../src/remote-control-runtime/instanceClient');
  const fbPaths: RegistryPaths = { instancesDir: path.join(home, 'fb-i'), tokenFile: paths.tokenFile, requestsDir: path.join(home, 'fb-r') };
  const ghostFolder = path.join(home, 'ghost-project');
  // Most recently focused window: record says serving, but nothing listens on its port.
  writeInstance(info({ instanceId: 'ghost', port: 1, serving: true, mode: 'on', workspaceName: 'ghost', workspaceFolders: [ghostFolder], lastFocusedAt: new Date().toISOString() }), fbPaths);
  writeInstance({ ...e2eRecord(true), lastFocusedAt: '2026-01-01T00:00:00.000Z' }, fbPaths);

  const byRecency = new InstanceClient({ cwd: path.join(home, 'unrelated'), paths: fbPaths });
  assert.equal((await byRecency.resolve()).instanceId, 'e2e-instance', 'recency pick falls back to the next window');

  const byCwd = new InstanceClient({ cwd: path.join(ghostFolder, 'src'), paths: fbPaths });
  await assert.rejects(byCwd.resolve(), /not answering/, 'a cwd match is never swapped for another project');
});
