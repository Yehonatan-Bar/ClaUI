import * as vscode from 'vscode';
import { SessionTab } from './SessionTab';
import type { SessionStore } from './SessionStore';
import type { PromptHistoryStore } from './PromptHistoryStore';
import type { ExtensionToWebviewMessage } from '../types/webview-messages';

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

/**
 * Manages all open SessionTab instances.
 * Tracks the active (focused) tab and provides command routing helpers.
 */
export class TabManager {
  private tabs = new Map<string, SessionTab>();
  private activeTabId: string | null = null;
  private nextTabNumber = 1;
  private readonly statusBarItem: vscode.StatusBarItem;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: (msg: string) => void,
    private readonly sessionStore: SessionStore,
    private readonly promptHistoryStore: PromptHistoryStore,
    private readonly logDir: string | null
  ) {
    // Single shared status bar item across all tabs
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.text = '$(loading~spin) Claude thinking...';
    context.subscriptions.push(this.statusBarItem);
  }

  /** Create a new tab with its own independent Claude session */
  createTab(): SessionTab {
    const tabNumber = this.nextTabNumber++;
    const tabColor = TAB_COLORS[(tabNumber - 1) % TAB_COLORS.length];

    // First tab opens Beside the editor; subsequent tabs open in the same
    // column so they stack as switchable tabs instead of splitting further.
    const existingTab = this.getActiveTab() ?? this.getAnyTab();
    const viewColumn = existingTab?.viewColumn ?? vscode.ViewColumn.Beside;

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
      },
      this.sessionStore,
      this.promptHistoryStore,
      this.logDir
    );

    this.tabs.set(tab.id, tab);
    this.activeTabId = tab.id;
    this.log(`Tab created: ${tab.id} color=${tabColor} column=${viewColumn} (total: ${this.tabs.size})`);
    return tab;
  }

  /** Get the currently focused tab, or null if none */
  getActiveTab(): SessionTab | null {
    if (!this.activeTabId) {
      return null;
    }
    return this.tabs.get(this.activeTabId) ?? null;
  }

  /** Get or create: returns active tab if one exists, otherwise creates a new one */
  getOrCreateTab(): SessionTab {
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

  /** Dispose all tabs (used during extension deactivation) */
  closeAllTabs(): void {
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
  private getAnyTab(): SessionTab | null {
    const first = this.tabs.values().next();
    return first.done ? null : first.value;
  }

  // --- Internal handlers ---

  private handleTabClosed(tabId: string): void {
    this.tabs.delete(tabId);
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
    this.log(`Tab focused: ${tabId}`);
  }
}
