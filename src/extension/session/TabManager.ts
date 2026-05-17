import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { SessionTab } from './SessionTab';
import { CodexSessionTab } from './CodexSessionTab';
import { buildSmartSearchPrompt } from './SmartSearchPrompt';
import { findWorkingCodexCliCandidates, pickPreferredCodexCliCandidate } from '../process/CodexCliDetector';
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
import type { ProcessMemorySampler } from '../process/ProcessMemorySampler';
import type { TabGroupStore } from './TabGroupStore';
import { MultiParticipantSessionTab } from '../multiparticipant/MultiParticipantSessionTab';

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

/** Distinct slot color for Smart Search tabs so they're visually obvious. */
const SMART_SEARCH_COLOR = '#FF00C8';

const HANDOFF_COOLDOWN_MS = 4_000;

type ManagedTab = SessionTab | CodexSessionTab | MultiParticipantSessionTab;

export interface TabSummary {
  id: string;
  tabNumber: number;
  displayName: string;
  provider: ProviderId;
  sessionId: string | null;
  groupId?: string;
  orderInGroup?: number;
  slotColor: string;
}

/**
 * Manages all open SessionTab instances.
 * Tracks the active (focused) tab and provides command routing helpers.
 */
export class TabManager {
  private tabs = new Map<string, ManagedTab>();
  private tabSlotColors = new Map<string, string>();
  private activeTabId: string | null = null;
  private nextTabNumber = 1;
  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly handoffOrchestrator: HandoffOrchestrator;
  private readonly handoffLocks = new Set<string>();
  private readonly handoffLastByTab = new Map<string, number>();

  /** Shared workstream manager, injected after construction to avoid circular dependency */
  workstreamManager: import('../workstream/WorkstreamManager').WorkstreamManager | null = null;

  /** Shared Particle Accelerator service, injected after construction */
  particleAcceleratorService: import('../particle-accelerator/ParticleAcceleratorService').ParticleAcceleratorService | null = null;

  private readonly snapshotStore: OpenTabsSnapshotStore;
  private readonly snapshotEntries = new Map<string, OpenTabSnapshotEntry>();
  private snapshotDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isRestoringSnapshot = false;
  private isShuttingDown = false;
  private savedShowTabs: string | null = null;
  private static readonly SNAPSHOT_DEBOUNCE_MS = 500;
  private static readonly MAX_RESTORE = 10;
  private static readonly LAYOUT_SETTLE_MS = 75;

  /** Fires whenever the tree state (tabs, group assignments, summaries) changes — UI listens for refresh. */
  private readonly treeChangeEmitter = new vscode.EventEmitter<void>();
  readonly onTreeStateChanged = this.treeChangeEmitter.event;
  /** Fires when a session's end-of-session summary is regenerated (carries the sessionId). */
  private readonly summaryChangeEmitter = new vscode.EventEmitter<string>();
  readonly onSummaryChanged = this.summaryChangeEmitter.event;

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
    private readonly skillUsageTracker?: SkillUsageTracker,
    private readonly memorySampler?: ProcessMemorySampler,
    private readonly tabGroupStore?: TabGroupStore
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

    if (this.tabGroupStore) {
      // Forward group changes (rename/recolor/move/delete) so the TreeView refreshes.
      this.tabGroupStore.onDidChange(() => {
        // When group colors change, update icons on every tab assigned to that group.
        this.refreshAllTabIcons();
        this.treeChangeEmitter.fire();
        this.broadcastTabsState();
      });
    }

