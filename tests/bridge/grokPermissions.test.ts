import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { isKnownWriteGrokKind, isReadOnlyGrokKind, shouldPermitGrokTool } from '../../src/bridge-runtime/backends/grokAcp';

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

test('isKnownWriteGrokKind: recognizes exactly the write/execute kinds', () => {
  for (const kind of ['execute', 'edit', 'delete', 'move']) {
    assert.equal(isKnownWriteGrokKind(kind), true, `${kind} should be a known write kind`);
  }
  for (const kind of ['read', 'search', 'fetch', 'think', 'other', '', undefined, null]) {
    assert.equal(isKnownWriteGrokKind(kind), false, `${kind} should NOT be a known write kind`);
  }
});

// ---------------------------------------------------------------------------
// shouldPermitGrokTool — the actual permission decision (Section 6 write
// window). Deny-first: an open window only expands the allowlist to KNOWN
// write kinds, it never blanket-approves everything.
// ---------------------------------------------------------------------------

test('shouldPermitGrokTool: supervised + read-only kind is always permitted, window state irrelevant', () => {
  assert.equal(shouldPermitGrokTool('supervised', 'read', false), true);
  assert.equal(shouldPermitGrokTool('supervised', 'read', true), true);
});

test('shouldPermitGrokTool: supervised + write kind is denied while the window is closed', () => {
  for (const kind of ['execute', 'edit', 'delete', 'move']) {
    assert.equal(shouldPermitGrokTool('supervised', kind, false), false, kind);
  }
});

test('shouldPermitGrokTool: supervised + write kind is permitted while the window is open', () => {
  for (const kind of ['execute', 'edit', 'delete', 'move']) {
    assert.equal(shouldPermitGrokTool('supervised', kind, true), true, kind);
  }
});

test('shouldPermitGrokTool: an open window does NOT blanket-approve an unknown/unrecognized kind (the exact regression this fixes)', () => {
  assert.equal(shouldPermitGrokTool('supervised', 'other', true), false);
  assert.equal(shouldPermitGrokTool('supervised', undefined, true), false);
  assert.equal(shouldPermitGrokTool('supervised', 'some-future-kind', true), false);
});

test('shouldPermitGrokTool: full-access mode permits everything, matching pre-existing behavior', () => {
  assert.equal(shouldPermitGrokTool('full-access', 'execute', false), true);
  assert.equal(shouldPermitGrokTool('full-access', 'other', false), true);
});

test('shouldPermitGrokTool: an unexpected/future permission-mode value defaults to the MORE restrictive supervised path, not full-access', () => {
  // Exact `=== 'full-access'` match, not `!== 'supervised'` — an unrecognized
  // mode string must never be silently treated as equivalent to full-access.
  assert.equal(shouldPermitGrokTool('some-future-mode', 'read', false), true); // still read-only-permitted
  assert.equal(shouldPermitGrokTool('some-future-mode', 'execute', false), false);
  assert.equal(shouldPermitGrokTool('some-future-mode', 'execute', true), true); // write window still applies
});
