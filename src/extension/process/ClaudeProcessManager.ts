import * as vscode from 'vscode';
import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import type { CliOutputEvent, CliInputMessage } from '../types/stream-json';
import { buildClaudeCliEnv, getStoredApiKey } from './envUtils';
import { killProcessTree } from './killTree';

export interface ProcessStartOptions {
  resume?: string;
  fork?: boolean;
  cwd?: string;
  model?: string;
  cliPathOverride?: string;
  permissionMode?: 'full-access' | 'supervised';
  /** When true, omit --replay-user-messages so a resumed session does not
   *  re-emit old messages to the webview (used by edit-and-resend). */
  skipReplay?: boolean;
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

  constructor(private readonly context: vscode.ExtensionContext) {
    super();
  }

  /** Attach a logger function for diagnostics */
  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
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

    // Full Access: bypass all permission checks so tools run without approval
    // Supervised: restrict to read-only tools via --allowedTools
    if (permissionMode === 'full-access') {
      args.push('--permission-mode', 'bypassPermissions');
    } else if (permissionMode === 'supervised') {
      args.push(
        '--allowedTools',
        'Read,Grep,Glob,LS,Task,WebFetch,WebSearch,TodoRead,TodoWrite,AskUserQuestion,ExitPlanMode'
      );
    }

    // Add model flag if specified (from config or explicit option)
    const selectedModel = options?.model ||
      vscode.workspace.getConfiguration('claudeMirror').get<string>('model', '');
    if (selectedModel) {
      args.push('--model', selectedModel);
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

    this.log(`Spawning: ${cliPath} ${args.join(' ')}`);
    this.log(`CWD: ${cwd || '(none)'}`);

    // Build sanitized env; inject user's API key from SecretStorage if configured
    const apiKey = await getStoredApiKey(this.context.secrets);
    const env = buildClaudeCliEnv(apiKey);
    this.log(`Env: hasAnthropicKey=${!!apiKey}`);

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
        const event = JSON.parse(trimmed) as CliOutputEvent;
        if (event.type === 'system' && event.subtype === 'init') {
          this.sessionId = event.session_id;
        }
        this.emit('event', event);
      } catch {
        // Non-JSON line (e.g. progress indicators) - emit as raw
        this.emit('raw', trimmed);
      }
    }
  }

  /** Send a message to the CLI process via stdin */
  send(message: CliInputMessage): void {
    if (!this.process?.stdin?.writable) {
      throw new Error('Process is not running or stdin is not writable');
    }
    this.process.stdin.write(JSON.stringify(message) + '\n');
  }

  /** Send a user text message */
  sendUserMessage(text: string): void {
    this.send({ type: 'user', message: { role: 'user', content: text } });
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

  /** Whether the last exit was triggered by a user cancel */
  get cancelledByUser(): boolean {
    return this._cancelledByUser;
  }
}
