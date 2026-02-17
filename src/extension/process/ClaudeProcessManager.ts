import * as vscode from 'vscode';
import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import type { CliOutputEvent, CliInputMessage } from '../types/stream-json';

export interface ProcessStartOptions {
  resume?: string;
  fork?: boolean;
  cwd?: string;
  model?: string;
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
    const cliPath = config.get<string>('cliPath', 'claude');

    const args = [
      '-p',
      '--verbose',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--include-partial-messages',
      '--replay-user-messages',
    ];

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

    // Unset CLAUDECODE env var to prevent nested-session detection
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    this.process = spawn(cliPath, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    this.log(`Process spawned, PID: ${this.process.pid ?? 'unknown'}`);
    this.stdoutBuffer = '';

    this.process.stdout!.on('data', (chunk: Buffer) => {
      this.handleStdoutChunk(chunk);
    });

    this.process.stderr!.on('data', (chunk: Buffer) => {
      this.emit('stderr', chunk.toString('utf-8'));
    });

    this.process.on('exit', (code, signal) => {
      const exitInfo: ProcessExitInfo = { code, signal };
      this.emit('exit', exitInfo);
      this.process = null;
    });

    this.process.on('error', (err) => {
      this.emit('error', err);
      this.process = null;
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

  /** Cancel the current request */
  sendCancel(): void {
    this._cancelledByUser = true;
    this.send({
      type: 'control_request',
      request: { subtype: 'cancel' },
    });
  }

  /** Gracefully stop the process */
  stop(): void {
    if (this.process) {
      this.process.stdin?.end();
      this.process.kill('SIGTERM');
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
