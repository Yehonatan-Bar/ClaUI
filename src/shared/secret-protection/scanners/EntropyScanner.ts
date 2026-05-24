import * as crypto from 'crypto';
import { DlpFinding, RedactionToken } from '../types';
import { ISecretScanner, ScanContext, ScanResult } from './types';

const MIN_TOKEN_LENGTH = 16;
const WINDOW_SIZE = 32;
const ENTROPY_THRESHOLD = 4.5;

function shannonEntropy(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  const len = s.length;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

const TOKEN_SPLITTER = /[\s,;:=\[\]{}"'`<>()]+/;

export class EntropyScanner implements ISecretScanner {
  readonly name = 'entropy';
  private readonly enabled: boolean;
  private readonly threshold: number;

  constructor(options?: { enabled?: boolean; threshold?: number }) {
    this.enabled = options?.enabled ?? false;
    this.threshold = options?.threshold ?? ENTROPY_THRESHOLD;
  }

  scan(input: string, _context?: ScanContext): ScanResult {
    const start = performance.now();

    if (!this.enabled) {
      return {
        findings: [],
        scannedBytes: Buffer.byteLength(input, 'utf-8'),
        latencyMs: performance.now() - start,
      };
    }

    const findings: DlpFinding[] = [];
    const tokens = input.split(TOKEN_SPLITTER);
    let searchOffset = 0;

    for (const token of tokens) {
      const tokenIndex = input.indexOf(token, searchOffset);
      if (tokenIndex >= 0) {
        searchOffset = tokenIndex + token.length;
      }

      if (token.length < MIN_TOKEN_LENGTH) continue;

      let maxEntropy = 0;
      for (let i = 0; i <= token.length - WINDOW_SIZE; i++) {
        const window = token.slice(i, i + WINDOW_SIZE);
        const e = shannonEntropy(window);
        if (e > maxEntropy) maxEntropy = e;
      }

      if (token.length < WINDOW_SIZE) {
        maxEntropy = shannonEntropy(token);
      }

      if (maxEntropy <= this.threshold) continue;

      const stableId = crypto
        .createHmac('sha256', 'claui-dlp')
        .update(token)
        .digest('hex')
        .slice(0, 16);
      const hashPrefix = crypto
        .createHash('sha256')
        .update(token)
        .digest('hex')
        .slice(0, 8);
      const matchStart = tokenIndex >= 0 ? tokenIndex : 0;
      const line = input.slice(0, matchStart).split('\n').length;

      const redaction: RedactionToken = {
        text: `<REDACTED type="high_entropy" id="sec_${stableId}" />`,
        type: 'high_entropy',
        stableId: `sec_${stableId}`,
        hashPrefix,
        originalLength: token.length,
      };

      findings.push({
        id: crypto.randomUUID(),
        ruleId: 'entropy-high',
        type: 'hard_secret',
        severity: 'medium',
        confidence: 'medium',
        location: {
          byteStart: matchStart,
          byteEnd: matchStart + token.length,
          line,
        },
        redaction,
      });
    }

    return {
      findings,
      scannedBytes: Buffer.byteLength(input, 'utf-8'),
      latencyMs: performance.now() - start,
    };
  }
}
