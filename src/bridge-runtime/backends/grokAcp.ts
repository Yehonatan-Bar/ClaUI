import { ChildProcess } from 'child_process';
import * as path from 'path';
import * as readline from 'readline';
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
      // Supervised mirrors the real Claude CLI's read-only --allowedTools set:
      // only read/search/fetch/think auto-approve; write/execute (and unknown)
      // kinds are rejected. Full-access auto-approves everything.
      const permit = this.permissionMode !== 'supervised' || isReadOnlyGrokKind(kind);
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

  constructor(
    private readonly cliPath: string,
    private readonly model: string,
    private readonly sessionId: string,
    private readonly store: SessionStore,
    private readonly systemPrompt: string,
    private readonly permissionMode: string,
    private readonly log: (msg: string) => void,
  ) {}

  interrupt(): void {
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
      let name = KIND_TO_TOOL[(u.kind as string) || ''] || '';
      if (!name || name === 'Tool') {
        if (input.command) name = 'Bash';
        else if (input.file_path !== undefined && input.content !== undefined) name = 'Write';
        else if (input.target_file || input.file_path) name = 'Read';
        else if (input.pattern || input.query) name = 'Grep';
        else if (input.url) name = 'WebFetch';
        else name = 'Tool';
      }
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
          { sessionId: stored.grokSessionId, cwd: process.cwd(), mcpServers: [] },
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
          mcpServers: [],
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
    if (this.systemPrompt && !this.store.read(this.sessionId)?.history?.length) {
      promptBlocks.push({ type: 'text', text: `<system-rules>\n${this.systemPrompt}\n</system-rules>` });
    }
    promptBlocks.push({ type: 'text', text: userText });

    // Bound the turn so a hung agent surfaces an error instead of wedging the
    // tab in a permanent "running" state.
    const res = (await this.acp!.request(
      'session/prompt',
      { sessionId: this.acpSessionId, prompt: promptBlocks },
      PROMPT_TIMEOUT_MS,
    )) as { stopReason?: string } | undefined;

    this.store.appendHistory(this.sessionId, 'user', userText);
    if (this.lastText) {
      this.store.appendHistory(this.sessionId, 'assistant', this.lastText);
    }
    void res;
    return this.lastText;
  }
}
