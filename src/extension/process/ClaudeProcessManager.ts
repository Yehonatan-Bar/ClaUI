import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import type { CliOutputEvent, CliInputMessage, PermissionResult } from '../types/stream-json';

/** Payload emitted on 'permissionRequest' when the CLI blocks on an always-"ask"
 *  tool (AskUserQuestion / ExitPlanMode). The host must eventually call
 *  respondPermission(requestId, ...) or the CLI stays blocked. */
export interface PermissionRequestPayload {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  toolUseId?: string;
}
import { McpSecretsService } from '../mcp/McpSecretsService';
import { buildClaudeCliEnv, getStoredApiKey } from './envUtils';
import { killProcessTree } from './killTree';

export interface ProcessStartOptions {
  resume?: string;
  fork?: boolean;
  cwd?: string;
  model?: string;
  effortLevel?: string;
  fastMode?: boolean;
  cliPathOverride?: string;
  permissionMode?: 'full-access' | 'supervised';
  /** When true, omit --replay-user-messages so a resumed session does not
   *  re-emit old messages to the webview (used by edit-and-resend). */
  skipReplay?: boolean;
  /** Smart Search: appended to the agent's system prompt via --append-system-prompt. */
  appendSystemPrompt?: string;
  /** Smart Search: comma-separated list passed via --allowedTools.
   *  When set, takes precedence over the supervised-mode default list and
   *  forces the supervised branch (no bypassPermissions). */
  allowedTools?: string[];
}

export interface ProcessExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
}

/**
 * Spawns and manages the Claude CLI process using stream-json protocol.
 *
 * Events emitted:
 *  - 'event'  (CliOutputEvent)  - Parsed JSON event from stdout
 *  - 'raw'    (string)          - Non-JSON stdout line
 *  - 'stderr' (string)          - Stderr output
 *  - 'exit'   (ProcessExitInfo) - Process exited
 *  - 'error'  (Error)           - Spawn or runtime error
 */
