import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { SessionStore } from '../session/SessionStore';
import type { TabGroupStore, TabGroup } from '../session/TabGroupStore';
import type { TabManager, TabSummary } from '../session/TabManager';

/** Tagged union for nodes the TreeView renders. */
export type TabGroupTreeNode =
  | { kind: 'group'; group: TabGroup }
  | { kind: 'tab'; tab: TabSummary };

/**
 * Sidebar TreeView showing folders -> subfolders -> tabs.
 *
 * - Each tab leaf's tooltip is its end-of-session summary (when present).
 * - Click a tab leaf to focus its webview panel.
 * - Group/leaf contextValue drives the right-click menu in package.json.
 */
export class TabGroupsTreeProvider implements vscode.TreeDataProvider<TabGroupTreeNode> {
  private readonly emitter = new vscode.EventEmitter<TabGroupTreeNode | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(
    private readonly tabManager: TabManager,
    private readonly tabGroupStore: TabGroupStore,
    private readonly sessionStore: SessionStore,
    private readonly storageDir: string
  ) {}

  /**
   * Materialize a tinted folder SVG once per `(groupId, color)` and return its file URI.
   * The icon path is stable per (id, color), so VS Code caches it after the first render.
   */
  private folderIconPath(group: TabGroup): vscode.Uri | undefined {
    try {
      fs.mkdirSync(this.storageDir, { recursive: true });
      const colorSafe = group.color.replace(/[^A-Fa-f0-9]/g, '');
      const iconPath = path.join(this.storageDir, `tab-group-${group.id}-${colorSafe}.svg`);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M1.5 3.5h4l1.5 1.5h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" fill="${group.color}" stroke="${group.color}" stroke-width="0.4" stroke-linejoin="round"/></svg>`;
      fs.writeFileSync(iconPath, svg, 'utf-8');
      return vscode.Uri.file(iconPath);
    } catch {
      return undefined;
    }
  }

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(node: TabGroupTreeNode): vscode.TreeItem {
    if (node.kind === 'group') {
      const item = new vscode.TreeItem(node.group.label, vscode.TreeItemCollapsibleState.Expanded);
      item.contextValue = 'tabGroup';
      item.id = `group:${node.group.id}`;
      // Use the actual folder color via a generated SVG. Falls back to the
      // themed folder icon if file I/O fails (sandboxed env, locked dir, …).
      const tinted = this.folderIconPath(node.group);
      item.iconPath = tinted ?? new vscode.ThemeIcon('folder');
      item.description = `${this.countTabsInSubtree(node.group.id)} tab(s)`;
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**${node.group.label}**\n\n`);
      md.appendMarkdown(`Folder color: \`${node.group.color}\``);
      item.tooltip = md;
      return item;
    }

    // Tab leaf
    const item = new vscode.TreeItem(node.tab.displayName, vscode.TreeItemCollapsibleState.None);
    item.contextValue = 'tabLeaf';
    item.id = `tab:${node.tab.id}`;
    item.iconPath = new vscode.ThemeIcon(
      node.tab.provider === 'codex' ? 'rocket' : 'comment-discussion'
    );
    item.description = node.tab.provider === 'claude' ? undefined : node.tab.provider;
    item.command = {
      command: 'claudeMirror.tabs.focus',
      title: 'Focus tab',
      arguments: [node.tab.id],
    };
    item.tooltip = this.buildTabTooltip(node.tab);
    return item;
  }

  getChildren(node?: TabGroupTreeNode): TabGroupTreeNode[] {
    if (!node) {
      // Root: top-level folders followed by ungrouped tabs.
      const groups = this.tabGroupStore
        .listGroups()
        .filter((g) => !g.parentId)
        .sort((a, b) => a.order - b.order);
      const ungroupedTabs = this.tabManager
        .listTabs()
        .filter((t) => !t.groupId)
        .sort((a, b) => (a.orderInGroup ?? a.tabNumber) - (b.orderInGroup ?? b.tabNumber));
      return [
        ...groups.map<TabGroupTreeNode>((group) => ({ kind: 'group', group })),
        ...ungroupedTabs.map<TabGroupTreeNode>((tab) => ({ kind: 'tab', tab })),
      ];
    }
    if (node.kind === 'group') {
      const subGroups = this.tabGroupStore
        .listGroups()
        .filter((g) => g.parentId === node.group.id)
        .sort((a, b) => a.order - b.order);
      const tabs = this.tabManager
        .listTabs()
        .filter((t) => t.groupId === node.group.id)
        .sort((a, b) => (a.orderInGroup ?? a.tabNumber) - (b.orderInGroup ?? b.tabNumber));
      return [
        ...subGroups.map<TabGroupTreeNode>((group) => ({ kind: 'group', group })),
        ...tabs.map<TabGroupTreeNode>((tab) => ({ kind: 'tab', tab })),
      ];
    }
    return [];
  }

  private countTabsInSubtree(groupId: string): number {
    const allTabs = this.tabManager.listTabs();
    const queue = [groupId];
    const ids = new Set<string>();
    while (queue.length > 0) {
      const current = queue.pop()!;
      ids.add(current);
      for (const child of this.tabGroupStore.listGroups()) {
        if (child.parentId === current && !ids.has(child.id)) {
          queue.push(child.id);
        }
      }
    }
    return allTabs.filter((t) => t.groupId && ids.has(t.groupId)).length;
  }

  private buildTabTooltip(tab: TabSummary): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.supportThemeIcons = true;
    md.isTrusted = false;
    md.appendMarkdown(`**${tab.displayName}**\n\n`);
    if (tab.sessionId) {
      md.appendMarkdown(`*Provider:* ${tab.provider}  \n`);
      md.appendMarkdown(`*Session:* \`${tab.sessionId.slice(0, 8)}\`\n\n`);
      const meta = this.sessionStore.getSession(tab.sessionId);
      if (meta?.summary) {
        const ageHint = meta.summaryGeneratedAt
          ? ` _(generated ${this.relativeTime(meta.summaryGeneratedAt)})_`
          : '';
        md.appendMarkdown(`---\n\n${meta.summary}${ageHint}`);
      } else {
        md.appendMarkdown('---\n\n_Summary will appear after the session ends._');
      }
    } else {
      md.appendMarkdown('_Session not yet started._');
    }
    return md;
  }

  private relativeTime(timestamp: number): string {
    const diffMs = Date.now() - timestamp;
    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
}
