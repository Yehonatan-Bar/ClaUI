import * as crypto from 'crypto';
import { DlpFinding, FindingType, FindingSeverity, FindingConfidence, RedactionToken } from '../types';
import { ISecretScanner, ScanContext, ScanResult } from './types';
import { SENSITIVE_KEY_PATTERNS } from '../../../particle-accelerator-runtime/SecretRedactor';

function createStableId(value: string): string {
  return crypto.createHmac('sha256', 'claui-dlp').update(value).digest('hex').slice(0, 16);
}

function createHashPrefix(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 8);
}

function createFinding(
  ruleId: string,
  type: FindingType,
  severity: FindingSeverity,
  confidence: FindingConfidence,
  match: string,
  matchIndex: number,
  input: string,
): DlpFinding {
  const stableId = createStableId(match);
  const hashPrefix = createHashPrefix(match);
  const line = input.slice(0, matchIndex).split('\n').length;

  const redaction: RedactionToken = {
    text: `<REDACTED type="env_value" id="sec_${stableId}" />`,
    type: 'env_value',
    stableId: `sec_${stableId}`,
    hashPrefix,
    originalLength: match.length,
  };

  return {
    id: crypto.randomUUID(),
    ruleId,
    type,
    severity,
    confidence,
    location: {
      byteStart: matchIndex,
      byteEnd: matchIndex + match.length,
      line,
    },
    redaction,
  };
}

const KEY_VALUE_PATTERN = /^[ \t]*([A-Z][A-Z0-9_]*)[ \t]*[:=][ \t]*["']?(.+?)["']?[ \t]*$/gm;

export class EnvValueScanner implements ISecretScanner {
  readonly name = 'env-value';

  scan(input: string, _context?: ScanContext): ScanResult {
    const start = performance.now();
    const findings: DlpFinding[] = [];

    let match: RegExpExecArray | null;
    const regex = new RegExp(KEY_VALUE_PATTERN.source, KEY_VALUE_PATTERN.flags);

    while ((match = regex.exec(input)) !== null) {
      const keyName = match[1];
      const value = match[2];

      if (value.length < 8) continue;

      const keyIsSensitive = SENSITIVE_KEY_PATTERNS.some(p => {
        const fresh = new RegExp(p.source, p.flags);
        return fresh.test(keyName);
      });

      if (!keyIsSensitive) continue;

      const valueStart = match.index + match[0].indexOf(value);
      findings.push(
        createFinding(
          `env-value-${keyName.toLowerCase()}`,
          'hard_secret',
          'high',
          'high',
          value,
          valueStart,
          input,
        ),
      );
    }

    return {
      findings,
      scannedBytes: Buffer.byteLength(input, 'utf-8'),
      latencyMs: performance.now() - start,
    };
  }
}
