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
 *   2. startFork(sessionId, promptText)  -- forks and sends first message
 *   3. sendMessage(text)                 -- follow-up messages
 *   4. dispose()                         -- kill process and clean up
 *
 * Key insight: In pipe mode (-p) with --fork-session, the CLI does NOT exit
 * after forking. It stays alive on the forked session, waiting for stdin input.
 * So we use a SINGLE phase: start with --fork-session, then immediately send
 * the first message. No two-phase approach needed.
 */
export class BackgroundSession extends EventEmitter {
  private processManager: ClaudeProcessManager;
  private demux: StreamDemux;
  private control: ControlProtocol;
  private disposed = false;
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

  /** Wire processManager and demux events. */
  private wireEvents(): void {
    // CLI stdout events -> demux
    this.processManager.on('event', (event: CliOutputEvent) => {
      const subtype = 'subtype' in event ? String((event as unknown as { subtype: string }).subtype) : 'N/A';
      this.log(`[BtwSession] event: type=${event.type} subtype=${subtype}`);
      this.demux.handleEvent(event);
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

    // Process exit = btw session ended
    this.processManager.on('exit', (info: { code: number | null; signal: string | null }) => {
      if (this.disposed) { return; }
      this.log(`[BtwSession] Process exited (code=${info.code}, signal=${info.signal})`);
      this.emit('ended', { code: info.code });
    });

    // Forward demux events
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
   * In pipe mode with --fork-session, the CLI forks the session and then
   * stays alive waiting for stdin input (it does NOT exit after forking).
   * So we immediately send the first message after the process spawns.
   * The CLI will emit system/init and then process the message.
   */
  async startFork(sessionId: string, promptText: string): Promise<void> {
    this.log(`[BtwSession] Starting fork from session ${sessionId}`);
    await this.processManager.start({ resume: sessionId, fork: true });
    this.log(`[BtwSession] Fork process spawned, sending first message immediately...`);
    this.emit('ready');

    // Send the first message right away - the CLI will buffer it until ready
    this.control.sendText(promptText);
    this.log(`[BtwSession] First message sent (${promptText.length} chars)`);
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
