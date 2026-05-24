import { CompositeSecretScanner } from '../shared/secret-protection/scanners/CompositeSecretScanner';
import { ScanContext } from '../shared/secret-protection/scanners/types';
import { DlpFinding, FindingType } from '../shared/secret-protection/types';
import { SecretScanInput, SecretFinding, SecretFindingType } from '../shared/super-particle-accelerator/types';
import { createHash } from 'crypto';

const FINDING_TYPE_MAP: Record<string, SecretFindingType> = {
  api_key: 'google_api_key',
  hard_secret: 'generic_high_entropy_secret',
  private_key: 'private_key',
  cloud_credential: 'aws_access_key',
  database_credential: 'database_url',
  jwt: 'jwt',
};

export class SpaSecretScanner {
  private scanner: CompositeSecretScanner;

  constructor(entropyThreshold?: number) {
    this.scanner = new CompositeSecretScanner({
      enabled: true,
      mode: 'balanced',
      enableEntropyScanner: true,
      entropyThreshold,
      blockProtectedPaths: false,
      scanTerminalOutput: false,
      scanPrompts: false,
      scanMcp: false,
      scanGitPublication: false,
      requireBrowserCaptureApproval: false,
      exceptionMaxMinutes: 30,
      auditRetentionDays: 90,
    });
  }

  scan(input: SecretScanInput): SecretFinding[] {
    const context: ScanContext = {
      boundary: 'persistence.write',
      destination: {
        kind: 'local_disk',
        trustTier: 'trusted_local',
      },
      filePath: input.filePath,
    };

    const result = this.scanner.scan(input.text, context);

    return result.findings.map(f => ({
      ruleId: f.ruleId,
      type: this.mapFindingType(f.ruleId, f.type),
      severity: f.severity,
      confidence: f.confidence,
      filePath: input.filePath,
      line: f.location.line,
      column: f.location.byteStart,
      redactedPreview: SpaSecretScanner.redact(this.extractMatchedValue(f, input.text)),
      valueSha256: createHash('sha256')
        .update(this.extractMatchedValue(f, input.text))
        .digest('hex'),
    }));
  }

  private extractMatchedValue(finding: DlpFinding, text: string): string {
    if (finding.location.byteStart !== undefined && finding.location.byteEnd !== undefined) {
      return text.slice(finding.location.byteStart, finding.location.byteEnd);
    }
    return finding.redaction?.text ?? '';
  }

  private mapFindingType(ruleId: string, type: FindingType): SecretFindingType {
    const lower = ruleId.toLowerCase();
    if (lower.includes('google') || lower.includes('gcp')) return 'google_api_key';
    if (lower.includes('openai')) return 'openai_api_key';
    if (lower.includes('anthropic') || lower.includes('claude')) return 'anthropic_api_key';
    if (lower.includes('github') || lower.includes('ghp')) return 'github_token';
    if (lower.includes('aws') || lower.includes('akia')) return 'aws_access_key';
    if (lower.includes('azure')) return 'azure_key';
    if (lower.includes('supabase')) return 'supabase_key';
    if (lower.includes('jwt') || lower.includes('token')) return 'jwt';
    if (lower.includes('private_key') || lower.includes('rsa')) return 'private_key';
    if (lower.includes('database') || lower.includes('postgres') || lower.includes('mysql') || lower.includes('mongodb')) return 'database_url';
    return FINDING_TYPE_MAP[type] ?? 'generic_high_entropy_secret';
  }

  static redact(value: string): string {
    if (value.length <= 12) return '***';
    const maxRevealed = Math.min(8, Math.floor(value.length * 0.25));
    const prefixLen = Math.ceil(maxRevealed * 0.6);
    const suffixLen = maxRevealed - prefixLen;
    return value.slice(0, prefixLen) + '***' + value.slice(-suffixLen);
  }
}
