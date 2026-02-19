import * as vscode from 'vscode';
import { spawn } from 'child_process';

export interface ActivitySummary {
  /** Short label for the tab title (3-6 words) */
  shortLabel: string;
  /** Longer description for tooltip/status bar (1-2 sentences) */
  fullSummary: string;
}

/**
 * Periodically summarizes Claude's tool activity via Haiku.
 * Accumulates enriched tool names (e.g., "Read (src/auth.ts)") and,
 * after reaching a threshold, calls Haiku for a short summary.
 */
export class ActivitySummarizer {
  private log: (msg: string) => void = () => {};

  /** Tool uses accumulated since last summary */
  private toolUsesSinceSummary: string[] = [];

  /** Debounce timer to batch rapid tool uses */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Minimum tool uses before triggering a summary */
  private threshold: number;

  /** Debounce delay in ms after reaching threshold */
  private debounceMs: number;

  /** Whether a Haiku call is currently in-flight */
  private inFlight = false;

  /** The latest summary (for status bar access) */
  private latestSummary: ActivitySummary | null = null;

  /** Callback when a new summary is generated */
  private summaryCallback: ((summary: ActivitySummary) => void) | null = null;

  constructor(options?: { threshold?: number; debounceMs?: number }) {
    this.threshold = options?.threshold ?? 3;
    this.debounceMs = options?.debounceMs ?? 2000;
  }

  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
  }

  onSummaryGenerated(callback: (summary: ActivitySummary) => void): void {
    this.summaryCallback = callback;
  }

  get currentSummary(): ActivitySummary | null {
    return this.latestSummary;
  }

  /** Called by MessageHandler on every completed tool use (blockStop) */
  recordToolUse(enrichedToolName: string): void {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const enabled = config.get<boolean>('activitySummary', true);
    if (!enabled) {
      return;
    }

    this.toolUsesSinceSummary.push(enrichedToolName);
    this.log(`[ActivitySummarizer] Recorded: ${enrichedToolName} (${this.toolUsesSinceSummary.length} since last summary)`);

    if (this.toolUsesSinceSummary.length >= this.threshold && !this.inFlight) {
      this.scheduleSummary();
    }
  }

  /** Reset on session clear/restart */
  reset(): void {
    this.toolUsesSinceSummary = [];
    this.latestSummary = null;
    this.inFlight = false;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private scheduleSummary(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.generateSummary();
    }, this.debounceMs);
  }

  private async generateSummary(): Promise<void> {
    if (this.inFlight) {
      return;
    }

    const toolsToSummarize = [...this.toolUsesSinceSummary];
    this.toolUsesSinceSummary = [];

    if (toolsToSummarize.length === 0) {
      return;
    }

    this.inFlight = true;
    this.log(`[ActivitySummarizer] Generating summary for ${toolsToSummarize.length} tools: ${toolsToSummarize.join(', ')}`);

    try {
      const summary = await this.callHaiku(toolsToSummarize);
      if (summary) {
        this.latestSummary = summary;
        this.log(`[ActivitySummarizer] Summary: "${summary.shortLabel}" | "${summary.fullSummary}"`);
        this.summaryCallback?.(summary);
      } else {
        this.log(`[ActivitySummarizer] Haiku returned no valid summary`);
      }
    } catch (err) {
      this.log(`[ActivitySummarizer] Error: ${err}`);
    } finally {
      this.inFlight = false;
    }
  }

  private async callHaiku(toolNames: string[]): Promise<ActivitySummary | null> {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const cliPath = config.get<string>('cliPath', 'claude');

    const toolList = toolNames.map(t => `- ${t}`).join('\n');
    const prompt =
      'You are describing what a developer\'s AI coding assistant (Claude Code) is currently doing, based on the tools it just used.\n\n' +
      'Tools used (most recent last):\n' +
      toolList + '\n\n' +
      'INSTRUCTIONS:\n' +
      '- Be SPECIFIC about WHICH files, functions, or components are being worked on.\n' +
      '- Mention actual file names, folder names, or component names from the tool arguments.\n' +
      '- NEVER use vague phrases like "reading files", "reviewing code", "exploring the project", "reading documentation", or "understanding the codebase".\n' +
      '- Instead, say what EXACTLY is being read/edited/searched and WHY (infer the purpose from the file names).\n' +
      '- Examples of GOOD output:\n' +
      '  "Analyzing webpack config" / "Claude is checking the webpack build configuration for bundling issues."\n' +
      '  "Editing auth middleware" / "Claude is modifying the authentication middleware in src/auth.ts."\n' +
      '  "Searching for API routes" / "Claude is looking for route definitions across the Express router files."\n' +
      '- Examples of BAD output (too generic):\n' +
      '  "Reading project files" / "Claude is reviewing multiple files to understand the project."\n' +
      '  "Exploring codebase" / "Claude is reading documentation and code files."\n\n' +
      'Respond with EXACTLY two lines:\n' +
      'Line 1: Short specific activity label (3-6 words)\n' +
      'Line 2: One sentence describing specifically what Claude is doing and which files/components are involved\n\n' +
      'Match the language of any file paths or context. Reply with ONLY the two lines.';

    const args = ['-p', '--model', 'claude-haiku-4-5-20251001'];

    // Clean environment to prevent nested-session detection
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    this.log(`[ActivitySummarizer] Spawning Haiku with ${toolNames.length} tools`);

    return new Promise<ActivitySummary | null>((resolve) => {
      let stdout = '';
      let settled = false;

      const finish = (result: ActivitySummary | null) => {
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
      } catch (err) {
        this.log(`[ActivitySummarizer] spawn() threw: ${err}`);
        finish(null);
        return;
      }

      // 10-second timeout
      const timer = setTimeout(() => {
        this.log('[ActivitySummarizer] timeout (10s), killing process');
        child.kill('SIGTERM');
        finish(null);
      }, 10_000);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        this.log(`[ActivitySummarizer] stderr: ${chunk.toString('utf-8').trim()}`);
      });

      child.on('error', (err) => {
        this.log(`[ActivitySummarizer] spawn error: ${err.message}`);
        finish(null);
      });

      child.on('exit', (code) => {
        if (code !== 0) {
          this.log(`[ActivitySummarizer] exited with code ${code}`);
          finish(null);
          return;
        }
        const parsed = this.parseSummaryResponse(stdout);
        finish(parsed);
      });

      // Pipe prompt via stdin
      child.stdin?.write(prompt);
      child.stdin?.end();
    });
  }

  /** Parse Haiku's 2-line response into an ActivitySummary */
  private parseSummaryResponse(raw: string): ActivitySummary | null {
    const lines = raw.trim().split('\n').filter(l => l.trim());
    if (lines.length < 1) {
      return null;
    }

    let shortLabel = lines[0].trim();
    let fullSummary = lines.length >= 2 ? lines[1].trim() : shortLabel;

    // Strip surrounding quotes
    shortLabel = shortLabel.replace(/^["']|["']$/g, '').trim();
    fullSummary = fullSummary.replace(/^["']|["']$/g, '').trim();

    // Strip leading/trailing punctuation
    shortLabel = shortLabel.replace(/^[.,!?:;\-]+|[.,!?:;\-]+$/g, '').trim();

    // Reject empty or too long
    if (!shortLabel || shortLabel.length > 50) {
      return null;
    }

    // Reject too many words (>8)
    if (shortLabel.split(/\s+/).length > 8) {
      return null;
    }

    // Truncate full summary if needed
    if (fullSummary.length > 200) {
      fullSummary = fullSummary.slice(0, 197) + '...';
    }

    return { shortLabel, fullSummary };
  }
}
