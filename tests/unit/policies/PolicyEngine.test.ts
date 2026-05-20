import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PolicyEngine } from '../../../src/shared/secret-protection/PolicyEngine';
import { DEFAULT_POLICY } from '../../../src/shared/secret-protection/policySchema';
import type { DlpException, DlpFinding } from '../../../src/shared/secret-protection/types';

const findingApiKey: DlpFinding = {
  id: 'f1',
  ruleId: 'unit-api-key',
  type: 'api_key',
  severity: 'high',
  confidence: 'high',
  location: { byteStart: 0, byteEnd: 10 },
  redaction: { text: '<REDACTED />', type: 'api_key', stableId: 'sec_1', hashPrefix: 'abc', originalLength: 10 },
};

const findingPrivateKey: DlpFinding = {
  id: 'f2',
  ruleId: 'unit-private-key',
  type: 'private_key',
  severity: 'critical',
  confidence: 'high',
  location: { byteStart: 20, byteEnd: 40 },
  redaction: { text: '<REDACTED />', type: 'private_key', stableId: 'sec_2', hashPrefix: 'def', originalLength: 20 },
};

const destination = { kind: 'mcp_server' as const, trustTier: 'unknown_remote' as const };

function makeException(ruleId: string, destKind = 'mcp_server' as const): DlpException {
  return {
    id: `ex-${ruleId}`,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    userId: 'test',
    workspaceHash: 'ws',
    provider: 'claude',
    destination: { kind: destKind, trustTier: 'unknown_remote' as const },
    ruleId,
    maxUses: 10,
    usedCount: 0,
  };
}

describe('PolicyEngine', () => {
  it('blocks API keys bound for remote model providers', () => {
    const decision = new PolicyEngine({ ...DEFAULT_POLICY, mode: 'balanced' }).evaluate(
      'prompt.submit',
      { kind: 'remote_model_provider', trustTier: 'trusted_org' },
      [findingApiKey],
      [],
      'hash',
    );
    assert.equal(decision.action, 'block');
  });

  it('tracks consumedExceptionIds when exception covers a finding', () => {
    const engine = new PolicyEngine({ ...DEFAULT_POLICY, mode: 'balanced' });
    const exception = makeException('unit-api-key');

    const decision = engine.evaluate(
      'mcp.request', destination, [findingApiKey], [exception], 'hash',
    );
    assert.ok(decision.consumedExceptionIds, 'Should have consumedExceptionIds');
    assert.equal(decision.consumedExceptionIds!.length, 1);
    assert.equal(decision.consumedExceptionIds![0], 'ex-unit-api-key');
    assert.equal(decision.action, 'allow');
  });

  it('still reports consumedExceptionIds when overall action is block from mixed findings', () => {
    const engine = new PolicyEngine({ ...DEFAULT_POLICY, mode: 'balanced' });
    const exceptionForApiKey = makeException('unit-api-key');

    const decision = engine.evaluate(
      'mcp.request', destination, [findingApiKey, findingPrivateKey],
      [exceptionForApiKey], 'hash',
    );
    assert.equal(decision.action, 'block', 'Uncovered private_key should cause block');
    assert.ok(decision.consumedExceptionIds, 'consumedExceptionIds set even on block');
    assert.equal(decision.consumedExceptionIds!.length, 1);
  });

  it('allows when all findings covered by exceptions', () => {
    const engine = new PolicyEngine({ ...DEFAULT_POLICY, mode: 'balanced' });

    const decision = engine.evaluate(
      'mcp.request', destination, [findingApiKey, findingPrivateKey],
      [makeException('unit-api-key'), makeException('unit-private-key')], 'hash',
    );
    assert.equal(decision.action, 'allow');
    assert.equal(decision.consumedExceptionIds!.length, 2);
  });
});
