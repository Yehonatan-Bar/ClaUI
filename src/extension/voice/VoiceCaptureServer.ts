import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import type { AddressInfo } from 'net';

/**
 * Hosts the tiny "capture" page that runs the browser's Web Speech API.
 *
 * VS Code webviews cannot open the microphone, so recognition runs in a small
 * always-on-top Chrome/Edge app window (72x72 px) that talks to this server
 * over localhost. The server binds an ephemeral port on 127.0.0.1 only.
 *
 *   capture page --POST /transcript {session, kind, text}--> server --> onEvent()
 *   server --SSE /events {command:start|stop}--> capture page
 *
 * Every transcript carries the session id it belongs to; the caller drops
 * anything from a session that is no longer active.
 */

export type CaptureEvent =
  | { type: 'ready'; version: string }
  | { type: 'listening'; session: number }
  | { type: 'stopped'; session: number }
  | { type: 'transcript'; session: number; kind: 'interim' | 'final'; text: string }
  | { type: 'level'; session: number; level: number }
  | { type: 'error'; session?: number; code: 'need-permission' | 'no-browser' | 'network' | 'speech'; text: string };

export interface VoiceCaptureServerOptions {
  /** Directory holding `media/voice-capture.html`. */
  extensionPath: string;
  /** Extension version; the page reloads itself when the server version changes. */
  version: string;
  /** Persistent browser profile directory (keeps the mic permission). */
  profileDir: string;
  /** Explicit Chrome/Edge executable, overrides auto-detection. */
  browserPath?: string;
  log: (msg: string) => void;
  onEvent: (ev: CaptureEvent) => void;
}

const RELAUNCH_COOLDOWN_MS = 15000;

export class VoiceCaptureServer {
  private server: http.Server | null = null;
  private port = 0;
  private sseClients = new Set<http.ServerResponse>();
  private browser: cp.ChildProcess | null = null;
  private launchedAt = 0;
  private listening = false;
  private session = 0;
  private lang = 'he-IL';

  constructor(private readonly opts: VoiceCaptureServerOptions) {}

