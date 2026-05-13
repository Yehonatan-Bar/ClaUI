import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { classifyCommand } from '../../src/particle-accelerator-runtime/CommandEligibility';

describe('classifyCommand', () => {
  // ── Allow-list (eligible) ──────────────────────────────────────────────

  it('npm test -> eligible, commandFamily includes npm-test', () => {
    const result = classifyCommand('npm test');
    assert.equal(result.eligible, true);
    assert.ok(result.commandFamily?.includes('npm'), `expected commandFamily to include "npm", got "${result.commandFamily}"`);
  });

  it('npm run build -> eligible', () => {
    const result = classifyCommand('npm run build');
    assert.equal(result.eligible, true);
    assert.ok(result.commandFamily, 'expected commandFamily to be set');
  });

  it('pytest -> eligible', () => {
    const result = classifyCommand('pytest');
    assert.equal(result.eligible, true);
    assert.equal(result.commandFamily, 'pytest');
    assert.equal(result.filterHint, 'PytestFilter');
  });

  it('tsc -> eligible', () => {
    const result = classifyCommand('tsc');
    assert.equal(result.eligible, true);
    assert.equal(result.commandFamily, 'tsc');
    assert.equal(result.filterHint, 'TypeScriptFilter');
  });

  it('go test -> eligible', () => {
    const result = classifyCommand('go test');
    assert.equal(result.eligible, true);
    assert.equal(result.commandFamily, 'go');
    assert.equal(result.filterHint, 'DeclarativeFilter');
  });

  // ── Deny-list (not eligible) ──────────────────────────────────────────

  it('ssh user@host -> not eligible (deny list)', () => {
    const result = classifyCommand('ssh user@host');
    assert.equal(result.eligible, false);
    assert.ok(result.reason.toLowerCase().includes('deny'), `expected reason to mention deny list, got "${result.reason}"`);
  });

  it('vim file.txt -> not eligible (deny list)', () => {
    const result = classifyCommand('vim file.txt');
    assert.equal(result.eligible, false);
    assert.ok(result.reason.toLowerCase().includes('deny'), `expected reason to mention deny list, got "${result.reason}"`);
  });

  it('npm run dev -> not eligible (long-running)', () => {
    const result = classifyCommand('npm run dev');
    assert.equal(result.eligible, false);
    assert.ok(result.reason.toLowerCase().includes('deny'), `expected reason to mention deny list, got "${result.reason}"`);
  });

  // ── Already-wrapped ───────────────────────────────────────────────────

  it('claui-run -- npm test -> not eligible (already wrapped)', () => {
    const result = classifyCommand('claui-run -- npm test');
    assert.equal(result.eligible, false);
    assert.ok(result.reason.toLowerCase().includes('already'), `expected reason to mention already wrapped, got "${result.reason}"`);
  });

  // ── Bypass marker ─────────────────────────────────────────────────────

  it('CLAUI_PARTICLE_ACCELERATOR_BYPASS=1 npm test -> not eligible (bypass marker)', () => {
    const result = classifyCommand('CLAUI_PARTICLE_ACCELERATOR_BYPASS=1 npm test');
    assert.equal(result.eligible, false);
    assert.ok(result.reason.toLowerCase().includes('bypass'), `expected reason to mention bypass, got "${result.reason}"`);
  });

  // ── Pipeline / Redirection (not eligible) ─────────────────────────────

  it('npm test | grep foo -> eligible (pipes are classified by leading command)', () => {
    const result = classifyCommand('npm test | grep foo');
    assert.equal(result.eligible, true);
    assert.ok(result.commandFamily?.includes('npm'), `expected commandFamily to include "npm", got "${result.commandFamily}"`);
  });

  it('npm test > out.txt -> not eligible (redirection)', () => {
    const result = classifyCommand('npm test > out.txt');
    assert.equal(result.eligible, false);
    assert.ok(result.reason.toLowerCase().includes('pipeline') || result.reason.toLowerCase().includes('redirection'),
      `expected reason to mention pipeline/redirection, got "${result.reason}"`);
  });

  it('$(npm test) -> not eligible (command substitution)', () => {
    const result = classifyCommand('$(npm test)');
    assert.equal(result.eligible, false);
    assert.ok(result.reason.toLowerCase().includes('substitution'),
      `expected reason to mention substitution, got "${result.reason}"`);
  });

  // ── Env-var stripping ─────────────────────────────────────────────────

  it('NODE_ENV=test npm test -> eligible (strips env prefix)', () => {
    const result = classifyCommand('NODE_ENV=test npm test');
    assert.equal(result.eligible, true);
    assert.ok(result.commandFamily?.includes('npm'), `expected commandFamily to include "npm", got "${result.commandFamily}"`);
  });

  // ── Unknown command (default eligible with GenericFilter) ──────────────

  it('unknown-command -> eligible with generic fallback', () => {
    const result = classifyCommand('unknown-command');
    assert.equal(result.eligible, true);
    assert.equal(result.filterHint, 'GenericFilter');
    assert.equal(result.commandFamily, 'unknown');
  });

  // ── New filter coverage ──────────────────────────────────────────────

  it('docker build -> eligible with DeclarativeFilter', () => {
    const result = classifyCommand('docker build .');
    assert.equal(result.eligible, true);
    assert.equal(result.commandFamily, 'docker-build');
    assert.equal(result.filterHint, 'DeclarativeFilter');
  });

  it('git diff -> eligible with GitSemanticFilter', () => {
    const result = classifyCommand('git diff');
    assert.equal(result.eligible, true);
    assert.equal(result.commandFamily, 'git');
    assert.equal(result.filterHint, 'GitSemanticFilter');
  });

  it('cargo test -> eligible with DeclarativeFilter', () => {
    const result = classifyCommand('cargo test');
    assert.equal(result.eligible, true);
    assert.equal(result.commandFamily, 'cargo');
    assert.equal(result.filterHint, 'DeclarativeFilter');
  });

  it('kubectl get pods -> eligible with DeclarativeFilter', () => {
    const result = classifyCommand('kubectl get pods');
    assert.equal(result.eligible, true);
    assert.equal(result.commandFamily, 'kubectl');
    assert.equal(result.filterHint, 'DeclarativeFilter');
  });

  it('terraform plan -> eligible with DeclarativeFilter', () => {
    const result = classifyCommand('terraform plan');
    assert.equal(result.eligible, true);
    assert.equal(result.commandFamily, 'terraform');
    assert.equal(result.filterHint, 'DeclarativeFilter');
  });

  it('pipe with docker build | tee -> eligible, classified by leading command', () => {
    const result = classifyCommand('docker build . | tee build.log');
    assert.equal(result.eligible, true);
    assert.equal(result.commandFamily, 'docker-build');
  });

  it('2>&1 redirection -> not eligible', () => {
    const result = classifyCommand('npm test > results.txt');
    assert.equal(result.eligible, false);
  });

  it('backtick substitution -> not eligible', () => {
    const result = classifyCommand('echo `npm test`');
    assert.equal(result.eligible, false);
  });

  it('pipe to denied command -> not eligible (deny-list checks all segments)', () => {
    const result = classifyCommand('npm test | ssh host');
    assert.equal(result.eligible, false);
    assert.ok(result.reason.toLowerCase().includes('deny'), `expected deny reason, got "${result.reason}"`);
  });

  it('pipe to vim -> not eligible (deny-list checks piped segments)', () => {
    const result = classifyCommand('git diff | vim -');
    assert.equal(result.eligible, false);
  });

  it('&& chain to denied command -> not eligible', () => {
    const result = classifyCommand('npm test && ssh host');
    assert.equal(result.eligible, false);
    assert.ok(result.reason.toLowerCase().includes('deny'), `expected deny reason, got "${result.reason}"`);
  });

  it('; chain to denied command -> not eligible', () => {
    const result = classifyCommand('npm test; ssh host');
    assert.equal(result.eligible, false);
    assert.ok(result.reason.toLowerCase().includes('deny'), `expected deny reason, got "${result.reason}"`);
  });

  it('|| chain to denied command -> not eligible', () => {
    const result = classifyCommand('npm test || vim file.txt');
    assert.equal(result.eligible, false);
    assert.ok(result.reason.toLowerCase().includes('deny'), `expected deny reason, got "${result.reason}"`);
  });

  it('&& chain of safe commands -> eligible', () => {
    const result = classifyCommand('npm install && npm test');
    assert.equal(result.eligible, true);
  });
});
