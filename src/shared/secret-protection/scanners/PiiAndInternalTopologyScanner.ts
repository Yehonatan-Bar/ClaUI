import * as crypto from 'crypto';
import { DlpFinding, FindingType, RedactionToken } from '../types';
import { ISecretScanner, ScanContext, ScanResult } from './types';

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const FALSE_POSITIVE_EMAIL_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'test.com',
  'test.org',
  'localhost',
  'placeholder.com',
]);

const FALSE_POSITIVE_EMAILS = new Set([
  'test@test.com',
  'user@example.com',
  'noreply@example.com',
  'no-reply@example.com',
]);

const INTERNAL_IP_PATTERN =
  /\b(?:10\.(?:\d{1,3}\.){2}\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3}|192\.168\.(?:\d{1,3}\.)\d{1,3})\b/g;

const INTERNAL_HOSTNAME_PATTERN =
  /\b[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.(?:internal|corp|cluster\.local|local)\b/g;

function createFindingForMatch(
  ruleId: string,
  type: FindingType,
  matched: string,
  matchIndex: number,
  input: string,
): DlpFinding {
  const stableId = crypto
    .createHmac('sha256', 'claui-dlp')
    .update(matched)
    .digest('hex')
    .slice(0, 16);
  const hashPrefix = crypto
    .createHash('sha256')
    .update(matched)
    .digest('hex')
    .slice(0, 8);
  const line = input.slice(0, matchIndex).split('\n').length;
  const redactionType = type === 'pii' ? 'pii' : 'internal_topology';

  const redaction: RedactionToken = {
    text: `<REDACTED type="${redactionType}" id="sec_${stableId}" />`,
    type: redactionType,
    stableId: `sec_${stableId}`,
    hashPrefix,
    originalLength: matched.length,
  };

  return {
    id: crypto.randomUUID(),
    ruleId,
    type,
    severity: 'medium',
    confidence: 'high',
    location: {
      byteStart: matchIndex,
      byteEnd: matchIndex + matched.length,
      line,
    },
    redaction,
  };
}

export class PiiAndInternalTopologyScanner implements ISecretScanner {
  readonly name = 'pii-topology';

  scan(input: string, _context?: ScanContext): ScanResult {
    const start = performance.now();
    const findings: DlpFinding[] = [];

    this.scanEmails(input, findings);
    this.scanInternalIps(input, findings);
    this.scanInternalHostnames(input, findings);

    return {
      findings,
      scannedBytes: Buffer.byteLength(input, 'utf-8'),
      latencyMs: performance.now() - start,
    };
  }

  private scanEmails(input: string, findings: DlpFinding[]): void {
    const regex = new RegExp(EMAIL_PATTERN.source, EMAIL_PATTERN.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(input)) !== null) {
      const email = match[0].toLowerCase();
      if (FALSE_POSITIVE_EMAILS.has(email)) continue;

      const domain = email.split('@')[1];
      if (FALSE_POSITIVE_EMAIL_DOMAINS.has(domain)) continue;

      findings.push(
        createFindingForMatch('pii-email', 'pii', match[0], match.index, input),
      );
    }
  }

  private scanInternalIps(input: string, findings: DlpFinding[]): void {
    const regex = new RegExp(INTERNAL_IP_PATTERN.source, INTERNAL_IP_PATTERN.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(input)) !== null) {
      findings.push(
        createFindingForMatch('topology-internal-ip', 'internal_topology', match[0], match.index, input),
      );
    }
  }

  private scanInternalHostnames(input: string, findings: DlpFinding[]): void {
    const regex = new RegExp(INTERNAL_HOSTNAME_PATTERN.source, INTERNAL_HOSTNAME_PATTERN.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(input)) !== null) {
      const hostname = match[0].toLowerCase();
      if (hostname === 'localhost') continue;

      findings.push(
        createFindingForMatch('topology-internal-hostname', 'internal_topology', match[0], match.index, input),
      );
    }
  }
}
