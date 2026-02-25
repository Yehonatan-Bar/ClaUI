import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { TabManager } from './TabManager';

/** Discovered session metadata from a .jsonl file on disk */
interface DiscoveredSession {
  sessionId: string;
  workspace: string;        // directory name (e.g. "c--projects-claude-code-mirror")
  workspaceLabel: string;   // human-readable (e.g. "c:/projects/claude-code-mirror")
  filePath: string;         // full path to the .jsonl file
  mtime: number;            // file modification time (epoch ms)
  size: number;             // file size in bytes
  firstPrompt: string;      // first user message (truncated)
}

/** How many bytes to read from the beginning of a JSONL file to find the first prompt */
const PROMPT_SCAN_BYTES = 16_384;
const MAX_PROMPT_LENGTH = 150;

/**
 * Scans ~/.claude/projects/ to discover all Claude Code sessions on disk,
 * regardless of whether they were opened through ClaUi.
 */
export class SessionDiscovery {
  private readonly projectsDir: string;

  constructor() {
    this.projectsDir = path.join(os.homedir(), '.claude', 'projects');
  }

  /** Discover all sessions across all workspaces, sorted by mtime (newest first) */
  async discoverAll(): Promise<DiscoveredSession[]> {
    const sessions: DiscoveredSession[] = [];

    if (!fs.existsSync(this.projectsDir)) {
      return sessions;
    }

    let dirs: string[];
    try {
      dirs = fs.readdirSync(this.projectsDir);
    } catch {
      return sessions;
    }

    for (const dirName of dirs) {
      const dirPath = path.join(this.projectsDir, dirName);
      try {
        const stat = fs.statSync(dirPath);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }

      const dirSessions = this.scanWorkspaceDir(dirPath, dirName);
      sessions.push(...dirSessions);
    }

    sessions.sort((a, b) => b.mtime - a.mtime);
    return sessions;
  }

  /** Discover sessions for the current VS Code workspace only */
  async discoverForWorkspace(workspacePath: string): Promise<DiscoveredSession[]> {
    if (!fs.existsSync(this.projectsDir)) {
      return [];
    }

    // Try both case variants for the directory name
    const dirName = this.workspaceToDir(workspacePath);
    const candidates = [dirName];

    // On Windows the drive letter case can differ (C vs c)
    if (/^[a-zA-Z]--/.test(dirName)) {
      const alt = dirName[0] === dirName[0].toUpperCase()
        ? dirName[0].toLowerCase() + dirName.slice(1)
        : dirName[0].toUpperCase() + dirName.slice(1);
      candidates.push(alt);
    }

    for (const candidate of candidates) {
      const dirPath = path.join(this.projectsDir, candidate);
      if (fs.existsSync(dirPath)) {
        const sessions = this.scanWorkspaceDir(dirPath, candidate);
        sessions.sort((a, b) => b.mtime - a.mtime);
        return sessions;
      }
    }

    return [];
  }

  /** Scan a single workspace directory for .jsonl session files */
  private scanWorkspaceDir(dirPath: string, dirName: string): DiscoveredSession[] {
    const sessions: DiscoveredSession[] = [];
    const label = this.dirNameToLabel(dirName);

    let files: string[];
    try {
      files = fs.readdirSync(dirPath);
    } catch {
      return sessions;
    }

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;

      const filePath = path.join(dirPath, file);
      try {
        const stat = fs.statSync(filePath);
        const sessionId = file.replace('.jsonl', '');
        const firstPrompt = this.extractFirstPrompt(filePath);

        sessions.push({
          sessionId,
          workspace: dirName,
          workspaceLabel: label,
          filePath,
          mtime: stat.mtimeMs,
          size: stat.size,
          firstPrompt,
        });
      } catch {
        // Skip files we can't read
      }
    }

