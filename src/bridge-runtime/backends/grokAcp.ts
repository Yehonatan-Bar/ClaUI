import { ChildProcess } from 'child_process';
import * as path from 'path';
import * as readline from 'readline';
import { BRIDGE_COMMANDS } from '../commands/commandCatalog';
import { killTree, killTreeAsync, resolveExecutable, spawnCli } from '../procUtils';
import { BridgePrompt, imagesOmittedNote, StreamEmitter } from '../protocol';
import { SessionStore } from '../sessionStore';

/**
 * xAI Grok backend over the official Grok CLI's ACP surface
 * (`grok agent stdio`, JSON-RPC / Agent Client Protocol).
 *
 * Requires the user to have installed and authenticated the Grok CLI
 * (`npm i -g @xai-official/grok`, then `grok login`). The bridge advertises no
 * client fs/terminal capabilities, so Grok uses its own tools; tool activity is
 * translated into Claude-style tool_use blocks for the ClaUi timeline.
 */

const KIND_TO_TOOL: Record<string, string> = {
  execute: 'Bash',
  edit: 'Edit',
  read: 'Read',
  delete: 'Bash',
  move: 'Bash',
  search: 'Grep',
  fetch: 'WebFetch',
  think: 'Task',
  other: 'Tool',
};

/** ACP tool-call kinds that only read/observe (never mutate the workspace or
 *  run commands). Under supervised mode only these are auto-approved; anything
 *  else (execute/edit/delete/move/unknown) is rejected — mirroring the
 *  read-only --allowedTools whitelist ClaUi hands the real Claude CLI. */
const READ_ONLY_KINDS = new Set(['read', 'search', 'fetch', 'think']);

export function isReadOnlyGrokKind(kind: string | undefined | null): boolean {
  return READ_ONLY_KINDS.has(String(kind || '').trim());
}

/** ACP tool-call kinds that mutate the workspace or run commands — the exact
 *  complement of READ_ONLY_KINDS among the kinds ACP is known to report
 *  (excludes 'other'/unknown deliberately: an unrecognized kind must stay
 *  denied even inside an open write window, not be treated as "probably a
 *  write"). Only these are auto-approved while a write window is open —
 *  the window is a scoped ALLOWLIST expansion, never a blanket bypass of the
 *  permission gate. */
const KNOWN_WRITE_KINDS = new Set(['execute', 'edit', 'delete', 'move']);

export function isKnownWriteGrokKind(kind: string | undefined | null): boolean {
  return KNOWN_WRITE_KINDS.has(String(kind || '').trim());
}

/** The actual Grok ACP permission decision, extracted as a pure function so
 *  it's directly unit-testable (not just the dispatcher's write-window
 *  computation, and not just that the pre-session setter doesn't throw).
 *  Deny-first: an open write window only expands the allowlist to KNOWN
 *  write kinds — it is never a blanket "allow everything" bypass, so an
 *  unrecognized/future `kind` value stays denied even while open. */
export function shouldPermitGrokTool(
  permissionMode: string,
  kind: string | undefined | null,
  writeWindowOpen: boolean,
): boolean {
  // Exact match, not `!== 'supervised'`: cli.ts only ever computes
  // 'full-access' or 'supervised' today, but an exact check means an
  // unexpected/future value defaults to the (more restrictive) supervised
  // path instead of silently being treated as full-access.
  if (permissionMode === 'full-access') return true;
  if (isReadOnlyGrokKind(kind)) return true;
  return writeWindowOpen && isKnownWriteGrokKind(kind);
}

/** Best-effort recognition of one of OUR OWN registered MCP command tools
 *  (claui_code_review etc.) from an ACP tool_call update's TITLE ONLY (not
 *  arbitrary input field values — e.g. a real `execute`/Bash call with
 *  `command: "rg claui_code_review src"` would otherwise false-positive on
 *  its own command string) so the timeline shows a real tool card instead of
 *  the generic "Tool" fallback for an MCP-sourced call. Display-only: NEVER
 *  used for the permission gate (see isReadOnlyGrokKind) — that must not
 *  trust model-controlled text for an authorization decision, only this
 *  cosmetic label. */
export function resolveBridgeToolNameHint(title: string | undefined): string | null {
  if (!title) return null;
  const match = BRIDGE_COMMANDS.find((spec) => title.includes(spec.toolName));
  return match ? match.toolName : null;
}

