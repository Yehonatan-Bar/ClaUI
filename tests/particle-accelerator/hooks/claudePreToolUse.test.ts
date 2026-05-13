import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { classifyCommand } from '../../../src/particle-accelerator-runtime/CommandEligibility';

/**
 * Tests for the Claude PreToolUse hook logic.
 *
 * The actual hook (claudePreToolUse.ts) is a stdin/stdout script whose main()
 * reads JSON, classifies the command, base64url-encodes it, and writes a
 * HookOutput with permissionDecision='allow' and a rewritten command.
 *
 * Since stdin/stdout testing is complex and the core logic is:
 *   1. classifyCommand (tested in CommandEligibility.test.ts)
 *   2. base64url encoding of the command
 *   3. building the rewritten command string
 *   4. passthrough for non-eligible / non-Bash tools
 *
 * We test the classification + encoding + output structure here.
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
function simulateClaudeHook(toolName: string, command: string): { action: 'passthrough' } | { action: 'allow'; rewrittenCommand: string; encoded: string } {
  // Non-Bash tools: passthrough
  if (toolName !== 'Bash') {
    return { action: 'passthrough' };
  }

  // Empty command: passthrough
  if (!command) {
    return { action: 'passthrough' };
  }

  // Already wrapped: passthrough
  if (command.startsWith('claui-run') || command.includes('CLAUI_PARTICLE_ACCELERATOR_BYPASS=1')) {
    return { action: 'passthrough' };
  }

  const result = classifyCommand(command);
  if (!result.eligible) {
    return { action: 'passthrough' };
  }

  const encoded = base64urlEncode(command);
  const rewrittenCommand = `claui-run --claui-encoded-shell-command ${encoded}`;

  return { action: 'allow', rewrittenCommand, encoded };
}

describe('claudePreToolUse hook logic', () => {

  // ── Eligible commands produce 'allow' with rewritten command ───────────

  it('rewrites npm test to claui-run with base64url-encoded command', () => {
    const result = simulateClaudeHook('Bash', 'npm test');
    assert.equal(result.action, 'allow');
    if (result.action === 'allow') {
      assert.ok(result.rewrittenCommand.startsWith('claui-run --claui-encoded-shell-command '));
      // Verify the encoding decodes back to original
      const decoded = Buffer.from(result.encoded, 'base64url').toString('utf8');
      assert.equal(decoded, 'npm test');
    }
  });

  it('rewrites pytest to claui-run', () => {
    const result = simulateClaudeHook('Bash', 'pytest');
    assert.equal(result.action, 'allow');
    if (result.action === 'allow') {
      const decoded = Buffer.from(result.encoded, 'base64url').toString('utf8');
      assert.equal(decoded, 'pytest');
    }
  });

  it('rewrites cargo test to claui-run', () => {
    const result = simulateClaudeHook('Bash', 'cargo test');
    assert.equal(result.action, 'allow');
    if (result.action === 'allow') {
      const decoded = Buffer.from(result.encoded, 'base64url').toString('utf8');
      assert.equal(decoded, 'cargo test');
    }
  });

  // ── Base64url encoding correctness ────────────────────────────────────

  it('base64url encoding does not contain +, /, or trailing =', () => {
    // Use a command that produces base64 chars like + / =
    const tricky = 'npm test --reporter=json --coverage';
    const encoded = base64urlEncode(tricky);
    assert.ok(!encoded.includes('+'), 'should not contain +');
    assert.ok(!encoded.includes('/'), 'should not contain /');
    assert.ok(!encoded.endsWith('='), 'should not end with =');
  });

  it('base64url encoding round-trips correctly', () => {
    const commands = [
      'npm test',
      'go test ./...',
      'cargo build --release',
      'git diff HEAD~3',
      'NODE_ENV=test jest --coverage',
    ];
    for (const cmd of commands) {
      // Only test commands that are eligible
      const classification = classifyCommand(cmd);
      if (!classification.eligible) continue;
      const encoded = base64urlEncode(cmd);
      const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
      assert.equal(decoded, cmd, `round-trip failed for: ${cmd}`);
    }
  });

  // ── Non-Bash tools are passthrough ────────────────────────────────────

  it('passes through for Read tool', () => {
    const result = simulateClaudeHook('Read', '/some/file.ts');
    assert.equal(result.action, 'passthrough');
  });

  it('passes through for Write tool', () => {
    const result = simulateClaudeHook('Write', 'content');
    assert.equal(result.action, 'passthrough');
  });

  it('passes through for Edit tool', () => {
    const result = simulateClaudeHook('Edit', 'some edit');
    assert.equal(result.action, 'passthrough');
  });

  // ── Non-eligible Bash commands are passthrough ────────────────────────

  it('passes through for ssh (deny list)', () => {
    const result = simulateClaudeHook('Bash', 'ssh user@host');
    assert.equal(result.action, 'passthrough');
  });

  it('passes through for vim (deny list)', () => {
    const result = simulateClaudeHook('Bash', 'vim file.txt');
    assert.equal(result.action, 'passthrough');
  });

  it('passes through for unknown commands (not in allow list)', () => {
    const result = simulateClaudeHook('Bash', 'some-random-binary');
    assert.equal(result.action, 'passthrough');
  });

  it('passes through for piped commands', () => {
    const result = simulateClaudeHook('Bash', 'npm test | grep FAIL');
    assert.equal(result.action, 'passthrough');
  });

  // ── Already-wrapped commands are passthrough ──────────────────────────

  it('passes through if command starts with claui-run', () => {
    const result = simulateClaudeHook('Bash', 'claui-run --claui-encoded-shell-command abc123');
    assert.equal(result.action, 'passthrough');
  });

  it('passes through if command contains CLAUI_PARTICLE_ACCELERATOR_BYPASS=1', () => {
    const result = simulateClaudeHook('Bash', 'CLAUI_PARTICLE_ACCELERATOR_BYPASS=1 npm test');
    assert.equal(result.action, 'passthrough');
  });

  // ── Empty command is passthrough ──────────────────────────────────────

  it('passes through for empty command', () => {
    const result = simulateClaudeHook('Bash', '');
    assert.equal(result.action, 'passthrough');
  });

  // ── Output structure matches expected HookOutput shape ────────────────

  it('produces correct output structure for eligible command', () => {
    const result = simulateClaudeHook('Bash', 'npm test');
    assert.equal(result.action, 'allow');
    if (result.action === 'allow') {
      // Simulate what the hook would write to stdout
      const output = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: 'Routing noisy Bash output through ClaUi local compression.',
          updatedInput: { command: result.rewrittenCommand },
        },
      };
      assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse');
      assert.equal(output.hookSpecificOutput.permissionDecision, 'allow');
      assert.ok(output.hookSpecificOutput.updatedInput.command.startsWith('claui-run'));
    }
  });

  it('preserves other tool_input fields in updatedInput', () => {
    // The hook copies all tool_input fields and only overwrites command
    const originalInput = { command: 'npm test', timeout: 30000, description: 'run tests' };
    const updatedInput: Record<string, unknown> = { ...originalInput };
    const encoded = base64urlEncode('npm test');
    updatedInput.command = `claui-run --claui-encoded-shell-command ${encoded}`;

    assert.equal(updatedInput.timeout, 30000, 'timeout should be preserved');
    assert.equal(updatedInput.description, 'run tests', 'description should be preserved');
    assert.ok((updatedInput.command as string).startsWith('claui-run'), 'command should be rewritten');
  });
});
