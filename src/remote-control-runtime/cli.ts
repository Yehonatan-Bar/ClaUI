import { RemoteControlError } from '../remote-control-shared/protocol';
import { TOOL_CATALOG } from '../remote-control-shared/toolCatalog';
import { InstanceClient } from './instanceClient';
import { LOCAL_TOOL_NAMES, runLocalTool } from './localTools';

/**
 * ClaUi Remote Control - command-line client for scripts.
 *
 *   node ~/.claui/remote-control/bin/claui.js <command> [options]
 *
 * Exit codes: 0 ok / turn completed, 1 error, 2 waiting for approval or
 * question, 3 timeout (turn still running), 4 no ClaUi window reachable.
 */

const HELP = `ClaUi Remote Control CLI

Usage: claui <command> [options]

Commands:
  status                         Window status (version, workspace, tabs, defaults)
  instances                      Every ClaUi window with remote control on
  tabs                           List open chat tabs
  tools                          List every tool with its description
  new [--provider P] [--model M] [--name N] [--prompt TEXT] [--no-wait]
                                 Open a new chat tab (optionally send a first prompt)
  send <text> [--tab T] [--no-wait] [--timeout SEC] [--queue]
                                 Send a prompt and print the reply
  wait [--tab T] [--timeout SEC] Wait for the tab to finish and print the reply
  messages [--tab T] [--session ID] [--limit N]
                                 Print the conversation
  approvals                      Pending plan approvals / questions
  approve [--tab T] [--reject] [--feedback TEXT]
  answer <text> [--tab T]        Answer a pending question (free text)
  cancel [--tab T]               Cancel the running response
  events [--follow] [--tab T] [--types a,b] [--since SEQ]
                                 Print events (follow = stream until Ctrl+C)
  call <tool> [--json '{...}'] [--arg key=value ...]
                                 Call any tool with JSON arguments

Global options:
  --instance <id|workspace>      Target a specific VS Code window (or env CLAUI_INSTANCE)
  --json                         Print raw JSON results
  -h, --help                     Show this help
`;

interface ParsedArgs {
  positional: string[];
  flags: Map<string, string | true>;
  pairs: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  const pairs: string[] = [];
  const booleanFlags = new Set(['json', 'no-wait', 'follow', 'reject', 'queue', 'help', 'h']);
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '-h') {
      flags.set('help', true);
    } else if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      const key = eq > 0 ? token.slice(2, eq) : token.slice(2);
      if (eq > 0) {
        flags.set(key, token.slice(eq + 1));
      } else if (booleanFlags.has(key)) {
        flags.set(key, true);
      } else if (key === 'arg') {
        pairs.push(argv[++i] ?? '');
      } else {
        flags.set(key, argv[++i] ?? '');
      }
    } else {
      positional.push(token);
    }
  }
  return { positional, flags, pairs };
}

function flag(args: ParsedArgs, name: string): string | undefined {
  const v = args.flags.get(name);
  return typeof v === 'string' ? v : undefined;
}

