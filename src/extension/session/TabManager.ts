import * as vscode from 'vscode';
import * as path from 'path';
import { SessionTab } from './SessionTab';
import { CodexSessionTab } from './CodexSessionTab';
import type { SessionStore } from './SessionStore';
import type { ProjectAnalyticsStore } from './ProjectAnalyticsStore';
import type { PromptHistoryStore } from './PromptHistoryStore';
import type { ExtensionToWebviewMessage, ProviderId } from '../types/webview-messages';
import type { AchievementService } from '../achievements/AchievementService';
import type { SkillGenService } from '../skillgen/SkillGenService';
import type { TokenUsageRatioTracker } from './TokenUsageRatioTracker';
import type { SkillUsageTracker } from '../skillgen/SkillUsageTracker';
import { HandoffContextBuilder } from './handoff/HandoffContextBuilder';
import { HandoffPromptComposer } from './handoff/HandoffPromptComposer';
import { HandoffArtifactStore } from './handoff/HandoffArtifactStore';
import { HandoffOrchestrator, type HandoffTargetRuntime } from './handoff/HandoffOrchestrator';
import type { HandoffProvider, HandoffSessionRequest } from './handoff/HandoffTypes';
import { isHandoffProvider } from './handoff/HandoffTypes';
import {
  OpenTabsSnapshotStore,
  type OpenTabSnapshotEntry,
  type OpenTabsSnapshot,
} from './OpenTabsSnapshot';

/** Distinct colors for tab header bars, cycling through the palette */
const TAB_COLORS = [
  '#4A9FD9', // blue
  '#E06C75', // coral
  '#98C379', // green
  '#D19A66', // orange
  '#C678DD', // purple
  '#56B6C2', // cyan
  '#E5C07B', // gold
  '#BE5046', // brick
];

const HANDOFF_COOLDOWN_MS = 4_000;

type ManagedTab = SessionTab | CodexSessionTab;

/**
 * Manages all open SessionTab instances.
 * Tracks the active (focused) tab and provides command routing helpers.
 */
export class TabManager {
  private tabs = new Map<string, ManagedTab>();
  private activeTabId: string | null = null;
  private nextTabNumber = 1;
  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly handoffOrchestrator: HandoffOrchestrator;
  private readonly handoffLocks = new Set<string>();
  private readonly handoffLastByTab = new Map<string, number>();

