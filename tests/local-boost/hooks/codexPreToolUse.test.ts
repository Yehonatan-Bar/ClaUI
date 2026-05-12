import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { classifyCommand } from '../../../src/local-boost-runtime/CommandEligibility';

/**
 * Tests for the Codex PreToolUse hook logic.
 *
 * The Codex hook differs from the Claude hook: instead of rewriting the command
 * with permissionDecision='allow', it uses permissionDecision='deny' with a
 * reason string that instructs the model to retry with the wrapped command.
 *
 * Core logic:
 *   1. classifyCommand (same as Claude hook)
 *   2. base64url encoding of the command
 *   3. Building the deny reason with retry instruction
 *   4. passthrough for non-eligible / non-Bash tools
 */

// Replicate the base64url encoding logic used in the hook
function base64urlEncode(command: string): string {
  return Buffer.from(command, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Simulate the hook's decision logic for a given tool_name and command
function simulateCodexHook(toolName: string, command: string): { action: 'passthrough' } | { action: 'deny'; reason: string; encoded: string } {
  // Non-Bash tools: passthrough
  if (toolName !== 'Bash') {
    return { action: 'passthrough' };
  }

  // Empty command: passthrough
  if (!command) {
    return { action: 'passthrough' };
  }

  // Already wrapped: passthrough
  if (command.startsWith('claui-run') || command.includes('CLAUI_LOCAL_BOOST_BYPASS=1')) {
    return { action: 'passthrough' };
  }

  const result = classifyCommand(command);
  if (!result.eligible) {
    return { action: 'passthrough' };
  }

  const encoded = base64urlEncode(command);
  const reason = `This command should be routed through ClaUi local compression. Retry exactly as: claui-run --claui-encoded-shell-command ${encoded}`;

  return { action: 'deny', reason, encoded };
}

describe('codexPreToolUse hook logic', () => {

  // ── Eligible commands produce 'deny' with retry instruction ───────────

  it('denies npm test with a retry instruction containing encoded command', () => {
    const result = simulateCodexHook('Bash', 'npm test');
    assert.equal(result.action, 'deny');
    if (result.action === 'deny') {
      assert.ok(result.reason.includes('claui-run --claui-encoded-shell-command'));
      // Verify the encoded command in the reason decodes correctly
      const decoded = Buffer.from(result.encoded, 'base64url').toString('utf8');
      assert.equal(decoded, 'npm test');
    }
  });

  it('denies pytest with retry instruction', () => {
    const result = simulateCodexHook('Bash', 'pytest');
    assert.equal(result.action, 'deny');
    if (result.action === 'deny') {
      const decoded = Buffer.from(result.encoded, 'base64url').toString('utf8');
      assert.equal(decoded, 'pytest');
    }
  });

  it('denies cargo build with retry instruction', () => {
    const result = simulateCodexHook('Bash', 'cargo build');
    assert.equal(result.action, 'deny');
    if (result.action === 'deny') {
      const decoded = Buffer.from(result.encoded, 'base64url').toString('utf8');
      assert.equal(decoded, 'cargo build');
    }
  });

  // ── Deny reason format ────────────────────────────────────────────────

  it('deny reason starts with routing explanation', () => {
    const result = simulateCodexHook('Bash', 'npm test');
    assert.equal(result.action, 'deny');
    if (result.action === 'deny') {
      assert.ok(
        result.reason.startsWith('This command should be routed through ClaUi local compression.'),
        `unexpected reason prefix: ${result.reason.substring(0, 60)}`,
      );
    }
  });

  it('deny reason contains "Retry exactly as:" instruction', () => {
    const result = simulateCodexHook('Bash', 'jest');
    assert.equal(result.action, 'deny');
    if (result.action === 'deny') {
      assert.ok(result.reason.includes('Retry exactly as:'), 'reason should contain retry instruction');
    }
  });

  // ── Codex vs Claude: permissionDecision difference ────────────────────

  it('uses deny (not allow) for eligible commands', () => {
    // This is the key difference from the Claude hook
    const result = simulateCodexHook('Bash', 'npm test');
    assert.equal(result.action, 'deny', 'Codex hook should deny, not allow');
  });

  it('does not include updatedInput (Codex denies, does not rewrite)', () => {
    const result = simulateCodexHook('Bash', 'npm test');
    assert.equal(result.action, 'deny');
    if (result.action === 'deny') {
      // Simulate the actual HookOutput structure
      const output = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: result.reason,
        },
      };
      // Codex output has no updatedInput field
      assert.equal((output.hookSpecificOutput as any).updatedInput, undefined);
    }
  });

  // ── Base64url encoding correctness ────────────────────────────────────

  it('base64url encoding does not contain +, /, or trailing =', () => {
    const tricky = 'npm test --reporter=json --coverage';
    const encoded = base64urlEncode(tricky);
    assert.ok(!encoded.includes('+'), 'should not contain +');
    assert.ok(!encoded.includes('/'), 'should not contain /');
    assert.ok(!encoded.endsWith('='), 'should not end with =');
  });

  it('base64url encoding round-trips for eligible commands', () => {
    const commands = [
      'npm test',
      'go test ./...',
      'cargo build --release',
      'git diff HEAD~3',
    ];
    for (const cmd of commands) {
      const classification = classifyCommand(cmd);
      if (!classification.eligible) continue;
      const encoded = base64urlEncode(cmd);
      const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
      assert.equal(decoded, cmd, `round-trip failed for: ${cmd}`);
    }
  });

  // ── Non-Bash tools are passthrough ────────────────────────────────────

  it('passes through for Read tool', () => {
    const result = simulateCodexHook('Read', '/some/file.ts');
    assert.equal(result.action, 'passthrough');
  });

  it('passes through for Write tool', () => {
    const result = simulateCodexHook('Write', 'content');
    assert.equal(result.action, 'passthrough');
  });

  it('passes through for Edit tool', () => {
    const result = simulateCodexHook('Edit', 'some edit');
    assert.equal(result.action, 'passthrough');
  });

  // ── Non-eligible Bash commands are passthrough ────────────────────────

  it('passes through for ssh (deny list)', () => {
    const result = simulateCodexHook('Bash', 'ssh user@host');
    assert.equal(result.action, 'passthrough');
  });

  it('passes through for vim (deny list)', () => {
    const result = simulateCodexHook('Bash', 'vim file.txt');
    assert.equal(result.action, 'passthrough');
  });

  it('passes through for npm run dev (deny list)', () => {
    const result = simulateCodexHook('Bash', 'npm run dev');
    assert.equal(result.action, 'passthrough');
  });

  it('passes through for unknown commands (not in allow list)', () => {
    const result = simulateCodexHook('Bash', 'some-random-binary');
    assert.equal(result.action, 'passthrough');
  });

  it('passes through for piped commands', () => {
    const result = simulateCodexHook('Bash', 'npm test | grep FAIL');
    assert.equal(result.action, 'passthrough');
  });

  // ── Already-wrapped commands are passthrough ──────────────────────────

  it('passes through if command starts with claui-run', () => {
    const result = simulateCodexHook('Bash', 'claui-run --claui-encoded-shell-command abc123');
    assert.equal(result.action, 'passthrough');
  });

  it('passes through if command contains CLAUI_LOCAL_BOOST_BYPASS=1', () => {
    const result = simulateCodexHook('Bash', 'CLAUI_LOCAL_BOOST_BYPASS=1 npm test');
    assert.equal(result.action, 'passthrough');
  });

  // ── Empty command is passthrough ──────────────────────────────────────

  it('passes through for empty command', () => {
    const result = simulateCodexHook('Bash', '');
    assert.equal(result.action, 'passthrough');
  });

  // ── Output structure matches expected HookOutput shape ────────────────

  it('produces correct output structure for eligible command', () => {
    const result = simulateCodexHook('Bash', 'npm test');
    assert.equal(result.action, 'deny');
    if (result.action === 'deny') {
      const output = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: result.reason,
        },
      };
      assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse');
      assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.length > 0);
    }
  });
});
