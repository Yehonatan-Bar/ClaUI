import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { TabManager, TabSummary } from '../session/TabManager';
import { SessionTab } from '../session/SessionTab';
import { CodexSessionTab } from '../session/CodexSessionTab';
import { MultiParticipantSessionTab } from '../multiparticipant/MultiParticipantSessionTab';
import type { SessionStore } from '../session/SessionStore';
import type { TabGroupStore } from '../session/TabGroupStore';
import { SessionDiscovery } from '../session/SessionDiscovery';
import { ConversationReader } from '../session/ConversationReader';
import { CodexConversationReader } from '../session/CodexConversationReader';
import { ChatSearchService } from '../session/ChatSearchService';
import { BridgeProviderService } from '../bridge/BridgeProviderService';
import { readCodexModelOptions } from '../process/codexModelCache';
import { CLAUDE_MODEL_OPTIONS } from '../../webview/utils/claudeModelDisplay';
import type { ExtensionToWebviewMessage, ProviderId, WebviewToExtensionMessage, SerializedChatMessage } from '../types/webview-messages';
import { ERROR_CODES, RemoteControlError, type AccessLevel } from '../../remote-control-shared/protocol';
import { findTool } from '../../remote-control-shared/toolCatalog';
import { validateArgs } from './core/argValidator';
import { classifyCommand, classifySettingWrite, classifyUiAction, isSecretSettingKey, shortSettingKey } from './core/accessPolicy';
import { EventLog, type EventFilter } from './core/EventLog';
import { TabStateTracker, type TranscriptEntry } from './core/TabStateTracker';
import { armTurnWaiter, type TurnOutcome } from './core/TurnWaiter';
import { extractText, formatBlocksAsText, listToolUses, normalizeContent, summarizeValue, toolResultText } from './core/contentFormat';
import { compactPayload, truncateString } from './core/payloadCompactor';
import { parseScheduleTime } from './core/scheduleTime';
import uiCatalog from './uiActionCatalog.generated.json';

/**
 * Implements every 'instance' tool of the remote-control catalog against the
 * live extension (TabManager, stores, chat-UI action path).
 *
 * Design rule ("hybrid API"): lifecycle operations (create/close/focus/
 * rename/resume/groups) call host-side APIs directly; chat interactions
 * (send, approvals, model/permission/effort, cancel, ...) re-enter the
 * webview action handler via tab.dispatchRemoteMessage(), so they behave
 * exactly like a click in the chat UI and the UI stays in sync.
 */

type ChatTab = SessionTab | CodexSessionTab;
type AnyTab = ChatTab | MultiParticipantSessionTab;

export interface ToolExecutionContext {
  signal: AbortSignal;
  requestId: number;
}

export interface ToolHandlerDeps {
  context: vscode.ExtensionContext;
  tabManager: TabManager;
  sessionStore: SessionStore;
  tabGroupStore: TabGroupStore;
  tracker: TabStateTracker;
  eventLog: EventLog;
  log: (msg: string) => void;
  getAccessLevel: () => AccessLevel;
  allowSensitiveActions: () => boolean;
  /** Resolves with the next RAW outbound message of one of `types` from `tabId` (null on timeout). */
  waitForOutbound: (tabId: string, types: string[], timeoutMs: number, signal: AbortSignal) => {
    promise: Promise<Record<string, unknown> | null>;
    cancel: () => void;
  };
  instanceSummary: () => Record<string, unknown>;
}

interface UiCatalogEntry {
  type: string;
  interface: string;
  fields: Array<{ name: string; type: string; optional: boolean; doc?: string }>;
  doc?: string;
  extends?: string[];
}

const UI_ACTIONS = (uiCatalog as { uiActions: UiCatalogEntry[] }).uiActions;
const UI_EVENTS = (uiCatalog as { uiEvents: UiCatalogEntry[] }).uiEvents;
const UI_ACTION_TYPES = new Set(UI_ACTIONS.map((a) => a.type));

