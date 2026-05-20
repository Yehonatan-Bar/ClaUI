import * as crypto from 'crypto';
import { DlpFinding, FindingSeverity, FindingType, RedactionToken } from '../../shared/secret-protection/types';
import { ISecretScanner, ScanContext, ScanResult } from '../../shared/secret-protection/scanners/types';

interface ContextRule {
  pattern: RegExp;
  severity: FindingSeverity;
  type: FindingType;
  ruleId: string;
}

// Detects secrets leaked in extension-originated content:
// source files, diagnostic logs, command output, VS Code settings.
const EXTENSION_CONTEXT_RULES: ContextRule[] = [
  // Hardcoded credentials in source code assignments
  {
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*["'`]([^"'`\n]{8,})["'`]/gi,
    severity: 'high',
    type: 'hard_secret',
    ruleId: 'ext-hardcoded-password',
  },
  {
    pattern: /(?:connectionString|connection_string|connStr)\s*[:=]\s*["'`]([^"'`\n]{12,})["'`]/gi,
    severity: 'critical',
    type: 'database_credential',
    ruleId: 'ext-connection-string',
  },
  // Stack traces revealing internal server paths
  {
    pattern: /(?:at\s+\S+\s+\(|File\s+")(?:C:\\Users\\[^\\]+\\|\/home\/[^/]+\/|\/var\/|\/etc\/|\/opt\/)[\w\\/.:-]+/gi,
    severity: 'medium',
    type: 'internal_topology',
    ruleId: 'ext-stack-trace-path',
  },
  // Log lines leaking environment secrets (e.g. "ENV_VAR=secretvalue" in log output)
  {
    pattern: /\b(?:REDIS_URL|MONGO_URI|AMQP_URL|SMTP_PASSWORD|MAIL_PASSWORD)\s*=\s*(\S{8,})/gi,
    severity: 'high',
    type: 'hard_secret',
    ruleId: 'ext-log-env-leak',
  },
  // VS Code settings with sensitive values
  {
    pattern: /["'](?:proxy\.?password|http\.proxy\.?authorization|remote\.SSH\.configFile)["']\s*:\s*["']([^"']{6,})["']/gi,
    severity: 'high',
    type: 'hard_secret',
    ruleId: 'ext-vscode-setting-secret',
  },
  // Authorization headers in log/debug output
  {
    pattern: /[Aa]uthorization:\s*(Bearer\s+\S{20,}|Basic\s+[A-Za-z0-9+/=]{12,})/g,
    severity: 'high',
    type: 'api_key',
    ruleId: 'ext-auth-header-leak',
  },
  // Session tokens / cookies in log output
  {
    pattern: /(?:session[_-]?(?:id|token)|sid|JSESSIONID|PHPSESSID|connect\.sid)\s*[=:]\s*["']?([A-Za-z0-9._\-]{16,})["']?/gi,
    severity: 'medium',
    type: 'hard_secret',
    ruleId: 'ext-session-token-leak',
  },
  // Internal error messages with database details
  {
    pattern: /(?:SQLSTATE|ORA-\d{5}|ERROR\s+\d{4}).*(?:password|user|host|port)\s*=\s*\S+/gi,
    severity: 'high',
    type: 'database_credential',
    ruleId: 'ext-db-error-leak',
  },
];

// Boundaries this scanner is designed for
const APPLICABLE_BOUNDARIES = new Set([
  'context.attach',
  'file.read_for_context',
  'command.output',
]);

export class ExtensionOutboundScanner implements ISecretScanner {
  readonly name = 'extension-outbound';

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

    for (const rule of EXTENSION_CONTEXT_RULES) {
      const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(input)) !== null) {
        const matchedText = match[1] ?? match[0];
        const fullMatch = match[0];
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
          originalLength: fullMatch.length,
        };

        findings.push({
          id: crypto.randomUUID(),
          ruleId: rule.ruleId,
          type: rule.type,
          severity: rule.severity,
          confidence: 'medium',
          location: {
            byteStart: matchIndex,
            byteEnd: matchIndex + fullMatch.length,
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
