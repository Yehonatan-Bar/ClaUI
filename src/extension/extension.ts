import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { TabManager } from './session/TabManager';
import { SessionStore } from './session/SessionStore';
import { ProjectAnalyticsStore } from './session/ProjectAnalyticsStore';
import { PromptHistoryStore } from './session/PromptHistoryStore';
import { FileLogger } from './session/FileLogger';
import { AchievementService } from './achievements/AchievementService';
import { AchievementInsightAnalyzer } from './achievements/AchievementInsightAnalyzer';
import { GitHubSyncService } from './achievements/GitHubSyncService';
import { SkillGenService } from './skillgen/SkillGenService';
import { installSkillFiles, injectClaudeMdInstructions } from './skillgen/SrPtdBootstrap';
import { TokenUsageRatioTracker } from './session/TokenUsageRatioTracker';
import { SkillUsageTracker } from './skillgen/SkillUsageTracker';
import { registerCommands } from './commands';
import { registerDiscoverCommand } from './session/SessionDiscovery';
import { ClaUiSidebarViewProvider } from './sidebar/ClaUiSidebarViewProvider';
import { cleanupOrphanedProcesses } from './process/orphanCleanup';

let tabManager: TabManager;
let outputChannel: vscode.OutputChannel;
let globalFileLogger: FileLogger | null = null;

function log(message: string): void {
  const timestamp = new Date().toISOString().slice(11, 23);
  const formatted = `[${timestamp}] ${message}`;
  outputChannel.appendLine(formatted);
  globalFileLogger?.write(formatted);
}

export function activate(context: vscode.ExtensionContext): void {
  // Create output channel for debugging (shared by all tabs)
  outputChannel = vscode.window.createOutputChannel('ClaUi');
  context.subscriptions.push(outputChannel);

  // Set up file-based logging
  const config = vscode.workspace.getConfiguration('claudeMirror');
  const enableFileLogging = config.get<boolean>('enableFileLogging', true);
  const customLogDir = config.get<string>('logDirectory', '');
  const logDir = customLogDir || path.join(context.globalStorageUri.fsPath, 'logs', 'ClaUiLogs');

  if (enableFileLogging) {
    globalFileLogger = new FileLogger(logDir, 'extension');
  }

  log('Extension activating...');

  // Create session store for conversation history persistence
  const sessionStore = new SessionStore(context.globalState);

  // Diagnostic: log stored sessions on activation
  const storedSessions = sessionStore.getSessions();
  log(`[SessionStore] Found ${storedSessions.length} stored sessions on activation`);
  for (const s of storedSessions.slice(0, 5)) {
    log(`[SessionStore]   - ${s.sessionId.slice(0, 8)}: "${s.name}" (${s.model}) lastActive=${s.lastActiveAt}`);
  }

  // Create prompt history store for cross-session prompt persistence
  const promptHistoryStore = new PromptHistoryStore(context.globalState, context.workspaceState);
  const achievementService = new AchievementService(context.globalState, log);
  const insightAnalyzer = new AchievementInsightAnalyzer(context.globalState);
  insightAnalyzer.setLogger(log);
  insightAnalyzer.setSecrets(context.secrets);
  achievementService.setInsightAnalyzer(insightAnalyzer);
  const githubSyncService = new GitHubSyncService(context.globalState, context.secrets, log);
  achievementService.setSyncService(githubSyncService);
  // Auto-reconnect GitHub if PAT exists in SecretStorage (fire-and-forget)
  void githubSyncService.tryAutoReconnect();

  // Create project analytics store for cross-session dashboard data (workspace-scoped)
  const projectAnalyticsStore = new ProjectAnalyticsStore(context.workspaceState);
  const storedAnalytics = projectAnalyticsStore.getSummaries();
  log(`[ProjectAnalytics] Found ${storedAnalytics.length} stored session summaries on activation`);

  // Create skill generation service (global, cross-session)
  const skillGenService = new SkillGenService(context.globalState);
  skillGenService.setLogger(log);
  skillGenService.setSecrets(context.secrets);
  // Initial document scan on activation
  const skillGenConfig = vscode.workspace.getConfiguration('claudeMirror');
  if (skillGenConfig.get<boolean>('skillGen.enabled', true)) {
    void skillGenService.scanDocuments().then(pending => {
      log(`[SkillGen] Initial scan: ${pending} pending documents`);
    });
  }

  // Auto-install SR-PTD skill and inject CLAUDE.md instructions
  void installSkillFiles(context.extensionPath, log);
  if (config.get<boolean>('srPtdAutoInject', true)) {
    const docsDir = skillGenConfig.get<string>(
      'skillGen.docsDirectory',
      'C:\\projects\\Skills\\Dev_doc_for_skills'
    );
    void injectClaudeMdInstructions(docsDir, log);
  }

  // Create global token-usage ratio tracker (shared across all tabs)
  const tokenRatioTracker = new TokenUsageRatioTracker(context.globalState);

  // Create global skill usage tracker (shared across all tabs)
  const skillsDir = path.join(os.homedir(), '.claude', 'skills');
  const skillUsageTracker = new SkillUsageTracker(skillsDir);
  skillUsageTracker.setLogger(log);
  skillGenService.setSkillUsageTracker(skillUsageTracker);

  // Create the tab manager that owns all session tabs
  tabManager = new TabManager(
    context,
    log,
    sessionStore,
    projectAnalyticsStore,
    promptHistoryStore,
    achievementService,
    enableFileLogging ? logDir : null,
    skillGenService,
    tokenRatioTracker,
    skillUsageTracker
  );

  // Register commands routed through the tab manager
  registerCommands(context, tabManager, sessionStore, log, logDir);
  registerDiscoverCommand(context, tabManager, log);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ClaUiSidebarViewProvider.viewType,
      new ClaUiSidebarViewProvider(context, log)
    )
  );

  // First install: auto-open a Claude session so the user sees ClaUI immediately
  const hasLaunched = context.globalState.get<boolean>('claui.hasLaunched', false);
  if (!hasLaunched) {
    void context.globalState.update('claui.hasLaunched', true);
    log('First install detected - auto-opening ClaUI session');
    void vscode.commands.executeCommand('claudeMirror.startSession');
  }

  // Permanent launcher status bar item (always visible)
  const launcherItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  launcherItem.text = '$(comment-discussion) ClaUI';
  launcherItem.tooltip = 'Open Claude session (Ctrl+Shift+C)';
  launcherItem.command = 'claudeMirror.startSession';
  launcherItem.show();
  context.subscriptions.push(launcherItem);

  // Kill orphaned ClaUi processes from previous sessions that weren't cleaned up
  cleanupOrphanedProcesses(log);

  log('Extension activated');
}

export function deactivate(): void {
  log('Extension deactivating...');
  tabManager?.closeAllTabs();
  globalFileLogger?.dispose();
  globalFileLogger = null;
}
