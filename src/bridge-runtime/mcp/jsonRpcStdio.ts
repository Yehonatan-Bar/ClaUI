import * as readline from 'readline';

/**
 * Minimal JSON-RPC 2.0 framing shared by MCP stdio servers in this bundle.
 * MCP's stdio transport is newline-delimited JSON-RPC over stdin/stdout — one
 * UTF-8 JSON object per line, no embedded newlines, no Content-Length framing
 * (unlike LSP). Hand-rolled here (no MCP SDK dependency) to keep the
 * bridge-runtime bundle self-contained, mirroring the ACP client already
 * hand-rolled in grokAcp.ts.
 */

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  /** Absent for a notification (no response expected/sent). */
  id?: number | string;
  method: string;
  params?: unknown;
}

/** Write one JSON-RPC message to stdout, newline-terminated. */
export function writeMessage(msg: unknown): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

export function sendResult(id: number | string, result: unknown): void {
  writeMessage({ jsonrpc: '2.0', id, result });
}

/** `id` is `null` for errors that occur before a request's own id can be
 *  determined (a parse error, or a malformed envelope with no usable id) —
 *  required by the JSON-RPC 2.0 spec rather than omitting `id` entirely. */
export function sendError(id: number | string | null, code: number, message: string): void {
  writeMessage({ jsonrpc: '2.0', id, error: { code, message } });
}

function isValidId(id: unknown): id is number | string | undefined {
  // A non-finite number (e.g. `1e400` parses to Infinity) would pass
  // `typeof === 'number'` but then JSON.stringify silently serializes it as
  // `null` in the response, corrupting request/response correlation.
  return id === undefined || (typeof id === 'number' && Number.isFinite(id)) || typeof id === 'string';
}

/** Read newline-delimited JSON-RPC messages from stdin, validating each
 *  envelope before handing it to `onMessage`. Malformed input is answered
 *  with a proper JSON-RPC error (-32700 parse error / -32600 invalid
 *  request) instead of being silently dropped — a strict client (or a fuzzer)
 *  should see the same error semantics a spec-compliant server would give. */
export function readMessages(onMessage: (msg: JsonRpcRequest) => void): void {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    if (!line.trim()) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      sendError(null, -32700, 'Parse error');
      return;
    }

    const obj = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    const candidateId = obj && isValidId(obj.id) ? (obj.id as number | string | undefined) : undefined;
    const valid = !!obj && obj.jsonrpc === '2.0' && typeof obj.method === 'string' && isValidId(obj.id);
    if (!valid) {
      sendError(candidateId ?? null, -32600, 'Invalid Request');
      return;
    }

    onMessage(obj as unknown as JsonRpcRequest);
  });
}
