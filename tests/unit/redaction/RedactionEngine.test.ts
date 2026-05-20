import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { RedactionEngine } from '../../../src/shared/secret-protection/RedactionEngine';
import type { DlpFinding } from '../../../src/shared/secret-protection/types';

function makeFinding(start: number, end: number, opts?: { severity?: 'critical' | 'high' | 'medium' | 'low'; ruleId?: string }): DlpFinding {
  const stableId = `sec_${start}_${end}`;
  return {
    id: `f-${start}-${end}`,
    ruleId: opts?.ruleId ?? 'test-rule',
    type: 'api_key',
    severity: opts?.severity ?? 'high',
    confidence: 'high',
    location: { byteStart: start, byteEnd: end },
    redaction: {
      text: `<REDACTED type="api_key" id="${stableId}" />`,
      type: 'api_key',
      stableId,
      hashPrefix: 'abc',
      originalLength: end - start,
    },
  };
}

describe('RedactionEngine', () => {
  it('returns accurate replacedBytes for a single finding', () => {
    const engine = new RedactionEngine();
    const text = 'prefix SECRET_VALUE suffix';
    const finding = makeFinding(7, 19);

    const result = engine.redact(text, [finding]);
    assert.equal(result.replacedBytes, 12, 'replacedBytes should be byteEnd - byteStart');
    assert.equal(result.replacementCount, 1);
    assert.ok(!result.redacted.includes('SECRET_VALUE'));
  });

  it('returns accurate replacedBytes for multiple non-overlapping findings', () => {
    const engine = new RedactionEngine();
    const text = 'aaa SECRET1 bbb SECRET2 ccc';
    const f1 = makeFinding(4, 11);
    const f2 = makeFinding(16, 23);

    const result = engine.redact(text, [f1, f2]);
    assert.equal(result.replacedBytes, 7 + 7, 'Sum of both spans');
    assert.equal(result.replacementCount, 2);
  });

  it('handles overlapping findings by severity (higher wins)', () => {
    const engine = new RedactionEngine();
    const text = 'OVERLAP_REGION_HERE';
    const fHigh = makeFinding(0, 10, { severity: 'high' });
    const fMedOverlap = makeFinding(5, 15, { severity: 'medium' });

    const result = engine.redact(text, [fHigh, fMedOverlap]);
    assert.equal(result.replacementCount, 1, 'Only the higher severity finding should be applied');
    assert.equal(result.replacedBytes, 10, 'Only the winning span contributes');
  });

  it('returns zero replacedBytes when no findings have valid byte ranges', () => {
    const engine = new RedactionEngine();
    const noRange: DlpFinding = {
      id: 'f-no-range',
      ruleId: 'test',
      type: 'api_key',
      severity: 'high',
      confidence: 'high',
      location: {},
      redaction: { text: '<REDACTED />', type: 'api_key', stableId: 's', hashPrefix: 'x', originalLength: 5 },
    };

    const result = engine.redact('some text', [noRange]);
    assert.equal(result.replacedBytes, 0);
    assert.equal(result.replacementCount, 0);
  });
});
