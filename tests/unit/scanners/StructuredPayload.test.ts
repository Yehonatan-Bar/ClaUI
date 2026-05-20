import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { StructuredPayloadScanner } from '../../../src/shared/secret-protection/scanners/StructuredPayloadScanner';

describe('StructuredPayloadScanner', () => {
  it('detects JSON secret fields', () => {
    const result = new StructuredPayloadScanner().scan('{"password":"correcthorsebattery"}');
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].type, 'hard_secret');
  });
});
