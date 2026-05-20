import * as crypto from 'crypto';
import { DlpFinding, FindingSeverity, FindingType, RedactionToken } from '../../shared/secret-protection/types';
import { ISecretScanner, ScanContext, ScanResult } from '../../shared/secret-protection/scanners/types';

interface InputRule {
  pattern: RegExp;
  severity: FindingSeverity;
  type: FindingType;
  ruleId: string;
  confidence: 'high' | 'medium' | 'low';
}

// Detects secrets in user-generated content flowing from webview to server:
// chat messages, pasted text, file uploads, clipboard content.
const WEBVIEW_INPUT_RULES: InputRule[] = [
  // User pasting raw API keys inline
  {
    pattern: /\b(?:sk-[a-zA-Z0-9]{20,}|sk-proj-[a-zA-Z0-9_-]{40,})\b/g,
    severity: 'critical',
    type: 'api_key',
    ruleId: 'webview-openai-key-paste',
    confidence: 'high',
  },
  {
    pattern: /\b(?:sk-ant-[a-zA-Z0-9_-]{40,})\b/g,
    severity: 'critical',
    type: 'api_key',
    ruleId: 'webview-anthropic-key-paste',
    confidence: 'high',
  },
  // AWS keys pasted in messages
  {
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    severity: 'critical',
    type: 'cloud_credential',
    ruleId: 'webview-aws-access-key-paste',
    confidence: 'high',
  },
  // Generic long base64 blobs (potential encoded credentials)
  {
    pattern: /(?:^|\s)([A-Za-z0-9+/]{64,}={0,2})(?:\s|$)/gm,
    severity: 'medium',
    type: 'hard_secret',
    ruleId: 'webview-base64-blob',
    confidence: 'low',
  },
  // URLs with embedded credentials (user:pass@host)
  {
    pattern: /\b(?:https?|ftp|postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/([^:@\s]+):([^@\s]{4,})@[^\s]+/gi,
    severity: 'high',
    type: 'database_credential',
    ruleId: 'webview-url-embedded-creds',
    confidence: 'high',
  },
  // Private key blocks pasted in chat
  {
    pattern: /-----BEGIN\s+(?:RSA\s+)?(?:PRIVATE|EC)\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?(?:PRIVATE|EC)\s+KEY-----/g,
    severity: 'critical',
    type: 'private_key',
    ruleId: 'webview-private-key-paste',
    confidence: 'high',
  },
  // JWT tokens pasted in messages
  {
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    severity: 'high',
    type: 'jwt',
    ruleId: 'webview-jwt-paste',
    confidence: 'high',
  },
  // Generic "here is my key/token/password" disclosure patterns
  {
    pattern: /(?:my|the|our|this)\s+(?:api[_\s-]?key|secret|password|token|credential)\s+(?:is|:)\s*["'`]?(\S{8,})["'`]?/gi,
    severity: 'high',
    type: 'hard_secret',
    ruleId: 'webview-explicit-secret-disclosure',
    confidence: 'medium',
  },
  // Webhook URLs (contain embedded auth tokens)
  {
    pattern: /\bhttps?:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[a-zA-Z0-9]+\b/g,
    severity: 'high',
    type: 'webhook',
    ruleId: 'webview-slack-webhook',
    confidence: 'high',
  },
  {
    pattern: /\bhttps?:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[a-zA-Z0-9_-]+\b/g,
    severity: 'high',
    type: 'webhook',
    ruleId: 'webview-discord-webhook',
    confidence: 'high',
  },
  // .env file content pasted as a block (multiple KEY=VALUE lines)
  {
    pattern: /(?:^|\n)(?:[A-Z][A-Z0-9_]{2,}=\S+\n){3,}/gm,
    severity: 'high',
    type: 'hard_secret',
    ruleId: 'webview-env-block-paste',
    confidence: 'medium',
  },
];

const APPLICABLE_BOUNDARIES = new Set([
  'prompt.submit',
]);

export class WebviewOutboundScanner implements ISecretScanner {
  readonly name = 'webview-outbound';

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

    for (const rule of WEBVIEW_INPUT_RULES) {
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
