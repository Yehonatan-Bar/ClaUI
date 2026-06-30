import { IncomingMessage, ServerResponse } from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { URL } from 'url';
import { UsageStore } from '../usage/UsageStore';
import { AdminAuth } from '../admin/AdminAuth';
import { buildSummary, buildDeveloperDetail } from '../usage/UsageAggregator';
import { ModelUsage, PriceRow, UsageWindow } from '../usage/types';
import { timingSafeEqualStr } from '../util/crypto';

export interface UsageHttpConfig {
  usageStore: UsageStore;
  adminAuth: AdminAuth;
  /** Shared secret required to register a developer (CLAUI_REGISTER_TOKEN || CLAUI_SESSION_TOKEN). */
  registerToken?: string;
  /** Directory holding the admin SPA (index.html). */
  publicDir: string;
  log?: (msg: string) => void;
}

const MAX_BODY_BYTES = 256 * 1024;        // reject oversized report payloads
const MAX_USAGE_ENTRIES = 200;            // sane cap on models per report
const MAX_TOKEN_MAGNITUDE = 1e12;         // clamp absurd token counts
const ADMIN_COOKIE = 'claui_admin';
const VALID_WINDOWS: UsageWindow[] = ['today', '7d', '30d', 'quarter'];

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

interface RateBucket { count: number; resetAt: number; }

/**
 * HTTP layer for usage reporting + the admin dashboard. Built on Node's http
 * module (no framework dependency). Designed to be mounted on the same
 * http.Server the WebSocket coordination server is attached to, so both share
 * one port. The WS upgrade traffic never reaches this handler.
 */
export class UsageHttpServer {
  private readonly store: UsageStore;
  private readonly auth: AdminAuth;
  private readonly registerToken: string | null;
  private readonly publicDir: string;
  private readonly log: (msg: string) => void;
  private readonly rateBuckets = new Map<string, RateBucket>();

  constructor(config: UsageHttpConfig) {
    this.store = config.usageStore;
    this.auth = config.adminAuth;
    this.registerToken = config.registerToken && config.registerToken.length > 0 ? config.registerToken : null;
    this.publicDir = config.publicDir;
    this.log = config.log || console.log;
  }

  /** Bound request handler for http.createServer(...). */
  handler = (req: IncomingMessage, res: ServerResponse): void => {
    void this.route(req, res).catch(err => {
      this.log(`UsageHttp: unhandled error: ${err}`);
      if (!res.headersSent) this.sendJson(res, 500, { error: 'internal_error' });
    });
  };

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = (req.method || 'GET').toUpperCase();
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname;

    // --- Usage API (developer clients) ---
    if (pathname === '/api/usage/health' && method === 'GET') {
      return this.sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/usage/register' && method === 'POST') {
      return this.handleRegister(req, res);
    }
    if (pathname === '/api/usage/report' && method === 'POST') {
      return this.handleReport(req, res);
    }

    // --- Admin API ---
    if (pathname === '/api/admin/login' && method === 'POST') {
      return this.handleAdminLogin(req, res);
    }
    if (pathname === '/api/admin/logout' && method === 'POST') {
      res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
      return this.sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/admin/session' && method === 'GET') {
      return this.sendJson(res, 200, { authenticated: this.isAdmin(req), configured: this.auth.isConfigured() });
    }
    if (pathname === '/api/admin/summary' && method === 'GET') {
      if (!this.requireAdmin(req, res)) return;
      return this.handleSummary(res, url);
    }
    if (pathname === '/api/admin/developer' && method === 'GET') {
      if (!this.requireAdmin(req, res)) return;
      return this.handleDeveloperDetail(res, url);
    }
    if (pathname === '/api/admin/prices' && method === 'GET') {
      if (!this.requireAdmin(req, res)) return;
      return this.sendJson(res, 200, this.store.getConfig());
    }
    if (pathname === '/api/admin/prices' && method === 'PUT') {
      if (!this.requireAdmin(req, res)) return;
      return this.handleSavePrices(req, res);
    }

    // --- Static admin SPA ---
    if ((pathname === '/admin' || pathname.startsWith('/admin/')) && method === 'GET') {
      return this.serveAdminSpa(pathname, res);
    }

