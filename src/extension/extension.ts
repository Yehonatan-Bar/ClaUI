import * as vscode from 'vscode';
import * as path from 'path';
import { TabManager } from './session/TabManager';
import { SessionStore } from './session/SessionStore';
import { PromptHistoryStore } from './session/PromptHistoryStore';
import { FileLogger } from './session/FileLogger';
import { registerCommands } from './commands';

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
  outputChannel = vscode.window.createOutputChannel('Claude Mirror');
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

  // Create prompt history store for cross-session prompt persistence
  const promptHistoryStore = new PromptHistoryStore(context.globalState, context.workspaceState);

  // Create the tab manager that owns all session tabs
  tabManager = new TabManager(context, log, sessionStore, promptHistoryStore, enableFileLogging ? logDir : null);

  // Register commands routed through the tab manager
  registerCommands(context, tabManager, sessionStore, log, logDir);

  log('Extension activated');
}

export function deactivate(): void {
  log('Extension deactivating...');
  tabManager?.closeAllTabs();
  globalFileLogger?.dispose();
  globalFileLogger = null;
}
