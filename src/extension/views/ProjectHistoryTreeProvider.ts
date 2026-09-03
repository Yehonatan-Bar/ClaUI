import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { SessionDiscovery, type DiscoveredSession } from '../session/SessionDiscovery';
import type { SessionStore } from '../session/SessionStore';
import type { ProviderId } from '../types/webview-messages';

/** A discovered on-disk session, enriched with ClaUi-stored name/summary. */
interface HistorySession extends DiscoveredSession {
  /** Human-friendly name from the ClaUi SessionStore, when the session was opened in ClaUi. */
  name?: string;
  /** End-of-session AI summary from the ClaUi SessionStore, shown on hover. */
  summary?: string;
  /** Provider used to resume. Disk sessions under ~/.claude/projects are Claude CLI sessions. */
  provider: ProviderId;
}

/** A collapsible date bucket that groups sessions by recency. */
interface HistoryBucket {
  key: string;
  label: string;
  /** Whether the group is expanded by default (recent buckets are open). */
  defaultExpanded: boolean;
  sessions: HistorySession[];
}

/** Tagged union for nodes the History TreeView renders. */
export type HistoryTreeNode =
  | { kind: 'group'; bucket: HistoryBucket }
  | { kind: 'session'; session: HistorySession }
  | { kind: 'empty'; message: string };

/** Which projects to show history for. */
export type HistoryScope = 'workspace' | 'all';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Sidebar TreeView that lists ALL conversation history on disk for the current
 * project, grouped into collapsible date buckets (Today / Yesterday / Last 7
 * Days / Last 30 Days / Older). Click a conversation to resume it in a new tab.
 *
 * Data comes from {@link SessionDiscovery} (scanning ~/.claude/projects) and is
 * enriched with names/summaries from the ClaUi {@link SessionStore} when available.
 */
export class ProjectHistoryTreeProvider implements vscode.TreeDataProvider<HistoryTreeNode> {
  private readonly emitter = new vscode.EventEmitter<HistoryTreeNode | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  private readonly discovery = new SessionDiscovery();
  private scope: HistoryScope = 'workspace';

  /** Root directory scanned for session files; exposed so the caller can watch it. */
  readonly projectsDir: string;

  constructor(
    private readonly sessionStore: SessionStore,
    private readonly log: (message: string) => void
  ) {
    this.projectsDir = path.join(os.homedir(), '.claude', 'projects');
  }

  getScope(): HistoryScope {
    return this.scope;
  }

  toggleScope(): void {
    this.scope = this.scope === 'workspace' ? 'all' : 'workspace';
    this.log(`[history] scope -> ${this.scope}`);
    this.refresh();
  }

  refresh(): void {
    this.emitter.fire();
  }

  async getChildren(node?: HistoryTreeNode): Promise<HistoryTreeNode[]> {
    if (!node) {
      return this.buildRoot();
    }
    if (node.kind === 'group') {
      return node.bucket.sessions.map<HistoryTreeNode>((session) => ({ kind: 'session', session }));
    }
    return [];
  }

  getTreeItem(node: HistoryTreeNode): vscode.TreeItem {
    if (node.kind === 'empty') {
      const item = new vscode.TreeItem(node.message, vscode.TreeItemCollapsibleState.None);
      item.contextValue = 'historyEmpty';
      item.iconPath = new vscode.ThemeIcon('info');
      return item;
    }

    if (node.kind === 'group') {
      const bucket = node.bucket;
      const item = new vscode.TreeItem(
        bucket.label,
        bucket.defaultExpanded
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
      );
      item.contextValue = 'historyGroup';
      item.id = `history-group:${bucket.key}`;
      item.iconPath = new vscode.ThemeIcon('calendar');
      item.description = `${bucket.sessions.length}`;
      return item;
    }

    // Session leaf.
    const session = node.session;
    const label = session.name || session.firstPrompt || `Session ${session.sessionId.slice(0, 8)}`;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.contextValue = 'historySession';
    item.id = `history-session:${session.sessionId}`;
    item.iconPath = new vscode.ThemeIcon('comment-discussion');
    item.description = `${formatRelativeTime(session.mtime)}  |  ${formatSize(session.size)}`;
    item.tooltip = this.buildSessionTooltip(session);
    item.command = {
      command: 'claudeMirror.history.resume',
      title: 'Open Conversation',
      arguments: [session.sessionId, session.provider],
    };
    return item;
  }

