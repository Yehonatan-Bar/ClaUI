import * as http from 'http';
import type { AddressInfo } from 'net';
import { URL } from 'url';
import {
  ERROR_CODES,
  RemoteControlError,
  ROUTES,
  TOKEN_HEADER,
  type RemoteEvent,
  type ToolCallResponse,
} from '../../../remote-control-shared/protocol';
import { handleMcpMessage, type McpExecutor, type McpServerIdentity, errorResponse, JSON_RPC_ERRORS } from '../../../remote-control-shared/mcpProtocol';
import { tokensEqual } from '../../../remote-control-shared/instanceRegistry';
import { toMcpTool, type ToolDefinition } from '../../../remote-control-shared/toolCatalog';
import { EventLog, LIVE_ONLY_EVENT_TYPES, type EventFilter } from './EventLog';

/**
 * Localhost control server hosted by the extension host. Node built-ins only;
 * no vscode imports (unit-tested directly).
 *
 * Security model (see Kingdom_of_Claudes_Beloved_MDs/REMOTE_CONTROL_MCP.md):
 *  - binds 127.0.0.1 only;
 *  - rejects any request carrying an Origin / Sec-Fetch-Site header (browsers)
 *    and any Host header that is not a loopback name (DNS rebinding);
 *  - requires the per-user token (Authorization: Bearer / X-ClaUi-Token)
 *    BEFORE reading a request body; never accepts tokens in the query string;
 *  - caps body size, concurrent requests and SSE clients.
 */

export interface ToolCallContext {
  requestId: number;
  transport: 'mcp' | 'rest';
  signal: AbortSignal;
}

export interface RemoteControlBackend {
  identity: McpServerIdentity;
  instanceId: string;
  /** Instance-scope tools served by this window. */
  listTools(): ToolDefinition[];
  callTool(name: string, args: Record<string, unknown>, ctx: ToolCallContext): Promise<unknown>;
  getStatus(): unknown;
  eventLog: EventLog;
  log(message: string): void;
}

export interface HttpServerOptions {
  host?: string;
  /** 0 = pick a free port. */
  port: number;
  getToken: () => string;
  maxBodyBytes?: number;
  maxConcurrentRequests?: number;
  maxSseClients?: number;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
/** Per-SSE-client cap on bytes waiting in the socket buffer. */
const MAX_SSE_BUFFERED_BYTES = 4 * 1024 * 1024;

function httpStatusFor(code: string): number {
  switch (code) {
    case ERROR_CODES.invalidArgs:
      return 400;
    case ERROR_CODES.unauthorized:
      return 401;
    case ERROR_CODES.forbidden:
    case ERROR_CODES.readOnly:
      return 403;
    case ERROR_CODES.notFound:
      return 404;
    case ERROR_CODES.unsupported:
      return 409;
    default:
      return 500;
  }
}

export class RemoteControlHttpServer {
  private server: http.Server | null = null;
  private boundPort = 0;
  private requestCounter = 0;
  private inFlight = 0;
  private readonly sseClients = new Set<http.ServerResponse>();
  private readonly maxBodyBytes: number;
  private readonly maxConcurrent: number;
  private readonly maxSse: number;
  /** Set when a fixed port was busy and a random one was used instead. */
  portFallback = false;

  constructor(
    private readonly backend: RemoteControlBackend,
    private readonly options: HttpServerOptions,
  ) {
    this.maxBodyBytes = options.maxBodyBytes ?? 32 * 1024 * 1024;
    this.maxConcurrent = options.maxConcurrentRequests ?? 64;
    this.maxSse = options.maxSseClients ?? 16;
  }

  get port(): number {
    return this.boundPort;
  }

  get host(): string {
    return this.options.host ?? '127.0.0.1';
  }

  get activeSseClients(): number {
    return this.sseClients.size;
  }

  get activeRequests(): number {
    return this.inFlight;
  }

