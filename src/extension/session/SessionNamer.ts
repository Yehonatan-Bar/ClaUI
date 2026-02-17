import * as vscode from 'vscode';
import { spawn } from 'child_process';

/**
 * Spawns a lightweight one-shot Claude CLI process to generate
 * a short session name (1-3 words) from the user's first message.
 * Uses Haiku for speed/cost efficiency.
 */
export class SessionNamer {
  private log: (msg: string) => void = () => {};

  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
  }

  /**
   * Generate a short session name from the user's first message.
   * Returns null if naming fails for any reason (timeout, bad output, etc.).
   */
  async generateName(firstMessage: string): Promise<string | null> {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const cliPath = config.get<string>('cliPath', 'claude');

    // Truncate user message to 200 chars
    const truncatedMessage = firstMessage.slice(0, 200);

    const prompt =
      'Name this chat session in 1-3 words. Match the language of the user\'s message (Hebrew or English). ' +
      'Reply with ONLY the name, nothing else.\n\n' +
      `User message: "${truncatedMessage}"`;

    // Use -p without inline prompt; pipe the prompt via stdin to avoid
    // shell escaping issues with quotes, newlines, and Hebrew chars.
    const args = [
      '-p',
      '--model', 'claude-haiku-4-5-20251001',
    ];

    // Clean environment to prevent nested-session detection
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    this.log(`SessionNamer: spawning "${cliPath}" with args: ${JSON.stringify(args)}`);
    this.log(`SessionNamer: first message (${truncatedMessage.length} chars): "${truncatedMessage.slice(0, 80)}..."`);

    return new Promise<string | null>((resolve) => {
      let stdout = '';
      let settled = false;

      const finish = (result: string | null) => {
        if (settled) { return; }
        settled = true;
        this.log(`SessionNamer: finish() called with result="${result}"`);
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
        this.log(`SessionNamer: spawn succeeded, PID=${child.pid ?? 'unknown'}`);
      } catch (err) {
        this.log(`SessionNamer: spawn() threw: ${err}`);
        finish(null);
        return;
      }

      // 10-second timeout
      const timer = setTimeout(() => {
        this.log('SessionNamer: timeout (10s), killing process');
        child.kill('SIGTERM');
        finish(null);
      }, 10_000);

      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        this.log(`SessionNamer: stdout chunk (${text.length} chars): "${text.slice(0, 100)}"`);
        stdout += text;
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        this.log(`SessionNamer stderr: ${chunk.toString('utf-8').trim()}`);
      });

      child.on('error', (err) => {
        this.log(`SessionNamer spawn error: ${err.message}`);
        finish(null);
      });

      child.on('exit', (code) => {
        this.log(`SessionNamer exited with code ${code}`);
        if (code !== 0) {
          finish(null);
          return;
        }

        const sanitized = this.sanitize(stdout);
        if (sanitized) {
          this.log(`SessionNamer: generated name "${sanitized}"`);
        } else {
          this.log(`SessionNamer: output rejected after sanitization (raw: "${stdout.trim()}")`);
        }
        finish(sanitized);
      });

      // Pipe prompt via stdin and close - avoids shell escaping issues
      child.stdin?.write(prompt);
      child.stdin?.end();
    });
  }

  /** Clean and validate CLI output into a usable tab title */
  private sanitize(raw: string): string | null {
    let cleaned = raw.trim();

    // Strip surrounding quotes
    if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
        (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
      cleaned = cleaned.slice(1, -1).trim();
    }

    // Strip leading/trailing punctuation (periods, colons, etc.)
    cleaned = cleaned.replace(/^[.,!?:;\-]+|[.,!?:;\-]+$/g, '').trim();

    // Reject empty
    if (!cleaned) {
      return null;
    }

    // Reject too long (>40 chars)
    if (cleaned.length > 40) {
      return null;
    }

    // Reject too many words (>5)
    const wordCount = cleaned.split(/\s+/).length;
    if (wordCount > 5) {
      return null;
    }

    return cleaned;
  }
}