const CLAUDE_EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'];
const CODEX_EFFORTS = ['', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const IMAGE_TYPES: Record<string, 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function fail(code: string, message: string, details?: unknown): never {
  throw new RemoteControlError(code, message, details);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function timeoutMs(value: unknown, defaultSec: number): number {
  const sec = typeof value === 'number' && Number.isFinite(value) ? value : defaultSec;
  return Math.max(1, Math.min(3600, sec)) * 1000;
}

function isoTime(ms: number | undefined): string | undefined {
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

export class RemoteControlToolHandlers {
  private readonly sendLocks = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: ToolHandlerDeps) {}

  // =========================================================================
  // Entry point: validation + central authorization, then dispatch.
  // =========================================================================

  async call(name: string, rawArgs: Record<string, unknown>, ctx: ToolExecutionContext): Promise<unknown> {
    const def = findTool(name);
    if (!def || def.scope !== 'instance') {
      fail(ERROR_CODES.notFound, `Unknown tool: ${name}`);
    }
    const errors = validateArgs(rawArgs, def.inputSchema);
    if (errors.length > 0) {
      fail(ERROR_CODES.invalidArgs, `Invalid arguments for ${name}: ${errors.slice(0, 8).join('; ')}`, { errors });
    }
    if (this.deps.getAccessLevel() === 'readOnly' && def.mutating) {
      const queryDispatch =
        name === 'dispatch_ui_action' && classifyUiAction(String((rawArgs.action as { type?: unknown })?.type ?? '')) === 'query';
      if (!queryDispatch) {
        fail(ERROR_CODES.readOnly, `"${name}" changes state, but ClaUi remote control is in read-only mode (claudeMirror.remoteControl.accessLevel).`);
      }
    }
    const args = rawArgs;
    switch (name) {
      case 'get_status': return this.getStatus();
      case 'list_tabs': return { tabs: this.listTabs() };
      case 'get_tab': return this.getTab(args);
      case 'list_models': return this.listModels();
      case 'create_tab': return this.createTab(args, ctx);
      case 'close_tab': return this.closeTab(args);
      case 'focus_tab': return this.focusTab(args);
      case 'rename_tab': return this.renameTab(args);
      case 'resume_session': return this.resumeOrFork(args, ctx, false);
      case 'fork_session': return this.resumeOrFork(args, ctx, true);
      case 'hibernate_tab': return this.hibernateTab(args);
      case 'wake_tab': return this.wakeTab(args, ctx);
      case 'stop_session': return this.simpleDispatch(args, { type: 'stopSession' } as WebviewToExtensionMessage, 'stopped');
      case 'clear_session': return this.simpleDispatch(args, { type: 'clearSession' } as WebviewToExtensionMessage, 'cleared');
      case 'send_message': return this.sendMessage(args, ctx);
      case 'wait_for_idle': return this.waitForIdle(args, ctx);
      case 'get_messages': return this.getMessages(args);
      case 'get_last_response': return this.getLastResponse(args);
      case 'cancel_response': return this.simpleDispatch(args, { type: 'cancelRequest' } as WebviewToExtensionMessage, 'cancel requested');
      case 'compact_context':
        return this.simpleDispatch(args, { type: 'compact', instructions: str(args.instructions) } as WebviewToExtensionMessage, 'compaction requested');
      case 'schedule_message': return this.scheduleMessage(args);
      case 'cancel_scheduled_message':
        return this.simpleDispatch(args, { type: 'cancelScheduledMessage' } as WebviewToExtensionMessage, 'scheduled message cancelled');
      case 'list_pending_approvals': return this.listPendingApprovals();
      case 'respond_to_approval': return this.respondToApproval(args, ctx);
      case 'answer_question': return this.answerQuestion(args, ctx);
      case 'set_model': return this.setModel(args);
      case 'set_permission_mode': return this.setPermissionMode(args);
      case 'set_effort': return this.setEffort(args);
      case 'set_fast_mode': return this.setFastMode(args);
      case 'switch_provider': return this.switchProvider(args);
      case 'list_sessions': return this.listSessions(args);
      case 'search_conversations': return this.searchConversations(args);
      case 'list_groups': return this.listGroups();
      case 'create_group': return this.createGroup(args);
      case 'move_tab_to_group': return this.moveTabToGroup(args);
      case 'delete_group': return this.deleteGroup(args);
      case 'get_settings': return this.getSettings(args);
      case 'update_setting': return this.updateSetting(args);
      case 'list_commands': return this.listCommands();
      case 'execute_command': return this.executeCommand(args);
      case 'list_ui_actions': return this.listUiActions(args);
      case 'dispatch_ui_action': return this.dispatchUiAction(args, ctx);
      case 'get_events': return this.getEvents(args, ctx);
      case 'show_notification': return this.showNotification(args);
      default:
        return fail(ERROR_CODES.notFound, `Tool not implemented: ${name}`);
    }
  }

  // =========================================================================
  // Tab resolution / helpers
  // =========================================================================

  private resolveTab(ref: unknown): AnyTab {
    const tm = this.deps.tabManager;
    if (ref === undefined || ref === null || ref === '') {
      const active = tm.getActiveTab();
      if (active) {
        return active;
      }
      const first = tm.listTabs()[0];
      const fallback = first ? tm.getTabById(first.id) : null;
      if (fallback) {
        return fallback;
      }
      return fail(ERROR_CODES.notFound, 'No ClaUi tab is open. Call create_tab first.');
    }
    const summaries = tm.listTabs();
    const asText = String(ref).trim();
    const byId = tm.getTabById(asText);
    if (byId) {
      return byId;
    }
    if (/^\d+$/.test(asText)) {
      const match = summaries.find((t) => t.tabNumber === Number(asText));
      const tab = match ? tm.getTabById(match.id) : null;
      if (tab) {
        return tab;
      }
    }
    const lower = asText.toLowerCase();
    const named = summaries.filter((t) => t.displayName.trim().toLowerCase() === lower);
    if (named.length === 1) {
      const tab = tm.getTabById(named[0].id);
      if (tab) {
        return tab;
      }
    }
    if (named.length > 1) {
      return fail(ERROR_CODES.invalidArgs, `Tab name "${asText}" is ambiguous; use the tab id.`, { candidates: named.map((t) => t.id) });
    }
    return fail(ERROR_CODES.notFound, `No tab matches "${asText}".`, {
      openTabs: summaries.map((t) => ({ id: t.id, number: t.tabNumber, name: t.displayName })),
    });
  }

  private resolveChatTab(ref: unknown): ChatTab {
    const tab = this.resolveTab(ref);
    if (tab instanceof SessionTab || tab instanceof CodexSessionTab) {
      return tab;
    }
    return fail(ERROR_CODES.unsupported, `Tab ${tab.id} is a multi-participant session; this tool needs a Claude or Codex chat tab.`);
  }

  private dispatch(tab: ChatTab, message: WebviewToExtensionMessage): void {
    try {
      tab.dispatchRemoteMessage(message);
    } catch (err) {
      fail(ERROR_CODES.unsupported, err instanceof Error ? err.message : String(err));
    }
  }

  private async simpleDispatch(args: Record<string, unknown>, message: WebviewToExtensionMessage, outcome: string): Promise<unknown> {
    const tab = this.resolveChatTab(args.tabId);
    this.dispatch(tab, message);
    return { tabId: tab.id, result: outcome };
  }

  private async waitUntil(check: () => boolean, timeout: number, signal?: AbortSignal, intervalMs = 150): Promise<boolean> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (check()) {
        return true;
      }
      if (signal?.aborted) {
        return false;
      }
      await sleep(intervalMs);
    }
    return check();
  }

  private async ensureWebviewReady(tab: ChatTab, signal?: AbortSignal): Promise<void> {
    await this.waitUntil(() => tab.isDisposed || tab.isWebviewReadyState, 20_000, signal);
  }

  /** Serialize remote sends per tab so two callers never interleave turns. */
  private async withSendLock<T>(tabId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.sendLocks.get(tabId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The next caller waits for this one's gate; the chain itself never rejects.
    const tail = previous.catch(() => undefined).then(() => gate);
    this.sendLocks.set(tabId, tail);
    await previous.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (this.sendLocks.get(tabId) === tail) {
        this.sendLocks.delete(tabId);
      }
    }
  }

  private newTabSince(before: Set<string>): AnyTab | null {
    const created = this.deps.tabManager.listTabs().filter((t) => !before.has(t.id));
    if (created.length === 0) {
      return null;
    }
    const newest = created.sort((a, b) => b.tabNumber - a.tabNumber)[0];
    return this.deps.tabManager.getTabById(newest.id);
  }

  private configuredProvider(): ProviderId {
    return vscode.workspace.getConfiguration('claudeMirror').get<ProviderId>('provider', 'claude');
  }

  private workspacePath(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  // =========================================================================
  // Status & discovery
  // =========================================================================

  private describeTab(summary: TabSummary, activeId: string | null): Record<string, unknown> {
    const tab = this.deps.tabManager.getTabById(summary.id);
    const state = this.deps.tracker.getState(summary.id);
    const selectedModel = tab instanceof SessionTab ? tab.getSelectedModel() : undefined;
    const kind =
      tab instanceof MultiParticipantSessionTab ? 'multiparticipant' : tab instanceof SessionTab ? tab.getTabKind() : 'chat';
    return {
      id: summary.id,
      number: summary.tabNumber,
      name: summary.displayName,
      provider: summary.provider,
      kind,
      active: summary.id === activeId,
      model: state.model ?? (selectedModel || null),
      selectedModel: selectedModel ?? null,
      sessionId: summary.sessionId,
      busy: summary.isBusy,
      running: tab && !(tab instanceof MultiParticipantSessionTab) ? tab.isRunning : null,
      sleepState: summary.sleepState,
      pendingApproval: state.pendingApproval ? { kind: state.pendingApproval.kind, toolName: state.pendingApproval.toolName } : null,
      groupId: summary.groupId ?? null,
      worktreePath: summary.worktreePath,
      claudeAccountProfile: summary.claudeAccountProfileLabel,
      costUsd: state.cost?.totalUsd ?? null,
      turns: state.turnCount,
      messageCount: this.deps.tracker.getTranscript(summary.id).length,
      lastActivityAt: state.lastActivityAt,
    };
  }

  private activeTabId(): string | null {
    return this.deps.tabManager.getActiveTab()?.id ?? null;
  }

  private listTabs(): Record<string, unknown>[] {
    const activeId = this.activeTabId();
    return this.deps.tabManager.listTabs().map((s) => this.describeTab(s, activeId));
  }

  private getStatus(): unknown {
    const cfg = vscode.workspace.getConfiguration('claudeMirror');
    const tabs = this.listTabs();
    return {
      ...this.deps.instanceSummary(),
      workspace: {
        name: vscode.workspace.name ?? null,
        folders: (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
      },
      tabs: {
        count: tabs.length,
        activeTabId: this.activeTabId(),
        busy: tabs.filter((t) => t.busy).map((t) => t.id),
        pendingApprovals: tabs.filter((t) => t.pendingApproval).map((t) => t.id),
      },
      defaults: {
        provider: cfg.get<string>('provider', 'claude'),
        model: cfg.get<string>('model', ''),
        permissionMode: cfg.get<string>('permissionMode', 'full-access'),
        effort: cfg.get<string>('effortLevel', ''),
      },
      eventSeq: this.deps.eventLog.lastSeq,
    };
  }

  private getTab(args: Record<string, unknown>): unknown {
    const tab = this.resolveTab(args.tabId);
    const summary = this.deps.tabManager.listTabs().find((t) => t.id === tab.id);
    if (!summary) {
      return fail(ERROR_CODES.notFound, `Tab ${tab.id} is no longer open.`);
    }
    const state = this.deps.tracker.getState(tab.id);
    const transcript = this.deps.tracker.getTranscript(tab.id);
    return {
      ...this.describeTab(summary, this.activeTabId()),
      permissionMode: state.permissionMode,
      claudeEffort: state.claudeEffort,
      codexEffort: state.codexEffort,
      fastMode: state.fastMode,
      pendingApprovalDetails: this.deps.tracker.describePendingApproval(tab.id),
      lastTurn: state.lastTurn ? compactPayload(state.lastTurn) : null,
      cost: state.cost,
      lastError: state.lastError,
      usageLimit: state.usageLimit,
      usageQueuedPrompt: state.usageQueued,
      scheduledMessage: state.scheduledMessage
        ? { text: state.scheduledMessage.text, at: isoTime(state.scheduledMessage.scheduledAtMs) }
        : null,
      sessionEnded: state.sessionEnded,
      webviewReady: tab instanceof MultiParticipantSessionTab ? null : tab.isWebviewReadyState,
      hibernated: tab instanceof SessionTab ? { light: tab.isHibernatedLight, deep: tab.isHibernatedDeep } : null,
      transcript: {
        entries: transcript.length,
        firstIndex: transcript[0]?.index ?? null,
        lastIndex: transcript[transcript.length - 1]?.index ?? null,
      },
    };
  }

  private listModels(): unknown {
    let codex: Array<{ label: string; value: string }> = [];
    try {
      codex = readCodexModelOptions().map((o) => ({ label: o.label, value: o.value }));
    } catch {
      codex = [];
    }
    let bridge: Array<{ label: string; value: string }> = [];
    try {
      bridge = (BridgeProviderService.get()?.modelOptions() ?? []).map((o) => ({ label: o.label, value: o.value }));
    } catch {
      bridge = [];
    }
    return {
      claude: CLAUDE_MODEL_OPTIONS.map((o) => ({ label: o.label, value: o.value })),
      codex,
      bridge,
      note: 'Pass "value" to set_model / create_tab. Bridge models (value "bridge:...") run in Claude tabs via the bundled bridge runtime.',
    };
  }

  // =========================================================================
  // Tab lifecycle
  // =========================================================================

  private async createTab(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<unknown> {
    const tm = this.deps.tabManager;
    const provider = (str(args.provider) as ProviderId | undefined) ?? this.configuredProvider();
    const previousActive = this.activeTabId();
    const before = new Set(tm.listTabs().map((t) => t.id));

    const profileId = str(args.accountProfileId);
    if (profileId) {
      if (provider !== 'claude') {
        fail(ERROR_CODES.invalidArgs, 'accountProfileId applies to Claude tabs only.');
      }
      const profile = tm.getClaudeAccountProfileStore().getProfile(profileId);
      if (!profile) {
        fail(ERROR_CODES.notFound, `Unknown Claude account profile: ${profileId}`, {
          profiles: tm.getClaudeAccountProfileStore().list().map((p) => ({ id: p.id, label: p.label })),
        });
      }
      const tab = tm.createClaudeTab();
      tm.applyClaudeAccountProfile(tab, profile);
      await tab.startSession({ defer: true });
    } else {
      await vscode.commands.executeCommand('claudeMirror.startSession', { provider });
    }

    const created = this.newTabSince(before);
    if (!created || created instanceof MultiParticipantSessionTab) {
      return fail(ERROR_CODES.internal, 'The tab was not created (see Output > ClaUi).');
    }
    await this.ensureWebviewReady(created, ctx.signal);
    const notes: string[] = [];

    if (typeof args.name === 'string' && args.name.trim()) {
      created.applyRemoteRename(args.name);
    }
    if (typeof args.model === 'string') {
      this.dispatch(created, { type: 'setModel', model: args.model } as WebviewToExtensionMessage);
      notes.push(`model set to "${args.model || 'default'}"`);
    }
    if (typeof args.permissionMode === 'string') {
      this.applyPermissionMode(created, args.permissionMode);
      notes.push(`permission mode ${args.permissionMode}`);
    }
    if (typeof args.effort === 'string') {
      this.applyEffort(created, args.effort);
      notes.push(`effort ${args.effort || 'default'}`);
    }
    if (args.focus === false && previousActive) {
      tm.focusTab(previousActive);
    }

    const base = {
      tabId: created.id,
      number: created.tabNumber,
      name: created.displayName,
      provider: created.getProvider(),
      configured: notes,
    };
    if (typeof args.prompt === 'string' && args.prompt.trim()) {
      // Model switches restart the CLI; let that settle before the first prompt.
      if (typeof args.model === 'string') {
        await this.waitUntil(() => !created.isBusyState(), 30_000, ctx.signal);
      }
      const turn = await this.sendToTab(created, { text: args.prompt, wait: args.wait, timeoutSec: args.timeoutSec }, ctx);
      return { ...base, ...(turn as Record<string, unknown>) };
    }
    return base;
  }

  private closeTab(args: Record<string, unknown>): unknown {
    const tab = this.resolveTab(args.tabId);
    const id = tab.id;
    const sessionId = tab.sessionId;
    this.deps.tabManager.closeTab(id);
    return { closed: id, sessionId, hint: sessionId ? 'Reopen later with resume_session.' : undefined };
  }

  private focusTab(args: Record<string, unknown>): unknown {
    const tab = this.resolveTab(args.tabId);
    this.deps.tabManager.focusTab(tab.id);
    return { focused: tab.id };
  }

  private renameTab(args: Record<string, unknown>): unknown {
    const tab = this.resolveChatTab(args.tabId);
    tab.applyRemoteRename(String(args.name));
    return { tabId: tab.id, name: tab.displayName };
  }

  private async resumeOrFork(args: Record<string, unknown>, ctx: ToolExecutionContext, fork: boolean): Promise<unknown> {
    const sessionId = String(args.sessionId).trim();
    const stored = this.deps.sessionStore.getSession(sessionId);
    const provider = (str(args.provider) as ProviderId | undefined) ?? stored?.provider ?? 'claude';
    const before = new Set(this.deps.tabManager.listTabs().map((t) => t.id));
    await vscode.commands.executeCommand(fork ? 'claudeMirror.history.fork' : 'claudeMirror.history.resume', sessionId, provider);
    const created = this.newTabSince(before);
    if (!created || created instanceof MultiParticipantSessionTab) {
      return fail(ERROR_CODES.internal, `Failed to ${fork ? 'fork' : 'resume'} session ${sessionId} (see Output > ClaUi).`);
    }
    await this.ensureWebviewReady(created, ctx.signal);
    const base = { tabId: created.id, number: created.tabNumber, name: created.displayName, provider, sessionId, forked: fork };
    if (!fork && typeof args.prompt === 'string' && args.prompt.trim()) {
      const turn = await this.sendToTab(created, { text: args.prompt, wait: args.wait, timeoutSec: args.timeoutSec }, ctx);
      return { ...base, ...(turn as Record<string, unknown>) };
    }
    return base;
  }

  private hibernateTab(args: Record<string, unknown>): unknown {
    const tab = this.resolveTab(args.tabId);
    const deep = args.deep === true;
    const ok = deep ? this.deps.tabManager.deepHibernateTab(tab.id) : this.deps.tabManager.lightHibernateTab(tab.id);
    if (!ok) {
      return fail(
        ERROR_CODES.unsupported,
        `Tab ${tab.id} cannot ${deep ? 'deep-' : ''}hibernate right now (busy, no session yet, already sleeping, or not a Claude chat tab).`,
      );
    }
    return { tabId: tab.id, hibernated: deep ? 'deep' : 'light' };
  }

  private async wakeTab(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<unknown> {
    const tab = this.resolveChatTab(args.tabId);
    if (!(tab instanceof SessionTab) || (!tab.isHibernatedDeep && !tab.isHibernatedLight)) {
      return { tabId: tab.id, woke: false, note: 'Tab is not hibernated.' };
    }
    const wasDeep = tab.isHibernatedDeep;
    this.dispatch(tab, { type: wasDeep ? 'wakeFromDeepHibernation' : 'wakeFromHibernation' } as WebviewToExtensionMessage);
    const ok = await this.waitUntil(
      () => tab.isDisposed || (!tab.isHibernatedDeep && !tab.isHibernatedLight && (!wasDeep || tab.isWebviewReadyState)),
      timeoutMs(args.timeoutSec, 60),
      ctx.signal,
    );
    return { tabId: tab.id, woke: ok, from: wasDeep ? 'deep' : 'light' };
  }

  // =========================================================================
  // Conversation
  // =========================================================================

  private async sendMessage(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<unknown> {
    const tab = this.resolveChatTab(args.tabId);
    return this.sendToTab(tab, args, ctx);
  }

  private async loadImages(raw: unknown): Promise<Array<{ base64: string; mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' }>> {
    if (!Array.isArray(raw) || raw.length === 0) {
      return [];
    }
    const out: Array<{ base64: string; mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' }> = [];
    for (const [i, item] of raw.entries()) {
      const image = item as { path?: unknown; base64?: unknown; mediaType?: unknown };
      if (typeof image.path === 'string') {
        if (!path.isAbsolute(image.path)) {
          fail(ERROR_CODES.invalidArgs, `images[${i}].path must be absolute`);
        }
        const resolved = path.resolve(image.path);
        const mediaType = IMAGE_TYPES[path.extname(resolved).toLowerCase()];
        if (!mediaType) {
          fail(ERROR_CODES.invalidArgs, `images[${i}].path must be a .png, .jpg, .jpeg, .gif or .webp file`);
        }
        let stat: fs.Stats;
        try {
          stat = await fs.promises.stat(resolved);
        } catch {
          return fail(ERROR_CODES.notFound, `images[${i}].path does not exist: ${resolved}`);
        }
        if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) {
          fail(ERROR_CODES.invalidArgs, `images[${i}].path must be a file of at most 10 MB`);
        }
        out.push({ base64: (await fs.promises.readFile(resolved)).toString('base64'), mediaType });
      } else if (typeof image.base64 === 'string') {
        const mediaType = image.mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
        if (!mediaType) {
          fail(ERROR_CODES.invalidArgs, `images[${i}].mediaType is required with base64`);
        }
        const data = image.base64.replace(/^data:[^;]+;base64,/, '');
        if (Buffer.byteLength(data, 'base64') > MAX_IMAGE_BYTES) {
          fail(ERROR_CODES.invalidArgs, `images[${i}] is larger than 10 MB`);
        }
        out.push({ base64: data, mediaType });
      } else {
        fail(ERROR_CODES.invalidArgs, `images[${i}] needs either "path" or "base64"`);
      }
    }
    return out;
  }

  /** Shared by send_message, create_tab(prompt) and resume_session(prompt). */
  private async sendToTab(tab: ChatTab, args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<unknown> {
    const text = String(args.text ?? '');
    const images = await this.loadImages(args.images);
    if (!text.trim() && images.length === 0) {
      fail(ERROR_CODES.invalidArgs, 'text must not be empty');
    }
    const wait = bool(args.wait, true);
    const limitMs = timeoutMs(args.timeoutSec, 600);
    const ifBusy = str(args.ifBusy) ?? 'wait';
    const startedAt = Date.now();

    const abandoned = (): Record<string, unknown> => ({
      tabId: tab.id,
      status: 'cancelled',
      sent: false,
      note: 'The caller disconnected or timed out before the message was sent; it was NOT sent.',
    });

    return this.withSendLock(tab.id, async () => {
      // Waiting for the lock ignores the signal; a caller that gave up meanwhile must not trigger a turn.
      if (ctx.signal.aborted) {
        return abandoned();
      }
      // Deep-hibernated tabs have no live chat UI: wake them first.
      if (tab instanceof SessionTab && tab.isHibernatedDeep) {
        this.dispatch(tab, { type: 'wakeFromDeepHibernation' } as WebviewToExtensionMessage);
        await this.waitUntil(() => tab.isDisposed || (!tab.isHibernatedDeep && tab.isWebviewReadyState), 60_000, ctx.signal);
      }
      await this.ensureWebviewReady(tab, ctx.signal);

      const tracker = this.deps.tracker;
      if (tab.isBusyState() && !tracker.getState(tab.id).pendingApproval && args.steer !== true) {
        if (ifBusy === 'reject') {
          fail(ERROR_CODES.unsupported, `Tab ${tab.id} is busy with another turn (ifBusy="reject").`);
        }
        if (ifBusy === 'wait') {
          const idle = await this.waitUntil(() => !tab.isBusyState(), limitMs, ctx.signal, 300);
          if (!idle) {
            return { tabId: tab.id, status: 'timeout', sent: false, note: 'The tab stayed busy; the message was NOT sent. Retry later or use ifBusy="queue".' };
          }
        }
      }

      if (ctx.signal.aborted) {
        return abandoned();
      }
      const baselineIndex = tracker.nextTranscriptIndex(tab.id);
      const waiter = wait
        ? armTurnWaiter(this.deps.eventLog, {
            tabId: tab.id,
            timeoutMs: limitMs,
            initiallyBusy: false,
            startGraceMs: 45_000,
            isBusy: () => tab.isBusyState(),
            hasPendingApproval: () => !!tracker.getState(tab.id).pendingApproval,
            signal: ctx.signal,
          })
        : null;

      const message =
        images.length > 0
          ? ({ type: 'sendMessageWithImages', text, images, steer: args.steer === true || undefined } as WebviewToExtensionMessage)
          : ({ type: 'sendMessage', text, steer: args.steer === true || undefined } as WebviewToExtensionMessage);
      try {
        this.dispatch(tab, message);
      } catch (err) {
        waiter?.cancel();
        throw err;
      }
      if (!waiter) {
        return { tabId: tab.id, status: 'sent', sent: true, hint: 'Use wait_for_idle or get_events to follow the reply.' };
      }
      const outcome = await waiter.promise;
      return this.buildTurnResult(tab, outcome, baselineIndex, startedAt);
    });
  }

  private buildTurnResult(tab: ChatTab, outcome: TurnOutcome, baselineIndex: number, startedAt: number): Record<string, unknown> {
    const tracker = this.deps.tracker;
    const state = tracker.getState(tab.id);
    const entries = tracker.entriesSince(tab.id, baselineIndex).filter((e) => e.role === 'assistant' && !e.synthetic);
    const toolResults = tracker.getToolResults(tab.id);
    const response = entries.map((e) => extractText(e.content)).filter(Boolean).join('\n\n');
    const toolCalls = entries.flatMap((e) =>
      listToolUses(e.content).map((t) => {
        const result = t.id ? toolResults.get(t.id) : undefined;
        return {
          name: t.name,
          input: t.input,
          ...(result ? { result: truncateString(toolResultText(result.content), 400), isError: result.isError } : {}),
        };
      }),
    );
    const hints: Record<string, string> = {
      awaiting_approval: 'The tab is waiting for you: see pendingApproval, then call respond_to_approval or answer_question.',
      timeout: 'Still running. Call wait_for_idle to keep waiting, or get_events to follow progress.',
      queued_usage_limit: 'Usage limit reached; ClaUi will send the prompt automatically after the reset.',
      idle: 'Nothing started (the message may have been consumed as an answer, or the session is not running). Check get_tab / lastError.',
      session_ended: 'The session ended. Send another message to start again, or use resume_session.',
      cancelled: 'The response was cancelled.',
    };
    return {
      tabId: tab.id,
      status: outcome.status,
      response,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      pendingApproval: outcome.status === 'awaiting_approval' ? tracker.describePendingApproval(tab.id) : undefined,
      error: outcome.error ?? (outcome.status === 'error' ? state.lastError?.message : undefined),
      turn: outcome.status === 'completed' && state.lastTurn ? compactPayload(state.lastTurn, { maxArrayLength: 30 }) : undefined,
      cost: state.cost ?? undefined,
      sessionId: tab.sessionId,
      durationMs: Date.now() - startedAt,
      hint: hints[outcome.status],
    };
  }

  private async waitForIdle(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<unknown> {
    const tab = this.resolveChatTab(args.tabId);
    const tracker = this.deps.tracker;
    const transcript = tracker.getTranscript(tab.id);
    let baseline = 0;
    for (let i = transcript.length - 1; i >= 0; i--) {
      if (transcript[i].role === 'user' && transcript[i].source !== 'auto-prompt') {
        baseline = transcript[i].index + 1;
        break;
      }
    }
    const startedAt = Date.now();
    if (!tab.isBusyState()) {
      const status = tracker.getState(tab.id).pendingApproval ? 'awaiting_approval' : 'completed';
      return this.buildTurnResult(tab, { status, endSeq: this.deps.eventLog.lastSeq }, baseline, startedAt);
    }
    const waiter = armTurnWaiter(this.deps.eventLog, {
      tabId: tab.id,
      timeoutMs: timeoutMs(args.timeoutSec, 600),
      initiallyBusy: true,
      isBusy: () => tab.isBusyState(),
      hasPendingApproval: () => !!tracker.getState(tab.id).pendingApproval,
      signal: ctx.signal,
    });
    return this.buildTurnResult(tab, await waiter.promise, baseline, startedAt);
  }

  private readSessionFromDisk(sessionId: string, provider: string): SerializedChatMessage[] {
    const log = (msg: string) => this.deps.log(`[RemoteControl] ${msg}`);
    if (provider === 'codex') {
      return new CodexConversationReader(log).readSession(sessionId, this.workspacePath());
    }
    return new ConversationReader(log).readSession(sessionId, this.workspacePath());
  }

  private formatEntries(
    entries: Array<Pick<TranscriptEntry, 'role' | 'content' | 'time' | 'model' | 'source' | 'synthetic'> & { index: number }>,
    args: Record<string, unknown>,
    toolResults?: Map<string, { content: unknown; isError: boolean }>,
  ): Record<string, unknown>[] {
    const format = str(args.format) ?? 'text';
    const includeTools = bool(args.includeTools, true);
    const includeThinking = bool(args.includeThinking, false);
    return entries.map((e) => {
      const base: Record<string, unknown> = {
        index: e.index,
        role: e.role,
        time: isoTime(e.time),
        ...(e.model ? { model: e.model } : {}),
        ...(e.source === 'auto-prompt' ? { source: 'auto-prompt' } : {}),
        ...(e.synthetic ? { synthetic: true } : {}),
      };
      if (format === 'blocks') {
        const blocks = normalizeContent(e.content).filter(
          (b) => (includeThinking || b.type !== 'thinking') && (includeTools || (b.type !== 'tool_use' && b.type !== 'tool_result')),
        );
        return { ...base, content: compactPayload(blocks, { maxStringLength: 20_000 }) };
      }
      return { ...base, text: formatBlocksAsText(e.content, { includeTools, includeThinking }, toolResults) };
    });
  }

  private page<T>(items: T[], args: Record<string, unknown>): { slice: T[]; total: number; offset: number; limit: number } {
    const limit = typeof args.limit === 'number' ? Math.floor(args.limit) : 20;
    const offset = typeof args.offset === 'number' ? Math.floor(args.offset) : 0;
    const end = Math.max(0, items.length - offset);
    const start = Math.max(0, end - limit);
    return { slice: items.slice(start, end), total: items.length, offset, limit };
  }

  private getMessages(args: Record<string, unknown>): unknown {
    const sessionId = str(args.sessionId);
    if (sessionId && args.tabId === undefined) {
      const openTab = this.deps.tabManager.listTabs().find((t) => t.sessionId === sessionId);
      if (!openTab || this.deps.tracker.getTranscript(openTab.id).length === 0) {
        const provider = str(args.provider) ?? this.deps.sessionStore.getSession(sessionId)?.provider ?? 'claude';
        const messages = this.readSessionFromDisk(sessionId, provider);
        if (messages.length === 0) {
          return fail(ERROR_CODES.notFound, `No messages found on disk for session ${sessionId}.`);
        }
        const entries = messages.map((m, i) => ({
          index: i,
          role: m.role,
          content: normalizeContent(m.content),
          time: m.timestamp,
          model: m.model,
          source: m.source,
          synthetic: m.synthetic,
        }));
        const { slice, total, offset, limit } = this.page(entries, args);
        return { sessionId, source: 'disk', total, offset, limit, messages: this.formatEntries(slice, args) };
      }
      args = { ...args, tabId: openTab.id };
    }
    const tab = this.resolveTab(args.tabId);
    let transcript = this.deps.tracker.getTranscript(tab.id);
    let source = 'live';
    if (transcript.length === 0 && tab.sessionId) {
      // Lazily restored tab: nothing streamed yet in this window, read the session file.
      const messages = this.readSessionFromDisk(tab.sessionId, tab.getProvider());
      transcript = messages.map((m, i) => ({
        index: i,
        role: m.role,
        content: normalizeContent(m.content),
        time: m.timestamp,
        model: m.model,
        source: m.source,
        synthetic: m.synthetic,
      }));
      source = 'disk';
    }
    const { slice, total, offset, limit } = this.page(transcript, args);
    return {
      tabId: tab.id,
      sessionId: tab.sessionId,
      source,
      total,
      offset,
      limit,
      messages: this.formatEntries(slice, args, source === 'live' ? this.deps.tracker.getToolResults(tab.id) : undefined),
    };
  }

  private getLastResponse(args: Record<string, unknown>): unknown {
    const tab = this.resolveTab(args.tabId);
    const entry = this.deps.tracker.lastAssistantEntry(tab.id);
    if (entry) {
      return { tabId: tab.id, index: entry.index, time: isoTime(entry.time), model: entry.model, text: extractText(entry.content) };
    }
    if (tab.sessionId) {
      const messages = this.readSessionFromDisk(tab.sessionId, tab.getProvider());
      for (let i = messages.length - 1; i >= 0; i--) {
        const text = extractText(messages[i].content);
        if (messages[i].role === 'assistant' && !messages[i].synthetic && text) {
          return { tabId: tab.id, source: 'disk', time: isoTime(messages[i].timestamp), model: messages[i].model, text };
        }
      }
    }
    return { tabId: tab.id, text: null, note: 'No assistant reply yet.' };
  }

  private scheduleMessage(args: Record<string, unknown>): unknown {
    const tab = this.resolveChatTab(args.tabId);
    const at = parseScheduleTime(args.at);
    const now = Date.now();
    if (at < now + 1000) {
      fail(ERROR_CODES.invalidArgs, 'at must be in the future');
    }
    if (at > now + 7 * 86_400_000) {
      fail(ERROR_CODES.invalidArgs, 'at must be within 7 days');
    }
    this.dispatch(tab, { type: 'scheduleMessage', text: String(args.text), scheduledAtMs: at } as WebviewToExtensionMessage);
    return { tabId: tab.id, scheduledAt: new Date(at).toISOString() };
  }

  // =========================================================================
  // Approvals
  // =========================================================================

  private listPendingApprovals(): unknown {
    const approvals = this.deps.tabManager
      .listTabs()
      .map((t) => ({ tab: t, details: this.deps.tracker.describePendingApproval(t.id) }))
      .filter((x) => x.details)
      .map((x) => ({
        tabId: x.tab.id,
        tabName: x.tab.displayName,
        ...x.details,
        plan: x.details?.plan ? truncateString(x.details.plan, 20_000) : undefined,
        planText: undefined,
        toolInput: x.details?.toolInput === undefined ? undefined : summarizeValue(x.details.toolInput, 4000),
      }));
    return { approvals };
  }

  private async respondToApproval(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<unknown> {
    const tab = this.resolveChatTab(args.tabId);
    const details = this.deps.tracker.describePendingApproval(tab.id);
    if (!details) {
      return fail(ERROR_CODES.notFound, `Tab ${tab.id} has no pending approval.`);
    }
    const action = String(args.action);
    if (details.kind === 'question' && action !== 'reject') {
      fail(ERROR_CODES.invalidArgs, 'This is a question (AskUserQuestion): use answer_question, or action="reject".', { questions: details.questions });
    }
    const mapped: Record<string, string> = {
      approve: 'approve',
      approve_clear_context: 'approveClearBypass',
      approve_manual: 'approveManual',
      reject: 'reject',
      feedback: 'feedback',
    };
    const feedback = str(args.feedback);
    if (action === 'feedback' && !feedback?.trim()) {
      fail(ERROR_CODES.invalidArgs, 'feedback text is required for action="feedback"');
    }
    const message = {
      type: 'planApprovalResponse',
      action: mapped[action],
      toolName: details.toolName,
      ...(feedback ? { feedback } : {}),
      ...(action === 'approve_clear_context' && details.plan ? { plan: details.plan } : {}),
    } as unknown as WebviewToExtensionMessage;
    return this.dispatchAndMaybeWait(tab, message, args, ctx, { approval: action });
  }

  private async answerQuestion(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<unknown> {
    const tab = this.resolveChatTab(args.tabId);
    const details = this.deps.tracker.describePendingApproval(tab.id);
    if (!details || details.kind !== 'question') {
      return fail(ERROR_CODES.notFound, `Tab ${tab.id} has no pending question.`);
    }
    const questions = (details.questions ?? []) as Array<{ question?: unknown }>;
    let message: Record<string, unknown>;
    if (Array.isArray(args.answers) && args.answers.length > 0) {
      const answers = (args.answers as Array<{ question?: unknown; answers?: unknown }>).map((a, i) => ({
        question: typeof a.question === 'string' ? a.question : String(questions[i]?.question ?? `question_${i}`),
        answers: Array.isArray(a.answers) ? a.answers.map((v) => String(v)) : [],
      }));
      message = {
        type: 'planApprovalResponse',
        action: 'questionAnswer',
        toolName: details.toolName,
        selectedOptions: answers[0]?.answers ?? [],
        questionAnswers: answers,
      };
    } else if (typeof args.text === 'string' && args.text.trim()) {
      message = {
        type: 'planApprovalResponse',
        action: 'questionAnswer',
        toolName: details.toolName,
        selectedOptions: [args.text.trim()],
        feedback: args.text.trim(),
      };
    } else {
      return fail(ERROR_CODES.invalidArgs, 'Provide answers[] or text.', { questions });
    }
    return this.dispatchAndMaybeWait(tab, message as unknown as WebviewToExtensionMessage, args, ctx, { answered: true });
  }

  private async dispatchAndMaybeWait(
    tab: ChatTab,
    message: WebviewToExtensionMessage,
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
    extra: Record<string, unknown>,
  ): Promise<unknown> {
    const tracker = this.deps.tracker;
    const baselineIndex = tracker.nextTranscriptIndex(tab.id);
    const startedAt = Date.now();
    if (ctx.signal.aborted) {
      return { tabId: tab.id, ...extra, status: 'cancelled', sent: false, note: 'The caller disconnected before the answer was sent.' };
    }
    if (!bool(args.wait, true)) {
      this.dispatch(tab, message);
      return { tabId: tab.id, ...extra, status: 'sent' };
    }
    const waiter = armTurnWaiter(this.deps.eventLog, {
      tabId: tab.id,
      timeoutMs: timeoutMs(args.timeoutSec, 600),
      initiallyBusy: false,
      // Plan approvals in stream mode may finish without a new busy cycle.
      startGraceMs: 8_000,
      isBusy: () => tab.isBusyState(),
      hasPendingApproval: () => !!tracker.getState(tab.id).pendingApproval,
      signal: ctx.signal,
    });
    try {
      this.dispatch(tab, message);
    } catch (err) {
      waiter.cancel();
      throw err;
    }
    const outcome = await waiter.promise;
    const result = this.buildTurnResult(tab, outcome.status === 'idle' ? { ...outcome, status: 'completed' } : outcome, baselineIndex, startedAt);
    return { ...extra, ...result };
  }

  // =========================================================================
  // Per-tab settings
  // =========================================================================

  private setModel(args: Record<string, unknown>): unknown {
    const tab = this.resolveChatTab(args.tabId);
    this.dispatch(tab, { type: 'setModel', model: String(args.model) } as WebviewToExtensionMessage);
    return { tabId: tab.id, model: String(args.model) || '(default)' };
  }

  private applyPermissionMode(tab: ChatTab, mode: string): void {
    if (mode !== 'full-access' && mode !== 'supervised') {
      fail(ERROR_CODES.invalidArgs, 'mode must be "full-access" or "supervised"');
    }
    this.dispatch(tab, { type: 'setPermissionMode', mode } as WebviewToExtensionMessage);
    // The handler only persists the setting; echo it so the picker reflects the change.
    tab.postMessage({ type: 'permissionModeSetting', mode });
  }

  private setPermissionMode(args: Record<string, unknown>): unknown {
    const tab = this.resolveChatTab(args.tabId);
    this.applyPermissionMode(tab, String(args.mode));
    return { tabId: tab.id, mode: args.mode, note: 'Stored globally; applies to sessions started from now on in every tab.' };
  }

  private applyEffort(tab: ChatTab, effort: string): void {
    if (tab instanceof CodexSessionTab) {
      if (!CODEX_EFFORTS.includes(effort)) {
        fail(ERROR_CODES.invalidArgs, `Codex effort must be one of: ${CODEX_EFFORTS.map((e) => JSON.stringify(e)).join(', ')}`);
      }
      this.dispatch(tab, { type: 'setCodexReasoningEffort', effort } as WebviewToExtensionMessage);
      tab.postMessage({ type: 'codexReasoningEffortSetting', effort } as ExtensionToWebviewMessage);
      return;
    }
    if (!CLAUDE_EFFORTS.includes(effort)) {
      fail(ERROR_CODES.invalidArgs, `Claude effort must be one of: ${CLAUDE_EFFORTS.map((e) => JSON.stringify(e)).join(', ')}`);
    }
    this.dispatch(tab, { type: 'setClaudeEffort', effort } as WebviewToExtensionMessage);
    tab.postMessage({ type: 'claudeEffortSetting', effort } as ExtensionToWebviewMessage);
  }

  private setEffort(args: Record<string, unknown>): unknown {
    const tab = this.resolveChatTab(args.tabId);
    this.applyEffort(tab, String(args.effort));
    return { tabId: tab.id, effort: String(args.effort) || '(default)' };
  }

  private setFastMode(args: Record<string, unknown>): unknown {
    const tab = this.resolveChatTab(args.tabId);
    const enabled = args.enabled === true;
    if (tab instanceof CodexSessionTab) {
      this.dispatch(tab, { type: 'setCodexServiceTier', serviceTier: enabled ? 'fast' : '' } as WebviewToExtensionMessage);
    } else {
      this.dispatch(tab, { type: 'setClaudeFastMode', fastMode: enabled } as WebviewToExtensionMessage);
      tab.postMessage({ type: 'claudeFastModeSetting', fastMode: enabled });
    }
    return { tabId: tab.id, fastMode: enabled };
  }

  private async switchProvider(args: Record<string, unknown>): Promise<unknown> {
    const tab = this.resolveChatTab(args.tabId);
    const targetProvider = String(args.targetProvider) as 'claude' | 'codex';
    if (tab.getProvider() === targetProvider) {
      fail(ERROR_CODES.invalidArgs, `Tab ${tab.id} already uses ${targetProvider}.`);
    }
    if (tab.isBusyState()) {
      fail(ERROR_CODES.unsupported, 'Finish or cancel the current turn before switching provider.');
    }
    try {
      const result = await this.deps.tabManager.handoffSession({
        sourceTabId: tab.id,
        targetProvider,
        keepSourceOpen: bool(args.keepSourceOpen, true),
      });
      return { sourceTabId: tab.id, targetTabId: result.targetTabId, targetProvider, artifactPath: result.artifactPath };
    } catch (err) {
      return fail(ERROR_CODES.unsupported, `Provider handoff failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // =========================================================================
  // History & search
  // =========================================================================

  private async listSessions(args: Record<string, unknown>): Promise<unknown> {
    const limit = typeof args.limit === 'number' ? Math.floor(args.limit) : 50;
    const query = str(args.query)?.toLowerCase();
    const workspaceOnly = args.workspaceOnly === true;
    const ws = this.workspacePath();
    const norm = (p: string | undefined) => (p ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const openBySession = new Map(this.deps.tabManager.listTabs().filter((t) => t.sessionId).map((t) => [t.sessionId as string, t.id]));

    if ((str(args.source) ?? 'claui') === 'disk') {
      const discovery = new SessionDiscovery();
      const sessions = workspaceOnly && ws ? await discovery.discoverForWorkspace(ws) : await discovery.discoverAll();
      const filtered = sessions.filter((s) => !query || s.firstPrompt.toLowerCase().includes(query) || s.workspaceLabel.toLowerCase().includes(query));
      return {
        source: 'disk',
        total: filtered.length,
        sessions: filtered.slice(0, limit).map((s) => ({
          sessionId: s.sessionId,
          workspace: s.workspaceLabel,
          modifiedAt: isoTime(s.mtime),
          sizeBytes: s.size,
          firstPrompt: s.firstPrompt,
          openInTabId: openBySession.get(s.sessionId) ?? null,
        })),
      };
    }

    const sessions = this.deps.sessionStore
      .getSessions()
      .filter((s) => !workspaceOnly || !ws || norm(s.workspacePath) === norm(ws))
      .filter((s) => !query || [s.name, s.firstPrompt, s.summary].some((v) => (v ?? '').toLowerCase().includes(query)));
    return {
      source: 'claui',
      total: sessions.length,
      sessions: sessions.slice(0, limit).map((s) => ({
        sessionId: s.sessionId,
        name: s.name,
        provider: s.provider,
        model: s.model,
        startedAt: s.startedAt,
        lastActiveAt: s.lastActiveAt,
        firstPrompt: s.firstPrompt,
        summary: s.summary,
        workspacePath: s.workspacePath,
        openInTabId: openBySession.get(s.sessionId) ?? null,
      })),
    };
  }

  private async searchConversations(args: Record<string, unknown>): Promise<unknown> {
    const limit = typeof args.limit === 'number' ? Math.floor(args.limit) : 20;
    const service = new ChatSearchService((msg) => this.deps.log(msg));
    const result = await service.searchProject(String(args.query), Date.now());
    const results = result?.results ?? [];
    return {
      query: args.query,
      totalMatches: result?.totalMatches ?? 0,
      results: results.slice(0, limit).map((r) => ({ ...r, mtime: isoTime(r.mtime) })),
    };
  }

  // =========================================================================
  // Folders
  // =========================================================================

  private listGroups(): unknown {
    const tabs = this.deps.tabManager.listTabs();
    return {
      groups: this.deps.tabGroupStore.listGroups().map((g) => ({
        id: g.id,
        label: g.label,
        parentId: g.parentId ?? null,
        color: g.color ?? null,
        tabs: tabs.filter((t) => t.groupId === g.id).map((t) => ({ id: t.id, name: t.displayName })),
      })),
      ungroupedTabs: tabs.filter((t) => !t.groupId).map((t) => ({ id: t.id, name: t.displayName })),
    };
  }

  private async createGroup(args: Record<string, unknown>): Promise<unknown> {
    const parentId = str(args.parentId);
    if (parentId && !this.deps.tabGroupStore.getGroup(parentId)) {
      fail(ERROR_CODES.notFound, `Unknown parent folder: ${parentId}`);
    }
    const group = await this.deps.tabGroupStore.createGroup({ label: String(args.label), parentId, color: str(args.color) });
    return { group };
  }

  private async moveTabToGroup(args: Record<string, unknown>): Promise<unknown> {
    const tab = this.resolveTab(args.tabId);
    const groupId = args.groupId === null ? null : String(args.groupId);
    if (groupId && !this.deps.tabGroupStore.getGroup(groupId)) {
      fail(ERROR_CODES.notFound, `Unknown folder: ${groupId}`);
    }
    await this.deps.tabManager.moveTabToGroup(tab.id, groupId);
    return { tabId: tab.id, groupId };
  }

  private async deleteGroup(args: Record<string, unknown>): Promise<unknown> {
    const groupId = String(args.groupId);
    if (!this.deps.tabGroupStore.getGroup(groupId)) {
      fail(ERROR_CODES.notFound, `Unknown folder: ${groupId}`);
    }
    const tabsInside = this.deps.tabManager.listTabs().filter((t) => t.groupId === groupId);
    const result = await this.deps.tabGroupStore.deleteGroup(groupId, 'reparent');
    for (const t of tabsInside) {
      await this.deps.tabManager.moveTabToGroup(t.id, result.reparentedTo ?? null);
    }
    return { deleted: result.deletedGroupIds, tabsMovedTo: result.reparentedTo ?? null };
  }

  // =========================================================================
  // Extension-level: settings, commands, UI actions, events, notifications
  // =========================================================================

  private manifestSettings(): Record<string, Record<string, unknown>> {
    const pkg = this.deps.context.extension.packageJSON as {
      contributes?: { configuration?: { properties?: Record<string, Record<string, unknown>> } | Array<{ properties?: Record<string, Record<string, unknown>> }> };
    };
    const conf = pkg.contributes?.configuration;
    const sections = Array.isArray(conf) ? conf : conf ? [conf] : [];
    const out: Record<string, Record<string, unknown>> = {};
    for (const section of sections) {
      Object.assign(out, section.properties ?? {});
    }
    return out;
  }

  private getSettings(args: Record<string, unknown>): unknown {
    const cfg = vscode.workspace.getConfiguration('claudeMirror');
    const schema = this.manifestSettings();
    const prefix = str(args.prefix) ? shortSettingKey(String(args.prefix)) : '';
    const wanted = Array.isArray(args.keys) ? new Set((args.keys as unknown[]).map((k) => shortSettingKey(String(k)))) : null;
    const settings: Record<string, unknown>[] = [];
    for (const [fullKey, def] of Object.entries(schema)) {
      const key = shortSettingKey(fullKey);
      if (prefix && !key.startsWith(prefix)) continue;
      if (wanted && !wanted.has(key)) continue;
      const secret = isSecretSettingKey(key);
      const value = cfg.get(key);
      settings.push({
        key: fullKey,
        value: secret ? (value ? '[redacted]' : value) : compactPayload(value),
        default: secret ? undefined : compactPayload(def.default),
        type: def.type,
        enum: def.enum,
        description: truncateString(String(def.description ?? def.markdownDescription ?? ''), 400),
        writable: classifySettingWrite(key),
      });
    }
    return { count: settings.length, settings };
  }

  private async updateSetting(args: Record<string, unknown>): Promise<unknown> {
    const key = shortSettingKey(String(args.key));
    const fullKey = `claudeMirror.${key}`;
    const def = this.manifestSettings()[fullKey];
    if (!def) {
      return fail(ERROR_CODES.notFound, `Unknown setting: ${fullKey} (see get_settings).`);
    }
    const risk = classifySettingWrite(key);
    if (risk === 'blocked') {
      fail(ERROR_CODES.forbidden, `${fullKey} cannot be changed remotely.`);
    }
    if (risk === 'sensitive' && !this.deps.allowSensitiveActions()) {
      fail(ERROR_CODES.forbidden, `${fullKey} is a sensitive setting. Enable claudeMirror.remoteControl.allowSensitiveActions in VS Code to change it remotely.`);
    }
    const value = args.value;
    if (value !== null) {
      const types = Array.isArray(def.type) ? (def.type as string[]) : def.type ? [String(def.type)] : [];
      const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value === 'number' ? (Number.isInteger(value) ? 'integer' : 'number') : typeof value;
      const typeOk = types.length === 0 || types.some((t) => t === actual || (t === 'number' && actual === 'integer'));
      if (!typeOk) {
        fail(ERROR_CODES.invalidArgs, `${fullKey} expects ${types.join(' | ')}, got ${actual}`);
      }
      if (Array.isArray(def.enum) && !(def.enum as unknown[]).includes(value)) {
        fail(ERROR_CODES.invalidArgs, `${fullKey} must be one of ${(def.enum as unknown[]).map((v) => JSON.stringify(v)).join(', ')}`);
      }
      if (typeof def.minimum === 'number' && typeof value === 'number' && value < def.minimum) {
        fail(ERROR_CODES.invalidArgs, `${fullKey} must be >= ${def.minimum}`);
      }
      if (typeof def.maximum === 'number' && typeof value === 'number' && value > def.maximum) {
        fail(ERROR_CODES.invalidArgs, `${fullKey} must be <= ${def.maximum}`);
      }
    }
    const target = str(args.target) === 'workspace' ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    if (target === vscode.ConfigurationTarget.Workspace && !vscode.workspace.workspaceFolders?.length) {
      fail(ERROR_CODES.invalidArgs, 'target "workspace" needs an open folder.');
    }
    const cfg = vscode.workspace.getConfiguration('claudeMirror');
    const secret = isSecretSettingKey(key);
    const previous = cfg.get(key);
    await cfg.update(key, value === null ? undefined : value, target);
    this.deps.log(`[RemoteControl] setting ${fullKey} updated remotely (${target === vscode.ConfigurationTarget.Global ? 'global' : 'workspace'})`);
    return {
      key: fullKey,
      previous: secret ? '[redacted]' : compactPayload(previous),
      value: secret ? '[redacted]' : compactPayload(vscode.workspace.getConfiguration('claudeMirror').get(key)),
    };
  }

  private manifestCommands(): Array<{ command: string; title: string }> {
    const pkg = this.deps.context.extension.packageJSON as { contributes?: { commands?: Array<{ command: string; title: string }> } };
    return (pkg.contributes?.commands ?? []).filter((c) => typeof c.command === 'string');
  }

  private listCommands(): unknown {
    const allowSensitive = this.deps.allowSensitiveActions();
    return {
      commands: this.manifestCommands().map((c) => {
        const risk = classifyCommand(c.command);
        return {
          command: c.command,
          title: c.title,
          risk,
          allowed: risk === 'normal' || (risk === 'sensitive' && allowSensitive),
        };
      }),
    };
  }

  private async executeCommand(args: Record<string, unknown>): Promise<unknown> {
    const command = String(args.command);
    if (!this.manifestCommands().some((c) => c.command === command)) {
      return fail(ERROR_CODES.notFound, `Unknown ClaUi command: ${command} (see list_commands).`);
    }
    const risk = classifyCommand(command);
    if (risk === 'blocked') {
      fail(ERROR_CODES.forbidden, `${command} cannot be run remotely.`);
    }
    if (risk === 'sensitive' && !this.deps.allowSensitiveActions()) {
      fail(ERROR_CODES.forbidden, `${command} is sensitive. Enable claudeMirror.remoteControl.allowSensitiveActions in VS Code to run it remotely.`);
    }
    const commandArgs = Array.isArray(args.args) ? (args.args as unknown[]) : [];
    const run = Promise.resolve(vscode.commands.executeCommand(command, ...commandArgs)).then(
      (value) => ({ done: true as const, value }),
      (err: unknown) => ({ done: true as const, error: err instanceof Error ? err.message : String(err) }),
    );
    const timer = new Promise<{ done: false }>((resolve) => setTimeout(() => resolve({ done: false }), 120_000));
    const outcome = await Promise.race([run, timer]);
    if (!outcome.done) {
      return { command, status: 'still_running', note: 'The command is waiting for user input in VS Code (picker or dialog).' };
    }
    if ('error' in outcome) {
      return fail(ERROR_CODES.internal, `${command} failed: ${outcome.error}`);
    }
    return { command, status: 'done', result: compactPayload(outcome.value) ?? null };
  }

  private listUiActions(args: Record<string, unknown>): unknown {
    const filter = str(args.filter)?.toLowerCase();
    const allowSensitive = this.deps.allowSensitiveActions();
    const readOnly = this.deps.getAccessLevel() === 'readOnly';
    const match = (e: UiCatalogEntry) => !filter || e.type.toLowerCase().includes(filter) || e.interface.toLowerCase().includes(filter);
    const actions = UI_ACTIONS.filter(match).map((a) => {
      const risk = classifyUiAction(a.type);
      return {
        type: a.type,
        fields: a.fields.map((f) => `${f.name}${f.optional ? '?' : ''}: ${f.type}`),
        doc: a.doc,
        risk,
        allowed: risk === 'query' || (!readOnly && (risk === 'normal' || (risk === 'sensitive' && allowSensitive))),
      };
    });
    return {
      count: actions.length,
      actions,
      events: args.includeEvents === true
        ? UI_EVENTS.filter(match).map((e) => ({ type: e.type, fields: e.fields.map((f) => `${f.name}${f.optional ? '?' : ''}: ${f.type}`) }))
        : undefined,
      note: 'Dedicated tools (send_message, set_model, respond_to_approval, ...) are preferred where they exist.',
    };
  }

  private async dispatchUiAction(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<unknown> {
    const action = args.action as Record<string, unknown>;
    const type = String(action.type);
    if (!UI_ACTION_TYPES.has(type)) {
      return fail(ERROR_CODES.notFound, `Unknown UI action type: ${type} (see list_ui_actions).`);
    }
    const risk = classifyUiAction(type);
    if (risk === 'blocked') {
      fail(ERROR_CODES.forbidden, `UI action "${type}" can only come from the chat UI itself.`);
    }
    if (risk === 'sensitive' && !this.deps.allowSensitiveActions()) {
      fail(ERROR_CODES.forbidden, `UI action "${type}" is sensitive (credentials, git, security policy, files/URLs or external sends). Enable claudeMirror.remoteControl.allowSensitiveActions in VS Code to allow it.`);
    }
    if (type === 'sendMessage' || type === 'sendMessageWithImages') {
      fail(ERROR_CODES.invalidArgs, 'Use send_message for prompts (it serializes turns and returns the reply).');
    }
    const tab = this.resolveChatTab(args.tabId);
    const waitTypes = typeof args.waitForEvent === 'string' ? [args.waitForEvent] : Array.isArray(args.waitForEvent) ? (args.waitForEvent as string[]) : [];
    const waiter = waitTypes.length > 0 ? this.deps.waitForOutbound(tab.id, waitTypes, timeoutMs(args.timeoutSec, 30), ctx.signal) : null;
    try {
      this.dispatch(tab, action as unknown as WebviewToExtensionMessage);
    } catch (err) {
      waiter?.cancel();
      throw err;
    }
    if (!waiter) {
      return { tabId: tab.id, dispatched: type };
    }
    const event = await waiter.promise;
    return {
      tabId: tab.id,
      dispatched: type,
      event: event ? compactPayload(event, { maxStringLength: 100_000, maxArrayLength: 2000, maxDepth: 10, maxKeys: 400 }) : null,
      ...(event ? {} : { note: `No ${waitTypes.join(' / ')} event arrived before the timeout.` }),
    };
  }

  private async getEvents(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<unknown> {
    const log = this.deps.eventLog;
    const filter: EventFilter = {};
    if (args.tabId !== undefined) {
      filter.tabId = this.resolveTab(args.tabId).id;
    }
    if (Array.isArray(args.types)) {
      filter.types = (args.types as unknown[]).map(String);
    }
    if (typeof args.direction === 'string') {
      filter.direction = args.direction as EventFilter['direction'];
    }
    const limit = typeof args.limit === 'number' ? Math.floor(args.limit) : 100;
    const waitSec = typeof args.waitSec === 'number' ? args.waitSec : 0;
    let events;
    let since: number | null = typeof args.sinceSeq === 'number' ? Math.floor(args.sinceSeq) : null;
    if (since === null && waitSec > 0) {
      since = log.lastSeq;
    }
    if (since === null) {
      events = log.tail(filter, limit);
    } else {
      events = await log.waitForEvents(since, filter, limit, waitSec * 1000, ctx.signal);
    }
    return {
      events,
      nextSeq: events.length > 0 ? events[events.length - 1].seq : since ?? log.lastSeq,
      lastSeq: log.lastSeq,
      oldestSeq: log.oldestSeq,
      ...(since !== null && since > 0 && since < log.oldestSeq - 1 ? { note: 'Some events were dropped from the buffer since sinceSeq.' } : {}),
    };
  }

  private async showNotification(args: Record<string, unknown>): Promise<unknown> {
    const message = `[Remote] ${String(args.message)}`;
    const buttons = Array.isArray(args.buttons) ? (args.buttons as unknown[]).map(String) : [];
    const level = str(args.level) ?? 'info';
    const show =
      level === 'error'
        ? vscode.window.showErrorMessage(message, ...buttons)
        : level === 'warning'
          ? vscode.window.showWarningMessage(message, ...buttons)
          : vscode.window.showInformationMessage(message, ...buttons);
    if (buttons.length === 0) {
      void show;
      return { shown: true };
    }
    const timer = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeoutMs(args.timeoutSec, 60)));
    const clicked = await Promise.race([Promise.resolve(show), timer]);
    return { shown: true, clicked: clicked ?? null };
  }
}
