import * as vscode from 'vscode';
import { MultiParticipantClient } from './MultiParticipantClient';
import { HeadlessAgentRunner } from './HeadlessAgentRunner';
import { AgentBridge } from './AgentBridge';
import { buildWebviewHtml } from '../webview/WebviewProvider';
import type {
  MPSession, MPParticipant, MPMessage, MPApprovalEvent,
  MPFileConflictWarning, MPTypingState, MPApprovalDecisionPayload,
  ServerToClientMessage,
} from './MultiParticipantProtocol';
import type { ExtensionToWebviewMessage } from '../types/webview-messages';

export interface MultiParticipantSessionTabCallbacks {
  onClosed: (tabId: string) => void;
  onFocused: (tabId: string) => void;
}

export class MultiParticipantSessionTab {
  readonly tabId: string;
  readonly tabNumber: number;
  private readonly agentProvider: 'claude' | 'codex';

  private panel: vscode.WebviewPanel;
  private client: MultiParticipantClient;
  private runner: HeadlessAgentRunner;
  private bridge: AgentBridge;
  private context: vscode.ExtensionContext;
  private callbacks: MultiParticipantSessionTabCallbacks;
  private log: (msg: string) => void;

  private session: MPSession | null = null;
  private participants: MPParticipant[] = [];
  private transcript: MPMessage[] = [];
  private humanParticipantId: string | null = null;
  private agentParticipantId: string | null = null;
  private sessionNumber: number = 0;
  private sessionName: string = '';
  private pendingApprovals: Map<string, MPApprovalEvent> = new Map();
  private activeConflicts: Map<string, MPFileConflictWarning> = new Map();
  private webviewReady = false;
  private pendingMessages: ExtensionToWebviewMessage[] = [];
  private disposed = false;
  private dialogMode: 'create' | 'join' = 'join';
  /** Last successful connect parameters, reused to recover if rejoin is rejected. */
  private lastConnectParams: { humanName: string; agentName: string; agentProvider: 'claude' | 'codex'; password?: string; mode: 'create' | 'join' } | null = null;
  /** True once we have entered the room at least once; prevents a recovery reconnect from re-creating an existing room. */
  private hasJoinedOnce = false;

  constructor(
    tabId: string,
    tabNumber: number,
    serverUrl: string,
    agentProvider: 'claude' | 'codex',
    context: vscode.ExtensionContext,
    callbacks: MultiParticipantSessionTabCallbacks,
    log?: (msg: string) => void,
    viewColumn?: vscode.ViewColumn,
    authToken?: string,
  ) {
    this.tabId = tabId;
    this.tabNumber = tabNumber;
    this.agentProvider = agentProvider;
    this.context = context;
    this.callbacks = callbacks;
    this.log = log || (() => {});

    this.client = new MultiParticipantClient(serverUrl, this.log, authToken);
    this.runner = new HeadlessAgentRunner(agentProvider, context, this.log);
    this.bridge = new AgentBridge(this.client, this.runner, this.log);

    this.panel = vscode.window.createWebviewPanel(
      'claui.multiParticipant',
      `MP Session #${tabNumber}`,
      viewColumn || vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
      },
    );

    this.panel.onDidDispose(() => {
      this.dispose();
      this.callbacks.onClosed(this.tabId);
    });