/** Full display-name resolution for a `tool_call` update, in priority order:
 *  (1) a CONCRETE (non-generic) ACP built-in kind mapping via KIND_TO_TOOL —
 *  trusted first, so a real execute/read/search/etc. call is never
 *  relabeled just because its title or command text happens to mention one
 *  of our tool names (see the false-positive above); (2) only when ACP
 *  didn't confidently classify the call (kind is absent, or maps to the
 *  generic 'Tool' bucket — the expected shape for an MCP-sourced call, since
 *  ACP has no built-in semantic kind for MCP tools), check the title for one
 *  of our own bridge tool names; (3) heuristics on the raw input shape;
 *  (4) generic 'Tool'. A standalone exported function so the full priority
 *  order is directly unit-testable.
 *
 *  Known tradeoff (disclosed, unverifiable without a live Grok CLI): if our
 *  MCP `readOnlyHint` annotation ever causes Grok to report a CONCRETE
 *  built-in kind (e.g. 'read') for our OWN tool call rather than 'other',
 *  step (1) wins and the card shows the generic built-in label instead of
 *  our tool name — display-only, so this is a cosmetic under-label, not a
 *  functional or security issue. This is judged the better failure mode
 *  than the alternative (mislabeling a real built-in call with our tool
 *  name from a coincidental text match). */
export function resolveToolCallName(
  kind: string | undefined,
  title: string | undefined,
  input: Record<string, unknown>,
): string {
  const fromKind = KIND_TO_TOOL[kind || ''] || '';
  if (fromKind && fromKind !== 'Tool') return fromKind;

  const bridgeToolName = resolveBridgeToolNameHint(title);
  if (bridgeToolName) return bridgeToolName;

  if (input.command) return 'Bash';
  if (input.file_path !== undefined && input.content !== undefined) return 'Write';
  if (input.target_file || input.file_path) return 'Read';
  if (input.pattern || input.query) return 'Grep';
  if (input.url) return 'WebFetch';
  return 'Tool';
}

/** Hard ceiling on a single Grok turn so a hung agent can't wedge the tab. */
const PROMPT_TIMEOUT_MS = Number(process.env.CLAUI_BRIDGE_GROK_TIMEOUT_MS || 10 * 60 * 1000);

/** Known global install locations for the Grok CLI (used both for spawning and
 *  for availability detection, e.g. the council roster). */
export function grokKnownLocations(): string[] {
  const known: string[] = [];
  if (process.platform === 'win32' && process.env.APPDATA) {
    known.push(
      path.join(
        process.env.APPDATA,
        'npm',
        'node_modules',
        '@xai-official',
        'grok',
        'node_modules',
        '@xai-official',
        'grok-win32-x64',
        'bin',
        'grok.exe',
      ),
    );
  }
  return known;
}

/** Resolve a runnable Grok CLI invocation from the configured path. Always
 *  shell-free (grok's args are constant, but we stay consistent and robust to
 *  npm .cmd shims by resolving the real .exe). */
export function resolveGrokCli(cliPath: string): { command: string; useShell: boolean } {
  return resolveExecutable(cliPath, 'grok', grokKnownLocations());
}

/** Bridge command-tools (Layer B — see src/bridge-runtime/commands/) wiring
 *  for a single Grok tab. `enabled` gates whether the MCP command server is
 *  registered with ACP at all; `serverScriptPath` is the sibling
 *  dist/bridge-runtime/mcp/command-server.js bundle, computed by cli.ts. */
export interface GrokCommandToolsConfig {
  enabled: boolean;
  serverScriptPath: string;
  cwd: string;
  diffBase: string;
}

/** MCP server descriptor for ACP's session/new & session/load, exposing
 *  ClaUi's engine slash commands as callable tools (Layer B). Empty when
 *  command-tools are disabled. `env` MUST be an array of {name,value} pairs,
 *  not a plain object — confirmed against the published ACP session-setup
 *  schema; a strict ACP agent rejects the object form outright (-32602
 *  Invalid params). A standalone exported function (not a class method) so
 *  it's directly unit-testable without spinning up a full GrokAcpBackend. */
