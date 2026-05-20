import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { classifyCommandRisk } from '../../../src/shared/secret-protection/CommandRiskClassifier';

describe('classifyCommandRisk', () => {
  it('detects credential discovery', () => {
    const result = classifyCommandRisk('cat .env');
    assert.ok(result.classes.includes('credential_discovery'));
    assert.equal(result.requiresApproval, true);
  });
});
