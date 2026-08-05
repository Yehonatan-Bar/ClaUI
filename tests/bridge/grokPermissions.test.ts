import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { isReadOnlyGrokKind } from '../../src/bridge-runtime/backends/grokAcp';

test('isReadOnlyGrokKind: read-only kinds auto-approve under supervised', () => {
  for (const kind of ['read', 'search', 'fetch', 'think']) {
    assert.equal(isReadOnlyGrokKind(kind), true, `${kind} should be read-only`);
  }
});

test('isReadOnlyGrokKind: mutating/executing kinds are NOT read-only', () => {
  for (const kind of ['execute', 'edit', 'delete', 'move', 'other']) {
    assert.equal(isReadOnlyGrokKind(kind), false, `${kind} should not be read-only`);
  }
});

test('isReadOnlyGrokKind: unknown/empty is treated as not read-only (deny-by-default)', () => {
  assert.equal(isReadOnlyGrokKind(''), false);
  assert.equal(isReadOnlyGrokKind(undefined), false);
  assert.equal(isReadOnlyGrokKind(null), false);
  assert.equal(isReadOnlyGrokKind('something-new'), false);
});