export class ClaudeProcessManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private sessionId: string | null = null;
  private stdoutBuffer = '';
  private log: (msg: string) => void = () => {};
  private _cancelledByUser = false;
  private startModel = '';
  private startCwd = '';
  /** True when this session was spawned with --permission-prompt-tool stdio, so
   *  AskUserQuestion/ExitPlanMode round-trip through the can_use_tool control
   *  protocol. Consumers (MessageHandler) gate the legacy stream-detection path
   *  on this so the two never fight over the approval bar. */
  private controlProtocolEnabled = false;

  get configuredModel(): string {
    return this.startModel;
  }

  /** Whether the can_use_tool control protocol is active for the running session. */
  get controlProtocolActive(): boolean {
    return this.controlProtocolEnabled;
  }

  /** Optional Particle Accelerator env builder; set by SessionTab when feature is enabled */
  particleAcceleratorEnvBuilder: ((baseEnv: NodeJS.ProcessEnv) => Record<string, string | undefined>) | null = null;

  /** Optional Super Particle Accelerator env builder; set by SessionTab */
  superParticleAcceleratorEnvBuilder: ((baseEnv: NodeJS.ProcessEnv) => Record<string, string | undefined>) | null = null;

  /** Optional Workspace Access Guard env builder; set by SessionTab */
  workspaceAccessGuardEnvBuilder: (() => Record<string, string>) | null = null;

  /** Whether secret protection DLP scanning is active; set by SessionTab */
  secretProtectionEnabled = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    super();
  }

  /** Attach a logger function for diagnostics */
  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
  }

  /**
   * Write a minimal settings overlay file enabling fast mode, returning its
   * absolute path (or null on failure). Passed to the CLI via `--settings`.
   */
  private writeFastModeSettingsFile(): string | null {
    try {
      const dir = this.context.globalStorageUri.fsPath;
      fs.mkdirSync(dir, { recursive: true });
      const settingsPath = path.join(dir, 'claude-fast-mode-settings.json');
      fs.writeFileSync(settingsPath, JSON.stringify({ fastMode: true }), 'utf8');
      return settingsPath;
    } catch (err) {
      this.log(`Failed to write fast mode settings file: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  async start(options?: ProcessStartOptions): Promise<void> {
    if (this.process) {
      this.log('Stopping existing process before restart');
      this.stop();
    }

    const config = vscode.workspace.getConfiguration('claudeMirror');
    const cliPath = options?.cliPathOverride || config.get<string>('cliPath', 'claude');

    const permissionMode = options?.permissionMode ||
      config.get<string>('permissionMode', 'full-access');

    const args = [
      '-p',
      '--verbose',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--include-partial-messages',
    ];

    // Skip replay when forking (webview handles history via forkInit) or
    // when resuming for edit-and-resend (webview already has truncated history).
    if (!options?.skipReplay && !options?.fork) {
      args.push('--replay-user-messages');
    }

    // Reset before each (re)start; only the full-access branch re-enables it.
    this.controlProtocolEnabled = false;

    // Smart Search: explicit allowedTools list overrides permission-mode handling.
    // Forces the supervised branch (no bypassPermissions) so the agent stays read-only.
    if (options?.allowedTools && options.allowedTools.length > 0) {
      args.push('--allowedTools', options.allowedTools.join(','));
    } else if (permissionMode === 'full-access') {
      // Full Access: bypass all permission checks so tools run without approval.
      args.push('--permission-mode', 'bypassPermissions');
      // ...but AskUserQuestion/ExitPlanMode always return "ask" from checkPermissions,
      // so under plain bypassPermissions they collapse into an "Answer questions?"
      // error and the model proceeds without a real answer. Routing permission asks
      // through stdio makes the CLI emit a can_use_tool control_request and block
      // until we respond, turning those tools into a true synchronous pause. Every
      // other tool is still auto-bypassed by the CLI and never reaches our handler.
      args.push('--permission-prompt-tool', 'stdio');
      this.controlProtocolEnabled = true;
    } else if (permissionMode === 'supervised') {
      // Supervised: restrict to read-only tools via --allowedTools
      args.push(
        '--allowedTools',
        'Read,Grep,Glob,LS,Task,WebFetch,WebSearch,TodoRead,TodoWrite,AskUserQuestion,ExitPlanMode'
      );
    }

    // Smart Search: append the search-agent system prompt.
    if (options?.appendSystemPrompt) {
      args.push('--append-system-prompt', options.appendSystemPrompt);
    }

    // Add model flag if specified (from config or explicit option)
    // Guard: skip display-only labels like "Codex (default)" that aren't real model IDs
    const rawModel = options?.model ||
      vscode.workspace.getConfiguration('claudeMirror').get<string>('model', '');
    const selectedModel = rawModel && !rawModel.includes('(') ? rawModel : '';
    if (selectedModel) {
      args.push('--model', selectedModel);
    }

    const effortLevel = options?.effortLevel ||
      vscode.workspace.getConfiguration('claudeMirror').get<string>('effortLevel', '');
    if (effortLevel) {
      args.push('--effort', effortLevel);
    }

    // Fast mode: applied via a --settings overlay file (no dedicated CLI flag
    // exists). The path is quoted because the CLI is spawned through a shell;
    // a JSON-string value would be mangled by cmd.exe, but a quoted path is not.
    const fastMode = options?.fastMode ??
      vscode.workspace.getConfiguration('claudeMirror').get<boolean>('fastMode', false);
    if (fastMode) {
      const settingsPath = this.writeFastModeSettingsFile();
      if (settingsPath) {
        args.push('--settings', `"${settingsPath}"`);
      }
    }

    if (options?.resume) {
      args.push('--resume', options.resume);
      if (options.fork) {
        args.push('--fork-session');
      }
    }

    const cwd =
      options?.cwd ||
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
      undefined;

    this._cancelledByUser = false;
    this.startModel = selectedModel;
    this.startCwd = cwd || '';

    this.log(`Spawning: ${cliPath} ${args.join(' ')}`);
    this.log(`CWD: ${cwd || '(none)'}`);

    // Build sanitized env; inject user's API key from SecretStorage if configured
    const apiKey = await getStoredApiKey(this.context.secrets);
    const mcpSecretEnv = await new McpSecretsService(this.context.secrets).getInjectedEnv();
    let env = { ...buildClaudeCliEnv(apiKey), ...mcpSecretEnv };
    this.log(`Env: hasAnthropicKey=${!!apiKey} mcpSecretVars=${Object.keys(mcpSecretEnv).length}`);

    // Inject Particle Accelerator environment if available
    if (this.particleAcceleratorEnvBuilder) {
      try {
        env = { ...env, ...this.particleAcceleratorEnvBuilder(env) };
        this.log('Particle Accelerator env injected');
      } catch (err) {
        this.log(`Particle Accelerator env injection failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Inject Workspace Access Guard environment (runs before SPA)
    if (this.workspaceAccessGuardEnvBuilder) {
      try {
        env = { ...env, ...this.workspaceAccessGuardEnvBuilder() };
        this.log('Workspace Access Guard env injected');
      } catch (err) {
        this.log(`Workspace Access Guard env injection failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Inject Super Particle Accelerator environment if available
    if (this.superParticleAcceleratorEnvBuilder) {
      try {
        env = { ...env, ...this.superParticleAcceleratorEnvBuilder(env) };
        this.log('Super Particle Accelerator env injected');
      } catch (err) {
        this.log(`Super Particle Accelerator env injection failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Signal secret protection to the CLI process and hooks
    if (this.secretProtectionEnabled) {
      env.CLAUI_SECRET_PROTECTION = '1';
    }

    const child = spawn(cliPath, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });
    this.process = child;

    this.log(`Process spawned, PID: ${child.pid ?? 'unknown'}`);
    this.stdoutBuffer = '';

    child.stdout!.on('data', (chunk: Buffer) => {
      this.handleStdoutChunk(chunk);
    });

    child.stderr!.on('data', (chunk: Buffer) => {
      this.emit('stderr', chunk.toString('utf-8'));
    });

    // Guard against stale exit/error handlers: only null this.process if the
    // exiting process is still the current one.  During edit-and-resend the old
    // process is stop()'d and a new one start()'d; the old exit fires
    // asynchronously and must NOT overwrite the new process reference.
    child.on('exit', (code, signal) => {
      const exitInfo: ProcessExitInfo = { code, signal };
      this.emit('exit', exitInfo);
      if (this.process === child) {
        this.process = null;
      }
    });

    child.on('error', (err) => {
      this.emit('error', err);
      if (this.process === child) {
        this.process = null;
      }
    });

    // Activate the control protocol: the CLI will only emit can_use_tool requests
    // after this handshake. Sent as the first stdin line so it is processed before
    // the caller's first user message (the CLI reads stdin FIFO).
    if (this.controlProtocolEnabled) {
      this.sendInitialize();
    }
  }

  /** Parse stdout as newline-delimited JSON */
  private handleStdoutChunk(chunk: Buffer): void {
    this.stdoutBuffer += chunk.toString('utf-8');
    const lines = this.stdoutBuffer.split('\n');
    // Keep the last incomplete line in the buffer
    this.stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        // Control protocol round-trips (can_use_tool requests, handshake replies)
        // are handled here and must NOT flow into the demux/store pipeline.
        if (parsed.type === 'control_request') {
          this.handleIncomingControlRequest(parsed);
          continue;
        }
        if (parsed.type === 'control_response') {
          this.log(`control_response (reply to host): ${trimmed.slice(0, 160)}`);
          continue;
        }
        const event = parsed as unknown as CliOutputEvent;
        if (event.type === 'system' && event.subtype === 'init') {
          this.sessionId = event.session_id;
        }
        this.emit('event', event);
      } catch {
        // Happy CLI emits session ID as a raw "[DEV] Session: <id>" line
        // instead of a JSON system/init event. Capture it and synthesize
        // a system/init event so the entire downstream pipeline works.
        if (!this.sessionId) {
          const happySessionMatch = trimmed.match(/^\[DEV\] Session:\s*(\S+)/);
          if (happySessionMatch) {
            this.sessionId = happySessionMatch[1];
            this.log(`Happy session ID captured from raw line: ${this.sessionId}`);
            const syntheticInit: CliOutputEvent = {
              type: 'system',
              subtype: 'init',
              session_id: this.sessionId,
              model: this.startModel || 'unknown',
              tools: [],
              cwd: this.startCwd,
              mcp_servers: [],
            };
            this.emit('event', syntheticInit);
          }
        }
        // Non-JSON line (e.g. progress indicators) - emit as raw
        this.emit('raw', trimmed);
      }
    }
  }

  /** Send a message to the CLI process via stdin */
  send(message: CliInputMessage): void {
    if (!this.process?.stdin?.writable) {
      this.log(`stdin not writable: process=${!!this.process} stdin=${!!this.process?.stdin} writable=${this.process?.stdin?.writable}`);
      throw new Error('Process is not running or stdin is not writable');
    }
    const json = JSON.stringify(message);
    this.log(`stdin write (${json.length} bytes): type=${message.type}`);
    this.process.stdin.write(json + '\n');
  }

  /** Send a user text message */
  sendUserMessage(text: string): void {
    this.log(`sendUserMessage: ${text.length} chars`);
    this.send({ type: 'user', message: { role: 'user', content: text } });
  }

  /** Activate the control protocol. Without this handshake the CLI never emits
   *  can_use_tool requests, so AskUserQuestion/ExitPlanMode would silently fail. */
  private sendInitialize(): void {
    try {
      this.send({
        type: 'control_request',
        request_id: `claui-init-${Date.now()}`,
        request: { subtype: 'initialize', hooks: {} },
      });
      this.log('Control protocol: sent initialize handshake');
    } catch (err) {
      this.log(`Control protocol: initialize handshake failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Route an incoming control_request from the CLI. The only subtype produced
   *  under our flags is can_use_tool (for AskUserQuestion/ExitPlanMode). */
  private handleIncomingControlRequest(req: Record<string, unknown>): void {
    const request = (req.request ?? {}) as Record<string, unknown>;
    const subtype = request.subtype as string | undefined;
    const requestId = req.request_id as string | undefined;

    if (subtype === 'can_use_tool' && requestId) {
      const toolName = (request.tool_name as string) ?? '';
      const input = (request.input as Record<string, unknown>) ?? {};
      const toolUseId = request.tool_use_id as string | undefined;
      this.log(`Control protocol: can_use_tool tool=${toolName} requestId=${requestId}`);
      if (toolName === 'AskUserQuestion' || toolName === 'ExitPlanMode') {
        // Defer to the UI; the CLI stays blocked until respondPermission() is called.
        const payload: PermissionRequestPayload = { requestId, toolName, input, toolUseId };
        this.emit('permissionRequest', payload);
      } else {
        // Under bypassPermissions only always-"ask" tools reach us; allow anything else.
        this.respondPermission(requestId, { behavior: 'allow', updatedInput: input });
      }
      return;
    }

    // Unknown subtype: reply so the CLI is never left blocked waiting on us.
    this.log(`Control protocol: unhandled control_request subtype=${subtype}`);
    if (requestId) {
      this.respondPermission(requestId, {
        behavior: 'deny',
        message: `Unsupported control request: ${subtype}`,
      });
    }
  }

  /** Resolve a pending can_use_tool request. Allow injects updatedInput (for
   *  AskUserQuestion this carries the user's answers); deny carries a message. */
  respondPermission(requestId: string, result: PermissionResult): void {
    this.send({
      type: 'control_response',
      response: { subtype: 'success', request_id: requestId, response: result },
    });
    this.log(`Control protocol: respondPermission requestId=${requestId} behavior=${result.behavior}`);
  }

  /** Request context compaction */
  sendCompact(instructions?: string): void {
    this.send({
      type: 'control_request',
      request: {
        subtype: 'compact',
        ...(instructions ? { custom_instructions: instructions } : {}),
      },
    });
  }

  /** Kill the entire process tree via the shared killTree utility. */
  private killTree(): void {
    if (!this.process) {
      return;
    }
    this.log(`Killing process tree for PID ${this.process.pid ?? 'unknown'}`);
    killProcessTree(this.process);
  }

  /** Cancel the current request by killing the process.
   *  The polite control_request cancel is unreliable (CLI acknowledges but
   *  continues generating), so we kill the process instead. The SessionTab
   *  exit handler detects `cancelledByUser` and auto-resumes the session,
   *  letting the user continue chatting. */
  sendCancel(): void {
    this._cancelledByUser = true;

    if (!this.process) {
      return;
    }

    // Close stdin + kill the entire process tree to guarantee it stops
    try { this.process.stdin?.end(); } catch { /* already closed */ }
    this.killTree();
  }

  /** Close stdin without killing the process (e.g. signal fork phase 1 to finish). */
  endStdin(): void {
    try { this.process?.stdin?.end(); } catch { /* already closed */ }
  }

  /** Gracefully stop the process */
  stop(): void {
    if (this.process) {
      try { this.process.stdin?.end(); } catch { /* already closed */ }
      this.killTree();
      this.process = null;
      this.sessionId = null;
    }
  }

  get isRunning(): boolean {
    return this.process !== null;
  }

  get currentSessionId(): string | null {
    return this.sessionId;
  }

  /** PID of the spawned shell wrapper for the CLI, or undefined when not running.
   *  Used by the memory dashboard to enumerate active CLI process trees. */
  get pid(): number | undefined {
    return this.process?.pid;
  }

  /** Seed the session id for a resumed session before the CLI emits system/init.
   *  In pipe mode the CLI emits init only after the first stdin message, so any
   *  feature that needs the session id between resume and first turn (e.g.
   *  edit-and-resend on a freshly restored tab) would otherwise see null. */
  seedSessionId(id: string): void {
    if (!this.sessionId) {
      this.sessionId = id;
      this.log(`Seeded session id from caller: ${id}`);
    }
  }

  /** Whether the last exit was triggered by a user cancel */
  get cancelledByUser(): boolean {
    return this._cancelledByUser;
  }
}