    // Re-arrange existing tabs whenever the user flips the layout setting from
    // anywhere (Sessions title-bar gear, Settings UI, or the in-tab View toggle).
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration('claudeMirror.tabs.layout')) {
          return;
        }
        const mode = this.getTabLayout();
        void this.applyTabLayout(mode).catch((err) => {
          this.log(`[TabLayout] auto-apply failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      })
    );

    // When a regular text editor gets focus (non-ClaUi), restore native tabs
    // so the user still has tab navigation. ClaUi panels re-hide them on focus.
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        const layout = this.getTabLayout();
        this.log(`[TabLayout] activeTextEditor changed: editor=${editor ? 'TextEditor' : 'none'} layout=${layout} savedShowTabs=${this.savedShowTabs}`);
        if (layout !== 'vertical' || !this.savedShowTabs) return;
        if (!editor) return;
        const cfg = vscode.workspace.getConfiguration('workbench.editor');
        const current = cfg.get<string>('showTabs');
        this.log(`[TabLayout] Restoring native tabs: current=${current} restoreTo=${this.savedShowTabs}`);
        if (current === 'none') {
          void Promise.resolve(cfg.update('showTabs', this.savedShowTabs, vscode.ConfigurationTarget.Global)).catch(() => {});
        }
      })
    );
  }

  /** Public accessors for the TreeView. */
  getTabGroupStore(): TabGroupStore | undefined {
    return this.tabGroupStore;
  }

  listTabs(): TabSummary[] {
    const out: TabSummary[] = [];
    for (const tab of this.tabs.values()) {
      if (tab.isDisposed) continue;
      const entry = this.snapshotEntries.get(tab.id);
      out.push({
        id: tab.id,
        tabNumber: tab.tabNumber,
        displayName: (tab as { displayName?: string }).displayName ?? `Tab ${tab.tabNumber}`,
        provider: tab.getProvider() as ProviderId,
        sessionId: tab.sessionId ?? null,
        groupId: entry?.groupId,
        orderInGroup: entry?.orderInGroup,
        slotColor: this.tabSlotColors.get(tab.id) ?? TAB_COLORS[0],
      });
    }
    return out;
  }

  getOpenTabSessionIds(): string[] {
    return this.listTabs()
      .map(t => t.sessionId)
      .filter((id): id is string => id !== null);
  }

  broadcastTabsState(): void {
    const msg: ExtensionToWebviewMessage = {
      type: 'tabList',
      tabs: this.listTabs(),
      activeTabId: this.activeTabId,
    };
    for (const tab of this.tabs.values()) {
      if (!tab.isDisposed) {
        tab.postMessage(msg);
      }
    }
  }

  /** Move (or remove) a tab to/from a folder. Triggers tree refresh and icon recolor. */
  async moveTabToGroup(tabId: string, groupId: string | null, orderInGroup?: number): Promise<void> {
    const entry = this.snapshotEntries.get(tabId);
    if (!entry) {
      return;
    }
    if (groupId && this.tabGroupStore && !this.tabGroupStore.getGroup(groupId)) {
      throw new Error(`Folder ${groupId} not found`);
    }
    entry.groupId = groupId ?? undefined;
    entry.orderInGroup = orderInGroup;
    entry.savedAt = new Date().toISOString();
    this.applyEffectiveTabIcon(tabId);
    this.schedulePersistSnapshot();
    this.treeChangeEmitter.fire();
    this.broadcastTabsState();
  }

  /** The folder a tab belongs to, if any. */
  getTabGroup(tabId: string): string | undefined {
    return this.snapshotEntries.get(tabId)?.groupId;
  }

  /** Public surface for SessionSummarizer to broadcast that a session's summary changed. */
  notifySummaryChanged(sessionId: string): void {
    this.summaryChangeEmitter.fire(sessionId);
    this.treeChangeEmitter.fire();
  }

  focusTab(tabId: string): void {
    const tab = this.getTabById(tabId);
    if (!tab) {
      return;
    }
    this.activeTabId = tabId;
    tab.reveal();
    this.broadcastTabsState();
  }

  /** When a tab joins/leaves a group, or a group recolor happens, re-skin native tab icon. */
  private applyEffectiveTabIcon(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.isDisposed) {
      return;
    }
    const groupId = this.snapshotEntries.get(tabId)?.groupId;
    const groupColor = groupId ? this.tabGroupStore?.getGroup(groupId)?.color : undefined;
    const slotColor = this.tabSlotColors.get(tabId) ?? TAB_COLORS[0];
    const effective = groupColor ?? slotColor;
    if (typeof (tab as { applyTabColor?: (color: string) => void }).applyTabColor === 'function') {
      (tab as unknown as { applyTabColor: (color: string) => void }).applyTabColor(effective);
    }
  }

  private refreshAllTabIcons(): void {
    for (const tabId of this.tabs.keys()) {
      this.applyEffectiveTabIcon(tabId);
    }
  }

  /** Create a new tab with its own independent Claude session */
  createTab(): SessionTab {
    return this.createClaudeTab();
  }

  /** Create a new tab routed by provider */
  createTabForProvider(provider: ProviderId, viewColumnOverride?: vscode.ViewColumn): SessionTab | CodexSessionTab {
    if (provider === 'codex') { return this.createCodexTab(viewColumnOverride); }
    if (provider === 'remote') { return this.createRemoteTab(viewColumnOverride); }
    return this.createClaudeTab(viewColumnOverride);
  }

  /** Create a new Claude tab */
  createClaudeTab(viewColumnOverride?: vscode.ViewColumn): SessionTab {
    const tabNumber = this.nextTabNumber++;
    const tabColor = TAB_COLORS[(tabNumber - 1) % TAB_COLORS.length];

    // The panel lands near the active tab. In vertical mode a post-create pass
    // collapses stale editor rows and refreshes the in-webview tab rail.
    // restoreFromSnapshot supplies viewColumnOverride during bulk restore.
    const viewColumn = viewColumnOverride ?? this.resolveViewColumnForNewTab();

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
        onSummaryGenerated: (sessionId) => this.notifySummaryChanged(sessionId),
        onProviderChanged: (tabId, provider, cliPathOverride) =>
          this.handleProviderChanged(tabId, provider, cliPathOverride),
      },
      this.sessionStore,
      this.projectAnalyticsStore,
      this.promptHistoryStore,
      this.achievementService,
      this.logDir,
      this.skillGenService,
      this.tokenRatioTracker,
      this.skillUsageTracker,
      this.memorySampler
    );

    this.tabs.set(tab.id, tab);
    this.tabSlotColors.set(tab.id, tabColor);
    this.activeTabId = tab.id;
    if (this.workstreamManager) {
      tab.setWorkstreamManager(this.workstreamManager);
    }
    if (this.particleAcceleratorService) {
      tab.setParticleAcceleratorService(this.particleAcceleratorService);
    }
    tab.setSessionStore(this.sessionStore);
    tab.setOpenTabSessionIdsGetter(() => this.getOpenTabSessionIds());
    this.seedSnapshotEntry(tab);
    this.treeChangeEmitter.fire();
    this.broadcastTabsState();
    this.log(`Tab created: ${tab.id} color=${tabColor} column=${viewColumn} (total: ${this.tabs.size})`);
    this.maybeApplyVerticalLayoutAfterCreate();
    return tab;
  }

  /** Create a new Codex tab */
  createCodexTab(viewColumnOverride?: vscode.ViewColumn): CodexSessionTab {
    const tabNumber = this.nextTabNumber++;
    const tabColor = TAB_COLORS[(tabNumber - 1) % TAB_COLORS.length];

    const viewColumn = viewColumnOverride ?? this.resolveViewColumnForNewTab();

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
        onSummaryGenerated: (sessionId) => this.notifySummaryChanged(sessionId),
        onProviderChanged: (tabId, provider, cliPathOverride) =>
          this.handleProviderChanged(tabId, provider, cliPathOverride),
      },
      this.sessionStore,
      this.projectAnalyticsStore,
      this.promptHistoryStore,
      this.achievementService,
      this.logDir,
      this.skillGenService,
      this.memorySampler
    );

    this.tabs.set(tab.id, tab);
    this.tabSlotColors.set(tab.id, tabColor);
    this.activeTabId = tab.id;
    if (this.workstreamManager) {
      tab.setWorkstreamManager(this.workstreamManager);
    }
    if (this.particleAcceleratorService) {
      tab.setParticleAcceleratorService(this.particleAcceleratorService);
    }
    tab.setSessionStore(this.sessionStore);
    tab.setOpenTabSessionIdsGetter(() => this.getOpenTabSessionIds());
    this.seedSnapshotEntry(tab);
    this.treeChangeEmitter.fire();
    this.broadcastTabsState();
    this.log(`Codex tab created: ${tab.id} color=${tabColor} column=${viewColumn} (total: ${this.tabs.size})`);
    this.maybeApplyVerticalLayoutAfterCreate();
    return tab;
  }

  /** Create a new Happy tab (remote provider routed through SessionTab + CLI override) */
  createRemoteTab(viewColumnOverride?: vscode.ViewColumn): SessionTab {
    const tab = this.createClaudeTab(viewColumnOverride);
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

  /** Create a new Multi-Participant session tab managed by this TabManager. */
  createMultiParticipantTab(
    serverUrl: string,
    agentProvider: 'claude' | 'codex',
    viewColumnOverride?: vscode.ViewColumn,
    authToken?: string,
  ): MultiParticipantSessionTab {
    const tabNumber = this.nextTabNumber++;
    const tabColor = TAB_COLORS[(tabNumber - 1) % TAB_COLORS.length];
    const viewColumn = viewColumnOverride ?? this.resolveViewColumnForNewTab();

    if (this.tabs.size >= 1) {
      void vscode.workspace
        .getConfiguration('workbench.editor')
        .update('wrapTabs', true, vscode.ConfigurationTarget.Global);
    }

    const tabId = `mp-${Date.now()}-${tabNumber}`;
    const tab = new MultiParticipantSessionTab(
      tabId,
      tabNumber,
      serverUrl,
      agentProvider,
      this.context,
      {
        onClosed: (id) => this.handleTabClosed(id),
        onFocused: (id) => this.handleTabFocused(id),
      },
      this.log,
      viewColumn,
      authToken,
    );

    this.tabs.set(tab.id, tab);
    this.tabSlotColors.set(tab.id, tabColor);
    this.activeTabId = tab.id;
    this.seedSnapshotEntry(tab);
    this.treeChangeEmitter.fire();
    this.broadcastTabsState();
    this.log(`MP tab created: ${tab.id} color=${tabColor} column=${viewColumn} server=${serverUrl} (total: ${this.tabs.size})`);
    return tab;
  }

  /** Create a new Smart Search tab. The tab is a regular Claude or Codex tab
   *  with a baked-in system prompt and a read-only tool allow-list, spawned
   *  with cwd=$HOME so it can ripgrep the transcript directories.
   *
   *  The tab's display name defaults to "Search N" with a magenta slot color
   *  so it is visually distinct from chat tabs. Snapshot persistence stores
   *  tabKind='search' and the chosen model so a clean re-spawn happens on
   *  workspace restore (no transcript replay).
   */
  async createSmartSearchTab(opts: {
    provider: 'claude' | 'codex';
    model: string;
  }): Promise<ManagedTab> {
    const homeDir = os.homedir();
    const allowBash = vscode.workspace
      .getConfiguration('claudeMirror')
      .get<boolean>('smartSearch.allowBash', true);
    const claudeAllowedTools = allowBash
      ? ['Read', 'Glob', 'Grep', 'Bash']
      : ['Read', 'Glob', 'Grep'];
    // Codex always has shell access via its sandbox; the bash-vs-no-bash
    // branch only matters for Claude's tool allow-list. The Codex prompt
    // therefore always uses the Bash/ripgrep variant.
    const claudePrompt = buildSmartSearchPrompt({ bashAvailable: allowBash });
    const codexPrompt = buildSmartSearchPrompt({ bashAvailable: true });

    // For Codex search: proactively ensure `codex.cliPath` resolves to a
    // working binary BEFORE the user types their first message. Codex
    // spawns one process per turn, so a missing CLI on the first turn
    // would surface the standard "Setting saved. Please retry your
    // message." flow — annoying for a fresh search tab. We auto-detect
    // up-front and save the resolved path so the first turn just works.
    if (opts.provider === 'codex') {
      try {
        await this.ensureCodexCliConfigured();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.log(`[SmartSearch] Codex CLI auto-detection skipped: ${message}`);
      }
    }

    const tab = this.createTabForProvider(opts.provider);

    if (tab instanceof SessionTab) {
      tab.configureSearchMode({
        appendSystemPrompt: claudePrompt,
        allowedTools: claudeAllowedTools,
        cwdOverride: homeDir,
      });
      await tab.startSession({ cwd: homeDir, model: opts.model });
    } else {
      tab.configureSearchMode({
        appendSystemPrompt: codexPrompt,
        cwdOverride: homeDir,
        model: opts.model,
      });
      await tab.startSession({ cwd: homeDir });
    }

    // Override the slot color so search tabs stand out in the tab bar.
    this.tabSlotColors.set(tab.id, SMART_SEARCH_COLOR);
    this.applyEffectiveTabIcon(tab.id);

    // Update the snapshot entry to mark this as a search tab.
    const entry = this.snapshotEntries.get(tab.id);
    if (entry) {
      entry.tabKind = 'search';
      entry.searchModel = opts.model;
      this.schedulePersistSnapshot();
    }

    this.log(`Smart Search tab created: ${tab.id} provider=${opts.provider} model=${opts.model || '(default)'}`);
    return tab;
  }

  /** Proactive Codex CLI auto-detection used by Smart Search before its
   *  first turn. If `codex.cliPath` is empty, scans common install
   *  locations and saves the best working candidate. If a path is already
   *  configured, leaves it alone (we trust the user's choice and avoid
   *  repeated probes on every tab open). Silent — no toast — because
   *  this runs proactively and most users don't need to know. */
  private async ensureCodexCliConfigured(): Promise<void> {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const configured = (config.get<string>('codex.cliPath', '') || '').trim();
    if (configured && configured !== 'codex') {
      // User has set a non-default path; trust it.
      return;
    }
    const candidates = await findWorkingCodexCliCandidates();
    if (candidates.length === 0) {
      this.log('[SmartSearch] No working Codex CLI candidates found during proactive detection.');
      return;
    }
    const selected = pickPreferredCodexCliCandidate(candidates);
    await config.update('codex.cliPath', selected.path, true);
    this.log(`[SmartSearch] Proactively configured Codex CLI: "${selected.path}" (${selected.version ?? 'unknown'}).`);
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

    if (sourceTab instanceof MultiParticipantSessionTab) {
      throw new Error('Multi-participant tabs do not support provider handoff.');
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
  async closeAllTabs(): Promise<void> {
    // Set the shutdown guard FIRST so the disposal cascade (panel.onDidDispose
    // → onClosed → handleTabClosed) cannot mutate snapshotEntries or schedule
    // a new write that would race with — and overwrite — the final save below.
    this.isShuttingDown = true;
    if (this.snapshotDebounceTimer) {
      clearTimeout(this.snapshotDebounceTimer);
      this.snapshotDebounceTimer = null;
    }

    // Last-chance sessionId refresh from live tabs
    for (const [tabId, tab] of this.tabs.entries()) {
      const entry = this.snapshotEntries.get(tabId);
      if (entry && !entry.sessionId) {
        const sid = tab.sessionId;
        if (sid) {
          entry.sessionId = sid;
          entry.savedAt = new Date().toISOString();
        }
      }
    }

    // Assign visual order before final snapshot
    let order = 0;
    for (const entry of this.snapshotEntries.values()) {
      if (!entry.sessionId && entry.tabKind !== 'search') continue;
      entry.tabOrder = order++;
    }

    // Capture the snapshot BEFORE disposing any tabs so it reflects the
    // currently-open set, not the post-disposal empty state.
    const finalSnapshot = this.buildSnapshot();

    // Restore native tabs if we hid them for vertical layout
    if (this.savedShowTabs) {
      try {
        const editorConfig = vscode.workspace.getConfiguration('workbench.editor');
        await editorConfig.update('showTabs', this.savedShowTabs, vscode.ConfigurationTarget.Global);
        this.log(`[TabLayout] Restored native tabs to "${this.savedShowTabs}" on shutdown`);
      } catch { /* best-effort */ }
      this.savedShowTabs = null;
    }

    for (const tab of this.tabs.values()) {
      tab.dispose();
    }
    this.tabs.clear();
    this.activeTabId = null;
    this.statusBarItem.hide();

    // Awaited so `deactivate()` can hold the extension host alive until the
    // Memento write actually lands on disk.
    try {
      await this.snapshotStore.set(finalSnapshot);
    } catch (err) {
      this.log(`[OpenTabsSnapshot] Failed to persist on shutdown: ${err}`);
    }
  }

  /** Post a message to the active tab's webview */
  postToActiveTab(msg: ExtensionToWebviewMessage): void {
    this.getActiveTab()?.postMessage(msg);
  }

  /** Total number of open tabs */
  get tabCount(): number {
    return this.tabs.size;
  }

  /** Enumerate active CLI processes across all open tabs.
   *  Returns one entry per tab with a running CLI process (Claude shell wrapper or
   *  Codex exec). Used by the memory dashboard to attribute process-tree memory
   *  back to a specific tab. Tabs with no active CLI process are excluded. */
  enumerateCliProcesses(): Array<{ tabId: string; tabName: string; provider: 'claude' | 'codex'; rootPid: number }> {
    const out: Array<{ tabId: string; tabName: string; provider: 'claude' | 'codex'; rootPid: number }> = [];
    for (const tab of this.tabs.values()) {
      if (tab.isDisposed) continue;
      const pid = (tab as { cliPid?: number }).cliPid;
      if (typeof pid !== 'number' || pid <= 0) continue;
      const provider: 'claude' | 'codex' = tab instanceof CodexSessionTab ? 'codex' : 'claude';
      const tabName = (tab as { displayName?: string }).displayName ?? `Tab ${tab.tabNumber}`;
      out.push({ tabId: tab.id, tabName, provider, rootPid: pid });
    }
    return out;
  }

  // --- Internal helpers ---

  /** Get any existing tab (used to find the column for new tabs) */
  private getAnyTab(): ManagedTab | null {
    const first = this.tabs.values().next();
    return first.done ? null : first.value;
  }

  /** Read the user-selected tab arrangement (`horizontal` | `vertical`). */
  private getTabLayout(): 'horizontal' | 'vertical' {
    return vscode.workspace
      .getConfiguration('claudeMirror.tabs')
      .get<'horizontal' | 'vertical'>('layout', 'horizontal');
  }

  /** Pick the initial editor column for a freshly-created tab. Vertical mode
   *  keeps one editor group and renders the tab list inside the webview. */
  private resolveViewColumnForNewTab(): vscode.ViewColumn {
    const existing = this.getActiveTab() ?? this.getAnyTab();
    return existing?.viewColumn ?? vscode.ViewColumn.Beside;
  }

  private maybeApplyVerticalLayoutAfterCreate(): void {
    if (this.isRestoringSnapshot || this.getTabLayout() !== 'vertical') {
      return;
    }
    void this.applyTabLayout('vertical').catch((err) => {
      this.log(`[TabLayout] post-create vertical layout failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  private async joinAllEditorGroups(): Promise<void> {
    try {
      await vscode.commands.executeCommand('workbench.action.joinAllGroups');
    } catch (err) {
      this.log(`[TabLayout] joinAllGroups failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    await this.delay(TabManager.LAYOUT_SETTLE_MS);
  }

  async applyTabLayout(mode: 'horizontal' | 'vertical'): Promise<void> {
    const live = Array.from(this.tabs.values()).filter((t) => !t.isDisposed);
    this.log(`[TabLayout] applyTabLayout invoked: mode=${mode} liveCount=${live.length}`);
    if (live.length === 0) {
      return;
    }
    const activeBeforeLayout = this.getActiveTab();

    if (live.length > 0) {
      // Merge all editor groups into one — handles stacked-row leftovers
      // where multiple groups share the same viewColumn.
      try {
        await this.joinAllEditorGroups();
      } catch { /* best-effort */ }
      this.log(`[TabLayout] Collapsed ${live.length} tab(s) into single group for ${mode} mode`);
    }

    await this.closeEmptyEditorGroups();

    await this.syncNativeTabVisibility(mode);

    if (mode === 'vertical') {
      this.log(`[TabLayout] Applied vertical tab rail layout: ${live.length} tab(s) in one editor group`);
    } else {
      this.log(`[TabLayout] Applied horizontal layout: ${live.length} tab(s) in one editor group`);
    }

    if (activeBeforeLayout && !activeBeforeLayout.isDisposed) {
      activeBeforeLayout.reveal(undefined, false);
    }
    this.broadcastTabsState();
  }

  /**
   * Hide VS Code's native editor tabs when vertical rail is active,
   * restore the original value when switching back to horizontal.
   */
  private async syncNativeTabVisibility(mode: 'horizontal' | 'vertical'): Promise<void> {
    const editorConfig = vscode.workspace.getConfiguration('workbench.editor');
    const current = editorConfig.get<string>('showTabs', 'multiple');

    if (mode === 'vertical') {
      if (current !== 'none') {
        this.savedShowTabs = current;
      }
      await editorConfig.update('showTabs', 'none', vscode.ConfigurationTarget.Global);
      this.log(`[TabLayout] Hid native tabs (was "${this.savedShowTabs}")`);
    } else {
      const restore = this.savedShowTabs ?? 'multiple';
      await editorConfig.update('showTabs', restore, vscode.ConfigurationTarget.Global);
      this.log(`[TabLayout] Restored native tabs to "${restore}"`);
      this.savedShowTabs = null;
    }
  }

  /** Sweep the editor area for empty editor groups left behind by previous
   *  layout passes or manual split cleanup. */
  private async closeEmptyEditorGroups(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    const all = vscode.window.tabGroups.all;
    const empties = all.filter((g) => g.tabs.length === 0);
    if (empties.length === 0) {
      return;
    }
    if (empties.length >= all.length) {
      // Closing every group at once would leave VS Code with no editor
      // groups; skip to be safe.
      this.log('[TabLayout] All editor groups are empty; skipping cleanup to preserve at least one');
      return;
    }
    this.log(`[TabLayout] Closing ${empties.length} empty editor group(s)`);
    try {
      await vscode.window.tabGroups.close(empties);
    } catch (err) {
      this.log(`[TabLayout] closeEmptyEditorGroups failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private wrapHandoffTargetRuntime(tab: SessionTab | CodexSessionTab): HandoffTargetRuntime {
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
    this.tabSlotColors.delete(tabId);
    // During shutdown, the final snapshot has already been captured. Skip
    // mutation so disposal-order callbacks do not wipe the saved state.
    if (!this.isShuttingDown) {
      this.snapshotEntries.delete(tabId);
      this.schedulePersistSnapshot();
    }
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
    this.treeChangeEmitter.fire();
    this.broadcastTabsState();
  }

  private handleTabFocused(tabId: string): void {
    this.activeTabId = tabId;
    const entry = this.snapshotEntries.get(tabId);
    if (entry) {
      entry.lastFocusedAt = new Date().toISOString();
    }
    this.schedulePersistSnapshot();
    this.log(`Tab focused: ${tabId}`);
    this.broadcastTabsState();

    // Re-hide native tabs when a ClaUi panel regains focus in vertical mode
    if (this.getTabLayout() === 'vertical' && this.savedShowTabs) {
      const cfg = vscode.workspace.getConfiguration('workbench.editor');
      const current = cfg.get<string>('showTabs');
      this.log(`[TabLayout] ClaUi panel focused, re-hiding native tabs: current=${current}`);
      if (current !== 'none') {
        void Promise.resolve(cfg.update('showTabs', 'none', vscode.ConfigurationTarget.Global)).catch(() => {});
      }
    }
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
    const preservedKey = `preserved-${sessionId}`;
    this.snapshotEntries.delete(preservedKey);
    this.schedulePersistSnapshot();
  }

  /** Handle a runtime provider/cliPathOverride change on a tab — currently
   *  fired only when SessionTab auto-falls back from Happy to Claude because
   *  the Happy CLI is missing. Updates the persisted snapshot so the tab
   *  doesn't re-spawn as remote on the next workspace load. */
  private handleProviderChanged(
    tabId: string,
    provider: ProviderId,
    cliPathOverride: string | null
  ): void {
    const entry = this.snapshotEntries.get(tabId);
    if (!entry) {
      return;
    }
    entry.provider = provider;
    entry.cliPathOverride = cliPathOverride ?? undefined;
    entry.savedAt = new Date().toISOString();
    this.schedulePersistSnapshot();
    this.applyEffectiveTabIcon(tabId);
    this.treeChangeEmitter.fire();
    this.broadcastTabsState();
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
      this.broadcastTabsState();
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
    if (this.isRestoringSnapshot || this.isShuttingDown) {
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
      // Smart Search tabs are persisted even without a sessionId so they can
      // be re-spawned fresh on restore. Chat tabs still require a sessionId.
      entries: Array.from(this.snapshotEntries.values()).filter(
        (e) => !!e.sessionId || e.tabKind === 'search'
      ),
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

  /**
   * Restore tabs from the last-saved snapshot in this workspace.
   * Returns the number of successfully restored tabs.
   *
   * Designed to be called during activate() after cleanupOrphanedProcesses.
   *
   * Behavior:
   *  - Crash-loop breaker: if the previous activation set the
   *    `restoreInProgress` flag and never cleared it, the prior restore
   *    crashed. Auto-restore is skipped and the user is prompted with a
   *    [Restore now] button. Pass `{ force: true }` to bypass the check
   *    (used by the recovery prompt).
   *  - Lazy resume: only the originally-active tab eagerly spawns its CLI.
   *    All other restored tabs create their webview panel and are armed for
   *    lazy-resume; their CLI process is spawned the first time the user
   *    focuses the tab. This keeps memory and CPU low when many tabs are
   *    restored but only a few are actively used.
   */
  async restoreFromSnapshot(options?: { force?: boolean }): Promise<number> {
    const snapshot = this.snapshotStore.get();
    if (snapshot.entries.length === 0) {
      this.log('[OpenTabsSnapshot] No entries to restore');
      return 0;
    }

    const currentWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    // Filter: workspace match. Search tabs are kept even without a sessionId
    // (they re-spawn fresh on restore). Chat tabs require a sessionId and are
    // de-duped by it.
    const seen = new Set<string>();
    let entries = snapshot.entries
      .filter((e) => e.tabKind === 'search' ? true : !!e.sessionId)
      .filter((e) => !currentWorkspace || !e.workspacePath || e.workspacePath === currentWorkspace)
      .filter((e) => {
        if (e.tabKind === 'search') { return true; }
        if (seen.has(e.sessionId)) { return false; }
        seen.add(e.sessionId);
        return true;
      });

    const maxRestore = vscode.workspace
      .getConfiguration('claudeMirror')
      .get<number>('restoreSessionsMaxTabs', TabManager.MAX_RESTORE);

    let truncated = false;
    if (entries.length > maxRestore) {
      truncated = true;
      entries.sort((a, b) => {
        const tA = a.lastFocusedAt ? new Date(a.lastFocusedAt).getTime() : 0;
        const tB = b.lastFocusedAt ? new Date(b.lastFocusedAt).getTime() : 0;
        return tB - tA;
      });
      const activeIdx = entries.findIndex(e => e.sessionId === snapshot.activeSessionId);
      if (activeIdx > maxRestore - 1) {
        [entries[maxRestore - 1], entries[activeIdx]] = [entries[activeIdx], entries[maxRestore - 1]];
      }
      entries = entries.slice(0, maxRestore);
    }
    entries.sort((a, b) => (a.tabOrder ?? a.tabNumber) - (b.tabOrder ?? b.tabNumber));

    if (entries.length === 0) {
      this.log('[OpenTabsSnapshot] All snapshot entries filtered out');
      return 0;
    }

    // Crash-loop breaker. If the previous activation set the in-progress
    // flag and never cleared it, the previous restore crashed. Skip the
    // automatic restore on this launch and let the user trigger it manually
    // from the prompt. The flag is always cleared before returning so the
    // next launch is allowed to auto-restore again.
    if (!options?.force && this.snapshotStore.isRestoreInProgress()) {
      await this.snapshotStore.setRestoreInProgress(false);
      this.log(
        `[OpenTabsSnapshot] Previous restore did not finish cleanly (${entries.length} pending); skipping auto-restore to break crash loop`,
      );
      void vscode.window
        .showWarningMessage(
          `ClaUi did not finish restoring ${entries.length} session${entries.length === 1 ? '' : 's'} last time, possibly due to a crash. Auto-restore was skipped to avoid a loop.`,
          'Restore now',
          'Skip',
        )
        .then((choice) => {
          if (choice === 'Restore now') {
            void this.restoreFromSnapshot({ force: true });
          }
        });
      return 0;
    }

    this.log(
      `[OpenTabsSnapshot] Restoring ${entries.length} session(s) (lazy mode; only active tab spawns CLI immediately)...`,
    );
    await this.snapshotStore.setRestoreInProgress(true);
    this.isRestoringSnapshot = true;
    let restored = 0;
    let failed = 0;
    const lazyTabs: (SessionTab | CodexSessionTab)[] = [];
    // Pin every restored tab into the same editor column while panels are
    // being recreated. If vertical mode is active, a post-restore pass
    // collapses stale editor rows and refreshes the in-webview tab rail.
    const isVerticalRestore = this.getTabLayout() === 'vertical';
    let restoreColumn: vscode.ViewColumn | undefined = undefined;

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
              const tab = this.createTabForProvider(entry.provider, restoreColumn);
              if (restoreColumn === undefined) {
                // VS Code may not have resolved panel.viewColumn synchronously;
                // fall back to ViewColumn.Two so subsequent tabs still cluster.
                restoreColumn = tab.viewColumn ?? vscode.ViewColumn.Two;
                this.log(`[OpenTabsSnapshot] Pinning subsequent restored tabs to column ${restoreColumn}`);
              }

              // For remote (Happy) tabs, prefer the live setting over the
              // snapshot value in case the user has since moved the CLI.
              if (entry.provider === 'remote' && tab instanceof SessionTab) {
                const livePath = vscode.workspace
                  .getConfiguration('claudeMirror')
                  .get<string>('happy.cliPath', '');
                const chosenPath = livePath || entry.cliPathOverride || 'happy';
                tab.setCliPathOverride(chosenPath);
              }

              const isActive =
                !!snapshot.activeSessionId && entry.sessionId === snapshot.activeSessionId;

              if (entry.tabKind === 'search') {
                // Smart Search tabs re-spawn fresh — no resume, no replay.
                const homeDir = os.homedir();
                const allowBash = vscode.workspace
                  .getConfiguration('claudeMirror')
                  .get<boolean>('smartSearch.allowBash', true);
                const claudeAllowedTools = allowBash
                  ? ['Read', 'Glob', 'Grep', 'Bash']
                  : ['Read', 'Glob', 'Grep'];
                const claudePrompt = buildSmartSearchPrompt({ bashAvailable: allowBash });
                const codexPrompt = buildSmartSearchPrompt({ bashAvailable: true });
                const searchModel = entry.searchModel || '';
                if (tab instanceof SessionTab) {
                  tab.configureSearchMode({
                    appendSystemPrompt: claudePrompt,
                    allowedTools: claudeAllowedTools,
                    cwdOverride: homeDir,
                  });
                  await tab.startSession({ cwd: homeDir, model: searchModel });
                } else {
                  (tab as CodexSessionTab).configureSearchMode({
                    appendSystemPrompt: codexPrompt,
                    cwdOverride: homeDir,
                    model: searchModel,
                  });
                  await tab.startSession({ cwd: homeDir });
                }
                this.tabSlotColors.set(tab.id, SMART_SEARCH_COLOR);
                this.applyEffectiveTabIcon(tab.id);
              } else if (isActive) {
                // Eager start so the user lands on a live, ready session.
                await tab.startSession({ resume: entry.sessionId });
              } else {
                // Lazy: panel + UI ready, but the CLI process is deferred
                // until the user actually focuses this tab.
                tab.prepareForLazyResume(entry.sessionId, entry.customName);
                lazyTabs.push(tab);
              }
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
      await this.snapshotStore.setRestoreInProgress(false);
    }

    if (isVerticalRestore) {
      await this.applyTabLayout('vertical');
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

    // Arm wake-on-focus AFTER all panels are created and the originally-
    // active tab has been revealed. The view-state-active events that fire
    // during panel creation and during reveal() would otherwise prematurely
    // wake every lazy tab. Use a microtask to also let any synchronous
    // view-state changes flush before we accept user-driven focus events.
    setTimeout(() => {
      for (const tab of lazyTabs) {
        if (!tab.isDisposed) {
          tab.armLazyWake();
        }
      }
    }, 0);

    // Repopulate snapshotEntries with the newly-restored tabs so subsequent
    // edits (close, focus, name change) flow through the normal persistence
    // path. Each restored tab already emits onSessionIdAssigned, but
    // seedSnapshotEntry was skipped while isRestoringSnapshot was true.
    // Look up groupId/orderInGroup from the original snapshot so folder
    // assignments survive restore.
    this.snapshotEntries.clear();
    const originalBySessionId = new Map<string, OpenTabSnapshotEntry>();
    const originalSearchByTabNumber = new Map<number, OpenTabSnapshotEntry>();
    for (const e of snapshot.entries) {
      if (e.sessionId) {
        originalBySessionId.set(e.sessionId, e);
      }
      if (e.tabKind === 'search') {
        originalSearchByTabNumber.set(e.tabNumber, e);
      }
    }
    for (const tab of this.tabs.values()) {
      const sid = tab.sessionId ?? '';
      const tabKind = (tab as { getTabKind?: () => string }).getTabKind?.() === 'search' ? 'search' : undefined;
      const originalChat = sid ? originalBySessionId.get(sid) : undefined;
      const originalSearch = tabKind === 'search'
        ? originalSearchByTabNumber.get(tab.tabNumber)
        : undefined;
      const original = originalChat ?? originalSearch;
      this.snapshotEntries.set(tab.id, {
        tabNumber: tab.tabNumber,
        provider: tab.getProvider() as ProviderId,
        sessionId: sid,
        cliPathOverride:
          tab instanceof SessionTab ? (tab.getCliPathOverride() ?? undefined) : undefined,
        workspacePath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        savedAt: new Date().toISOString(),
        customName: original?.customName,
        groupId: original?.groupId,
        orderInGroup: original?.orderInGroup,
        tabKind,
        searchModel: tabKind === 'search' ? originalSearch?.searchModel : undefined,
        lastFocusedAt: original?.lastFocusedAt,
        tabOrder: original?.tabOrder,
      });
      this.applyEffectiveTabIcon(tab.id);
    }

    // Carry forward UNRESTORED entries from the original snapshot so they
    // survive partial restores and can be reopened later.
    const restoredSessionIds = new Set<string>();
    for (const tab of this.tabs.values()) {
      if (tab.sessionId) restoredSessionIds.add(tab.sessionId);
    }
    let preservedCount = 0;
    const MAX_PRESERVED = 50;
    for (const originalEntry of snapshot.entries) {
      if (originalEntry.tabKind === 'search') continue;
      if (!originalEntry.sessionId) continue;
      if (restoredSessionIds.has(originalEntry.sessionId)) continue;
      if (preservedCount >= MAX_PRESERVED) break;
      const preservedKey = `preserved-${originalEntry.sessionId}`;
      this.snapshotEntries.set(preservedKey, originalEntry);
      preservedCount++;
    }

    void this.persistSnapshotNow();
    this.treeChangeEmitter.fire();
    this.broadcastTabsState();

    if (truncated) {
      void vscode.window.showInformationMessage(
        `ClaUi restored the ${maxRestore} most recent sessions. Older sessions can be reopened from Conversation History (Ctrl+Shift+H).`
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
