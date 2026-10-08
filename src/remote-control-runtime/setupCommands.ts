import * as fs from 'fs';
import * as path from 'path';
import type { ChildProcess } from 'child_process';
import { spawnCli } from '../extension/process/spawnCli';
import {
  BIN_DIR,
  CONNECTION_FILE,
  CONNECT_DOC,
  INSTANCES_DIR,
  MCP_SERVER_NAME,
  REMOTE_CONTROL_HOME,
  TOKEN_FILE,
} from '../remote-control-shared/protocol';
import { ensureToken, listInstances } from '../remote-control-shared/instanceRegistry';
import {
  buildConnectionInfo,
  clientConfigs,
  currentProcessNodeCommand,
  installRuntime,
  resolveNodeCommand,
  stdioServerEntry,
  writeConnectionFiles,
  writeHomeReadme,
  type ConnectionInfo,
  type NodeCommand,
} from '../remote-control-shared/runtimeInstaller';
import type { InstanceClient } from './instanceClient';

/**
 * Agent-facing setup commands of the CLI (`claui.js install | mcp-config |
 * register | doctor | connection`): everything an agent needs to wire itself
 * to ClaUi without a human opening any menu.
 */

/** package.json of the extension this bundle shipped in (when running from the extension folder). */
function extensionPackage(): { name?: string; version?: string } | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
    return pkg && pkg.name === 'claude-code-mirror' ? pkg : null;
  } catch {
    return null;
  }
}

function readConnection(): ConnectionInfo | null {
  try {
    return JSON.parse(fs.readFileSync(CONNECTION_FILE, 'utf8')) as ConnectionInfo;
  } catch {
    return null;
  }
}

/** Node command for client configs: what the extension recorded, else the node on PATH, else this process. */
export function configNodeCommand(): NodeCommand {
  const recorded = readConnection();
  if (recorded?.mcp?.command && fs.existsSync(recorded.mcp.command)) {
    return { command: recorded.mcp.command, ...(recorded.mcp.env ? { env: recorded.mcp.env } : {}) };
  }
  return resolveNodeCommand(currentProcessNodeCommand());
}

/**
 * Install the stable launchers from the extension folder this CLI runs from
 * (works before VS Code was ever opened after installing the extension).
 */
export function runInstall(): Record<string, unknown> {
  const pkg = extensionPackage();
  ensureToken();
  if (!pkg?.version) {
    // Running from the stable copy: nothing to copy, just refresh the manifest.
    const current = readConnection();
    const version = current?.runtimeVersion ?? 'unknown';
    writeConnectionFiles(buildConnectionInfo(configNodeCommand(), version));
    return { installed: true, version, note: 'Already running from the installed runtime; connection manifest refreshed.', connection: CONNECTION_FILE };
  }
  const result = installRuntime(__dirname, pkg.version);
  const node = resolveNodeCommand(currentProcessNodeCommand());
  const guide = path.join(__dirname, '..', '..', 'Kingdom_of_Claudes_Beloved_MDs', 'AI_AGENT_INTEGRATION.md');
  const info = buildConnectionInfo(node, pkg.version, undefined, fs.existsSync(guide) ? path.resolve(guide) : undefined);
  writeConnectionFiles(info);
  writeHomeReadme(info);
  return {
    installed: true,
    version: result.version,
    becameCurrent: result.becameCurrent,
    binDir: BIN_DIR,
    mcpServer: stdioServerEntry(node),
    connection: CONNECTION_FILE,
    guide: CONNECT_DOC,
  };
}

export function mcpConfigText(client: string | undefined): string {
  const configs = clientConfigs(configNodeCommand());
  if (client) {
    const entry = configs[client];
    if (!entry) {
      throw new Error(`Unknown client "${client}". Known: ${Object.keys(configs).join(', ')}`);
    }
    return `# ${client}: ${entry.where}\n${entry.config}\n`;
  }
  return Object.entries(configs)
    .map(([name, entry]) => `# ${name}: ${entry.where}\n${entry.config}\n`)
    .join('\n');
}