export function buildGrokMcpServers(commandTools: GrokCommandToolsConfig): unknown[] {
  if (!commandTools.enabled) return [];
  return [
    {
      type: 'stdio',
      name: 'claui-commands',
      command: process.execPath,
      args: [commandTools.serverScriptPath],
      env: [
        { name: 'CLAUI_CWD', value: commandTools.cwd },
        { name: 'CLAUI_DIFF_BASE', value: commandTools.diffBase },
      ],
    },
  ];
}

/** Builds the optional system preamble for a Grok turn. `<system-rules>` is
 *  sent only on a session's true first-ever turn (matching prior behavior —
 *  a resumed session's underlying Grok ACP session already has it from
 *  before). The command-tools teaching block is sent once per BACKEND
 *  INSTANCE (tracked by the caller via `commandToolsAlreadyTaught`)
 *  regardless of stored history — a resumed session may have history from
 *  before command-tools existed/were enabled, and its Grok ACP session has
 *  never actually seen the block, so history alone can't gate it. Returns
 *  null when there is nothing to inject. A standalone exported function so
 *  this decoupling is directly unit-testable without a live ACP session. */
export function buildFirstTurnPreamble(opts: {
  isFirstEverTurn: boolean;
  systemPrompt: string;
  commandToolsEnabled: boolean;
  commandToolsAlreadyTaught: boolean;
}): string | null {
  const parts: string[] = [];
  if (opts.isFirstEverTurn && opts.systemPrompt) {
    parts.push(`<system-rules>\n${opts.systemPrompt}\n</system-rules>`);
  }
  if (opts.commandToolsEnabled && !opts.commandToolsAlreadyTaught) {
    parts.push(buildCommandToolsSystemBlock());
  }
  return parts.length ? parts.join('\n\n') : null;
}

/** System-prompt block teaching Grok to call the command tools for a typed
 *  slash command or an equivalent plain-language request — generated from
 *  BRIDGE_COMMANDS so it never drifts out of sync with the actual catalog. */
export function buildCommandToolsSystemBlock(): string {
  const mappings = BRIDGE_COMMANDS.map((spec) => {
    const names = [spec.name, ...(spec.aliases || [])].map((n) => `"/${n}"`).join(' or ');
    return `For ${names} (or an equivalent plain-language request) call ${spec.toolName}.`;
  }).join(' ');
  return (
    '<claui-commands>\n' +
    `You have ClaUi command tools. ${mappings} Each tool returns a task packet ` +
    '(rubric + diff); perform the task with your own read/grep tools and report findings. ' +
    "Do not ask the user to paste the diff — the tool provides it.\n" +
    '</claui-commands>'
  );
}

class AcpClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private child: ChildProcess;
  private exited = false;

  /** True once the underlying grok process has exited — the session is dead and
   *  must be rebuilt rather than reused (writes to its stdin would be silently
   *  dropped and every subsequent request would hang). */
  get isDead(): boolean {
    return this.exited;
  }

  /** Council mode: reject every tool-permission request so the agent answers
   *  text-only and cannot invoke any tool (structurally non-mutating). */
  private readonly noTools: boolean;

  /** Per-turn write window (Section 6 of the bridge command-tools plan):
   *  while open, supervised mode also auto-approves write/execute tool
   *  kinds — not just read-only ones — for a mutating command run with
   *  `--fix` (or a full-access tab). The caller (GrokAcpBackend) is
   *  responsible for opening it right before `session/prompt` and closing it
   *  right after, so it is scoped to exactly one turn and never left open. */
  private writeWindowOpen = false;

  setWriteWindow(open: boolean): void {
    this.writeWindowOpen = open;
  }

  constructor(
    cliPath: string,
    private readonly onUpdate: (update: Record<string, unknown>) => void,
    private readonly log: (msg: string) => void,
    private readonly permissionMode: string,
    opts?: { cwd?: string; noTools?: boolean; onSpawn?: (child: ChildProcess) => void },
  ) {
    this.noTools = !!opts?.noTools;
    const { command } = resolveGrokCli(cliPath);
    // spawnCli (cross-spawn) so a Windows `.cmd`/`.bat` shim — which detection
    // (whichSync) accepts but a raw shell-free spawn cannot launch — still runs.
    this.child = spawnCli(command, ['agent', 'stdio'], {
      cwd: opts?.cwd || process.cwd(),
      windowsHide: true,
    });
    opts?.onSpawn?.(this.child);
    this.child.on('error', (e) => {
      this.exited = true;
      this.rejectAll(new Error(`Failed to start Grok CLI: ${e.message}`));
    });
    this.child.stderr?.on('data', (d) => this.log(`grok stderr: ${String(d).slice(0, 400)}`));
    this.child.on('exit', (code) => {
      this.exited = true;
      this.log(`grok agent exited: ${code}`);
      this.rejectAll(new Error(`Grok CLI exited (code ${code}). Is it installed and logged in? Run: grok login`));
    });
    const rl = readline.createInterface({ input: this.child.stdout! });
    rl.on('line', (line) => this.onLine(line));
  }

  private rejectAll(err: Error): void {
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
  }

  private onLine(line: string): void {
    let msg: {
      id?: number;
      result?: unknown;
      error?: { message?: string };
      method?: string;
      params?: {
        update?: Record<string, unknown>;
        options?: { kind?: string; optionId?: string }[];
        toolCall?: { title?: string; kind?: string };
      };
    };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        if (msg.error) {
          p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        } else {
          p.resolve(msg.result);
        }
      }
      return;
    }
    if (msg.method === 'session/update') {
      this.onUpdate(msg.params?.update || {});
      return;
    }
    if (msg.method === 'session/request_permission' && msg.id !== undefined) {
      const opts = msg.params?.options || [];
      if (this.noTools) {
        // Council mode: text-only advisor — deny EVERY tool request. A
        // `cancelled` outcome denies without inspecting `options`, so a
        // malformed options shape from the CLI can never throw here (fail
        // closed: the member cannot touch the workspace or run any command).
        this.send({ jsonrpc: '2.0', id: msg.id, result: { outcome: { outcome: 'cancelled' } } });
        return;
      }
      const kind = msg.params?.toolCall?.kind;
      const permit = shouldPermitGrokTool(this.permissionMode, kind, this.writeWindowOpen);
      if (permit) {
        const allow =
          opts.find((o) => o.kind === 'allow_once') ||
          opts.find((o) => (o.kind || '').startsWith('allow')) ||
          opts[0];
        this.send({
          jsonrpc: '2.0',
          id: msg.id,
          result: { outcome: { outcome: 'selected', optionId: allow?.optionId || 'allow' } },
        });
      } else {
        this.log(`supervised: rejecting non-read-only tool kind '${kind || 'unknown'}'`);
        const reject =
          opts.find((o) => (o.kind || '').startsWith('reject')) ||
          opts.find((o) => (o.kind || '').startsWith('deny'));
        this.send(
          reject
            ? {
                jsonrpc: '2.0',
                id: msg.id,
                result: { outcome: { outcome: 'selected', optionId: reject.optionId } },
              }
            : { jsonrpc: '2.0', id: msg.id, result: { outcome: { outcome: 'cancelled' } } },
        );
      }
      return;
    }
    if (msg.method && msg.id !== undefined) {
      // Unknown agent->client request (e.g. fs/*): refuse politely; Grok falls
      // back to its own tools since we advertise no client capabilities.
      this.send({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: `Method not supported by bridge: ${msg.method}` },
      });
    }
  }

  private send(obj: unknown): void {
    try {
      this.child.stdin?.write(JSON.stringify(obj) + '\n');
    } catch (e) {
      this.log(`acp write failed: ${(e as Error).message}`);
    }
  }

  request(method: string, params: unknown, timeoutMs = 0): Promise<unknown> {
    // Fail fast if the process has already exited — otherwise a request would
    // sit in `pending` forever (no future 'exit' to trigger rejectAll), which
    // would deadlock the caller's await.
    if (this.exited) {
      return Promise.reject(new Error(`Grok CLI is not running (cannot ${method})`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      // Clear the per-request timer on ANY settlement (response, error, or
      // rejectAll) so its closure is not retained for the full timeout window.
      this.pending.set(id, {
        resolve: (v) => {
          if (timer) clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          if (timer) clearTimeout(timer);
          reject(e);
        },
      });
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          if (this.pending.has(id)) {
            this.pending.delete(id);
            reject(new Error(`ACP ${method} timed out after ${timeoutMs}ms`));
          }
        }, timeoutMs);
        timer.unref?.();
      }
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  kill(): void {
    killTree(this.child);
  }

  /** Non-blocking kill — used on the council path so an interrupt / per-member
   *  timeout does not block on a synchronous taskkill. */
  killAsync(): void {
    killTreeAsync(this.child);
  }

  /** Kill and await the child's exit (bounded), so a normal council turn does
   *  not return while its throwaway grok process is still alive (which would
   *  leak an untracked child). Never blocks longer than `timeoutMs`. */
  disposeAsync(timeoutMs = 2000): Promise<void> {
    return new Promise((resolve) => {
      if (this.exited) {
        killTreeAsync(this.child);
        resolve();
        return;
      }
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve();
      };
      const t = setTimeout(finish, timeoutMs);
      t.unref?.();
      this.child.once('exit', finish);
      this.child.once('close', finish);
      killTreeAsync(this.child);
    });
  }
}

