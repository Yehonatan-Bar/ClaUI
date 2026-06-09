import * as vscode from 'vscode';
import * as path from 'path';
import { WorktreeService } from './WorktreeService';
import { getWorktreeSettings } from './WorktreeSettings';
import type { ProviderId } from '../types/webview-messages';
import type {
  WorktreeListMessage,
  WorktreeActionResultMessage,
  BranchListMessage,
  MergePreviewMessage,
  MergeResultMessage,
} from '../types/webview-messages';
import type {
  WorktreeSessionRef,
  WorktreeWithSessions,
  MergeResult,
  MergeStrategy,
} from './worktreeTypes';

/** A live tab as seen by the controller (subset of TabManager.TabSummary). */
export interface WorktreeTabInfo {
  id: string;
  tabNumber: number;
  displayName: string;
  provider: string;
  slotColor: string;
  isBusy: boolean;
  worktreePath: string | null;
}

/** The slice of TabManager the controller needs. Keeps the two decoupled. */
export interface WorktreeTabHost {
  listTabs(): WorktreeTabInfo[];
  createWorktreeTab(worktreePath: string, provider?: ProviderId): Promise<unknown>;
  focusTab(tabId: string): void;
  closeTab(tabId: string): void;
  broadcastTabsState(): void;
}

/**
 * Bridges the git-level WorktreeService with the live tab list. Owns the
 * worktree<->session join (realpath-normalized) and all worktree mutations so a
 * per-tab MessageHandler can stay thin: it forwards the inbound message here and
 * posts the returned data/result back to its own webview.
 */
export class WorktreeController {
  constructor(
    private readonly host: WorktreeTabHost,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  private service(): WorktreeService | null {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      return null;
    }
    return new WorktreeService(root, getWorktreeSettings(), this.log);
  }

  /** Build the joined worktree + sessions list for the dashboard. */
  async buildList(): Promise<WorktreeListMessage> {
    const svc = this.service();
    if (!svc) {
      return { type: 'worktreeList', worktrees: [], isGitRepo: false };
    }
    const repoRoot = await svc.getRepoRoot();
    if (!repoRoot) {
      return { type: 'worktreeList', worktrees: [], isGitRepo: false };
    }

    const worktrees = await svc.listWorktrees();
    const mainPath = worktrees.find((w) => w.isMain)?.path ?? repoRoot;

    // Group live tabs by the realpath of the worktree they run in. Tabs without
    // an explicit worktree belong to the primary (main) worktree.
    const byRealPath = new Map<string, WorktreeSessionRef[]>();
    for (const tab of this.host.listTabs()) {
      const tabWtPath = tab.worktreePath ?? mainPath;
      const key = svc.resolveRealPath(tabWtPath);
      const ref: WorktreeSessionRef = {
        tabId: tab.id,
        tabNumber: tab.tabNumber,
        displayName: tab.displayName,
        provider: tab.provider,
        slotColor: tab.slotColor,
        isBusy: tab.isBusy,
      };
      const list = byRealPath.get(key);
      if (list) {
        list.push(ref);
      } else {
        byRealPath.set(key, [ref]);
      }
    }

    const joined: WorktreeWithSessions[] = worktrees.map((w) => ({
      ...w,
      sessions: byRealPath.get(svc.resolveRealPath(w.path)) ?? [],
    }));

    return { type: 'worktreeList', worktrees: joined, isGitRepo: true };
  }

