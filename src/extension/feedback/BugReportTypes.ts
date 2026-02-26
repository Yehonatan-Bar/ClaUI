/**
 * Shared types for the bug report module.
 * Keeps the WebviewBridge dependency clean (avoids circular imports).
 */

import type { ExtensionToWebviewMessage } from '../types/webview-messages';

export interface WebviewBridge {
  postMessage(message: ExtensionToWebviewMessage): void;
}
