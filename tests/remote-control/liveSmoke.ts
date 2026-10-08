/**
 * Manual live smoke test for ClaUi Remote Control against a REAL VS Code window
 * (not part of `npm run test:remote-control`, which needs no VS Code).
 *
 *   node --import tsx tests/remote-control/liveSmoke.ts [--instance <id|workspace>] [--with-question] [--keep-tab]
 *
 * Runs real Claude prompts with Haiku (a few cents at most). Exits non-zero on
 * the first failed check.
 */
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { spawn } from 'node:child_process';
import { InstanceClient } from '../../src/remote-control-runtime/instanceClient';
import { RemoteControlError } from '../../src/remote-control-shared/protocol';

const argv = process.argv.slice(2);
const instanceArg = argv.includes('--instance') ? argv[argv.indexOf('--instance') + 1] : undefined;
const withQuestion = argv.includes('--with-question');
const keepTab = argv.includes('--keep-tab');
const MODEL = 'claude-haiku-4-5-20251001';

let passed = 0;
function check(condition: unknown, label: string, detail?: unknown): void {
  if (!condition) {
    console.error(`FAIL  ${label}`);
    if (detail !== undefined) console.error(JSON.stringify(detail, null, 2).slice(0, 4000));
    process.exit(1);
  }
  passed += 1;
  console.log(`ok    ${label}`);
}

async function expectError(promise: Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    const value = await promise;
    check(false, label, { unexpectedSuccess: value });
  } catch (err) {
    check(err instanceof RemoteControlError && err.code === code, label, { got: (err as RemoteControlError).code, message: (err as Error).message });
  }
}

async function main(): Promise<void> {
  const client = new InstanceClient({ preferred: instanceArg, cwd: process.cwd() });
  const call = (tool: string, args: Record<string, unknown> = {}, timeoutSec = 300) =>
    client.callTool(tool, args, timeoutSec * 1000) as Promise<Record<string, any>>;

  const instance = await client.resolve();
  console.log(`Using window ${instance.instanceId} (${instance.workspaceName}) on port ${instance.port}`);

  // set_model / set_effort persist global defaults exactly like the UI picker: restore them at the end.
  const savedDefaults = (await call('get_settings', { keys: ['model', 'effortLevel', 'permissionMode', 'fastMode'] }))
    .settings as Array<{ key: string; value: unknown }>;
  try {
    await runChecks(call, instance);
  } finally {
    for (const setting of savedDefaults) {
      await call('update_setting', { key: setting.key, value: setting.value ?? null });
    }
  }
  console.log(`\nAll ${passed} live checks passed (global defaults restored).`);
}

