import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { buildClaudeCliEnv } from '../process/envUtils';
import { killProcessTree } from '../process/killTree';
import type { HandoffContextBuilder } from './handoff/HandoffContextBuilder';
import type { HandoffPromptComposer } from './handoff/HandoffPromptComposer';
import type { HandoffCapsule, HandoffSourceSnapshot } from './handoff/HandoffTypes';
import type { SerializedChatMessage } from '../types/webview-messages';

/**
 * Builds the token-saving "Compact Session" handoff prompt.
 *
 * Pipeline: read the source session transcript -> ground it with a structured
 * capsule (objective/files/blockers extracted heuristically) -> ask the Claude
 * CLI to write ONE self-contained continuation prompt that a fresh session can
 * use to seamlessly resume the work with far fewer tokens than the raw history.
 *
 * Falls back to the deterministic HandoffPromptComposer output when the CLI
 * summary is unavailable (empty transcript, spawn failure, timeout, non-zero
 * exit), so the feature always produces a usable prompt.
 */

// Bigger than the tooltip summarizer: we want the whole session captured.
const MAX_TRANSCRIPT_CHARS = 24_000;
const CLI_TIMEOUT_MS = 90_000;
// Capture far more of the conversation than the default handoff capsule (8 turns).
const CAPSULE_TURN_BUDGET = 60;
const CAPSULE_PER_TURN_TEXT_BUDGET = 1600;

export interface CompactSessionResult {
  /** The generated handoff prompt, ready to paste into a fresh session. */
  prompt: string;
  /** Which engine produced it: 'ai' (CLI summary) or 'heuristic' (fallback). */
  source: 'ai' | 'heuristic';
}

export class CompactSessionService {
  private log: (msg: string) => void = () => {};

