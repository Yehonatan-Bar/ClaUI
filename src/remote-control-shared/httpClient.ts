import * as http from 'http';
import { TOKEN_HEADER } from './protocol';

/**
 * Minimal JSON-over-HTTP client for the localhost control server (Node
 * built-ins only). Used by the stdio runtime, the CLI and the tests.
 */

export interface JsonRequestOptions {
  host?: string;
  port: number;
  method: 'GET' | 'POST';
  path: string;
  token?: string;
  body?: unknown;
  /** Abort after this many milliseconds (0 = no client-side timeout). */
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export interface JsonResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  /** Parsed JSON body, or the raw text when the body is not JSON. */
  body: unknown;
}

export function requestJson(opts: JsonRequestOptions): Promise<JsonResponse> {
  return new Promise((resolve, reject) => {
    const payload = opts.body === undefined ? undefined : Buffer.from(JSON.stringify(opts.body), 'utf8');
    const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers ?? {}) };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(payload.length);
    }
    if (opts.token) {
      headers.Authorization = `Bearer ${opts.token}`;
      headers[TOKEN_HEADER] = opts.token;
    }
    const req = http.request(
      { host: opts.host ?? '127.0.0.1', port: opts.port, method: opts.method, path: opts.path, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body: unknown = text;
          if (text.length > 0) {
            try {
              body = JSON.parse(text);
            } catch {
              body = text;
            }
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      req.setTimeout(opts.timeoutMs, () => {
        req.destroy(new Error(`Request timed out after ${Math.round(opts.timeoutMs! / 1000)}s`));
      });
    }
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}
