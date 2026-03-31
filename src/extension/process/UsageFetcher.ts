import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import * as https from 'https';
import type { UsageStat } from '../types/webview-messages';

export interface UsageFetchResult {
  stats: UsageStat[];
  fetchedAt: number;
  error?: string;
  /** Raw API response dump for diagnostics (temporary — remove after investigation) */
  rawDiagnostic?: string;
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
  [key: string]: unknown;
}

/**
 * Known period prefixes in longest-first order to avoid partial matches.
 * The key is the API response field prefix; label is the human-readable period name.
 */
const PERIOD_PREFIXES: Array<{ key: string; label: string }> = [
  { key: 'sixty_day',     label: '2 Months' },
  { key: 'thirty_day',    label: '30 Days' },
  { key: 'fourteen_day',  label: '14 Days' },
  { key: 'seven_day',     label: '7 Days' },
  { key: 'one_day',       label: '24 Hours' },
  { key: 'five_hour',     label: '5 Hours' },
];

/** Map from model suffix (after period prefix) to human-readable model name */
const MODEL_LABELS: Record<string, string> = {
  opus:       'Opus',
  sonnet:     'Sonnet',
  haiku:      'Haiku',
  oauth_apps: 'OAuth Apps',
  cowork:     'CoWork',
};

/**
 * Parse an API response key into its period and model components.
 * Returns null if the key doesn't match any known period prefix.
 */
function parseApiKey(key: string): { period: string; modelLabel: string } | null {
  for (const { key: prefix, label: periodLabel } of PERIOD_PREFIXES) {
    if (key === prefix) {
      return { period: periodLabel, modelLabel: 'All Models' };
    }
    if (key.startsWith(prefix + '_')) {
      const suffix = key.slice(prefix.length + 1);
      const modelLabel = MODEL_LABELS[suffix] ?? suffix;
      return { period: periodLabel, modelLabel };
    }
  }
  return null;
}

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

      // One-time diagnostic: capture raw API response for logging.
      // Remove this block after investigation is complete.
      let rawDiagnostic: string | undefined;
      try {
        rawDiagnostic = JSON.stringify(data, null, 2);
      } catch { /* diagnostic only */ }

      const stats = this.parseResponse(data);
      if (stats.length === 0) {
        return { stats: [], fetchedAt: Date.now(), error: 'No usage data returned by API.', rawDiagnostic };
      }
      return { stats, fetchedAt: Date.now(), rawDiagnostic };
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

  /** Map raw API response fields to UsageStat[], parsing all known period/model keys */
  private parseResponse(data: UsageApiResponse): UsageStat[] {
    const stats: UsageStat[] = [];

    for (const [key, value] of Object.entries(data)) {
      const parsed = parseApiKey(key);
      if (!parsed) continue;

      const entry = value as UsageEntry | null | undefined;
      if (!entry || typeof entry.utilization !== 'number') continue;

      const { period, modelLabel } = parsed;
      stats.push({
        label: modelLabel,
        period,
        modelLabel,
        bucketKey: key,
        percentage: Math.round(entry.utilization),
        resetsAt: entry.resets_at ? formatResetsAt(entry.resets_at) : '',
      });
    }

    return stats;
  }
}