  constructor(
    private readonly contextBuilder: HandoffContextBuilder,
    private readonly promptComposer: HandoffPromptComposer,
    logger?: (msg: string) => void,
  ) {
    if (logger) {
      this.log = logger;
    }
  }

  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
  }

  /**
   * Produce the compact handoff prompt for a source session snapshot.
   * Never rejects: always resolves with a usable prompt (AI or heuristic).
   */
  async build(snapshot: HandoffSourceSnapshot, opts?: { claudeConfigDir?: string }): Promise<CompactSessionResult> {
    // Structured capsule doubles as grounding for the AI prompt and as the
    // deterministic fallback if the CLI summary fails.
    const capsule = this.contextBuilder.buildCapsule({
      source: snapshot,
      targetProvider: snapshot.provider,
      turnBudget: CAPSULE_TURN_BUDGET,
      perTurnTextBudget: CAPSULE_PER_TURN_TEXT_BUDGET,
    });
    const heuristicPrompt = this.promptComposer.compose(capsule);

    const transcript = this.buildTranscript(snapshot.messages);
    if (!transcript) {
      this.log('[CompactSession] Transcript empty - using heuristic capsule prompt');
      return { prompt: heuristicPrompt, source: 'heuristic' };
    }

    const instruction = this.buildInstruction(snapshot, capsule, transcript);
    const aiPrompt = await this.runCli(instruction, opts?.claudeConfigDir);
    if (aiPrompt) {
      this.log(`[CompactSession] AI summary produced (${aiPrompt.length} chars)`);
      return { prompt: aiPrompt, source: 'ai' };
    }

    this.log('[CompactSession] AI summary unavailable - falling back to heuristic capsule prompt');
    return { prompt: heuristicPrompt, source: 'heuristic' };
  }

  // ---------- Transcript ----------

  private buildTranscript(messages: SerializedChatMessage[]): string {
    const source = Array.isArray(messages) ? messages : [];
    const lines: string[] = [];
    for (const msg of source) {
      const text = this.extractPlainText(msg);
      if (!text) {
        continue;
      }
      const speaker = msg.role === 'user' ? 'USER' : 'ASSISTANT';
      lines.push(`${speaker}: ${text}`);
    }
    if (lines.length === 0) {
      return '';
    }
    return this.truncatePreservingHeadAndTail(lines.join('\n\n'));
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
    for (const block of content as Array<{ type?: string; text?: string; name?: string }>) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text);
      } else if (block?.type === 'tool_use') {
        // Tool names carry meaningful signal (which files/commands were touched)
        // without dragging in the full tool payload.
        parts.push(`[used tool: ${typeof block.name === 'string' ? block.name : 'tool'}]`);
      }
    }
    return parts.join('\n').trim();
  }

  /** Keep the opening of the session (goal) and the tail (current state). */
  private truncatePreservingHeadAndTail(transcript: string): string {
    if (transcript.length <= MAX_TRANSCRIPT_CHARS) {
      return transcript;
    }
    // The tail (recent work / current state) matters most, so weight it heavier.
    const headSize = Math.floor(MAX_TRANSCRIPT_CHARS * 0.35);
    const tailSize = MAX_TRANSCRIPT_CHARS - headSize - 24;
    const head = transcript.slice(0, headSize);
    const tail = transcript.slice(transcript.length - tailSize);
    return `${head}\n\n...[middle of the conversation truncated to save space]...\n\n${tail}`;
  }

  // ---------- Instruction prompt ----------

  private buildInstruction(
    snapshot: HandoffSourceSnapshot,
    capsule: HandoffCapsule,
    transcript: string,
  ): string {
    const groundingLines: string[] = [];
    if (capsule.workspace.cwd) {
      groundingLines.push(`Working directory: ${capsule.workspace.cwd}`);
    }
    if (capsule.workspace.branch) {
      groundingLines.push(`Git branch: ${capsule.workspace.branch}`);
    }
    if (snapshot.model) {
      groundingLines.push(`Model used: ${snapshot.model}`);
    }
    if (capsule.touchedFiles.length > 0) {
      groundingLines.push(`Files referenced: ${capsule.touchedFiles.join(', ')}`);
    }
    if (capsule.task.blockers.length > 0) {
      groundingLines.push(`Possible blockers detected: ${capsule.task.blockers.join(' | ')}`);
    }
    const grounding = groundingLines.length > 0 ? groundingLines.join('\n') : '(none extracted)';

    return [
      'You are preparing a HANDOFF PROMPT that will be pasted as the FIRST message into a brand-new coding-assistant session.',
      'The new session will NOT have access to this conversation. Your job is to preserve ALL information needed to continue the work seamlessly, while being far more compact than the raw transcript (the whole point is to save tokens).',
      '',
      'Write the handoff prompt as if the user is briefing a fresh assistant. Be specific, concrete, and complete. Organize it into these clearly-labelled sections:',
      '1. Objective - what we are ultimately trying to achieve.',
      '2. Progress so far - what has already been done, tried, and what worked or failed.',
      '3. Current state - exactly where things stand right now.',
      '4. Key decisions and rationale - important choices made and why.',
      '5. Environment and files - working directory, repo/branch, and the specific files created or modified (exact paths).',
      '6. Open problems / blockers - anything unresolved.',
      '7. Next steps - the concrete actions the new session should take next.',
      '',
      'Rules:',
      '- Preserve concrete details: exact file paths, function/command/identifier names, error messages, and decisions. Do NOT invent anything that is not supported by the material below.',
      '- Be concise but COMPLETE: drop chit-chat and repetitive tool noise, keep everything that matters for continuation.',
      '- Write in the SAME LANGUAGE the user used in the conversation.',
      '- Output ONLY the handoff prompt text itself. No preamble, no meta commentary, and do NOT wrap the whole answer in a markdown code fence.',
      '',
      '--- Structured context (auto-extracted signals) ---',
      grounding,
      '',
      '--- Conversation transcript (may be truncated in the middle) ---',
      transcript,
    ].join('\n');
  }

  // ---------- CLI call ----------

  private resolveModel(): string {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const dedicated = config.get<string>('compactSession.model', '').trim();
    if (dedicated) {
      return dedicated;
    }
    return config.get<string>('analysisModel', 'claude-haiku-4-5-20251001');
  }

  private runCli(prompt: string, claudeConfigDir?: string): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const config = vscode.workspace.getConfiguration('claudeMirror');
      const cliPath = config.get<string>('cliPath', 'claude');
      const model = this.resolveModel();
      const args = ['-p', '--model', model];
      const env = buildClaudeCliEnv();
      if (claudeConfigDir?.trim()) {
        env.CLAUDE_CONFIG_DIR = claudeConfigDir;
      }

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
        this.log(`[CompactSession] spawn pid=${child.pid ?? '?'} model=${model} promptLen=${prompt.length}`);
      } catch (err) {
        this.log(`[CompactSession] spawn threw: ${err}`);
        finish(null);
        return;
      }

      const timer = setTimeout(() => {
        const partial = stdout ? this.sanitize(stdout) : null;
        this.log(`[CompactSession] timeout (${CLI_TIMEOUT_MS}ms), partialLen=${partial?.length ?? 0}`);
        killProcessTree(child);
        finish(partial);
      }, CLI_TIMEOUT_MS);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        this.log(`[CompactSession] stderr: ${chunk.toString('utf-8').trim()}`);
      });
      child.on('error', (err) => {
        this.log(`[CompactSession] error: ${err.message}`);
        finish(null);
      });
      child.on('exit', (code) => {
        this.log(`[CompactSession] exit code=${code}`);
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

  // ---------- Sanitize ----------

  private sanitize(raw: string): string | null {
    let cleaned = raw.trim();
    if (!cleaned) {
      return null;
    }
    // Strip a single wrapping markdown code fence if the model added one anyway.
    const fenceMatch = cleaned.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
    if (fenceMatch) {
      cleaned = fenceMatch[1].trim();
    }
    return cleaned || null;
  }
}
