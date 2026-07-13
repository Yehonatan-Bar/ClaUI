import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import type { TabManager } from './session/TabManager';
import { SessionTab } from './session/SessionTab';
import type { SessionStore } from './session/SessionStore';
import type { ProviderId, SerializedChatMessage } from './types/webview-messages';
import { openHtmlPreviewPanel } from './webview/HtmlPreviewPanel';
import { MultiParticipantSessionTab } from './multiparticipant/MultiParticipantSessionTab';
import { SessionTruncator } from './session/SessionTruncator';
import { AuthManager } from './auth/AuthManager';
import {
  DEFAULT_CLAUDE_ACCOUNT_PROFILE_ID,
  type ClaudeAccountProfile,
} from './auth/ClaudeAccountProfileStore';

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

function quoteTerminalArg(value: string): string {
  const trimmed = (value || 'claude').trim() || 'claude';
  if (!/[\s"'&|<>^]/.test(trimmed)) {
    return trimmed;
  }
  return `"${trimmed.replace(/"/g, '\\"')}"`;
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
  logDir: string,
  developerUsageReporter?: import('./usage/DeveloperUsageReporter').DeveloperUsageReporter
): void {
  const getConfiguredProvider = (): ProviderId =>
    vscode.workspace.getConfiguration('claudeMirror').get<ProviderId>('provider', 'claude');
  const providerLabel = (provider: ProviderId): string =>
    provider === 'codex' ? 'Codex' : provider === 'remote' ? 'Happy' : 'Claude';
  const handoffProviderLabel = (provider: ProviderId | 'claude' | 'codex'): string =>
    provider === 'claude' ? 'Claude Code' : providerLabel(provider);
  const claudeProfileStore = tabManager.getClaudeAccountProfileStore();
  const authManager = new AuthManager();

  const profileLabel = (profile: ClaudeAccountProfile): string =>
    profile.isDefault ? 'Default' : profile.label;

  const pickClaudeProfile = async (
    placeHolder: string,
    opts?: { includeDefault?: boolean; excludeProfileId?: string | null }
  ): Promise<ClaudeAccountProfile | undefined> => {
    const includeDefault = opts?.includeDefault ?? true;
    const profiles = claudeProfileStore
      .list()
      .filter((profile) => includeDefault || !profile.isDefault)
      .filter((profile) => profile.id !== opts?.excludeProfileId);
    const items = profiles.map((profile) => ({
      label: `${profile.isDefault ? '$(home) ' : '$(account) '}${profileLabel(profile)}`,
      description: profile.isDefault ? 'Uses the normal Claude CLI config' : `profileId=${profile.id}`,
      detail: profile.lastUsedAt ? `Last used: ${formatRelativeTime(profile.lastUsedAt)}` : undefined,
      profile,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder,
      matchOnDescription: true,
      matchOnDetail: true,
      ignoreFocusOut: true,
    });
    return picked?.profile;
  };

  const profileForSession = (sessionId: string | undefined): ClaudeAccountProfile => {
    const profileId = sessionId ? sessionStore.getSession(sessionId)?.claudeAccountProfileId : undefined;
    return claudeProfileStore.getProfile(profileId) ?? claudeProfileStore.getDefaultProfile();
  };

  const applyProfileToTab = (tab: unknown, profile: ClaudeAccountProfile): void => {
    if (tab instanceof SessionTab) {
      tabManager.applyClaudeAccountProfile(tab, profile);
    }
  };

  const createClaudeProfile = async (): Promise<ClaudeAccountProfile | undefined> => {
    const label = await vscode.window.showInputBox({
      prompt: 'Claude account profile name',
      placeHolder: 'Work, Personal, Client A...',
      ignoreFocusOut: true,
      validateInput: (value) => value.trim() ? undefined : 'Profile name is required.',
    });
    if (!label) {
      return undefined;
    }
    const profile = await claudeProfileStore.create(label);
    vscode.window.showInformationMessage(`Claude account profile created: ${profile.label}`);
    return profile;
  };

  const openClaudeLoginForProfile = async (profile: ClaudeAccountProfile): Promise<void> => {
    const cliPath = vscode.workspace.getConfiguration('claudeMirror').get<string>('cliPath', 'claude');
    const configDir = claudeProfileStore.resolveConfigDir(profile);
    const terminal = vscode.window.createTerminal({
      name: `Claude Login: ${profileLabel(profile)}`,
      env: configDir ? { CLAUDE_CONFIG_DIR: configDir } : undefined,
    });
    terminal.show();
    terminal.sendText(`${quoteTerminalArg(cliPath)} auth login`, true);
    await claudeProfileStore.markUsed(profile.id);
    log(`Opened Claude login terminal for profileId=${profile.id}`);
  };

  const logoutClaudeProfile = async (profile: ClaudeAccountProfile): Promise<void> => {
    const cliPath = vscode.workspace.getConfiguration('claudeMirror').get<string>('cliPath', 'claude');
    const ok = await authManager.logout(cliPath, profile);
    if (ok) {
      vscode.window.showInformationMessage(`Logged out Claude profile: ${profileLabel(profile)}`);
      log(`Claude logout succeeded for profileId=${profile.id}`);
    } else {
      vscode.window.showErrorMessage(`Claude logout failed for profile: ${profileLabel(profile)}`);
      log(`Claude logout failed for profileId=${profile.id}`);
    }
  };

  const startClaudeTabWithProfile = async (profile: ClaudeAccountProfile): Promise<void> => {
    const tab = tabManager.createClaudeTab();
    tabManager.applyClaudeAccountProfile(tab, profile);
    await tab.startSession();
    await claudeProfileStore.markUsed(profile.id);
    log(`New Claude tab started with profileId=${profile.id}`);
  };

  const runAccountHandoff = async (args?: {
    sourceTabId?: string;
    targetProfileId?: string;
    keepSourceOpen?: boolean;
  }): Promise<void> => {
    const sourceTab = args?.sourceTabId ? tabManager.getTabById(args.sourceTabId) : tabManager.getActiveTab();
    if (!sourceTab) {
      vscode.window.showWarningMessage('No active Claude tab for account handoff.');
      return;
    }
    if (!(sourceTab instanceof SessionTab) || sourceTab.getProvider() !== 'claude') {
      vscode.window.showWarningMessage('Switch Account With Context requires an active Claude Code tab.');
      return;
    }
    if (sourceTab.isBusyState()) {
      vscode.window.showWarningMessage('Finish or stop the current turn before switching Claude accounts.');
      return;
    }

    const sourceProfileId = sourceTab.getClaudeAccountProfileId() ?? DEFAULT_CLAUDE_ACCOUNT_PROFILE_ID;
    let targetProfile = args?.targetProfileId ? claudeProfileStore.getProfile(args.targetProfileId) : undefined;
    if (!targetProfile) {
      targetProfile = await pickClaudeProfile('Switch this Claude session to account profile...', {
        includeDefault: true,
        excludeProfileId: sourceProfileId,
      });
    }
    if (!targetProfile) {
      return;
    }

    try {
      const result = await tabManager.handoffClaudeAccount({
        sourceTabId: sourceTab.id,
        targetProfileId: targetProfile.id,
        keepSourceOpen: args?.keepSourceOpen ?? true,
      });
      const artifactHint = result.artifactPath ? ` Artifact: ${result.artifactPath}` : '';
      vscode.window.showInformationMessage(
        `Claude account handoff completed: ${profileLabel(targetProfile)}.${artifactHint}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Claude account handoff failed: ${message}`);
    }
  };
  const runProviderHandoff = async (
    args?: { sourceTabId?: string; targetProvider?: 'claude' | 'codex'; keepSourceOpen?: boolean },
    options?: { requireSourceProvider?: 'claude' | 'codex' }
  ): Promise<void> => {
    const sourceTab = args?.sourceTabId ? tabManager.getTabById(args.sourceTabId) : tabManager.getActiveTab();
    if (!sourceTab) {
      const requiredSource = options?.requireSourceProvider;
      const guidance = requiredSource ? ` Open a ${handoffProviderLabel(requiredSource)} tab and try again.` : '';
      vscode.window.showWarningMessage(`No active ClaUi tab for provider handoff.${guidance}`);
      return;
    }

    const sourceProvider = sourceTab.getProvider();
    if (options?.requireSourceProvider && sourceProvider !== options.requireSourceProvider) {
      vscode.window.showWarningMessage(
        `This command requires an active ${handoffProviderLabel(options.requireSourceProvider)} tab.`
      );
      return;
    }

    if (sourceProvider !== 'claude' && sourceProvider !== 'codex') {
      vscode.window.showWarningMessage(
        `Provider handoff is currently supported only for Claude Code/Codex tabs (current: ${handoffProviderLabel(sourceProvider)}).`
      );
      return;
    }

    let targetProvider = args?.targetProvider;
    if (!targetProvider) {
      const targetPick = await vscode.window.showQuickPick(
        [
          { label: 'Codex', provider: 'codex' as const },
          { label: 'Claude Code', provider: 'claude' as const },
        ].filter((item) => item.provider !== sourceProvider),
        {
          placeHolder: `Switch ${handoffProviderLabel(sourceProvider)} session to...`,
          ignoreFocusOut: true,
        },
      );
      if (!targetPick) {
        return;
      }
      targetProvider = targetPick.provider;
    }

    const keepSourceOpen = args?.keepSourceOpen ?? true;

    try {
      await vscode.workspace.getConfiguration('claudeMirror').update('provider', targetProvider, true);
      const result = await tabManager.handoffSession({
        sourceTabId: sourceTab.id,
        targetProvider,
        keepSourceOpen,
      });
      const artifactHint = result.artifactPath ? ` Artifact: ${result.artifactPath}` : '';
      vscode.window.showInformationMessage(
        `${handoffProviderLabel(sourceProvider)} -> ${handoffProviderLabel(targetProvider)} handoff completed.${artifactHint}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Provider handoff failed: ${message}`);
    }
  };
  const runCompactSession = async (args?: { sourceTabId?: string }): Promise<void> => {
    const sourceTab = args?.sourceTabId ? tabManager.getTabById(args.sourceTabId) : tabManager.getActiveTab();
    if (!sourceTab) {
      vscode.window.showWarningMessage('No active ClaUi tab to compact. Start or open a session first.');
      return;
    }
    try {
      const result = await tabManager.compactSession({ sourceTabId: sourceTab.id });
      const via = result.source === 'ai' ? 'AI summary' : 'quick summary';
      vscode.window.showInformationMessage(
        `Compact Session ready (${via}). Opened a new tab with the prompt pre-filled and copied it to the clipboard.`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Compact Session failed: ${message}`);
      // Re-throw so webview-initiated runs receive a failure result via the
      // MessageHandler catch (which clears the button's loading state).
      throw err;
    }
  };
  let showHistoryInFlight = false;
  let showHistorySeq = 0;
  let openPlanDocsInFlight = false;
  let openPlanDocsSeq = 0;

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

    vscode.commands.registerCommand('claudeMirror.newClaudeTabWithAccount', async () => {
      const profile = await pickClaudeProfile('New Claude tab with account profile...');
      if (!profile) {
        return;
      }
      try {
        await startClaudeTabWithProfile(profile);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to start Claude tab with account: ${message}`);
      }
    }),

    vscode.commands.registerCommand('claudeMirror.switchClaudeAccountWithContext', async (args?: {
      sourceTabId?: string;
      targetProfileId?: string;
      keepSourceOpen?: boolean;
    }) => {
      await runAccountHandoff(args);
    }),

    vscode.commands.registerCommand('claudeMirror.claudeAccounts.login', async () => {
      const profile = await pickClaudeProfile('Login to Claude account profile...');
      if (profile) {
        await openClaudeLoginForProfile(profile);
      }
    }),

    vscode.commands.registerCommand('claudeMirror.claudeAccounts.logout', async () => {
      const profile = await pickClaudeProfile('Logout Claude account profile...');
      if (profile) {
        await logoutClaudeProfile(profile);
      }
    }),

    vscode.commands.registerCommand('claudeMirror.claudeAccounts.manage', async () => {
      const action = await vscode.window.showQuickPick(
        [
          { label: '$(add) Create Profile', action: 'create' as const },
          { label: '$(play) New Claude Tab With Account', action: 'newTab' as const },
          { label: '$(sign-in) Login Profile', action: 'login' as const },
          { label: '$(sign-out) Logout Profile', action: 'logout' as const },
          { label: '$(check) Set Profile For New Claude Tabs', action: 'setCurrent' as const },
          { label: '$(edit) Rename Profile', action: 'rename' as const },
          { label: '$(trash) Delete Profile', action: 'delete' as const },
        ],
        { placeHolder: 'Manage Claude account profiles', ignoreFocusOut: true },
      );
      if (!action) {
        return;
      }

      if (action.action === 'create') {
        const created = await createClaudeProfile();
        if (created) {
          const login = await vscode.window.showInformationMessage(
            `Created Claude profile "${created.label}". Login now?`,
            'Login',
            'Later',
          );
          if (login === 'Login') {
            await openClaudeLoginForProfile(created);
          }
        }
        return;
      }

      if (action.action === 'newTab') {
        const profile = await pickClaudeProfile('New Claude tab with account profile...');
        if (profile) {
          await startClaudeTabWithProfile(profile);
        }
        return;
      }

      if (action.action === 'login') {
        const profile = await pickClaudeProfile('Login to Claude account profile...');
        if (profile) {
          await openClaudeLoginForProfile(profile);
        }
        return;
      }

      if (action.action === 'logout') {
        const profile = await pickClaudeProfile('Logout Claude account profile...');
        if (profile) {
          await logoutClaudeProfile(profile);
        }
        return;
      }

      if (action.action === 'setCurrent') {
        const profile = await pickClaudeProfile('Use this profile for new Claude tabs...');
        if (profile) {
          await claudeProfileStore.setCurrentProfileId(profile.id);
          vscode.window.showInformationMessage(`New Claude tabs will use: ${profileLabel(profile)}`);
        }
        return;
      }

      if (action.action === 'rename') {
        const profile = await pickClaudeProfile('Rename Claude account profile...', { includeDefault: false });
        if (!profile) {
          return;
        }
        const label = await vscode.window.showInputBox({
          prompt: `Rename Claude account profile "${profile.label}"`,
          value: profile.label,
          ignoreFocusOut: true,
          validateInput: (value) => value.trim() ? undefined : 'Profile name is required.',
        });
        if (label) {
          const renamed = await claudeProfileStore.rename(profile.id, label);
          vscode.window.showInformationMessage(`Renamed Claude profile to: ${renamed.label}`);
        }
        return;
      }

      if (action.action === 'delete') {
        const profile = await pickClaudeProfile('Delete Claude account profile...', { includeDefault: false });
        if (!profile) {
          return;
        }
        const confirm = await vscode.window.showWarningMessage(
          `Delete Claude profile "${profile.label}"? Credentials on disk are not deleted automatically.`,
          { modal: true },
          'Delete',
        );
        if (confirm === 'Delete') {
          await claudeProfileStore.delete(profile.id);
          vscode.window.showInformationMessage(`Deleted Claude profile: ${profile.label}`);
        }
      }
    }),

    // Switch provider in-place with structured handoff capsule transfer
    vscode.commands.registerCommand(
      'claudeMirror.switchProviderWithContext',
      async (args?: { sourceTabId?: string; targetProvider?: 'claude' | 'codex'; keepSourceOpen?: boolean }) => {
        await runProviderHandoff(args);
      }
    ),

    // Compact the active session into a continuation prompt and open a fresh tab
    vscode.commands.registerCommand(
      'claudeMirror.compactSession',
      async (args?: { sourceTabId?: string }) => {
        await runCompactSession(args);
      }
    ),

    vscode.commands.registerCommand(
      'claudeMirror.carryCodexToClaudeCode',
      async (args?: { sourceTabId?: string; keepSourceOpen?: boolean }) => {
        await runProviderHandoff(
          {
            sourceTabId: args?.sourceTabId,
            targetProvider: 'claude',
            keepSourceOpen: args?.keepSourceOpen,
          },
          { requireSourceProvider: 'codex' },
        );
      }
    ),

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
      if (tab instanceof MultiParticipantSessionTab) {
        tab.dispose();
        return;
      }
      tab.stopSession();
      vscode.window.showInformationMessage('Claude session stopped.');
    }),

    // Cancel / pause the ACTIVE tab's in-flight request (Escape key)
    vscode.commands.registerCommand('claudeMirror.cancelRequest', () => {
      const tab = tabManager.getActiveTab();
      if (!tab || tab instanceof MultiParticipantSessionTab) return;
      if (tab.isRunning) {
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
      if (!tab || tab instanceof MultiParticipantSessionTab) {
        vscode.window.showWarningMessage(
          'No active session. Start one first.'
        );
        return;
      }
      if (!tab.isRunning) {
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
      if (!tab || tab instanceof MultiParticipantSessionTab) {
        vscode.window.showWarningMessage(
          'No active session. Start one first.'
        );
        return;
      }
      if (!tab.isRunning) {
        vscode.window.showWarningMessage(
          'No active session. Start one first.'
        );
        return;
      }
      tab.compact();
      vscode.window.showInformationMessage('Context compaction requested.');
    }),

    // Resume an existing session in a NEW tab.
    // Optional providerHint: caller (e.g. Smart Search "Open session" button)
    // can pass a provider when the session is on disk but not in SessionStore.
    vscode.commands.registerCommand(
      'claudeMirror.resumeSession',
      async (passedSessionId?: string, providerHint?: ProviderId) => {
      const sessionId = passedSessionId || await vscode.window.showInputBox({
        prompt: 'Enter session ID to resume',
        placeHolder: 'session-id',
      });

      if (sessionId) {
        const stored = sessionStore.getSession(sessionId);
        const provider = stored?.provider ?? providerHint ?? getConfiguredProvider();
        const tab = tabManager.createTabForProvider(provider);
        if (provider === 'claude') {
          applyProfileToTab(tab, profileForSession(sessionId));
        }
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

    // Open a new Smart Search tab. The argument carries provider+model picked
    // by the user from the Tools dropdown; falls back to the configured default
    // model when invoked from the command palette without arguments.
    vscode.commands.registerCommand(
      'claudeMirror.smartSearch.open',
      async (args?: { provider?: 'claude' | 'codex'; model?: string }) => {
        const config = vscode.workspace.getConfiguration('claudeMirror');
        const defaultModel = config.get<string>('smartSearch.defaultModel', 'claude-sonnet-4-6');
        const provider: 'claude' | 'codex' = args?.provider ?? 'claude';
        const model = args?.model ?? defaultModel;
        try {
          await tabManager.createSmartSearchTab({ provider, model });
          log(`Smart Search tab opened: provider=${provider} model=${model}`);
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Failed to open Smart Search tab: ${errorMessage}`);
        }
      }
    ),

    // Show conversation history in a QuickPick
    vscode.commands.registerCommand('claudeMirror.showHistory', async () => {
      const runId = ++showHistorySeq;
      const startedAt = Date.now();
      if (showHistoryInFlight) {
        log(`[showHistory#${runId}] ignored: another history picker is already active`);
        return;
      }
      showHistoryInFlight = true;
      log(`[showHistory#${runId}] start`);

      try {
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
          ignoreFocusOut: false,
        });

        if (!source) {
          log(`[showHistory#${runId}] source pick canceled after ${Date.now() - startedAt}ms`);
          return;
        }

        const sourceKey = source.label.includes('All Sessions') ? 'all' : 'extension';
        log(`[showHistory#${runId}] source selected=${sourceKey}`);

        if (source.label.includes('All Sessions')) {
          log(`[showHistory#${runId}] forwarding to claudeMirror.discoverSessions`);
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
              // Exclude sessions without workspacePath - they belong to unknown projects
              if (!s.workspacePath) {
                return false;
              }
              // Normalize separators and case for Windows path comparison
              return normalizePath(s.workspacePath) === normalizePath(currentWorkspace);
            })
          : allSessions;

        log(`[showHistory] Showing ${sessions.length} sessions for workspace: ${currentWorkspace || '(none)'}`);
        log(`[showHistory#${runId}] session list prepared count=${sessions.length} workspace=${currentWorkspace || '(none)'}`);

        if (sessions.length === 0) {
          const msg = currentWorkspace
            ? 'No ClaUi conversation history for this project yet. Use "All Sessions" to discover CLI sessions.'
            : 'No ClaUi conversation history yet. Use "All Sessions" to discover CLI sessions.';
          vscode.window.showInformationMessage(msg);
          log(`[showHistory#${runId}] no sessions to show`);
          return;
        }

        const items = sessions.map(s => ({
          label: s.name || `Session ${s.sessionId.slice(0, 8)}`,
          description: `${s.provider === 'codex' ? 'Codex' : s.provider === 'remote' ? 'Happy' : 'Claude'} | ${s.model || 'unknown'}  ${formatRelativeTime(s.lastActiveAt)}`,
          detail: s.firstPrompt || undefined,
          sessionId: s.sessionId,
          provider: s.provider,
        }));

        const sessionPickStartedAt = Date.now();
        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select a conversation to resume',
          matchOnDescription: true,
          matchOnDetail: true,
          ignoreFocusOut: false,
        });

        if (!picked) {
          log(`[showHistory#${runId}] session pick canceled after ${Date.now() - sessionPickStartedAt}ms`);
          return;
        }

        log(`[showHistory#${runId}] session selected id=${picked.sessionId} provider=${picked.provider} after ${Date.now() - sessionPickStartedAt}ms`);
        log(`Resuming ${picked.provider} session from history: ${picked.sessionId}`);
        const tab = tabManager.createTabForProvider(picked.provider);
        if (picked.provider === 'claude') {
          applyProfileToTab(tab, profileForSession(picked.sessionId));
        }
        try {
          await tab.startSession({ resume: picked.sessionId });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(
            `Failed to resume ${picked.provider === 'codex' ? 'Codex' : picked.provider === 'remote' ? 'Happy' : 'Claude'} session: ${errorMessage}`
          );
        }
      } finally {
        showHistoryInFlight = false;
        log(`[showHistory#${runId}] end durationMs=${Date.now() - startedAt}`);
      }
    }),

    // Open HTML plan documents from multiple locations in the default browser
    vscode.commands.registerCommand('claudeMirror.openPlanDocs', async () => {
      const runId = ++openPlanDocsSeq;
      const startedAt = Date.now();
      if (openPlanDocsInFlight) {
        log(`[openPlanDocs#${runId}] ignored: another plan picker is already active`);
        return;
      }
      openPlanDocsInFlight = true;
      log(`[openPlanDocs#${runId}] start`);

      try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
          vscode.window.showWarningMessage('No workspace folder open.');
          log(`[openPlanDocs#${runId}] canceled: no workspace folder`);
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

        const scanStartedAt = Date.now();
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
        log(`[openPlanDocs#${runId}] scan done in ${Date.now() - scanStartedAt}ms | workspacePlansDirs=${projectPlansDirs.length} uniqueHtml=${planFiles.length}`);

        // No plan documents found - offer to activate the Plans feature
        if (planFiles.length === 0) {
          log(`[openPlanDocs#${runId}] no plan docs found`);
          await promptPlanFeatureActivation(workspaceRoot, log);
          return;
        }

        // Single file: open directly in preview panel
        if (planFiles.length === 1) {
          log(`[openPlanDocs#${runId}] single plan doc auto-open: ${planFiles[0].filePath}`);
          const html = fs.readFileSync(planFiles[0].filePath, 'utf-8');
          openHtmlPreviewPanel(html, planFiles[0].label);
          return;
        }

        // Multiple files: show QuickPick sorted by modification time
        const pickerStartedAt = Date.now();
        const picked = await vscode.window.showQuickPick(planFiles, {
          placeHolder: 'Select a plan document to open in browser',
          matchOnDescription: true,
          ignoreFocusOut: false,
        });

        if (!picked) {
          log(`[openPlanDocs#${runId}] picker canceled after ${Date.now() - pickerStartedAt}ms`);
          return;
        }

        log(`[openPlanDocs#${runId}] selected ${picked.filePath} after ${Date.now() - pickerStartedAt}ms`);
        log(`Opening plan doc: ${picked.filePath}`);
        const html = fs.readFileSync(picked.filePath, 'utf-8');
        openHtmlPreviewPanel(html, picked.label);
      } finally {
        openPlanDocsInFlight = false;
        log(`[openPlanDocs#${runId}] end durationMs=${Date.now() - startedAt}`);
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

    vscode.commands.registerCommand('claudeMirror.toggleMcpPanel', () => {
      const tab = tabManager.getOrCreateTab();
      tab.reveal();
      tab.postMessage({ type: 'toggleMcpPanel', open: true, tab: 'session' });
      log('Opened MCP panel in active ClaUi tab');
    }),

    // Open the worktree dashboard overlay on the active tab (creates one if none)
    vscode.commands.registerCommand('claudeMirror.openWorktreePanel', () => {
      const tab = tabManager.getOrCreateTab();
      tab.reveal();
      tab.postMessage({ type: 'openWorktreePanel' });
      log('Opened worktree panel in active ClaUi tab');
    }),

    // Start a fresh session inside a worktree. With a path arg it launches
    // directly; without one it surfaces the dashboard so the user can pick.
    vscode.commands.registerCommand(
      'claudeMirror.createWorktreeSession',
      async (worktreePath?: string) => {
        if (typeof worktreePath === 'string' && worktreePath.length > 0) {
          await tabManager.createWorktreeTab(worktreePath, 'claude');
          log(`Started worktree session in ${worktreePath}`);
          return;
        }
        const tab = tabManager.getOrCreateTab();
        tab.reveal();
        tab.postMessage({ type: 'openWorktreePanel' });
      }
    ),

    // Move the active Claude session into another worktree: relocate its
    // transcript into that tree's CLI project folder, then kill + resume the
    // CLI with the worktree as its new cwd. Idle Claude sessions only.
    vscode.commands.registerCommand('claudeMirror.moveSessionToWorktree', async () => {
      const prep = await tabManager.prepareSessionMove();
      if (!prep.ok) {
        vscode.window.showWarningMessage(prep.reason);
        return;
      }

      const items = prep.targets.map((target) => ({
        label: `${target.isMain ? '$(home)' : '$(git-branch)'} ${target.branch ?? '(detached)'}${target.isMain ? ' (main)' : ''}`,
        description: target.path,
        targetPath: target.path,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        title: 'Move Session to Worktree',
        placeHolder: 'Pick the worktree this session should continue in',
        matchOnDescription: true,
        ignoreFocusOut: true,
      });
      if (!picked) {
        return;
      }

      const result = await tabManager.moveActiveSessionToWorktree(picked.targetPath);
      if (result.ok) {
        vscode.window.showInformationMessage(`Session moved to ${picked.targetPath}.`);
        log(`Moved active session to worktree ${picked.targetPath}`);
      } else {
        vscode.window.showErrorMessage(result.reason);
      }
    }),

    // Fork conversation from a specific message (opens a new tab)
    vscode.commands.registerCommand(
      'claudeMirror.forkFromMessage',
      async (sessionId: string, forkMessageIndex: number, promptText: string, messages: SerializedChatMessage[]) => {
        const sourceMetadata = sessionStore.getSession(sessionId);
        const sourceProvider = sourceMetadata?.provider ?? 'claude';
        const sourceProfile = profileForSession(sessionId);
        log(
          `Forking ${sourceProvider} session ${sessionId} from message index ${forkMessageIndex}, historyLen=${messages?.length ?? 0}`
        );
        const tab = tabManager.createTabForProvider(sourceProvider);
        if (sourceProvider === 'claude') {
          applyProfileToTab(tab, sourceProfile);
        }
        try {
          tab.setForkInit({ promptText, messages: messages || [] });

          // Fork at index 0: start a fresh session (no history to keep)
          if (forkMessageIndex === 0) {
            log('Fork at index 0: starting fresh session');
            await tab.startSession();
            return;
          }

          // Attempt truncated fork for Claude provider
          if (sourceProvider === 'claude') {
            const truncator = new SessionTruncator((msg) => log(msg));
            const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            const result = truncator.truncateSession(
              sessionId,
              forkMessageIndex,
              workspacePath,
              claudeProfileStore.resolveConfigDir(sourceProfile),
            );

            if (result) {
              log(`Truncated fork: newSession=${result.newSessionId}, msgs=${result.uiMessagesKept}, lines=${result.linesWritten}`);
              await tab.startSession({
                resume: result.newSessionId,
                skipReplay: true,
                truncatedFork: true,
              });
              return;
            }
            log('Truncation failed, falling back to full fork');
          }

          // Fallback: original full-copy fork
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

  // -- Multi-Participant Session --

  /**
   * Ensures MP connection settings (URL + token) exist in workspace .vscode/settings.json.
   * Only runs the setup wizard if serverUrl is not yet configured.
   */
  async function ensureMpConnectionSettings(): Promise<boolean> {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const inspection = config.inspect<string>('multiParticipant.serverUrl');
    const userConfigured = inspection?.globalValue || inspection?.workspaceValue || inspection?.workspaceFolderValue;

    if (userConfigured) return true;

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showWarningMessage('Open a folder/workspace first to enable Multi-Participant.');
      return false;
    }

    const firstTimeChoice = await vscode.window.showQuickPick(
      [
        { label: 'Enter Connection Details', description: 'I have a server URL from my team' },
        { label: 'Open Setup Guide', description: 'Set up a new coordination server' },
      ],
      { placeHolder: 'Multi-Participant requires a coordination server. Press Escape to cancel.' },
    );

    if (!firstTimeChoice) return false;

    if (firstTimeChoice.label === 'Open Setup Guide') {
      const guidePath = path.join(context.extensionPath, 'server', 'deploy', 'SERVER_SETUP_GUIDE.md');
      if (fs.existsSync(guidePath)) {
        const doc = await vscode.workspace.openTextDocument(guidePath);
        await vscode.window.showTextDocument(doc);
      } else {
        vscode.window.showWarningMessage('Setup guide not found. Look for SERVER_SETUP_GUIDE.md in the server/deploy/ folder of the ClaUi repository.');
      }
      return false;
    }

    const inputUrl = await vscode.window.showInputBox({
      prompt: 'Coordination server URL (one-time setup)',
      value: '',
      placeHolder: 'wss://your-server.com/mp',
    });
    if (!inputUrl) return false;

    const inputToken = await vscode.window.showInputBox({
      prompt: 'Auth token (shared secret for your team)',
      placeHolder: 'your-shared-token',
      password: true,
    });
    if (inputToken === undefined) return false;

    await config.update('multiParticipant.serverUrl', inputUrl, vscode.ConfigurationTarget.Workspace);
    if (inputToken) {
      await config.update('multiParticipant.authToken', inputToken, vscode.ConfigurationTarget.Workspace);
    }

    log(`MP connection settings saved to workspace config`);
    vscode.window.showInformationMessage('Multi-Participant connection configured. You can update server URL and token in .vscode/settings.json anytime.');
    return true;
  }

  /** Open a multi-participant panel with the JoinDialog in create mode. */
  async function createMpSession(): Promise<void> {
    const ready = await ensureMpConnectionSettings();
    if (!ready) return;
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const serverUrl = config.get<string>('multiParticipant.serverUrl', '') || 'ws://localhost:9120';
    const authToken = config.get<string>('multiParticipant.authToken', '');
    const mpTab = tabManager.createMultiParticipantTab(serverUrl, 'claude', undefined, authToken || undefined);
    mpTab.initDialog('create');
    log(`Multi-participant tab created: ${mpTab.id} (create mode)`);
  }

  /** Open a multi-participant panel with the JoinDialog in join mode. */
  async function joinMpSession(): Promise<void> {
    const ready = await ensureMpConnectionSettings();
    if (!ready) return;
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const serverUrl = config.get<string>('multiParticipant.serverUrl', '') || 'ws://localhost:9120';
    const authToken = config.get<string>('multiParticipant.authToken', '');
    const mpTab = tabManager.createMultiParticipantTab(serverUrl, 'claude', undefined, authToken || undefined);
    mpTab.initDialog('join');
    log(`Multi-participant tab created: ${mpTab.id} (join mode)`);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeMirror.joinMultiParticipantSession', () => joinMpSession())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeMirror.createMultiParticipantSession', () => createMpSession())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeMirror.leaveMultiParticipantSession', () => {
      const active = tabManager.getActiveTab();
      if (active instanceof MultiParticipantSessionTab) {
        active.dispose();
        log(`Left multi-participant session: ${active.id}`);
      } else {
        const allTabs = tabManager.listTabs();
        const mpTabs = allTabs.filter(t => t.id.startsWith('mp-'));
        if (mpTabs.length === 0) {
          vscode.window.showInformationMessage('No active multi-participant session to leave.');
        } else if (mpTabs.length === 1) {
          tabManager.closeTab(mpTabs[0].id);
          log(`Left multi-participant session: ${mpTabs[0].id}`);
        } else {
          void vscode.window.showQuickPick(
            mpTabs.map(t => ({ label: t.displayName, id: t.id })),
            { placeHolder: 'Select MP session to leave' }
          ).then(pick => {
            if (pick) {
              tabManager.closeTab(pick.id);
              log(`Left multi-participant session: ${pick.id}`);
            }
          });
        }
      }
    })
  );

  // --- Admin usage dashboard: developer-side commands ---
  registerUsageReportingCommands(context, log, developerUsageReporter);
}

/** Human-readable relative time from a ms-epoch timestamp (Hebrew). */
function relativeTimeFromMs(ms: number | null): string {
  if (!ms) return 'אין דיווח עדיין';
  const diffMin = Math.floor((Date.now() - ms) / 60000);
  if (diffMin < 1) return 'ממש עכשיו';
  if (diffMin < 60) return `לפני ${diffMin} דק'`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `לפני ${diffHr} שע'`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'אתמול';
  return `לפני ${diffDay} ימים`;
}

function formatTokenCount(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]);
}