/**
 * One-shot Grok council member: a throwaway ACP session in `cwd` (a temp dir),
 * text-only (rejects every tool request), that returns the agent's message.
 * Never persists session state — the council treats each turn as independent.
 *
 * Cancellation/timeout is driven by the caller's AbortSignal: on abort the grok
 * process is killed non-blockingly (`killAsync`), which rejects the pending
 * request; the caller distinguishes timeout vs. user-interrupt itself.
 */
export async function runGrokCouncilPrompt(
  cliPath: string,
  model: string,
  systemPrompt: string,
  question: string,
  cwd: string,
  signal: AbortSignal,
  onChild: (child: ChildProcess) => void,
  log: (msg: string) => void,
): Promise<string> {
  let lastText = '';
  const client = new AcpClient(
    cliPath,
    (u) => {
      if ((u.sessionUpdate as string) === 'agent_message_chunk') {
        const content = u.content as { text?: string } | undefined;
        lastText += content?.text ?? '';
      }
    },
    log,
    'council',
    { cwd, noTools: true, onSpawn: onChild },
  );

  const onAbort = (): void => client.killAsync();
  if (signal.aborted) {
    client.killAsync();
    throw new Error('aborted');
  }
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    await client.request(
      'initialize',
      {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: 'claui-bridge-council', version: '1.0.0' },
      },
      30000,
    );
    const res = (await client.request(
      'session/new',
      { cwd, mcpServers: [], ...(model ? { modelId: model } : {}) },
      60000,
    )) as { sessionId?: string };
    const sid = res.sessionId;
    if (!sid) throw new Error('Grok CLI did not return a session id');
    if (model) {
      try {
        await client.request('session/set_model', { sessionId: sid, modelId: model }, 15000);
      } catch (e) {
        // Swallow a "model not applied" (the model was already passed at
        // session/new) — but if the process died/aborted mid-request, stop
        // rather than send a prompt to a dead client (which would hang).
        if (client.isDead || signal.aborted) throw new Error('Grok CLI exited before answering');
        log(`council grok set_model not applied: ${(e as Error).message}`);
      }
    }
    const promptBlocks: { type: 'text'; text: string }[] = [];
    if (systemPrompt) {
      promptBlocks.push({ type: 'text', text: `<system-rules>\n${systemPrompt}\n</system-rules>` });
    }
    promptBlocks.push({ type: 'text', text: question });
    // No ACP-level timeout: the council owns per-member timeout via `signal`.
    // (request() fails fast if the client is already dead.)
    await client.request('session/prompt', { sessionId: sid, prompt: promptBlocks }, 0);
    return lastText;
  } finally {
    signal.removeEventListener('abort', onAbort);
    // Await bounded process teardown so a normal turn does not leave the
    // throwaway grok child alive/untracked.
    await client.disposeAsync();
  }
}

export class GrokAcpBackend {
  private acp: AcpClient | null = null;
  private acpSessionId: string | null = null;
  private lastText = '';
  private emitter: StreamEmitter | null = null;
  /** Whether the command-tools teaching block has been sent by THIS backend
   *  instance yet — tracked independently of stored session history, because
   *  a RESUMED tab has non-empty history from before this feature (or before
   *  command-tools were enabled) shipped, and its underlying Grok ACP session
   *  has never actually seen the teaching block. Every fresh process/tab-open
   *  gets exactly one re-teaching, regardless of the session's prior turns. */
  private commandToolsTaught = false;
  /** Desired write-window state for the NEXT `session/prompt` — set by
   *  `setWriteWindow` (called from cli.ts before `runTurn`), applied to
   *  `this.acp` at the start of `runTurn` (not directly here) because
   *  `this.acp` may not exist yet (created lazily by `ensureSession`). */
  private pendingWriteWindow = false;

