import * as crypto from 'crypto';
import { DlpFinding, RedactionToken } from '../types';
import { ISecretScanner, ScanContext, ScanResult } from './types';
import { SENSITIVE_KEY_PATTERNS } from '../../../particle-accelerator-runtime/SecretRedactor';

const JSON_KV_PATTERN = /["'](\w+)["']\s*:\s*["']([^"']+)["']/g;
const YAML_KV_PATTERN = /^[ \t]*(\w+)\s*:\s*(?:["']([^"']+)["']|(\S+.*))\s*$/gm;

const STATIC_SENSITIVE_KEYS = [
  /^password$/i,
  /^passwd$/i,
  /^secret$/i,
  /^api[_-]?key$/i,
  /^apikey$/i,
  /^token$/i,
  /^auth$/i,
  /^authorization$/i,
  /^private[_-]?key$/i,
  /^access[_-]?key$/i,
  /^credential$/i,
  /^connection[_-]?string$/i,
];

function isKeyNameSensitive(key: string): boolean {
  if (STATIC_SENSITIVE_KEYS.some(p => p.test(key))) return true;
  return SENSITIVE_KEY_PATTERNS.some(p => {
    const fresh = new RegExp(p.source, p.flags);
    return fresh.test(key);
  });
}

export class StructuredPayloadScanner implements ISecretScanner {
  readonly name = 'structured-payload';

  scan(input: string, _context?: ScanContext): ScanResult {
    const start = performance.now();
    const findings: DlpFinding[] = [];
    const seen = new Set<number>();

    this.scanPattern(input, JSON_KV_PATTERN, findings, seen);
    this.scanPattern(input, YAML_KV_PATTERN, findings, seen);

    return {
      findings,
      scannedBytes: Buffer.byteLength(input, 'utf-8'),
      latencyMs: performance.now() - start,
    };
  }

  private scanPattern(
    input: string,
    pattern: RegExp,
    findings: DlpFinding[],
    seen: Set<number>,
  ): void {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(input)) !== null) {
      const keyName = match[1];
      const value = match[2] ?? match[3];

      if (!value || value.length < 8) continue;
      if (!isKeyNameSensitive(keyName)) continue;

      const valueStart = match.index + match[0].indexOf(value);
      if (seen.has(valueStart)) continue;
      seen.add(valueStart);

      const stableId = crypto
        .createHmac('sha256', 'claui-dlp')
        .update(value)
        .digest('hex')
        .slice(0, 16);
      const hashPrefix = crypto
        .createHash('sha256')
        .update(value)
        .digest('hex')
        .slice(0, 8);
      const line = input.slice(0, valueStart).split('\n').length;

      const redaction: RedactionToken = {
        text: `<REDACTED type="structured_secret" id="sec_${stableId}" />`,
        type: 'structured_secret',
        stableId: `sec_${stableId}`,
        hashPrefix,
        originalLength: value.length,
      };

      findings.push({
        id: crypto.randomUUID(),
        ruleId: `structured-${keyName.toLowerCase()}`,
        type: 'hard_secret',
        severity: 'high',
        confidence: 'medium',
        location: {
          byteStart: valueStart,
          byteEnd: valueStart + value.length,
          line,
        },
        redaction,
      });
    }
  }
}