  async start(): Promise<number> {
    const tryListen = (port: number): Promise<http.Server> =>
      new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
          void this.handle(req, res);
        });
        // Long-poll / wait endpoints keep requests open; only bound header time.
        server.headersTimeout = 15_000;
        server.requestTimeout = 0;
        server.keepAliveTimeout = 5_000;
        server.once('error', reject);
        server.listen(port, this.host, () => {
          server.removeListener('error', reject);
          resolve(server);
        });
      });

    try {
      this.server = await tryListen(this.options.port);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE' && this.options.port !== 0) {
        this.backend.log(`[RemoteControl] Port ${this.options.port} is busy (another VS Code window?); using a random free port.`);
        this.portFallback = true;
        this.server = await tryListen(0);
      } else {
        throw err;
      }
    }
    this.boundPort = (this.server.address() as AddressInfo).port;
    return this.boundPort;
  }

  async stop(): Promise<void> {
    for (const client of this.sseClients) {
      try {
        client.end();
      } catch {
        /* ignore */
      }
    }
    this.sseClients.clear();
    const server = this.server;
    this.server = null;
    if (!server) {
      return;
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // Drop idle keep-alive sockets so close() completes promptly (Node >= 18.2).
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
  }

  // -------------------------------------------------------------------------

  private sendJson(res: http.ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}): void {
    if (res.writableEnded) {
      return;
    }
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(payload.length),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    });
    res.end(payload);
  }

  private sendError(res: http.ServerResponse, status: number, code: string, message: string): void {
    const body: ToolCallResponse = { ok: false, error: { code, message } };
    this.sendJson(res, status, body);
  }

  /** Host must be a loopback name (optionally with our port): blocks DNS-rebinding. */
  private isAllowedHost(hostHeader: string | undefined): boolean {
    if (!hostHeader) {
      return false;
    }
    const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(hostHeader.trim().toLowerCase());
    if (!match) {
      return false;
    }
    const [, hostname, port] = match;
    if (!LOOPBACK_HOSTS.has(hostname)) {
      return false;
    }
    return port === undefined || Number(port) === this.boundPort;
  }

  private extractToken(req: http.IncomingMessage): string | null {
    const auth = req.headers.authorization;
    if (typeof auth === 'string' && /^bearer\s+/i.test(auth)) {
      return auth.replace(/^bearer\s+/i, '').trim();
    }
    const custom = req.headers[TOKEN_HEADER];
    if (typeof custom === 'string' && custom.trim()) {
      return custom.trim();
    }
    return null;
  }

  private readBody(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const declared = Number(req.headers['content-length'] ?? 0);
      if (declared > this.maxBodyBytes) {
        reject(new RemoteControlError(ERROR_CODES.invalidArgs, `Request body larger than ${this.maxBodyBytes} bytes`));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      req.setTimeout(30_000, () => req.destroy(new Error('Body read timed out')));
      req.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > this.maxBodyBytes) {
          reject(new RemoteControlError(ERROR_CODES.invalidArgs, `Request body larger than ${this.maxBodyBytes} bytes`));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        req.setTimeout(0);
        const text = Buffer.concat(chunks).toString('utf8');
        if (!text.trim()) {
          resolve(undefined);
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(new RemoteControlError(ERROR_CODES.invalidArgs, 'Request body is not valid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const requestId = ++this.requestCounter;
    const startedAt = Date.now();
    const method = req.method ?? 'GET';
    let pathName = '/';
    let toolLabel = '';
    let statusForLog = 0;
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) {
        abort.abort();
      }
    });
    const originalWriteHead = res.writeHead.bind(res);
    res.writeHead = ((status: number, ...rest: unknown[]) => {
      statusForLog = status;
      return (originalWriteHead as (...a: unknown[]) => http.ServerResponse)(status, ...rest);
    }) as typeof res.writeHead;

    try {
      let url: URL;
      try {
        url = new URL(req.url ?? '/', 'http://127.0.0.1');
      } catch {
        this.sendError(res, 400, ERROR_CODES.invalidArgs, 'Bad URL');
        return;
      }
      pathName = url.pathname;

      // 1. Browser / rebinding defenses (cheap, before auth).
      if (req.headers.origin !== undefined || req.headers['sec-fetch-site'] !== undefined) {
        this.sendError(res, 403, ERROR_CODES.forbidden, 'Browser requests are not allowed (Origin header present).');
        return;
      }
      if (!this.isAllowedHost(req.headers.host)) {
        this.sendError(res, 403, ERROR_CODES.forbidden, 'Host header must be a loopback address.');
        return;
      }
      if (url.searchParams.has('token') || url.searchParams.has('access_token')) {
        this.sendError(res, 400, ERROR_CODES.invalidArgs, 'Tokens are never accepted in the URL; use the Authorization header.');
        return;
      }

      // 2. Unauthenticated liveness probe (reveals nothing but "this is ClaUi").
      if (pathName === ROUTES.health && method === 'GET') {
        this.sendJson(res, 200, { ok: true, app: 'claui-remote-control' });
        return;
      }

      // 3. Authenticate BEFORE reading any body.
      const presented = this.extractToken(req);
      const expected = this.options.getToken();
      if (!presented || !expected || !tokensEqual(presented, expected)) {
        this.sendError(res, 401, ERROR_CODES.unauthorized, 'Missing or invalid token.');
        return;
      }

      if (this.inFlight >= this.maxConcurrent) {
        this.sendError(res, 503, ERROR_CODES.internal, 'Too many concurrent requests.');
        return;
      }
      this.inFlight++;
      try {
        await this.route(req, res, url, method, requestId, abort.signal, (label) => {
          toolLabel = label;
        });
      } finally {
        this.inFlight--;
      }
    } catch (err) {
      if (err instanceof RemoteControlError) {
        this.sendError(res, httpStatusFor(err.code), err.code, err.message);
      } else {
        this.backend.log(`[RemoteControl][HTTP] #${requestId} internal error: ${err instanceof Error ? err.message : String(err)}`);
        this.sendError(res, 500, ERROR_CODES.internal, 'Internal error (see Output > ClaUi).');
      }
    } finally {
      if (pathName !== ROUTES.eventStream) {
        this.backend.log(
          `[RemoteControl][HTTP] #${requestId} ${method} ${pathName}${toolLabel ? ` tool=${toolLabel}` : ''} ` +
            `-> ${statusForLog || res.statusCode} (${Date.now() - startedAt}ms)`,
        );
      }
    }
  }

  private async route(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
    method: string,
    requestId: number,
    signal: AbortSignal,
    setLabel: (label: string) => void,
  ): Promise<void> {
    const pathName = url.pathname;

    if (pathName === ROUTES.mcp) {
      if (method !== 'POST') {
        // Stateless Streamable HTTP: no server-initiated SSE stream, no sessions.
        res.writeHead(405, { Allow: 'POST', 'Content-Length': '0' });
        res.end();
        return;
      }
      await this.handleMcp(req, res, requestId, signal, setLabel);
      return;
    }

    if (pathName === ROUTES.status && method === 'GET') {
      this.sendJson(res, 200, { ok: true, result: this.backend.getStatus() });
      return;
    }

    if (pathName === ROUTES.tools && method === 'GET') {
      this.sendJson(res, 200, { ok: true, result: { tools: this.backend.listTools() } });
      return;
    }

    if (pathName.startsWith(ROUTES.toolPrefix) && method === 'POST') {
      const name = decodeURIComponent(pathName.slice(ROUTES.toolPrefix.length));
      setLabel(name);
      if (!this.backend.listTools().some((t) => t.name === name)) {
        throw new RemoteControlError(ERROR_CODES.notFound, `Unknown tool: ${name}`);
      }
      this.requireJsonContentType(req);
      const body = await this.readBody(req);
      if (body !== undefined && (body === null || typeof body !== 'object' || Array.isArray(body))) {
        throw new RemoteControlError(ERROR_CODES.invalidArgs, 'Body must be a JSON object of tool arguments');
      }
      try {
        const result = await this.backend.callTool(name, (body ?? {}) as Record<string, unknown>, { requestId, transport: 'rest', signal });
        const payload: ToolCallResponse = { ok: true, result };
        this.sendJson(res, 200, payload);
      } catch (err) {
        if (err instanceof RemoteControlError) {
          const payload: ToolCallResponse = { ok: false, error: { code: err.code, message: err.message, details: err.details } };
          this.sendJson(res, httpStatusFor(err.code), payload);
          return;
        }
        throw err;
      }
      return;
    }

    if (pathName === ROUTES.events && method === 'GET') {
      const filter = this.parseFilter(url);
      const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') ?? 100) || 100));
      const waitSec = Math.min(300, Math.max(0, Number(url.searchParams.get('wait') ?? 0) || 0));
      const sinceRaw = url.searchParams.get('since');
      const log = this.backend.eventLog;
      const since = sinceRaw !== null && sinceRaw !== '' ? Math.max(0, Number(sinceRaw) || 0) : waitSec > 0 ? log.lastSeq : -1;
      const events =
        since < 0
          ? log.tail(filter, limit)
          : await log.waitForEvents(since, filter, limit, waitSec * 1000, signal);
      const nextSeq = events.length > 0 ? events[events.length - 1].seq : Math.max(since, 0) || log.lastSeq;
      this.sendJson(res, 200, { ok: true, result: { events, nextSeq, lastSeq: log.lastSeq, oldestSeq: log.oldestSeq } });
      return;
    }

    if (pathName === ROUTES.eventStream && method === 'GET') {
      this.openEventStream(req, res, url);
      return;
    }

    throw new RemoteControlError(ERROR_CODES.notFound, `No route for ${method} ${pathName}`);
  }

  private requireJsonContentType(req: http.IncomingMessage): void {
    const type = String(req.headers['content-type'] ?? '');
    const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
    if (hasBody && !/application\/json/i.test(type)) {
      throw new RemoteControlError(ERROR_CODES.invalidArgs, 'Content-Type must be application/json');
    }
  }

  private parseFilter(url: URL): EventFilter {
    const filter: EventFilter = {};
    const tabId = url.searchParams.get('tabId');
    if (tabId) {
      filter.tabId = tabId;
    }
    const types = url.searchParams.get('types');
    if (types) {
      filter.types = types.split(',').map((t) => t.trim()).filter(Boolean);
    }
    const direction = url.searchParams.get('direction');
    if (direction === 'in' || direction === 'out' || direction === 'system') {
      filter.direction = direction;
    }
    return filter;
  }

  private async handleMcp(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    requestId: number,
    signal: AbortSignal,
    setLabel: (label: string) => void,
  ): Promise<void> {
    this.requireJsonContentType(req);
    let body: unknown;
    try {
      body = await this.readBody(req);
    } catch (err) {
      if (err instanceof RemoteControlError) {
        this.sendJson(res, 400, errorResponse(null, JSON_RPC_ERRORS.parse, err.message));
        return;
      }
      throw err;
    }
    const tools = this.backend.listTools();
    const executor: McpExecutor = {
      listTools: () => tools.map(toMcpTool),
      hasTool: (name) => tools.some((t) => t.name === name),
      callTool: (name, args) => {
        setLabel(name);
        return this.backend.callTool(name, args, { requestId, transport: 'mcp', signal });
      },
    };
    const messages = Array.isArray(body) ? body : [body];
    if (messages.length === 0) {
      this.sendJson(res, 400, errorResponse(null, JSON_RPC_ERRORS.invalidRequest, 'Empty batch'));
      return;
    }
    const responses = [];
    for (const message of messages) {
      const response = await handleMcpMessage(message, executor, this.backend.identity);
      if (response) {
        responses.push(response);
      }
    }
    if (responses.length === 0) {
      // Only notifications / client responses: acknowledged, no body.
      res.writeHead(202, { 'Content-Length': '0' });
      res.end();
      return;
    }
    this.sendJson(res, 200, Array.isArray(body) ? responses : responses[0]);
  }

  private openEventStream(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
    if (this.sseClients.size >= this.maxSse) {
      throw new RemoteControlError(ERROR_CODES.forbidden, `Too many event-stream clients (max ${this.maxSse}).`);
    }
    const filter = this.parseFilter(url);
    const includeLive = url.searchParams.get('includeLive') === '1' || url.searchParams.get('includeLive') === 'true';
    const sinceRaw = url.searchParams.get('since');
    const log = this.backend.eventLog;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Content-Type-Options': 'nosniff',
    });
    this.sseClients.add(res);
    req.socket.setTimeout(0);

    let closed = false;
    let unsubscribe: () => void = () => undefined;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
      this.sseClients.delete(res);
    };
    // Backpressure: a client that stops reading must not grow extension-host
    // memory without bound. Past the cap it is disconnected (it can reconnect
    // with ?since=<last id> to replay stored events).
    const send = (chunk: string): void => {
      if (closed) return;
      if (res.writableLength > MAX_SSE_BUFFERED_BYTES) {
        this.backend.log(`[RemoteControl][HTTP] SSE client not reading (${res.writableLength} bytes buffered); disconnecting it.`);
        cleanup();
        res.destroy();
        return;
      }
      res.write(chunk);
    };
    const write = (event: RemoteEvent): void => {
      send(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    res.on('close', cleanup);
    res.on('error', cleanup);
    // Replay stored history after `since` first, then go live.
    if (sinceRaw !== null && sinceRaw !== '') {
      for (const event of log.query(Math.max(0, Number(sinceRaw) || 0), filter, 1000)) {
        write(event);
      }
    }
    send(`: connected lastSeq=${log.lastSeq}\n\n`);
    unsubscribe = log.subscribe((event) => {
      if (!includeLive && LIVE_ONLY_EVENT_TYPES.has(event.type)) {
        return;
      }
      if (EventLog.matches(event, filter)) {
        write(event);
      }
    });
    heartbeat = setInterval(() => send(': ping\n\n'), 15_000);
  }
}
