import * as vscode from 'vscode';
import { spawn } from 'child_process';

/**
 * Spawns a one-shot Claude CLI process to translate message text
 * to Hebrew using Sonnet 4.6. Follows the SessionNamer pattern.
 */
export class MessageTranslator {
  private log: (msg: string) => void = () => {};

  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
  }

  /**
   * Translate text content to Hebrew using Claude Sonnet via the CLI.
   * Code blocks should be stripped BEFORE calling this method.
   * Returns the translated text, or null on failure.
   */
  async translate(textContent: string): Promise<string | null> {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const cliPath = config.get<string>('cliPath', 'claude');

    const prompt = [
      'You are a professional translator. Translate the following text to Hebrew.',
      '',
      'RULES:',
      '- Translate ALL text content to Hebrew.',
      '- Preserve all markdown formatting (bold, italic, headers, lists, links, etc.).',
      '- Do NOT translate technical terms, variable names, function names, file paths, or command names.',
      '- Do NOT translate text inside inline code (backticks).',
      '- Do NOT add any explanation, commentary, or notes.',
      '- Output ONLY the translated text, nothing else.',
      '',
      'Text to translate:',
      '---',
      textContent,
      '---',
    ].join('\n');

    const args = ['-p', '--model', 'claude-sonnet-4-6'];

    // Clean environment to prevent nested-session detection
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    this.log(`[MessageTranslator] Spawning CLI for translation (${textContent.length} chars)`);

    return new Promise<string | null>((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (result: string | null) => {
        if (settled) { return; }
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
        this.log(`[MessageTranslator] spawn succeeded, PID=${child.pid ?? 'unknown'}`);
      } catch (err) {
        this.log(`[MessageTranslator] spawn() threw: ${err}`);
        finish(null);
        return;
      }

      // 30-second timeout (translations can be lengthy)
      const timer = setTimeout(() => {
        this.log('[MessageTranslator] timeout (30s), killing process');
        child.kill('SIGTERM');
        finish(null);
      }, 30_000);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8').trim();
        stderr += text + '\n';
        this.log(`[MessageTranslator] stderr: ${text}`);
      });

      child.on('error', (err) => {
        this.log(`[MessageTranslator] spawn error: ${err.message}`);
        finish(null);
      });

      child.on('exit', (code) => {
        this.log(`[MessageTranslator] exited with code ${code}${code !== 0 && stderr.trim() ? ` | stderr: ${stderr.trim()}` : ''}`);
        if (code !== 0) {
          finish(null);
          return;
        }

        const result = stdout.trim();
        if (result) {
          this.log(`[MessageTranslator] Translation complete (${result.length} chars)`);
          finish(result);
        } else {
          this.log('[MessageTranslator] Empty translation result');
          finish(null);
        }
      });

      // Pipe prompt via stdin and close
      child.stdin?.write(prompt);
      child.stdin?.end();
    });
  }
}
