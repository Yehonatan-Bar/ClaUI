import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { TabManager } from './session/TabManager';
import type { SessionStore } from './session/SessionStore';

function collectUrisFromArgs(args: unknown[]): vscode.Uri[] {
  const uris: vscode.Uri[] = [];

  const visit = (value: unknown): void => {
    if (value instanceof vscode.Uri) {
      uris.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
    }
  };

  args.forEach(visit);
  return uris;
}

/** Format a date string as a human-readable relative time */
function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(isoDate).toLocaleDateString();
}

/**
 * Registers all VS Code commands for the extension.
 * Commands are routed through the TabManager to target the active tab.
 */
export function registerCommands(
  context: vscode.ExtensionContext,
  tabManager: TabManager,
  sessionStore: SessionStore,
  log: (msg: string) => void
): void {
  context.subscriptions.push(
    // Start a NEW session in a new tab
    vscode.commands.registerCommand('claudeMirror.startSession', async () => {
      const tab = tabManager.createTab();
      try {
        await tab.startSession();
        log('New tab session started');
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(
          `Failed to start Claude session: ${errorMessage}`
        );
      }
    }),

    // Stop the ACTIVE tab's session
    vscode.commands.registerCommand('claudeMirror.stopSession', () => {
      const tab = tabManager.getActiveTab();
      if (!tab) {
        vscode.window.showWarningMessage('No active Claude Mirror tab.');
        return;
      }
      tab.stopSession();
      vscode.window.showInformationMessage('Claude session stopped.');
    }),

    // Cancel / pause the ACTIVE tab's in-flight request (Escape key)
    vscode.commands.registerCommand('claudeMirror.cancelRequest', () => {
      const tab = tabManager.getActiveTab();
      if (tab?.isRunning) {
        tab.cancelRequest();
        log('Cancel request sent to active tab');
      }
    }),

    // Reveal the active tab, or create a new one if none exist
    vscode.commands.registerCommand('claudeMirror.toggleView', () => {
      const tab = tabManager.getActiveTab();
      if (tab) {
        tab.reveal();
      } else {
        tabManager.createTab();
      }
    }),

    // Send a message to the ACTIVE tab via the CLI control protocol
    vscode.commands.registerCommand('claudeMirror.sendMessage', async () => {
      const tab = tabManager.getActiveTab();
      if (!tab || !tab.isRunning) {
        vscode.window.showWarningMessage(
          'No active Claude session. Start one first.'
        );
        return;
      }

      const text = await vscode.window.showInputBox({
        prompt: 'Send a message to Claude',
        placeHolder: 'Type your message...',
      });

      if (text) {
        tab.sendText(text);
      }
    }),

    // Compact context in the ACTIVE tab
    vscode.commands.registerCommand('claudeMirror.compact', () => {
      const tab = tabManager.getActiveTab();
      if (!tab || !tab.isRunning) {
        vscode.window.showWarningMessage(
          'No active Claude session. Start one first.'
        );
        return;
      }
      tab.compact();
      vscode.window.showInformationMessage('Context compaction requested.');
    }),

    // Resume an existing session in a NEW tab
    vscode.commands.registerCommand('claudeMirror.resumeSession', async () => {
      const sessionId = await vscode.window.showInputBox({
        prompt: 'Enter session ID to resume',
        placeHolder: 'session-id',
      });

      if (sessionId) {
        const tab = tabManager.createTab();
        try {
          await tab.startSession({ resume: sessionId });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `Failed to resume session: ${errorMessage}`
          );
        }
      }
    }),

    // Show conversation history in a QuickPick
    vscode.commands.registerCommand('claudeMirror.showHistory', async () => {
      const sessions = sessionStore.getSessions();

      if (sessions.length === 0) {
        vscode.window.showInformationMessage('No conversation history yet.');
        return;
      }

      const items = sessions.map(s => ({
        label: s.name || `Session ${s.sessionId.slice(0, 8)}`,
        description: s.model || '',
        detail: formatRelativeTime(s.lastActiveAt),
        sessionId: s.sessionId,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a conversation to resume',
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (picked) {
        log(`Resuming session from history: ${picked.sessionId}`);
        const tab = tabManager.createTab();
        try {
          await tab.startSession({ resume: picked.sessionId });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `Failed to resume session: ${errorMessage}`
          );
        }
      }
    }),

    // Open HTML plan documents from Kingdom_of_Claudes_Beloved_MDs in the default browser
    vscode.commands.registerCommand('claudeMirror.openPlanDocs', async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage('No workspace folder open.');
        return;
      }

      const kingdomDir = path.join(
        workspaceFolders[0].uri.fsPath,
        'Kingdom_of_Claudes_Beloved_MDs'
      );

      if (!fs.existsSync(kingdomDir)) {
        vscode.window.showInformationMessage(
          'No plan documents folder found (Kingdom_of_Claudes_Beloved_MDs/).'
        );
        return;
      }

      let htmlFiles: string[];
      try {
        const allFiles = fs.readdirSync(kingdomDir);
        htmlFiles = allFiles
          .filter(f => f.endsWith('.html'))
          .sort((a, b) => {
            const aStat = fs.statSync(path.join(kingdomDir, a));
            const bStat = fs.statSync(path.join(kingdomDir, b));
            return bStat.mtimeMs - aStat.mtimeMs;
          });
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed to read plan docs folder: ${err instanceof Error ? err.message : String(err)}`
        );
        return;
      }

      if (htmlFiles.length === 0) {
        vscode.window.showInformationMessage(
          'No HTML plan documents found in Kingdom_of_Claudes_Beloved_MDs/.'
        );
        return;
      }

      // Single file: open directly
      if (htmlFiles.length === 1) {
        const filePath = path.join(kingdomDir, htmlFiles[0]);
        log(`Opening single plan doc: ${filePath}`);
        await vscode.env.openExternal(vscode.Uri.file(filePath));
        return;
      }

      // Multiple files: show QuickPick sorted by modification time
      const items = htmlFiles.map(f => {
        const filePath = path.join(kingdomDir, f);
        const stat = fs.statSync(filePath);
        return {
          label: f,
          description: formatRelativeTime(stat.mtime.toISOString()),
          filePath,
        };
      });

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a plan document to open in browser',
        matchOnDescription: true,
      });

      if (picked) {
        log(`Opening plan doc: ${picked.filePath}`);
        await vscode.env.openExternal(vscode.Uri.file(picked.filePath));
      }
    }),

    // Send file/folder path(s) to the ACTIVE tab's chat input
    vscode.commands.registerCommand(
      'claudeMirror.sendFilePathToChat',
      (...args: unknown[]) => {
        const argUris = collectUrisFromArgs(args).filter(
          (uri) => uri.scheme === 'file'
        );
        const activeEditorUri = vscode.window.activeTextEditor?.document.uri;
        const fallbackUris =
          activeEditorUri?.scheme === 'file' ? [activeEditorUri] : [];
        const uris = argUris.length > 0 ? argUris : fallbackUris;

        if (uris.length === 0) {
          vscode.window.showWarningMessage(
            'No local file or folder selected to send to Claude Mirror.'
          );
          return;
        }

        const paths = [...new Set(uris.map((uri) => uri.fsPath))];

        // Get or create a tab to send the paths to
        const tab = tabManager.getOrCreateTab();
        tab.reveal();
        tab.postMessage({ type: 'filePathsPicked', paths });
        log(`Sent ${paths.length} path(s) to chat input from Explorer command`);
      }
    )
  );
}
