import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { buildClaudeCliEnv, buildSanitizedEnv } from '../process/envUtils';
import { killProcessTree } from '../process/killTree';
import { ConversationReader } from './ConversationReader';
import type { SerializedChatMessage } from '../types/webview-messages';

const MAX_TRANSCRIPT_CHARS = 4000;
const HAIKU_TIMEOUT_MS = 35_000;
const CODEX_TIMEOUT_MS = 45_000;

export interface SummarizeArgs {
  sessionId: string;
  /** Provider that owned the session (drives transcript file lookup). */
  provider: 'claude' | 'codex';
  /** Optional pre-computed transcript when JSONL is not yet available (e.g. fresh exit). */
  fallbackMessages?: SerializedChatMessage[];
  /** Optional CLI override (Happy uses a different binary). */
  cliPathOverride?: string;
  /** Used by Codex transcript discovery and CLI cwd. */
  workspacePath?: string;
}

export interface SummarizeResult {
  text: string;
  source: 'haiku' | 'codex';
}

/**
 * Generates a 1-3 sentence end-of-session summary used for hover tooltips.
 *
 * Pipeline: build transcript -> Haiku via `claude -p` -> on failure, Codex `exec --json -c
 * model_reasoning_effort=low` -> sanitize -> return. Returns null when transcript is too
 * thin (< 2 user messages) or both providers fail.
 */
