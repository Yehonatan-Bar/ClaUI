import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CLAUI_HOME } from '../config';
import { acquireLock } from '../fileLock';
import { killTree, resolveExecutable } from '../procUtils';
import { BridgePrompt, imagesOmittedNote, StreamEmitter } from '../protocol';
import { SessionStore } from '../sessionStore';

/**
 * Google Antigravity backend via the official `agy` CLI in headless print mode
 * (`agy -p "<prompt>"`). Requires the user to have installed and authenticated
 * the Antigravity CLI (Google AI Pro subscription).
 *
 * Continuity: agy has no session API in print mode, but it persists every
 * conversation under ~/.gemini/antigravity-cli/brain/<conversation-id>/ and
 * accepts `--conversation <id>` to continue one. The bridge snapshots the brain
 * directory before the first turn, diffs afterwards to learn the new
 * conversation id, and stores it per ClaUi session for later turns/resumes.
 * That snapshot→run→diff window is guarded by a cross-process lock so two tabs
 * starting their first turn at once cannot bind the same conversation id.
 *
 * No streaming: agy prints the final answer only, so the UI shows a working
 * spinner until the turn completes.
 */

const AGY_BRAIN_DIR = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
const PRINT_TIMEOUT_MS = Number(process.env.CLAUI_BRIDGE_AGY_TIMEOUT_MS || 15 * 60 * 1000);
const DISCOVERY_LOCK_DIR = path.join(CLAUI_HOME, 'locks', 'agy-first-turn');

/**
 * Resolve the `agy` CLI to a concrete, shell-free invocation. We NEVER run agy
 * through a shell: the user's prompt is passed as an argv element, and a shell
 * would let prompt text containing `&`, `|`, `^` etc. inject extra commands.
 */
export function resolveAgyCli(cliPath: string): { command: string; useShell: boolean } {
  const known: string[] = [];
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    known.push(path.join(process.env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe'));
  }
  return resolveExecutable(cliPath, 'agy', known);
}

function listConversationIds(): Set<string> {
  try {
    return new Set(fs.readdirSync(AGY_BRAIN_DIR));
  } catch {
    return new Set();
  }
}

function findNewConversationId(before: Set<string>): string | null {
  try {
    const created = fs.readdirSync(AGY_BRAIN_DIR).filter((d) => !before.has(d));
    if (created.length === 0) return null;
    if (created.length === 1) return created[0];
    return created
      .map((d) => {
        try {
          return { d, mtime: fs.statSync(path.join(AGY_BRAIN_DIR, d)).mtimeMs };
        } catch {
          return { d, mtime: 0 };
        }
      })
      .sort((a, b) => b.mtime - a.mtime)[0].d;
  } catch {
    return null;
  }
}

export class AntigravityBackend {
  private currentChild: ReturnType<typeof spawn> | null = null;

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
    killTree(this.currentChild);
  }

  private runAgy(promptText: string, conversationId: string | null): Promise<string> {
    const { command, useShell } = resolveAgyCli(this.cliPath);
    return new Promise((resolve, reject) => {
      const argv = [
        '-p',
        promptText,
        '--add-dir',
        process.cwd(),
        '--print-timeout',
        `${Math.max(60, Math.ceil(PRINT_TIMEOUT_MS / 1000))}s`,
      ];
      // Mirror ClaUi's permission model: full-access tabs run unattended.
      // (Supervised agy tabs keep the CLI's own interactive permission gate.)
      if (this.permissionMode !== 'supervised') {
        argv.push('--dangerously-skip-permissions');
      }
      if (this.model) argv.push('--model', this.model);
      if (conversationId) argv.push('--conversation', conversationId);

      let settled = false;
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(command, argv, {
          cwd: process.cwd(),
          shell: useShell, // always false — prompt text is never shell-interpreted
          windowsHide: true,
        });
      } catch (e) {
        reject(e as Error);
        return;
      }
      this.currentChild = child;
      let stdout = '';
      let stderr = '';
      const killTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          killTree(child);
          reject(new Error('Antigravity CLI hard-timeout'));
        }
      }, PRINT_TIMEOUT_MS + 30000);
      killTimer.unref?.();
      child.stdout?.on('data', (d) => {
        stdout += String(d);
      });
      child.stderr?.on('data', (d) => {
        stderr += String(d);
        this.log(`agy stderr: ${String(d).slice(0, 400)}`);
      });
      child.on('error', (e) => {
        if (!settled) {
          settled = true;
          clearTimeout(killTimer);
          reject(new Error(`Failed to start Antigravity CLI: ${e.message}. Is agy installed and logged in?`));
        }
      });
      child.on('exit', (code) => {
        this.currentChild = null;
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(
            new Error(`agy exited ${code}: ${(stderr || stdout).slice(0, 800)}`),
          );
        }
      });
    });
  }

  async runTurn(prompt: BridgePrompt, emitter: StreamEmitter): Promise<string> {
    const stored = this.store.read(this.sessionId);
    const conversationId = stored?.agyConversationId || null;
    const isFirstTurn = !conversationId;

    // agy print mode is text-only; never drop attachments silently.
    let userText = prompt.text;
    if (prompt.images.length) {
      const note = imagesOmittedNote(prompt.images.length, 'Antigravity');
      this.log(note);
      userText = userText ? `${userText}\n\n${note}` : note;
    }

    let effectivePrompt = userText;
    if (isFirstTurn && this.systemPrompt) {
      effectivePrompt = `<system-rules>\n${this.systemPrompt}\n</system-rules>\n\n${userText}`;
    }

    // Serialize the snapshot→run→diff window across processes so two tabs
    // starting their first turn concurrently can't bind the same new
    // conversation id. Waiting tabs block until the running one finishes; if
    // acquisition times out we proceed unlocked rather than fail the turn.
    const lock = isFirstTurn
      ? await acquireLock(DISCOVERY_LOCK_DIR, {
          timeoutMs: PRINT_TIMEOUT_MS + 60_000,
          staleMs: PRINT_TIMEOUT_MS + 120_000,
        })
      : null;
    let answer: string;
    try {
      const before = isFirstTurn ? listConversationIds() : null;
      answer = await this.runAgy(effectivePrompt, conversationId);

      if (isFirstTurn && before) {
        const discovered = findNewConversationId(before);
        if (discovered) {
          this.store.write(this.sessionId, {
            backend: 'antigravity',
            model: this.model,
            agyConversationId: discovered,
          });
          this.log(`agy conversation bound: ${discovered}`);
        } else {
          this.log('agy conversation id not discovered; next turn starts fresh context');
        }
      }
    } finally {
      lock?.release();
    }

    this.store.write(this.sessionId, { backend: 'antigravity', model: this.model });
    this.store.appendHistory(this.sessionId, 'user', userText);
    this.store.appendHistory(this.sessionId, 'assistant', answer);

    emitter.append('text', answer);
    return answer;
  }
}
