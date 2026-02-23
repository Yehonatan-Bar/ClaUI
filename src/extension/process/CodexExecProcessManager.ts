import * as vscode from 'vscode';
import { ChildProcess, exec, spawn } from 'child_process';
import { EventEmitter } from 'events';
import type { CodexExecJsonEvent } from '../types/codex-exec-json';

export interface CodexRunTurnOptions {
  prompt: string;
  threadId?: string;
  cwd?: string;
  model?: string;
}

export interface CodexProcessExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
}

/**
 * Manages `codex exec` / `codex exec resume` processes.
 *
 * Codex differs from Claude here: one process per turn (no persistent stdin protocol).
 */
export class CodexExecProcessManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private stdoutBuffer = '';
  private log: (msg: string) => void = () => {};
  private _cancelledByUser = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    super();
    void this.context; // retained for symmetry with ClaudeProcessManager and future use
  }

  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
  }

  async runTurn(options: CodexRunTurnOptions): Promise<void> {
    if (this.process) {
      throw new Error('A Codex turn is already running in this tab');
    }

    const config = vscode.workspace.getConfiguration('claudeMirror');
    const cliPath = config.get<string>('codex.cliPath', 'codex');
    const selectedModel = options.model ?? config.get<string>('codex.model', '');
    const cwd =
      options.cwd ||
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
      undefined;

    const args = this.buildArgs({
      threadId: options.threadId,
      cwd,
      model: selectedModel,
    });

    this._cancelledByUser = false;
    this.stdoutBuffer = '';

    this.log(`Spawning Codex: ${cliPath} ${args.join(' ')}`);
    this.log(`CWD: ${cwd || '(none)'}`);

    const child = spawn(cliPath, args, {
      cwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    this.process = child;
    this.log(`Codex process spawned, PID: ${child.pid ?? 'unknown'}`);

    child.stdout?.on('data', (chunk: Buffer) => {
      this.handleStdoutChunk(chunk);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      this.emit('stderr', chunk.toString('utf-8'));
    });

    child.on('exit', (code, signal) => {
      this.emit('exit', { code, signal } as CodexProcessExitInfo);
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

    if (!child.stdin) {
      throw new Error('Failed to open stdin for codex exec process');
    }

    child.stdin.write(options.prompt);
    if (!options.prompt.endsWith('\n')) {
      child.stdin.write('\n');
    }
    child.stdin.end();
  }

  cancelTurn(): void {
    this._cancelledByUser = true;
    if (!this.process) {
      return;
    }
    try {
      this.process.stdin?.end();
    } catch {
      // ignore
    }
    this.killProcessTree();
  }

  stop(): void {
    if (!this.process) {
      return;
    }
    try {
      this.process.stdin?.end();
    } catch {
      // ignore
    }
    this.killProcessTree();
    this.process = null;
  }

  get isTurnRunning(): boolean {
    return this.process !== null;
  }

  get cancelledByUser(): boolean {
    return this._cancelledByUser;
  }

  private buildArgs(opts: { threadId?: string; cwd?: string; model?: string }): string[] {
    if (opts.threadId) {
      const args = ['exec', 'resume', '--json'];
      if (opts.model) {
        args.push('--model', opts.model);
      }
      args.push(opts.threadId, '-');
      return args;
    }

    const args = ['exec', '--json'];
    if (opts.cwd) {
      args.push('-C', opts.cwd);
    }
    if (opts.model) {
      args.push('--model', opts.model);
    }
    args.push('-');
    return args;
  }

  private handleStdoutChunk(chunk: Buffer): void {
    this.stdoutBuffer += chunk.toString('utf-8');
    const lines = this.stdoutBuffer.split('\n');
    this.stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const event = JSON.parse(trimmed) as CodexExecJsonEvent;
        this.emit('event', event);
      } catch {
        this.emit('raw', trimmed);
      }
    }
  }

  private killProcessTree(): void {
    if (!this.process?.pid) {
      return;
    }
    const pid = this.process.pid;
    if (process.platform === 'win32') {
      this.log(`Killing Codex process tree (taskkill /F /T /PID ${pid})`);
      exec(`taskkill /F /T /PID ${pid}`, (err) => {
        if (err) {
          this.log(`taskkill failed (Codex process may already be dead): ${err.message}`);
        }
      });
      return;
    }
    try {
      this.process.kill('SIGTERM');
    } catch {
      // already dead
    }
  }
}

