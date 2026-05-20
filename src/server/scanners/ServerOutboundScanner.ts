import * as crypto from 'crypto';
import { DlpFinding, FindingSeverity, FindingType, RedactionToken } from '../../shared/secret-protection/types';
import { ISecretScanner, ScanContext, ScanResult } from '../../shared/secret-protection/scanners/types';

interface OutboundRule {
  pattern: RegExp;
  severity: FindingSeverity;
  type: FindingType;
  ruleId: string;
  confidence: 'high' | 'medium' | 'low';
}

// Detects secrets in server-originated content flowing to external services:
// API responses, database query strings, audit logs, diagnostic exports.
const SERVER_OUTBOUND_RULES: OutboundRule[] = [
  // Database connection strings in error/response payloads
  {
    pattern: /\b(?:Server|Data Source|Host)=[^;]+;.*(?:Password|Pwd)=([^;]+)/gi,
    severity: 'critical',
    type: 'database_credential',
    ruleId: 'server-db-connstr-leak',
    confidence: 'high',
  },
  {
    pattern: /\b(?:postgres(?:ql)?|mysql|mssql|mongodb(?:\+srv)?|redis(?:s)?):\/\/[^:]+:([^@]+)@[^\s]+/gi,
    severity: 'critical',
    type: 'database_credential',
    ruleId: 'server-db-url-leak',
    confidence: 'high',
  },
  // Internal service URLs with auth tokens in query params
  {
    pattern: /\bhttps?:\/\/[^\s]+[?&](?:token|api_key|access_token|auth|secret)=([A-Za-z0-9._\-]{8,})/gi,
    severity: 'high',
    type: 'api_key',
    ruleId: 'server-url-token-param',
    confidence: 'high',
  },
  // Set-Cookie headers with session tokens
  {
    pattern: /[Ss]et-[Cc]ookie:\s*\S+=[A-Za-z0-9._\-]{16,}/g,
    severity: 'medium',
    type: 'hard_secret',
    ruleId: 'server-session-cookie-leak',
    confidence: 'medium',
  },
  // Internal IP:port combinations with credentials (service discovery leaks)
  {
    pattern: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}):\d{2,5}\b.*(?:password|token|secret|key)\s*[=:]\s*\S+/gi,
    severity: 'high',
    type: 'internal_topology',
    ruleId: 'server-internal-service-creds',
    confidence: 'medium',
  },
  // SQL query strings with literal values that might be sensitive
  {
    pattern: /\b(?:INSERT\s+INTO|UPDATE)\s+\S+\s+.*(?:password|secret|token|api_key)\s*(?:=\s*'[^']{4,}'|,\s*'[^']{4,}')/gi,
    severity: 'high',
    type: 'database_credential',
    ruleId: 'server-sql-literal-secret',
    confidence: 'medium',
  },
  // SMTP/mail credentials in outbound config
  {
    pattern: /\bsmtps?:\/\/([^:]+):([^@]{4,})@[^\s]+/gi,
    severity: 'high',
    type: 'hard_secret',
    ruleId: 'server-smtp-creds',
    confidence: 'high',
  },
  // X-Api-Key or similar headers in outbound HTTP
  {
    pattern: /[Xx]-[Aa]pi-[Kk]ey:\s*([A-Za-z0-9._\-]{16,})/g,
    severity: 'high',
    type: 'api_key',
    ruleId: 'server-api-key-header',
    confidence: 'high',
  },
  // OAuth client secrets in response payloads
  {
    pattern: /["']client[_-]?secret["']\s*[:=]\s*["']([A-Za-z0-9._\-]{16,})["']/gi,
    severity: 'critical',
    type: 'hard_secret',
    ruleId: 'server-oauth-client-secret',
    confidence: 'high',
  },
  // Certificate or key material in responses
  {
    pattern: /-----BEGIN\s+(?:CERTIFICATE|RSA\s+PRIVATE\s+KEY|EC\s+PRIVATE\s+KEY|PRIVATE\s+KEY)-----/g,
    severity: 'critical',
    type: 'private_key',
    ruleId: 'server-cert-material-leak',
    confidence: 'high',
  },
  // Audit log entries with plaintext PII (SSN, credit card)
  {
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    severity: 'high',
    type: 'pii',
    ruleId: 'server-ssn-in-payload',
    confidence: 'medium',
  },
  {
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
    severity: 'high',
    type: 'pii',
    ruleId: 'server-credit-card-in-payload',
    confidence: 'medium',
  },
];

const APPLICABLE_BOUNDARIES = new Set([
  'mcp.request',
  'mcp.response',
  'telemetry.export',
  'diagnostic.export',
]);

export class ServerOutboundScanner implements ISecretScanner {
  readonly name = 'server-outbound';

  scan(input: string, context?: ScanContext): ScanResult {
    const start = performance.now();
    const findings: DlpFinding[] = [];

    if (context?.boundary && !APPLICABLE_BOUNDARIES.has(context.boundary)) {
      return {
        findings: [],
        scannedBytes: Buffer.byteLength(input, 'utf-8'),
        latencyMs: performance.now() - start,
      };
    }

    for (const rule of SERVER_OUTBOUND_RULES) {
      const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(input)) !== null) {
        const matchedText = match[0];
        const matchIndex = match.index;

        const stableId = crypto
          .createHmac('sha256', 'claui-dlp')
          .update(matchedText)
          .digest('hex')
          .slice(0, 16);
        const hashPrefix = crypto
          .createHash('sha256')
          .update(matchedText)
          .digest('hex')
          .slice(0, 8);
        const line = input.slice(0, matchIndex).split('\n').length;

        const redaction: RedactionToken = {
          text: `<REDACTED type="${rule.type}" id="sec_${stableId}" />`,
          type: rule.type,
          stableId: `sec_${stableId}`,
          hashPrefix,
          originalLength: matchedText.length,
        };

        findings.push({
          id: crypto.randomUUID(),
          ruleId: rule.ruleId,
          type: rule.type,
          severity: rule.severity,
          confidence: rule.confidence,
          location: {
            byteStart: matchIndex,
            byteEnd: matchIndex + matchedText.length,
            line,
          },
          redaction,
        });

        if (!rule.pattern.flags.includes('g')) break;
      }
    }

    return {
      findings,
      scannedBytes: Buffer.byteLength(input, 'utf-8'),
      latencyMs: performance.now() - start,
    };
  }
}
