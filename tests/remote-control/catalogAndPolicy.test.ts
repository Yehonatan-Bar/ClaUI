import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TOOL_CATALOG, findTool, toMcpTool } from '../../src/remote-control-shared/toolCatalog';
import { LOCAL_TOOL_NAMES } from '../../src/remote-control-runtime/localTools';
import {
  BLOCKED_UI_ACTIONS,
  NORMAL_UI_ACTIONS,
  QUERY_UI_ACTIONS,
  SENSITIVE_UI_ACTIONS,
  SENSITIVE_COMMANDS,
  classifyCommand,
  classifySettingWrite,
  classifyUiAction,
  isSecretSettingKey,
} from '../../src/extension/remote-control/core/accessPolicy';
import { validateArgs } from '../../src/extension/remote-control/core/argValidator';
import { parseScheduleTime } from '../../src/extension/remote-control/core/scheduleTime';
import { RemoteControlError } from '../../src/remote-control-shared/protocol';

const ROOT = path.resolve(__dirname, '../..');
const catalog = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'src/extension/remote-control/uiActionCatalog.generated.json'), 'utf8'),
) as { uiActions: Array<{ type: string }>; uiEvents: Array<{ type: string }> };
const handlersSource = fs.readFileSync(path.join(ROOT, 'src/extension/remote-control/RemoteControlToolHandlers.ts'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('tool names are unique snake_case and every schema is an object schema', () => {
  const names = TOOL_CATALOG.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, 'duplicate tool name');
  for (const tool of TOOL_CATALOG) {
    assert.match(tool.name, /^[a-z][a-z0-9_]*$/, tool.name);
    assert.equal(tool.inputSchema.type, 'object', `${tool.name} schema`);
    assert.ok(tool.description.length > 20, `${tool.name} needs a useful description`);
  }
});

test('every instance tool has a handler case; local tools match the runtime', () => {
  for (const tool of TOOL_CATALOG.filter((t) => t.scope === 'instance')) {
    assert.ok(handlersSource.includes(`case '${tool.name}':`), `missing handler for ${tool.name}`);
  }
  const local = TOOL_CATALOG.filter((t) => t.scope === 'local').map((t) => t.name).sort();
  assert.deepEqual(local, [...LOCAL_TOOL_NAMES].sort());
});

test('MCP tool entries carry standard annotations', () => {
  const entry = toMcpTool(findTool('close_tab')!);
  assert.deepEqual(entry.annotations, {
    title: 'Close a tab',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  });
  assert.equal((toMcpTool(findTool('list_tabs')!).annotations as { readOnlyHint: boolean }).readOnlyHint, true);
});

test('every UI action is classified in exactly one explicit policy set (allowlist)', () => {
  const types = new Set(catalog.uiActions.map((a) => a.type));
  const sets = { BLOCKED_UI_ACTIONS, QUERY_UI_ACTIONS, NORMAL_UI_ACTIONS, SENSITIVE_UI_ACTIONS };
  for (const [setName, set] of Object.entries(sets)) {
    for (const name of set) {
      assert.ok(types.has(name), `${setName} lists an unknown UI action: ${name}`);
    }
  }
  for (const type of types) {
    const owners = Object.entries(sets).filter(([, set]) => set.has(type)).map(([n]) => n);
    assert.equal(owners.length, 1, `UI action ${type} must be in exactly one policy set (found: ${owners.join(', ') || 'none'})`);
  }
});

test('every sensitive command exists in package.json', () => {
  const commands = new Set((packageJson.contributes.commands as Array<{ command: string }>).map((c) => c.command));
  for (const name of SENSITIVE_COMMANDS) {
    assert.ok(commands.has(name), `unknown command in policy: ${name}`);
  }
});

test('generated UI catalog is in sync with webview-messages.ts', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { collect } = require(path.join(ROOT, 'scripts/generate-remote-control-catalog.js'));
  const fresh = collect();
  assert.deepEqual(
    fresh.uiActions.map((a: { type: string }) => a.type),
    catalog.uiActions.map((a) => a.type),
    'run npm run gen:remote-control-catalog',
  );
  assert.deepEqual(fresh.uiEvents.map((a: { type: string }) => a.type), catalog.uiEvents.map((a) => a.type));
});

test('UI action classification', () => {
  assert.equal(classifyUiAction('ready'), 'blocked');
  assert.equal(classifyUiAction('gitPush'), 'sensitive');
  assert.equal(classifyUiAction('setApiKey'), 'sensitive');
  assert.equal(classifyUiAction('openUrl'), 'sensitive');
  assert.equal(classifyUiAction('getProjectAnalytics'), 'query');
  assert.equal(classifyUiAction('secretProtectionGetStatus'), 'query');
  assert.equal(classifyUiAction('requestUsage'), 'query');
  assert.equal(classifyUiAction('setVpmEnabled'), 'normal');
  assert.equal(classifyUiAction('compact'), 'normal');
  assert.equal(classifyUiAction('setCouncilSettings'), 'sensitive');
  assert.equal(classifyUiAction('checkpointRedo'), 'sensitive');
  assert.equal(classifyUiAction('workstreamMapImportExternalFolder'), 'sensitive');
  assert.equal(classifyUiAction('setSkillGenEnabled'), 'sensitive');
  assert.equal(classifyUiAction('someFutureAction'), 'sensitive', 'unclassified = sensitive');
});

