/**
 * VS Code adapter for the "What's New" feature.
 *
 * Owns the `WhatsNewCore` and implements its ports with real VS Code APIs:
 * globalState persistence, the information-message toast, a receipt file that
 * makes the toast at-most-once across windows, tab reveal through TabManager,
 * and opening the bundled changelog in the markdown preview.
 *
 * Wiring lives in `wireWhatsNew()` so extension.ts stays small and the whole
 * feature can be isolated behind one try/catch.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import announcementsJson from './announcements.json';
import { WhatsNewCore, type WhatsNewPorts } from './whatsNewCore';
import { claimToastReceipt } from './toastReceipt';
import type { WhatsNewPersistedState } from './whatsNewLogic';
import type { WhatsNewStateMessage } from '../types/webview-messages';

/** Single globalState key holding `{ knownIds, dismissedIds }` (atomic commit of both sets). */
export const WHATS_NEW_STATE_KEY = 'claui.whatsNew.state';
/** Setting name under the `claudeMirror` section. */
export const WHATS_NEW_SETTING = 'showWhatsNew';

/** The VSIX ships the file as lowercase `changelog.md`; keep the uppercase spelling as a fallback. */
const CHANGELOG_CANDIDATES = ['changelog.md', 'CHANGELOG.md'];

/** The subset of TabManager the feature needs (structural, avoids a hard import cycle). */
export interface WhatsNewTabHost {
  whatsNewService: WhatsNewService | null;
  revealChatTabForNotice(): void;
}

export class WhatsNewService implements vscode.Disposable {
  private readonly core: WhatsNewCore;
  private revealChatTab: () => void = () => {
    this.log('[WhatsNew] No chat tab revealer wired yet');
  };
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: (msg: string) => void,
    isExistingInstall: boolean,
  ) {
    const currentVersion = String(
      (context.extension.packageJSON as { version?: unknown } | undefined)?.version ?? '',
    );
    const readSetting = (): boolean =>
      vscode.workspace.getConfiguration('claudeMirror').get<boolean>(WHATS_NEW_SETTING, true);

    const ports: WhatsNewPorts = {
      currentVersion,
      isExistingInstall,
      loadAnnouncements: () => announcementsJson,
      getNotificationsEnabled: readSetting,
      readPersisted: () => context.globalState.get<unknown>(WHATS_NEW_STATE_KEY),
      writePersisted: (state: WhatsNewPersistedState) =>
        Promise.resolve(context.globalState.update(WHATS_NEW_STATE_KEY, state)),
      claimToastReceipt: (version) =>
        claimToastReceipt(context.globalStorageUri.fsPath, version, (message) => this.log(message)),
      showToast: (message, actions) =>
        Promise.resolve(vscode.window.showInformationMessage(message, ...actions)),
      revealChatTab: () => this.revealChatTab(),
      openChangelog: () => this.openChangelog(),
      showInfo: (message) => {
        void vscode.window.showInformationMessage(message);
      },
      log: (message) => this.log(message),
    };
    this.core = new WhatsNewCore(ports);

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`claudeMirror.${WHATS_NEW_SETTING}`)) {
          this.core.onNotificationsSettingChanged(readSetting());
        }
      }),
    );
  }

  setChatTabRevealer(reveal: () => void): void {
    this.revealChatTab = reveal;
  }

  // --- Delegates used by TabManager, commands and message handlers ---

  registerTab(tabId: string, sender: (msg: WhatsNewStateMessage) => void): void {
    this.core.registerTab(tabId, sender);
  }

  unregisterTab(tabId: string): void {
    this.core.unregisterTab(tabId);
  }

  resendTo(tabId: string): Promise<void> {
    return this.core.resendTo(tabId);
  }

  checkOnActivation(): Promise<void> {
    return this.core.checkOnActivation();
  }

  dismiss(): Promise<void> {
    return this.core.dismiss();
  }

  showLatest(): Promise<void> {
    return this.core.showLatest();
  }

  /** Open the bundled changelog in the markdown preview (plain editor as fallback). */
  async openChangelog(): Promise<void> {
    const root = this.context.extensionPath;
    const found = CHANGELOG_CANDIDATES.map((name) => path.join(root, name)).find((candidate) =>
      fs.existsSync(candidate),
    );
    if (!found) {
      this.log(`[WhatsNew] Changelog not found under ${root}`);
      void vscode.window.showErrorMessage('ClaUi changelog file was not found in the installed extension.');
      return;
    }
    const uri = vscode.Uri.file(found);
    try {
      await vscode.commands.executeCommand('markdown.showPreview', uri);
    } catch (err) {
      this.log(`[WhatsNew] markdown.showPreview failed (${describeError(err)}); opening as text`);
      await vscode.window.showTextDocument(uri, { preview: true });
    }
  }

  dispose(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }
}

/**
 * Connect the service to TabManager, register its commands and run the
 * post-update check. Called once from extension.ts after TabManager exists.
 */
export function wireWhatsNew(
  context: vscode.ExtensionContext,
  service: WhatsNewService,
  host: WhatsNewTabHost,
): void {
  host.whatsNewService = service;
  service.setChatTabRevealer(() => host.revealChatTabForNotice());

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeMirror.showWhatsNew', () => service.showLatest()),
    vscode.commands.registerCommand('claudeMirror.openChangelog', () => service.openChangelog()),
    // Internal routing targets used by the webview message handlers.
    vscode.commands.registerCommand('claudeMirror.whatsNew.dismiss', () => service.dismiss()),
    vscode.commands.registerCommand('claudeMirror.whatsNew.resync', (tabId?: unknown) => {
      if (typeof tabId === 'string' && tabId.length > 0) {
        return service.resendTo(tabId);
      }
      return undefined;
    }),
  );

  void service.checkOnActivation();
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