  /** Create a worktree and (optionally) auto-start a session inside it. */
  async create(req: {
    name: string;
    baseBranch?: string;
    startSession: boolean;
  }): Promise<WorktreeActionResultMessage> {
    const svc = this.service();
    if (!svc) {
      return {
        type: 'worktreeActionResult',
        action: 'create',
        success: false,
        message: 'No workspace folder is open.',
      };
    }

    const result = await svc.createWorktree(req.name, req.baseBranch);
    if (result.success && req.startSession && result.worktreePath) {
      try {
        await this.host.createWorktreeTab(result.worktreePath, 'claude');
      } catch (e) {
        this.log(`[Worktree] auto-start session failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return { type: 'worktreeActionResult', action: 'create', ...result };
  }

  /** Start a fresh session inside an existing worktree. */
  async createSession(worktreePath: string): Promise<void> {
    await this.host.createWorktreeTab(worktreePath, 'claude');
  }

  /**
   * Remove a worktree. First closes any tabs running inside it (disposing the
   * tab kills its CLI process tree), then runs `git worktree remove`.
   */
  async remove(worktreePath: string, force: boolean): Promise<WorktreeActionResultMessage> {
    const svc = this.service();
    if (!svc) {
      return {
        type: 'worktreeActionResult',
        action: 'remove',
        success: false,
        message: 'No workspace folder is open.',
      };
    }

    const targetKey = svc.resolveRealPath(worktreePath);
    const owning = this.host
      .listTabs()
      .filter((t) => t.worktreePath && svc.resolveRealPath(t.worktreePath) === targetKey);
    for (const tab of owning) {
      this.log(`[Worktree] closing tab ${tab.id} before removing ${worktreePath}`);
      this.host.closeTab(tab.id);
    }

    const result = await svc.removeWorktree(worktreePath, { force });
    return { type: 'worktreeActionResult', action: 'remove', ...result };
  }

  /** Reveal a worktree directory in the OS file explorer. */
  async openFolder(worktreePath: string): Promise<void> {
    try {
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(worktreePath));
    } catch (e) {
      this.log(`[Worktree] openFolder failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Focus the tab whose session runs in a given worktree. */
  focusSession(tabId: string): void {
    this.host.focusTab(tabId);
  }

  // ---- merge wizard ----

  /** Local branches for the wizard's target dropdown. */
  async listBranches(): Promise<BranchListMessage> {
    const svc = this.service();
    const branches = svc ? await svc.getBranches() : [];
    return { type: 'branchList', branches };
  }

  /** Read-only "merge <source> into <target>" analysis. */
  async previewMerge(sourcePath: string, targetBranch?: string): Promise<MergePreviewMessage> {
    const settings = getWorktreeSettings();
    const svc = this.service();
    if (!svc) {
      return {
        type: 'mergePreview',
        defaultStrategy: settings.defaultMergeStrategy,
        removeAfterDefault: settings.removeAfterMerge,
        confirmIntoProtected: settings.confirmMergeIntoProtected,
        preview: {
          success: false,
          message: 'No workspace folder is open.',
          sourceBranch: '',
          sourcePath,
          targetBranch: targetBranch ?? '',
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
        },
      };
    }
    const preview = await svc.getMergePreview(sourcePath, targetBranch);
    return {
      type: 'mergePreview',
      preview,
      defaultStrategy: settings.defaultMergeStrategy,
      removeAfterDefault: settings.removeAfterMerge,
      confirmIntoProtected: settings.confirmMergeIntoProtected,
    };
  }

  /** Commit the source worktree's changes before merging it. */
  async commitSource(worktreePath: string, message: string): Promise<WorktreeActionResultMessage> {
    const svc = this.service();
    if (!svc) {
      return {
        type: 'worktreeActionResult',
        action: 'commit',
        success: false,
        message: 'No workspace folder is open.',
      };
    }
    const result = await svc.commitAll(worktreePath, message);
    return { type: 'worktreeActionResult', action: 'commit', ...result };
  }

  /**
   * Run a merge and, on a clean result, optionally push the target and remove
   * the source worktree (reusing the close-tabs-before-remove path).
   */
  async performMerge(req: {
    sourcePath: string;
    targetBranch: string;
    strategy: MergeStrategy;
    commitMessage?: string;
    allowMainSwitch: boolean;
    removeAfter: boolean;
    pushAfter: boolean;
  }): Promise<MergeResultMessage> {
    const svc = this.service();
    if (!svc) {
      return {
        type: 'mergeResult',
        result: {
          action: 'merge',
          phase: 'error',
          success: false,
          message: 'No workspace folder is open.',
        },
      };
    }

    const result = await svc.merge({
      sourcePath: req.sourcePath,
      targetBranch: req.targetBranch,
      strategy: req.strategy,
      commitMessage: req.commitMessage,
      allowMainSwitch: req.allowMainSwitch,
    });

    if (result.phase === 'clean' && result.success) {
      if (req.pushAfter && result.targetPath) {
        result.pushNote = await svc.pushTarget(result.targetPath);
      }
      if (req.removeAfter) {
        const removed = await this.remove(req.sourcePath, false);
        result.removed = removed.success;
        if (!removed.success) {
          result.pushNote = `${result.pushNote ? result.pushNote + ' ' : ''}Worktree kept: ${removed.message}`;
        }
      }
    }

    return { type: 'mergeResult', result };
  }

  /** Abort a paused merge sitting in a worktree. */
  async abortMerge(targetPath: string, squash: boolean): Promise<MergeResultMessage> {
    const svc = this.service();
    if (!svc) {
      return { type: 'mergeResult', result: this.noWorkspace('abort') };
    }
    const result = await svc.abortMerge(targetPath, { squash });
    return { type: 'mergeResult', result };
  }

  /** Finalize a merge once conflicts are resolved. */
  async completeMerge(
    targetPath: string,
    opts: { squash: boolean; message?: string; preSha?: string },
  ): Promise<MergeResultMessage> {
    const svc = this.service();
    if (!svc) {
      return { type: 'mergeResult', result: this.noWorkspace('complete') };
    }
    const result = await svc.completeMerge(targetPath, opts);
    return { type: 'mergeResult', result };
  }

  /** Undo a completed merge (revert by default; guarded discard when unpushed). */
  async undoMerge(
    targetPath: string,
    opts: { mode: 'revert' | 'discard'; strategy: MergeStrategy; newSha: string; preSha?: string },
  ): Promise<MergeResultMessage> {
    const svc = this.service();
    if (!svc) {
      return { type: 'mergeResult', result: this.noWorkspace('undo') };
    }
    const result = await svc.undoMerge(targetPath, opts);
    return { type: 'mergeResult', result };
  }

  /** Open conflicted files in the editor so the user can resolve them natively. */
  async openConflictFiles(targetPath: string, files: string[]): Promise<void> {
    for (const f of files) {
      const abs = path.isAbsolute(f) ? f : path.join(targetPath, f);
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(abs));
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (e) {
        this.log(`[Worktree] openConflictFiles failed for ${f}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  /** Re-read the current unmerged (conflict) paths from git after the assistant acts. */
  async refreshConflicts(targetPath: string): Promise<string[]> {
    const svc = this.service();
    if (!svc) {
      return [];
    }
    return svc.getUnmergedFiles(targetPath);
  }

  private noWorkspace(action: MergeResult['action']): MergeResult {
    return {
      action,
      phase: 'error',
      success: false,
      message: 'No workspace folder is open.',
    };
  }
}
