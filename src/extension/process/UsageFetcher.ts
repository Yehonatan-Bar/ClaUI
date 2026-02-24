import { spawn } from 'child_process';
import type { UsageStat } from '../types/webview-messages';

export interface UsageFetchResult {
  stats: UsageStat[];
  fetchedAt: number;
  error?: string;
}

/**
 * Runs a short-lived `claude` subprocess in interactive mode, pipes "/usage"
 * to stdin (then closes it), and parses the plain-text output into structured
 * UsageStat records.
 *
 * Why interactive (no -p): `claude -p "/usage"` would send "/usage" as an AI
 * prompt over the network (slow, requires API). The slash command `/usage` is
 * handled locally by the CLI only in interactive/stdin mode.
 *
 * Each section in the output looks like:
 *   Current session
 *   ███████████████████████▌                           47% used
 *   Resets 1pm (Asia/Jerusalem)
 *
 * Sections are separated by blank lines.
 */
export class UsageFetcher {
  constructor(
    private readonly cliPath: string,
    private readonly apiKey: string | undefined
  ) {}

  async fetch(): Promise<UsageFetchResult> {
    return new Promise((resolve) => {
      const env: NodeJS.ProcessEnv = { ...process.env };
      if (this.apiKey) {
        env.ANTHROPIC_API_KEY = this.apiKey;
      }

      let output = '';
      let errorOutput = '';
      let settled = false;

      // Run in interactive mode (no -p flag) so /usage is processed as a
      // slash command rather than forwarded to the AI as a network prompt.
      const child = spawn(this.cliPath, [], {
        env,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Write the slash command then close stdin so the CLI exits cleanly.
      child.stdin.write('/usage\n');
      child.stdin.end();

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill();
          resolve({ stats: [], fetchedAt: Date.now(), error: 'Usage fetch timed out after 10s' });
        }
      }, 10000);

      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });

      child.stderr.on('data', (chunk: Buffer) => {
        errorOutput += chunk.toString();
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);

        const stats = this.parse(output);
        if (stats.length === 0) {
          const hint = errorOutput.trim() || output.trim() || `exit code ${code}`;
          resolve({
            stats: [],
            fetchedAt: Date.now(),
            error: `Could not parse usage data (${hint.slice(0, 120)})`,
          });
        } else {
          resolve({ stats, fetchedAt: Date.now() });
        }
      });

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ stats: [], fetchedAt: Date.now(), error: err.message });
      });
    });
  }

  /** Parse plain-text /usage output into UsageStat[]. Returns [] on failure. */
  private parse(text: string): UsageStat[] {
    const stats: UsageStat[] = [];

    // Split on one or more blank lines to get individual sections
    const sections = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);

    for (const section of sections) {
      const lines = section.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) continue;

      const label = lines[0];
      const percentLine = lines.find((l) => l.includes('% used'));
      const resetsLine = lines.find((l) => l.toLowerCase().startsWith('resets'));

      if (!percentLine) continue;

      const match = percentLine.match(/(\d+)%\s*used/);
      if (!match) continue;

      const percentage = parseInt(match[1], 10);
      const resetsAt = resetsLine ? resetsLine.replace(/^Resets\s+/i, '').trim() : '';

      stats.push({ label, percentage, resetsAt });
    }

    return stats;
  }
}
