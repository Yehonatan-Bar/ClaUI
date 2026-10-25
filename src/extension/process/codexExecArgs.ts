/**
 * Pure argv builder for `codex exec` / `codex exec resume` turns.
 *
 * Kept free of `vscode` imports so the exact argv contract can be unit tested
 * (tests/process/codexExecArgs.test.ts).
 */

export interface CodexExecArgsOptions {
  threadId?: string;
  cwd?: string;
  model?: string;
  reasoningEffort?: string;
  serviceTier?: 'fast';
  permissionMode?: 'full-access' | 'supervised';
  imagePaths?: string[];
  forceReadOnlySandbox?: boolean;
  appendSystemPrompt?: string;
}

/**
 * Codex refuses to run outside a git repository unless the folder is marked
 * trusted in ~/.codex/config.toml ("Not inside a trusted directory and
 * --skip-git-repo-check was not specified.", exit code 1). Full Access mode
 * never hits this because --dangerously-bypass-approvals-and-sandbox skips the
 * check, but Supervised mode, Smart Search (cwd = home) and the read-only helper
 * calls (namer, summarizer, reviewer) failed on every turn in a plain folder.
 * ClaUi's own permission mode already decides the sandbox, so the git/trust
 * gate is skipped for every ClaUi-driven turn.
 */
export const CODEX_SKIP_GIT_REPO_CHECK_FLAG = '--skip-git-repo-check';

/**
 * Encode a JS string as a TOML basic string literal: a double-quoted form
 * with backslash escapes (\\, \", \r, \n, \t). Used for building Codex CLI
 * `-c key=value` overrides where the value is parsed as a TOML expression.
 */
export function toTomlBasicString(s: string): string {
  return '"' + s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t') + '"';
}

export function buildCodexPermissionArgs(permissionMode: 'full-access' | 'supervised'): string[] {
  if (permissionMode === 'supervised') {
    // Match the extension's "Supervised" semantics: Codex may read and analyze, but shell/file
    // actions run inside a read-only sandbox.
    return ['--sandbox', 'read-only'];
  }

  // Match the extension's "Full Access" semantics: no approval prompts and no sandboxing.
  return ['--dangerously-bypass-approvals-and-sandbox'];
}

export function buildCodexExecArgs(opts: CodexExecArgsOptions): string[] {
  const permissionArgs = opts.forceReadOnlySandbox
    ? ['--sandbox', 'read-only']
    : buildCodexPermissionArgs(opts.permissionMode ?? 'full-access');
  const instructionsArgs = opts.appendSystemPrompt
    ? ['-c', `instructions=${toTomlBasicString(opts.appendSystemPrompt)}`]
    : [];
  const serviceTierArgs = opts.serviceTier === 'fast'
    ? ['-c', `service_tier=${toTomlBasicString('fast')}`, '-c', 'features.fast_mode=true']
    : [];
  if (opts.threadId) {
    const args = ['exec', ...permissionArgs, 'resume', '--json', CODEX_SKIP_GIT_REPO_CHECK_FLAG];
    if (opts.model) {
      args.push('--model', opts.model);
    }
    if (opts.reasoningEffort) {
      args.push('-c', `model_reasoning_effort=${opts.reasoningEffort}`);
    }
    args.push(...serviceTierArgs);
    args.push(...instructionsArgs);
    for (const imagePath of opts.imagePaths ?? []) {
      args.push('--image', imagePath);
    }
    args.push(opts.threadId, '-');
    return args;
  }

  const args = ['exec', '--json', ...permissionArgs, CODEX_SKIP_GIT_REPO_CHECK_FLAG];
  if (opts.cwd) {
    args.push('-C', opts.cwd);
  }
  if (opts.model) {
    args.push('--model', opts.model);
  }
  if (opts.reasoningEffort) {
    args.push('-c', `model_reasoning_effort=${opts.reasoningEffort}`);
  }
  args.push(...serviceTierArgs);
  args.push(...instructionsArgs);
  for (const imagePath of opts.imagePaths ?? []) {
    args.push('--image', imagePath);
  }
  args.push('-');
  return args;
}