export class SessionSummarizer {
  private log: (msg: string) => void = () => {};

  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
  }

  async summarizeSession(args: SummarizeArgs): Promise<SummarizeResult | null> {
    const transcript = this.buildTranscript(args);
    if (!transcript) {
      this.log('[Summarizer] Transcript unavailable - skipping');
      return null;
    }
    if (transcript.userMessageCount < 2) {
      this.log(`[Summarizer] Skipping: only ${transcript.userMessageCount} user message(s)`);
      return null;
    }

    const prompt = this.buildPrompt(transcript.text);

    const haiku = await this.runHaiku(prompt);
    if (haiku) {
      return { text: haiku, source: 'haiku' };
    }

    const codex = await this.runCodexFallback(prompt, args.workspacePath);
    if (codex) {
      return { text: codex, source: 'codex' };
    }

    return null;
  }

  // ---------- Transcript ----------

  private buildTranscript(args: SummarizeArgs): { text: string; userMessageCount: number } | null {
    let messages: SerializedChatMessage[] = [];
    if (args.fallbackMessages && args.fallbackMessages.length > 0) {
      messages = args.fallbackMessages;
    } else if (args.provider === 'claude') {
      const reader = new ConversationReader((m) => this.log(`[Summarizer/CR] ${m}`));
      messages = reader.readSession(args.sessionId, args.workspacePath);
    } else {
      // Codex transcripts live elsewhere; if a fallback list isn't provided, we currently
      // can't reliably read them. Caller should supply messages for Codex tabs.
      this.log('[Summarizer] No fallbackMessages provided for codex provider');
      return null;
    }

    if (messages.length === 0) {
      return null;
    }

    let userCount = 0;
    const lines: string[] = [];
    for (const msg of messages) {
      const role = msg.role;
      const text = this.extractPlainText(msg);
      if (!text) continue;
      if (role === 'user') {
        userCount++;
        lines.push(`USER: ${text}`);
      } else if (role === 'assistant') {
        lines.push(`ASSISTANT: ${text}`);
      }
    }

    if (userCount === 0) {
      return null;
    }

    const truncated = this.truncatePreservingHeadAndTail(lines.join('\n'));
    return { text: truncated, userMessageCount: userCount };
  }

  private extractPlainText(msg: SerializedChatMessage): string {
    const content = (msg as unknown as { content?: unknown }).content;
    if (typeof content === 'string') {
      return content.trim();
    }
    if (!Array.isArray(content)) {
      return '';
    }
    const parts: string[] = [];
    for (const block of content as Array<{ type?: string; text?: string }>) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text);
      }
    }
    return parts.join('\n').trim();
  }

  /** Keep the first user message intact and use the tail of the conversation. */
  private truncatePreservingHeadAndTail(transcript: string): string {
    if (transcript.length <= MAX_TRANSCRIPT_CHARS) {
      return transcript;
    }
    const headSize = Math.floor(MAX_TRANSCRIPT_CHARS * 0.3);
    const tailSize = MAX_TRANSCRIPT_CHARS - headSize - 16; // 16 chars for the divider
    const head = transcript.slice(0, headSize);
    const tail = transcript.slice(transcript.length - tailSize);
    return `${head}\n...[truncated]...\n${tail}`;
  }

  private buildPrompt(transcript: string): string {
    return [
      'Summarize this session in 1-3 sentences for a hover preview. Focus on the topic and outcome.',
      "Match the user's language. Reply with ONLY the summary, no preamble or quotes.",
      '',
      transcript,
    ].join('\n');
  }

  // ---------- Haiku (primary) ----------

  private runHaiku(prompt: string): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const config = vscode.workspace.getConfiguration('claudeMirror');
      const cliPath = config.get<string>('cliPath', 'claude');
      const analysisModel = config.get<string>('analysisModel', 'claude-haiku-4-5-20251001');
      const args = ['-p', '--model', analysisModel];
      const env = buildClaudeCliEnv();

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
        this.log(`[Summarizer/haiku] spawn pid=${child.pid ?? '?'} model=${analysisModel}`);
      } catch (err) {
        this.log(`[Summarizer/haiku] spawn threw: ${err}`);
        finish(null);
        return;
      }

      const timer = setTimeout(() => {
        const fallback = stdout ? this.sanitize(stdout) : null;
        this.log(`[Summarizer/haiku] timeout (${HAIKU_TIMEOUT_MS}ms), partial="${fallback ?? '<none>'}"`);
        killProcessTree(child);
        finish(fallback);
      }, HAIKU_TIMEOUT_MS);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        this.log(`[Summarizer/haiku] stderr: ${chunk.toString('utf-8').trim()}`);
      });
      child.on('error', (err) => {
        this.log(`[Summarizer/haiku] error: ${err.message}`);
        finish(null);
      });
      child.on('exit', (code) => {
        this.log(`[Summarizer/haiku] exit code=${code}`);
        if (code !== 0) {
          finish(null);
          return;
        }
        finish(this.sanitize(stdout));
      });
      child.stdin?.write(prompt);
      child.stdin?.end();
    });
  }

  // ---------- Codex (fallback) ----------

  private runCodexFallback(prompt: string, cwd?: string): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const cliPath =
        vscode.workspace.getConfiguration('claudeMirror').get<string>('codex.cliPath', 'codex') || 'codex';
      const args = [
        'exec',
        '--json',
        '--sandbox',
        'read-only',
        '-c',
        'model_reasoning_effort=low',
      ];
      if (cwd) {
        args.push('-C', cwd);
      }
      args.push('-');

      let stdoutBuffer = '';
      let captured = '';
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const finish = (result: string | null) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(result);
      };

      let child;
      try {
        child = spawn(cliPath, args, {
          cwd: cwd || undefined,
          env: buildSanitizedEnv(),
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true,
        });
        this.log(`[Summarizer/codex] spawn pid=${child.pid ?? '?'}`);
      } catch (err) {
        this.log(`[Summarizer/codex] spawn threw: ${err}`);
        finish(null);
        return;
      }

      timer = setTimeout(() => {
        this.log(`[Summarizer/codex] timeout (${CODEX_TIMEOUT_MS}ms)`);
        killProcessTree(child);
        finish(captured ? this.sanitize(captured) : null);
      }, CODEX_TIMEOUT_MS);

      const flushLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const event = JSON.parse(trimmed) as {
            type?: string;
            item?: { type?: string; text?: unknown; content?: unknown };
          };
          if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
            if (typeof event.item.text === 'string' && event.item.text.trim()) {
              captured = event.item.text;
            } else if (Array.isArray(event.item.content)) {
              const joined = event.item.content
                .map((part) => {
                  if (!part || typeof part !== 'object') return '';
                  const t = (part as { text?: unknown }).text;
                  return typeof t === 'string' ? t : '';
                })
                .join('')
                .trim();
              if (joined) captured = joined;
            }
          }
        } catch {
          // ignore non-JSON noise
        }
      };

      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutBuffer += chunk.toString('utf-8');
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() || '';
        for (const line of lines) flushLine(line);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        this.log(`[Summarizer/codex] stderr: ${chunk.toString('utf-8').trim()}`);
      });
      child.on('error', (err) => {
        this.log(`[Summarizer/codex] error: ${err.message}`);
        finish(null);
      });
      child.on('exit', (code) => {
        if (stdoutBuffer.trim()) {
          flushLine(stdoutBuffer);
          stdoutBuffer = '';
        }
        this.log(`[Summarizer/codex] exit code=${code}`);
        if (code !== 0) {
          finish(captured ? this.sanitize(captured) : null);
          return;
        }
        finish(this.sanitize(captured));
      });
      child.stdin?.write(prompt);
      if (!prompt.endsWith('\n')) {
        child.stdin?.write('\n');
      }
      child.stdin?.end();
    });
  }

  // ---------- Sanitize ----------

  private sanitize(raw: string): string | null {
    let cleaned = raw.trim();
    if (
      (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'"))
    ) {
      cleaned = cleaned.slice(1, -1).trim();
    }
    cleaned = cleaned.replace(/^[`*_~]+|[`*_~]+$/g, '').trim();
    if (!cleaned) return null;
    // Hard cap to prevent overly long tooltip text.
    const cap = 600;
    if (cleaned.length > cap) {
      cleaned = cleaned.slice(0, cap - 1).trimEnd() + '…';
    }
    return cleaned;
  }
}
