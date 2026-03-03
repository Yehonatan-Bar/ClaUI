import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import type { TabManager } from './session/TabManager';
import type { SessionStore } from './session/SessionStore';
import type { ProviderId, SerializedChatMessage } from './types/webview-messages';
import { openHtmlPreviewPanel } from './webview/HtmlPreviewPanel';

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

const CLAUI_REPOSITORY_URL = 'https://github.com/Yehonatan-Bar/ClaUI';
const CLAUI_ISSUES_URL = `${CLAUI_REPOSITORY_URL}/issues`;
const CLAUI_FEATURE_REQUEST_URL =
  `${CLAUI_REPOSITORY_URL}/issues/new` +
  '?labels=enhancement' +
  '&title=Feature%20request%3A%20' +
  '&body=' +
  encodeURIComponent(
    [
      '## What would you like to see?',
      '',
      '',
      '## Why is it useful?',
      '',
      '',
      '## Additional context / screenshots',
      '',
    ].join('\n')
  );
const CLAUI_FEEDBACK_EMAIL = 'yonzbar@gmail.com';

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
    { placeHolder: 'Which language should plans be written in?', ignoreFocusOut: true }
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
  const getConfiguredProvider = (): ProviderId =>
    vscode.workspace.getConfiguration('claudeMirror').get<ProviderId>('provider', 'claude');

  context.subscriptions.push(
    // Start a NEW session in a new tab
    vscode.commands.registerCommand('claudeMirror.startSession', async () => {
      const provider = getConfiguredProvider();
      const tab = tabManager.createTabForProvider(provider);
      try {
        await tab.startSession();
        log(`New ${provider} tab session started`);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(
          `Failed to start ${provider === 'codex' ? 'Codex' : provider === 'remote' ? 'Happy' : 'Claude'} session: ${errorMessage}`
        );
      }
    }),

    vscode.commands.registerCommand('claudeMirror.authenticateHappy', () => {
      const happyCliPath = vscode.workspace
        .getConfiguration('claudeMirror')
        .get<string>('happy.cliPath', 'happy');
      const terminal = vscode.window.createTerminal({ name: 'Happy Coder Auth' });
      terminal.show();
      terminal.sendText(`${happyCliPath} auth`, true);
      log('Opened Happy Coder auth terminal');
    }),

    // Stop the ACTIVE tab's session
    vscode.commands.registerCommand('claudeMirror.stopSession', () => {
      const tab = tabManager.getActiveTab();
      if (!tab) {
        vscode.window.showWarningMessage('No active ClaUi tab.');
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
        tabManager.createTabForProvider(getConfiguredProvider());
      }
    }),

    // Send a message to the ACTIVE tab via the CLI control protocol
    vscode.commands.registerCommand('claudeMirror.sendMessage', async () => {
      const tab = tabManager.getActiveTab();
      if (!tab || !tab.isRunning) {
        vscode.window.showWarningMessage(
          'No active session. Start one first.'
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
          'No active session. Start one first.'
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
        const stored = sessionStore.getSession(sessionId);
        const provider = stored?.provider ?? getConfiguredProvider();
        const tab = tabManager.createTabForProvider(provider);
        try {
          await tab.startSession({ resume: sessionId });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `Failed to resume ${provider === 'codex' ? 'Codex' : provider === 'remote' ? 'Happy' : 'Claude'} session: ${errorMessage}`
          );
        }
      }
    }),

    // Show conversation history in a QuickPick
    vscode.commands.registerCommand('claudeMirror.showHistory', async () => {
      // Step 1: Ask which history source
      const sourceItems: vscode.QuickPickItem[] = [
        {
          label: '$(window) Extension Sessions',
          description: 'Conversations opened inside ClaUi',
        },
        {
          label: '$(search) All Sessions',
          description: 'Discover all Claude sessions from disk (including CLI)',
        },
      ];

      const source = await vscode.window.showQuickPick(sourceItems, {
        placeHolder: 'Browse conversation history from...',
        ignoreFocusOut: true,
      });

      if (!source) { return; }

      if (source.label.includes('All Sessions')) {
        await vscode.commands.executeCommand('claudeMirror.discoverSessions');
        return;
      }

      // Step 2: Show ClaUi extension sessions
      const allSessions = sessionStore.getSessions();
      log(`[showHistory] Found ${allSessions.length} sessions in store`);

      // Filter to sessions from the current workspace, if one is open
      const currentWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const normalizePath = (p: string) => p.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
      const sessions = currentWorkspace
        ? allSessions.filter(s => {
            // Exclude sessions without workspacePath — they belong to unknown projects
            if (!s.workspacePath) {
              return false;
            }
            // Normalize separators and case for Windows path comparison
            return normalizePath(s.workspacePath) === normalizePath(currentWorkspace);
          })
        : allSessions;

      log(`[showHistory] Showing ${sessions.length} sessions for workspace: ${currentWorkspace || '(none)'}`);

      if (sessions.length === 0) {
        const msg = currentWorkspace
          ? 'No ClaUi conversation history for this project yet. Use "All Sessions" to discover CLI sessions.'
          : 'No ClaUi conversation history yet. Use "All Sessions" to discover CLI sessions.';
        vscode.window.showInformationMessage(msg);
        return;
      }

      const items = sessions.map(s => ({
        label: s.name || `Session ${s.sessionId.slice(0, 8)}`,
        description: `${s.provider === 'codex' ? 'Codex' : s.provider === 'remote' ? 'Happy' : 'Claude'} | ${s.model || 'unknown'}  ${formatRelativeTime(s.lastActiveAt)}`,
        detail: s.firstPrompt || undefined,
        sessionId: s.sessionId,
        provider: s.provider,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a conversation to resume',
        matchOnDescription: true,
        matchOnDetail: true,
        ignoreFocusOut: true,
      });

      if (picked) {
        log(`Resuming ${picked.provider} session from history: ${picked.sessionId}`);
        const tab = tabManager.createTabForProvider(picked.provider);
        try {
          await tab.startSession({ resume: picked.sessionId });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `Failed to resume ${picked.provider === 'codex' ? 'Codex' : picked.provider === 'remote' ? 'Happy' : 'Claude'} session: ${errorMessage}`
          );
        }
      }
    }),

    // Open HTML plan documents from multiple locations in the default browser
    vscode.commands.registerCommand('claudeMirror.openPlanDocs', async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage('No workspace folder open.');
        return;
      }

      const workspaceRoot = workspaceFolders[0].uri.fsPath;
      const kingdomDir = path.join(workspaceRoot, 'Kingdom_of_Claudes_Beloved_MDs');
      const claudePlansDir = path.join(os.homedir(), '.claude', 'plans');

      // Collect HTML plan files from all known plan directories (deduplicated by path)
      const planFiles: Array<{ label: string; description: string; filePath: string; mtimeMs: number }> = [];
      const seenPaths = new Set<string>();

      const collectHtmlFiles = (dir: string, locationTag: string, maxDepth = 1, currentDepth = 0) => {
        if (currentDepth >= maxDepth || !fs.existsSync(dir)) return;
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isFile() && entry.name.endsWith('.html')) {
              const normalized = fullPath.replace(/\\/g, '/').toLowerCase();
              if (seenPaths.has(normalized)) continue;
              seenPaths.add(normalized);
              const stat = fs.statSync(fullPath);
              planFiles.push({
                label: entry.name,
                description: `${locationTag} - ${formatRelativeTime(stat.mtime.toISOString())}`,
                filePath: fullPath,
                mtimeMs: stat.mtimeMs,
              });
            } else if (entry.isDirectory() && currentDepth + 1 < maxDepth) {
              collectHtmlFiles(fullPath, locationTag, maxDepth, currentDepth + 1);
            }
          }
        } catch {
          // Skip directories that can't be read
        }
      };

      // Find all directories named "plans" within the workspace (up to 3 levels deep)
      const skipDirs = new Set(['node_modules', '.git', 'dist', '.vscode', 'Kingdom_of_Claudes_Beloved_MDs']);
      const findPlansDirs = (dir: string, depth: number): string[] => {
        if (depth <= 0) return [];
        const results: string[] = [];
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory() || skipDirs.has(entry.name)) continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.name === 'plans') {
              results.push(fullPath);
            }
            results.push(...findPlansDirs(fullPath, depth - 1));
          }
        } catch {
          // Skip unreadable directories
        }
        return results;
      };

      const projectPlansDirs = findPlansDirs(workspaceRoot, 3);

      collectHtmlFiles(kingdomDir, 'Kingdom', 3);
      collectHtmlFiles(workspaceRoot, 'Root', 3);
      for (const pd of projectPlansDirs) {
        const relative = path.relative(workspaceRoot, pd).replace(/\\/g, '/');
        collectHtmlFiles(pd, relative, 3);
      }
      collectHtmlFiles(claudePlansDir, '~/.claude/plans', 3);

      // Sort all collected files by modification time (newest first)
      planFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);

      // No plan documents found - offer to activate the Plans feature
      if (planFiles.length === 0) {
        await promptPlanFeatureActivation(workspaceRoot, log);
        return;
      }

      // Single file: open directly in preview panel
      if (planFiles.length === 1) {
        log(`Opening single plan doc: ${planFiles[0].filePath}`);
        const html = fs.readFileSync(planFiles[0].filePath, 'utf-8');
        openHtmlPreviewPanel(html, planFiles[0].label);
        return;
      }

      // Multiple files: show QuickPick sorted by modification time
      const picked = await vscode.window.showQuickPick(planFiles, {
        placeHolder: 'Select a plan document to open in browser',
        matchOnDescription: true,
        ignoreFocusOut: true,
      });

      if (picked) {
        log(`Opening plan doc: ${picked.filePath}`);
        const html = fs.readFileSync(picked.filePath, 'utf-8');
        openHtmlPreviewPanel(html, picked.label);
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

    // Open feedback/reporting options (Issue Reporter, GitHub, or email)
    vscode.commands.registerCommand('claudeMirror.sendFeedback', async () => {
      const extensionId = context.extension.id;
      const extensionVersion = String(
        ((context.extension.packageJSON as { version?: unknown } | undefined)?.version) ?? 'unknown'
      );

      const picked = await vscode.window.showQuickPick(
        [
          {
            label: '$(bug) Report Bug',
            description: 'Open VS Code Issue Reporter (or GitHub Issues fallback)',
            value: 'bug' as const,
          },
          {
            label: '$(light-bulb) Feature Request',
            description: 'Open GitHub Issues (feature request template)',
            value: 'feature' as const,
          },
          {
            label: '$(mail) Email Feedback',
            description: `Compose an email to ${CLAUI_FEEDBACK_EMAIL}`,
            value: 'email' as const,
          },
          {
            label: '$(report) Full Bug Report',
            description: 'Collect diagnostics, chat with AI, send full report',
            value: 'fullBugReport' as const,
          },
        ],
        {
          placeHolder: 'How would you like to send feedback for ClaUi?',
          ignoreFocusOut: true,
        }
      );

      if (!picked) {
        return;
      }

      if (picked.value === 'bug') {
        try {
          await vscode.commands.executeCommand('vscode.openIssueReporter', {
            extensionId,
          });
          log(`Opened VS Code Issue Reporter for ${extensionId}`);
          return;
        } catch (err) {
          log(`vscode.openIssueReporter failed: ${err}`);
        }

        try {
          await vscode.commands.executeCommand('workbench.action.openIssueReporter');
          log('Opened generic VS Code Issue Reporter');
          return;
        } catch (err) {
          log(`workbench.action.openIssueReporter failed: ${err}`);
        }

        await vscode.env.openExternal(vscode.Uri.parse(CLAUI_ISSUES_URL));
        log(`Opened GitHub Issues fallback: ${CLAUI_ISSUES_URL}`);
        return;
      }

      if (picked.value === 'feature') {
        await vscode.env.openExternal(vscode.Uri.parse(CLAUI_FEATURE_REQUEST_URL));
        log(`Opened GitHub feature request page: ${CLAUI_FEATURE_REQUEST_URL}`);
        return;
      }

      if (picked.value === 'fullBugReport') {
        const activeTab = tabManager.getActiveTab();
        if (activeTab) {
          activeTab.postMessage({ type: 'bugReportOpen' });
          log('Opened Full Bug Report panel in active tab');
        } else {
          vscode.window.showWarningMessage('No active ClaUi session. Open a session first to use Full Bug Report.');
          log('Full Bug Report: no active tab');
        }
        return;
      }

      const mailSubject = encodeURIComponent('ClaUi Feedback');
      const mailBody = encodeURIComponent(
        [
          'Hi,',
          '',
          'Feedback for ClaUi:',
          '',
          '',
          `Extension version: ${extensionVersion}`,
          `VS Code version: ${vscode.version}`,
          '',
          '(Optional) Steps to reproduce / context:',
          '',
        ].join('\n')
      );
      const mailtoUri = vscode.Uri.parse(
        `mailto:${CLAUI_FEEDBACK_EMAIL}?subject=${mailSubject}&body=${mailBody}`
      );
      await vscode.env.openExternal(mailtoUri);
      log(`Opened feedback email draft to ${CLAUI_FEEDBACK_EMAIL}`);
    }),

    // Toggle achievements globally (full hide + full disable)
    vscode.commands.registerCommand('claudeMirror.toggleAchievements', async () => {
      const config = vscode.workspace.getConfiguration('claudeMirror');
      const current = config.get<boolean>('achievements.enabled', true);
      const next = !current;
      await config.update('achievements.enabled', next, true);
      vscode.window.showInformationMessage(
        next ? 'ClaUi achievements enabled.' : 'ClaUi achievements disabled.'
      );
    }),

    // Toggle Agent Teams panel on the active tab
    vscode.commands.registerCommand('claudeMirror.toggleTeamPanel', () => {
      // The webview handles the toggle logic via its own state
      tabManager.postToActiveTab({ type: 'teamDetected', teamName: '' });
    }),

    // Fork conversation from a specific message (opens a new tab)
    vscode.commands.registerCommand(
      'claudeMirror.forkFromMessage',
      async (sessionId: string, forkMessageIndex: number, promptText: string, messages: SerializedChatMessage[]) => {
        const sourceProvider = sessionStore.getSession(sessionId)?.provider ?? 'claude';
        log(
          `Forking ${sourceProvider} session ${sessionId} from message index ${forkMessageIndex}, historyLen=${messages?.length ?? 0}`
        );
        const tab = tabManager.createTabForProvider(sourceProvider);
        try {
          tab.setForkInit({ promptText, messages: messages || [] });
          await tab.startSession({ resume: sessionId, fork: true });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `Failed to fork session: ${errorMessage}`
          );
        }
      }
    ),

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
            'No local file or folder selected to send to ClaUi.'
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
