import * as vscode from 'vscode';
import { TabManager } from './session/TabManager';
import { SessionStore } from './session/SessionStore';
import { registerCommands } from './commands';

let tabManager: TabManager;
let outputChannel: vscode.OutputChannel;

function log(message: string): void {
  const timestamp = new Date().toISOString().slice(11, 23);
  outputChannel.appendLine(`[${timestamp}] ${message}`);
}

export function activate(context: vscode.ExtensionContext): void {
  // Create output channel for debugging (shared by all tabs)
  outputChannel = vscode.window.createOutputChannel('Claude Mirror');
  context.subscriptions.push(outputChannel);
  log('Extension activating...');

  // Create session store for conversation history persistence
  const sessionStore = new SessionStore(context.globalState);

  // Create the tab manager that owns all session tabs
  tabManager = new TabManager(context, log, sessionStore);

  // Register commands routed through the tab manager
  registerCommands(context, tabManager, sessionStore, log);

  log('Extension activated');
}

export function deactivate(): void {
  log('Extension deactivating...');
  tabManager?.closeAllTabs();
}
