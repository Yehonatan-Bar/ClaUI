import * as crypto from 'crypto';
import { DlpFinding, FindingSeverity, FindingType, RedactionToken } from '../secret-protection/types';
import { ISecretScanner, ScanContext, ScanResult } from '../secret-protection/scanners/types';

// Sensitive file patterns that should never be committed
interface SensitiveFileRule {
  pattern: RegExp;
  severity: FindingSeverity;
  type: FindingType;
  ruleId: string;
}

const SENSITIVE_FILE_RULES: SensitiveFileRule[] = [
  { pattern: /\.env(?:\.[a-zA-Z0-9_-]+)?$/, severity: 'critical', type: 'protected_path', ruleId: 'git-staged-dotenv' },
  { pattern: /\.pem$/i, severity: 'critical', type: 'protected_path', ruleId: 'git-staged-pem' },
  { pattern: /\.key$/i, severity: 'critical', type: 'protected_path', ruleId: 'git-staged-key-file' },
  { pattern: /\.p12$/i, severity: 'critical', type: 'protected_path', ruleId: 'git-staged-p12' },
  { pattern: /\.pfx$/i, severity: 'critical', type: 'protected_path', ruleId: 'git-staged-pfx' },
  { pattern: /id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/, severity: 'critical', type: 'protected_path', ruleId: 'git-staged-ssh-key' },
  { pattern: /\.keystore$/i, severity: 'high', type: 'protected_path', ruleId: 'git-staged-keystore' },
  { pattern: /terraform\.tfstate(?:\.backup)?$/i, severity: 'high', type: 'protected_path', ruleId: 'git-staged-tfstate' },
  { pattern: /secrets?\.(?:json|yaml|yml)$/i, severity: 'high', type: 'protected_path', ruleId: 'git-staged-secrets-file' },
  { pattern: /credentials?\.(?:json|yaml|yml)$/i, severity: 'high', type: 'protected_path', ruleId: 'git-staged-credentials-file' },
  { pattern: /\.htpasswd$/, severity: 'high', type: 'protected_path', ruleId: 'git-staged-htpasswd' },
  { pattern: /\.npmrc$/, severity: 'medium', type: 'protected_path', ruleId: 'git-staged-npmrc' },
  { pattern: /\.pypirc$/, severity: 'medium', type: 'protected_path', ruleId: 'git-staged-pypirc' },
];

// Content patterns to scan in added lines
interface ContentRule {
  pattern: RegExp;
  severity: FindingSeverity;
  type: FindingType;
  ruleId: string;
  confidence: 'high' | 'medium' | 'low';
}

