import * as vscode from 'vscode';

const SECTION = 'claudeMirror.worktree';

/** User-configurable worktree behavior, read from `claudeMirror.worktree.*`. */
export interface WorktreeSettings {
  /** Master switch for the worktree feature. */
  enabled: boolean;
  /** Container directory for ClaUi-created worktrees, relative to repo root. */
  directory: string;
  /** Branch-name prefix for new worktrees. */
  branchPrefix: string;
  /** Default base commit-ish for new worktrees (falls back to HEAD if unresolved). */
  baseBranch: string;
  /** Whether to copy `.worktreeinclude` entries into new worktrees. */
  copyIncludeFile: boolean;
  /** Strategy pre-selected in the merge wizard. */
  defaultMergeStrategy: 'merge' | 'squash' | 'ff';
  /** Default state of "remove worktree after a successful merge". */
  removeAfterMerge: boolean;
  /** Extra confirm step when the merge target is a protected branch (main/master). */
  confirmMergeIntoProtected: boolean;
}

export function getWorktreeSettings(): WorktreeSettings {
  const config = vscode.workspace.getConfiguration(SECTION);
  const strategy = config.get<string>('defaultMergeStrategy', 'merge');
  return {
    enabled: config.get<boolean>('enabled', true),
    directory: sanitizeDir(config.get<string>('directory', '.claude/worktrees')),
    branchPrefix: config.get<string>('branchPrefix', 'worktree-'),
    baseBranch: config.get<string>('baseBranch', 'origin/HEAD'),
    copyIncludeFile: config.get<boolean>('copyIncludeFile', true),
    defaultMergeStrategy:
      strategy === 'squash' || strategy === 'ff' ? strategy : 'merge',
    removeAfterMerge: config.get<boolean>('removeAfterMerge', false),
    confirmMergeIntoProtected: config.get<boolean>('confirmMergeIntoProtected', true),
  };
}

export function onWorktreeSettingsChanged(
  callback: (settings: WorktreeSettings) => void,
): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(SECTION)) {
      callback(getWorktreeSettings());
    }
  });
}

/** Keep the directory relative and free of traversal so it stays inside the repo. */
function sanitizeDir(dir: string): string {
  const cleaned = (dir || '.claude/worktrees').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (cleaned.length === 0 || cleaned.includes('..')) {
    return '.claude/worktrees';
  }
  return cleaned;
}