    return sessions;
  }

  /**
   * Read the first ~16KB of a JSONL file to extract the first user message.
   * Looks for `type: "user"` or `type: "queue-operation"` with `operation: "enqueue"`.
   */
  private extractFirstPrompt(filePath: string): string {
    try {
      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(PROMPT_SCAN_BYTES);
      const bytesRead = fs.readSync(fd, buffer, 0, PROMPT_SCAN_BYTES, 0);
      fs.closeSync(fd);

      const text = buffer.toString('utf8', 0, bytesRead);
      const lines = text.split('\n');

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);

          // Queue operation with enqueue has the prompt content directly
          if (obj.type === 'queue-operation' && obj.operation === 'enqueue' && obj.content) {
            return truncate(String(obj.content), MAX_PROMPT_LENGTH);
          }

          // User message with role: "user"
          if (obj.type === 'user' && obj.message?.role === 'user') {
            const content = obj.message.content;
            if (typeof content === 'string') {
              return truncate(content, MAX_PROMPT_LENGTH);
            }
            // ContentBlock array
            if (Array.isArray(content)) {
              const textBlock = content.find((b: { type: string }) => b.type === 'text');
              if (textBlock?.text) {
                return truncate(textBlock.text, MAX_PROMPT_LENGTH);
              }
            }
          }
        } catch {
          // Malformed JSON line - skip
        }
      }
    } catch {
      // File read error
    }

    return '';
  }

  /**
   * Convert a workspace absolute path to the directory name format Claude CLI uses.
   * e.g. "C:\\projects\\app" -> "C--projects-app"
   */
  workspaceToDir(wsPath: string): string {
    return wsPath.replace(/[:\\/]/g, '-');
  }

  /**
   * Best-effort reverse of directory name to readable path.
   * e.g. "C--projects-app" -> "C:/projects/app"
   * The double-dash after drive letter is the colon, single dashes are path separators.
   */
  dirNameToLabel(dirName: string): string {
    // Match drive letter pattern: X-- at the start
    const driveMatch = dirName.match(/^([a-zA-Z])--(.*)$/);
    if (driveMatch) {
      const drive = driveMatch[1];
      const rest = driveMatch[2].replace(/-/g, '/');
      return `${drive}:/${rest}`;
    }
    // No drive letter - just replace dashes with slashes
    return dirName.replace(/-/g, '/');
  }
}

/** Truncate a string and add ellipsis if it exceeds maxLen */
function truncate(str: string, maxLen: number): string {
  const cleaned = str.replace(/[\r\n]+/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen - 3) + '...';
}

/** Format a timestamp as relative time (e.g. "2 hours ago", "3 days ago") */
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

/** Format file size in human-readable form */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

/**
 * Register the "Discover All Sessions" command.
 * Two-step QuickPick: choose scope -> choose session -> open in new tab.
 */
export function registerDiscoverCommand(
  context: vscode.ExtensionContext,
  tabManager: TabManager,
  log: (msg: string) => void
): void {
  const discovery = new SessionDiscovery();

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeMirror.discoverSessions', async () => {
      log('[Discover] Command invoked');

      // Step 1: Scope picker (skip if no workspace open)
      const workspaceFolders = vscode.workspace.workspaceFolders;
      let sessions: DiscoveredSession[];

      if (workspaceFolders && workspaceFolders.length > 0) {
        const scopeItems: vscode.QuickPickItem[] = [
          { label: '$(folder) Current Workspace', description: workspaceFolders[0].uri.fsPath },
          { label: '$(globe) All Workspaces', description: 'Browse sessions from all projects' },
        ];

        const scope = await vscode.window.showQuickPick(scopeItems, {
          placeHolder: 'Discover sessions from...',
        });

        if (!scope) return;

        if (scope.label.includes('Current')) {
          sessions = await discovery.discoverForWorkspace(workspaceFolders[0].uri.fsPath);
        } else {
          sessions = await discovery.discoverAll();
        }
      } else {
        // No workspace open - show all
        sessions = await discovery.discoverAll();
      }

      log(`[Discover] Found ${sessions.length} sessions`);

      if (sessions.length === 0) {
        vscode.window.showInformationMessage('No Claude sessions found on disk.');
        return;
      }

      // Step 2: Session picker
      const showWorkspace = !workspaceFolders || sessions.some(s => s.workspace !== sessions[0].workspace);

      const items = sessions.map(s => ({
        label: s.firstPrompt || `Session ${s.sessionId.slice(0, 8)}...`,
        description: `${formatRelativeTime(s.mtime)}  |  ${formatSize(s.size)}`,
        detail: showWorkspace ? s.workspaceLabel : undefined,
        sessionId: s.sessionId,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a session to resume',
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (!picked) return;

      log(`[Discover] Resuming session: ${picked.sessionId}`);

      const tab = tabManager.createTabForProvider('claude');
      try {
        await tab.startSession({ resume: picked.sessionId });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to resume session: ${errorMessage}`);
      }
    })
  );
}
