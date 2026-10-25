import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  isCodexTracingLogLine,
  takeCompleteStderrLines,
  unwrapCodexErrorMessage,
  withOutdatedCodexCliHint,
} from '../../src/extension/process/codexErrorText';

const WRAPPED_400 =
  '{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'gpt-6-astra\' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again."}}';

test('unwrapCodexErrorMessage extracts the API message from a JSON error document', () => {
  assert.equal(
    unwrapCodexErrorMessage(WRAPPED_400),
    "The 'gpt-6-astra' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.",
  );
  assert.equal(unwrapCodexErrorMessage('{"message":"top level"}'), 'top level');
  assert.equal(unwrapCodexErrorMessage('{"error":"plain string error"}'), 'plain string error');
});

test('unwrapCodexErrorMessage leaves plain text and non-matching JSON untouched', () => {
  assert.equal(unwrapCodexErrorMessage('  stream disconnected before completion  '), 'stream disconnected before completion');
  assert.equal(unwrapCodexErrorMessage('{not json'), '{not json');
  assert.equal(unwrapCodexErrorMessage('{"status":500}'), '{"status":500}');
});

test('isCodexTracingLogLine matches Codex tracing output seen on successful turns', () => {
  assert.ok(isCodexTracingLogLine(
    '2026-10-25T11:33:52.331657Z ERROR codex_skills_extension::host_service: failed to install system skills: io error (os error 1224)',
  ));
  assert.ok(isCodexTracingLogLine(
    '2026-10-25T11:42:15.928532Z ERROR codex_models_manager::cache: failed to load models cache: missing field `base_instructions`',
  ));
  // Same line with ANSI colors (when Codex thinks stderr is a terminal).
  assert.ok(isCodexTracingLogLine('\u001b[2m2026-10-25T11:42:15Z\u001b[0m \u001b[33m WARN\u001b[0m codex_core::shell_snapshot: x'));
});

test('isCodexTracingLogLine does not swallow plain CLI errors', () => {
  assert.ok(!isCodexTracingLogLine('Not inside a trusted directory and --skip-git-repo-check was not specified.'));
  assert.ok(!isCodexTracingLogLine("error: unexpected argument '-' found"));
  assert.ok(!isCodexTracingLogLine("'codex' is not recognized as an internal or external command"));
});

test('withOutdatedCodexCliHint names the CLI ClaUi is running only for outdated-CLI errors', () => {
  const unwrapped = unwrapCodexErrorMessage(WRAPPED_400);
  const hinted = withOutdatedCodexCliHint(unwrapped, 'C:\\Users\\me\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe');
  assert.ok(hinted.startsWith(unwrapped));
  assert.match(hinted, /Codex\\bin\\codex\.exe/);
  assert.match(hinted, /npm install -g @openai\/codex@latest/);
  assert.match(hinted, /claudeMirror\.codex\.cliPath/);

  assert.equal(withOutdatedCodexCliHint('rate limit reached', 'codex'), 'rate limit reached');
});

test('takeCompleteStderrLines holds a split Codex log line until its newline arrives', () => {
  const firstChunk = '2026-10-25T11:42:15.928532Z ERROR codex_models_manager::cache:';
  const secondChunk = ' failed to load models cache: missing field `base_instructions`\nNot inside a trusted dir';

  const first = takeCompleteStderrLines('', firstChunk, 64 * 1024);
  assert.deepEqual(first, { complete: '', rest: firstChunk });

  const second = takeCompleteStderrLines(first.rest, secondChunk, 64 * 1024);
  assert.equal(second.complete, firstChunk + ' failed to load models cache: missing field `base_instructions`');
  assert.ok(isCodexTracingLogLine(second.complete), 'the rejoined line is still recognized as a Codex log line');
  assert.equal(second.rest, 'Not inside a trusted dir');
});

test('takeCompleteStderrLines releases newline-free output once it exceeds the cap', () => {
  assert.deepEqual(takeCompleteStderrLines('abc', 'def', 4), { complete: 'abcdef', rest: '' });
  assert.deepEqual(takeCompleteStderrLines('', 'line one\nline two\n', 4), { complete: 'line one\nline two', rest: '' });
});
