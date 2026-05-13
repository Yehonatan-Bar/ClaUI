import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { URL } from 'url';
import { v4 as uuid } from 'uuid';
import {
  Session, Participant, Message, AgentDelivery, AgentSeenState,
  DeliveryStatus, ClientToServerMessage, ServerToClientMessage, AgentEventPayload,
  AgentBusyPolicy, RenameEvent, TypingState, ParticipantActivityState,
  FileChangeReport, FileConflictWarning, FileConflictDelivery,
  ApprovalDecisionPayload, AgentLoopControlState, ApprovalEvent,
} from './types';
import { validateParticipantName, routeMessage, extractRouteKey } from './Router';
import { LoopController } from './LoopController';
import { GuardService, GuardConfig } from './GuardService';
import { SessionPersistence } from './SessionPersistence';
import {
  buildDeltaContext as buildDeltaContextFn,
  formatAgentPrompt as formatAgentPromptFn,
  escapeXml as escapeXmlFn,
  type PromptFormatterDeps,
} from './PromptFormatter';

interface ConnectedClient {
  ws: WebSocket;
  humanParticipantId: string;
  agentParticipantId: string;
}

/** Tracks a single agent's claim on a file within a delivery. */
interface FileTrackerEntry {
  deliveryId: string;
  agentParticipantId: string;
  agentDisplayName: string;
}

export interface ServerConfig {
  log?: (msg: string) => void;
  persistenceDir?: string;
  guardApiKey?: string;
  guardModel?: string;
  guardApiUrl?: string;
  /** If set, clients must send this token via ?token= query param to connect. */
  sessionToken?: string;
}

export class CoordinationServer {
  private wss: WebSocketServer | null = null;
  private session: Session | null = null;
  private participants: Participant[] = [];
  private transcript: Message[] = [];
  private deliveries: Map<string, AgentDelivery> = new Map();
  private seenState: Map<string, AgentSeenState> = new Map();
  private clients: Map<WebSocket, ConnectedClient> = new Map();
  private loopController: LoopController | null = null;
  private guardService: GuardService;
  private persistence: SessionPersistence | null = null;
  private renameEvents: RenameEvent[] = [];
  private typingStates: Map<string, TypingState> = new Map();
  private approvalHistory: ApprovalEvent[] = [];
  private a2aRoutingChain: Promise<void> = Promise.resolve();
  /** Maps "workspaceId:normalizedPath" to the set of active deliveries touching that file. */
  private fileTracker: Map<string, Set<FileTrackerEntry>> = new Map();
  /** Conflict warnings already broadcast, keyed by conflictId. */
  private activeConflicts: Map<string, FileConflictWarning> = new Map();
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private streamCoalesceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private streamCoalesceBuffers: Map<string, { deliveryId: string; agentParticipantId: string; accumulated: string }> = new Map();
  private config: ServerConfig;
  private log: (msg: string) => void;

  constructor(config?: ServerConfig) {
    this.config = config || {};
    this.log = config?.log || console.log;

    const guardConfig: GuardConfig | null = config?.guardApiKey
      ? {
          apiKey: config.guardApiKey,
          model: config.guardModel || 'claude-haiku-4-5-20251001',
          apiUrl: config.guardApiUrl,
          timeoutMs: 10000,
        }
      : null;
    this.guardService = new GuardService(guardConfig, this.log);
  }

  /** Returns a copy of the session safe to send to clients (password stripped, hasPassword flag added). */
  private publicSession(): Session {
    if (!this.session) throw new Error('No active session');
    const { sessionPassword, ...safe } = this.session;
    return { ...safe, sessionPassword: null, hasPassword: !!sessionPassword } as unknown as Session;
  }

  start(port: number): void {
    // Try to restore from persistence
    if (this.config.persistenceDir) {
      const restored = SessionPersistence.loadLatestSession(this.config.persistenceDir, this.log);
      if (restored) {
        this.session = restored.session;
        this.participants = [];
        this.transcript = restored.transcript;
        this.deliveries = restored.deliveries;
        this.seenState = restored.seenState;
        this.renameEvents = restored.renameEvents;
        this.approvalHistory = restored.approvals;

        this.loopController = new LoopController(restored.session.sessionId, this.log);
        if (restored.loopState) {
          this.loopController.restoreState(restored.loopState);
        }

        this.log(`Restored session ${this.session.sessionId} with ${this.transcript.length} messages (participants cleared - they must rejoin)`);
      }
    }

    if (!this.session) {
      this.session = {
        sessionId: uuid(),
        name: 'Multi-Participant Session',
        createdAt: new Date().toISOString(),
        createdByParticipantId: '',
        status: 'active',
        nextSeq: 1,
        agentMode: 'execute',
        allowRemoteSteer: 'owner-only',
        sessionPassword: null,
      };
      this.loopController = new LoopController(this.session.sessionId, this.log);
      this.log(`Session created: ${this.session.sessionId}`);
    }

    if (this.config.persistenceDir && this.session) {
      this.persistence = new SessionPersistence(
        this.config.persistenceDir, this.session.sessionId, this.log,
      );
      this.persistence.init();
      if (this.transcript.length === 0) {
        this.persistence.append('init', { session: this.session });
      }
    }

    const verifyClient = this.config.sessionToken
      ? (info: { req: IncomingMessage }): boolean => {
          const reqUrl = new URL(info.req.url || '/', `http://localhost:${port}`);
          const clientToken = reqUrl.searchParams.get('token');
          if (clientToken !== this.config.sessionToken) {
            this.log(`Connection rejected: invalid token from ${info.req.socket.remoteAddress}`);
            return false;
          }
          return true;
        }
      : undefined;

    this.wss = new WebSocketServer({ port, verifyClient });
    this.log(`Coordination server listening on port ${port}`);
    if (this.config.sessionToken) {
      this.log('Token authentication enabled');
    }

    this.wss.on('connection', (ws) => this.handleConnection(ws));

    this.pingInterval = setInterval(() => {
      for (const [ws] of this.clients) {
        if (ws.readyState === WebSocket.OPEN) {
          this.sendToClient(ws, { type: 'ping' });
        }
      }
    }, 10000);
  }

