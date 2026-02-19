import * as vscode from 'vscode';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../types/webview-messages';

/** Generate a random nonce for CSP script tags */
export function generateNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/** Build the HTML page that loads the bundled React app in a webview panel */
export function buildWebviewHtml(
  webview: vscode.Webview,
  context: vscode.ExtensionContext
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview.js')
  );
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
             script-src 'nonce-${nonce}';
             img-src ${webview.cspSource} data:;
             font-src ${webview.cspSource};"
  />
  <title>ClaUi</title>
  <style>
    html, body, #root {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    #rename-btn {
      position: fixed;
      top: 4px;
      right: 6px;
      z-index: 9999;
      background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.2));
      border: none;
      color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
      cursor: pointer;
      padding: 2px 6px;
      font-size: 12px;
      line-height: 1;
      border-radius: 3px;
      opacity: 0;
      transition: opacity 0.15s;
    }
    body:hover #rename-btn {
      opacity: 0.6;
    }
    #rename-btn:hover {
      opacity: 1 !important;
      background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.4));
    }
  </style>
</head>
<body>
  <button id="rename-btn" title="Rename tab">&#9998;</button>
  <div id="root"></div>

  <script nonce="${nonce}">
  (function() {
    // Acquire the VS Code API ONCE and cache it so the React app can reuse it.
    // acquireVsCodeApi() can only be called once per webview; subsequent calls throw.
    var vscode = acquireVsCodeApi();
    window.acquireVsCodeApi = function() { return vscode; };

    document.getElementById('rename-btn').addEventListener('click', function() {
      vscode.postMessage({ type: 'renameTab' });
    });
  })();
  </script>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

/**
 * Creates and manages the webview panel that hosts the React chat UI.
 * Handles lifecycle, messaging, and resource loading.
 *
 * NOTE: This class is retained for backward compatibility.
 * New multi-tab sessions use SessionTab + buildWebviewHtml() directly.
 */
export class WebviewProvider {
  private panel: vscode.WebviewPanel | null = null;
  private messageCallback: ((msg: WebviewToExtensionMessage) => void) | null = null;
  private isWebviewReady = false;
  private pendingMessages: ExtensionToWebviewMessage[] = [];
  private log: (msg: string) => void = () => {};

  constructor(private readonly context: vscode.ExtensionContext) {}

  setLogger(logger: (msg: string) => void): void {
    this.log = logger;
  }

  /** Register the callback that receives messages from the webview */
  onMessage(callback: (msg: WebviewToExtensionMessage) => void): void {
    this.messageCallback = callback;
  }

  /** Create and show the webview panel, or reveal it if already open */
  show(): void {
    if (this.panel) {
      this.log('Webview: panel already exists, revealing');
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    this.log('Webview: creating new panel');
    this.log(`Webview: extensionUri = ${this.context.extensionUri.toString()}`);

    this.panel = vscode.window.createWebviewPanel(
      'claudeMirror.chat',
      'ClaUi',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
        ],
      }
    );

    this.isWebviewReady = false;
    const html = buildWebviewHtml(this.panel.webview, this.context);
    this.log(`Webview: HTML length = ${html.length}`);
    this.panel.webview.html = html;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.panel.webview.onDidReceiveMessage(
      (message: any) => {
        // Handle diagnostic messages from inline scripts
        if (message.type === 'diag') {
          this.log(`Webview DIAG: phase="${message.phase}" ${message.detail || ''}`);
          return;
        }
        this.log(`Webview: received message type="${message.type}"`);
        if (message.type === 'ready') {
          this.isWebviewReady = true;
          this.flushPendingMessages();
        }
        this.messageCallback?.(message as WebviewToExtensionMessage);
      },
      undefined,
      this.context.subscriptions
    );

    this.panel.onDidDispose(() => {
      this.log('Webview: panel disposed');
      this.panel = null;
      this.isWebviewReady = false;
      this.pendingMessages = [];
    });
  }

  /** Send a message from the extension to the webview */
  postMessage(message: ExtensionToWebviewMessage): void {
    if (!this.panel) {
      return;
    }

    if (!this.isWebviewReady) {
      this.pendingMessages.push(message);
      return;
    }

    void this.panel.webview.postMessage(message);
  }

  /** Check if the webview panel is currently visible */
  get isVisible(): boolean {
    return this.panel?.visible ?? false;
  }

  /** Update the panel title */
  setTitle(title: string): void {
    if (this.panel) {
      this.panel.title = title;
    }
  }

  /** Dispose the webview panel */
  dispose(): void {
    this.panel?.dispose();
    this.panel = null;
    this.isWebviewReady = false;
    this.pendingMessages = [];
  }

  private flushPendingMessages(): void {
    if (!this.panel || !this.isWebviewReady || this.pendingMessages.length === 0) {
      return;
    }

    const queued = this.pendingMessages;
    this.pendingMessages = [];
    for (const message of queued) {
      void this.panel.webview.postMessage(message);
    }
  }
}
