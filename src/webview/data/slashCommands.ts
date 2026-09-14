/**
 * Built-in Claude Code slash commands, grouped exactly as they appear in the
 * CLI's `/` menu. This is a static, code-bundled catalog used by two UI
 * surfaces:
 *   - The inline autocomplete popup (typing `/` in the input box).
 *   - The full-list browser modal (the commands button in the input toolbar).
 *
 * ClaUi runs the Claude CLI headless (`-p` + stream-json), so most of these
 * commands do not execute the way they do in the interactive TUI; when sent
 * they are handed to the model as plain text. A set that ClaUi implements
 * natively is marked with `native` and gets "smart routed" to the real ClaUi
 * action on send. Commands that are purely interactive/TUI/environment features
 * with no native ClaUi equivalent are marked `unavailable`: they still appear
 * in the menus (greyed, tagged "not available") but cannot be run.
 */

/** Native ClaUi actions that a slash command can be routed to on send. */
export type NativeRoute = 'clear' | 'compact' | 'context' | 'model' | 'effort' | 'usage' | 'resume';

/** A selectable value for a command's argument (second-stage autocomplete). */
export interface SlashArgOption {
  /** The literal value written after the command, e.g. `high`. */
  value: string;
  /** Optional friendlier label; falls back to `value`. */
  label?: string;
  /** Optional one-line hint shown under the value. */
  description?: string;
}

export interface SlashCommand {
  /** Command name without the leading slash, e.g. `clear`. */
  name: string;
  /** Short argument hint shown after the name, e.g. `[name]`. */
  argsHint?: string;
  /** Alternate names that also trigger this command. */
  aliases?: string[];
  /** One-line description (matches the CLI wording). */
  description: string;
  /** When set, sending this command runs the native ClaUi action instead of
   *  passing the literal text to the CLI. */
  native?: NativeRoute;
  /** The command needs a value to do anything, so picking it from a menu
   *  inserts it (for the user to complete) rather than running it bare. */
  needsValue?: boolean;
  /** Not supported in ClaUi's headless CLI environment and with no native
   *  equivalent; shown greyed with a "not available" tag and cannot be run. */
  unavailable?: boolean;
  /** Static, enumerable values for this command's argument. When present (or
   *  supplied dynamically), picking the command opens a second-stage popup that
   *  lists these values and filters them as the user types (e.g. /effort). */
  argOptions?: SlashArgOption[];
}

export interface SlashCommandGroup {
  category: string;
  commands: SlashCommand[];
}