const USAGE_CONSENT_MESSAGE =
  'הצטרפות לדיווח שימוש לדשבורד האדמין של הצוות.\n\n' +
  'מה ישותף: מספרי שימוש בלבד - כמות טוקנים לפי מודל וסוג (קלט/פלט/מטמון).\n' +
  'מה לא ישותף: קוד, תוכן שיחות, פרומפטים, ושמות קבצים - לעולם לא נשלחים.\n\n' +
  'הדיווח נשלח אוטומטית כל שעה. אם אינך מחובר, הוא מדלג בשקט ומשלים בפעם הבאה.\n' +
  'ניתן לכבות את השיתוף בכל רגע. להמשיך?';

/** Register the three developer-facing usage-reporting commands. */
function registerUsageReportingCommands(
  context: vscode.ExtensionContext,
  log: (msg: string) => void,
  reporter?: import('./usage/DeveloperUsageReporter').DeveloperUsageReporter,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeMirror.registerUsageReporting', async () => {
      if (!reporter) {
        vscode.window.showErrorMessage('Usage reporting is not available in this session.');
        return;
      }
      if (!reporter.getBaseUrl()) {
        const pick = await vscode.window.showErrorMessage(
          'No usage server URL is configured. Set claudeMirror.usageReporting.serverUrl (or the multi-participant server URL).',
          'Open Settings',
        );
        if (pick === 'Open Settings') {
          void vscode.commands.executeCommand('workbench.action.openSettings', 'claudeMirror.usageReporting');
        }
        return;
      }

      const agree = await vscode.window.showInformationMessage(
        USAGE_CONSENT_MESSAGE, { modal: true }, 'אני מאשר/ת', 'ביטול',
      );
      if (agree !== 'אני מאשר/ת') {
        return;
      }

      const name = await vscode.window.showInputBox({
        prompt: 'שם התצוגה שלך בדשבורד האדמין',
        value: reporter.getConfiguredDisplayName(),
        ignoreFocusOut: true,
        validateInput: (v) => (v.trim() ? undefined : 'נדרש שם תצוגה'),
      });
      if (!name) {
        return;
      }

      const result = await reporter.register(name.trim());
      if (!result.ok) {
        vscode.window.showErrorMessage(`הרשמה לדיווח שימוש נכשלה: ${result.error}`);
        return;
      }
      await vscode.workspace.getConfiguration('claudeMirror')
        .update('usageReporting.enabled', true, vscode.ConfigurationTarget.Global);
      // Send a first report right away so the admin sees data immediately.
      void reporter.flushReport();
      log('[Usage] Developer registered for usage reporting');
      vscode.window.showInformationMessage(
        `נרשמת לדיווח שימוש בשם "${name.trim()}". הדיווח נשלח אוטומטית כל שעה.`,
      );
    }),

    vscode.commands.registerCommand('claudeMirror.reportUsageNow', async () => {
      if (!reporter) {
        vscode.window.showErrorMessage('Usage reporting is not available in this session.');
        return;
      }
      if (!reporter.isRegistered()) {
        vscode.window.showWarningMessage('עדיין לא נרשמת. הרץ קודם "ClaUi: Register for Usage Reporting".');
        return;
      }
      const res = await reporter.flushReport();
      if (res.ok) {
        const msg = (res.sent && res.sent > 0)
          ? `דיווח שימוש נשלח לשרת (${res.sent} מודלים). רענן את דף האדמין.`
          : 'דופק נשלח (אין שימוש חדש מאז הדיווח האחרון). רענן את דף האדמין.';
        vscode.window.showInformationMessage(msg);
      } else {
        const reasons: Record<string, string> = {
          busy: 'דיווח כבר מתבצע ברקע, נסה שוב בעוד רגע.',
          'not-registered': 'לא רשום - הרץ קודם הרשמה.',
          'reporting-off': 'הדיווח כבוי בהגדרות.',
          'no-server-url': 'לא הוגדרה כתובת שרת (claudeMirror.usageReporting.serverUrl).',
          'no-credential': 'חסר אישור גישה - הרשם מחדש.',
        };
        vscode.window.showWarningMessage(`הדיווח לא נשלח: ${reasons[res.reason ?? ''] ?? res.reason}`);
      }
    }),

    vscode.commands.registerCommand('claudeMirror.viewMyUsage', () => {
      if (!reporter) {
        vscode.window.showErrorMessage('Usage reporting is not available in this session.');
        return;
      }
      const snap = reporter.getMyUsageSnapshot();
      const panel = vscode.window.createWebviewPanel(
        'claudeMirrorMyUsage', 'ClaUi - My Usage', vscode.ViewColumn.Active, { enableScripts: false },
      );
      panel.webview.html = buildMyUsageHtml(snap);
    }),

    vscode.commands.registerCommand('claudeMirror.disableUsageReporting', async () => {
      if (!reporter) {
        vscode.window.showErrorMessage('Usage reporting is not available in this session.');
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        'לכבות את דיווח השימוש לדשבורד האדמין? לא יישלחו עוד דיווחים.',
        { modal: true }, 'כבה דיווח',
      );
      if (confirm !== 'כבה דיווח') {
        return;
      }
      await vscode.workspace.getConfiguration('claudeMirror')
        .update('usageReporting.enabled', false, vscode.ConfigurationTarget.Global);
      await reporter.disable();
      vscode.window.showInformationMessage('דיווח השימוש כובה.');
    }),
  );
}

