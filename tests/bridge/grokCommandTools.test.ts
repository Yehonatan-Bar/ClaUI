import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BRIDGE_COMMANDS, findBridgeCommand } from '../../src/bridge-runtime/commands/commandCatalog';
import {
  buildCommandToolsSystemBlock,
  buildFirstTurnPreamble,
  buildGrokMcpServers,
  GrokAcpBackend,
  GrokCommandToolsConfig,
  resolveBridgeToolNameHint,
  resolveToolCallName,
} from '../../src/bridge-runtime/backends/grokAcp';
import { SessionStore } from '../../src/bridge-runtime/sessionStore';

const baseConfig: GrokCommandToolsConfig = {
  enabled: true,
  serverScriptPath: 'C:\\fake\\dist\\bridge-runtime\\mcp\\command-server.js',
  cwd: 'C:\\fake\\project',
  diffBase: 'main',
};

test('buildGrokMcpServers: disabled returns an empty array', () => {
  assert.deepEqual(buildGrokMcpServers({ ...baseConfig, enabled: false }), []);
});

test('buildGrokMcpServers: enabled returns a single stdio server descriptor', () => {
  const servers = buildGrokMcpServers(baseConfig) as Record<string, unknown>[];
  assert.equal(servers.length, 1);
  const [server] = servers;
  assert.equal(server.type, 'stdio');
  assert.equal(server.name, 'claui-commands');
  assert.equal(server.command, process.execPath);
  assert.deepEqual(server.args, [baseConfig.serverScriptPath]);
});

test('buildGrokMcpServers: env is an ARRAY of {name,value} pairs, never a plain object', () => {
  // The ACP schema requires this exact shape; a plain object env is rejected
  // outright by strict ACP agents (confirmed against the published spec).
  const [server] = buildGrokMcpServers(baseConfig) as Record<string, unknown>[];
  assert.ok(Array.isArray(server.env), 'env must be an array');
  const env = server.env as { name: string; value: string }[];
  const cwdEntry = env.find((e) => e.name === 'CLAUI_CWD');
  const diffBaseEntry = env.find((e) => e.name === 'CLAUI_DIFF_BASE');
  assert.equal(cwdEntry?.value, baseConfig.cwd);
  assert.equal(diffBaseEntry?.value, baseConfig.diffBase);
});

test('buildGrokMcpServers: cwd/diffBase changes are reflected in the env entries', () => {
  const [server] = buildGrokMcpServers({ ...baseConfig, cwd: 'C:\\other', diffBase: 'develop' }) as Record<
    string,
    unknown
  >[];
  const env = server.env as { name: string; value: string }[];
  assert.equal(env.find((e) => e.name === 'CLAUI_CWD')?.value, 'C:\\other');
  assert.equal(env.find((e) => e.name === 'CLAUI_DIFF_BASE')?.value, 'develop');
});

test('buildCommandToolsSystemBlock: mentions every catalog command by slash name and tool name', () => {
  const block = buildCommandToolsSystemBlock();
  assert.match(block, /<claui-commands>/);
  assert.match(block, /<\/claui-commands>/);
  for (const spec of BRIDGE_COMMANDS) {
    assert.ok(block.includes(`/${spec.name}`), `missing slash name for ${spec.name}`);
    assert.ok(block.includes(spec.toolName), `missing tool name for ${spec.name}`);
  }
});

test('buildCommandToolsSystemBlock: also mentions every alias (e.g. /review), not just the canonical name', () => {
  const block = buildCommandToolsSystemBlock();
  const withAliases = BRIDGE_COMMANDS.filter((s) => (s.aliases || []).length > 0);
  assert.ok(withAliases.length > 0, 'catalog fixture assumption: at least one command has an alias');
  for (const spec of withAliases) {
    for (const alias of spec.aliases || []) {
      assert.ok(block.includes(`/${alias}`), `missing alias /${alias} for ${spec.name}`);
    }
  }
  // Sanity: the /review alias for code-review resolves to the same command
  // the dispatcher itself would resolve it to (catalog stays the single
  // source of truth for both the dispatcher and this teaching text).
  assert.equal(findBridgeCommand('review')?.name, 'code-review');
});

test('buildFirstTurnPreamble: resumed session (non-empty history) still gets the command-tools block once, but not system-rules', () => {
  const preamble = buildFirstTurnPreamble({
    isFirstEverTurn: false, // resumed tab: stored history already exists
    systemPrompt: 'be terse',
    commandToolsEnabled: true,
    commandToolsAlreadyTaught: false, // fresh process instance hasn't taught it yet
  });
  assert.ok(preamble, 'expected a preamble even on a resumed session');
  assert.ok(!preamble!.includes('<system-rules>'), 'system-rules must not be re-sent on a resumed session');
  assert.match(preamble!, /<claui-commands>/);
});

