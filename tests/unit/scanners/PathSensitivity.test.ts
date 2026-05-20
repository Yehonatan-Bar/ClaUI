import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PathSensitivityClassifier } from '../../../src/shared/secret-protection/scanners/PathSensitivityClassifier';

describe('PathSensitivityClassifier', () => {
  it('flags protected path references', () => {
    const result = new PathSensitivityClassifier().scan('read .env.production before deploy');
    assert.ok(result.findings.some((finding) => finding.ruleId === 'path-dotenv'));
  });
});