/** Render the personal "My Usage" card (no ranking, no comparison to others). */
function buildMyUsageHtml(snap: import('./usage/DeveloperUsageReporter').MyUsageSnapshot): string {
  const statusOn = snap.enabled && snap.consentGranted;
  const statusLabel = statusOn ? 'פעיל' : (snap.registered ? 'כבוי' : 'לא רשום');
  const statusColor = statusOn ? '#0b8077' : '#9c2733';
  const statusBg = statusOn ? '#e2f6f4' : '#fdebed';
  const cost = `$${Math.round(snap.estimatedCostUsd).toLocaleString('en-US')}`;
  const name = snap.developerName || 'המשתמש שלי';
  return `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8">
<style>
  body{font-family:"Segoe UI",system-ui,Arial,sans-serif;background:#f5f6fb;color:#1b1d2e;margin:0;padding:28px}
  .card{max-width:420px;margin:0 auto;background:#fff;border:1px solid #e7e9f3;border-radius:14px;padding:22px 24px;box-shadow:0 8px 28px rgba(27,29,46,.06)}
  .ph{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
  .nm{font-weight:700;font-size:16px}
  .pill{font-size:12px;font-weight:600;padding:4px 10px;border-radius:7px;background:${statusBg};color:${statusColor}}
  .big{font-size:34px;font-weight:800;letter-spacing:-.02em;direction:ltr;text-align:right}
  .bigsub{font-size:13px;color:#6a6f88;margin-bottom:16px}
  .row{display:flex;justify-content:space-between;font-size:14px;padding:9px 0;border-top:1px solid #f0f1f7}
  .row b{font-weight:700}
  .note{margin-top:16px;font-size:12px;color:#9aa0bb;text-align:center;line-height:1.6}
</style></head><body>
  <div class="card">
    <div class="ph"><div class="nm">${escapeHtml(name)}</div><span class="pill">${statusLabel}</span></div>
    <div class="big">${cost}</div>
    <div class="bigsub">עלות API מוערכת (מצטבר, לפי מחירון ברירת מחדל)</div>
    <div class="row"><span>טוקנים (משוקלל)</span><b>${formatTokenCount(snap.totalWeightedTokens)}</b></div>
    <div class="row"><span>טוקנים (גולמי)</span><b>${formatTokenCount(snap.totalRawTokens)}</b></div>
    <div class="row"><span>מודל עיקרי</span><b>${escapeHtml(snap.primaryModel)}</b></div>
    <div class="row"><span>דיווח אוטומטי אחרון</span><b>${relativeTimeFromMs(snap.lastSuccessfulReportAt)}</b></div>
    <div class="note">הנתונים האישיים שלך בלבד - ללא דירוג או השוואה למפתחים אחרים.<br>ההשוואה גלויה לאדמין בלבד.</div>
  </div>
</body></html>`;
}
