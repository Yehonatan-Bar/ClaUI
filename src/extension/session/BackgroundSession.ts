import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { ClaudeProcessManager } from '../process/ClaudeProcessManager';
import { StreamDemux } from '../process/StreamDemux';
import { ControlProtocol } from '../process/ControlProtocol';
import type { CliOutputEvent } from '../types/stream-json';

/**
 * A headless CLI session with no visible tab or webview panel.
 * Used for the "btw" side-conversation overlay: forks from the parent session,
 * runs its own CLI process, and emits demux events for the parent to relay
 * to its webview.
 *
 * Lifecycle:
 *   1. construct(context)
 *   2. startFork(sessionId, promptText)  -- two-phase fork, sends first message
 *   3. sendMessage(text)                 -- follow-up messages
 *   4. dispose()                         -- kill process and clean up
 */
export class BackgroundSession extends EventEmitter {
  private processManager: ClaudeProcessManager;
  private demux: StreamDemux;
  private control: ControlProtocol;
  private pendingFirstMessage: string | null = null;
  private disposed = false;
  private forkInProgress = false;
  private log: (msg: string) => void;

  constructor(
    private readonly context: vscode.ExtensionContext,
    logger?: (msg: string) => void,
  ) {
    super();
    this.log = logger ?? (() => {});
    this.processManager = new ClaudeProcessManager(context);
    this.processManager.setLogger((msg) => this.log(`[BtwPM] ${msg}`));
    this.demux = new StreamDemux();
    this.control = new ControlProtocol(this.processManager);
    this.wireEvents();
  }

  /** Wire processManager events — handles both fork phase 1 exit and phase 2 session. */
  private wireEvents(): void {
    // Log ALL CLI stdout events for diagnostics
    this.processManager.on('event', (event: CliOutputEvent) => {
      const subtype = 'subtype' in event ? String((event as unknown as { subtype: string }).subtype) : 'N/A';
      this.log(`[BtwSession] event: type=${event.type} subtype=${subtype}`);
      // During fork phase 1, don't feed events to demux (they're hook events, not conversation)
      if (!this.forkInProgress) {
        this.demux.handleEvent(event);
      }
    });

    // Log raw non-JSON lines
    this.processManager.on('raw', (text: string) => {
      this.log(`[BtwSession] raw: ${text.substring(0, 300)}`);
    });

    this.processManager.on('stderr', (text: string) => {
      this.log(`[BtwSession] stderr: ${text.substring(0, 500)}`);
    });

    this.processManager.on('error', (err: Error) => {
      this.log(`[BtwSession] error: ${err.message}`);
      this.emit('error', err);
    });

    // Exit handler — serves double duty for fork phase 1 and phase 2
    this.processManager.on('exit', (info: { code: number | null; signal: string | null }) => {
      if (this.disposed) { return; }

      // Fork phase 1 complete: --fork-session created the new session and exited.
      // Phase 2: resume the forked session as a normal interactive session.
      if (this.forkInProgress) {
        this.forkInProgress = false;
        const forkedSessionId = this.processManager.currentSessionId;
        this.log(`[BtwSession] Fork phase 1 exited (code=${info.code}). Captured session_id=${forkedSessionId}`);

        if (forkedSessionId) {
          this.log(`[BtwSession] Starting phase 2 with forked session: ${forkedSessionId}`);
          this.startPhase2(forkedSessionId);
        } else {
          this.log('[BtwSession] Fork failed: no session ID captured from init event');
          this.emit('ended', { error: 'Fork failed: no session ID captured.' });
        }
        return;
      }

      // Phase 2 exit = btw session ended
      this.log(`[BtwSession] Phase 2 process exited (code=${info.code}, signal=${info.signal})`);
      this.emit('ended', { code: info.code });
    });

    // Forward demux events with the same names used by SessionTab/MessageHandler
    const forwardEvents = [
      'init', 'userMessage', 'assistantMessage',
      'textDelta', 'toolUseStart', 'toolUseDelta', 'blockStop',
      'messageStart', 'messageDelta', 'messageStop',
      'result', 'thinkingDetected',
    ] as const;

    for (const eventName of forwardEvents) {
      this.demux.on(eventName, (...args: unknown[]) => {
        this.log(`[BtwSession] demux -> ${eventName}`);
        this.emit(eventName, ...args);
      });
    }
  }

  /**
   * Fork from a parent session and send the first btw message.
   *
   * Uses processManager.start() with fork: true — same approach as SessionTab.
   * The processManager spawns `claude -p --resume <id> --fork-session ...`.
   * The CLI creates a forked session, emits system/init with the new ID, and exits.
   * The exit handler then starts phase 2 (interactive session on the forked ID).
   */
  async startFork(sessionId: string, promptText: string): Promise<void> {
    this.pendingFirstMessage = promptText;
    this.forkInProgress = true;
    this.log(`[BtwSession] Starting fork from session ${sessionId}`);
    await this.processManager.start({ resume: sessionId, fork: true });
    this.log(`[BtwSession] processManager.start() resolved (fork phase 1 spawned)`);
  }

  /** Phase 2: Start interactive session on the forked session. */
  private startPhase2(forkedSessionId: string): void {
    this.processManager
      .start({
        resume: forkedSessionId,
        skipReplay: true,
      })
      .then(() => {
        this.log(`[BtwSession] Phase 2 process spawned. isRunning=${this.processManager.isRunning}`);
        this.emit('ready');
        if (this.pendingFirstMessage) {
          const msg = this.pendingFirstMessage;
          this.pendingFirstMessage = null;
          this.log(`[BtwSession] Sending first message (${msg.length} chars)...`);
          this.control.sendText(msg);
          this.log('[BtwSession] First message sent via control.sendText()');
        }
      })
      .catch((err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.log(`[BtwSession] Phase 2 start failed: ${errMsg}`);
        this.emit('ended', { error: errMsg });
      });
  }

  /** Send a follow-up user message in the btw conversation. */
  sendMessage(text: string): void {
    if (this.disposed) { return; }
    this.log(`[BtwSession] sendMessage (${text.length} chars), isRunning=${this.processManager.isRunning}`);
    this.control.sendText(text);
  }

  /** Kill the background process and clean up. */
  dispose(): void {
    if (this.disposed) { return; }
    this.disposed = true;
    this.log('[BtwSession] Disposing.');
    this.processManager.stop();
    this.removeAllListeners();
  }

  get isRunning(): boolean {
    return this.processManager.isRunning;
  }
}
