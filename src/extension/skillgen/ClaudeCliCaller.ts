import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { buildClaudeCliEnv } from '../process/envUtils';
import { killProcessTree } from '../process/killTree';

export interface ClaudeCliCallOptions {
  prompt: string;
  model: string;
  timeoutMs?: number;
}

/**
 * Shared utility for making one-shot Claude CLI calls.
 * Used by all AI phases in the SkillGen pipeline to replace
 * direct Anthropic SDK calls with `claude -p --model <model>`.
 *
 * Based on the same pattern as PromptEnhancer.ts / SessionNamer.ts.
 */
export class ClaudeCliCaller {
  private log: (msg: string) => void = () => {};
  private apiKey: string | undefined;

  setApiKey(key: string | undefined): void {
    this.apiKey = key;
  }

  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
  }

  /**
   * Make a one-shot Claude CLI call.
   * Pipes the prompt to stdin and returns the raw stdout.
   * Throws on failure (timeout, non-zero exit, empty result).
   */
  async call(options: ClaudeCliCallOptions): Promise<string> {
    const { prompt, model, timeoutMs = 30_000 } = options;

    const config = vscode.workspace.getConfiguration('claudeMirror');
    const cliPath = config.get<string>('cliPath', 'claude');

    const args = ['-p', '--model', model];

    const env = buildClaudeCliEnv(this.apiKey);

    this.log(`[ClaudeCliCaller] Spawning CLI | model=${model} promptLen=${prompt.length} timeoutMs=${timeoutMs}`);

    return new Promise<string>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (result: string | null, error?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (result !== null) {
          resolve(result);
        } else {
          reject(new Error(error || 'Claude CLI call failed'));
        }
      };

      let child;
      try {
        child = spawn(cliPath, args, {
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log(`[ClaudeCliCaller] spawn() threw: ${msg}`);
        finish(null, `Failed to spawn Claude CLI: ${msg}`);
        return;
      }

      const timer = setTimeout(() => {
        this.log(`[ClaudeCliCaller] timeout (${timeoutMs}ms), killing process`);
        killProcessTree(child);
        finish(null, `Claude CLI timed out after ${Math.round(timeoutMs / 1000)}s`);
      }, timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8');
      });

      child.on('error', (err) => {
        this.log(`[ClaudeCliCaller] spawn error: ${err.message}`);
        finish(null, `Claude CLI spawn error: ${err.message}`);
      });

      child.on('exit', (code) => {
        if (code !== 0) {
          const stderrTail = stderr.slice(-300).trim();
          this.log(`[ClaudeCliCaller] exited with code ${code} | stderr=${stderrTail}`);
          finish(null, `Claude CLI exited with code ${code}: ${stderrTail}`);
          return;
        }
        const result = stdout.trim();
        if (result) {
          this.log(`[ClaudeCliCaller] Call complete | resultLen=${result.length}`);
          finish(result);
        } else {
          this.log('[ClaudeCliCaller] Empty result');
          finish(null, 'Claude CLI returned empty result');
        }
      });

      child.stdin?.write(prompt);
      child.stdin?.end();
    });
  }

  /**
   * Call Claude CLI and parse the JSON response.
   * Strips markdown code fences before parsing.
   */
  async callJson<T = unknown>(options: ClaudeCliCallOptions): Promise<T> {
    const raw = await this.call(options);
    const cleaned = raw.trim()
      .replace(/^```json?\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();
    return JSON.parse(cleaned) as T;
  }
}
