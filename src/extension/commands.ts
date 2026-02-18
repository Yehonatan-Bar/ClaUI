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

/** Plan mode prompt template for CLAUDE.md injection */
const PLAN_PROMPT_HEBREW = `
---
Plan mode -
If you are in plan mode and creating a plan, then after you create the plan, create an HTML document that displays the plan:
1. In Hebrew (note - it is important that it be in Hebrew)
2. Written for a manager, meaning without code and tedious names, just a clear and easy-to-understand explanation.
---`.trim();

const PLAN_PROMPT_ENGLISH = `
---
Plan mode -
If you are in plan mode and creating a plan, then after you create the plan, create an HTML document that displays the plan:
1. In English
2. Written for a manager, meaning without code and tedious names, just a clear and easy-to-understand explanation.
---`.trim();

/**
 * Prompt the user to activate the Plans feature when no plan documents exist.
 * Offers to inject a plan mode prompt into the project's CLAUDE.md file.
 */
async function promptPlanFeatureActivation(
  workspaceRoot: string,
  log: (msg: string) => void
): Promise<void> {
  const activate = await vscode.window.showInformationMessage(
    'The Plans feature is not currently active. Would you like to enable it? ' +
    'This will add a "Plan mode" instruction to your project\'s CLAUDE.md file, ' +
    'so Claude Code will generate readable HTML plan documents for you.',
    'Yes, enable it',
    'No thanks'
  );

  if (activate !== 'Yes, enable it') {
    return;
  }

  // Ask for language preference
  const language = await vscode.window.showQuickPick(
    [
      { label: 'Hebrew', description: 'Plans will be generated in Hebrew', value: 'hebrew' },
      { label: 'English', description: 'Plans will be generated in English', value: 'english' },
    ],
    { placeHolder: 'Which language should plans be written in?' }
  );

  if (!language) {
    return;
  }

  const prompt = language.value === 'hebrew' ? PLAN_PROMPT_HEBREW : PLAN_PROMPT_ENGLISH;
  const claudeMdPath = path.join(workspaceRoot, 'CLAUDE.md');

  try {
    if (fs.existsSync(claudeMdPath)) {
      // Check if the plan prompt is already present
      const existing = fs.readFileSync(claudeMdPath, 'utf-8');
      if (existing.includes('Plan mode -')) {
        vscode.window.showInformationMessage(
          'A Plan mode instruction already exists in CLAUDE.md.'
        );
        return;
      }
      // Append the prompt to the existing file
      fs.appendFileSync(claudeMdPath, '\n\n' + prompt + '\n', 'utf-8');
      log(`Appended plan mode prompt (${language.value}) to existing CLAUDE.md`);
    } else {
      // Create a new CLAUDE.md with the prompt
      fs.writeFileSync(claudeMdPath, prompt + '\n', 'utf-8');
      log(`Created CLAUDE.md with plan mode prompt (${language.value})`);
    }

    vscode.window.showInformationMessage(
      `Plans feature enabled (${language.label})! Claude Code will now generate HTML plan documents when in plan mode.`
    );
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to update CLAUDE.md: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Registers all VS Code commands for the extension.
 * Commands are routed through the TabManager to target the active tab.
 */
export function registerCommands(
  context: vscode.ExtensionContext,
  tabManager: TabManager,
  sessionStore: SessionStore,
  log: (msg: string) => void,
  logDir: string
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

      const workspaceRoot = workspaceFolders[0].uri.fsPath;
      const kingdomDir = path.join(workspaceRoot, 'Kingdom_of_Claudes_Beloved_MDs');

      // Collect HTML plan files (if the folder exists)
      let htmlFiles: string[] = [];
      if (fs.existsSync(kingdomDir)) {
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
      }

      // No plan documents found - offer to activate the Plans feature
      if (htmlFiles.length === 0) {
        await promptPlanFeatureActivation(workspaceRoot, log);
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

    // Open the log directory in the system file explorer
    vscode.commands.registerCommand('claudeMirror.openLogDirectory', () => {
      if (fs.existsSync(logDir)) {
        vscode.env.openExternal(vscode.Uri.file(logDir));
        log(`Opened log directory: ${logDir}`);
      } else {
        vscode.window.showInformationMessage(
          'No log directory found yet. Logs will be created when a session starts.'
        );
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
