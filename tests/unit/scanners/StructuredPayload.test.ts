import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { StructuredPayloadScanner } from '../../../src/shared/secret-protection/scanners/StructuredPayloadScanner';

describe('StructuredPayloadScanner', () => {
  it('detects JSON secret fields', () => {
    const result = new StructuredPayloadScanner().scan('{"password":"correcthorsebattery"}');
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].type, 'hard_secret');
  });

  it('detects multipart form secret fields', () => {
    const payload = [
      '------boundary',
      'Content-Disposition: form-data; name="api_key"',
      '',
      'sk-test-supersecretvalue123',
      '------boundary--',
    ].join('\r\n');

    const result = new StructuredPayloadScanner().scan(payload);

    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].ruleId, 'structured-multipart-api_key');
    assert.equal(result.findings[0].type, 'hard_secret');
  });
});
