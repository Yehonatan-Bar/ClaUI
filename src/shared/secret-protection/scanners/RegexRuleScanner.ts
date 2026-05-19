import * as crypto from 'crypto';
import { DlpFinding, FindingType, FindingSeverity, RedactionToken } from '../types';
import { ISecretScanner, ScanContext, ScanResult } from './types';
import { REGEX_RULES } from '../../../particle-accelerator-runtime/SecretRedactor';
import { RulePackDefinition } from '../rules/types';

const TYPE_MAP: Record<string, FindingType> = {
  'github-classic-pat': 'api_key',
  'github-fine-grained': 'api_key',
  'aws-access-key': 'cloud_credential',
  'aws-secret-key': 'cloud_credential',
  'jwt': 'jwt',
  'openai-key': 'api_key',
  'anthropic-key': 'api_key',
  'slack-token': 'api_key',
  'stripe-key': 'api_key',
  'google-api-key': 'api_key',
  'private-key-block': 'private_key',
  'basic-auth-url': 'database_credential',
  'db-url-creds': 'database_credential',
  'bearer-token': 'api_key',
};

const CRITICAL_RULES = new Set([
  'private-key-block',
  'aws-access-key',
  'aws-secret-key',
]);

interface ResolvedRule {
  name: string;
  pattern: RegExp;
  severity: FindingSeverity;
  type: FindingType;
}

function resolveBuiltinRule(name: string, pattern: RegExp): ResolvedRule {
  return {
    name,
    pattern,
    severity: CRITICAL_RULES.has(name) ? 'critical' : 'high',
    type: TYPE_MAP[name] ?? 'hard_secret',
  };
}

function resolveRulePackRules(packs: RulePackDefinition[]): ResolvedRule[] {
  const rules: ResolvedRule[] = [];
  for (const pack of packs) {
    if (!pack.enabled) continue;
    for (const rule of pack.rules) {
      if (rule.pattern && rule.scanner === 'regex-rule') {
        rules.push({
          name: rule.id,
          pattern: rule.pattern,
          severity: rule.severity,
          type: rule.type ?? TYPE_MAP[rule.id] ?? 'hard_secret',
        });
      }
    }
  }
  return rules;
}

export class RegexRuleScanner implements ISecretScanner {
  readonly name = 'regex-rule';
  private readonly allRules: ResolvedRule[];

  constructor(rulePacks?: RulePackDefinition[]) {
    const builtinRules = REGEX_RULES.map((r) => resolveBuiltinRule(r.name, r.pattern));
    const packRules = rulePacks ? resolveRulePackRules(rulePacks) : [];

    // Deduplicate by both name AND regex pattern source to avoid
    // double-matches from packs with different IDs but identical regexes
    // (e.g. built-in 'openai-key' vs pack 'openai-api-key').
    const seenIds = new Set(builtinRules.map((r) => r.name));
    const seenPatterns = new Set(builtinRules.map((r) => r.pattern.source));

    const deduped = packRules.filter((r) => {
      if (seenIds.has(r.name)) return false;
      if (seenPatterns.has(r.pattern.source)) return false;
      seenIds.add(r.name);
      seenPatterns.add(r.pattern.source);
      return true;
    });

    this.allRules = [...builtinRules, ...deduped];
  }

  scan(input: string, _context?: ScanContext): ScanResult {
    const start = performance.now();
    const findings: DlpFinding[] = [];

    for (const rule of this.allRules) {
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
          ruleId: `regex-${rule.name}`,
          type: rule.type,
          severity: rule.severity,
          confidence: 'high',
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
