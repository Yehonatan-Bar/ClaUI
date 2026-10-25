import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CodexExecDemux } from '../../src/extension/process/CodexExecDemux';
import type { CodexExecJsonEvent } from '../../src/extension/types/codex-exec-json';

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'codex-exec');

/** Real `codex exec --json` output captured from Codex CLI 0.164.0 / 0.144.6 on Windows. */
function loadFixtureEvents(name: string): CodexExecJsonEvent[] {
  return fs
    .readFileSync(path.join(FIXTURE_DIR, name), 'utf-8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as CodexExecJsonEvent);
}

function recordDemux(events: CodexExecJsonEvent[]): Array<{ name: string; data: unknown }> {
  const demux = new CodexExecDemux();
  const recorded: Array<{ name: string; data: unknown }> = [];
  for (const name of ['threadStarted', 'turnStarted', 'agentMessage', 'turnCompleted', 'error', 'warning']) {
    demux.on(name, (data: unknown) => recorded.push({ name, data }));
  }
  for (const event of events) {
    demux.handleEvent(event);
  }
  return recorded;
}

test('managed requirements.toml notices are warnings, not turn errors', () => {
  const recorded = recordDemux(loadFixtureEvents('managed-requirements-warnings.jsonl'));
  const names = recorded.map((entry) => entry.name);

  assert.deepEqual(names, ['threadStarted', 'warning', 'warning', 'turnStarted', 'agentMessage', 'turnCompleted']);
  assert.ok(!names.includes('error'), 'a successful turn must not report an error');
  const warning = recorded.find((entry) => entry.name === 'warning')?.data as { message: string };
  assert.match(warning.message, /legacy `features` requirement `codex_hooks`/);
  const reply = recorded.find((entry) => entry.name === 'agentMessage')?.data as { text: string };
  assert.equal(reply.text, 'pong');
});

test('outdated CLI: fatal 400 is unwrapped to its readable message; notices stay warnings', () => {
  const recorded = recordDemux(loadFixtureEvents('outdated-cli-model-rejected.jsonl'));
  const errors = recorded.filter((entry) => entry.name === 'error').map((entry) => (entry.data as { message: string }).message);
  const warnings = recorded.filter((entry) => entry.name === 'warning');

  assert.equal(warnings.length, 4);
  assert.equal(errors.length, 2, 'top-level error + turn.failed');
  for (const message of errors) {
    assert.equal(
      message,
      "The 'gpt-6-astra' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.",
    );
  }
  assert.ok(!recorded.some((entry) => entry.name === 'agentMessage'));
});
