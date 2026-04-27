import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import type { CodexExecJsonEvent } from '../types/codex-exec-json';
import { buildSanitizedEnv } from './envUtils';
import { killProcessTree } from './killTree';

export interface CodexRunTurnOptions {
  prompt: string;
  threadId?: string;
  cwd?: string;
  model?: string;
  permissionMode?: 'full-access' | 'supervised';
  imagePaths?: string[];
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
  private runSeq = 0;
  private activeRunId = 0;
  private activeRunStartedAt = 0;
  private stdoutChunkCount = 0;
  private stdoutByteCount = 0;
  private stdoutLineCount = 0;
  private jsonEventCount = 0;
  private rawLineCount = 0;
  private stderrChunkCount = 0;
  private stderrByteCount = 0;

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
    // Guard: skip display-only labels like "Codex (default)" that aren't real model IDs
    const rawModel = options.model ?? config.get<string>('codex.model', '');
    const selectedModel = rawModel && !rawModel.includes('(') ? rawModel : '';
    const selectedReasoningEffort = config.get<string>('codex.reasoningEffort', '').trim();
    const permissionMode =
      options.permissionMode ??
      (config.get<string>('permissionMode', 'full-access') as 'full-access' | 'supervised');
    const cwd =
      options.cwd ||
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
      undefined;

    const args = this.buildArgs({
      threadId: options.threadId,
      cwd,
      model: selectedModel,
      reasoningEffort: selectedReasoningEffort || undefined,
      permissionMode,
      imagePaths: options.imagePaths,
    });

    this._cancelledByUser = false;
    this.stdoutBuffer = '';
    this.resetRunStats();
    this.activeRunId = ++this.runSeq;
    this.activeRunStartedAt = Date.now();

    this.log(
      `Codex turn #${this.activeRunId}: promptLen=${options.prompt.length} resume=${options.threadId ? 'yes' : 'no'} permission=${permissionMode} images=${options.imagePaths?.length ?? 0}`
    );
    this.log(`Spawning Codex: ${cliPath} ${args.join(' ')}`);
    this.log(`CWD: ${cwd || '(none)'}`);

