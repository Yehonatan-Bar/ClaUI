/**
 * Bounds the size of arbitrary message payloads before they are stored in the
 * remote-control event log, so one huge message (full conversation history,
 * analytics dump, base64 image) cannot blow up memory or a client response.
 */

export interface CompactOptions {
  maxStringLength: number;
  maxArrayLength: number;
  maxDepth: number;
  maxKeys: number;
}

export const DEFAULT_COMPACT_OPTIONS: CompactOptions = {
  maxStringLength: 4000,
  maxArrayLength: 100,
  maxDepth: 6,
  maxKeys: 80,
};

/** Keys holding binary blobs: elided when long (never useful to remote callers). */
const ELIDED_KEYS = new Set(['base64', 'imageData']);
/** Keys holding credentials: always redacted, whatever their length. */
const SECRET_KEYS = new Set(['apiKey', 'token', 'pat', 'password', 'secret', 'secretValues', 'accessToken', 'githubToken']);

export function truncateString(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}... [truncated ${value.length - max} chars]`;
}

export function compactPayload(value: unknown, options: Partial<CompactOptions> = {}): unknown {
  const opts = { ...DEFAULT_COMPACT_OPTIONS, ...options };
  const seen = new WeakSet<object>();

  const walk = (node: unknown, depth: number): unknown => {
    if (node === null || node === undefined) {
      return node;
    }
    if (typeof node === 'string') {
      return truncateString(node, opts.maxStringLength);
    }
    if (typeof node === 'number' || typeof node === 'boolean') {
      return node;
    }
    if (typeof node === 'bigint') {
      return node.toString();
    }
    if (typeof node !== 'object') {
      return undefined; // functions / symbols
    }
    if (seen.has(node as object)) {
      return '[circular]';
    }
    if (depth >= opts.maxDepth) {
      return Array.isArray(node) ? `[array(${node.length})]` : '[object]';
    }
    seen.add(node as object);
    if (Array.isArray(node)) {
      const items = node.slice(0, opts.maxArrayLength).map((item) => walk(item, depth + 1));
      if (node.length > opts.maxArrayLength) {
        items.push(`[... ${node.length - opts.maxArrayLength} more items]`);
      }
      return items;
    }
    const out: Record<string, unknown> = {};
    const keys = Object.keys(node as Record<string, unknown>);
    for (const key of keys.slice(0, opts.maxKeys)) {
      const child = (node as Record<string, unknown>)[key];
      if (SECRET_KEYS.has(key) && child !== undefined && child !== null && child !== '') {
        out[key] = '[redacted]';
        continue;
      }
      if (ELIDED_KEYS.has(key) && typeof child === 'string' && child.length > 64) {
        out[key] = `[${child.length} chars elided]`;
        continue;
      }
      const compacted = walk(child, depth + 1);
      if (compacted !== undefined) {
        out[key] = compacted;
      }
    }
    if (keys.length > opts.maxKeys) {
      out['...'] = `${keys.length - opts.maxKeys} more keys`;
    }
    return out;
  };

  return walk(value, 0);
}
