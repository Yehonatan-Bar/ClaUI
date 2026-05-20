import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PiiAndInternalTopologyScanner } from '../../../src/shared/secret-protection/scanners/PiiAndInternalTopologyScanner';

describe('PiiAndInternalTopologyScanner', () => {
  it('detects internal topology values', () => {
    const result = new PiiAndInternalTopologyScanner().scan('service is at 10.12.3.4 and api.internal');
    assert.ok(result.findings.some((finding) => finding.type === 'internal_topology'));
  });
});
