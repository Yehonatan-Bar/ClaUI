import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { EntropyScanner } from '../../../src/shared/secret-protection/scanners/EntropyScanner';

describe('EntropyScanner', () => {
  it('is disabled by default', () => {
    const result = new EntropyScanner().scan('token=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef1234567890+/');
    assert.equal(result.findings.length, 0);
  });

  it('detects high entropy tokens when enabled', () => {
    const result = new EntropyScanner({ enabled: true }).scan('token=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef1234567890+/ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    assert.ok(result.findings.length > 0);
  });
});
