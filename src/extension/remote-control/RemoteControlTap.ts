/**
 * Process-wide observation point for chat-tab traffic, used by ClaUi Remote
 * Control. Every tab class reports:
 *  - outbound: each extension -> webview message (what the chat UI renders),
 *  - inbound:  each webview -> extension action (user clicks/typing, or a
 *              remote dispatch re-entering the same handler).
 *
 * A no-op until RemoteControlService installs a listener, so tabs pay only a
 * null check when remote control is off. No vscode import.
 */

export type TapDirection = 'in' | 'out';
export type TapListener = (tabId: string, direction: TapDirection, message: unknown) => void;

class RemoteControlTap {
  private listener: TapListener | null = null;

  setListener(listener: TapListener | null): void {
    this.listener = listener;
  }

  get active(): boolean {
    return this.listener !== null;
  }

  outbound(tabId: string, message: unknown): void {
    this.emit(tabId, 'out', message);
  }

  inbound(tabId: string, message: unknown): void {
    this.emit(tabId, 'in', message);
  }

  private emit(tabId: string, direction: TapDirection, message: unknown): void {
    const listener = this.listener;
    if (!listener) {
      return;
    }
    try {
      listener(tabId, direction, message);
    } catch {
      // Observation must never break the chat UI.
    }
  }
}

export const remoteControlTap = new RemoteControlTap();
