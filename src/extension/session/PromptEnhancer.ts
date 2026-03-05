import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { buildClaudeCliEnv } from '../process/envUtils';
import { killProcessTree } from '../process/killTree';

const ENHANCER_SYSTEM_PROMPT = `You are an expert prompt engineer. Your job is to take a user's raw prompt and rewrite it to be maximally effective for a frontier AI coding assistant (Claude).

RULES:
1. PRESERVE the user's original intent exactly. Do not change what they want.
2. IMPROVE clarity, specificity, and structure.
3. ADD helpful scaffolding where beneficial:
   - Specific acceptance criteria for vague tasks
   - Step-by-step approach for complex tasks
   - Expected behavior, edge cases, constraints for code tasks
   - Output format specification when relevant
4. USE structured formatting when helpful (numbered steps, bullet points).
5. ADD context cues that help the AI perform better:
   - "Think step by step" for reasoning tasks
   - "Consider edge cases" for implementation tasks
6. KEEP it concise. Enhanced prompt should be 1.5-2x original length, NOT longer.
   For long prompts (>1000 chars), focus on restructuring rather than expanding.
7. Match the LANGUAGE of the original prompt (Hebrew stays Hebrew, English stays English).
8. Output ONLY the enhanced prompt text, nothing else. No quotes, no meta-commentary.

The user's prompt to enhance:
---
`;

/**
 * Spawns a one-shot Claude CLI process to enhance a user prompt
 * using advanced prompt engineering techniques.
 * Follows the same pattern as SessionNamer / MessageTranslator.
 */
export class PromptEnhancer {
  private log: (msg: string) => void = () => {};

  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
  }

  /**
   * Enhance a user prompt using Claude CLI one-shot call.
   * Returns the enhanced prompt text, or null on failure.
   */
  async enhance(rawPrompt: string, model?: string, apiKey?: string): Promise<string | null> {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const cliPath = config.get<string>('cliPath', 'claude');
    const enhancerModel = model ||
      config.get<string>('promptEnhancer.model', 'claude-sonnet-4-6');

    // Truncate to 3000 chars to keep generation fast and within timeout
    const truncated = rawPrompt.length > 3000
      ? rawPrompt.slice(0, 3000) + '\n[...truncated]'
      : rawPrompt;
    const prompt = ENHANCER_SYSTEM_PROMPT + truncated + '\n---';

    const args = ['-p', '--model', enhancerModel];

    const env = buildClaudeCliEnv(apiKey);

    this.log(`[PromptEnhancer] Spawning CLI with model=${enhancerModel} (${truncated.length} chars, original=${rawPrompt.length} chars)`);

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
        this.log(`[PromptEnhancer] spawn() threw: ${err}`);
        finish(null);
        return;
      }

      // 60-second timeout (long prompts need more time for generation)
      const timer = setTimeout(() => {
        this.log(`[PromptEnhancer] timeout (60s), killing process. stdout=${stdout.length} chars, stderr=${stderrBuf.length} chars`);
        killProcessTree(child);
        finish(null);
      }, 60_000);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8').trim();
        stderrBuf += text + '\n';
        this.log(`[PromptEnhancer] stderr: ${text}`);
      });

      child.on('error', (err) => {
        this.log(`[PromptEnhancer] spawn error: ${err.message}`);
        finish(null);
      });

      child.on('exit', (code) => {
        if (code !== 0) {
          this.log(`[PromptEnhancer] exited with code ${code}, stderr: ${stderrBuf.trim()}`);
          finish(null);
          return;
        }
        const result = stdout.trim();
        if (result) {
          this.log(`[PromptEnhancer] Enhancement complete (${result.length} chars)`);
          finish(result);
        } else {
          this.log(`[PromptEnhancer] Empty result. stderr: ${stderrBuf.trim()}`);
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
