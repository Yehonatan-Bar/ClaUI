/**
 * Catalog of Claude Code "engine" slash commands that the bridge intercepts
 * and runs itself (macro/tool/offload — see dispatcher.ts) instead of handing
 * them to the backend as inert text. Single source of truth for the three
 * command-tools layers (A: macro, B: MCP tool, C: offload) so they never
 * diverge — every layer reads the same spec + rubric.
 */

export type CommandStrategy = 'macro' | 'tool' | 'offload';

export interface BridgeCommandSpec {
  /** Canonical name without slash; matches src/webview/data/slashCommands.ts. */
  name: string;
  aliases?: string[];
  /** MCP tool name exposed to tool-capable backends (Layer B). */
  toolName: string;
  /** One-liner; also used as the MCP tool description. */
  description: string;
  /** Local context to gather for the task packet. */
  context: {
    diff: 'working' | 'branch' | 'none';
    includeChangedFileList?: boolean;
    /** arg is a path/PR target rather than free text. */
    argAsTarget?: boolean;
  };
  /** Canonical instruction/rubric handed to the model (Layer A & B). */
  rubric: string;
  /** True if the command can mutate the workspace (e.g. --fix). */
  mutates?: boolean;
  /** Layer C: how to run the real command if offload is enabled. */
  offload?: { cli: 'claude' | 'codex'; slash: string };
}

const CODE_REVIEW_RUBRIC = `Review the changes for correctness bugs first, then reuse/simplification/efficiency cleanups. Ignore pure style nitpicks (formatting, naming taste) — a formatter or linter already handles those.

Prioritize, in order:
1. Correctness bugs — wrong behavior, crashes, race conditions, off-by-one errors, unhandled edge cases. Be concrete: name the exact input or state that triggers the bug and the wrong output or crash it produces.
2. Reuse and simplification — duplicated logic, unnecessary abstraction, dead code, over-engineering.
3. Efficiency — needless allocations, avoidable O(n^2) where O(n) is easy, redundant work.

Report each finding as: \`file:line — problem — why it fails — fix\`. Do not flag theoretical concerns unlikely to matter in practice.

End with a short verdict: overall assessment and whether the changes are safe to merge.`;

const SECURITY_REVIEW_RUBRIC = `Check the changes for security vulnerabilities, walking the categories that apply: injection (SQL/command/template), authentication and authorization gaps, hardcoded or leaked secrets, missing input validation, SSRF, path traversal, insecure deserialization, and unsafe use of user-controlled data.

For each finding, give a practical remediation (not theoretical hardening) and a risk rating (low/medium/high/critical) based on real exploitability in this codebase. Skip low-value theoretical noise — focus on issues an attacker could actually exploit.

Report each finding as: \`file:line — vulnerability — how it could be exploited — fix — risk rating\`.

End with a short overall risk summary.`;

const SIMPLIFY_RUBRIC = `Cleanup-only pass over the changes — do NOT hunt for bugs. Look for: duplication that could be reused, dead code, unnecessary abstraction or indirection, needless allocations, and anything that could be simpler while preserving behavior exactly.

Propose minimal diffs. Do not suggest a rewrite when a small, targeted change accomplishes the same cleanup. Do not flag pure style/formatting.

Report each finding as: \`file:line — what's over-complicated — the simpler alternative\`.`;

export const BRIDGE_COMMANDS: BridgeCommandSpec[] = [
  {
    name: 'code-review',
    aliases: ['review'],
    toolName: 'claui_code_review',
    description: 'Review the current changes for correctness bugs and cleanups.',
    context: { diff: 'working', includeChangedFileList: true },
    rubric: CODE_REVIEW_RUBRIC,
    offload: { cli: 'claude', slash: '/code-review' },
  },
  {
    name: 'security-review',
    toolName: 'claui_security_review',
    description: 'Check the current changes for security vulnerabilities (OWASP-oriented).',
    context: { diff: 'working', includeChangedFileList: true },
    rubric: SECURITY_REVIEW_RUBRIC,
    offload: { cli: 'claude', slash: '/security-review' },
  },
  {
    name: 'simplify',
    toolName: 'claui_simplify',
    description: 'Cleanup-only pass over the current changes (reuse, readability, efficiency).',
    context: { diff: 'working', includeChangedFileList: true },
    rubric: SIMPLIFY_RUBRIC,
    mutates: true,
    offload: { cli: 'claude', slash: '/simplify' },
  },
];

/** Lookup by name or alias (case-insensitive). */
export function findBridgeCommand(name: string): BridgeCommandSpec | undefined {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return undefined;
  return BRIDGE_COMMANDS.find(
    (spec) => spec.name === n || (spec.aliases || []).some((a) => a.toLowerCase() === n),
  );
}

export interface ParsedSlash {
  name: string;
  arg: string;
}

/** Tiny local slash-command parser. Deliberately NOT importing the webview's
 *  slashCommands module — that module targets the browser bundle and pulling
 *  it into the Node bridge-runtime bundle would be a layering violation. */
export function parseSlashCommand(text: string): ParsedSlash | null {
  const t = String(text || '').trimStart();
  if (!t.startsWith('/')) return null;
  const m = t.slice(1).match(/^(\S+)([\s\S]*)$/);
  if (!m) return null;
  return { name: m[1].toLowerCase(), arg: m[2].trim() };
}