async function runChecks(
  call: (tool: string, args?: Record<string, unknown>, timeoutSec?: number) => Promise<Record<string, any>>,
  instance: { instanceId: string },
): Promise<void> {

  const status = await call('get_status');
  check(status.instanceId === instance.instanceId && status.accessLevel, 'get_status', status);
  check(Array.isArray((await call('list_tabs')).tabs), 'list_tabs');
  const models = await call('list_models');
  check(models.claude.some((m: { value: string }) => m.value === MODEL), 'list_models includes Haiku 4.5');
  const settings = await call('get_settings', { prefix: 'remoteControl.' });
  check(settings.count === 4, 'get_settings prefix filter', settings);
  check((await call('list_commands')).commands.length > 60, 'list_commands');
  const actions = await call('list_ui_actions', { filter: 'analytics' });
  check(actions.actions.some((a: { type: string }) => a.type === 'getProjectAnalytics'), 'list_ui_actions filter');

  // --- policy refusals -------------------------------------------------------
  await expectError(call('dispatch_ui_action', { action: { type: 'gitPush' } }), 'forbidden', 'sensitive UI action refused');
  await expectError(call('execute_command', { command: 'claudeMirror.remoteControl.disable' }), 'forbidden', 'remote-control command refused');
  await expectError(call('update_setting', { key: 'remoteControl.accessLevel', value: 'full' }), 'forbidden', 'remote-control setting refused');
  await expectError(call('execute_command', { command: 'workbench.action.closeWindow' }), 'not_found', 'non-ClaUi command refused');
  await expectError(call('send_message', { text: 'x', bogus: true }), 'invalid_arguments', 'unknown argument rejected');
  await expectError(call('get_tab', { tabId: 'tab-99999' }), 'not_found', 'unknown tab');

  // --- conversation ------------------------------------------------------------
  const created = await call('create_tab', {
    provider: 'claude',
    model: MODEL,
    name: 'RC smoke',
    prompt: 'Reply with exactly the single word PONG and nothing else.',
    timeoutSec: 240,
  }, 300);
  check(created.status === 'completed', 'create_tab + prompt completes', created);
  check(/PONG/.test(created.response), 'reply contains PONG', created.response);
  const tabId = created.tabId as string;

  const tab = await call('get_tab', { tabId });
  check(tab.name === 'RC smoke', 'create_tab applied the name', tab.name);
  check(tab.transcript.entries >= 2, 'tracker recorded the transcript', tab.transcript);
  check(tab.busy === false && tab.pendingApproval === null, 'tab idle after turn');

  const second = await call('send_message', { tabId, text: 'Now reply with exactly PONG2.', timeoutSec: 180 }, 240);
  check(second.status === 'completed' && /PONG2/.test(second.response), 'send_message second turn', second);
  check(typeof second.cost?.totalUsd === 'number', 'turn result carries cost', second.cost);

  const messages = await call('get_messages', { tabId, limit: 10 });
  check(messages.messages.length >= 4 && messages.source === 'live', 'get_messages live transcript', messages);
  check(/PONG2/.test((await call('get_last_response', { tabId })).text), 'get_last_response');
  const fromDisk = await call('get_messages', { sessionId: second.sessionId, limit: 10 });
  check(fromDisk.messages.length >= 2, 'get_messages by sessionId', fromDisk);

  const events = await call('get_events', { tabId, types: ['turnComplete'] });
  check(events.events.length >= 2, 'event log has both turnComplete events', events);

  const analytics = await call('dispatch_ui_action', {
    tabId,
    action: { type: 'getProjectAnalytics' },
    waitForEvent: 'projectAnalyticsData',
    timeoutSec: 20,
  });
  check(analytics.event?.type === 'projectAnalyticsData', 'dispatch_ui_action + waitForEvent', analytics);

  check((await call('rename_tab', { tabId, name: 'RC smoke renamed' })).name === 'RC smoke renamed', 'rename_tab');
  check((await call('set_effort', { tabId, effort: 'low' })).effort === 'low', 'set_effort');

  // --- folders -----------------------------------------------------------------
  const group = (await call('create_group', { label: 'RC smoke folder' })).group;
  await call('move_tab_to_group', { tabId, groupId: group.id });
  const groups = await call('list_groups');
  check(groups.groups.find((g: { id: string }) => g.id === group.id)?.tabs.some((t: { id: string }) => t.id === tabId), 'move_tab_to_group');
  await call('delete_group', { groupId: group.id });
  check(!(await call('list_groups')).groups.some((g: { id: string }) => g.id === group.id), 'delete_group');

  // --- question / approval (optional: depends on the model calling the tool) ---
  if (withQuestion) {
    const asked = await call('send_message', {
      tabId,
      text: 'Use the AskUserQuestion tool exactly once to ask me which color I prefer, with the options "Red" and "Blue". After I answer, reply with just the color name.',
      timeoutSec: 180,
    }, 240);
    check(asked.status === 'awaiting_approval' && asked.pendingApproval?.kind === 'question', 'AskUserQuestion surfaces as awaiting_approval', asked);
    const pending = await call('list_pending_approvals');
    check(pending.approvals.some((a: { tabId: string }) => a.tabId === tabId), 'list_pending_approvals');
    const answered = await call('answer_question', { tabId, answers: [{ answers: ['Blue'] }], timeoutSec: 180 }, 240);
    check(answered.status === 'completed' && /blue/i.test(answered.response), 'answer_question completes the turn', answered);
  }

  // --- hibernation -------------------------------------------------------------
  const slept = await call('hibernate_tab', { tabId });
  check(slept.hibernated === 'light', 'hibernate_tab light', slept);
  const woke = await call('wake_tab', { tabId, timeoutSec: 60 }, 90);
  check(woke.woke === true, 'wake_tab', woke);

  // --- stdio launcher ----------------------------------------------------------
  const launcher = path.join(os.homedir(), '.claui', 'remote-control', 'bin', 'claui-mcp.js');
  check(fs.existsSync(launcher), 'stable launcher installed', launcher);
  const child = spawn(process.execPath, [launcher], { env: { ...process.env, CLAUI_INSTANCE: instance.instanceId } });
  const lines = readline.createInterface({ input: child.stdout });
  const replies: Record<string, any>[] = [];
  const nextReply = () =>
    new Promise<Record<string, any>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('stdio timeout')), 15_000);
      const poll = setInterval(() => {
        const r = replies.shift();
        if (r) {
          clearInterval(poll);
          clearTimeout(timer);
          resolve(r);
        }
      }, 20);
    });
  lines.on('line', (l) => replies.push(JSON.parse(l)));
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } })}\n`);
  check((await nextReply()).result?.serverInfo?.name === 'claui', 'stdio initialize via launcher');
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
  const toolCount = (await nextReply()).result?.tools?.length ?? 0;
  check(toolCount >= 45, `stdio tools/list (${toolCount} tools)`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_tab', arguments: { tabId } } })}\n`);
  const viaStdio = JSON.parse((await nextReply()).result.content[0].text);
  check(viaStdio.id === tabId, 'stdio tools/call forwarded to the window');
  child.kill();

  if (!keepTab) {
    await call('close_tab', { tabId });
    check(!(await call('list_tabs')).tabs.some((t: { id: string }) => t.id === tabId), 'close_tab');
  }
}

main().catch((err) => {
  console.error(`ERROR ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
