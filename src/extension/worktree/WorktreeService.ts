import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import type {
  WorktreeInfo,
  WorktreeActionResult,
  MergeInProgress,
  MergeOptions,
  MergePreview,
  MergeResult,
  MergeStrategy,
} from './worktreeTypes';
import type { WorktreeSettings } from './WorktreeSettings';

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 10 * 1024 * 1024;

interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * All git-worktree operations. Every git call goes through execFile with an
 * argument array (never a shell string) so worktree names and paths cannot be
 * used for shell injection. Mutating operations (create) are serialized through
 * a single in-flight chain so two concurrent "Create" clicks cannot race on the
 * same branch/directory.
 */
export class WorktreeService {
  private opChain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly workspaceRoot: string,
    private readonly settings: WorktreeSettings,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  /** Resolve the repository root for the workspace, or null if not a git repo. */
  async getRepoRoot(): Promise<string | null> {
    const res = await this.gitResult(['rev-parse', '--show-toplevel'], this.workspaceRoot);
    if (!res.ok) {
      return null;
    }
    const root = res.stdout.trim();
    return root.length > 0 ? root : null;
  }

  /**
   * Parse `git worktree list --porcelain` into structured worktree records,
   * flagging any worktree that is sitting in a paused (conflicted) merge so the
   * dashboard can surface an always-available Abort even when the wizard modal
   * is closed.
   */
  async listWorktrees(): Promise<WorktreeInfo[]> {
    const worktrees = await this.listWorktreesRaw();
    await Promise.all(
      worktrees.map(async (w) => {
        const mip = await this.detectMergeInProgress(w.path);
        if (mip) {
          w.mergeInProgress = mip;
        }
      }),
    );
    return worktrees;
  }

  /** Raw worktree list without the merge-in-progress augmentation. */
  private async listWorktreesRaw(): Promise<WorktreeInfo[]> {
    const root = (await this.getRepoRoot()) ?? this.workspaceRoot;
    const res = await this.gitResult(['worktree', 'list', '--porcelain'], root);
    if (!res.ok) {
      this.log(`[Worktree] list failed: ${res.stderr.trim() || res.code}`);
      return [];
    }
    return this.parsePorcelain(res.stdout);
  }

  /**
   * Create a new worktree: `.claude/worktrees/<name>` on branch
   * `<branchPrefix><name>`, branched from the resolved base. Ensures the
   * worktree directory is gitignored and copies `.worktreeinclude` entries.
   * Serialized so concurrent creates cannot collide.
   */
  createWorktree(
    rawName: string,
    baseBranchOverride?: string,
  ): Promise<WorktreeActionResult> {
    return this.serialize(() => this.createWorktreeInner(rawName, baseBranchOverride));
  }

  private async createWorktreeInner(
    rawName: string,
    baseBranchOverride?: string,
  ): Promise<WorktreeActionResult> {
    const name = this.sanitizeName(rawName);
    if (!name) {
      return { success: false, message: 'Please enter a valid worktree name (letters, numbers, dashes).' };
    }

    const root = await this.getRepoRoot();
    if (!root) {
      return { success: false, message: 'This workspace is not a git repository.' };
    }

    const worktreeDir = path.join(root, this.settings.directory, name);
    const branch = `${this.settings.branchPrefix}${name}`;

    if (fs.existsSync(worktreeDir)) {
      return { success: false, message: `A folder already exists at ${this.settings.directory}/${name}.` };
    }

    await this.ensureGitignore(root);

    const base = await this.resolveBase(root, baseBranchOverride);

    const add = await this.gitResult(
      ['worktree', 'add', worktreeDir, '-b', branch, base],
      root,
    );

    if (!add.ok) {
      return {
        success: false,
        message: this.friendlyError(add.stderr, branch, name),
      };
    }

    let copyNote = '';
    if (this.settings.copyIncludeFile) {
      const copied = await this.copyWorktreeIncludes(root, worktreeDir);
      if (copied > 0) {
        copyNote = ` Copied ${copied} included file(s).`;
      }
    }

    this.log(`[Worktree] created ${worktreeDir} on ${branch} from ${base}.${copyNote}`);
    return {
      success: true,
      message: `Created worktree "${name}" on branch ${branch}.${copyNote}`,
      worktreePath: worktreeDir,
    };
  }