test('command classification blocks remote-control self-management and non-ClaUi commands', () => {
  assert.equal(classifyCommand('claudeMirror.remoteControl.enable'), 'blocked');
  assert.equal(classifyCommand('workbench.action.terminal.sendSequence'), 'blocked');
  assert.equal(classifyCommand('claudeMirror.history.delete'), 'sensitive');
  assert.equal(classifyCommand('claudeMirror.openWorkstreamMap'), 'normal');
});

test('setting write classification and secret detection', () => {
  assert.equal(classifySettingWrite('remoteControl.accessLevel'), 'blocked');
  assert.equal(classifySettingWrite('claudeMirror.remoteControl.enabled'), 'blocked');
  assert.equal(classifySettingWrite('cliPath'), 'sensitive');
  assert.equal(classifySettingWrite('codex.cliPath'), 'sensitive');
  assert.equal(classifySettingWrite('secretProtection.enabled'), 'sensitive');
  assert.equal(classifySettingWrite('usageReporting.serverUrl'), 'sensitive');
  assert.equal(classifySettingWrite('bridge.openaiProviders'), 'sensitive');
  assert.equal(classifySettingWrite('bridge.council.members'), 'sensitive');
  assert.equal(classifySettingWrite('gitPush.scriptPath'), 'sensitive');
  assert.equal(classifySettingWrite('skillGen.enabled'), 'sensitive');
  assert.equal(classifySettingWrite('multiParticipant.authToken'), 'sensitive');
  assert.equal(classifySettingWrite('model'), 'normal');
  assert.equal(classifySettingWrite('sessionVitals'), 'normal');
  assert.equal(classifySettingWrite('fontSize'), 'normal');
  assert.ok(isSecretSettingKey('claudeMirror.github.token'));
  assert.ok(isSecretSettingKey('bridge.openai.apiKey'));
  assert.ok(!isSecretSettingKey('model'));
});

test('argument validation', () => {
  const schema = findTool('send_message')!.inputSchema;
  assert.deepEqual(validateArgs({ text: 'hi', tabId: 3 }, schema), []);
  assert.deepEqual(validateArgs({ text: 'hi', tabId: 'tab-3', wait: false, ifBusy: 'queue' }, schema), []);
  assert.match(validateArgs({}, schema).join(), /text: is required/);
  assert.match(validateArgs({ text: 5 }, schema).join(), /text: expected string/);
  assert.match(validateArgs({ text: 'x', bogus: 1 }, schema).join(), /bogus: unknown argument/);
  assert.match(validateArgs({ text: 'x', ifBusy: 'later' }, schema).join(), /must be one of/);
  assert.match(validateArgs({ text: 'x', timeoutSec: 99999 }, schema).join(), /<= 3600/);
  assert.match(validateArgs({ text: 'x', timeoutSec: Number.NaN }, schema).join(), /finite/);
  assert.match(validateArgs({ text: 'x', images: Array.from({ length: 11 }, () => ({ path: 'C:/a.png' })) }, schema).join(), /more than 10/);
  // Free-form nested values still get global caps.
  const dispatch = findTool('dispatch_ui_action')!.inputSchema;
  assert.deepEqual(validateArgs({ action: { type: 'setVpmEnabled', enabled: true } }, dispatch), []);
  assert.match(validateArgs({ action: { enabled: true } }, dispatch).join(), /action.type: is required/);
  let deep: Record<string, unknown> = { type: 'x' };
  for (let i = 0; i < 20; i++) deep = { type: 'x', nested: deep };
  assert.match(validateArgs({ action: deep }, dispatch).join(), /nested too deeply/);
});

test('schedule time parsing', () => {
  const now = Date.UTC(2026, 9, 8, 10, 0, 0);
  assert.equal(parseScheduleTime('+15m', now), now + 15 * 60_000);
  assert.equal(parseScheduleTime('+2h', now), now + 2 * 3_600_000);
  assert.equal(parseScheduleTime('+30s', now), now + 30_000);
  assert.equal(parseScheduleTime(now + 5, now), now + 5);
  assert.equal(parseScheduleTime('2026-10-08T12:00:00Z', now), Date.UTC(2026, 9, 8, 12, 0, 0));
  assert.throws(() => parseScheduleTime('tomorrow-ish', now), RemoteControlError);
});
