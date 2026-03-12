export interface UsageLimitParseResult {
  resetAtMs: number;
  resetDisplay: string;
}

const USAGE_LIMIT_DETECTION_PATTERNS: RegExp[] = [
  /\busage limit reached\b/i,
  /\byour limit will reset\b/i,
  /\blimit will reset\b/i,
  /\blimit resets?\b/i,
];

/** Parse usage-limit reset time from a Claude error string.
 *  Returns null when the message is not a usage-limit message OR reset time
 *  cannot be parsed reliably.
 */
export function parseUsageLimitError(rawMessage: string, nowMs = Date.now()): UsageLimitParseResult | null {
  const normalized = (rawMessage || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  const isUsageLimit = USAGE_LIMIT_DETECTION_PATTERNS.some((pattern) => pattern.test(normalized));
  if (!isUsageLimit) return null;

  const resetSegment = extractResetSegment(normalized);

  const absoluteResetAt = parseAbsoluteDateTime(resetSegment) ?? parseAbsoluteDateTime(normalized);
  let resetAtMs =
    absoluteResetAt ??
    parseTimeOnly(resetSegment, nowMs) ??
    parseTimeOnly(normalized, nowMs) ??
    parseRelativeDuration(normalized, nowMs);

  if (resetAtMs == null) {
    return null;
  }

  resetAtMs = normalizeToFuture(resetAtMs, nowMs);

  return {
    resetAtMs,
    resetDisplay: formatClockTime(resetAtMs),
  };
}

function extractResetSegment(text: string): string | null {
  const match = text.match(
    /\b(?:your\s+)?limit\s+(?:will\s+)?resets?(?:\s+at)?\s*[:\-]?\s*([^.!?\n]+)/i
  );
  if (match?.[1]) {
    return match[1].trim();
  }
  const fallback = text.match(/\breset(?:s)?\s+at\s*[:\-]?\s*([^.!?\n]+)/i);
  return fallback?.[1]?.trim() || null;
}

function parseAbsoluteDateTime(input: string | null): number | null {
  if (!input) return null;
  const candidates = buildDateParseCandidates(input);
  for (const candidate of candidates) {
    const parsed = Date.parse(candidate);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function buildDateParseCandidates(input: string): string[] {
  const base = input.trim().replace(/^at\s+/i, '');
  const noParensTz = base.replace(/\(([A-Za-z_+\-/ ]+)\)/g, '').trim();
  const noTzWords = noParensTz
    .replace(/\b(?:local\s+time|your\s+time|timezone|utc|gmt)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return Array.from(new Set([base, noParensTz, noTzWords].filter(Boolean)));
}

function parseTimeOnly(input: string | null, nowMs: number): number | null {
  if (!input) return null;

  const match = input.match(/\b([01]?\d|2[0-3])(?::([0-5]\d))?\s*([ap]\.?m\.?)?\b/i);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const meridiem = (match[3] || '').toLowerCase().replace(/\./g, '');

  if (meridiem === 'am') {
    if (hours === 12) hours = 0;
  } else if (meridiem === 'pm') {
    if (hours < 12) hours += 12;
  }

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

  const resetAt = new Date(nowMs);
  resetAt.setHours(hours, minutes, 0, 0);
  if (resetAt.getTime() <= nowMs) {
    resetAt.setDate(resetAt.getDate() + 1);
  }
  return resetAt.getTime();
}

function parseRelativeDuration(input: string, nowMs: number): number | null {
  const relative = input.match(/\bin\s+(\d+)\s*(minute|minutes|min|mins|m|hour|hours|hr|hrs|h)\b/i);
  if (!relative) return null;

  const amount = Number(relative[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = relative[2].toLowerCase();
  const multiplier = unit.startsWith('h') || unit === 'hour' || unit === 'hours' ? 60 * 60 * 1000 : 60 * 1000;
  return nowMs + amount * multiplier;
}

function normalizeToFuture(parsedMs: number, nowMs: number): number {
  if (parsedMs > nowMs) return parsedMs;

  const parsed = new Date(parsedMs);
  const next = new Date(nowMs);
  next.setHours(parsed.getHours(), parsed.getMinutes(), parsed.getSeconds(), 0);
  if (next.getTime() <= nowMs) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime();
}

function formatClockTime(ms: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ms));
}