const ADDED_LINE_RULES: ContentRule[] = [
  {
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    severity: 'critical',
    type: 'cloud_credential',
    ruleId: 'git-diff-aws-key',
    confidence: 'high',
  },
  {
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}\b/g,
    severity: 'critical',
    type: 'api_key',
    ruleId: 'git-diff-github-token',
    confidence: 'high',
  },
  {
    pattern: /\bsk-(?:ant-)?[a-zA-Z0-9_-]{20,}\b/g,
    severity: 'critical',
    type: 'api_key',
    ruleId: 'git-diff-api-key',
    confidence: 'high',
  },
  {
    pattern: /-----BEGIN\s+(?:RSA\s+)?(?:PRIVATE|EC)\s+KEY-----/g,
    severity: 'critical',
    type: 'private_key',
    ruleId: 'git-diff-private-key',
    confidence: 'high',
  },
  {
    pattern: /\b(?:password|passwd|pwd)\s*[:=]\s*["'`]([^"'`\n]{8,})["'`]/gi,
    severity: 'high',
    type: 'hard_secret',
    ruleId: 'git-diff-hardcoded-password',
    confidence: 'medium',
  },
  {
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:]+:([^@]+)@[^\s]+/gi,
    severity: 'critical',
    type: 'database_credential',
    ruleId: 'git-diff-db-url',
    confidence: 'high',
  },
  {
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    severity: 'high',
    type: 'jwt',
    ruleId: 'git-diff-jwt',
    confidence: 'high',
  },
  {
    pattern: /\bxox[bpars]-[0-9a-zA-Z]{10,}\b/g,
    severity: 'high',
    type: 'api_key',
    ruleId: 'git-diff-slack-token',
    confidence: 'high',
  },
  {
    pattern: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{20,}\b/g,
    severity: 'high',
    type: 'api_key',
    ruleId: 'git-diff-stripe-key',
    confidence: 'high',
  },
  {
    pattern: /\bhttps?:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[a-zA-Z0-9]+\b/g,
    severity: 'high',
    type: 'webhook',
    ruleId: 'git-diff-webhook-url',
    confidence: 'high',
  },
];

const APPLICABLE_BOUNDARIES = new Set([
  'git.diff',
  'git.publish',
]);

interface DiffFile {
  path: string;
  isBinary: boolean;
  addedLines: Array<{ lineNumber: number; content: string; offsetInInput: number }>;
}

// Binary diffs appear as "Binary files /dev/null and b/path differ"
// or "Binary files a/old and b/new differ"
const BINARY_FILE_RE = /^Binary files (?:\/dev\/null|a\/\S+) and b\/(.+) differ$/;

function parseDiff(diffText: string): DiffFile[] {
  const files: DiffFile[] = [];
  const lines = diffText.split('\n');
  let currentFile: DiffFile | null = null;
  let addedLineNumber = 0;
  let inputOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (i > 0) {
      inputOffset += lines[i - 1].length + 1;
    }

    // Detect binary file additions (no textual diff lines for these)
    const binaryMatch = line.match(BINARY_FILE_RE);
    if (binaryMatch) {
      files.push({ path: binaryMatch[1], isBinary: true, addedLines: [] });
      currentFile = null;
      continue;
    }

    const fileMatch = line.match(/^(?:\+\+\+\s+b\/)(.+)/);
    if (fileMatch) {
      currentFile = { path: fileMatch[1], isBinary: false, addedLines: [] };
      files.push(currentFile);
      continue;
    }

    const hunkMatch = line.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if (hunkMatch) {
      addedLineNumber = parseInt(hunkMatch[1], 10);
      continue;
    }

    if (!currentFile) continue;

    if (line.startsWith('+') && !line.startsWith('+++')) {
      currentFile.addedLines.push({
        lineNumber: addedLineNumber,
        content: line.slice(1),
        offsetInInput: inputOffset + 1,
      });
      addedLineNumber++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      // Removed lines don't advance the added-side line counter
    } else if (!line.startsWith('\\')) {
      addedLineNumber++;
    }
  }

  return files;
}

export class GitPublicationScanner implements ISecretScanner {
  readonly name = 'git-publication';

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

    const diffFiles = parseDiff(input);

    // Phase 1: Check for sensitive files being committed
    for (const file of diffFiles) {
      for (const rule of SENSITIVE_FILE_RULES) {
        if (!rule.pattern.test(file.path)) continue;

        const stableId = crypto
          .createHmac('sha256', 'claui-dlp')
          .update(file.path)
          .digest('hex')
          .slice(0, 16);
        const hashPrefix = crypto
          .createHash('sha256')
          .update(file.path)
          .digest('hex')
          .slice(0, 8);

        const redaction: RedactionToken = {
          text: `<REDACTED type="${rule.type}" id="sec_${stableId}" />`,
          type: rule.type,
          stableId: `sec_${stableId}`,
          hashPrefix,
          originalLength: file.path.length,
          sourceHint: file.path,
        };

        findings.push({
          id: crypto.randomUUID(),
          ruleId: rule.ruleId,
          type: rule.type,
          severity: rule.severity,
          confidence: 'high',
          location: {
            path: file.path,
          },
          redaction,
        });

        break;
      }
    }

    // Phase 2: Scan added lines for secrets
    for (const file of diffFiles) {
      for (const addedLine of file.addedLines) {
        for (const rule of ADDED_LINE_RULES) {
          const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
          let match: RegExpExecArray | null;

          while ((match = regex.exec(addedLine.content)) !== null) {
            const matchedText = match[0];
            const absoluteOffset = addedLine.offsetInInput + match.index;

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

            const redaction: RedactionToken = {
              text: `<REDACTED type="${rule.type}" id="sec_${stableId}" />`,
              type: rule.type,
              stableId: `sec_${stableId}`,
              hashPrefix,
              originalLength: matchedText.length,
              sourceHint: file.path,
            };

            findings.push({
              id: crypto.randomUUID(),
              ruleId: rule.ruleId,
              type: rule.type,
              severity: rule.severity,
              confidence: rule.confidence,
              location: {
                byteStart: absoluteOffset,
                byteEnd: absoluteOffset + matchedText.length,
                line: addedLine.lineNumber,
                path: file.path,
              },
              redaction,
            });

            if (!rule.pattern.flags.includes('g')) break;
          }
        }
      }
    }

    return {
      findings,
      scannedBytes: Buffer.byteLength(input, 'utf-8'),
      latencyMs: performance.now() - start,
    };
  }
}