  /**
   * Remove a worktree. Refuses to remove the main worktree. Without `force`,
   * git refuses when the worktree is dirty/has untracked files — that case is
   * surfaced with `requiresForce` so the UI can confirm a force-discard.
   */
  async removeWorktree(
    worktreePath: string,
    opts: { force?: boolean } = {},
  ): Promise<WorktreeActionResult> {
    const root = (await this.getRepoRoot()) ?? this.workspaceRoot;

    const all = await this.listWorktrees();
    const target = all.find(
      (w) => this.resolveRealPath(w.path) === this.resolveRealPath(worktreePath),
    );
    if (target?.isMain) {
      return { success: false, message: 'The main worktree cannot be removed.' };
    }

    const args = ['worktree', 'remove'];
    if (opts.force) {
      args.push('--force');
    }
    args.push(worktreePath);

    const res = await this.gitResult(args, root);
    if (res.ok) {
      this.log(`[Worktree] removed ${worktreePath}${opts.force ? ' (forced)' : ''}.`);
      return { success: true, message: 'Worktree removed.', worktreePath };
    }

    const stderr = res.stderr.toLowerCase();
    if (!opts.force && (stderr.includes('contains modified or untracked') || stderr.includes('use --force') || stderr.includes('is dirty'))) {
      return {
        success: false,
        requiresForce: true,
        worktreePath,
        message: 'This worktree has uncommitted or untracked changes. Remove anyway and discard them?',
      };
    }
    if (stderr.includes('is a main working tree') || stderr.includes('cannot remove')) {
      return { success: false, message: 'The main worktree cannot be removed.' };
    }
    return { success: false, message: `Failed to remove worktree: ${res.stderr.trim() || 'unknown error'}` };
  }

