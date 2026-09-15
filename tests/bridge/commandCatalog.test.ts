import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  BRIDGE_COMMANDS,
  findBridgeCommand,
  parseSlashCommand,
} from '../../src/bridge-runtime/commands/commandCatalog';

test('parseSlashCommand: parses name and arg', () => {
  assert.deepEqual(parseSlashCommand('/code-review --fix src/foo.ts'), {
    name: 'code-review',
    arg: '--fix src/foo.ts',
  });
});

test('parseSlashCommand: lowercases the name, trims the arg', () => {
  assert.deepEqual(parseSlashCommand('/Code-Review   '), { name: 'code-review', arg: '' });
});

test('parseSlashCommand: null for non-slash or empty text', () => {
  assert.equal(parseSlashCommand('code-review'), null);
  assert.equal(parseSlashCommand(''), null);
  assert.equal(parseSlashCommand('   '), null);
});

test('findBridgeCommand: matches canonical name', () => {
  assert.equal(findBridgeCommand('code-review')?.toolName, 'claui_code_review');
});

test('findBridgeCommand: matches alias', () => {
  assert.equal(findBridgeCommand('review')?.name, 'code-review');
});

test('findBridgeCommand: case-insensitive; unknown name returns undefined', () => {
  assert.equal(findBridgeCommand('SECURITY-REVIEW')?.name, 'security-review');
  assert.equal(findBridgeCommand('not-a-command'), undefined);
  assert.equal(findBridgeCommand(''), undefined);
});

test('BRIDGE_COMMANDS: every entry has a non-empty rubric and a unique tool name', () => {
  const toolNames = new Set<string>();
  for (const spec of BRIDGE_COMMANDS) {
    assert.ok(spec.rubric.trim().length > 0, `${spec.name} rubric should not be empty`);
    assert.ok(!toolNames.has(spec.toolName), `${spec.toolName} should be unique`);
    toolNames.add(spec.toolName);
  }
});

test('BRIDGE_COMMANDS: no duplicate or colliding canonical names/aliases', () => {
  const seen = new Set<string>();
  for (const spec of BRIDGE_COMMANDS) {
    const keys = [spec.name, ...(spec.aliases || [])].map((k) => k.toLowerCase());
    for (const key of keys) {
      assert.ok(!seen.has(key), `'${key}' is claimed by more than one command`);
      seen.add(key);
    }
  }
});
