import * as crypto from 'crypto';
import { DlpFinding, FindingSeverity, FindingType, RedactionToken } from '../types';
import { ISecretScanner, ScanContext, ScanResult } from './types';

interface PathRule {
  pattern: RegExp;
  severity: FindingSeverity;
  type: FindingType;
  ruleId: string;
}

const PATH_RULES: PathRule[] = [
  // Critical - env files (standalone or with extension)
  { pattern: /(?:^|\/)\.env(?:\.[a-zA-Z0-9_-]+)?$/,  severity: 'critical', type: 'protected_path', ruleId: 'path-dotenv' },
  { pattern: /\.pem$/i,                                severity: 'critical', type: 'protected_path', ruleId: 'path-pem' },
  { pattern: /\.key$/i,                                severity: 'critical', type: 'protected_path', ruleId: 'path-key-file' },
  { pattern: /\.p12$/i,                                severity: 'critical', type: 'protected_path', ruleId: 'path-p12' },
  { pattern: /\.pfx$/i,                                severity: 'critical', type: 'protected_path', ruleId: 'path-pfx' },
  { pattern: /(?:^|\/)\.ssh(?:\/|$)/,                  severity: 'critical', type: 'protected_path', ruleId: 'path-ssh' },

  // High
  { pattern: /(?:^|\/)\.aws(?:\/|$)/,                  severity: 'high', type: 'protected_path', ruleId: 'path-aws-config' },
  { pattern: /(?:^|\/)\.azure(?:\/|$)/,                severity: 'high', type: 'protected_path', ruleId: 'path-azure-config' },
  { pattern: /(?:^|\/)\.kube\/config/,                 severity: 'high', type: 'protected_path', ruleId: 'path-kube-config' },
  { pattern: /terraform\.tfstate/,                     severity: 'high', type: 'protected_path', ruleId: 'path-tfstate' },
  { pattern: /(?:^|\/)secrets[^/\\]*\.json/i,          severity: 'high', type: 'protected_path', ruleId: 'path-secrets-json' },
  { pattern: /(?:^|\/)credentials[^/\\]*\.(?:json|yaml|yml)/i, severity: 'high', type: 'protected_path', ruleId: 'path-credentials' },

  // Medium - agent control files
  { pattern: /(?:^|\/)\.claude(?:\/|$)/,               severity: 'medium', type: 'agent_control_file', ruleId: 'path-claude-config' },
  { pattern: /(?:^|\/)\.codex(?:\/|$)/,                severity: 'medium', type: 'agent_control_file', ruleId: 'path-codex-config' },
  { pattern: /(?:^|\/)\.cursor(?:\/|$)/,               severity: 'medium', type: 'agent_control_file', ruleId: 'path-cursor-config' },

  // Medium - git control files
  { pattern: /(?:^|\/)\.git(?:\/|$)/,                  severity: 'medium', type: 'git_control_file', ruleId: 'path-git-dir' },
];

// Finder 1: Absolute paths (/foo/bar.ext, C:\foo\bar.ext)
// Finder 2: Tilde paths (~/foo/bar)
// Finder 3: Relative paths (./foo, ../foo)
// Finder 4: Dot-prefixed bare names (.env, .ssh/id_rsa, .claude/settings.json)
// Finder 5: Bare filenames with sensitive extensions (private.pem, server.key, cert.p12)
// Finder 6: Specific sensitive filenames (terraform.tfstate, secrets.json, credentials.json)
const PATH_FINDERS: RegExp[] = [
  /(?:[A-Za-z]:)?(?:[/\\][\w._-]+)+(?:\.[a-zA-Z0-9]+)?/g,
  /~[/\\][\w._\-/\\]+/g,
  /\.\.?[/\\][\w._\-/\\]+/g,
  /(?:^|(?<=\s|["'`(,=]))\.(?:env|ssh|aws|azure|kube|claude|codex|cursor|git)(?:[/\\][\w._-]*)*(?:\.[a-zA-Z0-9_-]+)?/gm,
  /(?:^|(?<=\s|["'`(,=]))[\w.-]+\.(?:pem|key|p12|pfx)\b/gm,
  /(?:^|(?<=\s|["'`(,=]))(?:terraform\.tfstate(?:\.backup)?|(?:secrets|credentials)[\w.-]*\.(?:json|yaml|yml))\b/gm,
];

export class PathSensitivityClassifier implements ISecretScanner {
  readonly name = 'path-sensitivity';

  scan(input: string, _context?: ScanContext): ScanResult {
    const start = performance.now();
    const findings: DlpFinding[] = [];
    const seen = new Set<string>();

    for (const finderPattern of PATH_FINDERS) {
      const regex = new RegExp(finderPattern.source, finderPattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(input)) !== null) {
        const pathStr = match[0];
        if (seen.has(pathStr)) continue;
        seen.add(pathStr);

        const normalized = pathStr.replace(/\\/g, '/');

        for (const rule of PATH_RULES) {
          if (!rule.pattern.test(normalized)) continue;

          const matchIndex = match.index;
          const line = input.slice(0, matchIndex).split('\n').length;
          const stableId = crypto
            .createHmac('sha256', 'claui-dlp')
            .update(pathStr)
            .digest('hex')
            .slice(0, 16);
          const hashPrefix = crypto
            .createHash('sha256')
            .update(pathStr)
            .digest('hex')
            .slice(0, 8);

          const redaction: RedactionToken = {
            text: `<REDACTED type="${rule.type}" id="sec_${stableId}" />`,
            type: rule.type,
            stableId: `sec_${stableId}`,
            hashPrefix,
            originalLength: pathStr.length,
          };

          findings.push({
            id: crypto.randomUUID(),
            ruleId: rule.ruleId,
            type: rule.type,
            severity: rule.severity,
            confidence: 'high',
            location: {
              byteStart: matchIndex,
              byteEnd: matchIndex + pathStr.length,
              line,
              path: pathStr,
            },
            redaction,
          });

          break;
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