function run(command: string, args: string[], timeoutMs = 30_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnCli(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: err instanceof Error ? err.message : String(err) });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr || err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** Register (or re-register) the stdio server with Claude Code via `claude mcp add-json`. */
export async function registerWithClaudeCode(scope: string, claudeCli: string): Promise<Record<string, unknown>> {
  if (!['user', 'project', 'local'].includes(scope)) {
    throw new Error('--scope must be user, project or local');
  }
  const entry = stdioServerEntry(configNodeCommand());
  const payload = JSON.stringify({ type: 'stdio', ...entry });
  const addArgs = ['mcp', 'add-json', '-s', scope, MCP_SERVER_NAME, payload];
  // Add first: a working registration is only replaced when the add reports it already exists.
  let added = await run(claudeCli, addArgs);
  if (added.code !== 0 && /already exists/i.test(`${added.stderr}\n${added.stdout}`)) {
    await run(claudeCli, ['mcp', 'remove', '-s', scope, MCP_SERVER_NAME]);
    added = await run(claudeCli, addArgs);
  }
  if (added.code !== 0) {
    throw new Error(
      `"${claudeCli} mcp add-json" failed (exit ${added.code}): ${(added.stderr || added.stdout).trim() || 'no output'}. ` +
        'Is Claude Code installed? Pass --claude <path> if it is not on PATH.',
    );
  }
  return { registered: true, client: 'claude-code', scope, server: MCP_SERVER_NAME, ...entry, output: added.stdout.trim() };
}

/** Diagnose every link of the chain an agent depends on. */
export async function doctor(client: InstanceClient, claudeCli: string): Promise<Record<string, unknown>> {
  const checks: Array<{ check: string; ok: boolean; detail: string }> = [];
  const add = (check: string, ok: boolean, detail: string) => checks.push({ check, ok, detail });

  let current: { version?: string; dir?: string } | null = null;
  try {
    current = JSON.parse(fs.readFileSync(path.join(BIN_DIR, 'current.json'), 'utf8'));
  } catch {
    current = null;
  }
  add('runtime installed', !!current?.dir && fs.existsSync(current.dir), current?.dir ? `${current.version} at ${current.dir}` : `missing ${path.join(BIN_DIR, 'current.json')} (open VS Code once, or run: install)`);
  add('MCP launcher', fs.existsSync(path.join(BIN_DIR, 'claui-mcp.js')), path.join(BIN_DIR, 'claui-mcp.js'));
  add('token', fs.existsSync(TOKEN_FILE), TOKEN_FILE);
  const node = configNodeCommand();
  add('node for MCP clients', fs.existsSync(node.command), `${node.command}${node.env ? ` (env ${JSON.stringify(node.env)})` : ''}`);

  const windows = listInstances();
  add('VS Code windows running ClaUi', windows.length > 0, windows.length > 0 ? `${windows.length} (records in ${INSTANCES_DIR})` : 'none: open VS Code with ClaUi installed');
  const live = await client.listLive();
  const windowRows = live.map((w) => ({
    instanceId: w.instanceId,
    workspace: w.workspaceName,
    version: w.extensionVersion,
    mode: w.mode,
    serving: w.serving,
    reachable: w.reachable,
  }));
  if (windows.length > 0) {
    try {
      const target = await client.resolve();
      add('connect (starts the server on demand)', true, `${target.workspaceName} on port ${target.port}`);
    } catch (err) {
      add('connect (starts the server on demand)', false, err instanceof Error ? err.message : String(err));
    }
  }

  const registered = await run(claudeCli, ['mcp', 'get', MCP_SERVER_NAME], 20_000);
  add(
    'registered with Claude Code',
    registered.code === 0,
    registered.code === 0 ? 'claude mcp get claui: ok' : registered.code === -1 ? `Claude Code CLI not found (${claudeCli})` : 'not registered (run: register)',
  );

  return { ok: checks.every((c) => c.ok || c.check === 'registered with Claude Code'), home: REMOTE_CONTROL_HOME, checks, windows: windowRows };
}

export function connectionInfoText(): string {
  const info = readConnection();
  if (!info) {
    return `No ${CONNECTION_FILE} yet: open VS Code with ClaUi once, or run "install".`;
  }
  return JSON.stringify(info, null, 2);
}
