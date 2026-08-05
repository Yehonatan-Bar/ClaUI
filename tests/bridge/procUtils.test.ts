import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveExecutable, whichSync, killTree } from '../../src/bridge-runtime/procUtils';

test('resolveExecutable: existing absolute path is returned shell-free', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claui-exe-'));
  const abs = path.join(dir, 'tool.bin');
  fs.writeFileSync(abs, '');
  const r = resolveExecutable(abs, 'fallback');
  assert.equal(r.command, abs);
  assert.equal(r.useShell, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('resolveExecutable: known location wins over PATH', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claui-exe-'));
  const known = path.join(dir, 'agy.exe');
  fs.writeFileSync(known, '');
  const r = resolveExecutable('agy', 'agy', [known]);
  assert.equal(r.command, known);
  assert.equal(r.useShell, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('resolveExecutable: never returns useShell:true', () => {
  // Even an unresolvable command must not fall back to a shell (injection guard).
  const r = resolveExecutable('definitely-not-a-real-cli-xyz', 'definitely-not-a-real-cli-xyz');
  assert.equal(r.useShell, false);
});

test('whichSync: resolves node (present in the test env)', () => {
  const resolved = whichSync('node');
  assert.ok(resolved && resolved.length > 0);
});

test('killTree: tolerates null/undefined', () => {
  assert.doesNotThrow(() => killTree(null));
  assert.doesNotThrow(() => killTree(undefined));
});
