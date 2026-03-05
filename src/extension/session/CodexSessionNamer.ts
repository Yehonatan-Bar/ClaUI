import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { buildSanitizedEnv } from '../process/envUtils';
import { killProcessTree } from '../process/killTree';

/**
 * Spawns a lightweight one-shot Codex CLI process to generate
 * a short session name (1-3 words) from the user's first message.
 */
export class CodexSessionNamer {
  private log: (msg: string) => void = () => {};

  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
  }

  /**
   * Generate a short session name from the user's first message.
   * Uses Codex CLI with medium reasoning effort.
   */
  async generateName(firstMessage: string, options?: { model?: string; cwd?: string }): Promise<string | null> {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const cliPath = config.get<string>('codex.cliPath', 'codex') || 'codex';
    const selectedModel = (options?.model || config.get<string>('codex.model', '') || '').trim();
    const selectedCwd = options?.cwd?.trim();
    const truncatedMessage = firstMessage.slice(0, 200);

    const prompt =
      'Name this chat session in 1-3 words. Match the language of the user\'s message (Hebrew or English). ' +
      'Reply with ONLY the name, nothing else. Do not use tools or shell commands.\n\n' +
      `User message: "${truncatedMessage}"`;

    const args = ['exec', '--json', '--sandbox', 'read-only'];
    if (selectedCwd) {
      args.push('-C', selectedCwd);
    }
    if (selectedModel) {
      args.push('--model', selectedModel);
    }
    // User requested medium thinking for Codex auto session naming.
    args.push('-c', 'model_reasoning_effort=medium');
    args.push('-');

    const env = buildSanitizedEnv();

    this.log(`CodexSessionNamer: spawning "${cliPath}" with args: ${JSON.stringify(args)}`);
    this.log(`CodexSessionNamer: first message (${truncatedMessage.length} chars): "${truncatedMessage.slice(0, 80)}..."`);

    return new Promise<string | null>((resolve) => {
      let stdoutBuffer = '';
      let capturedAgentText = '';
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const finish = (result: string | null) => {
        if (settled) return;
        settled = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        this.log(`CodexSessionNamer: finish() called with result="${result}"`);
        resolve(result);
      };

      let child;
      try {
        child = spawn(cliPath, args, {
          cwd: selectedCwd || undefined,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true,
        });
        this.log(`CodexSessionNamer: spawn succeeded, PID=${child.pid ?? 'unknown'}`);
      } catch (err) {
        this.log(`CodexSessionNamer: spawn() threw: ${err}`);
        finish(null);
        return;
      }

      timer = setTimeout(() => {
        this.log('CodexSessionNamer: timeout (15s), killing process');
        killProcessTree(child);
        finish(null);
      }, 15_000);

      const flushLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        try {
          const event = JSON.parse(trimmed) as {
            type?: string;
            item?: {
              type?: string;
              text?: unknown;
              content?: unknown;
            };
          };
          if (
            event.type === 'item.completed' &&
            event.item?.type === 'agent_message' &&
            typeof event.item.text === 'string' &&
            event.item.text.trim()
          ) {
            capturedAgentText = event.item.text;
            this.log(`CodexSessionNamer: captured agent_message (${capturedAgentText.length} chars)`);
            return;
          }

          if (
            event.type === 'item.completed' &&
            event.item?.type === 'agent_message' &&
            Array.isArray(event.item.content)
          ) {
            const joined = event.item.content
              .map((part) => {
                if (!part || typeof part !== 'object') return '';
                const text = (part as { text?: unknown }).text;
                return typeof text === 'string' ? text : '';
              })
              .join('')
              .trim();
            if (joined) {
              capturedAgentText = joined;
              this.log(`CodexSessionNamer: captured agent_message content[] (${capturedAgentText.length} chars)`);
            }
          }
        } catch {
          // Some Codex builds may emit non-JSON lines/noise. Ignore.
        }
      };

      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutBuffer += chunk.toString('utf-8');
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() || '';
        for (const line of lines) {
          flushLine(line);
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        this.log(`CodexSessionNamer stderr: ${chunk.toString('utf-8').trim()}`);
      });

      child.on('error', (err) => {
        this.log(`CodexSessionNamer spawn error: ${err.message}`);
        finish(null);
      });

      child.on('exit', (code) => {
        if (stdoutBuffer.trim()) {
          flushLine(stdoutBuffer);
          stdoutBuffer = '';
        }
        this.log(`CodexSessionNamer exited with code ${code}`);
        if (code !== 0) {
          finish(null);
          return;
        }
        const sanitized = this.sanitize(capturedAgentText);
        if (sanitized) {
          this.log(`CodexSessionNamer: generated name "${sanitized}"`);
        } else {
          this.log(`CodexSessionNamer: output rejected after sanitization (raw: "${capturedAgentText.trim()}")`);
        }
        finish(sanitized);
      });

      child.stdin?.write(prompt);
      if (!prompt.endsWith('\n')) {
        child.stdin?.write('\n');
      }
      child.stdin?.end();
    });
  }

  private sanitize(raw: string): string | null {
    let cleaned = raw.trim();

    if (
      (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'"))
    ) {
      cleaned = cleaned.slice(1, -1).trim();
    }

    cleaned = cleaned.replace(/^[.,!?:;\-]+|[.,!?:;\-]+$/g, '').trim();

    if (!cleaned) {
      return null;
    }
    if (cleaned.length > 40) {
      return null;
    }
    if (cleaned.split(/\s+/).length > 5) {
      return null;
    }

    return cleaned;
  }
}
