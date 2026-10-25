/**
 * Pure helpers that turn raw Codex CLI failure output into text a user can act on.
 * No `vscode` import, so they are unit tested directly (tests/process/codexErrorText.test.ts).
 */

/**
 * Codex reports API failures as a JSON document stuffed inside the error string, e.g.
 *   {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'gpt-6-astra' model requires a newer version of Codex. ..."}}
 * Return the human-readable message inside it; anything that is not such a
 * document is returned unchanged (trimmed).
 */
export function unwrapCodexErrorMessage(message: string): string {
  const trimmed = (message || '').trim();
  if (!trimmed.startsWith('{')) {
    return trimmed;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return trimmed;
    }
    const record = parsed as Record<string, unknown>;
    const nested = record.error;
    if (nested && typeof nested === 'object') {
      const nestedMessage = (nested as Record<string, unknown>).message;
      if (typeof nestedMessage === 'string' && nestedMessage.trim()) {
        return nestedMessage.trim();
      }
    }
    if (typeof nested === 'string' && nested.trim()) {
      return nested.trim();
    }
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message.trim();
    }
    return trimmed;
  } catch {
    return trimmed;
  }
}

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;]*m/g;
const CODEX_TRACING_LINE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s+(?:ERROR|WARN|INFO|DEBUG|TRACE)\s+[\w-]+(?:::[\w-]+)*:/;

/**
 * True for Codex's own diagnostic log lines on stderr, e.g.
 *   2026-10-25T11:33:52.331657Z ERROR codex_skills_extension::host_service: failed to install system skills: ...
 * These are emitted on successful turns too, so they are kept as failure context
 * instead of being shown as chat errors.
 */
export function isCodexTracingLogLine(line: string): boolean {
  const cleaned = (line || '').replace(ANSI_ESCAPE_PATTERN, '').trim();
  return CODEX_TRACING_LINE_PATTERN.test(cleaned);
}

/**
 * Node delivers stderr in arbitrary chunks, so a single Codex line can arrive in
 * two pieces. Append `chunk` to the held `pending` text and split off everything
 * up to the last newline (`complete`); the unterminated tail (`rest`) is held for
 * the next chunk. A tail that grows past `maxPendingLength` is released as-is so
 * newline-free output can never be held forever.
 */
export function takeCompleteStderrLines(
  pending: string,
  chunk: string,
  maxPendingLength: number,
): { complete: string; rest: string } {
  const buffered = pending + chunk;
  const lastNewline = buffered.lastIndexOf('\n');
  if (lastNewline === -1) {
    return buffered.length < maxPendingLength
      ? { complete: '', rest: buffered }
      : { complete: buffered, rest: '' };
  }
  return { complete: buffered.slice(0, lastNewline), rest: buffered.slice(lastNewline + 1) };
}

const OUTDATED_CLI_PATTERNS = [
  /requires a newer version of codex/i,
  /upgrade to the latest (?:app or )?cli/i,
];

/**
 * When Codex says the CLI is too old for the requested model, append which CLI
 * ClaUi is actually running and how to fix it. A stale `codex` on PATH (for
 * example one bundled with another Codex install) is a common cause, and the
 * raw message does not say which binary is the old one.
 */
export function withOutdatedCodexCliHint(message: string, cliPath: string): string {
  if (!OUTDATED_CLI_PATTERNS.some((pattern) => pattern.test(message))) {
    return message;
  }
  const cliLabel = (cliPath || '').trim() || 'codex';
  return (
    `${message} ClaUi runs the Codex CLI at "${cliLabel}". Update it ` +
    '(npm install -g @openai/codex@latest) or set "claudeMirror.codex.cliPath" to a newer codex, then retry.'
  );
}
