import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export interface HttpJsonResult {
  status: number;
  body: any;
}

/**
 * Minimal HTTP(S) JSON client for the usage-reporting endpoints. Uses Node's
 * http/https directly (always available in the VS Code extension host), with a
 * short timeout and no retry — the hourly cadence is the retry mechanism.
 */
export class UsageReportClient {
  constructor(private readonly log: (msg: string) => void) {}

  /** Register a developer. `registerSecret` is the shared setup secret (may be empty). */
  register(baseUrl: string, registerSecret: string, payload: unknown): Promise<HttpJsonResult> {
    const headers: Record<string, string> = {};
    if (registerSecret) headers['X-ClaUi-Register-Token'] = registerSecret;
    return this.postJson(joinUrl(baseUrl, '/api/usage/register'), headers, payload, 15000);
  }

  /** Send a usage report delta authenticated with the developer's bearer credential. */
  report(baseUrl: string, credential: string, payload: unknown): Promise<HttpJsonResult> {
    const headers: Record<string, string> = { Authorization: 'Bearer ' + credential };
    return this.postJson(joinUrl(baseUrl, '/api/usage/report'), headers, payload, 15000);
  }

  private postJson(urlStr: string, extraHeaders: Record<string, string>, body: unknown, timeoutMs: number): Promise<HttpJsonResult> {
    return new Promise((resolve, reject) => {
      let u: URL;
      try {
        u = new URL(urlStr);
      } catch (e) {
        reject(new Error(`Invalid usage server URL: ${urlStr}`));
        return;
      }
      const data = Buffer.from(JSON.stringify(body), 'utf8');
      const transport = u.protocol === 'https:' ? https : http;
      const req = transport.request(
        {
          method: 'POST',
          hostname: u.hostname,
          port: u.port || (u.protocol === 'https:' ? 443 : 80),
          path: u.pathname + u.search,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length,
            Accept: 'application/json',
            ...extraHeaders,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let parsed: any = null;
            try {
              parsed = text ? JSON.parse(text) : null;
            } catch {
              parsed = null;
            }
            resolve({ status: res.statusCode || 0, body: parsed });
          });
        },
      );
      req.on('error', (err) => reject(err));
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error('usage report request timed out'));
      });
      req.write(data);
      req.end();
    });
  }
}

/** Join a base URL (which may include a path prefix like /mp) with an API path. */
export function joinUrl(base: string, apiPath: string): string {
  const trimmed = (base || '').replace(/\/+$/, '');
  return trimmed + apiPath;
}

/**
 * Derive an HTTP base URL from a WebSocket URL (ws:// -> http://, wss:// -> https://).
 * If the input is already http(s), it is returned unchanged (minus trailing slashes).
 */
export function deriveHttpBaseFromWs(wsUrl: string): string {
  const u = (wsUrl || '').trim();
  if (!u) return '';
  return u.replace(/^ws/i, 'http').replace(/\/+$/, '');
}
