import * as vscode from 'vscode';
import * as path from 'path';
import type { ExtensionToWebviewMessage } from '../types/webview-messages';
import { VoiceCaptureServer, type CaptureEvent } from './VoiceCaptureServer';
import { cleanInterim, punctuateFinal } from './punctuation';

/** The only thing the service needs from a tab: a way to post to its webview. */
export interface VoiceTarget {
  postMessage(msg: ExtensionToWebviewMessage): void;
}

const STOP_GRACE_MS = 3000;
const USED_ONCE_KEY = 'claudeMirror.voice.usedOnce';

/**
 * One dictation session at a time, bound to the tab that started it.
 *
 * Transcripts are forwarded utterance by utterance (interim / final) to that
 * tab only; the webview inserts them at the caret. Nothing is buffered as a
 * "full transcript" on this side, so a user edit in the composer is never
 * overwritten by a re-send.
 */
export class VoiceDictationService implements vscode.Disposable {
  private static instance: VoiceDictationService | null = null;

  static get(context: vscode.ExtensionContext, log: (msg: string) => void): VoiceDictationService {
    if (!this.instance) this.instance = new VoiceDictationService(context, log);
    return this.instance;
  }

  /** The service created at activation, or null before activation / after dispose. */
  static current(): VoiceDictationService | null {
    return this.instance;
  }

  private server: VoiceCaptureServer | null = null;
  private active: { target: VoiceTarget; tabId: string; session: number; lang: string } | null = null;
  private lastStopped: { target: VoiceTarget; session: number; at: number } | null = null;
  private sessionCounter = 0;

  private constructor(private readonly context: vscode.ExtensionContext, private readonly log: (msg: string) => void) {}

  private cfg() {
    return vscode.workspace.getConfiguration('claudeMirror');
  }

  get enabled(): boolean {
    return this.cfg().get<boolean>('voice.enabled', true);
  }

  private language(): string {
    return this.cfg().get<string>('voice.language', 'he-IL') || 'he-IL';
  }

  private async ensureServer(): Promise<VoiceCaptureServer> {
    if (this.server) return this.server;
    const version = String((this.context.extension?.packageJSON as { version?: string } | undefined)?.version || '0');
    const server = new VoiceCaptureServer({
      extensionPath: this.context.extensionPath,
      version,
      profileDir: path.join(this.context.globalStorageUri.fsPath, 'voice-browser-profile'),
      browserPath: this.cfg().get<string>('voice.browserPath', '') || undefined,
      log: this.log,
      onEvent: (ev) => this.onCaptureEvent(ev),
    });
    await server.start();
    this.server = server;
    return server;
  }

  /**
   * Pre-warm the capture window so the first click starts instantly.
   * Only for users who have dictated before: a small Chrome window must never
   * pop up for someone who never touched the feature.
   */
  async warmUp(): Promise<void> {
    if (!this.enabled) return;
    if (!this.context.globalState.get<boolean>(USED_ONCE_KEY, false)) return;
    try {
      const server = await this.ensureServer();
      server.ensureBrowser();
    } catch (err) {
      this.log(`[Voice] warm-up failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  isActiveFor(tabId: string): boolean {
    return !!this.active && this.active.tabId === tabId;
  }

  async start(target: VoiceTarget, tabId: string): Promise<void> {
    if (!this.enabled) {
      target.postMessage({ type: 'voiceState', listening: false, error: 'Voice dictation is disabled in settings (claudeMirror.voice.enabled)' });
      return;
    }
    if (this.active) {
      if (this.active.tabId === tabId) {
        target.postMessage({ type: 'voiceState', listening: true });
        return;
      }
      // Another tab owns the microphone: hand it over.
      await this.stop(this.active.tabId);
    }
    let server: VoiceCaptureServer;
    try {
      server = await this.ensureServer();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`[Voice] cannot start server: ${msg}`);
      target.postMessage({ type: 'voiceState', listening: false, error: 'Voice server failed to start' });
      return;
    }
    const session = Date.now() * 10 + (++this.sessionCounter % 10);
    const lang = this.language();
    this.active = { target, tabId, session, lang };
    // Remember that this user dictates, so the capture window is pre-warmed on the next activation.
    void this.context.globalState.update(USED_ONCE_KEY, true);
    this.log(`[Voice] start session=${session} tab=${tabId} lang=${lang}`);
    target.postMessage({ type: 'voiceState', listening: true, connecting: !server.connected });
    server.startCapture(session, lang);
  }

  async stop(tabId?: string): Promise<void> {
    if (!this.active) return;
    if (tabId && this.active.tabId !== tabId) return;
    const { target, session } = this.active;
    this.active = null;
    this.lastStopped = { target, session, at: Date.now() };
    this.server?.stopCapture(session);
    target.postMessage({ type: 'voiceState', listening: false });
    this.log(`[Voice] stop session=${session}`);
  }

  async toggle(target: VoiceTarget, tabId: string): Promise<void> {
    if (this.isActiveFor(tabId)) await this.stop(tabId);
    else await this.start(target, tabId);
  }

  /** Called when a tab closes so its session does not outlive it. */
  onTabClosed(tabId: string): void {
    if (this.active?.tabId === tabId) void this.stop(tabId);
  }

  dispose(): void {
    this.active = null;
    this.server?.dispose();
    this.server = null;
    VoiceDictationService.instance = null;
  }

  /* ---------------- events from the capture page ---------------- */

  private onCaptureEvent(ev: CaptureEvent): void {
    switch (ev.type) {
      case 'ready':
        return;
      case 'listening':
        if (this.active && ev.session === this.active.session) {
          this.active.target.postMessage({ type: 'voiceState', listening: true, connecting: false });
        }
        return;
      case 'stopped':
        return;
      case 'level':
        if (this.active && ev.session === this.active.session) {
          this.active.target.postMessage({ type: 'voiceLevel', level: ev.level });
        }
        return;
      case 'error': {
        const target = this.active?.target ?? this.lastStopped?.target;
        this.log(`[Voice] error ${ev.code}: ${ev.text}`);
        if (ev.code === 'need-permission' || ev.code === 'no-browser') {
          // Nothing will be transcribed; end the session so the UI does not stay "connecting".
          const active = this.active;
          this.active = null;
          if (active) this.server?.stopCapture(active.session);
          target?.postMessage({ type: 'voiceState', listening: false, error: ev.text });
        } else {
          target?.postMessage({ type: 'voiceState', listening: !!this.active, error: ev.text });
        }
        return;
      }
      case 'transcript':
        this.onTranscript(ev.session, ev.kind, ev.text);
        return;
    }
  }

  private onTranscript(session: number, kind: 'interim' | 'final', raw: string): void {
    let target: VoiceTarget | null = null;
    let lang = this.language();
    if (this.active && this.active.session === session) {
      target = this.active.target;
      lang = this.active.lang;
    } else if (kind === 'final' && this.lastStopped && this.lastStopped.session === session && Date.now() - this.lastStopped.at < STOP_GRACE_MS) {
      // The words said just before "stop" arrive a moment after the session ended.
      target = this.lastStopped.target;
    }
    if (!target) return;
    const autoPunct = this.cfg().get<boolean>('voice.autoPunctuation', true);
    const text = kind === 'final' ? punctuateFinal(raw, lang, autoPunct) : cleanInterim(raw, lang);
    if (kind === 'final' && !text) return;
    target.postMessage({ type: 'voiceTranscript', kind, text });
  }
}