  constructor(
    private readonly cliPath: string,
    private readonly model: string,
    private readonly sessionId: string,
    private readonly store: SessionStore,
    private readonly systemPrompt: string,
    private readonly permissionMode: string,
    private readonly log: (msg: string) => void,
    private readonly commandTools: GrokCommandToolsConfig,
  ) {}

  /** Open/close the per-turn write window (Section 6 — a mutating command
   *  run with --fix, or a full-access tab). The caller is responsible for
   *  closing it again after the turn settles, success or failure, so it is
   *  scoped to exactly one turn. */
  setWriteWindow(open: boolean): void {
    this.pendingWriteWindow = open;
    this.acp?.setWriteWindow(open);
  }

  interrupt(): void {
    // Revoke the write window EAGERLY, before cancellation even goes out —
    // cli.ts's finally-based close only runs once runTurn's promise settles,
    // which is not immediate: a hung/slow-to-cancel Grok process could still
    // emit another session/request_permission during the cancellation grace
    // period, and it must see the window already closed, not the up-to-10-
    // minute PROMPT_TIMEOUT_MS window it would otherwise still be open for.
    this.setWriteWindow(false);
    if (this.acp && this.acpSessionId) {
      this.acp.notify('session/cancel', { sessionId: this.acpSessionId });
    }
  }

  dispose(): void {
    this.acp?.kill();
  }

  private onUpdate = (u: Record<string, unknown>): void => {
    const emitter = this.emitter;
    if (!emitter) return;
    const kind = u.sessionUpdate as string;
    const content = u.content as { text?: string } | undefined;
    if (kind === 'agent_thought_chunk') {
      emitter.append('thinking', content?.text ?? '');
    } else if (kind === 'agent_message_chunk') {
      const t = content?.text ?? '';
      this.lastText += t;
      emitter.append('text', t);
    } else if (kind === 'tool_call') {
      const rawInput = u.rawInput;
      const input: Record<string, unknown> =
        rawInput && typeof rawInput === 'object'
          ? (rawInput as Record<string, unknown>)
          : { description: (u.title as string) || '' };
      const name = resolveToolCallName(u.kind as string | undefined, u.title as string | undefined, input);
      if (u.title && !input.description && name !== 'Bash') {
        input.description = u.title;
      }
      emitter.toolUse(String(u.toolCallId || `tool_${Date.now()}`), name, input);
    } else if (kind === 'tool_call_update') {
      const status = u.status as string;
      if (status === 'completed' || status === 'failed') {
        const parts: string[] = [];
        const contentArr = u.content as unknown[] | undefined;
        if (Array.isArray(contentArr)) {
          for (const c of contentArr) {
            const cc = c as { type?: string; content?: { type?: string; text?: string }; path?: string };
            if (cc?.type === 'content' && cc.content?.type === 'text' && cc.content.text) {
              parts.push(cc.content.text);
            } else if (cc?.type === 'diff') {
              parts.push(`[diff] ${cc.path || ''}`);
            } else if (cc?.type === 'terminal') {
              parts.push('[terminal output]');
            }
          }
        }
        emitter.toolResult(
          String(u.toolCallId || ''),
          parts.join('\n') || (status === 'failed' ? 'failed' : 'done'),
          status === 'failed',
        );
      }
    } else if (kind === 'plan') {
      const entries = ((u.entries as { content?: string }[]) || [])
        .map((e, i) => `${i + 1}. ${e.content || ''}`)
        .join('\n');
      if (entries) emitter.append('thinking', `Plan:\n${entries}\n`);
    }
  };

  /** Apply the selected model to the live ACP session. Best-effort: the model
   *  is also passed at session creation, so a CLI that lacks session/set_model
   *  still runs the right model — this just keeps resumed sessions in sync. */
  private async applyModel(): Promise<void> {
    if (!this.model || !this.acp || !this.acpSessionId) return;
    try {
      await this.acp.request(
        'session/set_model',
        { sessionId: this.acpSessionId, modelId: this.model },
        15000,
      );
    } catch (e) {
      this.log(`session/set_model not applied: ${(e as Error).message}`);
    }
  }

