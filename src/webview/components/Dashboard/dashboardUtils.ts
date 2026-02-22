import type { TurnRecord, TurnCategory } from '../../../extension/types/webview-messages';

// --- Color palette (dark theme, always) ---
export const DASH_COLORS = {
  bg: '#0d1117',
  cardBg: '#161b22',
  border: '#30363d',
  text: '#e6edf3',
  textMuted: '#8b949e',
  green: '#3fb950',
  blue: '#58a6ff',
  purple: '#bc8cff',
  amber: '#e3b341',
  red: '#f85149',
  orange: '#f0883e',
  teal: '#39d353',
} as const;

export const CATEGORY_COLORS: Record<TurnCategory, string> = {
  success: DASH_COLORS.green,
  discussion: DASH_COLORS.blue,
  'code-write': DASH_COLORS.purple,
  research: DASH_COLORS.amber,
  command: DASH_COLORS.teal,
  error: DASH_COLORS.red,
};

export const MOOD_COLORS: Record<string, string> = {
  frustrated: DASH_COLORS.red,
  satisfied: DASH_COLORS.green,
  confused: DASH_COLORS.amber,
  excited: DASH_COLORS.blue,
  urgent: DASH_COLORS.orange,
  neutral: DASH_COLORS.textMuted,
};

export const MOOD_LABELS: Record<string, string> = {
  frustrated: '!',
  satisfied: 'ok',
  confused: '?',
  excited: '++',
  urgent: '!!',
  neutral: '-',
};

// --- Command categorization ---
export type CommandCategory = 'git' | 'npm' | 'test' | 'build' | 'deploy' | 'search' | 'file' | 'other';

export const COMMAND_CATEGORY_COLORS: Record<CommandCategory, string> = {
  git: DASH_COLORS.orange,
  npm: DASH_COLORS.red,
  test: DASH_COLORS.green,
  build: DASH_COLORS.purple,
  deploy: DASH_COLORS.teal,
  search: DASH_COLORS.blue,
  file: DASH_COLORS.textMuted,
  other: '#484f58',
};

export function categorizeCommand(cmd: string): CommandCategory {
  const c = cmd.trim().toLowerCase();
  if (c.startsWith('git ')) return 'git';
  if (/^(npm|npx|yarn|pnpm) /.test(c)) return 'npm';
  if (/\b(jest|vitest|pytest|cargo test|go test|dotnet test|rspec)\b/.test(c)) return 'test';
  if (/\b(webpack|tsc|vite|rollup|esbuild|make|cargo build|go build)\b/.test(c)) return 'build';
  if (/^(docker|kubectl|ssh|rsync|scp|helm) /.test(c)) return 'deploy';
  if (/^(grep|rg|find|fd) /.test(c)) return 'search';
  if (/^(ls|cp|mv|rm|mkdir|cat|touch|chmod|chown) /.test(c)) return 'file';
  return 'other';
}

export interface CommandEntry {
  turnIndex: number;
  timestamp: number;
  command: string;
  category: CommandCategory;
}

export function flattenCommands(turnHistory: TurnRecord[]): CommandEntry[] {
  const entries: CommandEntry[] = [];
  turnHistory.forEach((turn, idx) => {
    if (turn.bashCommands) {
      turn.bashCommands.forEach((cmd) => {
        entries.push({
          turnIndex: idx,
          timestamp: turn.timestamp,
          command: cmd,
          category: categorizeCommand(cmd),
        });
      });
    }
  });
  return entries;
}

// --- Token chart helpers ---
export const TOKEN_COLORS = {
  input: DASH_COLORS.blue,
  output: DASH_COLORS.green,
  cacheCreation: DASH_COLORS.amber,
  cacheRead: DASH_COLORS.teal,
};

// --- Formatting ---
export function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

export function formatTokens(n: number): string {
  return n.toLocaleString();
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
