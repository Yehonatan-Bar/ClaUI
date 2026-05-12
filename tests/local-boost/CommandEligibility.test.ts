import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { classifyCommand } from '../../src/local-boost-runtime/CommandEligibility';

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
    assert.equal(result.filterHint, 'GoFilter');
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

  it('CLAUI_LOCAL_BOOST_BYPASS=1 npm test -> not eligible (bypass marker)', () => {
    const result = classifyCommand('CLAUI_LOCAL_BOOST_BYPASS=1 npm test');
    assert.equal(result.eligible, false);
    assert.ok(result.reason.toLowerCase().includes('bypass'), `expected reason to mention bypass, got "${result.reason}"`);
  });

  // ── Pipeline / Redirection (not eligible) ─────────────────────────────

  it('npm test | grep foo -> not eligible (pipeline)', () => {
    const result = classifyCommand('npm test | grep foo');
    assert.equal(result.eligible, false);
    assert.ok(result.reason.toLowerCase().includes('pipeline') || result.reason.toLowerCase().includes('redirection'),
      `expected reason to mention pipeline/redirection, got "${result.reason}"`);
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
    assert.ok(result.reason.toLowerCase().includes('pipeline') || result.reason.toLowerCase().includes('redirection'),
      `expected reason to mention pipeline/redirection, got "${result.reason}"`);
  });

  // ── Env-var stripping ─────────────────────────────────────────────────

  it('NODE_ENV=test npm test -> eligible (strips env prefix)', () => {
    const result = classifyCommand('NODE_ENV=test npm test');
    assert.equal(result.eligible, true);
    assert.ok(result.commandFamily?.includes('npm'), `expected commandFamily to include "npm", got "${result.commandFamily}"`);
  });

  // ── Unknown command (default deny) ────────────────────────────────────

  it('unknown-command -> not eligible (not in allow list)', () => {
    const result = classifyCommand('unknown-command');
    assert.equal(result.eligible, false);
    assert.ok(result.reason.toLowerCase().includes('not in allow'), `expected reason about not in allow list, got "${result.reason}"`);
  });
});