  /** Discover sessions for the active scope and split them into date buckets. */
  private async buildRoot(): Promise<HistoryTreeNode[]> {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const effectiveScope: HistoryScope = workspacePath ? this.scope : 'all';

    let discovered: DiscoveredSession[];
    try {
      discovered =
        effectiveScope === 'workspace' && workspacePath
          ? await this.discovery.discoverForWorkspace(workspacePath)
          : await this.discovery.discoverAll();
    } catch (err) {
      this.log(`[history] discovery failed: ${err instanceof Error ? err.message : String(err)}`);
      discovered = [];
    }

    if (discovered.length === 0) {
      const message =
        effectiveScope === 'workspace'
          ? 'No conversations in this project yet.'
          : 'No conversations found on disk.';
      return [{ kind: 'empty', message }];
    }

    const sessions = discovered.map<HistorySession>((s) => {
      const stored = this.sessionStore.getSession(s.sessionId);
      return {
        ...s,
        name: stored?.name,
        summary: stored?.summary,
        provider: stored?.provider ?? 'claude',
      };
    });

    return this.bucketize(sessions).map<HistoryTreeNode>((bucket) => ({ kind: 'group', bucket }));
  }

  /** Group sessions (already sorted newest-first) into recency buckets, dropping empty ones. */
  private bucketize(sessions: HistorySession[]): HistoryBucket[] {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayStart = startOfToday.getTime();
    const yesterdayStart = todayStart - DAY_MS;
    const last7Start = todayStart - 7 * DAY_MS;
    const last30Start = todayStart - 30 * DAY_MS;

    const buckets: HistoryBucket[] = [
      { key: 'today', label: 'Today', defaultExpanded: true, sessions: [] },
      { key: 'yesterday', label: 'Yesterday', defaultExpanded: true, sessions: [] },
      { key: 'last7', label: 'Last 7 Days', defaultExpanded: false, sessions: [] },
      { key: 'last30', label: 'Last 30 Days', defaultExpanded: false, sessions: [] },
      { key: 'older', label: 'Older', defaultExpanded: false, sessions: [] },
    ];
    const byKey = new Map(buckets.map((b) => [b.key, b] as const));

    for (const session of sessions) {
      const mtime = session.mtime;
      let key: string;
      if (mtime >= todayStart) key = 'today';
      else if (mtime >= yesterdayStart) key = 'yesterday';
      else if (mtime >= last7Start) key = 'last7';
      else if (mtime >= last30Start) key = 'last30';
      else key = 'older';
      byKey.get(key)!.sessions.push(session);
    }

    return buckets.filter((b) => b.sessions.length > 0);
  }

  private buildSessionTooltip(session: HistorySession): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = false;
    const title = session.name || session.firstPrompt || `Session ${session.sessionId.slice(0, 8)}`;
    md.appendMarkdown(`**${escapeMarkdown(title)}**\n\n`);
    md.appendMarkdown(`*Session:* \`${session.sessionId.slice(0, 8)}\`  \n`);
    md.appendMarkdown(`*Updated:* ${formatRelativeTime(session.mtime)}  \n`);
    md.appendMarkdown(`*Size:* ${formatSize(session.size)}\n`);
    if (this.scope === 'all') {
      md.appendMarkdown(`*Project:* ${escapeMarkdown(session.workspaceLabel)}\n`);
    }
    if (session.summary) {
      md.appendMarkdown(`\n---\n\n${escapeMarkdown(session.summary)}`);
    } else if (session.firstPrompt && session.firstPrompt !== title) {
      md.appendMarkdown(`\n---\n\n${escapeMarkdown(session.firstPrompt)}`);
    }
    return md;
  }

  /** Extract the on-disk file path from a context-menu node, if it is a session leaf. */
  static filePathFromNode(node: unknown): string | undefined {
    return ProjectHistoryTreeProvider.sessionRefFromNode(node)?.filePath;
  }

  /** Extract `{ sessionId, filePath, provider }` from a context-menu node, if it is a session leaf. */
  static sessionRefFromNode(
    node: unknown
  ): { sessionId: string; filePath: string; provider: ProviderId } | undefined {
    if (!node || typeof node !== 'object') {
      return undefined;
    }
    const candidate = node as HistoryTreeNode;
    if (candidate.kind !== 'session') {
      return undefined;
    }
    const { sessionId, filePath, provider } = candidate.session;
    if (!sessionId || !filePath) {
      return undefined;
    }
    return { sessionId, filePath, provider };
  }
}

/** Format a timestamp as relative time (e.g. "2h ago", "3d ago"). */
function formatRelativeTime(epochMs: number): string {
  const diff = Date.now() - epochMs;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  if (weeks < 4) return `${weeks}w ago`;
  return new Date(epochMs).toLocaleDateString();
}

/** Format a byte count in human-readable form. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

/** Neutralize markdown control characters so prompt text renders literally in tooltips. */
function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!>]/g, (ch) => `\\${ch}`);
}
