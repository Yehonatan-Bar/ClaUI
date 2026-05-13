import { Participant } from './types';

export function normalizeName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Name cannot be empty');
  }
  if (trimmed.includes('\n') || trimmed.includes('\r')) {
    throw new Error('Name cannot contain newlines');
  }
  if (trimmed.length > 32) {
    throw new Error('Name too long (max 32)');
  }
  return trimmed.normalize('NFC');
}

export function extractRouteKey(normalizedName: string): string {
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  const first = segmenter.segment(normalizedName)[Symbol.iterator]().next();
  if (first.done) {
    throw new Error('Cannot extract route key from empty name');
  }
  return first.value.segment.normalize('NFC').toLowerCase();
}

export function validateParticipantName(
  name: string,
  participants: Participant[],
  excludeParticipantId?: string
): { displayName: string; canonicalName: string; routeKey: string } {
  const displayName = normalizeName(name);
  const routeKey = extractRouteKey(displayName);
  const canonicalName = displayName.toLocaleLowerCase('und');

  for (const p of participants) {
    if (p.participantId === excludeParticipantId) continue;
    if (p.canonicalName === canonicalName) {
      throw new Error(`Name already taken by ${p.displayName}`);
    }
    if (p.routeKey === routeKey) {
      throw new Error(`First letter conflicts with ${p.displayName} (${p.routeKey})`);
    }
  }

  return { displayName, canonicalName, routeKey };
}

function getFirstGraphemeEndIndex(str: string): number {
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  const first = segmenter.segment(str)[Symbol.iterator]().next();
  if (first.done) return 0;
  return first.value.segment.length;
}

export interface RouteResult {
  recipientParticipantId: string | null;
  parsedBody: string;
  routePrefix: string | null;
}

export function routeMessage(rawBody: string, participants: Participant[]): RouteResult {
  const body = rawBody.trim();
  if (!body) {
    return { recipientParticipantId: null, parsedBody: '', routePrefix: null };
  }

  const normalizedBody = body.normalize('NFC');

  // Step 3: full-name prefix match (greedy, longest first)
  const sorted = [...participants].sort((a, b) => b.displayName.length - a.displayName.length);
  for (const p of sorted) {
    const prefix = p.displayName;
    const bodyStart = normalizedBody.slice(0, prefix.length).toLocaleLowerCase('und');
    const prefixLower = p.canonicalName;
    if (bodyStart === prefixLower) {
      const rest = body.substring(prefix.length);
      if (rest === '' || rest[0] === ':' || rest[0] === ' ') {
        const stripped = rest.replace(/^[:\s]+/, '');
        return {
          recipientParticipantId: p.participantId,
          parsedBody: stripped,
          routePrefix: body.substring(0, prefix.length),
        };
      }
    }
  }

  // Step 4: single-character routeKey match
  const firstGrapheme = extractRouteKey(normalizedBody);
  const candidate = participants.find(p => p.routeKey === firstGrapheme);
  if (candidate) {
    const graphemeLength = getFirstGraphemeEndIndex(body);
    const rest = body.substring(graphemeLength);
    if (rest === '' || rest[0] === ':' || rest[0] === ' ') {
      const stripped = rest.replace(/^[:\s]+/, '');
      return {
        recipientParticipantId: candidate.participantId,
        parsedBody: stripped,
        routePrefix: body.substring(0, graphemeLength),
      };
    }
  }

  // Fallback: scan subsequent lines for "Name:" pattern.
  // Handles cases where agents add preamble text before the addressing prefix.
  const lines = body.split(/\r?\n/);
  for (let li = 1; li < lines.length; li++) {
    const line = lines[li].trimStart();
    if (!line) continue;
    const normalizedLine = line.normalize('NFC');

    for (const p of sorted) {
      const lineStart = normalizedLine.slice(0, p.displayName.length).toLocaleLowerCase('und');
      if (lineStart === p.canonicalName) {
        const afterName = line.substring(p.displayName.length);
        if (afterName.length > 0 && afterName[0] === ':') {
          const stripped = afterName.replace(/^[:\s]+/, '');
          const remaining = [stripped, ...lines.slice(li + 1)].join('\n').trim();
          return {
            recipientParticipantId: p.participantId,
            parsedBody: remaining,
            routePrefix: line.substring(0, p.displayName.length),
          };
        }
      }
    }

    const lineGrapheme = extractRouteKey(normalizedLine);
    const lineCandidate = participants.find(p => p.routeKey === lineGrapheme);
    if (lineCandidate) {
      const gLen = getFirstGraphemeEndIndex(line);
      const afterKey = line.substring(gLen);
      if (afterKey.length > 0 && afterKey[0] === ':') {
        const stripped = afterKey.replace(/^[:\s]+/, '');
        const remaining = [stripped, ...lines.slice(li + 1)].join('\n').trim();
        return {
          recipientParticipantId: lineCandidate.participantId,
          parsedBody: remaining,
          routePrefix: line.substring(0, gLen),
        };
      }
    }
  }

  return { recipientParticipantId: null, parsedBody: body, routePrefix: null };
}
