import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  buildCodexExecArgs,
  CODEX_SKIP_GIT_REPO_CHECK_FLAG,
  toTomlBasicString,
} from '../../src/extension/process/codexExecArgs';

test('new supervised turn skips the git/trust gate (non-git folders used to fail with exit 1)', () => {
  const args = buildCodexExecArgs({ cwd: 'C:\\Users\\me\\Documents\\notes', permissionMode: 'supervised' });
  assert.deepEqual(args, [
    'exec',
    '--json',
    '--sandbox',
    'read-only',
    CODEX_SKIP_GIT_REPO_CHECK_FLAG,
    '-C',
    'C:\\Users\\me\\Documents\\notes',
    '-',
  ]);
});

test('resume turn passes the flag to the resume subcommand, before the thread id and stdin marker', () => {
  const args = buildCodexExecArgs({ threadId: 'thread-123', permissionMode: 'supervised', model: 'gpt-6.1-sol' });
  assert.deepEqual(args, [
    'exec',
    '--sandbox',
    'read-only',
    'resume',
    '--json',
    CODEX_SKIP_GIT_REPO_CHECK_FLAG,
    '--model',
    'gpt-6.1-sol',
    'thread-123',
    '-',
  ]);
});

test('Smart Search (forced read-only) and full-access turns also carry the flag', () => {
  const searchArgs = buildCodexExecArgs({ forceReadOnlySandbox: true, permissionMode: 'full-access', cwd: 'C:\\Users\\me' });
  assert.ok(searchArgs.includes(CODEX_SKIP_GIT_REPO_CHECK_FLAG));
  assert.ok(!searchArgs.includes('--dangerously-bypass-approvals-and-sandbox'));

  const fullAccessArgs = buildCodexExecArgs({ cwd: 'C:\\repo' });
  assert.ok(fullAccessArgs.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.ok(fullAccessArgs.includes(CODEX_SKIP_GIT_REPO_CHECK_FLAG));
});

test('stdin marker stays last and optional flags keep their order', () => {
  const args = buildCodexExecArgs({
    cwd: 'C:\\repo',
    model: 'gpt-6-astra',
    reasoningEffort: 'xhigh',
    serviceTier: 'fast',
    appendSystemPrompt: 'Line "one"\nLine two',
    imagePaths: ['C:\\tmp\\image-1.png'],
  });
  assert.equal(args[args.length - 1], '-');
  assert.deepEqual(args.slice(args.indexOf('--model')), [
    '--model',
    'gpt-6-astra',
    '-c',
    'model_reasoning_effort=xhigh',
    '-c',
    'service_tier="fast"',
    '-c',
    'features.fast_mode=true',
    '-c',
    `instructions=${toTomlBasicString('Line "one"\nLine two')}`,
    '--image',
    'C:\\tmp\\image-1.png',
    '-',
  ]);
});

test('toTomlBasicString escapes quotes, backslashes and control characters', () => {
  assert.equal(toTomlBasicString('a"b\\c\nd\te\r'), '"a\\"b\\\\c\\nd\\te\\r"');
});
