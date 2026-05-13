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
  private pendingApprovals: Map<string, MPApprovalEvent> = new Map();
  private activeConflicts: Map<string, MPFileConflictWarning> = new Map();
  private webviewReady = false;
  private pendingMessages: ExtensionToWebviewMessage[] = [];
  private disposed = false;

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
      }
    });

    this.panel.webview.html = buildWebviewHtml(this.panel.webview, context);
    this.wireWebviewMessages();
    this.wireServerMessages();
  }

  async connect(humanName: string, agentName: string, agentProvider: 'claude' | 'codex', password?: string): Promise<void> {
    this.log(`[MPTab] Connecting as ${humanName} with agent ${agentName} (${agentProvider})`);
    this.postToWebview({ type: 'mpConnectionStatus', status: 'connecting' });

    const rawModel = vscode.workspace.getConfiguration('claudeMirror').get<string>('model', '');
    const agentModel = rawModel && !rawModel.includes('(') ? rawModel : '';

    await this.runner.startAgent();
    this.log('[MPTab] Agent process started');

    this.client.on('connected', () => {
      this.postToWebview({ type: 'mpConnectionStatus', status: 'connected' });
      if (this.humanParticipantId && this.agentParticipantId) {
        this.log('[MPTab] Reconnected, attempting rejoin');
        this.client.sendRejoin();
        this.client.send({ type: 'agentStatus', status: 'online' });
      } else {
        this.log('[MPTab] Connected to server, joining session');
        const joinMsg: { type: 'joinSession'; humanName: string; agentName: string; agentProvider: 'claude' | 'codex'; agentModel?: string; password?: string } = {
          type: 'joinSession', humanName, agentName, agentProvider,
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

    this.client.connect();
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
    return this.session?.name || `MP Session #${this.tabNumber}`;
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
          if (this.session) {
            this.sendFullState();
          }
          break;

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

        case 'mpJoinSession':
          this.connect(msg.humanName, msg.agentName, msg.agentProvider);
          break;

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
          this.log(`[MPTab] Rejoin rejected: ${msg.reason}, will need fresh join`);
          this.postToWebview({ type: 'mpError', code: 'rejoin_rejected', message: msg.reason });
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

    const humans = this.participants.filter(p => p.kind === 'human');
    const agents = this.participants.filter(p => p.kind === 'agent');
    if (humans.length > 0) {
      this.humanParticipantId = humans[humans.length - 1].participantId;
    }
    if (agents.length > 0) {
      this.agentParticipantId = agents[agents.length - 1].participantId;
      this.bridge.setAgentParticipantId(this.agentParticipantId);
    }

    this.client.setIdentity(this.humanParticipantId!, this.agentParticipantId!);
    this.panel.title = this.session.name;
    this.sendFullState();
    this.log(`[MPTab] Session state received: ${this.participants.length} participants, ${this.transcript.length} messages`);
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
    for (const m of msg.deltaTranscript) {
      this.transcript.push(m);
    }
    this.panel.title = this.session.name;
    this.sendFullState();
    this.log(`[MPTab] Rejoin accepted: ${msg.deltaTranscript.length} new messages since seq ${msg.lastSeenSeq}`);
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
