import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import type { TurnSemantics } from '../types/webview-messages';

export interface TurnAnalysisInput {
  messageId: string;
  userMessage: string;
  toolNames: string[];
  bashCommands: string[];
  isError: boolean;
  recentUserMessages: string[];
}

/**
 * After each turn completes, spawns a one-shot Claude CLI process (using the
 * configured analysis model) to infer semantic signals from the conversation context.
 * Results arrive via an async callback; MessageHandler forwards them to the webview.
 */
export class TurnAnalyzer {
  private log: (msg: string) => void = () => {};
  private timeoutMs = 30_000;
  private inFlight = false;
  private queue: TurnAnalysisInput[] = [];
  private maxQueueSize = 20;
  private analysesCompleted = 0;
  private maxPerSession = 30;
  private callback: ((messageId: string, semantics: TurnSemantics) => void) | null = null;

  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
  }

  onAnalysisComplete(cb: (messageId: string, semantics: TurnSemantics) => void): void {
    this.callback = cb;
  }

  async analyze(input: TurnAnalysisInput): Promise<void> {
    // Check if semantic analysis is enabled
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const enabled = config.get<boolean>('turnAnalysis.enabled', true);
    if (!enabled) {
      return;
    }

    // Skip empty user messages
    if (!input.userMessage || input.userMessage.trim().length < 5) {
      this.log('[TurnAnalyzer] Skipping: user message too short');
      return;
    }

    // Read per-session caps
    this.maxPerSession = config.get<number>('turnAnalysis.maxPerSession', 30);
    this.timeoutMs = config.get<number>('turnAnalysis.timeoutMs', 30_000);

    if (this.analysesCompleted >= this.maxPerSession) {
      this.log(`[TurnAnalyzer] Per-session cap reached (${this.maxPerSession}), skipping`);
      return;
    }

    if (this.inFlight) {
      // Queue up; drop oldest if full
      if (this.queue.length >= this.maxQueueSize) {
        const dropped = this.queue.shift();
        this.log(`[TurnAnalyzer] Queue full, dropping oldest (messageId=${dropped?.messageId})`);
      }
      this.queue.push(input);
      this.log(`[TurnAnalyzer] Queued (${this.queue.length} pending)`);
      return;
    }

    await this.runAnalysis(input);
  }

  reset(): void {
    this.analysesCompleted = 0;
    this.queue = [];
    this.inFlight = false;
  }

  private async runAnalysis(input: TurnAnalysisInput): Promise<void> {
    this.inFlight = true;
    try {
      const result = await this.spawnAnalysis(input);
      if (result && this.callback) {
        this.callback(input.messageId, result);
      }
      this.analysesCompleted++;
    } catch (err) {
      this.log(`[TurnAnalyzer] Analysis error: ${err}`);
    } finally {
      this.inFlight = false;
      // Process next in queue
      if (this.queue.length > 0) {
        const next = this.queue.shift()!;
        this.log(`[TurnAnalyzer] Processing next from queue (${this.queue.length} remaining)`);
        void this.runAnalysis(next);
      }
    }
  }

  private spawnAnalysis(input: TurnAnalysisInput): Promise<TurnSemantics | null> {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const cliPath = config.get<string>('cliPath', 'claude');
    const analysisModel = config.get<string>('analysisModel', 'claude-haiku-4-5-20251001');

    const toolList = input.toolNames.length > 0 ? input.toolNames.join(', ') : 'none';
    const cmdList = input.bashCommands.length > 0 ? input.bashCommands.join('\n') : 'none';
    const recentMsgs = input.recentUserMessages.map(m => `- ${m}`).join('\n');

    const prompt =
      'You are analyzing a single turn in a software development conversation between a developer and Claude Code (an AI coding assistant).\n\n' +
      `CURRENT TURN:\nUser message: "${input.userMessage}"\n` +
      `Tools Claude used: ${toolList}\n` +
      `Commands Claude ran: ${cmdList}\n` +
      `Turn ended in error: ${input.isError}\n\n` +
      `RECENT PRIOR USER MESSAGES (oldest first):\n${recentMsgs || '(none)'}\n\n` +
      'TASK:\nAnalyze the CURRENT TURN and return a JSON object. Respond with ONLY valid JSON - no markdown fences, no explanation, nothing else.\n\n' +
      'FIELD DEFINITIONS:\n\n' +
      'userMood - The developer\'s inferred emotional state:\n' +
      '  "frustrated" = complaints, "still broken", repeated requests, impatience\n' +
      '  "satisfied" = "thanks", "perfect", "it works", approval\n' +
      '  "confused" = "I don\'t understand", unclear requests\n' +
      '  "excited" = enthusiasm, "amazing", positive breakthrough\n' +
      '  "urgent" = deadlines, "ASAP", production issues\n' +
      '  "neutral" = factual, matter-of-fact request\n\n' +
      'taskOutcome - Did the stated task appear to be resolved:\n' +
      '  "success" = task clearly completed\n' +
      '  "partial" = some progress but incomplete\n' +
      '  "failed" = unable to complete, error or blocker\n' +
      '  "in-progress" = multi-step workflow mid-flow\n' +
      '  "unknown" = not determinable\n\n' +
      'taskType - Nature of the work:\n' +
      '  "bug-fix" | "feature-small" | "feature-large" | "exploration" | "refactor" | "new-app" | "planning" | "code-review" | "debugging" | "testing" | "documentation" | "devops" | "question" | "configuration" | "unknown"\n\n' +
      'bugRepeat - Is this a repeated mention of the same bug:\n' +
      '  "none" = not a bug report\n' +
      '  "first" = first mention\n' +
      '  "second" = same bug mentioned again\n' +
      '  "third-plus" = 3+ mentions\n\n' +
      'confidence - Your confidence (0.0 to 1.0)\n\n' +
      'RETURN EXACTLY THIS JSON STRUCTURE:\n' +
      '{"userMood":"...","taskOutcome":"...","taskType":"...","bugRepeat":"...","confidence":0.0}';

    const args = ['-p', '--model', analysisModel];

    // Clean environment to prevent nested-session detection
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    this.log(`[TurnAnalyzer] Spawning analysis for messageId=${input.messageId}`);

    return new Promise<TurnSemantics | null>((resolve) => {
      let stdout = '';
      let settled = false;

      const finish = (result: TurnSemantics | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      let child: ChildProcess;
      try {
        child = spawn(cliPath, args, {
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true,
        });
      } catch (err) {
        this.log(`[TurnAnalyzer] spawn() threw: ${err}`);
        finish(null);
        return;
      }

      const timer = setTimeout(() => {
        this.log(`[TurnAnalyzer] timeout (${this.timeoutMs}ms), killing process`);
        child.kill('SIGTERM');
        finish(null);
      }, this.timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        this.log(`[TurnAnalyzer] stderr: ${chunk.toString('utf-8').trim()}`);
      });

      child.on('error', (err) => {
        this.log(`[TurnAnalyzer] spawn error: ${err.message}`);
        finish(null);
      });

      child.on('exit', (code) => {
        if (code !== 0) {
          this.log(`[TurnAnalyzer] exited with code ${code}`);
          finish(null);
          return;
        }
        const parsed = this.parseResponse(stdout);
        if (parsed) {
          this.log(`[TurnAnalyzer] Success: mood=${parsed.userMood} outcome=${parsed.taskOutcome} type=${parsed.taskType}`);
        } else {
          this.log(`[TurnAnalyzer] Failed to parse response: ${stdout.slice(0, 200)}`);
        }
        finish(parsed);
      });

      child.stdin?.write(prompt);
      child.stdin?.end();
    });
  }

  private parseResponse(raw: string): TurnSemantics | null {
    const cleaned = raw.trim().replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
    try {
      const obj = JSON.parse(cleaned);
      const validMoods = ['frustrated', 'satisfied', 'confused', 'excited', 'neutral', 'urgent'];
      const validOutcomes = ['success', 'partial', 'failed', 'in-progress', 'unknown'];
      const validTypes = [
        'bug-fix', 'feature-small', 'feature-large', 'exploration', 'refactor',
        'new-app', 'planning', 'code-review', 'debugging', 'testing',
        'documentation', 'devops', 'question', 'configuration', 'unknown',
      ];
      const validRepeats = ['none', 'first', 'second', 'third-plus'];

      if (!validMoods.includes(obj.userMood)) return null;
      if (!validOutcomes.includes(obj.taskOutcome)) return null;
      if (!validTypes.includes(obj.taskType)) return null;
      if (!validRepeats.includes(obj.bugRepeat)) return null;
      if (typeof obj.confidence !== 'number') return null;

      return {
        userMood: obj.userMood,
        taskOutcome: obj.taskOutcome,
        taskType: obj.taskType,
        bugRepeat: obj.bugRepeat,
        confidence: Math.max(0, Math.min(1, obj.confidence)),
      };
    } catch {
      return null;
    }
  }
}
