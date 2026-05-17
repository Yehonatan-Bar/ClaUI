import { EventEmitter } from 'events';
import WebSocket from 'ws';
import type { ClientToServerMessage, ServerToClientMessage } from './MultiParticipantProtocol';

export interface MultiParticipantClientEvents {
  connected: [];
  disconnected: [code: number, reason: string];
  reconnecting: [attempt: number, delayMs: number];
  error: [error: Error];
  message: [msg: ServerToClientMessage];
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const RECONNECT_MAX_ATTEMPTS = 20;
const PING_TIMEOUT_MS = 15000;

export class MultiParticipantClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private serverUrl: string;
  private authToken: string;
  private log: (msg: string) => void;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private intentionalClose = false;
  private autoReconnect = true;

  private humanParticipantId: string | null = null;
  private agentParticipantId: string | null = null;
  private sessionNumber: number = 0;
  private lastSeenSeq = 0;

  private pingTimer: ReturnType<typeof setTimeout> | null = null;

  private sendQueue: ClientToServerMessage[] = [];

  constructor(serverUrl: string, log?: (msg: string) => void, authToken?: string) {
    super();
    this.serverUrl = serverUrl;
    this.authToken = authToken || '';
    this.log = log || (() => {});
  }

  private buildConnectUrl(): string {
    if (!this.authToken) return this.serverUrl;
    const separator = this.serverUrl.includes('?') ? '&' : '?';
    return `${this.serverUrl}${separator}token=${encodeURIComponent(this.authToken)}`;
  }

  setIdentity(humanId: string, agentId: string, sessionNumber?: number): void {
    this.humanParticipantId = humanId;
    this.agentParticipantId = agentId;
    if (sessionNumber != null) {
      this.sessionNumber = sessionNumber;
    }
  }

  setServerUrl(url: string): void {
    this.serverUrl = url;
  }

  setSessionNumber(num: number): void {
    this.sessionNumber = num;
  }

  updateLastSeenSeq(seq: number): void {
    if (seq > this.lastSeenSeq) {
      this.lastSeenSeq = seq;
    }
  }

  connect(): void {
    this.intentionalClose = false;
    this.reconnectAttempt = 0;
    this.doConnect();
  }

  private doConnect(): void {
    if (this.ws) {
      this.ws.removeAllListeners();
      try { this.ws.close(); } catch { /* ignore */ }
    }

    const connectUrl = this.buildConnectUrl();
    const tokenIncluded = connectUrl.includes('token=');
    this.log(`Connecting to coordination server: ${this.serverUrl} (auth: ${tokenIncluded ? 'token appended, ' + this.authToken.length + ' chars' : 'NO token'})`);
    this.ws = new WebSocket(connectUrl);

    this.ws.on('open', () => {
      this.log('Connected to coordination server');
      this.reconnectAttempt = 0;
      this.flushQueue();
      this.emit('connected');
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ServerToClientMessage;
        this.handleServerMessage(msg);
      } catch (err) {
        this.log(`Failed to parse server message: ${err}`);
      }
    });

    this.ws.on('close', (code, reason) => {
      const reasonStr = reason?.toString() || '';
      this.log(`Disconnected from server: code=${code} reason=${reasonStr}`);
      this.ws = null;
      this.clearPingTimer();
      this.emit('disconnected', code, reasonStr);

      if (!this.intentionalClose && this.autoReconnect) {
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (err) => {
      this.log(`WebSocket error: ${err.message}`);
      this.emit('error', err);
    });

    this.ws.on('pong', () => {
      this.resetPingTimer();
    });
  }

  private handleServerMessage(msg: ServerToClientMessage): void {
    if (msg.type === 'ping') {
      this.send({ type: 'pong' });
      this.resetPingTimer();
      return;
    }

    if (msg.type === 'newMessage') {
      this.updateLastSeenSeq(msg.message.seq);
    }

    if (msg.type === 'sessionState') {
      const maxSeq = msg.transcript.reduce((m, t) => Math.max(m, t.seq), 0);
      this.updateLastSeenSeq(maxSeq);
    }

    if (msg.type === 'rejoinAccepted') {
      this.updateLastSeenSeq(msg.deltaTranscript.reduce(
        (m, t) => Math.max(m, t.seq), msg.lastSeenSeq
      ));
    }

    this.emit('message', msg);
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempt >= RECONNECT_MAX_ATTEMPTS) {
      this.log(`Max reconnect attempts (${RECONNECT_MAX_ATTEMPTS}) reached, giving up`);
      return;
    }

    const jitter = Math.random() * 0.3 + 0.85;
    const delayMs = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempt) * jitter,
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempt++;

    this.log(`Reconnecting in ${Math.round(delayMs)}ms (attempt ${this.reconnectAttempt}/${RECONNECT_MAX_ATTEMPTS})`);
    this.emit('reconnecting', this.reconnectAttempt, Math.round(delayMs));

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect();
    }, delayMs);
  }

  sendRejoin(): void {
    if (this.humanParticipantId && this.agentParticipantId) {
      this.send({
        type: 'rejoinSession',
        sessionNumber: this.sessionNumber,
        humanParticipantId: this.humanParticipantId,
        agentParticipantId: this.agentParticipantId,
        lastSeenSeq: this.lastSeenSeq,
      });
    }
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.autoReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearPingTimer();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(msg: ClientToServerMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (msg.type !== 'pong' && msg.type !== 'leaveSession') {
        this.sendQueue.push(msg);
      }
      return;
    }
    this.ws.send(JSON.stringify(msg));
  }

  private flushQueue(): void {
    const queued = this.sendQueue.splice(0);
    for (const msg of queued) {
      this.send(msg);
    }
  }

  private resetPingTimer(): void {
    this.clearPingTimer();
    this.pingTimer = setTimeout(() => {
      this.log('Ping timeout, closing connection to trigger reconnect');
      if (this.ws) {
        this.ws.close();
      }
    }, PING_TIMEOUT_MS);
  }

  private clearPingTimer(): void {
    if (this.pingTimer) {
      clearTimeout(this.pingTimer);
      this.pingTimer = null;
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
