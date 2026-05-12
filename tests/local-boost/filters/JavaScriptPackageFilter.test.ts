import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { JavaScriptPackageFilter } from '../../../src/local-boost-runtime/filters/JavaScriptPackageFilter';
import { FilterInput } from '../../../src/extension/local-boost/LocalBoostTypes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<FilterInput> = {}): FilterInput {
  return {
    command: 'npm test',
    commandFamily: 'npm',
    stdout: '',
    stderr: '',
    exitCode: 0,
    durationMs: 500,
    profile: 'balanced',
    redactionResult: { text: '', replacements: 0, rulesTriggered: [] },
    ...overrides,
  };
}

const filter = new JavaScriptPackageFilter();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('JavaScriptPackageFilter', () => {
  // ----- Identity / metadata -----

  it('has correct name and version', () => {
    assert.equal(filter.name, 'JavaScriptPackageFilter');
    assert.equal(filter.version, '1.0.0');
  });

  // ----- supports() -----

  describe('supports()', () => {
    it('returns true for npm test', () => {
      assert.equal(filter.supports(makeInput({ command: 'npm test' })), true);
    });

    it('returns true for npm t (shorthand)', () => {
      assert.equal(filter.supports(makeInput({ command: 'npm t' })), true);
    });

    it('returns true for npm build', () => {
      assert.equal(filter.supports(makeInput({ command: 'npm build' })), true);
    });

    it('returns true for npm install', () => {
      assert.equal(filter.supports(makeInput({ command: 'npm install' })), true);
    });

    it('returns true for npm ci', () => {
      assert.equal(filter.supports(makeInput({ command: 'npm ci' })), true);
    });

    it('returns true for npm run test', () => {
      assert.equal(filter.supports(makeInput({ command: 'npm run test' })), true);
    });

    it('returns true for npm run build', () => {
      assert.equal(filter.supports(makeInput({ command: 'npm run build' })), true);
    });

    it('returns true for npm lint', () => {
      assert.equal(filter.supports(makeInput({ command: 'npm lint' })), true);
    });

    it('returns true for npm audit', () => {
      assert.equal(filter.supports(makeInput({ command: 'npm audit' })), true);
    });

    it('returns true for pnpm build', () => {
      assert.equal(filter.supports(makeInput({ command: 'pnpm build' })), true);
    });

    it('returns true for yarn install', () => {
      assert.equal(filter.supports(makeInput({ command: 'yarn install' })), true);
    });

    it('returns true for bun test', () => {
      assert.equal(filter.supports(makeInput({ command: 'bun test' })), true);
    });

    it('returns true for pnpm ci', () => {
      assert.equal(filter.supports(makeInput({ command: 'pnpm ci' })), true);
    });

    it('returns true for yarn run lint', () => {
      assert.equal(filter.supports(makeInput({ command: 'yarn run lint' })), true);
    });

    it('returns false for python test.py', () => {
      assert.equal(filter.supports(makeInput({ command: 'python test.py' })), false);
    });

    it('returns false for tsc', () => {
      assert.equal(filter.supports(makeInput({ command: 'tsc' })), false);
    });

    it('returns false for cargo build', () => {
      assert.equal(filter.supports(makeInput({ command: 'cargo build' })), false);
    });

    it('returns false for empty command', () => {
      assert.equal(filter.supports(makeInput({ command: '' })), false);
    });

    it('returns false for npm (no subcommand)', () => {
      assert.equal(filter.supports(makeInput({ command: 'npm' })), false);
    });
  });

  // ----- Filtering on success -----

  describe('filter() on success (exitCode=0)', () => {
    it('filters out npm funding messages', () => {
      const stdout = [
        'added 100 packages in 5s',
        '10 packages are looking for funding',
        '  run `npm fund` for details',
        'Build complete.',
      ].join('\n');
      const result = filter.filter(makeInput({ stdout, exitCode: 0 }));
      assert.ok(!result.filteredStdout.includes('funding'),
        'funding lines should be suppressed on success');
      assert.ok(result.filteredStdout.includes('Build complete.'));
    });

    it('filters out npm deprecation warnings', () => {
      const stdout = [
        'npm WARN deprecated glob@7.2.0: Glob versions prior to v9 are no longer supported',
        'npm WARN deprecated inflight@1.0.6: This module is not supported',
        'Done in 3s.',
      ].join('\n');
      const result = filter.filter(makeInput({ stdout, exitCode: 0 }));
      assert.ok(!result.filteredStdout.includes('WARN deprecated'),
        'deprecation warnings should be suppressed on success');
      assert.ok(result.filteredStdout.includes('Done in 3s.'));
    });

    it('filters out npm notice lines', () => {
      const stdout = 'npm notice New major version available!\nResult: OK';
      const result = filter.filter(makeInput({ stdout, exitCode: 0 }));
      assert.ok(!result.filteredStdout.includes('npm notice'));
      assert.ok(result.filteredStdout.includes('Result: OK'));
    });

    it('filters out "added N packages in" lines', () => {
      const stdout = '  added 150 packages in 8s\nBuild succeeded.';
      const result = filter.filter(makeInput({ stdout, exitCode: 0 }));
      assert.ok(!result.filteredStdout.includes('added 150 packages'));
      assert.ok(result.filteredStdout.includes('Build succeeded.'));
    });

    it('filters out "up to date" lines', () => {
      const stdout = '  up to date, audited 500 packages\nAll good.';
      const result = filter.filter(makeInput({ stdout, exitCode: 0 }));
      assert.ok(!result.filteredStdout.includes('up to date'));
      assert.ok(result.filteredStdout.includes('All good.'));
    });

    it('keeps important lines (PASS, Tests:, etc.)', () => {
      const stdout = [
        'PASS src/utils.test.ts',
        'Tests: 5 passed, 5 total',
        'Time: 2.5s',
      ].join('\n');
      const result = filter.filter(makeInput({ stdout, exitCode: 0 }));
      assert.ok(result.filteredStdout.includes('PASS'));
      assert.ok(result.filteredStdout.includes('Tests:'));
      assert.ok(result.filteredStdout.includes('Time:'));
    });

    it('strips ANSI codes from output', () => {
      const stdout = '\x1b[32mPASS\x1b[0m src/test.ts';
      const result = filter.filter(makeInput({ stdout, exitCode: 0 }));
      assert.ok(!result.filteredStdout.includes('\x1b['));
      assert.ok(result.filteredStdout.includes('PASS'));
    });
  });

  // ----- Filtering on failure -----

  describe('filter() on failure (exitCode!=0)', () => {
    it('preserves npm ERR! lines on failure', () => {
      const stdout = [
        'npm ERR! code ELIFECYCLE',
        'npm ERR! errno 1',
        'npm ERR! test@1.0.0 test: `jest`',
        'npm ERR! Exit status 1',
        'npm ERR! Failed at the test@1.0.0 test script.',
      ].join('\n');
      const result = filter.filter(makeInput({ stdout, exitCode: 1 }));
      assert.ok(result.filteredStdout.includes('npm ERR! code ELIFECYCLE'));
      assert.ok(result.filteredStdout.includes('npm ERR! Exit status 1'));
      assert.ok(result.filteredStdout.includes('npm ERR! Failed at'));
    });

    it('preserves funding/deprecation lines on failure (not suppressed)', () => {
      const stdout = [
        '10 packages are looking for funding',
        'npm WARN deprecated glob@7.2.0: old',
        'npm ERR! some error',
      ].join('\n');
      const result = filter.filter(makeInput({ stdout, exitCode: 1 }));
      // On failure, suppress patterns are NOT applied, so funding/deprecation stay
      assert.ok(result.filteredStdout.includes('funding'));
      assert.ok(result.filteredStdout.includes('WARN deprecated'));
      assert.ok(result.filteredStdout.includes('npm ERR!'));
    });

    it('preserves FAIL and "failing" lines', () => {
      const stdout = [
        'FAIL src/broken.test.ts',
        '  2 failing',
        '  1 passing',
      ].join('\n');
      const result = filter.filter(makeInput({ stdout, exitCode: 1 }));
      assert.ok(result.filteredStdout.includes('FAIL'));
      assert.ok(result.filteredStdout.includes('2 failing'));
    });
  });

  // ----- Empty output -----

  it('returns empty string for empty stdout', () => {
    const result = filter.filter(makeInput({ stdout: '', exitCode: 0 }));
    assert.equal(result.filteredStdout, '');
  });

  it('returns empty string for empty stderr', () => {
    const result = filter.filter(makeInput({ stderr: '', exitCode: 0 }));
    assert.equal(result.filteredStderr, '');
  });

  // ----- Budget caps -----

  describe('budget caps', () => {
    it('respects balanced success budget (8000 chars) for stdout', () => {
      const bigStdout = Array.from({ length: 500 }, (_, i) => `output line number ${i} ${'x'.repeat(100)}`).join('\n');
      assert.ok(bigStdout.length > 8000, 'precondition: input exceeds budget');

      const result = filter.filter(makeInput({
        stdout: bigStdout,
        exitCode: 0,
        profile: 'balanced',
      }));
      assert.ok(result.filteredStdout.length <= 8000,
        `filteredStdout length ${result.filteredStdout.length} should be <= 8000`);
    });

    it('respects balanced failure budget (16000 chars) for stdout', () => {
      const bigStdout = Array.from({ length: 500 }, (_, i) => `error line number ${i} ${'x'.repeat(100)}`).join('\n');
      assert.ok(bigStdout.length > 16000, 'precondition: input exceeds budget');

      const result = filter.filter(makeInput({
        stdout: bigStdout,
        exitCode: 1,
        profile: 'balanced',
      }));
      assert.ok(result.filteredStdout.length <= 16000,
        `filteredStdout length ${result.filteredStdout.length} should be <= 16000`);
    });

    it('stderr budget is 1/4 of the main budget', () => {
      const bigStderr = Array.from({ length: 500 }, (_, i) => `stderr line ${i} ${'x'.repeat(100)}`).join('\n');

      const result = filter.filter(makeInput({
        stderr: bigStderr,
        exitCode: 0,
        profile: 'balanced',
      }));
      // balanced success = 8000, stderr cap = 2000
      assert.ok(result.filteredStderr.length <= 2000,
        `filteredStderr length ${result.filteredStderr.length} should be <= 2000`);
    });

    it('respects strict profile budget', () => {
      const bigStdout = Array.from({ length: 500 }, (_, i) => `output line ${i} ${'x'.repeat(100)}`).join('\n');

      const result = filter.filter(makeInput({
        stdout: bigStdout,
        exitCode: 0,
        profile: 'strict',
      }));
      // strict success = 4000
      assert.ok(result.filteredStdout.length <= 4000,
        `strict filteredStdout length ${result.filteredStdout.length} should be <= 4000`);
    });
  });

  // ----- Output metadata -----

  it('populates filterName and filterVersion', () => {
    const result = filter.filter(makeInput({ stdout: 'hello' }));
    assert.equal(result.filterName, 'JavaScriptPackageFilter');
    assert.equal(result.filterVersion, '1.0.0');
  });

  it('calculates byte counts correctly', () => {
    const stdout = 'Test output';
    const stderr = 'Warning line';
    const result = filter.filter(makeInput({ stdout, stderr }));
    assert.equal(result.rawStdoutBytes, Buffer.byteLength(stdout, 'utf8'));
    assert.equal(result.rawStderrBytes, Buffer.byteLength(stderr, 'utf8'));
  });

  it('returns a header with command and filter info', () => {
    const result = filter.filter(makeInput({ stdout: 'ok', command: 'npm test' }));
    assert.ok(result.header.includes('[claui-local-boost]'));
    assert.ok(result.header.includes('npm test'));
    assert.ok(result.header.includes('JavaScriptPackageFilter'));
  });
});