  private readonly snapshotStore: OpenTabsSnapshotStore;
  private readonly snapshotEntries = new Map<string, OpenTabSnapshotEntry>();
  private snapshotDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isRestoringSnapshot = false;
  private static readonly SNAPSHOT_DEBOUNCE_MS = 500;
  private static readonly MAX_RESTORE = 10;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: (msg: string) => void,
    private readonly sessionStore: SessionStore,
    private readonly projectAnalyticsStore: ProjectAnalyticsStore,
    private readonly promptHistoryStore: PromptHistoryStore,
    private readonly achievementService: AchievementService,
    private readonly logDir: string | null,
    private readonly skillGenService?: SkillGenService,
    private readonly tokenRatioTracker?: TokenUsageRatioTracker,
    private readonly skillUsageTracker?: SkillUsageTracker
  ) {
    // Single shared status bar item across all tabs
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.text = '$(loading~spin) Claude thinking...';
    context.subscriptions.push(this.statusBarItem);

    const artifactsRoot = this.logDir || path.join(context.globalStorageUri.fsPath, 'logs', 'ClaUiLogs');
    const storeArtifacts = vscode.workspace
      .getConfiguration('claudeMirror')
      .get<boolean>('handoff.storeArtifacts', true);
    this.handoffOrchestrator = new HandoffOrchestrator(
      new HandoffContextBuilder(this.log),
      new HandoffPromptComposer(),
      new HandoffArtifactStore(artifactsRoot, this.log, { persistToDisk: storeArtifacts }),
      this.log,
    );

    this.snapshotStore = new OpenTabsSnapshotStore(context.workspaceState);
  }

  /** Create a new tab with its own independent Claude session */
  createTab(): SessionTab {
    return this.createClaudeTab();
  }

  /** Create a new tab routed by provider */
  createTabForProvider(provider: ProviderId): SessionTab | CodexSessionTab {
    if (provider === 'codex') { return this.createCodexTab(); }
    if (provider === 'remote') { return this.createRemoteTab(); }
    return this.createClaudeTab();
  }

  /** Create a new Claude tab */
  createClaudeTab(): SessionTab {
    const tabNumber = this.nextTabNumber++;
    const tabColor = TAB_COLORS[(tabNumber - 1) % TAB_COLORS.length];

    // First tab opens Beside the editor; subsequent tabs open in the same
    // column so they stack as switchable tabs instead of splitting further.
    const existingTab = this.getActiveTab() ?? this.getAnyTab();
    const viewColumn = existingTab?.viewColumn ?? vscode.ViewColumn.Beside;

    // Enable VS Code tab wrapping when multiple ClaUi tabs exist so tabs
    // wrap to a new row instead of overflowing with a horizontal scroll bar.
    if (this.tabs.size >= 1) {
      void vscode.workspace
        .getConfiguration('workbench.editor')
        .update('wrapTabs', true, vscode.ConfigurationTarget.Global);
    }

    const tab = new SessionTab(
      this.context,
      tabNumber,
      viewColumn,
      tabColor,
      this.log,
      this.statusBarItem,
      {
        onClosed: (tabId) => this.handleTabClosed(tabId),
        onFocused: (tabId) => this.handleTabFocused(tabId),
        onSessionIdAssigned: (tabId, sessionId) => this.handleSessionIdAssigned(tabId, sessionId),
        onNameChanged: (tabId, name) => this.handleNameChanged(tabId, name),
      },
      this.sessionStore,
      this.projectAnalyticsStore,
      this.promptHistoryStore,
      this.achievementService,
      this.logDir,
      this.skillGenService,
      this.tokenRatioTracker,
      this.skillUsageTracker
    );

    this.tabs.set(tab.id, tab);
    this.activeTabId = tab.id;
    this.seedSnapshotEntry(tab);
    this.log(`Tab created: ${tab.id} color=${tabColor} column=${viewColumn} (total: ${this.tabs.size})`);
    return tab;
  }

  /** Create a new Codex tab */
  createCodexTab(): CodexSessionTab {
    const tabNumber = this.nextTabNumber++;
    const tabColor = TAB_COLORS[(tabNumber - 1) % TAB_COLORS.length];

    const existingTab = this.getActiveTab() ?? this.getAnyTab();
    const viewColumn = existingTab?.viewColumn ?? vscode.ViewColumn.Beside;

    // Enable VS Code tab wrapping when multiple ClaUi tabs exist.
    if (this.tabs.size >= 1) {
      void vscode.workspace
        .getConfiguration('workbench.editor')
        .update('wrapTabs', true, vscode.ConfigurationTarget.Global);
    }

    const tab = new CodexSessionTab(
      this.context,
      tabNumber,
      viewColumn,
      tabColor,
      this.log,
      this.statusBarItem,
      {
        onClosed: (tabId) => this.handleTabClosed(tabId),
        onFocused: (tabId) => this.handleTabFocused(tabId),
        onSessionIdAssigned: (tabId, sessionId) => this.handleSessionIdAssigned(tabId, sessionId),
        onNameChanged: (tabId, name) => this.handleNameChanged(tabId, name),
      },
      this.sessionStore,
      this.projectAnalyticsStore,
      this.promptHistoryStore,
      this.achievementService,
      this.logDir,
      this.skillGenService
    );

    this.tabs.set(tab.id, tab);
    this.activeTabId = tab.id;
    this.seedSnapshotEntry(tab);
    this.log(`Codex tab created: ${tab.id} color=${tabColor} column=${viewColumn} (total: ${this.tabs.size})`);
    return tab;
  }

  /** Create a new Happy tab (remote provider routed through SessionTab + CLI override) */
  createRemoteTab(): SessionTab {
    const tab = this.createClaudeTab();
    const happyCliPath = vscode.workspace
      .getConfiguration('claudeMirror')
      .get<string>('happy.cliPath', 'happy');
    tab.setCliPathOverride(happyCliPath);
    // Upgrade the just-seeded entry now that provider/cliPath are known.
    const entry = this.snapshotEntries.get(tab.id);
    if (entry) {
      entry.provider = 'remote';
      entry.cliPathOverride = happyCliPath;
      this.schedulePersistSnapshot();
    }
    this.log(`Happy provider tab created: ${tab.id} cliPath=${happyCliPath}`);
    return tab;
  }

  /** Get the currently focused tab, or null if none (skips disposed zombie tabs) */
  getActiveTab(): ManagedTab | null {
    if (!this.activeTabId) {
      return null;
    }
    const tab = this.tabs.get(this.activeTabId);
    if (!tab) {
      return null;
    }
    // Guard against zombie tabs whose panel was disposed but onClosed never fired
    if (tab.isDisposed) {
      this.log(`Active tab ${this.activeTabId} is disposed (zombie) - removing`);
      this.tabs.delete(this.activeTabId);
      this.activeTabId = null;
      return null;
    }
    return tab;
  }

  /** Get or create: returns active tab if one exists, otherwise creates a new one */
  getOrCreateTab(): ManagedTab {
    const active = this.getActiveTab();
    if (active) {
      return active;
    }
    return this.createTab();
  }

  /** Close a specific tab by ID */
  closeTab(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      return;
    }
    tab.dispose();
    // onClosed callback handles map cleanup and active selection
  }

  getTabById(tabId: string): ManagedTab | null {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      return null;
    }
    if (tab.isDisposed) {
      this.tabs.delete(tabId);
      if (this.activeTabId === tabId) {
        this.activeTabId = null;
      }
      return null;
    }
    return tab;
  }

  async handoffSession(request: HandoffSessionRequest): Promise<{ targetTabId: string; artifactPath?: string }> {
    const sourceTab = request.sourceTabId ? this.getTabById(request.sourceTabId) : this.getActiveTab();
    if (!sourceTab) {
      throw new Error('No source tab found for provider handoff.');
    }

    const enabled = vscode.workspace.getConfiguration('claudeMirror').get<boolean>('handoff.enabled', true);
    if (!enabled) {
      throw new Error('Provider handoff is disabled by settings (claudeMirror.handoff.enabled=false).');
    }

    const sourceProvider = sourceTab.getProvider();
    if (!isHandoffProvider(sourceProvider)) {
      throw new Error(`Current provider "${sourceProvider}" does not support context handoff.`);
    }

    if (sourceProvider === request.targetProvider) {
      throw new Error('Source and target providers are identical.');
    }

    if (sourceTab.isBusyState()) {
      throw new Error('Finish or stop the current turn before switching provider with context.');
    }

    if (this.handoffLocks.has(sourceTab.id)) {
      throw new Error('A provider handoff is already in progress for this tab.');
    }

    const now = Date.now();
    const lastAt = this.handoffLastByTab.get(sourceTab.id) ?? 0;
    if (now - lastAt < HANDOFF_COOLDOWN_MS) {
      throw new Error('Please wait a moment before switching providers again.');
    }

    this.handoffLocks.add(sourceTab.id);
    const keepSourceOpen = request.keepSourceOpen ?? true;
    let targetTabId = '';
    let artifactPath: string | undefined;

    try {
      this.log(`[Handoff] start tab=${sourceTab.id} source=${sourceProvider} target=${request.targetProvider}`);
      const sourceSnapshot = await sourceTab.collectHandoffSnapshot();
      const startedAt = Date.now();
      const result = await this.handoffOrchestrator.run({
        source: sourceSnapshot,
        targetProvider: request.targetProvider,
        createTargetTab: (provider) => this.wrapHandoffTargetRuntime(this.createTabForProvider(provider)),
        onProgress: (update) => {
          const durationMs = Date.now() - startedAt;
          this.log(
            `[Handoff] stage=${update.stage} tab=${sourceTab.id} source=${update.sourceProvider} target=${update.targetProvider} durationMs=${durationMs}`,
          );
          sourceTab.postMessage({
            type: 'handoffProgress',
            ...update,
          });
        },
      });

      targetTabId = result.targetTabId;
      artifactPath = result.artifact?.markdownPath ?? result.artifact?.jsonPath;
      await this.linkHandoffMetadata({
        sourceSessionId: sourceSnapshot.sessionId,
        sourceProvider,
        sourceTabId: sourceTab.id,
        targetSessionId: result.targetSessionId,
        targetProvider: request.targetProvider,
        targetTabId: result.targetTabId,
        artifactPath,
      });

      this.handoffLastByTab.set(sourceTab.id, Date.now());
      this.handoffLastByTab.set(result.targetTabId, Date.now());

      if (!keepSourceOpen) {
        this.closeTab(sourceTab.id);
      }

      return { targetTabId: result.targetTabId, artifactPath };
    } finally {
      this.handoffLocks.delete(sourceTab.id);
    }
  }

  /** Dispose all tabs (used during extension deactivation) */
  closeAllTabs(): void {
    // Flush any pending snapshot write before we tear everything down so
    // that a graceful VS Code shutdown preserves the "what was open" record.
    this.flushSnapshotSync();
    for (const tab of this.tabs.values()) {
      tab.dispose();
    }
    this.tabs.clear();
    this.activeTabId = null;
    this.statusBarItem.hide();
  }

  /** Post a message to the active tab's webview */
  postToActiveTab(msg: ExtensionToWebviewMessage): void {
    this.getActiveTab()?.postMessage(msg);
  }

  /** Total number of open tabs */
  get tabCount(): number {
    return this.tabs.size;
  }

  // --- Internal helpers ---

  /** Get any existing tab (used to find the column for new tabs) */
  private getAnyTab(): ManagedTab | null {
    const first = this.tabs.values().next();
    return first.done ? null : first.value;
  }

  private wrapHandoffTargetRuntime(tab: ManagedTab): HandoffTargetRuntime {
    return {
      id: tab.id,
      get sessionId() {
        return tab.sessionId;
      },
      setForkInit: (init) => tab.setForkInit(init),
      startSession: (options) => tab.startSession({ cwd: options?.cwd }),
      stageDeferredHandoffPrompt: (prompt) => tab.setPendingHandoffPrompt(prompt),
    };
  }

  private async linkHandoffMetadata(args: {
    sourceSessionId?: string;
    sourceProvider: HandoffProvider;
    sourceTabId: string;
    targetSessionId?: string;
    targetProvider: HandoffProvider;
    targetTabId: string;
    artifactPath?: string;
  }): Promise<void> {
    const completedAt = new Date().toISOString();

    if (args.sourceSessionId) {
      const existing = this.sessionStore.getSession(args.sourceSessionId);
      if (existing) {
        await this.sessionStore.saveSession({
          ...existing,
          handoffTargetTabId: args.targetTabId,
          handoffTargetProvider: args.targetProvider,
          handoffArtifactPath: args.artifactPath,
          handoffCompletedAt: completedAt,
        });
      }
    }

    if (args.targetSessionId) {
      const existing = this.sessionStore.getSession(args.targetSessionId);
      if (existing) {
        await this.sessionStore.saveSession({
          ...existing,
          handoffSourceTabId: args.sourceTabId,
          handoffSourceProvider: args.sourceProvider,
          handoffArtifactPath: args.artifactPath,
          handoffCompletedAt: completedAt,
        });
      }
    }
  }

  // --- Internal handlers ---

  private handleTabClosed(tabId: string): void {
    this.tabs.delete(tabId);
    this.snapshotEntries.delete(tabId);
    this.schedulePersistSnapshot();
    this.log(`Tab closed: ${tabId} (remaining: ${this.tabs.size})`);

    if (this.activeTabId === tabId) {
      // Select the most recently created remaining tab, or null
      const remaining = Array.from(this.tabs.keys());
      this.activeTabId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
      this.log(`Active tab now: ${this.activeTabId ?? 'none'}`);
    }

    if (this.tabs.size === 0) {
      this.statusBarItem.hide();
    }
  }

  private handleTabFocused(tabId: string): void {
    this.activeTabId = tabId;
    this.schedulePersistSnapshot();
    this.log(`Tab focused: ${tabId}`);
  }

  // --- Open-tabs snapshot (restore-on-startup feature) ---

  private seedSnapshotEntry(tab: ManagedTab): void {
    if (this.isRestoringSnapshot) {
      // Don't overwrite the snapshot while we're replaying it.
      return;
    }
    const entry: OpenTabSnapshotEntry = {
      tabNumber: tab.tabNumber,
      provider: tab.getProvider() as ProviderId,
      sessionId: tab.sessionId ?? '',
      workspacePath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      savedAt: new Date().toISOString(),
    };
    this.snapshotEntries.set(tab.id, entry);
    this.schedulePersistSnapshot();
  }

  private handleSessionIdAssigned(tabId: string, sessionId: string): void {
    const entry = this.snapshotEntries.get(tabId);
    if (!entry) {
      return;
    }
    entry.sessionId = sessionId;
    entry.savedAt = new Date().toISOString();
    this.schedulePersistSnapshot();
  }

  private handleNameChanged(tabId: string, name: string): void {
    const entry = this.snapshotEntries.get(tabId);
    if (!entry) {
      return;
    }
    // Skip default placeholder names assigned during construction so the
    // snapshot only carries user-meaningful or auto-generated session names.
    if (!this.isDefaultTabName(name, entry.tabNumber)) {
      entry.customName = name;
      entry.savedAt = new Date().toISOString();
      this.schedulePersistSnapshot();
    }
  }

  private isDefaultTabName(name: string, tabNumber: number): boolean {
    return (
      name === `ClaUi ${tabNumber}` ||
      name === `Codex ${tabNumber}` ||
      name === `Session ${tabNumber}`
    );
  }

  private schedulePersistSnapshot(): void {
    if (this.isRestoringSnapshot) {
      return;
    }
    if (this.snapshotDebounceTimer) {
      clearTimeout(this.snapshotDebounceTimer);
    }
    this.snapshotDebounceTimer = setTimeout(() => {
      this.snapshotDebounceTimer = null;
      void this.persistSnapshotNow();
    }, TabManager.SNAPSHOT_DEBOUNCE_MS);
  }

  private buildSnapshot(): OpenTabsSnapshot {
    const activeEntry = this.activeTabId ? this.snapshotEntries.get(this.activeTabId) : undefined;
    const activeSessionId = activeEntry?.sessionId || undefined;
    return {
      version: 1,
      entries: Array.from(this.snapshotEntries.values()).filter((e) => !!e.sessionId),
      activeSessionId,
    };
  }

  private async persistSnapshotNow(): Promise<void> {
    try {
      await this.snapshotStore.set(this.buildSnapshot());
    } catch (err) {
      this.log(`[OpenTabsSnapshot] Failed to persist: ${err}`);
    }
  }

  /** Synchronous fire-and-forget flush used during deactivation. */
  private flushSnapshotSync(): void {
    if (this.snapshotDebounceTimer) {
      clearTimeout(this.snapshotDebounceTimer);
      this.snapshotDebounceTimer = null;
    }
    // Memento.update returns a Thenable; we can't await during deactivate,
    // but VS Code keeps the event loop alive long enough to flush.
    try {
      void this.snapshotStore.set(this.buildSnapshot());
    } catch (err) {
      this.log(`[OpenTabsSnapshot] Failed to flush on deactivate: ${err}`);
    }
  }

  /**
   * Restore tabs from the last-saved snapshot in this workspace.
   * Returns the number of successfully restored tabs.
   *
   * Designed to be called during activate() after cleanupOrphanedProcesses.
   */
  async restoreFromSnapshot(): Promise<number> {
    const snapshot = this.snapshotStore.get();
    if (snapshot.entries.length === 0) {
      this.log('[OpenTabsSnapshot] No entries to restore');
      return 0;
    }

    const currentWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    // Filter: workspace match + must have a sessionId, then de-dup by sessionId.
    const seen = new Set<string>();
    let entries = snapshot.entries
      .filter((e) => !!e.sessionId)
      .filter((e) => !currentWorkspace || !e.workspacePath || e.workspacePath === currentWorkspace)
      .filter((e) => {
        if (seen.has(e.sessionId)) { return false; }
        seen.add(e.sessionId);
        return true;
      });

    entries.sort((a, b) => a.tabNumber - b.tabNumber);

    const truncated = entries.length > TabManager.MAX_RESTORE;
    if (truncated) {
      entries = entries.slice(0, TabManager.MAX_RESTORE);
    }

    if (entries.length === 0) {
      this.log('[OpenTabsSnapshot] All snapshot entries filtered out');
      return 0;
    }

    this.log(`[OpenTabsSnapshot] Restoring ${entries.length} session(s)...`);
    this.isRestoringSnapshot = true;
    let restored = 0;
    let failed = 0;

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Restoring ${entries.length} ClaUi session${entries.length === 1 ? '' : 's'}...`,
          cancellable: false,
        },
        async (progress) => {
          const increment = 100 / entries.length;
          for (const entry of entries) {
            const label = entry.customName || `${entry.provider} session ${entry.tabNumber}`;
            progress.report({ increment, message: label });
            try {
              const tab = this.createTabForProvider(entry.provider);

              // For remote (Happy) tabs, prefer the live setting over the
              // snapshot value in case the user has since moved the CLI.
              if (entry.provider === 'remote' && tab instanceof SessionTab) {
                const livePath = vscode.workspace
                  .getConfiguration('claudeMirror')
                  .get<string>('happy.cliPath', '');
                const chosenPath = livePath || entry.cliPathOverride || 'happy';
                tab.setCliPathOverride(chosenPath);
              }

              await tab.startSession({ resume: entry.sessionId });
              restored++;
            } catch (err) {
              failed++;
              this.log(
                `[OpenTabsSnapshot] Failed to restore session ${entry.sessionId.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`
              );
            }
          }
        }
      );
    } finally {
      this.isRestoringSnapshot = false;
    }

    // Focus the originally-active session if it was restored.
    if (snapshot.activeSessionId) {
      for (const tab of this.tabs.values()) {
        if (tab.sessionId === snapshot.activeSessionId && !tab.isDisposed) {
          tab.reveal();
          break;
        }
      }
    }

    // Repopulate snapshotEntries with the newly-restored tabs so subsequent
    // edits (close, focus, name change) flow through the normal persistence
    // path. Each restored tab already emits onSessionIdAssigned, but
    // seedSnapshotEntry was skipped while isRestoringSnapshot was true.
    this.snapshotEntries.clear();
    for (const tab of this.tabs.values()) {
      this.snapshotEntries.set(tab.id, {
        tabNumber: tab.tabNumber,
        provider: tab.getProvider() as ProviderId,
        sessionId: tab.sessionId ?? '',
        cliPathOverride:
          tab instanceof SessionTab ? (tab.getCliPathOverride() ?? undefined) : undefined,
        workspacePath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        savedAt: new Date().toISOString(),
      });
    }
    void this.persistSnapshotNow();

    if (truncated) {
      void vscode.window.showInformationMessage(
        `ClaUi restored the ${TabManager.MAX_RESTORE} most recent sessions. Older sessions can be reopened from Conversation History (Ctrl+Shift+H).`
      );
    }
    if (failed > 0) {
      void vscode.window.showWarningMessage(
        `ClaUi restored ${restored} of ${restored + failed} sessions. ${failed} could not be resumed.`
      );
    }

    this.log(`[OpenTabsSnapshot] Restored ${restored}/${entries.length} sessions (${failed} failed)`);
    return restored;
  }
}