    this.sendJson(res, 404, { error: 'not_found' });
  }

  // --- Developer endpoints ---

  private async handleRegister(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.rateLimit(req, 'register', 20, 60_000)) {
      return this.sendJson(res, 429, { error: 'rate_limited' });
    }
    // Shared-secret gate, FAIL CLOSED: registration is only possible when a
    // register secret is configured (CLAUI_REGISTER_TOKEN, falling back to
    // CLAUI_SESSION_TOKEN). Without one, refuse - never mint developer tokens
    // openly, which would let anyone submit bogus usage and corrupt the totals.
    if (!this.registerToken) {
      this.log('UsageHttp: register rejected - no register secret configured (set CLAUI_REGISTER_TOKEN or CLAUI_SESSION_TOKEN)');
      return this.sendJson(res, 503, { error: 'registration_not_configured' });
    }
    const provided = this.bearerToken(req) || this.headerValue(req, 'x-claui-register-token');
    if (!provided || !timingSafeEqualStr(provided, this.registerToken)) {
      return this.sendJson(res, 401, { error: 'invalid_register_token' });
    }
    const body = await this.readJson(req, res);
    if (body === undefined) return;
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 80) : '';
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim().slice(0, 80) : '';
    if (!displayName) return this.sendJson(res, 400, { error: 'displayName_required' });

    const { developerId, developerToken } = this.store.registerDeveloper(displayName, deviceId);
    this.sendJson(res, 200, { developerId, developerToken });
  }

  private async handleReport(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.rateLimit(req, 'report', 120, 60_000)) {
      return this.sendJson(res, 429, { error: 'rate_limited' });
    }
    const token = this.bearerToken(req);
    const body = await this.readJson(req, res);
    if (body === undefined) return;

    const developerId = typeof body.developerId === 'string' ? body.developerId : '';
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.slice(0, 80) : '';
    if (!developerId || !token || !this.store.verifyDeveloperToken(developerId, token)) {
      return this.sendJson(res, 401, { error: 'unauthorized' });
    }
    if (!Array.isArray(body.usage)) {
      return this.sendJson(res, 400, { error: 'usage_required' });
    }

    const usage = this.sanitizeUsage(body.usage);
    const serverReceivedAt = Date.now();
    this.store.recordReport(developerId, deviceId, usage, serverReceivedAt);
    this.sendJson(res, 200, { ok: true, serverReceivedAt });
  }

  /** Clamp + validate a reported usage array. Drops malformed entries; never trusts magnitudes. */
  private sanitizeUsage(raw: unknown[]): ModelUsage[] {
    const out: ModelUsage[] = [];
    for (const item of raw.slice(0, MAX_USAGE_ENTRIES)) {
      if (!item || typeof item !== 'object') continue;
      const e = item as Record<string, unknown>;
      const model = typeof e.model === 'string' && e.model.trim() ? e.model.trim().slice(0, 120) : 'unknown';
      const clamp = (v: unknown): number => {
        const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
        return Math.min(Math.max(0, Math.round(n)), MAX_TOKEN_MAGNITUDE);
      };
      const entry: ModelUsage = {
        model,
        input: clamp(e.input),
        output: clamp(e.output),
        cacheCreation: clamp(e.cacheCreation),
        cacheRead: clamp(e.cacheRead),
      };
      if (entry.input + entry.output + entry.cacheCreation + entry.cacheRead > 0) out.push(entry);
    }
    return out;
  }

  // --- Admin endpoints ---

  private async handleAdminLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.rateLimit(req, 'login', 10, 60_000)) {
      return this.sendJson(res, 429, { error: 'rate_limited' });
    }
    const body = await this.readJson(req, res);
    if (body === undefined) return;
    const username = typeof body.username === 'string' ? body.username : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const token = this.auth.login(username, password);
    if (!token) {
      return this.sendJson(res, 401, { error: 'invalid_credentials' });
    }
    res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${12 * 60 * 60}`);
    this.sendJson(res, 200, { ok: true });
  }

  private handleSummary(res: ServerResponse, url: URL): void {
    const window = this.parseWindow(url.searchParams.get('window'));
    const summary = buildSummary(
      this.store.getAllRecords(),
      this.store.getAllDevelopers(),
      this.store.getConfig(),
      window,
      Date.now(),
    );
    this.sendJson(res, 200, summary);
  }

  private handleDeveloperDetail(res: ServerResponse, url: URL): void {
    const id = url.searchParams.get('id') || '';
    const window = this.parseWindow(url.searchParams.get('window'));
    const dev = this.store.getDeveloper(id);
    if (!dev) return this.sendJson(res, 404, { error: 'developer_not_found' });
    const detail = buildDeveloperDetail(this.store.getAllRecords(), dev, this.store.getConfig(), window, Date.now());
    this.sendJson(res, 200, detail);
  }

  private async handleSavePrices(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readJson(req, res);
    if (body === undefined) return;

    const patch: Record<string, unknown> = {};
    if (body.prices && typeof body.prices === 'object') {
      const prices: Record<string, PriceRow> = {};
      for (const [model, row] of Object.entries(body.prices as Record<string, unknown>)) {
        if (!row || typeof row !== 'object') continue;
        const r = row as Record<string, unknown>;
        const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
        prices[model.trim().toLowerCase().slice(0, 120)] = {
          input: num(r.input),
          output: num(r.output),
          cacheCreation: num(r.cacheCreation),
          cacheRead: num(r.cacheRead),
        };
      }
      patch.prices = prices;
    }
    const optNum = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
    const budget = optNum(body.monthlyBudgetUsd); if (budget !== undefined) patch.monthlyBudgetUsd = budget;
    const spike = optNum(body.spikePercent); if (spike !== undefined) patch.spikePercent = spike;
    const inactive = optNum(body.inactiveDays); if (inactive !== undefined) patch.inactiveDays = inactive;
    const rate = optNum(body.exchangeRate); if (rate !== undefined && rate > 0) patch.exchangeRate = rate;
    if (typeof body.currency === 'string' && body.currency.trim()) patch.currency = body.currency.trim().slice(0, 8);

    const saved = this.store.saveConfig(patch);
    this.sendJson(res, 200, saved);
  }

  // --- Admin auth helpers ---

  private isAdmin(req: IncomingMessage): boolean {
    const cookieToken = this.parseCookies(req)[ADMIN_COOKIE];
    if (cookieToken && this.auth.verify(cookieToken)) return true;
    const bearer = this.bearerToken(req);
    return !!bearer && this.auth.verify(bearer);
  }

  private requireAdmin(req: IncomingMessage, res: ServerResponse): boolean {
    if (this.isAdmin(req)) return true;
    this.sendJson(res, 401, { error: 'admin_auth_required' });
    return false;
  }

  // --- Static SPA ---

  private serveAdminSpa(pathname: string, res: ServerResponse): void {
    // Treat /admin and /admin/ as the index; otherwise try to serve a real asset.
    const rel = pathname === '/admin' || pathname === '/admin/' ? 'index.html' : pathname.slice('/admin/'.length);
    const safeRel = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
    let filePath = path.join(this.publicDir, safeRel);

    // Path-traversal guard: resolved path must stay inside publicDir.
    const resolvedBase = path.resolve(this.publicDir);
    const resolved = path.resolve(filePath);
    if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
      filePath = path.join(this.publicDir, 'index.html');
    }
    // SPA fallback: unknown sub-paths serve index.html.
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(this.publicDir, 'index.html');
    }
    if (!fs.existsSync(filePath)) {
      return this.sendJson(res, 404, { error: 'admin_ui_not_found', detail: `Expected ${filePath}` });
    }
    const ext = path.extname(filePath).toLowerCase();
    res.statusCode = 200;
    res.setHeader('Content-Type', CONTENT_TYPES[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(filePath).pipe(res);
  }

  // --- Low-level helpers ---

  private parseWindow(value: string | null): UsageWindow {
    return VALID_WINDOWS.includes(value as UsageWindow) ? (value as UsageWindow) : '30d';
  }

  private sendJson(res: ServerResponse, status: number, obj: unknown): void {
    const data = JSON.stringify(obj);
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(data);
  }

  /** Read + parse a JSON body with a size cap. Returns undefined and sends an error on failure. */
  private readJson(req: IncomingMessage, res: ServerResponse): Promise<Record<string, any> | undefined> {
    return new Promise((resolve) => {
      let size = 0;
      const chunks: Buffer[] = [];
      let aborted = false;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          aborted = true;
          this.sendJson(res, 413, { error: 'payload_too_large' });
          req.destroy();
          resolve(undefined);
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (aborted) return;
        const raw = Buffer.concat(chunks).toString('utf-8').trim();
        if (!raw) { resolve({}); return; }
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') resolve(parsed as Record<string, any>);
          else { this.sendJson(res, 400, { error: 'invalid_json' }); resolve(undefined); }
        } catch {
          this.sendJson(res, 400, { error: 'invalid_json' });
          resolve(undefined);
        }
      });
      req.on('error', () => {
        if (!aborted) { this.sendJson(res, 400, { error: 'read_error' }); resolve(undefined); }
      });
    });
  }

  private bearerToken(req: IncomingMessage): string | null {
    const auth = this.headerValue(req, 'authorization');
    if (!auth) return null;
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    return m ? m[1].trim() : null;
  }

  private headerValue(req: IncomingMessage, name: string): string | null {
    const v = req.headers[name];
    if (Array.isArray(v)) return v[0] ?? null;
    return typeof v === 'string' ? v : null;
  }

  private parseCookies(req: IncomingMessage): Record<string, string> {
    const header = this.headerValue(req, 'cookie');
    const out: Record<string, string> = {};
    if (!header) return out;
    for (const part of header.split(';')) {
      const idx = part.indexOf('=');
      if (idx < 0) continue;
      const k = part.slice(0, idx).trim();
      const val = part.slice(idx + 1).trim();
      if (k) out[k] = decodeURIComponent(val);
    }
    return out;
  }

  private clientIp(req: IncomingMessage): string {
    const fwd = this.headerValue(req, 'x-forwarded-for');
    if (fwd) return fwd.split(',')[0].trim();
    return req.socket.remoteAddress || 'unknown';
  }

  /** Fixed-window rate limiter keyed by ip + bucket name. Returns false when over the limit. */
  private rateLimit(req: IncomingMessage, bucket: string, max: number, windowMs: number): boolean {
    const key = `${bucket}:${this.clientIp(req)}`;
    const now = Date.now();
    const existing = this.rateBuckets.get(key);
    if (!existing || existing.resetAt <= now) {
      this.rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      // Opportunistic cleanup to keep the map bounded.
      if (this.rateBuckets.size > 5000) {
        for (const [k, v] of this.rateBuckets) if (v.resetAt <= now) this.rateBuckets.delete(k);
      }
      return true;
    }
    existing.count++;
    return existing.count <= max;
  }
}
