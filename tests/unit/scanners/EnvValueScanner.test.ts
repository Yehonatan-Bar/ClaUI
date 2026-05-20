import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { EnvValueScanner } from '../../../src/shared/secret-protection/scanners/EnvValueScanner';

describe('EnvValueScanner', () => {
  it('detects sensitive environment-style values', () => {
    const result = new EnvValueScanner().scan('API_TOKEN=supersecretvalue123');
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].type, 'hard_secret');
    assert.equal(result.findings[0].severity, 'high');
  });

  it('ignores short values', () => {
    const result = new EnvValueScanner().scan('API_TOKEN=short');
    assert.equal(result.findings.length, 0);
  });
});
