import * as vscode from 'vscode';
import { generateNonce } from '../webview/WebviewProvider';

type SidebarMessageType = 'startSession' | 'showHistory' | 'discoverSessions' | 'openLogs';

export class ClaUiSidebarViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'claui.sidebarLauncher';

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: (message: string) => void
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webviewView.webview.html = this.buildHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      (message: unknown) => {
        void this.handleMessage(message);
      },
      undefined,
      this.context.subscriptions
    );
  }

  private async handleMessage(message: unknown): Promise<void> {
    const type = this.getMessageType(message);
    if (!type) {
      return;
    }

    const commandByType: Record<SidebarMessageType, string> = {
      startSession: 'claudeMirror.startSession',
      showHistory: 'claudeMirror.showHistory',
      discoverSessions: 'claudeMirror.discoverSessions',
      openLogs: 'claudeMirror.openLogDirectory',
    };

    const command = commandByType[type];
    this.log(`[ClaUi Sidebar] Executing ${command}`);

    try {
      await vscode.commands.executeCommand(command);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.log(`[ClaUi Sidebar] Command failed (${command}): ${detail}`);
      void vscode.window.showErrorMessage(`ClaUi sidebar command failed: ${detail}`);
    }
  }

  private getMessageType(message: unknown): SidebarMessageType | null {
    if (!message || typeof message !== 'object') {
      return null;
    }

    const maybeType = (message as { type?: unknown }).type;
    if (
      maybeType === 'startSession' ||
      maybeType === 'showHistory' ||
      maybeType === 'discoverSessions' ||
      maybeType === 'openLogs'
    ) {
      return maybeType;
    }

    return null;
  }

  private buildHtml(webview: vscode.Webview): string {
    const nonce = generateNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${webview.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}';"
  />
  <style>
    :root {
      color-scheme: light dark;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: var(--vscode-sideBar-background);
      color: var(--vscode-sideBar-foreground);
      font-family: var(--vscode-font-family);
    }
    body {
      padding: 12px;
    }
    .card {
      border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.25));
      border-radius: 8px;
      background: var(--vscode-editorWidget-background, transparent);
      padding: 12px;
      display: grid;
      gap: 10px;
    }
    h2 {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    p {
      margin: 0;
      font-size: 12px;
      line-height: 1.4;
      color: var(--vscode-descriptionForeground, var(--vscode-sideBar-foreground));
    }
    .actions {
      display: grid;
      gap: 8px;
    }
    button {
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 7px 10px;
      font-size: 12px;
      text-align: left;
      cursor: pointer;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground, rgba(128, 128, 128, 0.18));
      color: var(--vscode-button-secondaryForeground, inherit);
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground, rgba(128, 128, 128, 0.28));
    }
    .hint {
      margin-top: 4px;
      font-size: 11px;
      opacity: 0.85;
    }
    code {
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
    }
  </style>
</head>
<body>
  <div class="card">
    <h2>ClaUi Launcher</h2>
    <p>Open chat sessions and quick tools from the Activity Bar.</p>
    <div class="actions">
      <button type="button" data-action="startSession">Start New Session</button>
      <button type="button" class="secondary" data-action="showHistory">Conversation History</button>
      <button type="button" class="secondary" data-action="discoverSessions">Discover Sessions</button>
      <button type="button" class="secondary" data-action="openLogs">Open Logs Folder</button>
    </div>
    <p class="hint">Shortcut: <code>Ctrl+Shift+C</code></p>
  </div>
  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      for (const button of document.querySelectorAll('button[data-action]')) {
        button.addEventListener('click', function () {
          const action = this.getAttribute('data-action');
          if (action) {
            vscode.postMessage({ type: action });
          }
        });
      }
    })();
  </script>
</body>
</html>`;
  }
}