function coerce(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (/^[[{]/.test(value)) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function exitCodeForStatus(status: unknown): number {
  switch (status) {
    case 'awaiting_approval':
      return 2;
    case 'timeout':
      return 3;
    case 'error':
    case 'session_ended':
      return 1;
    default:
      return 0;
  }
}

function printTurn(result: Record<string, unknown>): void {
  if (typeof result.response === 'string' && result.response) {
    process.stdout.write(`${result.response}\n`);
  }
  const status = String(result.status ?? '');
  if (status && status !== 'completed' && status !== 'sent') {
    process.stderr.write(`[status: ${status}]${result.hint ? ` ${result.hint}` : ''}\n`);
  }
  const pending = result.pendingApproval as { kind?: string; toolName?: string; plan?: string; questions?: unknown[] } | undefined;
  if (pending) {
    process.stderr.write(`[pending ${pending.kind}: ${pending.toolName}]\n`);
    if (pending.plan) process.stderr.write(`${pending.plan}\n`);
    if (pending.questions) process.stderr.write(`${JSON.stringify(pending.questions, null, 2)}\n`);
  }
  if (result.error) {
    process.stderr.write(`[error] ${String(result.error)}\n`);
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const command = args.positional[0];
  if (!command || args.flags.has('help') || command === 'help') {
    process.stdout.write(HELP);
    return 0;
  }
  const asJson = args.flags.has('json');
  const client = new InstanceClient({ preferred: flag(args, 'instance') ?? process.env.CLAUI_INSTANCE, cwd: process.cwd() });
  const tabArg = (): Record<string, unknown> => {
    const tab = flag(args, 'tab');
    return tab === undefined ? {} : { tabId: coerce(tab) };
  };
  const call = async (tool: string, toolArgs: Record<string, unknown>): Promise<unknown> => {
    if (LOCAL_TOOL_NAMES.has(tool)) {
      return runLocalTool(client, tool, toolArgs);
    }
    const timeout = typeof toolArgs.timeoutSec === 'number' ? toolArgs.timeoutSec : typeof toolArgs.waitSec === 'number' ? toolArgs.waitSec : 600;
    return client.callTool(tool, toolArgs, (timeout + 60) * 1000);
  };
  const print = (value: unknown): void => {
    process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);
  };
  const timeoutArg = (): Record<string, unknown> => (flag(args, 'timeout') ? { timeoutSec: Number(flag(args, 'timeout')) } : {});

  switch (command) {
    case 'status':
      print(await call('get_status', {}));
      return 0;
    case 'instances':
      print(await call('list_instances', {}));
      return 0;
    case 'tools':
      if (asJson) {
        print(TOOL_CATALOG);
      } else {
        for (const t of TOOL_CATALOG) process.stdout.write(`${t.name.padEnd(26)} ${t.title}${t.mutating ? '' : '  (read-only)'}\n`);
      }
      return 0;
    case 'tabs': {
      const result = (await call('list_tabs', {})) as { tabs: Array<Record<string, unknown>> };
      if (asJson) {
        print(result);
      } else if (result.tabs.length === 0) {
        process.stdout.write('No tabs open.\n');
      } else {
        for (const t of result.tabs) {
          const flags = [t.active ? 'active' : '', t.busy ? 'busy' : '', t.pendingApproval ? 'needs-approval' : '', t.sleepState !== 'awake' ? String(t.sleepState) : '']
            .filter(Boolean)
            .join(',');
          process.stdout.write(`${String(t.id).padEnd(10)} #${String(t.number).padEnd(3)} ${String(t.provider).padEnd(7)} ${String(t.model ?? '-').padEnd(26)} ${t.name}${flags ? `  [${flags}]` : ''}\n`);
        }
      }
      return 0;
    }
    case 'new': {
      const toolArgs: Record<string, unknown> = { ...timeoutArg() };
      for (const key of ['provider', 'model', 'name', 'prompt', 'effort']) {
        const v = flag(args, key);
        if (v !== undefined) toolArgs[key] = v;
      }
      if (args.flags.has('no-wait')) toolArgs.wait = false;
      const result = (await call('create_tab', toolArgs)) as Record<string, unknown>;
      if (asJson) {
        print(result);
      } else {
        process.stderr.write(`[tab ${result.tabId}]\n`);
        printTurn(result);
      }
      return exitCodeForStatus(result.status);
    }
    case 'send': {
      const text = args.positional.slice(1).join(' ');
      if (!text) {
        process.stderr.write('send: missing text\n');
        return 1;
      }
      const toolArgs: Record<string, unknown> = { ...tabArg(), ...timeoutArg(), text };
      if (args.flags.has('no-wait')) toolArgs.wait = false;
      if (args.flags.has('queue')) toolArgs.ifBusy = 'queue';
      const result = (await call('send_message', toolArgs)) as Record<string, unknown>;
      if (asJson) print(result);
      else printTurn(result);
      return exitCodeForStatus(result.status);
    }
    case 'wait': {
      const result = (await call('wait_for_idle', { ...tabArg(), ...timeoutArg() })) as Record<string, unknown>;
      if (asJson) print(result);
      else printTurn(result);
      return exitCodeForStatus(result.status);
    }
    case 'messages': {
      const toolArgs: Record<string, unknown> = { ...tabArg() };
      if (flag(args, 'session')) toolArgs.sessionId = flag(args, 'session');
      if (flag(args, 'limit')) toolArgs.limit = Number(flag(args, 'limit'));
      const result = (await call('get_messages', toolArgs)) as { messages: Array<{ role: string; text?: string; time?: string }> };
      if (asJson) {
        print(result);
      } else {
        for (const m of result.messages) {
          process.stdout.write(`--- ${m.role}${m.time ? ` (${m.time})` : ''}\n${m.text ?? ''}\n\n`);
        }
      }
      return 0;
    }
    case 'approvals':
      print(await call('list_pending_approvals', {}));
      return 0;
    case 'approve': {
      const feedback = flag(args, 'feedback');
      const action = args.flags.has('reject') ? 'reject' : feedback ? 'feedback' : 'approve';
      const result = (await call('respond_to_approval', { ...tabArg(), ...timeoutArg(), action, ...(feedback ? { feedback } : {}) })) as Record<string, unknown>;
      if (asJson) print(result);
      else printTurn(result);
      return exitCodeForStatus(result.status);
    }
    case 'answer': {
      const text = args.positional.slice(1).join(' ');
      const result = (await call('answer_question', { ...tabArg(), ...timeoutArg(), text })) as Record<string, unknown>;
      if (asJson) print(result);
      else printTurn(result);
      return exitCodeForStatus(result.status);
    }
    case 'cancel':
      print(await call('cancel_response', tabArg()));
      return 0;
    case 'events': {
      const base: Record<string, unknown> = { ...tabArg() };
      const types = flag(args, 'types');
      if (types) base.types = types.split(',').map((t) => t.trim()).filter(Boolean);
      let since = flag(args, 'since') !== undefined ? Number(flag(args, 'since')) : undefined;
      const follow = args.flags.has('follow');
      do {
        const result = (await call('get_events', {
          ...base,
          ...(since !== undefined ? { sinceSeq: since } : {}),
          ...(follow ? { waitSec: 60 } : {}),
          limit: 200,
        })) as { events: Array<{ seq: number; time: string; tabId: string | null; direction: string; type: string; data: unknown }>; nextSeq: number };
        for (const e of result.events) {
          if (asJson) process.stdout.write(`${JSON.stringify(e)}\n`);
          else process.stdout.write(`${e.seq}\t${e.time}\t${e.tabId ?? '-'}\t${e.direction}\t${e.type}\t${JSON.stringify(e.data).slice(0, 200)}\n`);
        }
        since = result.nextSeq;
      } while (follow);
      return 0;
    }
    case 'call': {
      const tool = args.positional[1];
      if (!tool) {
        process.stderr.write('call: missing tool name (see `claui tools`)\n');
        return 1;
      }
      let toolArgs: Record<string, unknown> = {};
      const json = flag(args, 'json');
      if (json) {
        try {
          toolArgs = JSON.parse(json) as Record<string, unknown>;
        } catch {
          process.stderr.write('call: --json is not valid JSON\n');
          return 1;
        }
      }
      for (const pair of args.pairs) {
        const eq = pair.indexOf('=');
        if (eq > 0) toolArgs[pair.slice(0, eq)] = coerce(pair.slice(eq + 1));
      }
      const result = await call(tool, toolArgs);
      print(result);
      return exitCodeForStatus((result as { status?: unknown })?.status);
    }
    default:
      process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
      return 1;
  }
}

// Note: `--json` takes a value only for `call`; elsewhere it is a boolean flag.
// parseArgs treats it as boolean, so `call` reads the JSON from the next token.
const rawArgv = process.argv.slice(2);
const jsonIndex = rawArgv[0] === 'call' ? rawArgv.indexOf('--json') : -1;
if (jsonIndex >= 0 && rawArgv[jsonIndex + 1] !== undefined) {
  rawArgv[jsonIndex] = `--json=${rawArgv[jsonIndex + 1]}`;
  rawArgv.splice(jsonIndex + 1, 1);
  process.argv = [...process.argv.slice(0, 2), ...rawArgv];
}

main().then(
  (code) => process.exit(code),
  (err) => {
    if (err instanceof RemoteControlError) {
      process.stderr.write(`Error (${err.code}): ${err.message}\n`);
      process.exit(err.code === 'no_instance' ? 4 : 1);
    }
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
