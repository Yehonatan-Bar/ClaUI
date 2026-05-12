import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { GenericFilter } from '../../../src/local-boost-runtime/filters/GenericFilter';
import { FilterInput } from '../../../src/extension/local-boost/LocalBoostTypes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<FilterInput> = {}): FilterInput {
  return {
    command: 'echo hello',
    commandFamily: 'shell',
    stdout: '',
    stderr: '',
    exitCode: 0,
    durationMs: 100,
    profile: 'balanced',
    redactionResult: { text: '', replacements: 0, rulesTriggered: [] },
    ...overrides,
  };
}

const filter = new GenericFilter();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GenericFilter', () => {
  // ----- Identity / metadata -----

  it('has correct name and version', () => {
    assert.equal(filter.name, 'GenericFilter');
    assert.equal(filter.version, '1.0.0');
  });

  it('supports() returns true for any input', () => {
    assert.equal(filter.supports(makeInput({ command: 'echo hello' })), true);
    assert.equal(filter.supports(makeInput({ command: 'python test.py' })), true);
    assert.equal(filter.supports(makeInput({ command: 'npm test' })), true);
    assert.equal(filter.supports(makeInput({ command: '' })), true);
  });

  // ----- Empty output -----

  it('returns empty filteredStdout/filteredStderr for empty input', () => {
    const result = filter.filter(makeInput({ stdout: '', stderr: '' }));
    assert.equal(result.filteredStdout, '');
    assert.equal(result.filteredStderr, '');
  });

  // ----- ANSI stripping -----

  it('strips ANSI escape sequences', () => {
    const ansiText = '\x1b[31mERROR\x1b[0m: something failed\n\x1b[32mOK\x1b[0m';
    const result = filter.filter(makeInput({ stdout: ansiText }));
    assert.ok(!result.filteredStdout.includes('\x1b['));
    assert.ok(result.filteredStdout.includes('ERROR'));
    assert.ok(result.filteredStdout.includes('something failed'));
    assert.ok(result.filteredStdout.includes('OK'));
  });

  it('strips ANSI OSC sequences', () => {
    const oscText = '\x1b]0;Window Title\x07Some content';
    const result = filter.filter(makeInput({ stdout: oscText }));
    assert.ok(!result.filteredStdout.includes('\x1b]'));
    assert.ok(result.filteredStdout.includes('Some content'));
  });

  // ----- Duplicate line collapsing -----

  it('collapses adjacent duplicate lines', () => {
    const lines = [
      'Building module A...',
      'Building module A...',
      'Building module A...',
      'Building module A...',
      'Done.',
    ].join('\n');
    const result = filter.filter(makeInput({ stdout: lines }));
    // The first occurrence stays, then a "[repeated N more times]" note
    assert.ok(result.filteredStdout.includes('Building module A...'));
    assert.ok(result.filteredStdout.includes('[repeated 3 more times]'));
    assert.ok(result.filteredStdout.includes('Done.'));
  });

  it('collapses a single duplicate with singular "time"', () => {
    const lines = ['alpha', 'alpha', 'beta'].join('\n');
    const result = filter.filter(makeInput({ stdout: lines }));
    assert.ok(result.filteredStdout.includes('[repeated 1 more time]'));
    assert.ok(!result.filteredStdout.includes('times'));
  });

  it('does not collapse empty/whitespace-only duplicate lines', () => {
    // collapseDuplicates only collapses if line.trim() is truthy
    const lines = ['a', '', '', 'b'].join('\n');
    const result = filter.filter(makeInput({ stdout: lines }));
    assert.ok(!result.filteredStdout.includes('[repeated'));
  });

  // ----- Non-matching text passes through -----

  it('passes through plain text unchanged when under budget', () => {
    const plainText = 'Line one\nLine two\nLine three';
    const result = filter.filter(makeInput({ stdout: plainText }));
    assert.equal(result.filteredStdout, plainText);
  });

  // ----- Budget caps -----

  it('respects balanced success budget cap (8000 chars)', () => {
    // Generate stdout well over 8000 chars with non-important lines
    const longLine = 'x'.repeat(200);
    const bigStdout = Array.from({ length: 200 }, (_, i) => `${longLine} line ${i}`).join('\n');
    assert.ok(bigStdout.length > 8000, 'precondition: input exceeds budget');

    const result = filter.filter(makeInput({
      stdout: bigStdout,
      exitCode: 0,
      profile: 'balanced',
    }));
    assert.ok(result.filteredStdout.length <= 8000,
      `filteredStdout length ${result.filteredStdout.length} should be <= 8000`);
  });

  it('respects balanced failure budget cap (16000 chars)', () => {
    const longLine = 'x'.repeat(200);
    const bigStdout = Array.from({ length: 300 }, (_, i) => `${longLine} line ${i}`).join('\n');
    assert.ok(bigStdout.length > 16000, 'precondition: input exceeds budget');

    const result = filter.filter(makeInput({
      stdout: bigStdout,
      exitCode: 1,
      profile: 'balanced',
    }));
    assert.ok(result.filteredStdout.length <= 16000,
      `filteredStdout length ${result.filteredStdout.length} should be <= 16000`);
  });

  it('respects strict profile budget caps', () => {
    const longLine = 'x'.repeat(200);
    const bigStdout = Array.from({ length: 200 }, (_, i) => `${longLine} line ${i}`).join('\n');

    const result = filter.filter(makeInput({
      stdout: bigStdout,
      exitCode: 0,
      profile: 'strict',
    }));
    // strict success = 4000
    assert.ok(result.filteredStdout.length <= 4000,
      `strict filteredStdout length ${result.filteredStdout.length} should be <= 4000`);
  });

  it('stderr budget is 1/4 of stdout budget', () => {
    const longLine = 'x'.repeat(200);
    const bigStderr = Array.from({ length: 200 }, (_, i) => `${longLine} line ${i}`).join('\n');

    const result = filter.filter(makeInput({
      stderr: bigStderr,
      exitCode: 0,
      profile: 'balanced',
    }));
    // balanced success = 8000, stderr cap = 2000
    assert.ok(result.filteredStderr.length <= 2000,
      `filteredStderr length ${result.filteredStderr.length} should be <= 2000`);
  });

  // ----- Output metadata -----

  it('populates filterName and filterVersion in output', () => {
    const result = filter.filter(makeInput({ stdout: 'hello' }));
    assert.equal(result.filterName, 'GenericFilter');
    assert.equal(result.filterVersion, '1.0.0');
  });

  it('calculates byte counts correctly', () => {
    const stdout = 'Hello world';
    const stderr = 'Err';
    const result = filter.filter(makeInput({ stdout, stderr }));
    assert.equal(result.rawStdoutBytes, Buffer.byteLength(stdout, 'utf8'));
    assert.equal(result.rawStderrBytes, Buffer.byteLength(stderr, 'utf8'));
    assert.equal(result.filteredStdoutBytes, Buffer.byteLength(result.filteredStdout, 'utf8'));
    assert.equal(result.filteredStderrBytes, Buffer.byteLength(result.filteredStderr, 'utf8'));
  });

  it('returns a header string', () => {
    const result = filter.filter(makeInput({ stdout: 'hello', command: 'echo hello' }));
    assert.ok(result.header.includes('[claui-local-boost]'));
    assert.ok(result.header.includes('echo hello'));
    assert.ok(result.header.includes('GenericFilter'));
  });

  it('estimates tokens saved as (rawTotal - filteredTotal) / 4 rounded up', () => {
    // Use text small enough to not be truncated so savings = 0
    const result = filter.filter(makeInput({ stdout: 'tiny', stderr: '' }));
    assert.equal(result.estimatedTokensSaved, 0);
  });

  // ----- Spinner/progress removal -----

  it('removes spinner characters', () => {
    const spinnerText = 'Loading ⠀⣿ done';
    const result = filter.filter(makeInput({ stdout: spinnerText }));
    assert.ok(!result.filteredStdout.includes('⠀'));
    assert.ok(!result.filteredStdout.includes('⣿'));
    assert.ok(result.filteredStdout.includes('done'));
  });

  // ----- Carriage-return normalization -----

  it('normalizes carriage-return progress lines', () => {
    // Simulates a terminal overwrite: "Progress 50%\rProgress 100%\n"
    const crText = 'Progress 50%\rProgress 100%\nDone';
    const result = filter.filter(makeInput({ stdout: crText }));
    // The \r-based partial line should be dropped, keeping "Progress 100%" and "Done"
    assert.ok(result.filteredStdout.includes('Progress 100%'));
    assert.ok(result.filteredStdout.includes('Done'));
  });

  // ----- Important lines are kept during truncation -----

  it('preserves important lines (error, warning, etc.) even in long output', () => {
    const filler = Array.from({ length: 300 }, (_, i) => `filler line number ${i}`).join('\n');
    const important = 'CRITICAL error: something broke badly';
    const longOutput = filler + '\n' + important + '\n' + filler;

    const result = filter.filter(makeInput({
      stdout: longOutput,
      exitCode: 1,
      profile: 'strict', // strict failure = 8000
    }));
    assert.ok(result.filteredStdout.includes('error: something broke badly'),
      'important line should survive truncation');
  });
});
