/** Color constants for team UI elements */

export const TEAM_COLORS = {
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
  cyan: '#56b6c2',
};

export const AGENT_STATUS_COLORS: Record<string, string> = {
  idle: TEAM_COLORS.textMuted,
  working: TEAM_COLORS.green,
  blocked: TEAM_COLORS.orange,
  shutdown: TEAM_COLORS.red,
};

export const TASK_STATUS_COLORS: Record<string, string> = {
  pending: TEAM_COLORS.textMuted,
  in_progress: TEAM_COLORS.blue,
  completed: TEAM_COLORS.green,
  blocked: TEAM_COLORS.orange,
};

/** Assign a unique color to each agent from a palette */
const AGENT_PALETTE = [
  '#4A9FD9', '#E06C75', '#98C379', '#D19A66',
  '#C678DD', '#56B6C2', '#E5C07B', '#BE5046',
  '#61AFEF', '#C678DD', '#E5C07B', '#ABB2BF',
];

export function getAgentColor(index: number): string {
  return AGENT_PALETTE[index % AGENT_PALETTE.length];
}
