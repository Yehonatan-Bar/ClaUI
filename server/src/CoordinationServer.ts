import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { URL } from 'url';
import { v4 as uuid } from 'uuid';
import {
  Session, Participant, Message, AgentDelivery, AgentSeenState,
  DeliveryStatus, ClientToServerMessage, ServerToClientMessage, AgentEventPayload,
  AgentBusyPolicy, RenameEvent, TypingState, ParticipantActivityState,
  FileChangeReport, FileConflictWarning, FileConflictDelivery,
  ApprovalDecisionPayload, AgentLoopControlState, ApprovalEvent, ReactionSummary,
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
  sessionNumber: number;
  humanParticipantId: string;
  agentParticipantId: string;
}

/** Tracks a single agent's claim on a file within a delivery. */
interface FileTrackerEntry {
  deliveryId: string;
  agentParticipantId: string;
  agentDisplayName: string;
}

/** All per-session state isolated into a room. */
interface SessionRoom {
  session: Session;
  participants: Participant[];
  transcript: Message[];
  deliveries: Map<string, AgentDelivery>;
  seenState: Map<string, AgentSeenState>;
  loopController: LoopController;
  persistence: SessionPersistence | null;
  renameEvents: RenameEvent[];
  typingStates: Map<string, TypingState>;
  approvalHistory: ApprovalEvent[];
  a2aRoutingChain: Promise<void>;
  fileTracker: Map<string, Set<FileTrackerEntry>>;
  activeConflicts: Map<string, FileConflictWarning>;
  reactions: Map<string, Map<string, Set<string>>>;
  streamCoalesceTimers: Map<string, ReturnType<typeof setTimeout>>;
  streamCoalesceBuffers: Map<string, { deliveryId: string; agentParticipantId: string; accumulated: string }>;
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
  private rooms: Map<number, SessionRoom> = new Map();
  private clients: Map<WebSocket, ConnectedClient> = new Map();
  private guardService: GuardService;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private tokenAuthenticatedSockets = new WeakSet<WebSocket>();
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
  private publicSession(room: SessionRoom): Session {
    const { sessionPassword, ...safe } = room.session;
    return { ...safe, sessionPassword: null, hasPassword: !!sessionPassword } as unknown as Session;
  }

  /** Look up the room a client belongs to. */
  private getRoomForClient(ws: WebSocket): SessionRoom | undefined {
    const client = this.clients.get(ws);
    if (!client) return undefined;
    return this.rooms.get(client.sessionNumber);
  }

  private createRoom(sessionNumber: number, sessionName: string, password?: string): SessionRoom {
    const sessionId = uuid();
    const session: Session = {
      sessionId,
      sessionNumber,
      name: sessionName || `Session #${sessionNumber}`,
      createdAt: new Date().toISOString(),
      createdByParticipantId: '',
      status: 'active',
      nextSeq: 1,
      agentMode: 'execute',
      allowRemoteSteer: 'owner-only',
      sessionPassword: password || null,
    };

    const loopController = new LoopController(sessionId, this.log);

    let persistence: SessionPersistence | null = null;
    if (this.config.persistenceDir) {
      persistence = new SessionPersistence(this.config.persistenceDir, sessionId, this.log);
      persistence.init();
      persistence.append('init', { session });
    }

    const room: SessionRoom = {
      session,
      participants: [],
      transcript: [],
      deliveries: new Map(),
      seenState: new Map(),
      loopController,
      persistence,
      renameEvents: [],
      typingStates: new Map(),
      approvalHistory: [],
      a2aRoutingChain: Promise.resolve(),
      fileTracker: new Map(),
      activeConflicts: new Map(),
      reactions: new Map(),
      streamCoalesceTimers: new Map(),
      streamCoalesceBuffers: new Map(),
    };

    this.rooms.set(sessionNumber, room);
    this.log(`[Room ${sessionNumber}] Created session ${sessionId} "${session.name}"`);
    return room;
  }