    const child = spawn(cliPath, args, {
      cwd,
      env: buildSanitizedEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    this.process = child;
    this.log(`Codex process spawned, PID: ${child.pid ?? 'unknown'} (turn #${this.activeRunId})`);

    child.on('spawn', () => {
      this.log(`Codex process spawn event received (turn #${this.activeRunId}, PID ${child.pid ?? 'unknown'})`);
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      this.handleStdoutChunk(chunk);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      this.stderrChunkCount += 1;
      this.stderrByteCount += chunk.length;
      const text = chunk.toString('utf-8');
      this.log(
        `Codex stderr chunk #${this.stderrChunkCount} (${chunk.length} bytes, total=${this.stderrByteCount})` +
          ` preview="${this.summarizeText(text)}"`
      );
      this.emit('stderr', text);
    });

    child.on('exit', (code, signal) => {
      this.flushRemainingStdoutBuffer();
      this.logProcessSummary(`exit code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      this.emit('exit', { code, signal } as CodexProcessExitInfo);
      if (this.process === child) {
        this.process = null;
      }
    });

    child.on('close', (code, signal) => {
      this.log(`Codex process close: code=${code ?? 'null'} signal=${signal ?? 'null'} (turn #${this.activeRunId})`);
    });

    child.on('error', (err) => {
      this.log(`Codex process error event (turn #${this.activeRunId}): ${err.message}`);
      this.emit('error', err);
      if (this.process === child) {
        this.process = null;
      }
    });

    if (!child.stdin) {
      throw new Error('Failed to open stdin for codex exec process');
    }

    this.log(`Writing prompt to Codex stdin (turn #${this.activeRunId}, chars=${options.prompt.length})`);
    child.stdin.write(options.prompt);
    if (!options.prompt.endsWith('\n')) {
      child.stdin.write('\n');
    }
    this.log(`Closing Codex stdin after prompt write (turn #${this.activeRunId})`);
    child.stdin.end();
  }

  cancelTurn(): void {
    this._cancelledByUser = true;
    this.log(`cancelTurn requested (turn #${this.activeRunId || 'n/a'}, running=${this.process !== null})`);
    if (!this.process) {
      return;
    }
    try {
      this.process.stdin?.end();
    } catch {
      // ignore
    }
    this.killTree();
  }

  stop(): void {
    this.log(`stop requested (turn #${this.activeRunId || 'n/a'}, running=${this.process !== null})`);
    if (!this.process) {
      return;
    }
    try {
      this.process.stdin?.end();
    } catch {
      // ignore
    }
    this.killTree();
    this.process = null;
  }

  get isTurnRunning(): boolean {
    return this.process !== null;
  }

  get cancelledByUser(): boolean {
    return this._cancelledByUser;
  }

  /** PID of the active codex exec process, or undefined when no turn is running.
   *  Used by the memory dashboard to enumerate active CLI process trees. */
  get pid(): number | undefined {
    return this.process?.pid;
  }

  private buildArgs(opts: {
    threadId?: string;
    cwd?: string;
    model?: string;
    reasoningEffort?: string;
    permissionMode?: 'full-access' | 'supervised';
    imagePaths?: string[];
  }): string[] {
    const permissionArgs = this.buildPermissionArgs(opts.permissionMode ?? 'full-access');
    if (opts.threadId) {
      const args = ['exec', ...permissionArgs, 'resume', '--json'];
      if (opts.model) {
        args.push('--model', opts.model);
      }
      if (opts.reasoningEffort) {
        args.push('-c', `model_reasoning_effort=${opts.reasoningEffort}`);
      }
      for (const imagePath of opts.imagePaths ?? []) {
        args.push('--image', imagePath);
      }
      args.push(opts.threadId, '-');
      return args;
    }

    const args = ['exec', '--json', ...permissionArgs];
    if (opts.cwd) {
      args.push('-C', opts.cwd);
    }
    if (opts.model) {
      args.push('--model', opts.model);
    }
    if (opts.reasoningEffort) {
      args.push('-c', `model_reasoning_effort=${opts.reasoningEffort}`);
    }
    for (const imagePath of opts.imagePaths ?? []) {
      args.push('--image', imagePath);
    }
    args.push('-');
    return args;
  }

  createTempImageFiles(images: Array<{ base64: string; mediaType: string }>): { paths: string[]; cleanup: () => void } {
    if (!images.length) {
      return { paths: [], cleanup: () => {} };
    }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-code-mirror-codex-images-'));
    const paths: string[] = [];
    try {
      images.forEach((img, index) => {
        const ext = this.imageExtensionFromMediaType(img.mediaType);
        const filePath = path.join(dir, `image-${index + 1}${ext}`);
        fs.writeFileSync(filePath, Buffer.from(img.base64, 'base64'));
        paths.push(filePath);
      });
    } catch (err) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
      throw err;
    }

    return {
      paths,
      cleanup: () => {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      },
    };
  }

  private imageExtensionFromMediaType(mediaType: string): string {
    switch (mediaType) {
      case 'image/png':
        return '.png';
      case 'image/jpeg':
        return '.jpg';
      case 'image/gif':
        return '.gif';
      case 'image/webp':
        return '.webp';
      default:
        return '.img';
    }
  }

  private buildPermissionArgs(permissionMode: 'full-access' | 'supervised'): string[] {
    if (permissionMode === 'supervised') {
      // Match the extension's "Supervised" semantics: Codex may read and analyze, but shell/file
      // actions run inside a read-only sandbox.
      return ['--sandbox', 'read-only'];
    }

    // Match the extension's "Full Access" semantics: no approval prompts and no sandboxing.
    return ['--dangerously-bypass-approvals-and-sandbox'];
  }

  private handleStdoutChunk(chunk: Buffer): void {
    this.stdoutChunkCount += 1;
    this.stdoutByteCount += chunk.length;
    if (this.stdoutChunkCount <= 3 || this.stdoutChunkCount % 25 === 0 || chunk.length >= 16 * 1024) {
      this.log(
        `Codex stdout chunk #${this.stdoutChunkCount} (${chunk.length} bytes, total=${this.stdoutByteCount}, buffered=${this.stdoutBuffer.length})`
      );
    }
    this.stdoutBuffer += chunk.toString('utf-8');
    const lines = this.stdoutBuffer.split('\n');
    this.stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      this.stdoutLineCount += 1;
      this.parseOutputLine(line);
    }
  }

  private flushRemainingStdoutBuffer(): void {
    const remaining = this.stdoutBuffer;
    this.stdoutBuffer = '';
    if (!remaining.trim()) {
      return;
    }
    this.log('Flushing trailing Codex stdout buffer on exit');
    this.parseOutputLine(remaining);
  }

  private parseOutputLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    try {
      const event = JSON.parse(trimmed) as CodexExecJsonEvent;
      this.jsonEventCount += 1;
      if (this.jsonEventCount <= 5 || this.jsonEventCount % 25 === 0) {
        this.log(`Parsed Codex JSON event #${this.jsonEventCount}: ${event.type}`);
      }
      this.emit('event', event);
    } catch {
      this.rawLineCount += 1;
      if (this.rawLineCount <= 5 || this.rawLineCount % 25 === 0) {
        this.log(`Non-JSON stdout line #${this.rawLineCount}: "${this.summarizeText(trimmed)}"`);
      }
      this.emit('raw', trimmed);
    }
  }

  private killTree(): void {
    if (!this.process) {
      return;
    }
    this.log(`Killing Codex process tree for PID ${this.process.pid ?? 'unknown'}`);
    killProcessTree(this.process);
  }

  private resetRunStats(): void {
    this.stdoutChunkCount = 0;
    this.stdoutByteCount = 0;
    this.stdoutLineCount = 0;
    this.jsonEventCount = 0;
    this.rawLineCount = 0;
    this.stderrChunkCount = 0;
    this.stderrByteCount = 0;
    this.activeRunStartedAt = 0;
  }

  private logProcessSummary(reason: string): void {
    const elapsedMs = this.activeRunStartedAt ? Math.max(0, Date.now() - this.activeRunStartedAt) : 0;
    this.log(
      `Codex process summary (turn #${this.activeRunId || 'n/a'}): ${reason}; elapsed=${elapsedMs}ms; ` +
        `stdoutChunks=${this.stdoutChunkCount}; stdoutBytes=${this.stdoutByteCount}; stdoutLines=${this.stdoutLineCount}; ` +
        `jsonEvents=${this.jsonEventCount}; rawLines=${this.rawLineCount}; stderrChunks=${this.stderrChunkCount}; stderrBytes=${this.stderrByteCount}`
    );
  }

  private summarizeText(text: string): string {
    return text.replace(/\s+/g, ' ').trim().slice(0, 160);
  }
}