export const SLASH_COMMAND_GROUPS: SlashCommandGroup[] = [
  {
    category: 'Session & context',
    commands: [
      { name: 'clear', argsHint: '[name]', aliases: ['reset', 'new'], native: 'clear', description: 'Start a fresh conversation with empty context' },
      { name: 'compact', argsHint: '[instructions]', native: 'compact', description: 'Summarize the conversation so far to free context' },
      { name: 'autocompact', argsHint: '[auto|tokens]', description: 'Set how full the window gets before auto-compaction kicks in' },
      { name: 'context', argsHint: '[all]', native: 'context', description: 'Visual breakdown of what is filling your context window' },
      { name: 'rewind', aliases: ['checkpoint', 'undo'], unavailable: true, description: 'Roll code and/or conversation back to a checkpoint' },
      { name: 'resume', argsHint: '[session]', aliases: ['continue'], native: 'resume', description: 'Reopen an earlier conversation or open the picker' },
      { name: 'branch', argsHint: '[name]', unavailable: true, description: 'Branch the conversation here and switch into the branch' },
      { name: 'fork', argsHint: '[prompt]', unavailable: true, description: 'Copy the conversation into a new background session' },
      { name: 'subtask', description: 'Hand a side task to a subagent that reports back' },
      { name: 'btw', argsHint: '[question]', description: 'Ask a side question that does not enter the history' },
      { name: 'recap', description: 'One-line summary of the current session' },
      { name: 'rename', argsHint: '[name]', description: 'Name the session (auto-generates one if omitted)' },
      { name: 'export', argsHint: '[filename]', unavailable: true, description: 'Export the transcript as plain text' },
      { name: 'copy', argsHint: '[N]', unavailable: true, description: 'Copy Claude last response (or the Nth-latest) to the clipboard' },
      { name: 'status', description: 'Current session status' },
      { name: 'exit', aliases: ['quit'], unavailable: true, description: 'Quit the CLI' },
    ],
  },
  {
    category: 'Model, effort & modes',
    commands: [
      { name: 'model', argsHint: '[model]', native: 'model', needsValue: true, description: 'Switch model and save it as your default' },
      {
        name: 'effort', argsHint: '[level]', native: 'effort', needsValue: true,
        description: 'Reasoning depth, from low up to xhigh or max',
        argOptions: [
          { value: 'low', description: 'Fastest, least thorough' },
          { value: 'medium', description: 'Balanced' },
          { value: 'high', description: 'More thorough' },
          { value: 'xhigh', label: 'xhigh', description: 'Extra high' },
          { value: 'max', description: 'Deepest reasoning' },
        ],
      },
      { name: 'fast', argsHint: '[on|off]', description: 'Toggle fast mode' },
      { name: 'advisor', argsHint: '[model|off]', description: 'Turn on a second model consulted at key moments' },
      { name: 'plan', argsHint: '[description]', description: 'Enter plan mode, optionally with the task to plan' },
      { name: 'goal', argsHint: '[condition|clear]', needsValue: true, description: 'Keep Claude working across turns until a condition is met' },
      { name: 'sandbox', description: 'Toggle sandbox mode where supported' },
      { name: 'permissions', aliases: ['allowed-tools'], unavailable: true, description: 'Manage allow/ask/deny rules' },
      { name: 'auto-mode-setup', description: 'Draft auto-mode environment entries from your project' },
      { name: 'fewer-permission-prompts', description: 'Propose an allowlist of common read-only calls' },
    ],
  },
  {
    category: 'Reviewing & shipping code',
    commands: [
      { name: 'code-review', argsHint: '[level] [--fix] [target]', aliases: ['review'], description: 'Review the diff, a PR, or a path for bugs and cleanups' },
      { name: 'security-review', description: 'Check the current diff for security vulnerabilities' },
      { name: 'simplify', description: 'Cleanup-only pass (reuse, readability, efficiency)' },
      { name: 'diff', unavailable: true, description: 'Interactive viewer for uncommitted changes and per-turn diffs' },
      { name: 'verify', description: 'Verification pass that only runs when you invoke it' },
      { name: 'run', description: 'Launch and drive your app to confirm a change works' },
      { name: 'run-skill-generator', description: 'Write a per-project skill teaching /run and /verify' },
      { name: 'autofix-pr', argsHint: '[prompt]', description: 'Cloud session that watches your PR and pushes fixes' },
    ],
  },
  {
    category: 'Parallel & background work',
    commands: [
      { name: 'batch', argsHint: '<instruction>', description: 'Decompose a large change into units, each in its own worktree' },
      { name: 'background', argsHint: '[prompt]', aliases: ['bg'], description: 'Detach the session to keep running in the background' },
      { name: 'tasks', aliases: ['bashes'], description: 'List and manage background tasks' },
      { name: 'stop', description: 'Stop the attached background session' },
      { name: 'list-agents', aliases: ['peers'], description: 'List subagents, teammates and sessions Claude can message' },
      { name: 'agents', description: 'Pointer to creating/managing subagents via .claude/agents/' },
      { name: 'loop', argsHint: '[interval] [prompt]', aliases: ['proactive'], description: 'Run a prompt repeatedly while the session is open' },
      { name: 'schedule', argsHint: '[description]', aliases: ['routines'], description: 'Create/manage routines that run in the cloud' },
      { name: 'deep-research', argsHint: '<question>', description: 'Fan out web searches and synthesize a cited report' },
    ],
  },
  {
    category: 'Project setup & memory',
    commands: [
      { name: 'init', description: 'Generate a starter CLAUDE.md for the project' },
      { name: 'memory', description: 'Edit CLAUDE.md files and manage auto memory' },
      { name: 'add-dir', argsHint: '<path>', description: 'Add another working directory to the session' },
      { name: 'cd', argsHint: '<path>', description: 'Move the session to a different working directory' },
      { name: 'config', argsHint: '[key=value]', aliases: ['settings'], unavailable: true, description: 'Settings interface, or set a key from the prompt' },
      { name: 'hooks', unavailable: true, description: 'View hook configuration for tool events' },
      { name: 'import', argsHint: '[codex|gemini]', description: 'Bring config from OpenAI Codex or Gemini CLI' },
      { name: 'team-onboarding', description: 'Generate a ramp-up guide for teammates' },
    ],
  },
  {
    category: 'Extensions',
    commands: [
      { name: 'mcp', description: 'Manage MCP servers and their OAuth connections' },
      { name: 'plugin', argsHint: '[subcommand]', description: 'Install, enable, disable, or list plugins' },
      { name: 'reload-plugins', argsHint: '[--force]', description: 'Apply plugin changes without restarting' },
      { name: 'reload-skills', description: 'Re-scan skill and command directories mid-session' },
      { name: 'claude-api', argsHint: '[subcommand]', description: 'Load Claude API reference material' },
      { name: 'dataviz', argsHint: '[request]', description: 'Design guidance for charts and dashboards' },
      { name: 'design', argsHint: '[brief]', description: 'Draft UI mockups or screen flows on a canvas artifact' },
      { name: 'design-sync', argsHint: '[hint]', description: 'Sync your repo React design system to Claude Design' },
      { name: 'design-login', unavailable: true, description: 'Authorize Claude Design' },
      { name: 'artifacts', description: 'List and attach artifacts you own or that were shared' },
    ],
  },
  {
    category: 'Platforms & integrations',
    commands: [
      { name: 'desktop', aliases: ['app'], unavailable: true, description: 'Continue the session in the desktop app' },
      { name: 'teleport', unavailable: true, description: 'Pull a web session into this terminal' },
      { name: 'remote-control', aliases: ['rc'], unavailable: true, description: 'Drive this local session from claude.ai or mobile' },
      { name: 'remote-env', unavailable: true, description: 'Pick the default environment for cloud agents' },
      { name: 'mobile', aliases: ['ios', 'android'], unavailable: true, description: 'QR code for the mobile app' },
      { name: 'chrome', unavailable: true, description: 'Configure Claude in Chrome' },
      { name: 'ide', unavailable: true, description: 'Manage IDE integrations' },
      { name: 'install-github-app', unavailable: true, description: 'Install the GitHub app, optionally with Actions setup' },
      { name: 'install-slack-app', unavailable: true, description: 'Install the Claude Slack app' },
    ],
  },
  {
    category: 'Terminal appearance & input',
    commands: [
      { name: 'theme', unavailable: true, description: 'Change the color theme' },
      { name: 'color', argsHint: '[color|default]', unavailable: true, description: 'Set the prompt bar color for the session' },
      { name: 'statusline', unavailable: true, description: 'Set up a custom status line' },
      { name: 'terminal-setup', unavailable: true, description: 'Configure terminal keybindings (e.g. Shift+Enter)' },
      { name: 'keybindings', unavailable: true, description: 'Open your shortcuts file' },
      { name: 'tui', unavailable: true, description: 'Switch terminal UI mode, including fullscreen rendering' },
      { name: 'focus', unavailable: true, description: 'Minimal view: prompt, tool summary, and the answer' },
      { name: 'scroll-speed', unavailable: true, description: 'Tune mouse wheel scrolling in fullscreen mode' },
      { name: 'voice', argsHint: '[hold|tap|off]', unavailable: true, description: 'Voice dictation' },
    ],
  },
  {
    category: 'Account, usage & diagnostics',
    commands: [
      { name: 'login', unavailable: true, description: 'Sign in to your Anthropic account' },
      { name: 'logout', unavailable: true, description: 'Sign out of your Anthropic account' },
      { name: 'usage', aliases: ['cost', 'stats'], native: 'usage', description: 'Session cost, plan limits, activity' },
      { name: 'upgrade', unavailable: true, description: 'Open the upgrade page for a higher plan' },
      { name: 'rate-limit-options', unavailable: true, description: 'Options when a usage limit blocks you' },
      { name: 'privacy-settings', unavailable: true, description: 'View and change privacy settings (Pro/Max)' },
      { name: 'passes', unavailable: true, description: 'Share a free week of Claude Code, if eligible' },
      { name: 'doctor', aliases: ['checkup'], description: 'Full setup checkup that diagnoses problems and offers fixes' },
      { name: 'debug', argsHint: '[description]', description: 'Turn on debug logging and troubleshoot from the session log' },
      { name: 'insights', description: 'HTML report on how you have been using Claude Code locally' },
      { name: 'release-notes', description: 'Browse the changelog by version' },
      { name: 'bug', argsHint: '[report]', aliases: ['share'], unavailable: true, description: 'Report a bug or share the conversation' },
      { name: 'feedback', argsHint: '[report]', unavailable: true, description: 'Send product feedback' },
      { name: 'help', description: 'List available commands' },
      { name: 'powerup', unavailable: true, description: 'Short interactive lessons on Claude Code features' },
      { name: 'stickers', unavailable: true, description: 'Order Claude Code stickers' },
      { name: 'radio', unavailable: true, description: 'Open Claude FM lo-fi radio' },
    ],
  },
];

