import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { buildClaudeCliEnv } from '../process/envUtils';
import { killProcessTree } from '../process/killTree';
import { buildClassifierPrompt, parseClassifierOutput, parseVerdictLine } from './reviewLoopPrompts';
import type { ReviewVerdict } from './reviewLoopTypes';

/**
 * Two-layer verdict classifier for the review loop.
 *  1. Deterministic: parse the reviewer's mandatory "VERDICT: ..." line.
 *  2. Fallback: a lightweight one-shot Claude (Haiku) call, mirroring SessionNamer.
 * Conservative on failure: defaults to NOT approved so the loop never falsely
 * declares success.
 */
export class ReviewVerdictClassifier {
  private log: (msg: string) => void = () => {};
  private claudeConfigDirProvider: () => string | undefined = () => undefined;
  private activeChild: import('child_process').ChildProcess | null = null;

  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
  }

  /** Resolved at call time so per-tab Claude account profile changes apply. */
  setClaudeConfigDirProvider(provider: () => string | undefined): void {
    this.claudeConfigDirProvider = provider;
  }

  /** Kill any in-flight classifier subprocess (called when the loop is stopped). */
  cancel(): void {
    if (this.activeChild) {
      try {
        killProcessTree(this.activeChild);
      } catch {
        // best-effort
      }
      this.activeChild = null;
    }
  }

  async classify(reviewText: string, opts: { model: string; timeoutMs?: number }): Promise<ReviewVerdict> {
    // Layer 1: the reviewer is instructed to end with a deterministic verdict line.
    const line = parseVerdictLine(reviewText);
    if (line === 'approved') {
      return { approved: true, reason: 'Reviewer ended with VERDICT: APPROVED.' };
    }
    if (line === 'changes') {
      return { approved: false, reason: 'Reviewer ended with VERDICT: CHANGES_REQUESTED.' };
    }

    // Layer 2: ambiguous/missing verdict line -> ask the lightweight classifier.
    this.log('[Classifier] no deterministic verdict line; asking the classifier model.');
    let out: string | null = null;
    try {
      out = await this.runClaude(buildClassifierPrompt(reviewText), opts.model, opts.timeoutMs ?? 30_000);
    } catch (err) {
      this.log(`[Classifier] run failed: ${err instanceof Error ? err.message : String(err)}`);
      out = null;
    }
    if (out === null) {
      // Conservative: never let a classifier failure become a loop error or a false approval.
      return { approved: false, reason: 'Could not classify the verdict; treating as changes requested.' };
    }
    return parseClassifierOutput(out);
  }

  private runClaude(prompt: string, model: string, timeoutMs: number): Promise<string | null> {
    const cliPath = vscode.workspace.getConfiguration('claudeMirror').get<string>('cliPath', 'claude');
    const args = ['-p', '--model', model];
    const env = buildClaudeCliEnv(undefined, this.claudeConfigDirProvider());

    return new Promise<string | null>((resolve) => {
      let stdout = '';
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (result: string | null) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        this.activeChild = null;
        resolve(result);
      };

      let child;
      try {
        child = spawn(cliPath, args, { env, stdio: ['pipe', 'pipe', 'pipe'], shell: true });
      } catch (err) {
        this.log(`[Classifier] spawn threw: ${err instanceof Error ? err.message : String(err)}`);
        finish(null);
        return;
      }

      this.activeChild = child;
      timer = setTimeout(() => {
        this.log('[Classifier] timed out.');
        killProcessTree(child);
        finish(stdout.trim() ? stdout : null);
      }, timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        this.log(`[Classifier] stderr: ${chunk.toString('utf-8').trim().slice(0, 200)}`);
      });
      child.on('error', (err) => {
        this.log(`[Classifier] error: ${err.message}`);
        finish(null);
      });
      child.on('exit', (code) => {
        finish(code === 0 ? stdout : stdout.trim() ? stdout : null);
      });

      child.stdin?.write(prompt);
      child.stdin?.end();
    });
  }
}
