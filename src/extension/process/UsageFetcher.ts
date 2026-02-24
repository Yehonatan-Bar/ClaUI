import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import * as https from 'https';
import type { UsageStat } from '../types/webview-messages';

export interface UsageFetchResult {
  stats: UsageStat[];
  fetchedAt: number;
  error?: string;
}

interface OAuthCredentials {
  claudeAiOauth: {
    accessToken: string;
    expiresAt: number;
  };
}

interface UsageEntry {
  utilization: number;
  resets_at: string;
}

interface UsageApiResponse {
  five_hour?: UsageEntry | null;
  seven_day?: UsageEntry | null;
  seven_day_opus?: UsageEntry | null;
  seven_day_sonnet?: UsageEntry | null;
  seven_day_oauth_apps?: UsageEntry | null;
  seven_day_cowork?: UsageEntry | null;
  [key: string]: unknown;
}

/** Human-readable labels for each bucket key returned by the API */
const LABEL_MAP: Record<string, string> = {
  five_hour: 'Current session',
  seven_day: 'Current week (all models)',
  seven_day_opus: 'Current week (Opus only)',
  seven_day_sonnet: 'Current week (Sonnet only)',
  seven_day_oauth_apps: 'Current week (OAuth apps)',
  seven_day_cowork: 'Current week (CoWork)',
};

/**
 * Format an ISO datetime string into a compact reset-time label.
 * Same-day → "1pm", future dates → "Feb 26, 10am"
 */
function formatResetsAt(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();

  // Format hour (e.g., "1pm", "10am")
  const timeStr = date
    .toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: date.getMinutes() === 0 ? undefined : '2-digit',
      hour12: true,
    })
    .toLowerCase()
    .replace(' ', '');

  if (date.toDateString() === now.toDateString()) {
    return timeStr;
  }

  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${dateStr}, ${timeStr}`;
}

/**
 * Fetches Claude Code usage stats from the Anthropic OAuth usage API
 * (https://api.anthropic.com/api/oauth/usage) and parses them into UsageStat[].
 *
 * Uses the OAuth access token stored by the Claude Code CLI at
 * ~/.claude/.credentials.json — no subprocess required.
 */
export class UsageFetcher {
  // cliPath and apiKey are kept for interface compatibility but are unused —
  // this fetcher reads the OAuth token directly instead.
  constructor(
    private readonly cliPath: string,
    private readonly apiKey: string | undefined
  ) {}

  async fetch(): Promise<UsageFetchResult> {
    const accessToken = this.readAccessToken();
    if (!accessToken) {
      return {
        stats: [],
        fetchedAt: Date.now(),
        error: 'No OAuth credentials found. Usage data requires a Claude Max subscription.',
      };
    }

    try {
      const data = await this.callUsageApi(accessToken);
      const stats = this.parseResponse(data);
      if (stats.length === 0) {
        return { stats: [], fetchedAt: Date.now(), error: 'No usage data returned by API.' };
      }
      return { stats, fetchedAt: Date.now() };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { stats: [], fetchedAt: Date.now(), error: msg };
    }
  }

  /** Read the OAuth access token from ~/.claude/.credentials.json */
  private readAccessToken(): string | undefined {
    try {
      const credsPath = join(homedir(), '.claude', '.credentials.json');
      const raw = readFileSync(credsPath, 'utf8');
      const creds: OAuthCredentials = JSON.parse(raw);
      return creds.claudeAiOauth?.accessToken;
    } catch {
      return undefined;
    }
  }

  /** Call the Anthropic OAuth usage API endpoint */
  private callUsageApi(accessToken: string): Promise<UsageApiResponse> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'api.anthropic.com',
          path: '/api/oauth/usage',
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'claude-code/1.0.0',
            Authorization: `Bearer ${accessToken}`,
            'anthropic-beta': 'oauth-2025-04-20',
          },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk: Buffer) => (body += chunk.toString()));
          res.on('end', () => {
            if (res.statusCode !== 200) {
              reject(new Error(`API returned ${res.statusCode}: ${body.slice(0, 120)}`));
              return;
            }
            try {
              resolve(JSON.parse(body) as UsageApiResponse);
            } catch {
              reject(new Error('Failed to parse API response as JSON'));
            }
          });
        }
      );

      req.on('error', reject);
      req.setTimeout(10_000, () => {
        req.destroy();
        reject(new Error('Usage API request timed out after 10s'));
      });
      req.end();
    });
  }

  /** Map raw API response fields to UsageStat[] */
  private parseResponse(data: UsageApiResponse): UsageStat[] {
    const stats: UsageStat[] = [];

    for (const [key, label] of Object.entries(LABEL_MAP)) {
      const entry = data[key] as UsageEntry | null | undefined;
      if (!entry || typeof entry.utilization !== 'number') continue;

      stats.push({
        label,
        percentage: Math.round(entry.utilization),
        resetsAt: entry.resets_at ? formatResetsAt(entry.resets_at) : '',
      });
    }

    return stats;
  }
}