/** Flat list of every command across all groups. */
export const ALL_SLASH_COMMANDS: SlashCommand[] = SLASH_COMMAND_GROUPS.flatMap((g) => g.commands);

/** Lookup of command name (and aliases) -> native ClaUi route, for smart routing. */
const NATIVE_ROUTE_LOOKUP: Record<string, NativeRoute> = (() => {
  const map: Record<string, NativeRoute> = {};
  for (const cmd of ALL_SLASH_COMMANDS) {
    if (!cmd.native) continue;
    map[cmd.name] = cmd.native;
    for (const alias of cmd.aliases ?? []) {
      map[alias] = cmd.native;
    }
  }
  return map;
})();

/** Effort levels ClaUi can set natively (mirrors the effort selector). Other
 *  values the CLI accepts (`auto`, `status`, `ultracode`) are not native. */
const NATIVE_EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

/**
 * Filter and rank the command catalog for the inline autocomplete. `query` is
 * the text typed after the leading slash (without the slash). Empty query
 * returns the full catalog in source order.
 */
export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase();
  if (!q) return ALL_SLASH_COMMANDS;

  const scored: { cmd: SlashCommand; score: number; order: number }[] = [];
  ALL_SLASH_COMMANDS.forEach((cmd, order) => {
    const name = cmd.name.toLowerCase();
    const aliases = (cmd.aliases ?? []).map((a) => a.toLowerCase());
    let score = -1;
    if (name.startsWith(q)) score = 0;
    else if (aliases.some((a) => a.startsWith(q))) score = 1;
    else if (name.includes(q)) score = 2;
    else if (aliases.some((a) => a.includes(q))) score = 3;
    else if (cmd.description.toLowerCase().includes(q)) score = 4;
    if (score >= 0) scored.push({ cmd, score, order });
  });

  // Stable sort: better score first, then original catalog order.
  return scored
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .map((s) => s.cmd);
}

