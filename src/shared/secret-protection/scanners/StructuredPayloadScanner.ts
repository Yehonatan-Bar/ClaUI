import * as crypto from 'crypto';
import { DlpFinding, RedactionToken } from '../types';
import { ISecretScanner, ScanContext, ScanResult } from './types';
import { SENSITIVE_KEY_PATTERNS } from '../../../particle-accelerator-runtime/SecretRedactor';

const JSON_KV_PATTERN = /["'](\w+)["']\s*:\s*["']([^"']+)["']/g;
const YAML_KV_PATTERN = /^[ \t]*(\w+)\s*:\s*(?:["']([^"']+)["']|(\S+.*))\s*$/gm;
const MULTIPART_FIELD_PATTERN =
  /Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;[^\r\n]*)?\r?\n(?:Content-Type:[^\r\n]*\r?\n)?\r?\n([\s\S]*?)(?=\r?\n--[^\r\n]+|$)/gi;

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
    this.scanMultipart(input, findings, seen);

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
      this.addFinding(input, keyName, value, valueStart, findings, seen);
    }
  }

  private scanMultipart(
    input: string,
    findings: DlpFinding[],
    seen: Set<number>,
  ): void {
    const regex = new RegExp(MULTIPART_FIELD_PATTERN.source, MULTIPART_FIELD_PATTERN.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(input)) !== null) {
      const keyName = match[1];
      const rawValue = match[2] ?? '';
      if (!isKeyNameSensitive(keyName)) continue;

      const leadingWhitespace = rawValue.match(/^\s*/)?.[0].length ?? 0;
      const trailingWhitespace = rawValue.match(/\s*$/)?.[0].length ?? 0;
      const value = rawValue.slice(leadingWhitespace, rawValue.length - trailingWhitespace);
      if (value.length < 8) continue;

      const rawValueStart = match.index + match[0].indexOf(rawValue);
      this.addFinding(
        input,
        keyName,
        value,
        rawValueStart + leadingWhitespace,
        findings,
        seen,
        'structured-multipart',
      );
    }
  }

  private addFinding(
    input: string,
    keyName: string,
    value: string,
    valueStart: number,
    findings: DlpFinding[],
    seen: Set<number>,
    rulePrefix = 'structured',
  ): void {
    if (seen.has(valueStart)) return;
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
      ruleId: `${rulePrefix}-${keyName.toLowerCase()}`,
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