  private async ensureSession(): Promise<void> {
    // A crashed grok process leaves a dead ACP client; reusing it would hang
    // every future request. Discard and rebuild instead.
    if (this.acp?.isDead) {
      this.log('grok ACP child had exited; rebuilding session');
      this.acp.kill();
      this.acp = null;
      this.acpSessionId = null;
    }
    if (this.acp && this.acpSessionId) return;
    // A brand-new underlying ACP client/session has never actually received
    // the command-tools teaching block, regardless of whether THIS backend
    // instance already sent it to a previous (now-dead) session — otherwise
    // a mid-tab Grok crash/restart would silently leave the replacement
    // session never taught about the tools.
    this.commandToolsTaught = false;
    this.acp = new AcpClient(this.cliPath, this.onUpdate, this.log, this.permissionMode);
    await this.acp.request(
      'initialize',
      {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: 'claui-bridge', version: '1.0.0' },
      },
      30000,
    );

    const stored = this.store.read(this.sessionId);
    if (stored?.grokSessionId) {
      try {
        await this.acp.request(
          'session/load',
          { sessionId: stored.grokSessionId, cwd: process.cwd(), mcpServers: buildGrokMcpServers(this.commandTools) },
          120000,
        );
        this.acpSessionId = stored.grokSessionId;
      } catch (e) {
        this.log(`session/load failed, starting new: ${(e as Error).message}`);
      }
    }
    if (!this.acpSessionId) {
      // Pass the model at creation so a fresh session runs it even if the CLI
      // has no session/set_model.
      const res = (await this.acp.request(
        'session/new',
        {
          cwd: process.cwd(),
          mcpServers: buildGrokMcpServers(this.commandTools),
          ...(this.model ? { modelId: this.model } : {}),
        },
        60000,
      )) as { sessionId?: string };
      this.acpSessionId = res.sessionId || null;
      if (!this.acpSessionId) {
        throw new Error('Grok CLI did not return a session id');
      }
    }
    await this.applyModel();
    this.store.write(this.sessionId, {
      backend: 'grok',
      model: this.model,
      grokSessionId: this.acpSessionId,
    });
  }

  async runTurn(prompt: BridgePrompt, emitter: StreamEmitter): Promise<string> {
    await this.ensureSession();
    // ensureSession() may have just (re)built this.acp — re-apply the
    // pending write-window state so a rebuilt session doesn't silently lose
    // a window that was opened before the client existed.
    this.acp!.setWriteWindow(this.pendingWriteWindow);
    this.emitter = emitter;
    this.lastText = '';

    // The bridge advertises no image capability to Grok; surface a visible note
    // rather than dropping attachments silently.
    let userText = prompt.text;
    if (prompt.images.length) {
      const note = imagesOmittedNote(prompt.images.length, 'Grok');
      this.log(note);
      userText = userText ? `${userText}\n\n${note}` : note;
    }

    const promptBlocks: { type: 'text'; text: string }[] = [];
    const willTeachCommandTools = this.commandTools.enabled && !this.commandToolsTaught;
    const preamble = buildFirstTurnPreamble({
      isFirstEverTurn: !this.store.read(this.sessionId)?.history?.length,
      systemPrompt: this.systemPrompt,
      commandToolsEnabled: this.commandTools.enabled,
      commandToolsAlreadyTaught: this.commandToolsTaught,
    });
    if (preamble) promptBlocks.push({ type: 'text', text: preamble });
    promptBlocks.push({ type: 'text', text: userText });

    // Bound the turn so a hung agent surfaces an error instead of wedging the
    // tab in a permanent "running" state.
    const res = (await this.acp!.request(
      'session/prompt',
      { sessionId: this.acpSessionId, prompt: promptBlocks },
      PROMPT_TIMEOUT_MS,
    )) as { stopReason?: string } | undefined;

    // Only mark "taught" once the request that actually carried the block
    // has succeeded — a failed session/prompt (dead process, timeout, ACP
    // error) must not permanently lose the teaching block for the retry.
    if (willTeachCommandTools) this.commandToolsTaught = true;

    this.store.appendHistory(this.sessionId, 'user', prompt.persistAs ?? userText);
    if (this.lastText) {
      this.store.appendHistory(this.sessionId, 'assistant', this.lastText);
    }
    void res;
    return this.lastText;
  }
}