/** Lookup of command name (and aliases) -> command, for arg-stage resolution. */
const COMMAND_BY_NAME: Record<string, SlashCommand> = (() => {
  const map: Record<string, SlashCommand> = {};
  for (const cmd of ALL_SLASH_COMMANDS) {
    map[cmd.name] = cmd;
    for (const alias of cmd.aliases ?? []) map[alias] = cmd;
  }
  return map;
})();

/** Resolve a command by its name or one of its aliases (case-insensitive). */
export function findSlashCommand(name: string): SlashCommand | undefined {
  return COMMAND_BY_NAME[name.toLowerCase()];
}

/** Filter + rank a command's argument options by the partial value typed so far. */
export function filterArgOptions(options: SlashArgOption[], query: string): SlashArgOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  const scored: { opt: SlashArgOption; score: number; order: number }[] = [];
  options.forEach((opt, order) => {
    const value = opt.value.toLowerCase();
    const label = (opt.label ?? '').toLowerCase();
    let score = -1;
    if (value.startsWith(q)) score = 0;
    else if (label.startsWith(q)) score = 1;
    else if (value.includes(q)) score = 2;
    else if (label.includes(q)) score = 3;
    if (score >= 0) scored.push({ opt, score, order });
  });
  return scored.sort((a, b) => a.score - b.score || a.order - b.order).map((s) => s.opt);
}

export interface ParsedSlash {
  /** Lower-cased command name without the slash. */
  name: string;
  /** Everything after the command name, trimmed. */
  arg: string;
}

/** Parse `/name rest...` into its command name and argument text. */
export function parseSlash(text: string): ParsedSlash | null {
  if (!text.startsWith('/')) return null;
  const match = text.slice(1).match(/^(\S+)([\s\S]*)$/);
  if (!match) return null;
  return { name: match[1].toLowerCase(), arg: match[2].trim() };
}

/**
 * Whether picking a command from a menu (inline popup or the full-list browser)
 * should INSERT it into the input for the user to complete, rather than run it
 * immediately. True when the command is flagged `needsValue` (e.g. /model,
 * /effort, /goal) or declares a required `<...>` argument. Everything else -
 * including commands with only an optional `[...]` hint such as /clear,
 * /compact, /context - runs on pick, matching how the CLI behaves.
 */
export function slashCommandNeedsArg(cmd: SlashCommand): boolean {
  if (cmd.needsValue) return true;
  if (cmd.argsHint && cmd.argsHint.includes('<')) return true;
  return false;
}

/**
 * Decide whether a typed slash command should run a native ClaUi action.
 * Returns the route and its argument, or null to fall through to plain-text
 * send. `/model` only routes with an id/alias; `/effort` only routes for a
 * level ClaUi can set natively (auto/status/ultracode fall through to the CLI).
 */
export function resolveNativeRoute(text: string): { route: NativeRoute; arg: string } | null {
  const parsed = parseSlash(text);
  if (!parsed) return null;
  const route = NATIVE_ROUTE_LOOKUP[parsed.name];
  if (!route) return null;
  if (route === 'model' && !parsed.arg) return null; // need a model id/alias to switch
  if (route === 'effort' && !NATIVE_EFFORT_LEVELS.has(parsed.arg.toLowerCase())) return null;
  return { route, arg: parsed.arg };
}