test('buildFirstTurnPreamble: does not repeat the command-tools block once already taught this process', () => {
  const preamble = buildFirstTurnPreamble({
    isFirstEverTurn: false,
    systemPrompt: '',
    commandToolsEnabled: true,
    commandToolsAlreadyTaught: true,
  });
  assert.equal(preamble, null);
});

test('buildFirstTurnPreamble: a true first-ever turn still sends both system-rules and the command-tools block', () => {
  const preamble = buildFirstTurnPreamble({
    isFirstEverTurn: true,
    systemPrompt: 'be terse',
    commandToolsEnabled: true,
    commandToolsAlreadyTaught: false,
  });
  assert.match(preamble!, /<system-rules>/);
  assert.match(preamble!, /<claui-commands>/);
});

test('buildFirstTurnPreamble: command-tools disabled never injects the block, even on a first turn', () => {
  const preamble = buildFirstTurnPreamble({
    isFirstEverTurn: true,
    systemPrompt: '',
    commandToolsEnabled: false,
    commandToolsAlreadyTaught: false,
  });
  assert.equal(preamble, null);
});

test('resolveBridgeToolNameHint: recognizes a known tool name in the update title', () => {
  assert.equal(resolveBridgeToolNameHint('Calling claui_code_review'), 'claui_code_review');
});

test('resolveBridgeToolNameHint: returns null for an unrelated title', () => {
  assert.equal(resolveBridgeToolNameHint('Reading file.txt'), null);
});

test('resolveBridgeToolNameHint: returns null when there is no title', () => {
  assert.equal(resolveBridgeToolNameHint(undefined), null);
});

test('resolveToolCallName: a CONCRETE built-in kind always wins, even if the title/command text mentions a bridge tool name', () => {
  // Regression: a real `execute` (Bash) call whose command happens to
  // reference one of our tool names as free text (e.g. grepping the
  // codebase for it) must NOT be mislabeled as that bridge tool — a
  // concrete, non-generic ACP kind is a much stronger signal than a
  // substring match in arbitrary command/title text.
  assert.equal(
    resolveToolCallName('execute', 'Searching source', { command: 'rg claui_code_review src' }),
    'Bash',
  );
  // Same for a real `read` whose title/path happens to mention a tool name
  // (e.g. reading a file literally named after it).
  assert.equal(
    resolveToolCallName('read', 'Reading claui_code_review.ts', { file_path: 'claui_code_review.ts' }),
    'Read',
  );
});

test('resolveToolCallName: recognizes a bridge tool by title only when ACP did not confidently classify the kind', () => {
  // The expected shape for an MCP-sourced call: ACP has no built-in semantic
  // kind for MCP tools, so `kind` is absent or maps to the generic bucket —
  // only THEN is it safe to look at the title for one of our own tool names.
  assert.equal(resolveToolCallName(undefined, 'Calling claui_code_review', { arg: '' }), 'claui_code_review');
  assert.equal(resolveToolCallName('other', 'Calling claui_security_review', { arg: '' }), 'claui_security_review');
});

test('resolveToolCallName: falls back to input-shape heuristics when kind is generic and there is no bridge-tool title match', () => {
  assert.equal(resolveToolCallName('other', undefined, { command: 'ls' }), 'Bash');
  assert.equal(resolveToolCallName(undefined, undefined, {}), 'Tool');
});

test('GrokAcpBackend.setWriteWindow: safe to call before any ACP session exists (no live process yet)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claui-grok-writewindow-'));
  try {
    const store = new SessionStore(dir);
    const backend = new GrokAcpBackend('grok', '', 'sid', store, '', 'supervised', () => {}, baseConfig);
    // The constructor never spawns a process, so this.acp is still null —
    // setWriteWindow must not throw (optional-chains into the not-yet-built
    // ACP client) and just records the pending state for runTurn to apply.
    assert.doesNotThrow(() => backend.setWriteWindow(true));
    assert.doesNotThrow(() => backend.setWriteWindow(false));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('GrokAcpBackend.interrupt: eagerly revokes an open write window (not just cli.ts finally, which only runs once runTurn settles)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claui-grok-interrupt-'));
  try {
    const store = new SessionStore(dir);
    const backend = new GrokAcpBackend('grok', '', 'sid', store, '', 'supervised', () => {}, baseConfig);
    const peek = () => (backend as unknown as { pendingWriteWindow: boolean }).pendingWriteWindow;

    backend.setWriteWindow(true);
    assert.equal(peek(), true);

    backend.interrupt();
    assert.equal(peek(), false, 'interrupt() must close the window immediately, before any cancellation round-trip');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
