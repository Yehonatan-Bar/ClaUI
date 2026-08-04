import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { StreamEmitter } from '../protocol';
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

/** Resolve a runnable Grok CLI invocation from the configured path. */
export function resolveGrokCli(cliPath: string): { command: string; useShell: boolean } {
  const configured = (cliPath || 'grok').trim();
  if (path.isAbsolute(configured) && fs.existsSync(configured)) {
    return { command: configured, useShell: false };
  }
  if (process.platform === 'win32' && configured === 'grok') {
    // npm .cmd shims cannot be spawned directly on Windows; prefer the real
    // binary the shim points at when it is in the standard global location.
    const appData = process.env.APPDATA;
    if (appData) {
      const exe = path.join(
        appData,
        'npm',
        'node_modules',
        '@xai-official',
        'grok',
        'node_modules',
        '@xai-official',
        'grok-win32-x64',
        'bin',
        'grok.exe',
      );
      if (fs.existsSync(exe)) {
        return { command: exe, useShell: false };
      }
    }
  }
  // Bare command name: let the shell resolve PATH (handles .cmd shims on win32).
  return { command: configured, useShell: process.platform === 'win32' };
}

class AcpClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private child: ChildProcess;

  constructor(
    cliPath: string,
    private readonly onUpdate: (update: Record<string, unknown>) => void,
    private readonly log: (msg: string) => void,
  ) {
    const { command, useShell } = resolveGrokCli(cliPath);
    this.child = spawn(command, ['agent', 'stdio'], {
      cwd: process.cwd(),
      shell: useShell,
      windowsHide: true,
    });
    this.child.on('error', (e) => this.rejectAll(new Error(`Failed to start Grok CLI: ${e.message}`)));
    this.child.stderr?.on('data', (d) => this.log(`grok stderr: ${String(d).slice(0, 400)}`));
    this.child.on('exit', (code) => {
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
        toolCall?: { title?: string };
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
      // Mirror ClaUi full-access: auto-approve, preferring an allow-once option.
      const opts = msg.params?.options || [];
      const allow =
        opts.find((o) => o.kind === 'allow_once') ||
        opts.find((o) => (o.kind || '').startsWith('allow')) ||
        opts[0];
      this.send({
        jsonrpc: '2.0',
        id: msg.id,
        result: { outcome: { outcome: 'selected', optionId: allow?.optionId || 'allow' } },
      });
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
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      if (timeoutMs > 0) {
        const t = setTimeout(() => {
          if (this.pending.has(id)) {
            this.pending.delete(id);
            reject(new Error(`ACP ${method} timed out after ${timeoutMs}ms`));
          }
        }, timeoutMs);
        t.unref?.();
      }
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  kill(): void {
    try {
      this.child.kill();
    } catch {
      /* already dead */
    }
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

  private async ensureSession(): Promise<void> {
    if (this.acp && this.acpSessionId) return;
    this.acp = new AcpClient(this.cliPath, this.onUpdate, this.log);
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
      const res = (await this.acp.request(
        'session/new',
        { cwd: process.cwd(), mcpServers: [] },
        60000,
      )) as { sessionId?: string };
      this.acpSessionId = res.sessionId || null;
      if (!this.acpSessionId) {
        throw new Error('Grok CLI did not return a session id');
      }
    }
    this.store.write(this.sessionId, {
      backend: 'grok',
      model: this.model,
      grokSessionId: this.acpSessionId,
    });
  }

  async runTurn(prompt: string, emitter: StreamEmitter): Promise<string> {
    await this.ensureSession();
    this.emitter = emitter;
    this.lastText = '';

    const promptBlocks: { type: 'text'; text: string }[] = [];
    if (this.systemPrompt && !this.store.read(this.sessionId)?.history?.length) {
      promptBlocks.push({ type: 'text', text: `<system-rules>\n${this.systemPrompt}\n</system-rules>` });
    }
    promptBlocks.push({ type: 'text', text: prompt });

    const res = (await this.acp!.request('session/prompt', {
      sessionId: this.acpSessionId,
      prompt: promptBlocks,
    })) as { stopReason?: string } | undefined;

    this.store.appendHistory(this.sessionId, 'user', prompt);
    if (this.lastText) {
      this.store.appendHistory(this.sessionId, 'assistant', this.lastText);
    }
    void res;
    return this.lastText;
  }
}