  start(port: number): void {
    // Restore persisted sessions
    if (this.config.persistenceDir) {
      const allSessions = SessionPersistence.loadAllSessions(this.config.persistenceDir, this.log);
      for (const [sessionNumber, restored] of allSessions) {
        const offlineParticipants = restored.participants.map(p => ({ ...p, status: 'offline' as const }));
        const room: SessionRoom = {
          session: restored.session,
          participants: offlineParticipants,
          transcript: restored.transcript,
          deliveries: restored.deliveries,
          seenState: restored.seenState,
          loopController: new LoopController(restored.session.sessionId, this.log),
          persistence: null,
          renameEvents: restored.renameEvents,
          typingStates: new Map(),
          approvalHistory: restored.approvals,
          a2aRoutingChain: Promise.resolve(),
          fileTracker: new Map(),
          activeConflicts: new Map(),
          reactions: new Map(),
          streamCoalesceTimers: new Map(),
          streamCoalesceBuffers: new Map(),
        };

        if (restored.loopState) {
          room.loopController.restoreState(restored.loopState);
        }

        if (this.config.persistenceDir) {
          room.persistence = new SessionPersistence(
            this.config.persistenceDir, restored.session.sessionId, this.log,
          );
          room.persistence.init();
        }

        this.rooms.set(sessionNumber, room);
        this.log(`Restored room ${sessionNumber}: session ${restored.session.sessionId} "${restored.session.name}" with ${restored.transcript.length} messages, ${offlineParticipants.length} participants (offline)`);
      }
    }

    const verifyClient = this.config.sessionToken
      ? (info: { req: IncomingMessage }): boolean => {
          const rawUrl = info.req.url || '/';
          const reqUrl = new URL(rawUrl, `http://localhost:${port}`);
          const clientToken = reqUrl.searchParams.get('token');
          if (clientToken !== this.config.sessionToken) {
            const detail = clientToken === null
              ? 'no token param in URL'
              : `token length ${clientToken.length} vs expected ${this.config.sessionToken!.length}`;
            this.log(`Connection rejected: ${detail} from ${info.req.socket.remoteAddress} (url path: ${reqUrl.pathname})`);
            return false;
          }
          return true;
        }
      : undefined;

    this.wss = new WebSocketServer({ port, verifyClient });
    this.log(`Coordination server listening on port ${port}`);
    this.log(`Active rooms: ${this.rooms.size}`);
    if (this.config.sessionToken) {
      this.log('Token authentication enabled');
    }

    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));

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
    for (const room of this.rooms.values()) {
      for (const timer of room.streamCoalesceTimers.values()) {
        clearTimeout(timer);
      }
      room.streamCoalesceTimers.clear();
      room.streamCoalesceBuffers.clear();
      room.persistence?.close();
    }
    if (this.wss) {
      for (const client of this.clients.keys()) {
        client.close();
      }
      this.wss.close();
      this.wss = null;
      this.log('Coordination server stopped');
    }
  }

  private handleConnection(ws: WebSocket, req?: IncomingMessage): void {
    if (this.config.sessionToken && req?.url) {
      const reqUrl = new URL(req.url, 'http://localhost');
      if (reqUrl.searchParams.get('token') === this.config.sessionToken) {
        this.tokenAuthenticatedSockets.add(ws);
      }
    }
    this.log('New WebSocket connection' + (this.tokenAuthenticatedSockets.has(ws) ? ' (token-auth)' : ''));

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
      case 'createSession':
        this.handleCreate(ws, msg.sessionNumber, msg.sessionName, msg.humanName, msg.agentName, msg.agentProvider, msg.agentModel, msg.password);
        break;
      case 'joinSession':
        this.handleJoin(ws, msg.sessionNumber, msg.humanName, msg.agentName, msg.agentProvider, msg.agentModel, msg.password);
        break;
      case 'rejoinSession':
        this.handleRejoin(ws, msg.sessionNumber, msg.humanParticipantId, msg.agentParticipantId, msg.lastSeenSeq);
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
      case 'addReaction':
        this.handleAddReaction(ws, msg.messageId, msg.emoji);
        break;
      case 'removeReaction':
        this.handleRemoveReaction(ws, msg.messageId, msg.emoji);
        break;
      case 'leaveSession':
        this.handleLeave(ws);
        break;
      case 'resetSession':
        this.handleResetSession(ws);
        break;
      case 'pong':
        break;
    }
  }

  // -- Create / Join / Leave --

  private handleCreate(ws: WebSocket, sessionNumber: number, sessionName: string, humanName: string, agentName: string, agentProvider: 'claude' | 'codex', agentModel?: string, password?: string): void {
    if (this.rooms.has(sessionNumber)) {
      this.sendToClient(ws, { type: 'joinRejected', reason: `Session number ${sessionNumber} already exists` });
      this.log(`[Room ${sessionNumber}] Create rejected: session number already in use`);
      return;
    }

    const room = this.createRoom(sessionNumber, sessionName, password);
    if (password) {
      this.log(`[Room ${sessionNumber}] Password set by session creator`);
    }

    this.addParticipantToRoom(ws, room, sessionNumber, humanName, agentName, agentProvider, agentModel, true);
  }

  private handleJoin(ws: WebSocket, sessionNumber: number, humanName: string, agentName: string, agentProvider: 'claude' | 'codex', agentModel?: string, password?: string): void {
    const room = this.rooms.get(sessionNumber);
    if (!room) {
      this.sendToClient(ws, { type: 'joinRejected', reason: `No session found with number ${sessionNumber}` });
      this.log(`[Room ${sessionNumber}] Join rejected: session not found`);
      return;
    }

    if (room.session.sessionPassword) {
      const isTokenAuth = this.tokenAuthenticatedSockets.has(ws);
      if (!isTokenAuth && (!password || password !== room.session.sessionPassword)) {
        this.sendToClient(ws, { type: 'joinRejected', reason: 'Invalid session password' });
        this.log(`[Room ${sessionNumber}] Join rejected: invalid password from ${humanName}`);
        return;
      }
      if (isTokenAuth && (!password || password !== room.session.sessionPassword)) {
        this.log(`[Room ${sessionNumber}] Password bypassed via token auth for ${humanName}`);
      }
    }

    this.addParticipantToRoom(ws, room, sessionNumber, humanName, agentName, agentProvider, agentModel, false);
  }

  private addParticipantToRoom(ws: WebSocket, room: SessionRoom, sessionNumber: number, humanName: string, agentName: string, agentProvider: 'claude' | 'codex', agentModel?: string, isCreator?: boolean): void {
    try {
      const humanValidated = validateParticipantName(humanName, room.participants);
      const tempHumanParticipant: Participant = {
        participantId: uuid(),
        sessionId: room.session.sessionId,
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

      const agentValidated = validateParticipantName(agentName, [...room.participants, tempHumanParticipant]);
      const agentParticipant: Participant = {
        participantId: uuid(),
        sessionId: room.session.sessionId,
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

      if (isCreator) {
        room.session.createdByParticipantId = tempHumanParticipant.participantId;
        room.persistence?.append('session-update', {
          createdByParticipantId: tempHumanParticipant.participantId,
        });
      }

      room.participants.push(tempHumanParticipant, agentParticipant);

      const agentSeen: AgentSeenState = {
        agentParticipantId: agentParticipant.participantId,
        sessionId: room.session.sessionId,
        lastAckedDeliveredSeq: 0,
        lastDeliveryId: null,
        updatedAt: new Date().toISOString(),
      };
      room.seenState.set(agentParticipant.participantId, agentSeen);

      this.clients.set(ws, {
        ws,
        sessionNumber,
        humanParticipantId: tempHumanParticipant.participantId,
        agentParticipantId: agentParticipant.participantId,
      });

      room.persistence?.append('join', {
        human: tempHumanParticipant,
        agent: agentParticipant,
        agentSeen,
      });

      this.sendToClient(ws, {
        type: 'sessionState',
        session: this.publicSession(room),
        participants: room.participants,
        transcript: room.transcript,
        loopControlState: room.loopController.getState(),
        approvals: room.approvalHistory.filter(a => a.decision === null),
        typingStates: [...room.typingStates.values()],
        fileConflicts: room.activeConflicts.size > 0
          ? [...room.activeConflicts.values()]
          : undefined,
        reactions: this.buildAllReactions(room),
      });

      this.broadcastToRoomExcept(room, ws, { type: 'participantJoined', participant: tempHumanParticipant });
      this.broadcastToRoomExcept(room, ws, { type: 'participantJoined', participant: agentParticipant });

      this.log(`[Room ${sessionNumber}] ${isCreator ? 'Created' : 'Joined'}: ${humanName} (human) + ${agentName} (${agentProvider} agent)`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.sendToClient(ws, { type: 'joinRejected', reason });
      this.log(`[Room ${sessionNumber}] Join rejected: ${reason}`);
      if (isCreator && room.participants.length === 0) {
        room.persistence?.close();
        this.rooms.delete(sessionNumber);
        this.log(`[Room ${sessionNumber}] Cleaned up empty new room after join failure`);
      }
    }
  }

  private handleRejoin(ws: WebSocket, sessionNumber: number, humanParticipantId: string, agentParticipantId: string, lastSeenSeq: number): void {
    const room = this.rooms.get(sessionNumber);
    if (!room) {
      this.sendToClient(ws, { type: 'rejoinRejected', reason: `No active session for room ${sessionNumber}` });
      return;
    }

    const human = room.participants.find(p => p.participantId === humanParticipantId);
    const agent = room.participants.find(p => p.participantId === agentParticipantId);

    if (!human || !agent) {
      this.sendToClient(ws, { type: 'rejoinRejected', reason: 'Participant IDs not found in session' });
      return;
    }

    for (const [oldWs, client] of this.clients.entries()) {
      if (client.humanParticipantId === humanParticipantId) {
        this.clients.delete(oldWs);
        break;
      }
    }

    human.status = 'online';
    agent.status = 'online';

    this.clients.set(ws, { ws, sessionNumber, humanParticipantId, agentParticipantId });

    const deltaTranscript = room.transcript.filter(m => m.seq > lastSeenSeq);

    this.sendToClient(ws, {
      type: 'rejoinAccepted',
      session: this.publicSession(room),
      participants: room.participants,
      deltaTranscript,
      lastSeenSeq,
      reactions: this.buildAllReactions(room),
    });

    this.broadcastToRoomExcept(room, ws, { type: 'participantStatusChange', participantId: humanParticipantId, status: 'online' });
    this.broadcastToRoomExcept(room, ws, { type: 'participantStatusChange', participantId: agentParticipantId, status: 'online' });

    room.persistence?.append('pstat', { participantId: humanParticipantId, status: 'online' });
    room.persistence?.append('pstat', { participantId: agentParticipantId, status: 'online' });

    this.log(`[Room ${sessionNumber}] Rejoined: ${human.displayName} (${deltaTranscript.length} missed messages)`);
  }

  private handleLeave(ws: WebSocket): void {
    const client = this.clients.get(ws);
    if (!client) return;

    const room = this.rooms.get(client.sessionNumber);
    if (!room) return;

    const human = room.participants.find(p => p.participantId === client.humanParticipantId);
    const agent = room.participants.find(p => p.participantId === client.agentParticipantId);

    if (human) {
      this.broadcastToRoom(room, { type: 'participantLeft', participantId: human.participantId });
      room.persistence?.append('leave', { participantId: human.participantId });
    }
    if (agent) {
      this.broadcastToRoom(room, { type: 'participantLeft', participantId: agent.participantId });
      room.persistence?.append('leave', { participantId: agent.participantId });
    }

    room.participants = room.participants.filter(
      p => p.participantId !== client.humanParticipantId && p.participantId !== client.agentParticipantId
    );
    this.clients.delete(ws);
    this.log(`[Room ${client.sessionNumber}] Left: ${human?.displayName || 'unknown'} (participants remaining: ${room.participants.length})`);
  }

  private handleDisconnect(ws: WebSocket): void {
    const client = this.clients.get(ws);
    if (!client) return;

    const room = this.rooms.get(client.sessionNumber);
    if (!room) {
      this.clients.delete(ws);
      return;
    }

    const human = room.participants.find(p => p.participantId === client.humanParticipantId);
    const agent = room.participants.find(p => p.participantId === client.agentParticipantId);

    if (human) {
      this.broadcastToRoomExcept(room, ws, { type: 'participantLeft', participantId: human.participantId });
      room.persistence?.append('leave', { participantId: human.participantId });
    }
    if (agent) {
      this.broadcastToRoomExcept(room, ws, { type: 'participantLeft', participantId: agent.participantId });
      room.persistence?.append('leave', { participantId: agent.participantId });
    }

    room.participants = room.participants.filter(
      p => p.participantId !== client.humanParticipantId && p.participantId !== client.agentParticipantId
    );
    this.clients.delete(ws);
    this.log(`[Room ${client.sessionNumber}] Disconnected: ${human?.displayName || 'unknown'} (participants remaining: ${room.participants.length})`);
  }

  // -- Reset Session --

  private handleResetSession(ws: WebSocket): void {
    const client = this.clients.get(ws);
    if (!client) return;

    const room = this.rooms.get(client.sessionNumber);
    if (!room) return;

    this.log(`[Room ${client.sessionNumber}] Session reset requested by ${client.humanParticipantId}`);

    room.persistence?.close();

    const newSessionId = uuid();
    room.session = {
      sessionId: newSessionId,
      sessionNumber: room.session.sessionNumber,
      name: room.session.name,
      createdAt: new Date().toISOString(),
      createdByParticipantId: client.humanParticipantId,
      status: 'active',
      nextSeq: 1,
      agentMode: 'execute',
      allowRemoteSteer: 'owner-only',
      sessionPassword: room.session.sessionPassword,
    };

    room.transcript = [];
    room.deliveries.clear();
    room.seenState.clear();
    room.renameEvents = [];
    room.typingStates.clear();
    room.approvalHistory = [];
    room.fileTracker.clear();
    room.activeConflicts.clear();
    room.reactions.clear();

    for (const timer of room.streamCoalesceTimers.values()) {
      clearTimeout(timer);
    }
    room.streamCoalesceTimers.clear();
    room.streamCoalesceBuffers.clear();

    room.loopController = new LoopController(newSessionId, this.log);

    for (const p of room.participants) {
      p.sessionId = newSessionId;
    }

    for (const p of room.participants) {
      if (p.kind === 'agent') {
        room.seenState.set(p.participantId, {
          agentParticipantId: p.participantId,
          sessionId: newSessionId,
          lastAckedDeliveredSeq: 0,
          lastDeliveryId: null,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    if (this.config.persistenceDir) {
      room.persistence = new SessionPersistence(
        this.config.persistenceDir, newSessionId, this.log,
      );
      room.persistence.init();
      room.persistence.append('init', { session: room.session });
      for (const c of this.clients.values()) {
        if (c.sessionNumber !== client.sessionNumber) continue;
        const human = room.participants.find(p => p.participantId === c.humanParticipantId);
        const agent = room.participants.find(p => p.participantId === c.agentParticipantId);
        if (human && agent) {
          room.persistence.append('join', { human, agent });
        }
      }
    }

    this.broadcastToRoom(room, {
      type: 'sessionReset',
      session: this.publicSession(room),
      participants: room.participants,
    });

    this.log(`[Room ${client.sessionNumber}] Session reset complete: new session ${newSessionId}`);
  }

  // -- Emoji Reactions --

  private handleAddReaction(ws: WebSocket, messageId: string, emoji: string): void {
    const client = this.clients.get(ws);
    if (!client) return;

    const room = this.rooms.get(client.sessionNumber);
    if (!room) return;

    const participantId = client.humanParticipantId;

    if (!room.reactions.has(messageId)) {
      room.reactions.set(messageId, new Map());
    }
    const msgReactions = room.reactions.get(messageId)!;
    if (!msgReactions.has(emoji)) {
      msgReactions.set(emoji, new Set());
    }
    msgReactions.get(emoji)!.add(participantId);

    const summary = this.buildReactionSummary(room, messageId);
    this.broadcastToRoom(room, { type: 'reactionUpdate', messageId, reactions: summary });

    room.persistence?.append('reaction', { messageId, emoji, participantId, action: 'add' });
  }

  private handleRemoveReaction(ws: WebSocket, messageId: string, emoji: string): void {
    const client = this.clients.get(ws);
    if (!client) return;

    const room = this.rooms.get(client.sessionNumber);
    if (!room) return;

    const participantId = client.humanParticipantId;

    const msgReactions = room.reactions.get(messageId);
    if (!msgReactions) return;

    const emojiSet = msgReactions.get(emoji);
    if (!emojiSet) return;

    emojiSet.delete(participantId);
    if (emojiSet.size === 0) msgReactions.delete(emoji);
    if (msgReactions.size === 0) room.reactions.delete(messageId);

    const summary = this.buildReactionSummary(room, messageId);
    this.broadcastToRoom(room, { type: 'reactionUpdate', messageId, reactions: summary });

    room.persistence?.append('reaction', { messageId, emoji, participantId, action: 'remove' });
  }

  private buildReactionSummary(room: SessionRoom, messageId: string): ReactionSummary[] {
    const msgReactions = room.reactions.get(messageId);
    if (!msgReactions) return [];
    const result: ReactionSummary[] = [];
    for (const [emoji, pids] of msgReactions) {
      result.push({ emoji, count: pids.size, participantIds: [...pids] });
    }
    return result;
  }

  private buildAllReactions(room: SessionRoom): Record<string, ReactionSummary[]> | undefined {
    if (room.reactions.size === 0) return undefined;
    const result: Record<string, ReactionSummary[]> = {};
    for (const [messageId, _] of room.reactions) {
      const summary = this.buildReactionSummary(room, messageId);
      if (summary.length > 0) result[messageId] = summary;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }

  // -- Human Message --

  private handleHumanMessage(ws: WebSocket, rawBody: string): void {
    const client = this.clients.get(ws);
    if (!client) return;

    const room = this.rooms.get(client.sessionNumber);
    if (!room) return;

    const author = room.participants.find(p => p.participantId === client.humanParticipantId);
    if (!author) return;

    const route = routeMessage(rawBody, room.participants);

    const seq = room.session.nextSeq++;
    const message: Message = {
      messageId: uuid(),
      sessionId: room.session.sessionId,
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

    room.transcript.push(message);
    room.persistence?.append('msg', message);
    this.log(`[Room ${client.sessionNumber}] Message #${seq} from ${author.displayName}: "${rawBody.substring(0, 80)}..."`);

    this.broadcastActivity(room, author.participantId, 'idle');
    this.broadcastToRoom(room, { type: 'newMessage', message });

    if (route.recipientParticipantId) {
      const recipient = room.participants.find(p => p.participantId === route.recipientParticipantId);
      if (recipient && recipient.kind === 'agent') {
        room.loopController.resetOnHumanIntervention();
        room.persistence?.append('loop', room.loopController.getState());
        this.deliverToAgent(room, recipient, message);
      }
    }
  }

  // -- Agent Delivery --

  private deliverToAgent(room: SessionRoom, agent: Participant, triggerMessage: Message): void {
    const deliveryId = uuid();
    const deltaContext = this.buildDeltaContext(room, agent, triggerMessage);
    const prompt = this.formatAgentPrompt(room, agent, deltaContext, triggerMessage);

    const ownerClient = this.findClientForAgent(room, agent);
    let busyPolicy: AgentBusyPolicy | null = 'direct';
    if (agent.provider === 'codex') {
      busyPolicy = 'codex-auto-steer';
    }

    const delivery: AgentDelivery = {
      deliveryId,
      sessionId: room.session.sessionId,
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

    room.deliveries.set(deliveryId, delivery);
    room.persistence?.append('dlv', delivery);

    triggerMessage.deliveryId = deliveryId;
    triggerMessage.agentTurnStatus = 'pending';

    if (!ownerClient || agent.status === 'offline') {
      delivery.status = 'not_delivered';
      delivery.notDeliveredReason = 'agent-offline';
      triggerMessage.agentTurnStatus = 'not_delivered';
      room.persistence?.append('dlv', delivery);
      this.broadcastToRoom(room, {
        type: 'deliveryStatusUpdate',
        deliveryId,
        agentParticipantId: agent.participantId,
        agentDisplayName: agent.displayName,
        status: 'not_delivered',
      });
      this.log(`[Room ${room.session.sessionNumber}] Delivery ${deliveryId}: agent ${agent.displayName} is offline, not delivered`);
      return;
    }

    this.sendToClient(ownerClient.ws, {
      type: 'deliverPrompt',
      deliveryId,
      agentParticipantId: agent.participantId,
      prompt,
      busyPolicy,
    });

    this.broadcastToRoom(room, {
      type: 'deliveryStatusUpdate',
      deliveryId,
      agentParticipantId: agent.participantId,
      agentDisplayName: agent.displayName,
      status: 'pending',
    });

    this.log(`[Room ${room.session.sessionNumber}] Delivery ${deliveryId}: sent to ${agent.displayName} (${agent.provider}), busyPolicy=${busyPolicy}`);
  }

  // -- Agent Events --

  private handleAgentEvent(ws: WebSocket, deliveryId: string, event: AgentEventPayload): void {
    const client = this.clients.get(ws);
    if (!client) return;

    const room = this.rooms.get(client.sessionNumber);
    if (!room) return;

    const delivery = room.deliveries.get(deliveryId);
    if (!delivery) return;

    const agent = room.participants.find(p => p.participantId === delivery.agentParticipantId);
    if (!agent) return;

    switch (event.kind) {
      case 'accepted': {
        delivery.status = 'acknowledged';
        delivery.acknowledgedAt = new Date().toISOString();
        const seen = room.seenState.get(agent.participantId);
        if (seen) {
          seen.lastAckedDeliveredSeq = delivery.contextEndSeq;
          seen.lastDeliveryId = deliveryId;
          seen.updatedAt = new Date().toISOString();
          room.persistence?.append('seen', seen);
        }
        room.persistence?.append('dlv', delivery);
        this.broadcastToRoom(room, {
          type: 'deliveryStatusUpdate',
          deliveryId,
          agentParticipantId: agent.participantId,
          agentDisplayName: agent.displayName,
          status: 'acknowledged',
        });
        this.broadcastActivity(room, agent.participantId, 'thinking');
        this.log(`[Room ${client.sessionNumber}] Delivery ${deliveryId}: acknowledged by ClaUi`);
        break;
      }

      case 'rejected': {
        delivery.status = 'failed';
        delivery.errorText = event.error;
        room.persistence?.append('dlv', delivery);
        this.broadcastToRoom(room, {
          type: 'deliveryStatusUpdate',
          deliveryId,
          agentParticipantId: agent.participantId,
          agentDisplayName: agent.displayName,
          status: 'failed',
          errorText: event.error,
        });
        this.broadcastActivity(room, agent.participantId, 'idle');
        this.cleanupFileTrackerForDelivery(room, deliveryId);
        this.log(`[Room ${client.sessionNumber}] Delivery ${deliveryId}: rejected - ${event.error}`);
        break;
      }

      case 'started': {
        delivery.status = 'running';
        delivery.startedAt = new Date().toISOString();
        room.persistence?.append('dlv', delivery);
        this.broadcastToRoom(room, {
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
        room.persistence?.append('dlv', delivery);
        this.broadcastToRoom(room, {
          type: 'deliveryStatusUpdate',
          deliveryId,
          agentParticipantId: agent.participantId,
          agentDisplayName: agent.displayName,
          status: 'streaming',
        });
        this.broadcastActivity(room, agent.participantId, 'streaming');
        break;
      }

      case 'textDelta': {
        this.coalesceStreamingText(room, deliveryId, agent.participantId, event.text);
        break;
      }

      case 'completed': {
        this.flushStreamingBuffer(room, deliveryId);
        delivery.status = 'completed';
        delivery.completedAt = new Date().toISOString();

        const route = routeMessage(event.fullText, room.participants);

        // When the runner separated narration from the final answer, route the
        // answer alone to strip its addressing prefix for a clean display body.
        let answerBody: string | null = null;
        let thinkingBody: string | null = null;
        if (event.answerText && event.thinkingText) {
          answerBody = routeMessage(event.answerText, room.participants).parsedBody;
          thinkingBody = event.thinkingText;
        }

        const seq = room.session.nextSeq++;
        const responseMessage: Message = {
          messageId: uuid(),
          sessionId: room.session.sessionId,
          seq,
          authorParticipantId: agent.participantId,
          recipientParticipantId: route.recipientParticipantId,
          rawBody: event.fullText,
          parsedBody: route.parsedBody,
          routePrefix: route.routePrefix,
          answerBody,
          thinkingBody,
          createdAt: new Date().toISOString(),
          displayNameSnapshot: agent.displayName,
          deliveryId: null,
          agentTurnStatus: null,
          triggerMessageId: delivery.triggerMessageId,
          triggerDeliveryId: deliveryId,
        };
        room.transcript.push(responseMessage);
        delivery.responseMessageId = responseMessage.messageId;

        room.persistence?.append('msg', responseMessage);
        room.persistence?.append('dlv', delivery);

        this.broadcastToRoom(room, { type: 'newMessage', message: responseMessage });
        this.broadcastToRoom(room, {
          type: 'deliveryStatusUpdate',
          deliveryId,
          agentParticipantId: agent.participantId,
          agentDisplayName: agent.displayName,
          status: 'completed',
        });
        this.broadcastActivity(room, agent.participantId, 'idle');
        this.cleanupFileTrackerForDelivery(room, deliveryId);

        if (route.recipientParticipantId) {
          const recipient = room.participants.find(p => p.participantId === route.recipientParticipantId);
          if (recipient && recipient.kind === 'agent') {
            room.a2aRoutingChain = room.a2aRoutingChain
              .then(() => this.handleAgentToAgentRouting(room, agent, recipient, responseMessage))
              .catch(err => this.log(`[Room ${client.sessionNumber}] Error in A2A routing: ${err}`));
          } else if (recipient && recipient.kind === 'agent') {
            this.deliverToAgent(room, recipient, responseMessage);
          }
        }

        this.log(`[Room ${client.sessionNumber}] Delivery ${deliveryId}: completed, response #${seq} (${event.fullText.length} chars)`);
        break;
      }

      case 'failed': {
        this.flushStreamingBuffer(room, deliveryId);
        delivery.status = 'failed';
        delivery.errorText = event.error;
        delivery.completedAt = new Date().toISOString();
        room.persistence?.append('dlv', delivery);
        this.broadcastToRoom(room, {
          type: 'deliveryStatusUpdate',
          deliveryId,
          agentParticipantId: agent.participantId,
          agentDisplayName: agent.displayName,
          status: 'failed',
          errorText: event.error,
        });
        this.broadcastActivity(room, agent.participantId, 'idle');
        this.cleanupFileTrackerForDelivery(room, deliveryId);
        this.log(`[Room ${client.sessionNumber}] Delivery ${deliveryId}: failed - ${event.error}`);
        break;
      }

      case 'interrupted': {
        this.flushStreamingBuffer(room, deliveryId);
        delivery.status = 'interrupted';
        delivery.interruptedByDeliveryId = event.interruptedByDeliveryId;
        delivery.completedAt = new Date().toISOString();
        room.persistence?.append('dlv', delivery);
        this.broadcastToRoom(room, {
          type: 'deliveryStatusUpdate',
          deliveryId,
          agentParticipantId: agent.participantId,
          agentDisplayName: agent.displayName,
          status: 'interrupted',
          interruptedByDeliveryId: event.interruptedByDeliveryId,
        });
        this.cleanupFileTrackerForDelivery(room, deliveryId);
        this.log(`[Room ${client.sessionNumber}] Delivery ${deliveryId}: interrupted by ${event.interruptedByDeliveryId}`);
        break;
      }
    }
  }

  private handleAgentStatus(ws: WebSocket, status: 'online' | 'offline'): void {
    const client = this.clients.get(ws);
    if (!client) return;

    const room = this.rooms.get(client.sessionNumber);
    if (!room) return;

    const agent = room.participants.find(p => p.participantId === client.agentParticipantId);
    if (!agent) return;

    agent.status = status;
    room.persistence?.append('pstat', { participantId: agent.participantId, status });
    this.broadcastToRoom(room, {
      type: 'participantStatusChange',
      participantId: agent.participantId,
      status,
    });
    this.log(`[Room ${client.sessionNumber}] Agent ${agent.displayName} status: ${status}`);
  }

  // -- Agent-to-Agent Loop Protection --

  private async handleAgentToAgentRouting(
    room: SessionRoom,
    sourceAgent: Participant,
    targetAgent: Participant,
    responseMessage: Message,
  ): Promise<void> {
    const result = room.loopController.processA2A(
      room.session.sessionId,
      sourceAgent,
      targetAgent,
      responseMessage,
    );

    switch (result.action) {
      case 'deliver': {
        room.persistence?.append('loop', room.loopController.getState());
        this.deliverToAgent(room, targetAgent, responseMessage);
        break;
      }

      case 'pause': {
        room.approvalHistory.push(result.approval);
        room.persistence?.append('appr', result.approval);
        room.persistence?.append('loop', room.loopController.getState());

        this.broadcastToRoom(room, {
          type: 'agentToAgentApproval',
          approval: result.approval,
          pendingMessage: responseMessage,
          sourceAgent,
          targetAgent,
        });
        this.broadcastToRoom(room, {
          type: 'a2aPendingApproval',
          approval: result.approval,
          pendingMessageId: responseMessage.messageId,
          sourceAgentId: sourceAgent.participantId,
          targetAgentId: targetAgent.participantId,
        });
        this.log(`[Room ${room.session.sessionNumber}] A2A paused: ${sourceAgent.displayName} -> ${targetAgent.displayName}, approval ${result.approval.eventId}`);
        break;
      }

      case 'guard-check': {
        const agents = room.participants.filter(p => p.kind === 'agent');
        const recentMessages = room.transcript.slice(-5);

        const guardResult = await this.guardService.check(
          room.session.name,
          agents,
          room.loopController.getState(),
          recentMessages,
          room.participants,
        );

        if (guardResult === 'continue') {
          room.loopController.advanceGuardCheckpoint();
          room.persistence?.append('loop', room.loopController.getState());
          this.deliverToAgent(room, targetAgent, responseMessage);
        } else {
          const approval = room.loopController.createGuardPauseApproval(
            room.session.sessionId,
            sourceAgent,
            targetAgent,
            responseMessage,
          );
          room.approvalHistory.push(approval);
          room.persistence?.append('appr', approval);
          room.persistence?.append('loop', room.loopController.getState());

          const lastMessages = room.transcript.slice(-5);
          this.broadcastToRoom(room, {
            type: 'guardStop',
            approval,
            reason: 'Guard model detected potential unproductive loop',
            lastMessages,
          });
          this.broadcastToRoom(room, {
            type: 'agentToAgentApproval',
            approval,
            pendingMessage: responseMessage,
            sourceAgent,
            targetAgent,
          });
          this.log(`[Room ${room.session.sessionNumber}] Guard STOP: ${sourceAgent.displayName} -> ${targetAgent.displayName}`);
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
    if (!client) return;

    const room = this.rooms.get(client.sessionNumber);
    if (!room) return;

    const result = room.loopController.processApprovalDecision(
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

    room.persistence?.append('appr', approval);
    room.persistence?.append('loop', room.loopController.getState());

    if (decision.type === 'deny') {
      this.broadcastToRoom(room, {
        type: 'approvalResolved',
        approval,
        decision,
        decidedByParticipantId: client.humanParticipantId,
        deniedReason: 'Human denied agent-to-agent delivery',
      });
      this.log(`[Room ${client.sessionNumber}] A2A denied: approval ${eventId}`);
    } else {
      this.broadcastToRoom(room, {
        type: 'approvalResolved',
        approval,
        decision,
        decidedByParticipantId: client.humanParticipantId,
      });
      this.deliverToAgent(room, targetAgent, pendingMessage);
      this.log(`[Room ${client.sessionNumber}] A2A approved (${decision.type}): approval ${eventId}`);
    }
  }

  // -- Typing Indicators --

  private handleTypingIndicator(
    ws: WebSocket,
    state: 'idle' | 'typing',
  ): void {
    const client = this.clients.get(ws);
    if (!client) return;

    const room = this.rooms.get(client.sessionNumber);
    if (!room) return;

    const human = room.participants.find(p => p.participantId === client.humanParticipantId);
    if (!human) return;

    this.broadcastActivity(room, human.participantId, state, ws);
  }

  private broadcastActivity(
    room: SessionRoom,
    participantId: string,
    state: ParticipantActivityState,
    excludeWs?: WebSocket,
  ): void {
    const now = new Date().toISOString();
    room.typingStates.set(participantId, { participantId, state, updatedAt: now });

    const msg: ServerToClientMessage = {
      type: 'participantActivity',
      activity: { participantId, state, updatedAt: now },
    };

    if (excludeWs) {
      this.broadcastToRoomExcept(room, excludeWs, msg);
    } else {
      this.broadcastToRoom(room, msg);
    }
  }

  // -- Rename --

  private handleRename(
    ws: WebSocket,
    participantId: string,
    newDisplayName: string,
  ): void {
    const client = this.clients.get(ws);
    if (!client) return;

    const room = this.rooms.get(client.sessionNumber);
    if (!room) return;

    if (participantId !== client.humanParticipantId && participantId !== client.agentParticipantId) {
      this.sendToClient(ws, {
        type: 'renameRejected',
        participantId,
        requestedDisplayName: newDisplayName,
        reason: 'Can only rename your own participants',
      });
      return;
    }

    const participant = room.participants.find(p => p.participantId === participantId);
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
      const validated = validateParticipantName(newDisplayName, room.participants, participantId);

      const renameEvent: RenameEvent = {
        eventId: uuid(),
        sessionId: room.session.sessionId,
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

      room.renameEvents.push(renameEvent);
      room.persistence?.append('rename', { event: renameEvent, participant });

      this.broadcastToRoom(room, {
        type: 'participantRenamed',
        event: renameEvent,
        participant,
      });

      this.log(`[Room ${client.sessionNumber}] Renamed: ${renameEvent.oldDisplayName} -> ${renameEvent.newDisplayName}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.sendToClient(ws, {
        type: 'renameRejected',
        participantId,
        requestedDisplayName: newDisplayName,
        reason,
      });
      this.log(`[Room ${client.sessionNumber}] Rename rejected: ${reason}`);
    }
  }

  // -- File Change Reports & Overlap Detection --

  private normalizeFilePath(filePath: string): string {
    let normalized = filePath.replace(/\\/g, '/');
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
    return normalized.toLowerCase();
  }

  private fileTrackerKey(workspaceId: string, normalizedPath: string): string {
    return `${workspaceId}:${normalizedPath}`;
  }

  private handleFileChangeReport(_ws: WebSocket, report: FileChangeReport): void {
    const client = this.clients.get(_ws);
    if (!client) return;

    const room = this.rooms.get(client.sessionNumber);
    if (!room) return;

    this.log(`[Room ${client.sessionNumber}] File change report: delivery ${report.deliveryId}, ${report.changes.length} changes in workspace ${report.workspaceId}`);

    const delivery = room.deliveries.get(report.deliveryId);
    if (!delivery) {
      this.log(`[Room ${client.sessionNumber}] File change report: unknown delivery ${report.deliveryId}, ignoring`);
      return;
    }

    const agentParticipantId = report.agentParticipantId || delivery.agentParticipantId;
    const agent = room.participants.find(p => p.participantId === agentParticipantId);
    if (!agent) {
      this.log(`[Room ${client.sessionNumber}] File change report: unknown agent ${agentParticipantId}, ignoring`);
      return;
    }

    const entry: FileTrackerEntry = {
      deliveryId: report.deliveryId,
      agentParticipantId,
      agentDisplayName: agent.displayName,
    };

    const overlappingPaths: string[] = [];

    for (const change of report.changes) {
      const normalizedPath = this.normalizeFilePath(change.path);
      const key = this.fileTrackerKey(report.workspaceId, normalizedPath);

      let entries = room.fileTracker.get(key);
      if (!entries) {
        entries = new Set();
        room.fileTracker.set(key, entries);
      }

      let hasOverlap = false;
      for (const existing of entries) {
        if (existing.deliveryId !== report.deliveryId) {
          hasOverlap = true;
          break;
        }
      }

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

    room.persistence?.append('fcr', report);

    if (overlappingPaths.length > 0) {
      this.broadcastFileConflictWarning(room, report.workspaceId, overlappingPaths);
    }
  }

  private broadcastFileConflictWarning(room: SessionRoom, workspaceId: string, overlappingPaths: string[]): void {
    const uniquePaths = [...new Set(overlappingPaths)];

    const deliveryMap = new Map<string, { entry: FileTrackerEntry; paths: Set<string> }>();

    for (const normalizedPath of uniquePaths) {
      const key = this.fileTrackerKey(workspaceId, normalizedPath);
      const entries = room.fileTracker.get(key);
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

    const conflictDeliveries: FileConflictDelivery[] = [];
    for (const [deliveryId, record] of deliveryMap) {
      conflictDeliveries.push({
        deliveryId,
        agentParticipantId: record.entry.agentParticipantId,
        agentDisplayName: record.entry.agentDisplayName,
        filePaths: [...record.paths],
      });
    }

    const agentNames = conflictDeliveries.map(d => d.agentDisplayName);
    const message = `File conflict detected: ${agentNames.join(' and ')} are editing the same file(s): ${uniquePaths.join(', ')}`;

    const warning: FileConflictWarning = {
      conflictId: uuid(),
      sessionId: room.session.sessionId,
      workspaceId,
      filePaths: uniquePaths,
      deliveries: conflictDeliveries,
      createdAt: new Date().toISOString(),
      message,
    };

    room.activeConflicts.set(warning.conflictId, warning);
    room.persistence?.append('fconflict', warning);

    this.broadcastToRoom(room, { type: 'fileConflictWarning', warning });
    this.log(`[Room ${room.session.sessionNumber}] File conflict warning: ${message}`);
  }

  private cleanupFileTrackerForDelivery(room: SessionRoom, deliveryId: string): void {
    const keysToDelete: string[] = [];

    for (const [key, entries] of room.fileTracker) {
      for (const entry of entries) {
        if (entry.deliveryId === deliveryId) {
          entries.delete(entry);
          break;
        }
      }
      if (entries.size === 0) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      room.fileTracker.delete(key);
    }

    if (keysToDelete.length > 0 || room.fileTracker.size > 0) {
      this.log(`[Room ${room.session.sessionNumber}] File tracker cleanup for delivery ${deliveryId}: removed from ${keysToDelete.length} file(s), ${room.fileTracker.size} tracked file(s) remaining`);
    }
  }

  // -- Delta Context --

  private getPromptFormatterDeps(room: SessionRoom): PromptFormatterDeps {
    return {
      participants: room.participants,
      transcript: room.transcript,
      seenState: room.seenState,
      renameEvents: room.renameEvents,
      agentMode: room.session.agentMode ?? 'execute',
    };
  }

  private buildDeltaContext(room: SessionRoom, agent: Participant, currentMessage: Message) {
    return buildDeltaContextFn(agent, currentMessage, this.getPromptFormatterDeps(room));
  }

  private formatAgentPrompt(
    room: SessionRoom,
    agent: Participant,
    deltaContext: { startSeq: number; contextMessages: Message[]; renameNotices: string[] },
    currentMessage: Message,
  ): string {
    return formatAgentPromptFn(agent, deltaContext, currentMessage, this.getPromptFormatterDeps(room));
  }

  // -- Helpers --

  private findClientForAgent(room: SessionRoom, agent: Participant): ConnectedClient | undefined {
    for (const client of this.clients.values()) {
      if (client.sessionNumber === room.session.sessionNumber && client.agentParticipantId === agent.participantId) {
        return client;
      }
    }
    return undefined;
  }

  private coalesceStreamingText(room: SessionRoom, deliveryId: string, agentParticipantId: string, text: string): void {
    const existing = room.streamCoalesceBuffers.get(deliveryId);
    if (existing) {
      existing.accumulated += text;
    } else {
      room.streamCoalesceBuffers.set(deliveryId, { deliveryId, agentParticipantId, accumulated: text });
    }

    if (!room.streamCoalesceTimers.has(deliveryId)) {
      room.streamCoalesceTimers.set(deliveryId, setTimeout(() => {
        room.streamCoalesceTimers.delete(deliveryId);
        const buffer = room.streamCoalesceBuffers.get(deliveryId);
        if (buffer) {
          room.streamCoalesceBuffers.delete(deliveryId);
          this.broadcastToRoom(room, {
            type: 'agentStreamingText',
            deliveryId: buffer.deliveryId,
            agentParticipantId: buffer.agentParticipantId,
            text: buffer.accumulated,
          });
        }
      }, 50));
    }
  }

  private flushStreamingBuffer(room: SessionRoom, deliveryId: string): void {
    const timer = room.streamCoalesceTimers.get(deliveryId);
    if (timer) {
      clearTimeout(timer);
      room.streamCoalesceTimers.delete(deliveryId);
    }
    const buffer = room.streamCoalesceBuffers.get(deliveryId);
    if (buffer) {
      room.streamCoalesceBuffers.delete(deliveryId);
      this.broadcastToRoom(room, {
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

  /** Broadcast a message to all clients in a specific room. */
  private broadcastToRoom(room: SessionRoom, msg: ServerToClientMessage): void {
    const data = JSON.stringify(msg);
    for (const client of this.clients.values()) {
      if (client.sessionNumber === room.session.sessionNumber && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    }
  }

  /** Broadcast to all clients in a room except the specified one. */
  private broadcastToRoomExcept(room: SessionRoom, excludeWs: WebSocket, msg: ServerToClientMessage): void {
    const data = JSON.stringify(msg);
    for (const client of this.clients.values()) {
      if (client.sessionNumber === room.session.sessionNumber && client.ws !== excludeWs && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    }
  }
}
