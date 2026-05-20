import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { RegexRuleScanner } from '../../../src/shared/secret-protection/scanners/RegexRuleScanner';

describe('RegexRuleScanner', () => {
  it('detects JWT tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const result = new RegexRuleScanner().scan(`Authorization: Bearer ${jwt}`);
    assert.ok(result.findings.some((finding) => finding.type === 'jwt'));
  });
});