  /**
   * Canonical, comparable path for session->worktree mapping. Resolves 8.3
   * short names, junctions and drive-letter case via realpath, strips trailing
   * separators, and case-folds on Windows.
   */
  resolveRealPath(p: string): string {
    let resolved = p;
    try {
      resolved = fs.realpathSync.native(p);
    } catch {
      resolved = path.resolve(p);
    }
    resolved = resolved.replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  // ---- merge engine (public) ----

  /** Local branch names, newest-checked-out order not guaranteed. */
  async getBranches(): Promise<string[]> {
    const root = (await this.getRepoRoot()) ?? this.workspaceRoot;
    const res = await this.gitResult(
      ['for-each-ref', '--format=%(refname:short)', 'refs/heads'],
      root,
    );
    if (!res.ok) {
      return [];
    }
    return res.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  /**
   * Read-only analysis of "merge <source> into <target>", computed without
   * touching any working tree, to drive the merge wizard. Never mutates.
   */
  async getMergePreview(sourcePath: string, target?: string): Promise<MergePreview> {
    const base = (message: string): MergePreview => ({
      success: false,
      message,
      sourceBranch: '',
      sourcePath,
      targetBranch: target ?? '',
      targetSha: null,
      branches: [],
      ahead: 0,
      behind: 0,
      commits: [],
      sourceDirty: false,
      conflict: 'unknown',
      conflictFiles: [],
      alreadyMerged: false,
      needsMainSwitch: false,
    });

    const root = await this.getRepoRoot();
    if (!root) {
      return base('This workspace is not a git repository.');
    }

    const srcBranchRes = await this.gitResult(
      ['symbolic-ref', '-q', '--short', 'HEAD'],
      sourcePath,
    );
    const sourceBranch = srcBranchRes.ok ? srcBranchRes.stdout.trim() : '';
    if (!sourceBranch) {
      return base('The source worktree is in a detached HEAD state and has no branch to merge.');
    }

    const branches = await this.getBranches();
    const targetBranch =
      (target && target.trim()) || this.resolveDefaultTarget(branches, sourceBranch);
    if (!targetBranch) {
      const f = base('No other branch is available to merge into.');
      f.sourceBranch = sourceBranch;
      f.branches = branches;
      return f;
    }

    const srcRef = `refs/heads/${sourceBranch}`;
    const tgtRef = `refs/heads/${targetBranch}`;
    const targetSha = await this.revParseShort(tgtRef, root);

    if (targetBranch === sourceBranch) {
      const f = base(`"${sourceBranch}" cannot be merged into itself. Pick a different target.`);
      f.sourceBranch = sourceBranch;
      f.branches = branches;
      f.targetBranch = targetBranch;
      f.targetSha = targetSha;
      f.blockedReason = 'Source and target are the same branch.';
      return f;
    }

    let ahead = 0;
    let behind = 0;
    const counts = await this.gitResult(
      ['rev-list', '--left-right', '--count', `${tgtRef}...${srcRef}`],
      root,
    );
    if (counts.ok) {
      const parts = counts.stdout.trim().split(/\s+/).map((n) => parseInt(n, 10) || 0);
      behind = parts[0] ?? 0;
      ahead = parts[1] ?? 0;
    }

    const commits: { sha: string; subject: string }[] = [];
    const logRes = await this.gitResult(
      ['log', '--format=%h%x09%s', `${tgtRef}..${srcRef}`],
      root,
    );
    if (logRes.ok) {
      for (const line of logRes.stdout.split(/\r?\n/)) {
        const tab = line.indexOf('\t');
        if (tab > 0) {
          commits.push({ sha: line.slice(0, tab), subject: line.slice(tab + 1) });
        }
      }
    }

    const alreadyMerged = ahead === 0;
    const sourceDirty = !(await this.isClean(sourcePath));

    let conflict: 'clean' | 'conflict' | 'unknown' = 'unknown';
    let conflictFiles: string[] = [];
    if (await this.supportsMergeTree(root)) {
      const pred = await this.predictConflicts(root, tgtRef, srcRef);
      conflict = pred.conflict;
      conflictFiles = pred.files;
    }

    const worktrees = await this.listWorktreesRaw();
    const mainPath = worktrees.find((w) => w.isMain)?.path ?? root;
    const targetCheckedOut = worktrees.some(
      (w) => w.branch === targetBranch && !w.isDetached,
    );
    const needsMainSwitch = !targetCheckedOut;

    let blockedReason: string | undefined;
    const mergeBase = await this.gitResult(['merge-base', tgtRef, srcRef], root);
    if (!mergeBase.ok) {
      blockedReason = `"${sourceBranch}" and "${targetBranch}" have unrelated histories and cannot be merged.`;
    }
    if (!blockedReason) {
      const checkCwd =
        worktrees.find((w) => w.branch === targetBranch && !w.isDetached)?.path ?? mainPath;
      const blocking = await this.getBlockingGitState(checkCwd);
      if (blocking) {
        blockedReason = blocking;
      }
    }

    return {
      success: true,
      sourceBranch,
      sourcePath,
      targetBranch,
      targetSha,
      branches,
      ahead,
      behind,
      commits,
      sourceDirty,
      conflict,
      conflictFiles,
      alreadyMerged,
      needsMainSwitch,
      blockedReason,
    };
  }

  /** Commit everything in a worktree (used by "commit source first"). Serialized. */
  commitAll(worktreePath: string, message: string): Promise<WorktreeActionResult> {
    return this.serialize(() => this.commitAllInner(worktreePath, message));
  }

  private async commitAllInner(
    worktreePath: string,
    message: string,
  ): Promise<WorktreeActionResult> {
    const msg = message.trim() || 'WIP';
    const add = await this.gitResult(['add', '-A'], worktreePath);
    if (!add.ok) {
      return { success: false, message: `Could not stage changes: ${add.stderr.trim() || 'unknown error'}` };
    }
    const commit = await this.gitResult(['commit', '-m', msg], worktreePath);
    if (!commit.ok) {
      if (commit.stderr.toLowerCase().includes('nothing to commit')) {
        return { success: true, message: 'Nothing to commit — the worktree is already clean.' };
      }
      return { success: false, message: `Could not commit: ${commit.stderr.trim() || 'unknown error'}` };
    }
    return { success: true, message: 'Committed the source worktree changes.' };
  }

  /** Push the target branch after a merge. Best-effort; returns a human note. */
  async pushTarget(targetPath: string): Promise<string> {
    const res = await this.gitResult(['push'], targetPath);
    if (res.ok) {
      return 'Pushed the target branch.';
    }
    return `Push skipped: ${res.stderr.trim() || 'git push failed'}`;
  }

  /** Run a merge. Serialized so it cannot race other worktree mutations. */
  merge(opts: MergeOptions): Promise<MergeResult> {
    return this.serialize(() => this.mergeInner(opts));
  }

  private async mergeInner(opts: MergeOptions): Promise<MergeResult> {
    const { sourcePath, targetBranch, strategy } = opts;
    const err = (message: string): MergeResult => ({
      action: 'merge',
      phase: 'error',
      success: false,
      message,
      targetBranch,
    });

    const root = await this.getRepoRoot();
    if (!root) {
      return err('This workspace is not a git repository.');
    }

    const srcBranchRes = await this.gitResult(
      ['symbolic-ref', '-q', '--short', 'HEAD'],
      sourcePath,
    );
    const sourceBranch = srcBranchRes.ok ? srcBranchRes.stdout.trim() : '';
    if (!sourceBranch) {
      return err('The source worktree has no branch to merge (detached HEAD).');
    }
    if (sourceBranch === targetBranch) {
      return err('Source and target are the same branch.');
    }

    const srcRef = `refs/heads/${sourceBranch}`;
    const tgtRef = `refs/heads/${targetBranch}`;

    const mergeBase = await this.gitResult(['merge-base', tgtRef, srcRef], root);
    if (!mergeBase.ok) {
      return err(`"${sourceBranch}" and "${targetBranch}" have unrelated histories and cannot be merged.`);
    }

    // Merge this exact commit even if the live session commits more under us.
    const sourceSha = await this.revParse(srcRef, root);
    if (!sourceSha) {
      return err('Could not resolve the source branch commit.');
    }

    const worktrees = await this.listWorktreesRaw();
    const mainPath = worktrees.find((w) => w.isMain)?.path ?? root;
    const located = await this.locateTargetCwd(
      targetBranch,
      mainPath,
      worktrees,
      opts.allowMainSwitch,
    );
    if ('blocked' in located) {
      return err(located.blocked);
    }
    const targetCwd = located.cwd;

    const blocking = await this.getBlockingGitState(targetCwd);
    if (blocking) {
      return err(blocking);
    }
    if (!(await this.isClean(targetCwd))) {
      return err(`The target checkout for "${targetBranch}" has uncommitted changes. Commit or stash them before merging.`);
    }

    const preSha = await this.revParse('HEAD', targetCwd);
    if (!preSha) {
      return err('Could not resolve the target branch commit.');
    }

    if (strategy === 'ff') {
      const res = await this.gitResult(['merge', '--ff-only', sourceSha], targetCwd);
      if (res.ok) {
        return this.cleanMergeResult(
          targetCwd,
          targetBranch,
          preSha,
          'ff',
          `Fast-forwarded ${targetBranch} to ${sourceBranch}.`,
        );
      }
      return this.errorMergeResult(res, targetCwd, targetBranch, preSha, 'ff');
    }

    if (strategy === 'squash') {
      const res = await this.gitResult(['merge', '--squash', sourceSha], targetCwd);
      const unmerged = await this.getUnmergedFiles(targetCwd);
      if (unmerged.length > 0) {
        return {
          action: 'merge',
          phase: 'conflict',
          success: false,
          message: `Squash merge paused — conflicts in ${unmerged.length} file(s).`,
          targetBranch,
          targetPath: targetCwd,
          preSha,
          strategy: 'squash',
          conflictFiles: unmerged,
        };
      }
      if (!res.ok) {
        return this.errorMergeResult(res, targetCwd, targetBranch, preSha, 'squash');
      }
      const message =
        opts.commitMessage?.trim() || `Squash merge ${sourceBranch} into ${targetBranch}`;
      const commit = await this.gitResult(['commit', '-m', message], targetCwd);
      if (!commit.ok) {
        if (commit.stderr.toLowerCase().includes('nothing to commit')) {
          return {
            action: 'merge',
            phase: 'clean',
            success: true,
            message: `Nothing to merge — ${sourceBranch} is already in ${targetBranch}.`,
            targetBranch,
            targetPath: targetCwd,
            preSha,
            strategy: 'squash',
          };
        }
        return this.errorMergeResult(commit, targetCwd, targetBranch, preSha, 'squash');
      }
      return this.cleanMergeResult(
        targetCwd,
        targetBranch,
        preSha,
        'squash',
        `Squashed ${sourceBranch} into ${targetBranch}.`,
      );
    }

    // Default: a merge commit (--no-ff).
    const res = await this.gitResult(['merge', '--no-ff', '--no-edit', sourceSha], targetCwd);
    if (res.ok) {
      return this.cleanMergeResult(
        targetCwd,
        targetBranch,
        preSha,
        'merge',
        `Merged ${sourceBranch} into ${targetBranch}.`,
      );
    }
    const unmerged = await this.getUnmergedFiles(targetCwd);
    if (unmerged.length > 0) {
      return {
        action: 'merge',
        phase: 'conflict',
        success: false,
        message: `Merge paused — conflicts in ${unmerged.length} file(s).`,
        targetBranch,
        targetPath: targetCwd,
        preSha,
        strategy: 'merge',
        conflictFiles: unmerged,
      };
    }
    return this.errorMergeResult(res, targetCwd, targetBranch, preSha, 'merge');
  }

  /** Abort a paused merge, restoring the target to its pre-merge state. Serialized. */
  abortMerge(targetPath: string, opts: { squash: boolean }): Promise<MergeResult> {
    return this.serialize(() => this.abortMergeInner(targetPath, opts.squash));
  }

  private async abortMergeInner(targetPath: string, squash: boolean): Promise<MergeResult> {
    // A squash leaves no MERGE_HEAD and never advanced HEAD, so HEAD *is* the
    // pre-merge commit — `reset --hard HEAD` discards the half-applied squash.
    const res = squash
      ? await this.gitResult(['reset', '--hard', 'HEAD'], targetPath)
      : await this.gitResult(['merge', '--abort'], targetPath);
    if (res.ok) {
      return {
        action: 'abort',
        phase: 'clean',
        success: true,
        message: 'Merge aborted — the target branch is back to its previous state.',
        targetPath,
      };
    }
    return {
      action: 'abort',
      phase: 'error',
      success: false,
      message: `Could not abort the merge: ${res.stderr.trim() || 'unknown error'}`,
      targetPath,
    };
  }

  /** Finalize a merge once all conflicts are resolved. Serialized. */
  completeMerge(
    targetPath: string,
    opts: { squash: boolean; message?: string; preSha?: string },
  ): Promise<MergeResult> {
    return this.serialize(() => this.completeMergeInner(targetPath, opts));
  }

  private async completeMergeInner(
    targetPath: string,
    opts: { squash: boolean; message?: string; preSha?: string },
  ): Promise<MergeResult> {
    const unmerged = await this.getUnmergedFiles(targetPath);
    if (unmerged.length > 0) {
      return {
        action: 'complete',
        phase: 'conflict',
        success: false,
        message: `Still ${unmerged.length} unresolved file(s). Resolve them, then complete the merge.`,
        targetPath,
        conflictFiles: unmerged,
        strategy: opts.squash ? 'squash' : 'merge',
        preSha: opts.preSha,
      };
    }
    const res = opts.squash
      ? await this.gitResult(['commit', '-m', opts.message?.trim() || 'Squash merge'], targetPath)
      : await this.gitResult(['commit', '--no-edit'], targetPath);
    if (res.ok) {
      const newSha = await this.revParseShort('HEAD', targetPath);
      const canDiscard = opts.preSha
        ? await this.verifyUnpushed(targetPath, newSha ?? 'HEAD')
        : false;
      return {
        action: 'complete',
        phase: 'clean',
        success: true,
        message: 'Merge completed.',
        targetPath,
        newSha: newSha ?? undefined,
        preSha: opts.preSha,
        strategy: opts.squash ? 'squash' : 'merge',
        canDiscard,
      };
    }
    return {
      action: 'complete',
      phase: 'error',
      success: false,
      message: `Could not complete the merge: ${res.stderr.trim() || 'unknown error'}`,
      targetPath,
    };
  }

  /**
   * Undo a completed merge. Default `revert` is non-destructive (adds an inverse
   * commit). `discard` rewrites history and is only allowed when the commit is
   * provably unpushed.
   */
  undoMerge(
    targetPath: string,
    opts: { mode: 'revert' | 'discard'; strategy: MergeStrategy; newSha: string; preSha?: string },
  ): Promise<MergeResult> {
    return this.serialize(() => this.undoMergeInner(targetPath, opts));
  }

  private async undoMergeInner(
    targetPath: string,
    opts: { mode: 'revert' | 'discard'; strategy: MergeStrategy; newSha: string; preSha?: string },
  ): Promise<MergeResult> {
    if (opts.mode === 'discard') {
      if (!opts.preSha) {
        return {
          action: 'undo',
          phase: 'error',
          success: false,
          message: 'Cannot discard: the pre-merge commit is unknown. Use revert instead.',
          targetPath,
        };
      }
      if (!(await this.verifyUnpushed(targetPath, opts.newSha))) {
        return {
          action: 'undo',
          phase: 'error',
          success: false,
          message: 'This commit appears to be pushed already. Use Undo (revert) instead of discard.',
          targetPath,
        };
      }
      const res = await this.gitResult(['reset', '--keep', opts.preSha], targetPath);
      if (res.ok) {
        return {
          action: 'undo',
          phase: 'clean',
          success: true,
          message: 'Merge discarded — the target branch is back to its previous commit.',
          targetPath,
        };
      }
      return {
        action: 'undo',
        phase: 'error',
        success: false,
        message: `Could not discard the merge: ${res.stderr.trim() || 'unknown error'}`,
        targetPath,
      };
    }

    let res: GitResult;
    if (opts.strategy === 'merge') {
      res = await this.gitResult(['revert', '-m', '1', '--no-edit', opts.newSha], targetPath);
    } else if (opts.strategy === 'ff' && opts.preSha) {
      res = await this.gitResult(
        ['revert', '--no-edit', '--no-commit', `${opts.preSha}..${opts.newSha}`],
        targetPath,
      );
      if (res.ok) {
        res = await this.gitResult(['commit', '-m', 'Revert fast-forward merge'], targetPath);
      }
    } else {
      res = await this.gitResult(['revert', '--no-edit', opts.newSha], targetPath);
    }
    if (res.ok) {
      const newSha = await this.revParseShort('HEAD', targetPath);
      return {
        action: 'undo',
        phase: 'clean',
        success: true,
        message: 'Merge reverted — an inverse commit was added.',
        targetPath,
        newSha: newSha ?? undefined,
      };
    }
    return {
      action: 'undo',
      phase: 'error',
      success: false,
      message: `Could not revert the merge: ${res.stderr.trim() || 'unknown error'}`,
      targetPath,
    };
  }

  // ---- internals ----

  private async cleanMergeResult(
    targetPath: string,
    targetBranch: string,
    preSha: string,
    strategy: MergeStrategy,
    message: string,
  ): Promise<MergeResult> {
    const newSha = await this.revParseShort('HEAD', targetPath);
    const canDiscard = await this.verifyUnpushed(targetPath, newSha ?? 'HEAD');
    return {
      action: 'merge',
      phase: 'clean',
      success: true,
      message,
      targetBranch,
      targetPath,
      newSha: newSha ?? undefined,
      preSha,
      strategy,
      canDiscard,
    };
  }

  private errorMergeResult(
    res: GitResult,
    targetPath: string,
    targetBranch: string,
    preSha: string,
    strategy: MergeStrategy,
  ): MergeResult {
    return {
      action: 'merge',
      phase: 'error',
      success: false,
      message: this.friendlyMergeError(res.stderr),
      targetBranch,
      targetPath,
      preSha,
      strategy,
    };
  }

  /** Pick a sensible default merge target: configured base, else main/master, else any other branch. */
  private resolveDefaultTarget(branches: string[], sourceBranch: string): string {
    const prefs = [this.settings.baseBranch, 'main', 'master'].filter(
      (b): b is string => typeof b === 'string' && b.trim().length > 0,
    );
    for (const pref of prefs) {
      const match = branches.find((b) => b === pref.trim());
      if (match && match !== sourceBranch) {
        return match;
      }
    }
    return branches.find((b) => b !== sourceBranch) ?? '';
  }

  /**
   * Decide which checkout the merge runs in: the worktree that already has the
   * target branch checked out, else the main checkout (switching it to the
   * target when the user approved it and main is clean). Returns a blocked
   * reason when none of these are possible.
   */
  private async locateTargetCwd(
    target: string,
    mainPath: string,
    worktrees: WorktreeInfo[],
    allowMainSwitch: boolean,
  ): Promise<{ cwd: string; switched: boolean } | { blocked: string }> {
    const onTarget = worktrees.find((w) => w.branch === target && !w.isDetached);
    if (onTarget) {
      return { cwd: onTarget.path, switched: false };
    }
    if (!allowMainSwitch) {
      return {
        blocked: `The target branch "${target}" is not checked out anywhere. Approve switching the main checkout to it, or check it out in a worktree.`,
      };
    }
    if (!(await this.isClean(mainPath))) {
      return {
        blocked: `The main checkout has uncommitted changes and cannot be switched to "${target}". Commit or stash them first.`,
      };
    }
    const sw = await this.gitResult(['switch', '--no-guess', target], mainPath);
    if (!sw.ok) {
      return {
        blocked: `Could not switch the main checkout to "${target}": ${sw.stderr.trim() || 'unknown error'}`,
      };
    }
    this.log(`[Worktree] switched main checkout to ${target} for merge.`);
    return { cwd: mainPath, switched: true };
  }

  /** Detect a paused merge sitting in a worktree (normal or squash). */
  private async detectMergeInProgress(cwd: string): Promise<MergeInProgress | null> {
    if (await this.gitPathExists(cwd, 'MERGE_HEAD')) {
      const unmerged = await this.getUnmergedFiles(cwd);
      return { kind: 'merge', conflictedFiles: unmerged };
    }
    // No MERGE_HEAD: a paused squash leaves unmerged entries but no MERGE_HEAD.
    // Exclude cherry-pick/revert/rebase so those are not mislabeled as squashes.
    if (await this.gitPathExists(cwd, 'CHERRY_PICK_HEAD')) {
      return null;
    }
    if (await this.gitPathExists(cwd, 'REVERT_HEAD')) {
      return null;
    }
    if (await this.hasRebaseDir(cwd)) {
      return null;
    }
    const unmerged = await this.getUnmergedFiles(cwd);
    if (unmerged.length > 0) {
      return { kind: 'squash', conflictedFiles: unmerged };
    }
    return null;
  }

  /** Distinct paths with unmerged (conflict) index entries. */
  private async getUnmergedFiles(cwd: string): Promise<string[]> {
    const res = await this.gitResult(['ls-files', '-u', '-z'], cwd);
    if (!res.ok) {
      return [];
    }
    const set = new Set<string>();
    for (const rec of res.stdout.split('\0')) {
      if (!rec) {
        continue;
      }
      const tab = rec.indexOf('\t');
      if (tab >= 0) {
        set.add(rec.slice(tab + 1));
      }
    }
    return [...set];
  }

  /** A friendly reason if an in-progress git operation blocks a new merge, else null. */
  private async getBlockingGitState(cwd: string): Promise<string | null> {
    if (await this.gitPathExists(cwd, 'MERGE_HEAD')) {
      return 'A merge is already in progress in the target checkout. Resolve or abort it first.';
    }
    if (await this.gitPathExists(cwd, 'CHERRY_PICK_HEAD')) {
      return 'A cherry-pick is in progress in the target checkout. Finish or abort it first.';
    }
    if (await this.gitPathExists(cwd, 'REVERT_HEAD')) {
      return 'A revert is in progress in the target checkout. Finish or abort it first.';
    }
    if (await this.hasRebaseDir(cwd)) {
      return 'A rebase is in progress in the target checkout. Finish or abort it first.';
    }
    const unmerged = await this.getUnmergedFiles(cwd);
    if (unmerged.length > 0) {
      return 'There are unresolved conflicts in the target checkout. Resolve or abort them first.';
    }
    return null;
  }

  private async hasRebaseDir(cwd: string): Promise<boolean> {
    return (
      (await this.gitPathExists(cwd, 'rebase-merge')) ||
      (await this.gitPathExists(cwd, 'rebase-apply'))
    );
  }

  /** Resolve a git metadata path (e.g. MERGE_HEAD) and test that it exists. */
  private async gitPathExists(cwd: string, name: string): Promise<boolean> {
    const res = await this.gitResult(['rev-parse', '--git-path', name], cwd);
    if (!res.ok) {
      return false;
    }
    const rel = res.stdout.trim();
    if (!rel) {
      return false;
    }
    const resolved = path.isAbsolute(rel) ? rel : path.resolve(cwd, rel);
    return fs.existsSync(resolved);
  }

  private async isClean(cwd: string): Promise<boolean> {
    const res = await this.gitResult(['status', '--porcelain'], cwd);
    if (!res.ok) {
      return false;
    }
    return res.stdout.trim().length === 0;
  }

  private async revParse(ref: string, cwd: string): Promise<string | null> {
    const res = await this.gitResult(['rev-parse', '--verify', '--quiet', ref], cwd);
    const sha = res.stdout.trim();
    return res.ok && sha.length > 0 ? sha : null;
  }

  private async revParseShort(ref: string, cwd: string): Promise<string | null> {
    const res = await this.gitResult(['rev-parse', '--short', '--verify', '--quiet', ref], cwd);
    const sha = res.stdout.trim();
    return res.ok && sha.length > 0 ? sha : null;
  }

  /** True when git is >= 2.38 (where `merge-tree --write-tree` exists). */
  private async supportsMergeTree(cwd: string): Promise<boolean> {
    const res = await this.gitResult(['--version'], cwd);
    if (!res.ok) {
      return false;
    }
    const m = res.stdout.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
    if (!m) {
      return false;
    }
    const major = parseInt(m[1], 10);
    const minor = parseInt(m[2], 10);
    return major > 2 || (major === 2 && minor >= 38);
  }

  /** Predict conflicts without touching any tree (git >= 2.38). */
  private async predictConflicts(
    cwd: string,
    tgtRef: string,
    srcRef: string,
  ): Promise<{ conflict: 'clean' | 'conflict' | 'unknown'; files: string[] }> {
    const res = await this.gitResult(
      ['merge-tree', '--write-tree', '--name-only', '--no-messages', '-z', tgtRef, srcRef],
      cwd,
    );
    if (res.code === 0) {
      return { conflict: 'clean', files: [] };
    }
    if (res.code === 1) {
      // First NUL-separated record is the tree oid; the rest are conflicted paths.
      const records = res.stdout.split('\0').filter((r) => r.length > 0);
      return { conflict: 'conflict', files: records.slice(1) };
    }
    return { conflict: 'unknown', files: [] };
  }

  /**
   * True only when `sha` is provably NOT yet on the branch's upstream. No
   * upstream, or any error, is treated as "not provably unpushed" (returns
   * false) so the destructive discard option stays hidden unless we are sure.
   */
  private async verifyUnpushed(cwd: string, sha: string): Promise<boolean> {
    const up = await this.gitResult(
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
      cwd,
    );
    const upstream = up.ok ? up.stdout.trim() : '';
    if (!upstream) {
      return false;
    }
    await this.gitResult(['fetch'], cwd);
    const anc = await this.gitResult(['merge-base', '--is-ancestor', sha, upstream], cwd);
    // exit 0 => ancestor (pushed); exit 1 => not pushed; other => error.
    return anc.code === 1;
  }

  /** Map raw merge stderr to a friendly, actionable message. */
  private friendlyMergeError(stderr: string): string {
    const s = stderr.toLowerCase();
    if (s.includes('not possible to fast-forward')) {
      return 'Fast-forward is not possible because the target has moved on. Use a merge commit or squash instead.';
    }
    if (s.includes('would be overwritten') || s.includes('local changes')) {
      return 'Local changes in the target checkout would be overwritten. Commit or stash them first.';
    }
    if (s.includes('unrelated histories')) {
      return 'The branches have unrelated histories and cannot be merged.';
    }
    if (s.includes('not something we can merge') || s.includes('could not resolve')) {
      return 'The source commit could not be resolved for merging.';
    }
    return `Merge failed: ${stderr.trim() || 'unknown error'}`;
  }

  private parsePorcelain(raw: string): WorktreeInfo[] {
    const out: WorktreeInfo[] = [];
    const records = raw.split(/\r?\n\r?\n/).map((r) => r.trim()).filter((r) => r.length > 0);

    records.forEach((record, index) => {
      const lines = record.split(/\r?\n/);
      let wpath = '';
      let branch: string | null = null;
      let headSha: string | null = null;
      let isDetached = false;
      let isLocked = false;
      let isPrunable = false;
      let isBare = false;

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          wpath = line.slice('worktree '.length).trim();
        } else if (line.startsWith('HEAD ')) {
          headSha = line.slice('HEAD '.length).trim();
        } else if (line.startsWith('branch ')) {
          branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
        } else if (line === 'detached') {
          isDetached = true;
        } else if (line === 'bare') {
          isBare = true;
        } else if (line === 'locked' || line.startsWith('locked ')) {
          isLocked = true;
        } else if (line === 'prunable' || line.startsWith('prunable ')) {
          isPrunable = true;
        }
      }

      if (!wpath) {
        return;
      }

      out.push({
        path: wpath,
        branch,
        headSha,
        isMain: index === 0 && !isBare,
        isLocked,
        isPrunable,
        isDetached,
      });
    });

    return out;
  }

