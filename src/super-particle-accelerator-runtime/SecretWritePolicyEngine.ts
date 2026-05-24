import {
  SecretWritePolicyInput,
  SecretWritePolicyDecision,
  SecretFinding,
  PathRisk,
} from '../shared/super-particle-accelerator/types';
import { PathClassifier } from './PathClassifier';

function simpleGlobMatch(filePath: string, glob: string): boolean {
  const pattern = glob
    .replace(/\./g, '\\.')
    .replace(/\?/g, '<<QMARK>>')
    .replace(/\*\*/g, '<<GLOBSTAR>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<GLOBSTAR>>\//g, '(.*/)?')
    .replace(/<<GLOBSTAR>>/g, '.*')
    .replace(/<<QMARK>>/g, '.');
  return new RegExp(`^${pattern}$`).test(filePath);
}

export class SecretWritePolicyEngine {
  private pathClassifier: PathClassifier;

  constructor(pathClassifier: PathClassifier) {
    this.pathClassifier = pathClassifier;
  }

  evaluate(input: SecretWritePolicyInput): SecretWritePolicyDecision {
    if (input.findings.length === 0) {
      return { action: 'allow', reason: 'No secrets detected', findings: [], consumedExceptionIds: [] };
    }

    const pathRisk = input.filePath
      ? this.pathClassifier.classify(input.filePath, input.cwd)
      : 'unknown-repository-file';

    const actionable = input.findings.filter(f => !this.isPlaceholder(f) && f.confidence !== 'low');
    if (actionable.length === 0) {
      return {
        action: 'allow',
        reason: 'All findings are placeholders or low-confidence',
        findings: input.findings,
        consumedExceptionIds: [],
      };
    }

    // Hard deny for public/client paths — no exceptions can override
    if (pathRisk === 'public-client-code' || pathRisk === 'generated-public-artifact') {
      return this.deny(input, actionable, pathRisk,
        'Secrets must never appear in client-side or public code. No exceptions.');
    }

    // Gate 3: Allowed .env file — ONLY if confirmed gitignored
    if (pathRisk === 'local-secret-file' && input.settings.allowIgnoredEnvFiles && input.isFileGitIgnored === true) {
      return {
        action: 'audit',
        reason: 'Secret in gitignored local env file',
        findings: actionable,
        consumedExceptionIds: [],
      };
    }

    // Check exceptions
    const now = new Date().toISOString();
    const consumed: string[] = [];
    const uncovered: SecretFinding[] = [];

    for (const finding of actionable) {
      const match = input.exceptions.find(ex =>
        ex.ruleId === finding.ruleId &&
        ex.valueSha256 === finding.valueSha256 &&
        (input.filePath ? simpleGlobMatch(input.filePath, ex.filePathGlob) : false) &&
        ex.expiresAt > now &&
        ex.usedCount < ex.maxUses
      );
      if (match) {
        consumed.push(match.id);
      } else {
        uncovered.push(finding);
      }
    }

    if (uncovered.length === 0) {
      return {
        action: 'audit',
        reason: 'All findings covered by valid exceptions',
        findings: actionable,
        consumedExceptionIds: consumed,
      };
    }

    return this.deny(input, uncovered, pathRisk);
  }

  private deny(
    input: SecretWritePolicyInput,
    findings: SecretFinding[],
    pathRisk: PathRisk,
    hardReason?: string,
  ): SecretWritePolicyDecision {
    const action = hardReason ? 'deny' : (input.settings.mode === 'block' ? 'deny' : 'audit');
    return {
      action,
      reason: hardReason ?? this.buildReason(findings, pathRisk),
      remediation: this.buildRemediation(findings, pathRisk),
      findings,
      consumedExceptionIds: [],
    };
  }

  private isPlaceholder(finding: SecretFinding): boolean {
    const preview = finding.redactedPreview.toLowerCase();
    const placeholders = [
      'your_api_key', 'your-api-key', 'xxx', 'placeholder',
      'replace_me', 'insert_key', 'todo', 'changeme', 'example',
    ];
    return placeholders.some(p => preview.includes(p));
  }

  private buildReason(findings: SecretFinding[], pathRisk: PathRisk): string {
    const types = [...new Set(findings.map(f => f.type))].join(', ');
    const files = [...new Set(findings.map(f => f.filePath).filter(Boolean))].join(', ');
    return `Detected ${types} in ${files || 'unknown file'} (${pathRisk}).`;
  }

  private buildRemediation(findings: SecretFinding[], pathRisk: PathRisk): string {
    const lines = [
      'Required fix:',
      '- Move the secret to a server-side environment variable.',
      '- Use a placeholder in code, e.g. process.env.API_KEY, without the raw value.',
      '- Ensure the secret file is gitignored.',
    ];

    if (pathRisk === 'public-client-code' || pathRisk === 'generated-public-artifact') {
      lines.splice(2, 0,
        '- Expose a server-side proxy endpoint.',
        '- The browser/client should call the proxy, not the external API directly.',
      );
    }

    return lines.join('\n');
  }
}
