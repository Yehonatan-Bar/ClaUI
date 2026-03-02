/**
 * Socket.IO client for the Happy Coder relay server.
 * Handles auth flow, message send/receive, and reconnection.
 */

import { EventEmitter } from 'events';
import { io, Socket } from 'socket.io-client';
import { HappyCrypto } from './HappyCrypto';
import type {
  HappyAuthChallenge,
  HappyAuthToken,
  HappyConnectionState,
  HappyEnvelope,
  HappySessionConfig,
  HappySessionInfo,
} from './HappyTypes';

const MAX_RECONNECT_ATTEMPTS = 10;
const KEEPALIVE_INTERVAL_MS = 30_000;

/**
 * Events emitted by HappyClient:
 * - `message`           (envelope: HappyEnvelope)
 * - `ephemeral`         (data: unknown)
 * - `stateChange`       (state: HappyConnectionState, detail?: string)
 * - `connectionFailed`  (reason: string)
 * - `error`             (err: Error)
 */
export class HappyClient extends EventEmitter {
  private socket: Socket | null = null;
  private jwt: string | null = null;
  private jwtExpiresAt = 0;
  private sessionId: string | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private state: HappyConnectionState = 'disconnected';
  private disposed = false;

  constructor(
    private readonly serverUrl: string,
    private readonly crypto: HappyCrypto,
    private readonly log: (msg: string) => void
  ) {
    super();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  getState(): HappyConnectionState { return this.state; }
  getSessionId(): string | null { return this.sessionId; }

  /** Full auth+connect flow */
  async authenticate(): Promise<void> {
    this.setState('authenticating');
    try {
      const publicKey = this.crypto.getPublicKeyHex();

      // Step 1: Request challenge
      const challengeRes = await this.post<HappyAuthChallenge>('/v1/auth', { publicKey });
      this.log(`[HappyClient] Got auth challenge (nonce=${challengeRes.nonce ?? 'none'})`);

      // Step 2: Sign challenge and verify
      const signature = this.crypto.signChallenge(challengeRes.challenge);
      const tokenRes = await this.post<HappyAuthToken>('/v1/auth/verify', {
        publicKey,
        signature,
        nonce: challengeRes.nonce,
      });

      this.jwt = tokenRes.token;
      this.jwtExpiresAt = tokenRes.expiresAt;
      this.log('[HappyClient] Authenticated successfully');
    } catch (err) {
      this.setState('error');
      const msg = err instanceof Error ? err.message : String(err);
      this.emit('connectionFailed', `Authentication failed: ${msg}`);
      throw err;
    }
  }

  /** Connect the Socket.IO transport after auth */
  connect(): void {
    if (!this.jwt) { throw new Error('Not authenticated'); }
    this.setState('connecting');

    this.socket = io(this.serverUrl, {
      path: '/v1/updates',
      transports: ['websocket'],
      auth: { token: this.jwt },
      reconnection: true,
      reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30_000,
    });

    this.wireSocketEvents();
  }

  /** Create a new remote session */
  async createSession(config: HappySessionConfig): Promise<HappySessionInfo> {
    const info = await this.post<HappySessionInfo>('/v1/sessions', config);
    this.sessionId = info.sessionId;
    this.log(`[HappyClient] Created session: ${info.sessionId}`);
    this.startKeepalive();
    return info;
  }

  /** Join an existing session room */
  async joinSession(sessionId: string): Promise<void> {
    this.sessionId = sessionId;
    if (this.socket?.connected) {
      this.socket.emit('join', { sessionId });
    }
    this.log(`[HappyClient] Joined session: ${sessionId}`);
    this.startKeepalive();
  }

  /** Send a message envelope to the remote session */
  sendMessage(envelope: HappyEnvelope): void {
    if (!this.socket?.connected) {
      this.log('[HappyClient] Cannot send: not connected');
      return;
    }
    this.socket.emit('message', envelope);
  }

  /** Disconnect and clean up */
  disconnect(): void {
    this.disposed = true;
    this.stopKeepalive();
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.jwt = null;
    this.sessionId = null;
    this.setState('disconnected');
  }

  // -----------------------------------------------------------------------
  // Socket.IO event wiring
  // -----------------------------------------------------------------------

  private wireSocketEvents(): void {
    if (!this.socket) { return; }

    this.socket.on('connect', () => {
      this.reconnectAttempts = 0;
      this.setState('connected');
      this.log('[HappyClient] Socket connected');
      // Re-join session if we had one
      if (this.sessionId) {
        this.socket!.emit('join', { sessionId: this.sessionId });
      }
    });

    this.socket.on('disconnect', (reason) => {
      this.log(`[HappyClient] Socket disconnected: ${reason}`);
      if (!this.disposed) {
        this.setState('reconnecting');
      }
    });

    this.socket.on('message', (envelope: HappyEnvelope) => {
      this.emit('message', envelope);
    });

    this.socket.on('ephemeral', (data: unknown) => {
      this.emit('ephemeral', data);
    });

    this.socket.on('connect_error', (err) => {
      this.reconnectAttempts++;
      this.log(`[HappyClient] Connect error (attempt ${this.reconnectAttempts}): ${err.message}`);
      if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        this.setState('error');
        this.emit('connectionFailed', `Max reconnect attempts reached: ${err.message}`);
      } else {
        this.setState('reconnecting');
      }
    });

    this.socket.on('error', (err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      this.log(`[HappyClient] Socket error: ${error.message}`);
      this.emit('error', error);
    });
  }

  // -----------------------------------------------------------------------
  // Keepalive
  // -----------------------------------------------------------------------

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      if (this.socket?.connected && this.sessionId) {
        this.socket.emit('session-alive', { sessionId: this.sessionId });
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  // -----------------------------------------------------------------------
  // State management
  // -----------------------------------------------------------------------

  private setState(state: HappyConnectionState): void {
    if (this.state === state) { return; }
    this.state = state;
    this.emit('stateChange', state);
  }

  // -----------------------------------------------------------------------
  // HTTP helpers
  // -----------------------------------------------------------------------

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.serverUrl}${path}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.jwt) { headers['Authorization'] = `Bearer ${this.jwt}`; }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
    }
    return res.json() as Promise<T>;
  }
}