  /** True while the capture page holds an open event stream. */
  get connected(): boolean {
    return this.sseClients.size > 0;
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const srv = http.createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      srv.once('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        srv.off('error', reject);
        this.port = (srv.address() as AddressInfo).port;
        resolve();
      });
    });
    srv.on('error', (err) => this.opts.log(`[Voice] server error: ${err.message}`));
    this.server = srv;
    this.opts.log(`[Voice] capture server on ${this.url}`);
  }

  /** Make sure a capture window exists (launches one if none is connected). */
  ensureBrowser(): void {
    if (this.connected) return;
    if (this.browser && this.browser.exitCode === null && Date.now() - this.launchedAt < RELAUNCH_COOLDOWN_MS) return;
    this.launch();
  }

  startCapture(session: number, lang: string): void {
    this.listening = true;
    this.session = session;
    this.lang = lang;
    this.broadcast({ type: 'command', command: 'start', session, lang });
    this.ensureBrowser();
  }

  stopCapture(session: number): void {
    this.listening = false;
    this.broadcast({ type: 'command', command: 'stop', session });
  }

  dispose(): void {
    for (const c of this.sseClients) { try { c.end(); } catch { /* ignore */ } }
    this.sseClients.clear();
    if (this.browser && this.browser.exitCode === null) {
      try { this.browser.kill(); } catch { /* ignore */ }
    }
    this.browser = null;
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  /* ---------------- internals ---------------- */

  private stateEvent(): Record<string, unknown> {
    return { type: 'state', version: this.opts.version, listening: this.listening, session: this.session, lang: this.lang };
  }

  private broadcast(ev: Record<string, unknown>): void {
    const payload = `data: ${JSON.stringify(ev)}\n\n`;
    for (const c of this.sseClients) {
      try { c.write(payload); } catch { /* ignore */ }
    }
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', this.url);
    // Same-origin only: the page is served from this very server, so no CORS headers are needed.
    if (url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
      res.write('retry: 500\n\n');
      res.write(`data: ${JSON.stringify(this.stateEvent())}\n\n`);
      this.sseClients.add(res);
      this.opts.log('[Voice] capture page connected');
      req.on('close', () => {
        this.sseClients.delete(res);
        this.opts.log('[Voice] capture page disconnected');
      });
      return;
    }
    if (url.pathname === '/capture') {
      const file = path.join(this.opts.extensionPath, 'media', 'voice-capture.html');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(file, 'utf8'));
      return;
    }
    if (url.pathname === '/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.stateEvent()));
      return;
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      res.writeHead(204);
      res.end();
      const session = Number(body.session) || 0;
      if (url.pathname === '/transcript') {
        const kind = body.kind === 'final' ? 'final' : 'interim';
        this.opts.onEvent({ type: 'transcript', session, kind, text: String(body.text || '') });
      } else if (url.pathname === '/level') {
        this.opts.onEvent({ type: 'level', session, level: Number(body.level) || 0 });
      } else if (url.pathname === '/status') {
        this.onStatus(String(body.status || ''), session, body);
      }
      return;
    }
    res.writeHead(404);
    res.end();
  }

  private onStatus(status: string, session: number, body: Record<string, unknown>): void {
    if (status === 'ready') {
      this.opts.log(`[Voice] capture page ready v${String(body.version || '?')}`);
      this.opts.onEvent({ type: 'ready', version: String(body.version || '') });
      if (this.listening) this.broadcast({ type: 'command', command: 'start', session: this.session, lang: this.lang });
    } else if (status === 'listening') {
      this.opts.onEvent({ type: 'listening', session });
    } else if (status === 'stopped') {
      this.opts.onEvent({ type: 'stopped', session });
    } else if (status === 'need-permission') {
      this.opts.onEvent({ type: 'error', session, code: 'need-permission', text: 'Allow the microphone in the small voice window' });
    } else if (status === 'error') {
      const code = body.code === 'network' ? 'network' : 'speech';
      this.opts.onEvent({ type: 'error', session, code, text: String(body.text || 'Speech recognition error') });
    }
  }

  private browserCandidates(): string[] {
    if (this.opts.browserPath) return [this.opts.browserPath];
    const c: string[] = [];
    if (process.platform === 'win32') {
      const local = process.env.LOCALAPPDATA || '';
      const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
      const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      if (local) c.push(path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      c.push(path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      c.push(path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      if (local) c.push(path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
      c.push(path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
      c.push(path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    } else if (process.platform === 'darwin') {
      c.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
      c.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
      c.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
    } else {
      for (const name of ['google-chrome', 'google-chrome-stable', 'microsoft-edge', 'chromium', 'chromium-browser']) {
        for (const dir of (process.env.PATH || '').split(path.delimiter)) {
          if (dir) c.push(path.join(dir, name));
        }
      }
    }
    return c;
  }

  private launch(): void {
    const bin = this.browserCandidates().find((p) => { try { return fs.existsSync(p); } catch { return false; } });
    if (!bin) {
      this.opts.log('[Voice] no Chrome/Edge found');
      this.opts.onEvent({ type: 'error', code: 'no-browser', text: 'Voice dictation needs Google Chrome or Microsoft Edge installed' });
      return;
    }
    const url = `${this.url}/capture?v=${encodeURIComponent(this.opts.version)}`;
    const args = [
      `--app=${url}`,
      `--user-data-dir=${this.opts.profileDir}`,
      '--no-first-run',
      '--disable-extensions',
      '--disable-translate',
      '--hide-crash-restore-bubble',
      '--auto-accept-camera-and-microphone-capture',
      '--disable-background-timer-throttling',
      '--window-size=72,72',
      '--window-position=16,16',
      '--always-on-top',
    ];
    try {
      fs.mkdirSync(this.opts.profileDir, { recursive: true });
      this.opts.log(`[Voice] launching capture window: ${bin}`);
      this.browser = cp.spawn(bin, args, { stdio: 'ignore', windowsHide: false });
      this.launchedAt = Date.now();
      this.browser.on('exit', (code) => this.opts.log(`[Voice] browser process exited (${code})`));
      this.browser.on('error', (err) => this.opts.log(`[Voice] browser spawn error: ${err.message}`));
    } catch (err) {
      this.opts.log(`[Voice] browser spawn failed: ${err instanceof Error ? err.message : String(err)}`);
      this.opts.onEvent({ type: 'error', code: 'no-browser', text: 'Could not start the voice capture window' });
    }
  }
}

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); }
    });
  });
}
