import * as vscode from 'vscode';
import { spawn, type ChildProcess } from 'child_process';
import type { SessionSnapshot } from './AchievementEngine';

export interface InsightResult {
  sessionQuality: 'exceptional' | 'productive' | 'steady' | 'exploratory' | 'struggling';
  insight: string;
  codingPattern: 'deep-dive' | 'breadth-first' | 'iterative' | 'planning-heavy' | 'test-driven';
  xpBonus: number;
}

const INSIGHT_DATE_KEY = 'claudeMirror.achievements.lastInsightDate';
const MODEL = 'claude-sonnet-4-6';
const TIMEOUT_MS = 45_000;

/**
 * Spawns a one-shot Claude CLI process (Sonnet) at session end to provide
 * deeper session analysis. Rate-limited to once per calendar day.
 */
export class AchievementInsightAnalyzer {
  private log: (msg: string) => void = () => {};
  private lastAnalysisDate: string;

  constructor(private readonly globalState: vscode.Memento) {
    this.lastAnalysisDate = globalState.get<string>(INSIGHT_DATE_KEY, '');
  }

  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
  }

  async analyzeSession(input: SessionSnapshot): Promise<InsightResult | null> {
    const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local time
    if (this.lastAnalysisDate === today) {
      this.log('[InsightAnalyzer] Already ran today, skipping');
      return null;
    }

    // Skip very short sessions (under 2 minutes)
    if (input.sessionDurationMs < 2 * 60 * 1000) {
      this.log('[InsightAnalyzer] Session too short, skipping');
      return null;
    }

    try {
      const result = await this.spawnAnalysis(input);
      if (result) {
        this.lastAnalysisDate = today;
        await this.globalState.update(INSIGHT_DATE_KEY, today);
        this.log(`[InsightAnalyzer] Success: quality=${result.sessionQuality} pattern=${result.codingPattern}`);
      }
      return result;
    } catch (err) {
      this.log(`[InsightAnalyzer] Error: ${err}`);
      return null;
    }
  }

  private spawnAnalysis(input: SessionSnapshot): Promise<InsightResult | null> {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const cliPath = config.get<string>('cliPath', 'claude');

    const durationMin = Math.round(input.sessionDurationMs / 60_000);
    const fileList = input.filesTouched.length > 0
      ? input.filesTouched.slice(0, 20).join(', ')
      : 'none tracked';
    const langList = input.languages.length > 0
      ? input.languages.join(', ')
      : 'none detected';

    const prompt =
      'You are analyzing a completed coding session between a developer and Claude Code (AI coding assistant).\n\n' +
      'SESSION METRICS:\n' +
      `- Duration: ${durationMin} minutes\n` +
      `- Files touched: ${input.filesTouched.length} (${fileList})\n` +
      `- Languages: ${langList}\n` +
      `- Bug fixes: ${input.bugsFixed}\n` +
      `- Tests passed: ${input.testsPassed}\n` +
      `- Errors encountered: ${input.errorCount}\n` +
      `- Meaningful edits: ${input.editCount}\n` +
      `- Cancellations: ${input.cancelCount}\n\n` +
      'TASK:\n' +
      'Analyze the session and return a JSON object. Respond with ONLY valid JSON - no markdown fences, no explanation.\n\n' +
      'FIELDS:\n\n' +
      'sessionQuality - Overall assessment:\n' +
      '  "exceptional" = high output, many fixes/tests, complex work\n' +
      '  "productive" = good steady progress, solid output\n' +
      '  "steady" = consistent work, moderate output\n' +
      '  "exploratory" = research/investigation heavy, fewer concrete results\n' +
      '  "struggling" = many errors, cancellations, low completion\n\n' +
      'insight - A 1-2 sentence observation about the session. Be specific and constructive. ' +
      'Mention actual patterns you notice (e.g. "Focused deep-dive into 3 TypeScript files with clean test coverage" or ' +
      '"Broad exploration across 12 files suggests an architecture review session"). Keep it encouraging.\n\n' +
      'codingPattern - Primary work pattern:\n' +
      '  "deep-dive" = focused on few files, many edits per file\n' +
      '  "breadth-first" = touched many files, fewer edits each\n' +
      '  "iterative" = edit-test-fix cycles\n' +
      '  "planning-heavy" = more reading/exploration than editing\n' +
      '  "test-driven" = tests prominent in the workflow\n\n' +
      'xpBonus - Bonus XP (0-25) based on session quality:\n' +
      '  exceptional=20-25, productive=12-18, steady=5-10, exploratory=3-8, struggling=0-5\n\n' +
      'RETURN EXACTLY:\n' +
      '{"sessionQuality":"...","insight":"...","codingPattern":"...","xpBonus":0}';

    const args = ['-p', '--model', MODEL];
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    this.log(`[InsightAnalyzer] Spawning Sonnet analysis (${durationMin}min session, ${input.filesTouched.length} files)`);

    return new Promise<InsightResult | null>((resolve) => {
      let stdout = '';
      let settled = false;

      const finish = (result: InsightResult | null) => {
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
        this.log(`[InsightAnalyzer] spawn() threw: ${err}`);
        finish(null);
        return;
      }

      const timer = setTimeout(() => {
        this.log(`[InsightAnalyzer] timeout (${TIMEOUT_MS}ms), killing process`);
        child.kill('SIGTERM');
        finish(null);
      }, TIMEOUT_MS);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        this.log(`[InsightAnalyzer] stderr: ${chunk.toString('utf-8').trim()}`);
      });

      child.on('error', (err) => {
        this.log(`[InsightAnalyzer] spawn error: ${err.message}`);
        finish(null);
      });

      child.on('exit', (code) => {
        if (code !== 0) {
          this.log(`[InsightAnalyzer] exited with code ${code}`);
          finish(null);
          return;
        }
        const parsed = this.parseResponse(stdout);
        if (!parsed) {
          this.log(`[InsightAnalyzer] Failed to parse: ${stdout.slice(0, 200)}`);
        }
        finish(parsed);
      });

      child.stdin?.write(prompt);
      child.stdin?.end();
    });
  }

  private parseResponse(raw: string): InsightResult | null {
    const cleaned = raw.trim().replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
    try {
      const obj = JSON.parse(cleaned);
      const validQualities = ['exceptional', 'productive', 'steady', 'exploratory', 'struggling'];
      const validPatterns = ['deep-dive', 'breadth-first', 'iterative', 'planning-heavy', 'test-driven'];

      if (!validQualities.includes(obj.sessionQuality)) return null;
      if (typeof obj.insight !== 'string' || obj.insight.length === 0) return null;
      if (!validPatterns.includes(obj.codingPattern)) return null;
      if (typeof obj.xpBonus !== 'number') return null;

      return {
        sessionQuality: obj.sessionQuality,
        insight: obj.insight.slice(0, 300), // Cap insight length
        codingPattern: obj.codingPattern,
        xpBonus: Math.max(0, Math.min(25, Math.round(obj.xpBonus))),
      };
    } catch {
      return null;
    }
  }
}