    this.panel.onDidChangeViewState(() => {
      if (this.panel.visible) {
        this.callbacks.onFocused(this.tabId);
        // If the socket died while the tab sat in the background (machine sleep,
        // network drop, server restart), retry now instead of waiting for the
        // backoff timer -- the user is looking at the tab and expects it live.
        if (this.session && !this.client.isConnected) {
          this.log('[MPTab] Tab refocused while disconnected -- forcing reconnect');
          this.client.reconnectNow();
        }
      }
    });

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('claudeMirror.tabs.layout') && this.webviewReady) {
          this.sendTabLayoutSetting();
        }
      })
    );

    this.panel.webview.html = buildWebviewHtml(this.panel.webview, context);
    this.wireWebviewMessages();
    this.wireServerMessages();
  }

  connect(humanName: string, agentName: string, agentProvider: 'claude' | 'codex', password?: string, sessionNumber?: number, sessionName?: string, mode: 'create' | 'join' = 'join'): void {
    this.sessionNumber = sessionNumber ?? 0;
    this.sessionName = sessionName ?? '';
    this.client.setSessionNumber(this.sessionNumber);
    this.lastConnectParams = { humanName, agentName, agentProvider, password, mode };

    if (this.sessionName) {
      this.panel.title = this.sessionName;
    }

    this.log(`[MPTab] Connecting as ${humanName} with agent ${agentName} (${agentProvider}) to room ${this.sessionNumber} (${mode})`);
    this.postToWebview({ type: 'mpConnectionStatus', status: 'connecting' });

    const rawModel = vscode.workspace.getConfiguration('claudeMirror').get<string>('model', '');
    const agentModel = rawModel && !rawModel.includes('(') ? rawModel : '';

    this.client.removeAllListeners('connected');
    this.client.removeAllListeners('disconnected');
    this.client.removeAllListeners('reconnecting');
    this.client.removeAllListeners('error');
    this.client.removeAllListeners('authFailed');

    this.client.on('connected', () => {
      this.postToWebview({ type: 'mpConnectionStatus', status: 'connected' });
      if (this.humanParticipantId && this.agentParticipantId) {
        this.log('[MPTab] Reconnected, attempting rejoin');
        this.client.sendRejoin();
        this.client.send({ type: 'agentStatus', status: 'online' });
      } else if (mode === 'create' && !this.hasJoinedOnce) {
        this.log('[MPTab] Connected to server, creating session');
        const createMsg: { type: 'createSession'; sessionNumber: number; sessionName: string; humanName: string; agentName: string; agentProvider: 'claude' | 'codex'; agentModel?: string; password?: string } = {
          type: 'createSession', sessionNumber: this.sessionNumber, sessionName: this.sessionName || `Session ${this.sessionNumber}`, humanName, agentName, agentProvider,
        };
        if (agentModel) createMsg.agentModel = agentModel;
        if (password) createMsg.password = password;
        this.client.send(createMsg);
        this.client.send({ type: 'agentStatus', status: 'online' });
      } else {
        this.log('[MPTab] Connected to server, joining session');
        const joinMsg: { type: 'joinSession'; sessionNumber: number; humanName: string; agentName: string; agentProvider: 'claude' | 'codex'; agentModel?: string; password?: string } = {
          type: 'joinSession', sessionNumber: this.sessionNumber, humanName, agentName, agentProvider,
        };
        if (agentModel) joinMsg.agentModel = agentModel;
        if (password) joinMsg.password = password;
        this.client.send(joinMsg);
        this.client.send({ type: 'agentStatus', status: 'online' });
      }
    });

    this.client.on('disconnected', () => {
      this.postToWebview({ type: 'mpConnectionStatus', status: 'disconnected', message: 'Connection lost' });
    });

    this.client.on('reconnecting', (attempt: number, delayMs: number) => {
      this.postToWebview({ type: 'mpConnectionStatus', status: 'connecting', message: `Reconnecting (attempt ${attempt})...` });
    });

    this.client.on('error', (err: Error) => {
      this.postToWebview({ type: 'mpConnectionStatus', status: 'error', message: err.message });
    });

    this.client.on('authFailed', (message: string) => {
      // The client has already stopped its reconnect loop. Surface a clear,
      // actionable error in both the dialog (via the error status) and a VS Code
      // toast, instead of leaving the tab looking stuck on "connecting".
      this.postToWebview({ type: 'mpConnectionStatus', status: 'error', message });
      void vscode.window.showErrorMessage(`Multi-Participant: ${message}`);
    });

    // Connect WebSocket immediately - independent of agent process
    this.client.connect();

    // Start agent in background - doesn't block the WebSocket connection
    this.runner.startAgent().then(() => {
      this.log('[MPTab] Agent process started');
    }).catch((err) => {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.log(`[MPTab] Agent failed to start: ${errMsg} -- continuing for chat only`);
    });
  }

  /** Alias for tabId -- matches the interface TabManager expects from managed tabs. */
  get id(): string {
    return this.tabId;
  }

  /** The panel's current view column, used by TabManager for layout decisions. */
  get viewColumn(): vscode.ViewColumn | undefined {
    return this.panel.viewColumn;
  }

  reveal(viewColumn?: vscode.ViewColumn, preserveFocus?: boolean): void {
    this.panel.reveal(viewColumn, preserveFocus);
  }

  getProvider(): 'claude' | 'codex' {
    return this.agentProvider;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  get displayName(): string {
    return this.session?.name || this.sessionName || `MP Session #${this.tabNumber}`;
  }

  get sessionId(): string | null {
    return this.session?.sessionId || null;
  }

  /** Post a message to the webview. Public so TabManager can broadcast tab-list updates. */
  postMessage(msg: ExtensionToWebviewMessage): void {
    this.postToWebview(msg);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.client.send({ type: 'leaveSession' });
    this.client.disconnect();
    this.bridge.dispose();
    try { this.panel.dispose(); } catch { /* already disposed */ }
    this.log('[MPTab] Disposed');
  }

  initDialog(mode: 'create' | 'join'): void {
    this.dialogMode = mode;
    if (this.webviewReady) {
      this.sendDialogDefaults();
    }
  }

  private sendDialogDefaults(): void {
    const config = vscode.workspace.getConfiguration('claudeMirror');
    const defaultHumanName = config.get<string>('multiParticipant.defaultHumanName', '');
    const defaultAgentName = config.get<string>('multiParticipant.defaultAgentName', '');
    const serverUrl = config.get<string>('multiParticipant.serverUrl', '');
    this.postToWebview({
      type: 'mpInitDialog',
      mode: this.dialogMode,
      defaultHumanName: defaultHumanName || '',
      defaultAgentName: defaultAgentName || '',
      serverUrl: serverUrl || '',
    });
  }

  // -- Webview Messages (React -> Extension) --

  private wireWebviewMessages(): void {
    this.panel.webview.onDidReceiveMessage((msg) => {
      switch (msg.type) {
        case 'ready':
          this.webviewReady = true;
          this.postToWebview({
            type: 'sessionStarted',
            sessionId: this.tabId,
            model: 'multi-participant',
            tabKind: 'multiparticipant',
          });
          this.flushPendingMessages();
          this.sendDialogDefaults();
          this.sendTabLayoutSetting();
          if (this.session) {
            this.sendFullState();
          }
          break;

        case 'requestTabList':
          void vscode.commands.executeCommand('claudeMirror.tabs.refreshList');
          break;

        case 'focusTab':
          void vscode.commands.executeCommand('claudeMirror.tabs.focus', msg.tabId);
          break;

        case 'closeTab':
          void vscode.commands.executeCommand('claudeMirror.tabs.close', msg.tabId);
          break;

        case 'reorderTabs':
          void vscode.commands.executeCommand('claudeMirror.tabs.reorder', msg.tabIds);
          break;

        case 'setTabLayout': {
          const layout = msg.layout as 'horizontal' | 'vertical';
          void vscode.workspace
            .getConfiguration('claudeMirror.tabs')
            .update('layout', layout, vscode.ConfigurationTarget.Global);
          break;
        }

        case 'mpSendMessage':
          this.client.send({ type: 'humanMessage', rawBody: msg.rawBody });
          break;

        case 'mpTypingIndicator':
          this.client.send({ type: 'typingIndicator', state: msg.state });
          break;

        case 'mpApprovalDecision':
          this.client.send({
            type: 'approvalDecision',
            eventId: msg.eventId,
            decision: msg.decision as MPApprovalDecisionPayload,
          });
          break;

        case 'mpLeaveSession':
          this.dispose();
          break;

        case 'mpJoinSession': {
          if (msg.serverUrl) {
            this.client.setServerUrl(msg.serverUrl);
          }
          // Always re-read the auth token from settings on every connect attempt.
          // The token's only source is `claudeMirror.multiParticipant.authToken`
          // (the dialog has no token field), so refreshing it here lets a user who
          // fixed a wrong/expired token retry in the SAME tab. The previous guard
          // skipped the reload whenever the client already held a (now-stale) token,
          // so a retry after correcting settings kept sending the bad credentials.
          const token = vscode.workspace.getConfiguration('claudeMirror').get<string>('multiParticipant.authToken', '');
          this.client.setAuthToken(token);
          if (token) {
            this.log('[MPTab] Auth token loaded from settings');
          }
          this.connect(msg.humanName, msg.agentName, msg.agentProvider, msg.password, msg.sessionNumber, msg.sessionName, msg.mode || 'join');
          break;
        }

        case 'mpRenameParticipant':
          this.client.send({
            type: 'renameParticipant',
            participantId: msg.participantId,
            newDisplayName: msg.newDisplayName,
          });
          break;

        case 'mpCancelAgent':
          this.client.send({
            type: 'agentEvent',
            deliveryId: msg.deliveryId,
            event: { kind: 'interrupted', interruptedByDeliveryId: '' },
          });
          break;

        case 'mpStopA2A':
          // Reset loop control to 'ask' mode - handled via approval denial
          break;

        case 'mpResetSession':
          vscode.window.showWarningMessage(
            'Start a new session? The current transcript will be archived.',
            'Yes', 'No',
          ).then(choice => {
            if (choice === 'Yes') {
              this.client.send({ type: 'resetSession' });
            }
          });
          break;

        case 'mpAddReaction':
          this.client.send({ type: 'addReaction', messageId: msg.messageId, emoji: msg.emoji });
          break;

        case 'mpRemoveReaction':
          this.client.send({ type: 'removeReaction', messageId: msg.messageId, emoji: msg.emoji });
          break;
      }
    });
  }

  // -- Server Messages (Server -> Extension -> Webview) --

  private wireServerMessages(): void {
    this.client.on('message', (msg: ServerToClientMessage) => {
      switch (msg.type) {
        case 'sessionState':
          this.handleSessionState(msg);
          break;
        case 'newMessage':
          this.handleNewMessage(msg.message);
          break;
        case 'participantJoined':
          this.participants.push(msg.participant);
          this.postToWebview({ type: 'mpParticipants', participants: this.participants });
          break;
        case 'participantLeft':
          this.participants = this.participants.filter(p => p.participantId !== msg.participantId);
          this.postToWebview({ type: 'mpParticipants', participants: this.participants });
          break;
        case 'participantStatusChange':
          this.updateParticipantStatus(msg.participantId, msg.status);
          break;
        case 'deliveryStatusUpdate':
          this.postToWebview({
            type: 'mpDeliveryStatus',
            deliveryId: msg.deliveryId,
            agentParticipantId: msg.agentParticipantId,
            agentDisplayName: msg.agentDisplayName,
            status: msg.status,
            errorText: msg.errorText,
            interruptedByDeliveryId: msg.interruptedByDeliveryId,
          });
          break;
        case 'agentStreamingText':
          this.postToWebview({
            type: 'mpAgentStreamingText',
            deliveryId: msg.deliveryId,
            agentParticipantId: msg.agentParticipantId,
            text: msg.text,
          });
          break;
        case 'participantRenamed':
          this.handleParticipantRenamed(msg.event, msg.participant);
          break;
        case 'participantActivity':
          this.postToWebview({
            type: 'mpParticipantActivity',
            activity: msg.activity,
          });
          break;
        case 'agentToAgentApproval':
          this.pendingApprovals.set(msg.approval.eventId, msg.approval);
          this.postToWebview({
            type: 'mpAgentToAgentApproval',
            approval: msg.approval,
            pendingMessage: msg.pendingMessage,
            sourceAgent: msg.sourceAgent,
            targetAgent: msg.targetAgent,
          });
          break;
        case 'fileConflictWarning':
          this.activeConflicts.set(msg.warning.conflictId, msg.warning);
          this.postToWebview({
            type: 'mpFileConflictWarning',
            warning: msg.warning,
          });
          break;
        case 'guardStop':
          this.pendingApprovals.set(msg.approval.eventId, msg.approval);
          this.postToWebview({
            type: 'mpGuardStop',
            approval: msg.approval,
            reason: msg.reason,
            lastMessages: msg.lastMessages,
          });
          break;
        case 'approvalResolved':
          this.pendingApprovals.delete(msg.approval.eventId);
          this.postToWebview({
            type: 'mpApprovalResolved',
            approval: msg.approval,
            decision: msg.decision,
            decidedByParticipantId: msg.decidedByParticipantId,
            deliveryId: msg.deliveryId,
            deniedReason: msg.deniedReason,
          });
          break;
        case 'reactionUpdate':
          this.postToWebview({
            type: 'mpReactionUpdate',
            messageId: msg.messageId,
            reactions: msg.reactions,
          });
          break;
        case 'renameRejected':
          this.postToWebview({
            type: 'mpRenameRejected',
            participantId: msg.participantId,
            requestedDisplayName: msg.requestedDisplayName,
            reason: msg.reason,
          });
          break;
        case 'sessionReset':
          this.handleSessionReset(msg);
          break;
        case 'rejoinAccepted':
          this.handleRejoinAccepted(msg);
          break;
        case 'rejoinRejected':
          this.log(`[MPTab] Rejoin rejected: ${msg.reason} -- falling back to a fresh join`);
          this.postToWebview({ type: 'mpError', code: 'rejoin_rejected', message: msg.reason });
          this.attemptFreshJoinAfterRejoinRejected();
          break;
        case 'joinRejected':
          this.log(`[MPTab] Join rejected: ${msg.reason}`);
          this.postToWebview({ type: 'mpJoinRejected', reason: msg.reason });
          this.postToWebview({ type: 'mpConnectionStatus', status: 'error', message: msg.reason });
          vscode.window.showErrorMessage(
            `Multi-Participant join rejected: ${msg.reason}. Note: each participant's name must start with a unique letter.`
          );
          break;
        case 'ping':
          this.client.send({ type: 'pong' });
          break;
        case 'error':
          this.postToWebview({ type: 'mpError', code: msg.code, message: msg.message });
          break;
      }
    });
  }

  private handleSessionState(msg: Extract<ServerToClientMessage, { type: 'sessionState' }>): void {
    this.session = msg.session;
    this.participants = msg.participants;
    this.transcript = msg.transcript;
    this.hasJoinedOnce = true;

    if (this.session.sessionNumber != null) {
      this.sessionNumber = this.session.sessionNumber;
    }

    const humans = this.participants.filter(p => p.kind === 'human');
    const agents = this.participants.filter(p => p.kind === 'agent');
    if (humans.length > 0) {
      this.humanParticipantId = humans[humans.length - 1].participantId;
    }
    if (agents.length > 0) {
      this.agentParticipantId = agents[agents.length - 1].participantId;
      this.bridge.setAgentParticipantId(this.agentParticipantId);
    }

    this.client.setIdentity(this.humanParticipantId!, this.agentParticipantId!, this.sessionNumber);
    this.panel.title = this.session.name;
    this.sendFullState();
    this.log(`[MPTab] Session state received: room ${this.sessionNumber}, ${this.participants.length} participants, ${this.transcript.length} messages`);
  }

  private handleSessionReset(msg: Extract<ServerToClientMessage, { type: 'sessionReset' }>): void {
    this.session = msg.session;
    this.participants = msg.participants;
    this.transcript = [];
    this.pendingApprovals.clear();
    this.activeConflicts.clear();
    this.panel.title = this.session.name;
    this.sendFullState();
    this.log(`[MPTab] Session reset: new session ${this.session.sessionId}`);
  }

  private handleRejoinAccepted(msg: Extract<ServerToClientMessage, { type: 'rejoinAccepted' }>): void {
    this.session = msg.session;
    this.participants = msg.participants;
    this.hasJoinedOnce = true;
    if (this.session.sessionNumber != null) {
      this.sessionNumber = this.session.sessionNumber;
    }
    for (const m of msg.deltaTranscript) {
      this.transcript.push(m);
    }
    this.panel.title = this.session.name;
    this.sendFullState();
    this.log(`[MPTab] Rejoin accepted: room ${this.sessionNumber}, ${msg.deltaTranscript.length} new messages since seq ${msg.lastSeenSeq}`);
  }

  /**
   * The server could not restore our prior participant IDs (room was reset, or
   * we were pruned). Clear the stale identity and force a full reconnect; the
   * connect flow then re-enters the room via its join path (using the original
   * credentials captured in the connect closure), and the full transcript
   * arrives via sessionState -- instead of sitting connected-but-roomless.
   */
  private attemptFreshJoinAfterRejoinRejected(): void {
    if (this.disposed) return;
    this.humanParticipantId = null;
    this.agentParticipantId = null;
    this.log('[MPTab] Cleared stale identity after rejoin rejection; reconnecting to re-enter the room');
    this.client.forceReconnect();
  }

  private handleNewMessage(message: MPMessage): void {
    this.transcript.push(message);
    this.postToWebview({ type: 'mpNewMessage', message });
  }

  private updateParticipantStatus(participantId: string, status: 'online' | 'offline'): void {
    const p = this.participants.find(pp => pp.participantId === participantId);
    if (p) {
      p.status = status;
      this.postToWebview({ type: 'mpParticipants', participants: this.participants });
    }
  }

  private handleParticipantRenamed(
    event: { participantId: string; oldDisplayName: string; newDisplayName: string; oldRouteKey: string; newRouteKey: string },
    updatedParticipant: MPParticipant,
  ): void {
    const idx = this.participants.findIndex(p => p.participantId === event.participantId);
    if (idx >= 0) {
      this.participants[idx] = updatedParticipant;
    }
    this.postToWebview({
      type: 'mpParticipantRenamed',
      event: {
        eventId: '',
        sessionId: this.session?.sessionId || '',
        participantId: event.participantId,
        oldDisplayName: event.oldDisplayName,
        newDisplayName: event.newDisplayName,
        oldRouteKey: event.oldRouteKey,
        newRouteKey: event.newRouteKey,
        createdAt: new Date().toISOString(),
      },
      participant: updatedParticipant,
    });
    this.log(`[MPTab] Participant renamed: ${event.oldDisplayName} -> ${event.newDisplayName}`);
  }

  // -- State delivery --

  private sendFullState(): void {
    const pendingApprovalsList = [...this.pendingApprovals.values()].filter(a => a.decision === null);
    const activeConflictsList = [...this.activeConflicts.values()];

    this.postToWebview({
      type: 'mpSessionState',
      session: this.session,
      participants: this.participants,
      transcript: this.transcript,
      myHumanId: this.humanParticipantId,
      myAgentId: this.agentParticipantId,
      approvals: pendingApprovalsList.length > 0 ? pendingApprovalsList : undefined,
      fileConflicts: activeConflictsList.length > 0 ? activeConflictsList : undefined,
    });
  }

  private sendTabLayoutSetting(): void {
    const layout = vscode.workspace
      .getConfiguration('claudeMirror.tabs')
      .get<'horizontal' | 'vertical'>('layout', 'horizontal');
    this.postToWebview({ type: 'tabLayoutSetting', layout });
  }

  private postToWebview(msg: ExtensionToWebviewMessage): void {
    if (this.disposed) return;
    if (!this.webviewReady) {
      this.pendingMessages.push(msg);
      return;
    }
    this.panel.webview.postMessage(msg);
  }

  private flushPendingMessages(): void {
    for (const msg of this.pendingMessages) {
      this.panel.webview.postMessage(msg);
    }
    this.pendingMessages = [];
  }
}
