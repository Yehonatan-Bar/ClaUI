/** GitHub-dark palette shared by the worktree dashboard. */
export const WT_COLORS = {
  bg: 'rgba(13, 17, 23, 0.97)',
  card: '#161b22',
  cardBorder: '#30363d',
  cardBorderMain: '#3b82460',
  text: '#e6edf3',
  textDim: '#8b949e',
  accent: '#58a6ff',
  green: '#3fb950',
  red: '#f85149',
  amber: '#d29922',
  inputBg: '#0d1117',
} as const;

/** Badge color per provider, used for the small provider chip on a session row. */
export function providerBadgeColor(provider: string): string {
  switch (provider) {
    case 'claude':
      return '#D19A66';
    case 'codex':
      return '#56B6C2';
    case 'remote':
      return '#C678DD';
    default:
      return '#8b949e';
  }
}

/** Short, human label for a provider id. */
export function providerLabel(provider: string): string {
  switch (provider) {
    case 'claude':
      return 'Claude';
    case 'codex':
      return 'Codex';
    case 'remote':
      return 'Happy';
    default:
      return provider;
  }
}