  /** Reduce an arbitrary name to a safe slug for branch/directory use. */
  private sanitizeName(raw: string): string {
    return (raw || '')
      .trim()
      .replace(/[^A-Za-z0-9-_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-_]+|[-_]+$/g, '')
      .slice(0, 60);
  }

  /** Resolve the base commit-ish: explicit override -> configured base -> HEAD. */
  private async resolveBase(root: string, override?: string): Promise<string> {
    const candidates = [override, this.settings.baseBranch].filter(
      (c): c is string => typeof c === 'string' && c.trim().length > 0,
    );
    for (const candidate of candidates) {
      const ok = await this.gitResult(
        ['rev-parse', '--verify', '--quiet', `${candidate.trim()}^{commit}`],
        root,
      );
      if (ok.ok && ok.stdout.trim().length > 0) {
        return candidate.trim();
      }
    }
    return 'HEAD';
  }

  /** Ensure the worktree container directory is gitignored. */
  private async ensureGitignore(root: string): Promise<void> {
    const gitignorePath = path.join(root, '.gitignore');
    const dir = this.settings.directory.replace(/\\/g, '/').replace(/\/+$/, '');
    const wanted = `${dir}/`;
    try {
      let content = '';
      try {
        content = await fsp.readFile(gitignorePath, 'utf-8');
      } catch {
        content = '';
      }
      const lines = content.split(/\r?\n/).map((l) => l.trim());
      const present = lines.some(
        (l) => l === dir || l === wanted || l === `${dir}/*` || l === `/${dir}` || l === `/${wanted}`,
      );
      if (present) {
        return;
      }
      const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
      const block = `${prefix}\n# ClaUi git worktrees\n${wanted}\n`;
      await fsp.appendFile(gitignorePath, block, 'utf-8');
      this.log(`[Worktree] added ${wanted} to .gitignore`);
    } catch (e) {
      this.log(`[Worktree] could not update .gitignore: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Copy entries listed in `.worktreeinclude` (one relative path per line) from
   * the main checkout into the new worktree. This re-implements the one real
   * feature of the CLI's `--worktree` flag we'd otherwise lose: carrying
   * gitignored files like `.env` into the new tree. Returns the count copied.
   */
  private async copyWorktreeIncludes(root: string, worktreeDir: string): Promise<number> {
    const includeFile = path.join(root, '.worktreeinclude');
    let raw = '';
    try {
      raw = await fsp.readFile(includeFile, 'utf-8');
    } catch {
      return 0;
    }

    const entries = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));

    let copied = 0;
    for (const entry of entries) {
      // Reject absolute paths and traversal so includes stay inside the repo.
      const normalized = entry.replace(/\\/g, '/');
      if (normalized.startsWith('/') || normalized.includes('..') || /^[A-Za-z]:/.test(normalized)) {
        this.log(`[Worktree] skipping unsafe .worktreeinclude entry: ${entry}`);
        continue;
      }
      const src = path.join(root, normalized);
      const dest = path.join(worktreeDir, normalized);
      try {
        const stat = await fsp.stat(src);
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        if (stat.isDirectory()) {
          await fsp.cp(src, dest, { recursive: true });
        } else {
          await fsp.copyFile(src, dest);
        }
        copied++;
      } catch (e) {
        this.log(`[Worktree] could not copy include "${entry}": ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return copied;
  }

  /** Map raw git stderr to a friendly, actionable message. */
  private friendlyError(stderr: string, branch: string, name: string): string {
    const s = stderr.toLowerCase();
    if (s.includes('already exists') && s.includes('branch')) {
      return `Branch "${branch}" already exists. Choose a different name.`;
    }
    if (s.includes('already used by worktree') || s.includes('is already checked out')) {
      return `Branch "${branch}" is already checked out in another worktree.`;
    }
    if (s.includes('already exists')) {
      return `A folder already exists at ${this.settings.directory}/${name}.`;
    }
    if (s.includes('invalid reference') || s.includes('not a valid')) {
      return 'Could not resolve the base branch. Check the base branch setting.';
    }
    if (s.includes('missing but already registered')) {
      return 'A stale worktree is registered at that path. Run "git worktree prune" and retry.';
    }
    return `Failed to create worktree: ${stderr.trim() || 'unknown error'}`;
  }

  /** Chain a mutation onto the serialized op queue. */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.opChain.then(fn, fn);
    this.opChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async gitResult(args: string[], cwd: string): Promise<GitResult> {
    try {
      const { stdout, stderr } = await execFileAsync('git', args, {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
        windowsHide: true,
        encoding: 'utf-8',
      });
      return { ok: true, stdout: stdout ?? '', stderr: stderr ?? '', code: 0 };
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; code?: number; message?: string };
      return {
        ok: false,
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? err.message ?? '',
        code: typeof err.code === 'number' ? err.code : null,
      };
    }
  }
}
