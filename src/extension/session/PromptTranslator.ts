import * as vscode from 'vscode';
import { spawn, exec } from 'child_process';
import { buildClaudeCliEnv } from '../process/envUtils';

const TRANSLATOR_SYSTEM_PROMPT = `Rewrite the following text in English as a native English-speaking software engineer would naturally phrase it.
Preserve the original intent, technical meaning, structure, and level of detail.
Improve clarity, fluency, and terminology where appropriate.
Do not summarize, expand, omit, or add new information.

Output constraints (mandatory):
Return only the rewritten text.
Do not include explanations, comments, notes, prefixes, suffixes, labels, or formatting wrappers.
Do not add quotation marks.
Do not mention that you performed a rewrite.
Do not include any text before or after the rewritten result.
The response must contain the rewritten text only.

The user's text to rewrite:
---
`;

/**
 * Spawns a one-shot Claude CLI process to translate a user prompt
 * into native English. Follows the same pattern as PromptEnhancer.
 */
export class PromptTranslator {
  private log: (msg: string) => void = () => {};

  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
  }

  /**
   * Translate a user prompt to English using Claude CLI one-shot call.
   * Returns the translated text, or null on failure.
   */
  async translate(rawPrompt: string, apiKey?: string): Promise<string | null> {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const cliPath = config.get<string>('cliPath', 'claude');
    const model = 'claude-sonnet-4-6';

    // Truncate to 3000 chars to keep generation fast and within timeout
    const truncated = rawPrompt.length > 3000
      ? rawPrompt.slice(0, 3000) + '\n[...truncated]'
      : rawPrompt;
    const prompt = TRANSLATOR_SYSTEM_PROMPT + truncated + '\n---';

    const args = ['-p', '--model', model];

    const env = buildClaudeCliEnv(apiKey);

    this.log(`[PromptTranslator] Spawning CLI with model=${model} (${truncated.length} chars, original=${rawPrompt.length} chars)`);

    return new Promise<string | null>((resolve) => {
      let stdout = '';
      let stderrBuf = '';
      let settled = false;

      const finish = (result: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      let child;
      try {
        child = spawn(cliPath, args, {
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true,
        });
      } catch (err) {
        this.log(`[PromptTranslator] spawn() threw: ${err}`);
        finish(null);
        return;
      }

      // Kill the entire process tree (Windows shell:true workaround)
      const killTree = () => {
        if (!child.pid) return;
        if (process.platform === 'win32') {
          exec(`taskkill /F /T /PID ${child.pid}`, () => {});
        } else {
          child.kill('SIGTERM');
        }
      };

      // 60-second timeout
      const timer = setTimeout(() => {
        this.log(`[PromptTranslator] timeout (60s), killing process. stdout=${stdout.length} chars, stderr=${stderrBuf.length} chars`);
        killTree();
        finish(null);
      }, 60_000);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8').trim();
        stderrBuf += text + '\n';
        this.log(`[PromptTranslator] stderr: ${text}`);
      });

      child.on('error', (err) => {
        this.log(`[PromptTranslator] spawn error: ${err.message}`);
        finish(null);
      });

      child.on('exit', (code) => {
        if (code !== 0) {
          this.log(`[PromptTranslator] exited with code ${code}, stderr: ${stderrBuf.trim()}`);
          finish(null);
          return;
        }
        const result = stdout.trim();
        if (result) {
          this.log(`[PromptTranslator] Translation complete (${result.length} chars)`);
          finish(result);
        } else {
          this.log(`[PromptTranslator] Empty result. stderr: ${stderrBuf.trim()}`);
          finish(null);
        }
      });

      // Write stdin safely: wait for drain if buffer is full
      const ok = child.stdin?.write(prompt, 'utf-8');
      if (ok === false) {
        child.stdin?.once('drain', () => {
          child.stdin?.end();
        });
      } else {
        child.stdin?.end();
      }
    });
  }
}
