import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ApprovalEngine } from '../../../src/server/enforcement/ApprovalEngine';
import type { DlpException, DlpFinding } from '../../../src/shared/secret-protection/types';

const findingA: DlpFinding = {
  id: 'f1',
  ruleId: 'unit-private-key',
  type: 'private_key',
  severity: 'critical',
  confidence: 'high',
  location: { byteStart: 0, byteEnd: 10 },
  redaction: { text: '<REDACTED />', type: 'private_key', stableId: 'sec_1', hashPrefix: 'abc', originalLength: 10 },
};

const findingB: DlpFinding = {
  id: 'f2',
  ruleId: 'unit-api-key',
  type: 'api_key',
  severity: 'high',
  confidence: 'high',
  location: { byteStart: 20, byteEnd: 40 },
  redaction: { text: '<REDACTED />', type: 'api_key', stableId: 'sec_2', hashPrefix: 'def', originalLength: 20 },
};

const destination = { kind: 'mcp_server' as const, trustTier: 'unknown_remote' as const };

function makeException(ruleId: string): DlpException {
  return {
    id: `ex-${ruleId}`,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    userId: 'test',
    workspaceHash: 'ws',
    provider: 'claude',
    destination,
    ruleId,
    maxUses: 10,
    usedCount: 0,
  };
}

describe('ApprovalEngine', () => {
  it('fails closed for strict critical findings', () => {
    const result = new ApprovalEngine({ mode: 'strict' }).evaluate(
      'mcp.request',
      destination,
      [findingA],
    );
    assert.equal(result.allowed, false);
    assert.equal(result.action, 'block');
  });

  it('blocks when only one of two findings has an exception', () => {
    const engine = new ApprovalEngine({ mode: 'balanced' });
    const exceptionForA = makeException('unit-private-key');

    const baseDecision = {
      action: 'block' as const,
      reason: 'Blocked: api_key (unit-api-key)',
      findings: [findingA, findingB],
      audit: {
        id: 'a1', timestamp: new Date().toISOString(), boundary: 'mcp.request' as const,
        action: 'block' as const, ruleIds: ['unit-private-key', 'unit-api-key'],
        findingTypes: ['private_key', 'api_key'], severityMax: 'critical' as const,
        destinationKind: 'mcp_server' as const, contentHash: 'h', redactedBytes: 0, redactionCount: 0,
      },
    };

    const result = engine.evaluate(
      'mcp.request', destination, [findingA, findingB], baseDecision, [exceptionForA],
    );
    assert.equal(result.allowed, false, 'Partial exception coverage must not allow the request');
    assert.equal(result.action, 'block');
  });

  it('allows when ALL findings are covered by exceptions', () => {
    const engine = new ApprovalEngine({ mode: 'balanced' });

    const result = engine.evaluate(
      'mcp.request', destination, [findingA, findingB], undefined,
      [makeException('unit-private-key'), makeException('unit-api-key')],
    );
    assert.equal(result.allowed, true);
    assert.ok(result.reason.includes('covered by exceptions'));
  });

  it('does not allow with expired exception', () => {
    const engine = new ApprovalEngine({ mode: 'balanced' });
    const expired = makeException('unit-private-key');
    expired.expiresAt = new Date(Date.now() - 1000).toISOString();

    const baseDecision = {
      action: 'block' as const,
      reason: 'blocked',
      findings: [findingA],
      audit: {
        id: 'a1', timestamp: new Date().toISOString(), boundary: 'mcp.request' as const,
        action: 'block' as const, ruleIds: ['unit-private-key'],
        findingTypes: ['private_key'], severityMax: 'critical' as const,
        destinationKind: 'mcp_server' as const, contentHash: 'h', redactedBytes: 0, redactionCount: 0,
      },
    };

    const result = engine.evaluate(
      'mcp.request', destination, [findingA], baseDecision, [expired],
    );
    assert.equal(result.allowed, false);
  });

  it('does not allow with exhausted exception', () => {
    const engine = new ApprovalEngine({ mode: 'balanced' });
    const exhausted = makeException('unit-private-key');
    exhausted.usedCount = exhausted.maxUses;

    const baseDecision = {
      action: 'block' as const,
      reason: 'blocked',
      findings: [findingA],
      audit: {
        id: 'a1', timestamp: new Date().toISOString(), boundary: 'mcp.request' as const,
        action: 'block' as const, ruleIds: ['unit-private-key'],
        findingTypes: ['private_key'], severityMax: 'critical' as const,
        destinationKind: 'mcp_server' as const, contentHash: 'h', redactedBytes: 0, redactionCount: 0,
      },
    };

    const result = engine.evaluate(
      'mcp.request', destination, [findingA], baseDecision, [exhausted],
    );
    assert.equal(result.allowed, false);
  });

  it('returns all consumed exceptions when multiple findings covered by different exceptions', () => {
    const engine = new ApprovalEngine({ mode: 'balanced' });
    const exA = makeException('unit-private-key');
    const exB = makeException('unit-api-key');

    const result = engine.evaluate(
      'mcp.request', destination, [findingA, findingB], undefined, [exA, exB],
    );
    assert.equal(result.allowed, true);
    assert.ok(result.consumedExceptions, 'Should return consumedExceptions array');
    assert.equal(result.consumedExceptions!.length, 2, 'Both exceptions should be returned');
    const ids = result.consumedExceptions!.map(e => e.id).sort();
    assert.deepEqual(ids, ['ex-unit-api-key', 'ex-unit-private-key']);
  });

  it('deduplicates when one exception covers multiple findings with same ruleId', () => {
    const engine = new ApprovalEngine({ mode: 'balanced' });
    const findingA2: DlpFinding = {
      ...findingA,
      id: 'f1-dup',
      location: { byteStart: 50, byteEnd: 60 },
    };
    const ex = makeException('unit-private-key');

    const result = engine.evaluate(
      'mcp.request', destination, [findingA, findingA2], undefined, [ex],
    );
    assert.equal(result.allowed, true);
    assert.equal(result.consumedExceptions!.length, 1, 'Same exception should not be duplicated');
  });
});
