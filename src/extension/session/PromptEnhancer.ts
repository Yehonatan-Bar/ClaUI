import * as vscode from 'vscode';
import { spawn } from 'child_process';

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
6. KEEP it concise. Enhanced prompt should be 1.5-3x original length, not 10x.
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
  async enhance(rawPrompt: string, model?: string): Promise<string | null> {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const cliPath = config.get<string>('cliPath', 'claude');
    const enhancerModel = model ||
      config.get<string>('promptEnhancer.model', 'claude-sonnet-4-6');

    // Truncate to 4000 chars to avoid extremely long prompts
    const truncated = rawPrompt.slice(0, 4000);
    const prompt = ENHANCER_SYSTEM_PROMPT + truncated + '\n---';

    const args = ['-p', '--model', enhancerModel];

    // Clean environment to prevent nested-session detection
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    this.log(`[PromptEnhancer] Spawning CLI with model=${enhancerModel} (${truncated.length} chars)`);

    return new Promise<string | null>((resolve) => {
      let stdout = '';
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

      // 30-second timeout
      const timer = setTimeout(() => {
        this.log('[PromptEnhancer] timeout (30s), killing process');
        child.kill('SIGTERM');
        finish(null);
      }, 30_000);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        this.log(`[PromptEnhancer] stderr: ${chunk.toString('utf-8').trim()}`);
      });

      child.on('error', (err) => {
        this.log(`[PromptEnhancer] spawn error: ${err.message}`);
        finish(null);
      });

      child.on('exit', (code) => {
        if (code !== 0) {
          this.log(`[PromptEnhancer] exited with code ${code}`);
          finish(null);
          return;
        }
        const result = stdout.trim();
        if (result) {
          this.log(`[PromptEnhancer] Enhancement complete (${result.length} chars)`);
          finish(result);
        } else {
          this.log('[PromptEnhancer] Empty result');
          finish(null);
        }
      });

      child.stdin?.write(prompt);
      child.stdin?.end();
    });
  }
}