  stop(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    for (const timer of this.streamCoalesceTimers.values()) {
      clearTimeout(timer);
    }
    this.streamCoalesceTimers.clear();
    this.streamCoalesceBuffers.clear();
    if (this.wss) {
      for (const client of this.clients.keys()) {
        client.close();
      }
      this.wss.close();
      this.wss = null;
      this.persistence?.close();
      this.log('Coordination server stopped');
    }
  }

  private handleConnection(ws: WebSocket): void {
    this.log('New WebSocket connection');

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ClientToServerMessage;
        this.handleClientMessage(ws, msg);
      } catch (err) {
        this.log(`Error handling message: ${err}`);
        this.sendToClient(ws, { type: 'error', code: 'PARSE_ERROR', message: 'Invalid message format' });
      }
    });

    ws.on('close', () => {
      this.handleDisconnect(ws);
    });

    ws.on('error', (err) => {
      this.log(`WebSocket error: ${err.message}`);
    });
  }

  private handleClientMessage(ws: WebSocket, msg: ClientToServerMessage): void {
    switch (msg.type) {
      case 'joinSession':
        this.handleJoin(ws, msg.humanName, msg.agentName, msg.agentProvider, msg.agentModel, msg.password);
        break;
      case 'rejoinSession':
        this.handleRejoin(ws, msg.humanParticipantId, msg.agentParticipantId, msg.lastSeenSeq);
        break;
      case 'humanMessage':
        this.handleHumanMessage(ws, msg.rawBody);
        break;
      case 'agentEvent':
        this.handleAgentEvent(ws, msg.deliveryId, msg.event);
        break;
      case 'agentStatus':
        this.handleAgentStatus(ws, msg.status);
        break;
      case 'approvalDecision':
        this.handleApprovalDecision(ws, msg.eventId, msg.decision);
        break;
      case 'typingIndicator':
        this.handleTypingIndicator(ws, msg.state);
        break;
      case 'fileChangeReport':
        this.handleFileChangeReport(ws, msg.report);
        break;
      case 'renameParticipant':
        this.handleRename(ws, msg.participantId, msg.newDisplayName);
        break;
      case 'leaveSession':
        this.handleLeave(ws);
        break;
      case 'resetSession':
        this.handleResetSession(ws);
        break;
      case 'pong':
        // Client responded to ping, connection is alive
        break;
    }
  }

  // -- Join / Leave --

  private handleJoin(ws: WebSocket, humanName: string, agentName: string, agentProvider: 'claude' | 'codex', agentModel?: string, password?: string): void {
    if (!this.session) {
      this.sendToClient(ws, { type: 'joinRejected', reason: 'No active session' });
      return;
    }

    const isFirstJoin = this.participants.length === 0;

    if (isFirstJoin) {
      // First user creates the session — their password becomes the session password
      this.session.sessionPassword = password || null;
      if (password) {
        this.log('[Session] Password set by session creator');
      }
    } else if (this.session.sessionPassword) {
      // Session is password-protected — validate
      if (!password || password !== this.session.sessionPassword) {
        this.sendToClient(ws, { type: 'joinRejected', reason: 'Invalid session password' });
        this.log(`[Session] Join rejected: invalid password from ${humanName}`);
        return;
      }
    }

    try {
      const humanValidated = validateParticipantName(humanName, this.participants);
      const tempHumanParticipant: Participant = {
        participantId: uuid(),
        sessionId: this.session.sessionId,
        kind: 'human',
        displayName: humanValidated.displayName,
        canonicalName: humanValidated.canonicalName,
        routeKey: humanValidated.routeKey,
        ownerHumanId: null,
        provider: null,
        model: null,
        status: 'online',
        joinedAt: new Date().toISOString(),
      };

      const agentValidated = validateParticipantName(agentName, [...this.participants, tempHumanParticipant]);
      const agentParticipant: Participant = {
        participantId: uuid(),
        sessionId: this.session.sessionId,
        kind: 'agent',
        displayName: agentValidated.displayName,
        canonicalName: agentValidated.canonicalName,
        routeKey: agentValidated.routeKey,
        ownerHumanId: tempHumanParticipant.participantId,
        provider: agentProvider,
        model: agentModel || null,
        status: 'online',
        joinedAt: new Date().toISOString(),
      };

      if (isFirstJoin) {
        this.session.createdByParticipantId = tempHumanParticipant.participantId;
      }

      this.participants.push(tempHumanParticipant, agentParticipant);

      const agentSeen: AgentSeenState = {
        agentParticipantId: agentParticipant.participantId,
        sessionId: this.session.sessionId,
        lastAckedDeliveredSeq: 0,
        lastDeliveryId: null,
        updatedAt: new Date().toISOString(),
      };
      this.seenState.set(agentParticipant.participantId, agentSeen);

      this.clients.set(ws, {
        ws,
        humanParticipantId: tempHumanParticipant.participantId,
        agentParticipantId: agentParticipant.participantId,
      });

      this.persistence?.append('join', {
        human: tempHumanParticipant,
        agent: agentParticipant,
        agentSeen,
      });

      this.sendToClient(ws, {
        type: 'sessionState',
        session: this.publicSession(),
        participants: this.participants,
        transcript: this.transcript,
        loopControlState: this.loopController?.getState(),
        approvals: this.approvalHistory.filter(a => a.decision === null),
        typingStates: [...this.typingStates.values()],
        fileConflicts: this.activeConflicts.size > 0
          ? [...this.activeConflicts.values()]
          : undefined,
      });

      this.broadcastExcept(ws, { type: 'participantJoined', participant: tempHumanParticipant });
      this.broadcastExcept(ws, { type: 'participantJoined', participant: agentParticipant });

      this.log(`Joined: ${humanName} (human) + ${agentName} (${agentProvider} agent)`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.sendToClient(ws, { type: 'joinRejected', reason });
      this.log(`Join rejected: ${reason}`);
    }
  }

  private handleRejoin(ws: WebSocket, humanParticipantId: string, agentParticipantId: string, lastSeenSeq: number): void {
    if (!this.session) {
      this.sendToClient(ws, { type: 'rejoinRejected', reason: 'No active session' });
      return;
    }

    const human = this.participants.find(p => p.participantId === humanParticipantId);
    const agent = this.participants.find(p => p.participantId === agentParticipantId);

    if (!human || !agent) {
      this.sendToClient(ws, { type: 'rejoinRejected', reason: 'Participant IDs not found in session' });
      return;
    }

    // Remove any stale WebSocket mapping for this participant pair
    for (const [oldWs, client] of this.clients.entries()) {
      if (client.humanParticipantId === humanParticipantId) {
        this.clients.delete(oldWs);
        break;
      }
    }

    human.status = 'online';
    agent.status = 'online';

    this.clients.set(ws, { ws, humanParticipantId, agentParticipantId });

    const deltaTranscript = this.transcript.filter(m => m.seq > lastSeenSeq);

    this.sendToClient(ws, {
      type: 'rejoinAccepted',
      session: this.publicSession(),
      participants: this.participants,
      deltaTranscript,
      lastSeenSeq,
    });

    this.broadcastExcept(ws, { type: 'participantStatusChange', participantId: humanParticipantId, status: 'online' });
    this.broadcastExcept(ws, { type: 'participantStatusChange', participantId: agentParticipantId, status: 'online' });

    this.persistence?.append('pstat', { participantId: humanParticipantId, status: 'online' });
    this.persistence?.append('pstat', { participantId: agentParticipantId, status: 'online' });

    this.log(`Rejoined: ${human.displayName} (${deltaTranscript.length} missed messages)`);
  }

  private handleLeave(ws: WebSocket): void {
    const client = this.clients.get(ws);
    if (!client) return;

    const human = this.participants.find(p => p.participantId === client.humanParticipantId);
    const agent = this.participants.find(p => p.participantId === client.agentParticipantId);

    if (human) {
      this.broadcast({ type: 'participantLeft', participantId: human.participantId });
      this.persistence?.append('leave', { participantId: human.participantId });
    }
    if (agent) {
      this.broadcast({ type: 'participantLeft', participantId: agent.participantId });
      this.persistence?.append('leave', { participantId: agent.participantId });
    }

    this.participants = this.participants.filter(
      p => p.participantId !== client.humanParticipantId && p.participantId !== client.agentParticipantId
    );
    this.clients.delete(ws);
    this.log(`Left: ${human?.displayName || 'unknown'} (participants remaining: ${this.participants.length})`);
  }

  private handleDisconnect(ws: WebSocket): void {
    const client = this.clients.get(ws);
    if (!client) return;

    const human = this.participants.find(p => p.participantId === client.humanParticipantId);
    const agent = this.participants.find(p => p.participantId === client.agentParticipantId);

    if (human) {
      this.broadcastExcept(ws, { type: 'participantLeft', participantId: human.participantId });
      this.persistence?.append('leave', { participantId: human.participantId });
    }
    if (agent) {
      this.broadcastExcept(ws, { type: 'participantLeft', participantId: agent.participantId });
      this.persistence?.append('leave', { participantId: agent.participantId });
    }

    this.participants = this.participants.filter(
      p => p.participantId !== client.humanParticipantId && p.participantId !== client.agentParticipantId
    );
    this.clients.delete(ws);
    this.log(`Disconnected: ${human?.displayName || 'unknown'} (participants remaining: ${this.participants.length})`);
  }

  // -- Reset Session --

  private handleResetSession(ws: WebSocket): void {
    if (!this.session) return;

    const client = this.clients.get(ws);
    if (!client) return;

    this.log(`Session reset requested by ${client.humanParticipantId}`);

    this.persistence?.close();

    const newSessionId = uuid();
    this.session = {
      sessionId: newSessionId,
      name: 'Multi-Participant Session',
      createdAt: new Date().toISOString(),
      createdByParticipantId: client.humanParticipantId,
      status: 'active',
      nextSeq: 1,
      agentMode: 'execute',
      allowRemoteSteer: 'owner-only',
      sessionPassword: this.session.sessionPassword,
    };

    this.transcript = [];
    this.deliveries.clear();
    this.seenState.clear();
    this.renameEvents = [];
    this.typingStates.clear();
    this.approvalHistory = [];
    this.fileTracker.clear();
    this.activeConflicts.clear();

    for (const timer of this.streamCoalesceTimers.values()) {
      clearTimeout(timer);
    }
    this.streamCoalesceTimers.clear();
    this.streamCoalesceBuffers.clear();

    this.loopController = new LoopController(newSessionId, this.log);

    for (const p of this.participants) {
      p.sessionId = newSessionId;
    }

    for (const p of this.participants) {
      if (p.kind === 'agent') {
        this.seenState.set(p.participantId, {
          agentParticipantId: p.participantId,
          sessionId: newSessionId,
          lastAckedDeliveredSeq: 0,
          lastDeliveryId: null,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    if (this.config.persistenceDir) {
      this.persistence = new SessionPersistence(
        this.config.persistenceDir, newSessionId, this.log,
      );
      this.persistence.init();
      this.persistence.append('init', { session: this.session });
      for (const c of this.clients.values()) {
        const human = this.participants.find(p => p.participantId === c.humanParticipantId);
        const agent = this.participants.find(p => p.participantId === c.agentParticipantId);
        if (human && agent) {
          this.persistence.append('join', { human, agent });
        }
      }
    }

    this.broadcast({
      type: 'sessionReset',
      session: this.publicSession(),
      participants: this.participants,
    });

    this.log(`Session reset complete: new session ${newSessionId}`);
  }

  // -- Human Message --

  private handleHumanMessage(ws: WebSocket, rawBody: string): void {
    const client = this.clients.get(ws);
    if (!client || !this.session) return;

    const author = this.participants.find(p => p.participantId === client.humanParticipantId);
    if (!author) return;

    const route = routeMessage(rawBody, this.participants);

    const seq = this.session.nextSeq++;
    const message: Message = {
      messageId: uuid(),
      sessionId: this.session.sessionId,
      seq,
      authorParticipantId: author.participantId,
      recipientParticipantId: route.recipientParticipantId,
      rawBody,
      parsedBody: route.parsedBody,
      routePrefix: route.routePrefix,
      createdAt: new Date().toISOString(),
      displayNameSnapshot: author.displayName,
      deliveryId: null,
      agentTurnStatus: null,
      triggerMessageId: null,
      triggerDeliveryId: null,
    };

    this.transcript.push(message);
    this.persistence?.append('msg', message);
    this.log(`Message #${seq} from ${author.displayName}: "${rawBody.substring(0, 80)}..."`);

    this.broadcastActivity(author.participantId, 'idle');
    this.broadcast({ type: 'newMessage', message });

    if (route.recipientParticipantId) {
      const recipient = this.participants.find(p => p.participantId === route.recipientParticipantId);
      if (recipient && recipient.kind === 'agent') {
        this.loopController?.resetOnHumanIntervention();
        if (this.loopController) {
          this.persistence?.append('loop', this.loopController.getState());
        }
        this.deliverToAgent(recipient, message);
      }
    }
  }

  // -- Agent Delivery --

  private deliverToAgent(agent: Participant, triggerMessage: Message): void {
    if (!this.session) return;

    const deliveryId = uuid();
    const deltaContext = this.buildDeltaContext(agent, triggerMessage);
    const prompt = this.formatAgentPrompt(agent, deltaContext, triggerMessage);

    const ownerClient = this.findClientForAgent(agent);
    let busyPolicy: AgentBusyPolicy | null = 'direct';
    if (agent.provider === 'codex') {
      busyPolicy = 'codex-auto-steer';
    }

    const delivery: AgentDelivery = {
      deliveryId,
      sessionId: this.session.sessionId,
      agentParticipantId: agent.participantId,
      triggerMessageId: triggerMessage.messageId,
      triggerSeq: triggerMessage.seq,
      contextStartSeq: deltaContext.startSeq,
      contextEndSeq: triggerMessage.seq,
      status: 'pending',
      busyPolicy,
      responseMessageId: null,
      errorText: null,
      notDeliveredReason: null,
      interruptedByDeliveryId: null,
      createdAt: new Date().toISOString(),
      acknowledgedAt: null,
      startedAt: null,
      completedAt: null,
    };

    this.deliveries.set(deliveryId, delivery);
    this.persistence?.append('dlv', delivery);

    triggerMessage.deliveryId = deliveryId;
    triggerMessage.agentTurnStatus = 'pending';

    if (!ownerClient || agent.status === 'offline') {
      delivery.status = 'not_delivered';
      delivery.notDeliveredReason = 'agent-offline';
      triggerMessage.agentTurnStatus = 'not_delivered';
      this.persistence?.append('dlv', delivery);
      this.broadcast({
        type: 'deliveryStatusUpdate',
        deliveryId,
        agentParticipantId: agent.participantId,
        agentDisplayName: agent.displayName,
        status: 'not_delivered',
      });
      this.log(`Delivery ${deliveryId}: agent ${agent.displayName} is offline, not delivered`);
      return;
    }

    this.sendToClient(ownerClient.ws, {
      type: 'deliverPrompt',
      deliveryId,
      agentParticipantId: agent.participantId,
      prompt,
      busyPolicy,
    });

    this.broadcast({
      type: 'deliveryStatusUpdate',
      deliveryId,
      agentParticipantId: agent.participantId,
      agentDisplayName: agent.displayName,
      status: 'pending',
    });

    this.log(`Delivery ${deliveryId}: sent to ${agent.displayName} (${agent.provider}), busyPolicy=${busyPolicy}`);
  }

  // -- Agent Events --

  private handleAgentEvent(ws: WebSocket, deliveryId: string, event: AgentEventPayload): void {
    const delivery = this.deliveries.get(deliveryId);
    if (!delivery || !this.session) return;

    const agent = this.participants.find(p => p.participantId === delivery.agentParticipantId);
    if (!agent) return;

    switch (event.kind) {
      case 'accepted': {
        delivery.status = 'acknowledged';
        delivery.acknowledgedAt = new Date().toISOString();
        const seen = this.seenState.get(agent.participantId);
        if (seen) {
          seen.lastAckedDeliveredSeq = delivery.contextEndSeq;
          seen.lastDeliveryId = deliveryId;
          seen.updatedAt = new Date().toISOString();
          this.persistence?.append('seen', seen);
        }
        this.persistence?.append('dlv', delivery);
        this.broadcast({
          type: 'deliveryStatusUpdate',
          deliveryId,
          agentParticipantId: agent.participantId,
          agentDisplayName: agent.displayName,
          status: 'acknowledged',
        });
        this.broadcastActivity(agent.participantId, 'thinking');
        this.log(`Delivery ${deliveryId}: acknowledged by ClaUi`);
        break;
      }

      case 'rejected': {
        delivery.status = 'failed';
        delivery.errorText = event.error;
        this.persistence?.append('dlv', delivery);
        this.broadcast({
          type: 'deliveryStatusUpdate',
          deliveryId,
          agentParticipantId: agent.participantId,
          agentDisplayName: agent.displayName,
          status: 'failed',
          errorText: event.error,
        });
        this.broadcastActivity(agent.participantId, 'idle');
        this.cleanupFileTrackerForDelivery(deliveryId);
        this.log(`Delivery ${deliveryId}: rejected - ${event.error}`);
        break;
      }

      case 'started': {
        delivery.status = 'running';
        delivery.startedAt = new Date().toISOString();
        this.persistence?.append('dlv', delivery);
        this.broadcast({
          type: 'deliveryStatusUpdate',
          deliveryId,
          agentParticipantId: agent.participantId,
          agentDisplayName: agent.displayName,
          status: 'running',
        });
        break;
      }

      case 'firstToken': {
        delivery.status = 'streaming';
        this.persistence?.append('dlv', delivery);
        this.broadcast({
          type: 'deliveryStatusUpdate',
          deliveryId,
          agentParticipantId: agent.participantId,
          agentDisplayName: agent.displayName,
          status: 'streaming',
        });
        this.broadcastActivity(agent.participantId, 'streaming');
        break;
      }

      case 'textDelta': {
        this.coalesceStreamingText(deliveryId, agent.participantId, event.text);
        break;
      }

      case 'completed': {
        this.flushStreamingBuffer(deliveryId);
        delivery.status = 'completed';
        delivery.completedAt = new Date().toISOString();

        // Route the agent's response to detect addressing
        const route = routeMessage(event.fullText, this.participants);

        const seq = this.session.nextSeq++;
        const responseMessage: Message = {
          messageId: uuid(),
          sessionId: this.session.sessionId,
          seq,
          authorParticipantId: agent.participantId,
          recipientParticipantId: route.recipientParticipantId,
          rawBody: event.fullText,
          parsedBody: route.parsedBody,
          routePrefix: route.routePrefix,
          createdAt: new Date().toISOString(),
          displayNameSnapshot: agent.displayName,
          deliveryId: null,
          agentTurnStatus: null,
          triggerMessageId: delivery.triggerMessageId,
          triggerDeliveryId: deliveryId,
        };
        this.transcript.push(responseMessage);
        delivery.responseMessageId = responseMessage.messageId;

        this.persistence?.append('msg', responseMessage);
        this.persistence?.append('dlv', delivery);

        this.broadcast({ type: 'newMessage', message: responseMessage });
        this.broadcast({
          type: 'deliveryStatusUpdate',
          deliveryId,
          agentParticipantId: agent.participantId,
          agentDisplayName: agent.displayName,
          status: 'completed',
        });
        this.broadcastActivity(agent.participantId, 'idle');
        this.cleanupFileTrackerForDelivery(deliveryId);

        // Check if agent response addresses another agent (A2A)
        if (route.recipientParticipantId) {
          const recipient = this.participants.find(p => p.participantId === route.recipientParticipantId);
          if (recipient && recipient.kind === 'agent' && this.loopController) {
            this.a2aRoutingChain = this.a2aRoutingChain
              .then(() => this.handleAgentToAgentRouting(agent, recipient, responseMessage))
              .catch(err => this.log(`Error in A2A routing: ${err}`));
          } else if (recipient && recipient.kind === 'agent') {
            this.deliverToAgent(recipient, responseMessage);
          }
        }

        this.log(`Delivery ${deliveryId}: completed, response #${seq} (${event.fullText.length} chars)`);
        break;
      }

      case 'failed': {
        this.flushStreamingBuffer(deliveryId);
        delivery.status = 'failed';
        delivery.errorText = event.error;
        delivery.completedAt = new Date().toISOString();
        this.persistence?.append('dlv', delivery);
        this.broadcast({
          type: 'deliveryStatusUpdate',
          deliveryId,
          agentParticipantId: agent.participantId,
          agentDisplayName: agent.displayName,
          status: 'failed',
          errorText: event.error,
        });
        this.broadcastActivity(agent.participantId, 'idle');
        this.cleanupFileTrackerForDelivery(deliveryId);
        this.log(`Delivery ${deliveryId}: failed - ${event.error}`);
        break;
      }

      case 'interrupted': {
        this.flushStreamingBuffer(deliveryId);
        delivery.status = 'interrupted';
        delivery.interruptedByDeliveryId = event.interruptedByDeliveryId;
        delivery.completedAt = new Date().toISOString();
        this.persistence?.append('dlv', delivery);
        this.broadcast({
          type: 'deliveryStatusUpdate',
          deliveryId,
          agentParticipantId: agent.participantId,
          agentDisplayName: agent.displayName,
          status: 'interrupted',
          interruptedByDeliveryId: event.interruptedByDeliveryId,
        });
        this.cleanupFileTrackerForDelivery(deliveryId);
        this.log(`Delivery ${deliveryId}: interrupted by ${event.interruptedByDeliveryId}`);
        break;
      }
    }
  }

  private handleAgentStatus(ws: WebSocket, status: 'online' | 'offline'): void {
    const client = this.clients.get(ws);
    if (!client) return;

    const agent = this.participants.find(p => p.participantId === client.agentParticipantId);
    if (!agent) return;

    agent.status = status;
    this.persistence?.append('pstat', { participantId: agent.participantId, status });
    this.broadcast({
      type: 'participantStatusChange',
      participantId: agent.participantId,
      status,
    });
    this.log(`Agent ${agent.displayName} status: ${status}`);
  }

  // -- Agent-to-Agent Loop Protection --

  private async handleAgentToAgentRouting(
    sourceAgent: Participant,
    targetAgent: Participant,
    responseMessage: Message,
  ): Promise<void> {
    if (!this.loopController || !this.session) return;

    const result = this.loopController.processA2A(
      this.session.sessionId,
      sourceAgent,
      targetAgent,
      responseMessage,
    );

    switch (result.action) {
      case 'deliver': {
        this.persistence?.append('loop', this.loopController.getState());
        this.deliverToAgent(targetAgent, responseMessage);
        break;
      }

      case 'pause': {
        this.approvalHistory.push(result.approval);
        this.persistence?.append('appr', result.approval);
        this.persistence?.append('loop', this.loopController.getState());

        this.broadcast({
          type: 'agentToAgentApproval',
          approval: result.approval,
          pendingMessage: responseMessage,
          sourceAgent,
          targetAgent,
        });
        this.broadcast({
          type: 'a2aPendingApproval',
          approval: result.approval,
          pendingMessageId: responseMessage.messageId,
          sourceAgentId: sourceAgent.participantId,
          targetAgentId: targetAgent.participantId,
        });
        this.log(`A2A paused: ${sourceAgent.displayName} -> ${targetAgent.displayName}, approval ${result.approval.eventId}`);
        break;
      }

      case 'guard-check': {
        const agents = this.participants.filter(p => p.kind === 'agent');
        const recentMessages = this.transcript.slice(-5);

        const guardResult = await this.guardService.check(
          this.session.name,
          agents,
          this.loopController.getState(),
          recentMessages,
          this.participants,
        );

        if (guardResult === 'continue') {
          this.loopController.advanceGuardCheckpoint();
          this.persistence?.append('loop', this.loopController.getState());
          this.deliverToAgent(targetAgent, responseMessage);
        } else {
          const approval = this.loopController.createGuardPauseApproval(
            this.session.sessionId,
            sourceAgent,
            targetAgent,
            responseMessage,
          );
          this.approvalHistory.push(approval);
          this.persistence?.append('appr', approval);
          this.persistence?.append('loop', this.loopController.getState());

          const lastMessages = this.transcript.slice(-5);
          this.broadcast({
            type: 'guardStop',
            approval,
            reason: 'Guard model detected potential unproductive loop',
            lastMessages,
          });
          this.broadcast({
            type: 'agentToAgentApproval',
            approval,
            pendingMessage: responseMessage,
            sourceAgent,
            targetAgent,
          });
          this.log(`Guard STOP: ${sourceAgent.displayName} -> ${targetAgent.displayName}`);
        }
        break;
      }
    }
  }

  // -- Approval Decisions --

  private handleApprovalDecision(
    ws: WebSocket,
    eventId: string,
    decision: ApprovalDecisionPayload,
  ): void {
    const client = this.clients.get(ws);
    if (!client || !this.loopController || !this.session) return;

    const result = this.loopController.processApprovalDecision(
      eventId,
      decision,
      client.humanParticipantId,
    );

    if (!result) {
      this.sendToClient(ws, {
        type: 'error',
        code: 'APPROVAL_NOT_FOUND',
        message: 'Approval event not found or already resolved',
      });
      return;
    }

    const { approval, pendingMessage, targetAgent } = result;

    this.persistence?.append('appr', approval);
    this.persistence?.append('loop', this.loopController.getState());

    if (decision.type === 'deny') {
      this.broadcast({
        type: 'approvalResolved',
        approval,
        decision,
        decidedByParticipantId: client.humanParticipantId,
        deniedReason: 'Human denied agent-to-agent delivery',
      });
      this.log(`A2A denied: approval ${eventId}`);
    } else {
      this.broadcast({
        type: 'approvalResolved',
        approval,
        decision,
        decidedByParticipantId: client.humanParticipantId,
      });
      this.deliverToAgent(targetAgent, pendingMessage);
      this.log(`A2A approved (${decision.type}): approval ${eventId}`);
    }
  }

  // -- Typing Indicators --

  private handleTypingIndicator(
    ws: WebSocket,
    state: 'idle' | 'typing',
  ): void {
    const client = this.clients.get(ws);
    if (!client) return;

    const human = this.participants.find(p => p.participantId === client.humanParticipantId);
    if (!human) return;

    this.broadcastActivity(human.participantId, state, ws);
  }

  private broadcastActivity(
    participantId: string,
    state: ParticipantActivityState,
    excludeWs?: WebSocket,
  ): void {
    const now = new Date().toISOString();
    this.typingStates.set(participantId, { participantId, state, updatedAt: now });

    const msg: ServerToClientMessage = {
      type: 'participantActivity',
      activity: { participantId, state, updatedAt: now },
    };

    if (excludeWs) {
      this.broadcastExcept(excludeWs, msg);
    } else {
      this.broadcast(msg);
    }
  }

  // -- Rename --

  private handleRename(
    ws: WebSocket,
    participantId: string,
    newDisplayName: string,
  ): void {
    const client = this.clients.get(ws);
    if (!client || !this.session) return;

    if (participantId !== client.humanParticipantId && participantId !== client.agentParticipantId) {
      this.sendToClient(ws, {
        type: 'renameRejected',
        participantId,
        requestedDisplayName: newDisplayName,
        reason: 'Can only rename your own participants',
      });
      return;
    }

    const participant = this.participants.find(p => p.participantId === participantId);
    if (!participant) {
      this.sendToClient(ws, {
        type: 'renameRejected',
        participantId,
        requestedDisplayName: newDisplayName,
        reason: 'Participant not found',
      });
      return;
    }

    try {
      const validated = validateParticipantName(newDisplayName, this.participants, participantId);

      const renameEvent: RenameEvent = {
        eventId: uuid(),
        sessionId: this.session.sessionId,
        participantId,
        oldDisplayName: participant.displayName,
        newDisplayName: validated.displayName,
        oldRouteKey: participant.routeKey,
        newRouteKey: validated.routeKey,
        createdAt: new Date().toISOString(),
      };

      participant.displayName = validated.displayName;
      participant.canonicalName = validated.canonicalName;
      participant.routeKey = validated.routeKey;

      this.renameEvents.push(renameEvent);
      this.persistence?.append('rename', { event: renameEvent, participant });

      this.broadcast({
        type: 'participantRenamed',
        event: renameEvent,
        participant,
      });

      this.log(`Renamed: ${renameEvent.oldDisplayName} -> ${renameEvent.newDisplayName}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.sendToClient(ws, {
        type: 'renameRejected',
        participantId,
        requestedDisplayName: newDisplayName,
        reason,
      });
      this.log(`Rename rejected: ${reason}`);
    }
  }

  // -- File Change Reports & Overlap Detection --

  /**
   * Normalize a file path for consistent map lookups.
   * Lowercases on Windows (case-insensitive FS), resolves . and .. segments,
   * and normalizes separators to forward slashes.
   */
  private normalizeFilePath(filePath: string): string {
    // Normalize separators to forward slash
    let normalized = filePath.replace(/\\/g, '/');

    // Resolve . and .. segments
    const parts: string[] = [];
    for (const segment of normalized.split('/')) {
      if (segment === '.' || segment === '') continue;
      if (segment === '..') {
        parts.pop();
      } else {
        parts.push(segment);
      }
    }
    normalized = parts.join('/');

    // Case-insensitive comparison (Windows is the primary target, safe on all platforms)
    return normalized.toLowerCase();
  }

  /** Build the composite key for the file tracker map. */
  private fileTrackerKey(workspaceId: string, normalizedPath: string): string {
    return `${workspaceId}:${normalizedPath}`;
  }

  private handleFileChangeReport(_ws: WebSocket, report: FileChangeReport): void {
    if (!this.session) return;

    this.log(`File change report: delivery ${report.deliveryId}, ${report.changes.length} changes in workspace ${report.workspaceId}`);

    // Resolve the agent participant info for this report
    const delivery = this.deliveries.get(report.deliveryId);
    if (!delivery) {
      this.log(`File change report: unknown delivery ${report.deliveryId}, ignoring`);
      return;
    }

    const agentParticipantId = report.agentParticipantId || delivery.agentParticipantId;
    const agent = this.participants.find(p => p.participantId === agentParticipantId);
    if (!agent) {
      this.log(`File change report: unknown agent ${agentParticipantId}, ignoring`);
      return;
    }

    const entry: FileTrackerEntry = {
      deliveryId: report.deliveryId,
      agentParticipantId,
      agentDisplayName: agent.displayName,
    };

    // Track each changed file and collect overlap candidates
    const overlappingPaths: string[] = [];

    for (const change of report.changes) {
      const normalizedPath = this.normalizeFilePath(change.path);
      const key = this.fileTrackerKey(report.workspaceId, normalizedPath);

      let entries = this.fileTracker.get(key);
      if (!entries) {
        entries = new Set();
        this.fileTracker.set(key, entries);
      }

      // Check for overlap: another delivery (different deliveryId) is modifying the same file
      let hasOverlap = false;
      for (const existing of entries) {
        if (existing.deliveryId !== report.deliveryId) {
          hasOverlap = true;
          break;
        }
      }

      // Add or update the entry for this delivery (avoid duplicates for same delivery)
      let alreadyTracked = false;
      for (const existing of entries) {
        if (existing.deliveryId === report.deliveryId) {
          alreadyTracked = true;
          break;
        }
      }
      if (!alreadyTracked) {
        entries.add(entry);
      }

      if (hasOverlap) {
        overlappingPaths.push(normalizedPath);
      }
    }

    // Persist the file change report
    this.persistence?.append('fcr', report);

    // If overlaps detected, build and broadcast a conflict warning
    if (overlappingPaths.length > 0) {
      this.broadcastFileConflictWarning(report.workspaceId, overlappingPaths);
    }
  }

  /**
   * Build a FileConflictWarning for the given workspace and overlapping paths,
   * then broadcast it to all connected humans.
   */
  private broadcastFileConflictWarning(workspaceId: string, overlappingPaths: string[]): void {
    if (!this.session) return;

    // Deduplicate paths
    const uniquePaths = [...new Set(overlappingPaths)];

    // Gather all deliveries involved in the conflicting paths
    const deliveryMap = new Map<string, { entry: FileTrackerEntry; paths: Set<string> }>();

    for (const normalizedPath of uniquePaths) {
      const key = this.fileTrackerKey(workspaceId, normalizedPath);
      const entries = this.fileTracker.get(key);
      if (!entries) continue;

      for (const entry of entries) {
        let record = deliveryMap.get(entry.deliveryId);
        if (!record) {
          record = { entry, paths: new Set() };
          deliveryMap.set(entry.deliveryId, record);
        }
        record.paths.add(normalizedPath);
      }
    }

    // Build the FileConflictDelivery array
    const conflictDeliveries: FileConflictDelivery[] = [];
    for (const [deliveryId, record] of deliveryMap) {
      conflictDeliveries.push({
        deliveryId,
        agentParticipantId: record.entry.agentParticipantId,
        agentDisplayName: record.entry.agentDisplayName,
        filePaths: [...record.paths],
      });
    }

    // Build a human-readable summary message
    const agentNames = conflictDeliveries.map(d => d.agentDisplayName);
    const message = `File conflict detected: ${agentNames.join(' and ')} are editing the same file(s): ${uniquePaths.join(', ')}`;

    const warning: FileConflictWarning = {
      conflictId: uuid(),
      sessionId: this.session.sessionId,
      workspaceId,
      filePaths: uniquePaths,
      deliveries: conflictDeliveries,
      createdAt: new Date().toISOString(),
      message,
    };

    this.activeConflicts.set(warning.conflictId, warning);
    this.persistence?.append('fconflict', warning);

    // Broadcast to all connected clients
    this.broadcast({ type: 'fileConflictWarning', warning });
    this.log(`File conflict warning: ${message}`);
  }

  /**
   * Remove all file tracker entries associated with a given delivery.
   * Called when a delivery reaches a terminal state.
   */
  private cleanupFileTrackerForDelivery(deliveryId: string): void {
    const keysToDelete: string[] = [];

    for (const [key, entries] of this.fileTracker) {
      for (const entry of entries) {
        if (entry.deliveryId === deliveryId) {
          entries.delete(entry);
          break; // At most one entry per deliveryId per key
        }
      }
      if (entries.size === 0) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.fileTracker.delete(key);
    }

    if (keysToDelete.length > 0 || this.fileTracker.size > 0) {
      this.log(`File tracker cleanup for delivery ${deliveryId}: removed from ${keysToDelete.length} file(s), ${this.fileTracker.size} tracked file(s) remaining`);
    }
  }

  // -- Delta Context --

  private getPromptFormatterDeps(): PromptFormatterDeps {
    return {
      participants: this.participants,
      transcript: this.transcript,
      seenState: this.seenState,
      renameEvents: this.renameEvents,
      agentMode: this.session?.agentMode ?? 'execute',
    };
  }

  private buildDeltaContext(agent: Participant, currentMessage: Message) {
    return buildDeltaContextFn(agent, currentMessage, this.getPromptFormatterDeps());
  }

  private formatAgentPrompt(
    agent: Participant,
    deltaContext: { startSeq: number; contextMessages: Message[]; renameNotices: string[] },
    currentMessage: Message,
  ): string {
    return formatAgentPromptFn(agent, deltaContext, currentMessage, this.getPromptFormatterDeps());
  }

  private escapeXml(text: string): string {
    return escapeXmlFn(text);
  }

  // -- Helpers --

  private findClientForAgent(agent: Participant): ConnectedClient | undefined {
    for (const client of this.clients.values()) {
      if (client.agentParticipantId === agent.participantId) {
        return client;
      }
    }
    return undefined;
  }

  private coalesceStreamingText(deliveryId: string, agentParticipantId: string, text: string): void {
    const existing = this.streamCoalesceBuffers.get(deliveryId);
    if (existing) {
      existing.accumulated += text;
    } else {
      this.streamCoalesceBuffers.set(deliveryId, { deliveryId, agentParticipantId, accumulated: text });
    }

    if (!this.streamCoalesceTimers.has(deliveryId)) {
      this.streamCoalesceTimers.set(deliveryId, setTimeout(() => {
        this.streamCoalesceTimers.delete(deliveryId);
        const buffer = this.streamCoalesceBuffers.get(deliveryId);
        if (buffer) {
          this.streamCoalesceBuffers.delete(deliveryId);
          this.broadcast({
            type: 'agentStreamingText',
            deliveryId: buffer.deliveryId,
            agentParticipantId: buffer.agentParticipantId,
            text: buffer.accumulated,
          });
        }
      }, 50));
    }
  }

  private flushStreamingBuffer(deliveryId: string): void {
    const timer = this.streamCoalesceTimers.get(deliveryId);
    if (timer) {
      clearTimeout(timer);
      this.streamCoalesceTimers.delete(deliveryId);
    }
    const buffer = this.streamCoalesceBuffers.get(deliveryId);
    if (buffer) {
      this.streamCoalesceBuffers.delete(deliveryId);
      this.broadcast({
        type: 'agentStreamingText',
        deliveryId: buffer.deliveryId,
        agentParticipantId: buffer.agentParticipantId,
        text: buffer.accumulated,
      });
    }
  }

  private sendToClient(ws: WebSocket, msg: ServerToClientMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private broadcast(msg: ServerToClientMessage): void {
    const data = JSON.stringify(msg);
    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    }
  }

  private broadcastExcept(excludeWs: WebSocket, msg: ServerToClientMessage): void {
    const data = JSON.stringify(msg);
    for (const client of this.clients.values()) {
      if (client.ws !== excludeWs && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    }
  }
}
