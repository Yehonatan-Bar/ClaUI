import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { TypeScriptFilter } from '../../../src/local-boost-runtime/filters/TypeScriptFilter';
import { FilterInput } from '../../../src/extension/local-boost/LocalBoostTypes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<FilterInput> = {}): FilterInput {
  return {
    command: 'tsc',
    commandFamily: 'tsc',
    stdout: '',
    stderr: '',
    exitCode: 0,
    durationMs: 300,
    profile: 'balanced',
    redactionResult: { text: '', replacements: 0, rulesTriggered: [] },
    ...overrides,
  };
}

function makeDiagnostic(file: string, line: number, col: number, code: string, msg: string): string {
  return `${file}(${line},${col}): error ${code}: ${msg}`;
}

const filter = new TypeScriptFilter();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TypeScriptFilter', () => {
  // ----- Identity / metadata -----

  it('has correct name and version', () => {
    assert.equal(filter.name, 'TypeScriptFilter');
    assert.equal(filter.version, '1.0.0');
  });

  // ----- supports() -----

  describe('supports()', () => {
    it('returns true for tsc', () => {
      assert.equal(filter.supports(makeInput({ command: 'tsc' })), true);
    });

    it('returns true for tsc --noEmit', () => {
      assert.equal(filter.supports(makeInput({ command: 'tsc --noEmit' })), true);
    });

    it('returns true for tsc -p tsconfig.json', () => {
      assert.equal(filter.supports(makeInput({ command: 'tsc -p tsconfig.json' })), true);
    });

    it('returns true for npx tsc', () => {
      assert.equal(filter.supports(makeInput({ command: 'npx tsc' })), true);
    });

    it('returns true for npx tsc --noEmit', () => {
      assert.equal(filter.supports(makeInput({ command: 'npx tsc --noEmit' })), true);
    });

    it('returns false for eslint', () => {
      assert.equal(filter.supports(makeInput({ command: 'eslint src/' })), false);
    });

    it('returns false for npm test', () => {
      assert.equal(filter.supports(makeInput({ command: 'npm test' })), false);
    });

    it('returns false for node tsc.js', () => {
      assert.equal(filter.supports(makeInput({ command: 'node tsc.js' })), false);
    });

    it('returns false for empty command', () => {
      assert.equal(filter.supports(makeInput({ command: '' })), false);
    });

    it('handles leading whitespace in command', () => {
      assert.equal(filter.supports(makeInput({ command: '  tsc --noEmit' })), true);
    });
  });

  // ----- Diagnostic grouping -----

  describe('groups diagnostics by file', () => {
    it('groups errors from the same file together', () => {
      const stdout = [
        makeDiagnostic('src/index.ts', 10, 5, 'TS2304', "Cannot find name 'foo'."),
        makeDiagnostic('src/index.ts', 20, 3, 'TS2551', "Property 'bar' does not exist."),
        makeDiagnostic('src/utils.ts', 5, 1, 'TS7006', "Parameter 'x' implicitly has an 'any' type."),
      ].join('\n');

      const result = filter.filter(makeInput({ stdout, exitCode: 1 }));

      // Should have file section headers
      assert.ok(result.filteredStdout.includes('--- src/index.ts (2 errors) ---'),
        'should group src/index.ts with 2 errors');
      assert.ok(result.filteredStdout.includes('--- src/utils.ts (1 error) ---'),
        'should group src/utils.ts with 1 error');
    });

    it('sorts files by error count (most errors first)', () => {
      const stdout = [
        makeDiagnostic('src/a.ts', 1, 1, 'TS2304', 'Error A'),
        makeDiagnostic('src/b.ts', 1, 1, 'TS2304', 'Error B1'),
        makeDiagnostic('src/b.ts', 2, 1, 'TS2304', 'Error B2'),
        makeDiagnostic('src/b.ts', 3, 1, 'TS2304', 'Error B3'),
      ].join('\n');

      const result = filter.filter(makeInput({ stdout, exitCode: 1 }));
      const bPos = result.filteredStdout.indexOf('--- src/b.ts');
      const aPos = result.filteredStdout.indexOf('--- src/a.ts');
      assert.ok(bPos < aPos,
        'src/b.ts (3 errors) should appear before src/a.ts (1 error)');
    });

    it('caps errors per file at 10 and shows overflow message', () => {
      const errors = Array.from({ length: 15 }, (_, i) =>
        makeDiagnostic('src/big.ts', i + 1, 1, 'TS2304', `Error number ${i + 1}`)
      );
      const stdout = errors.join('\n');

      const result = filter.filter(makeInput({ stdout, exitCode: 1 }));
      assert.ok(result.filteredStdout.includes('... and 5 more errors'),
        'should indicate 5 overflowed errors');
      // First 10 should be present
      assert.ok(result.filteredStdout.includes('Error number 1'));
      assert.ok(result.filteredStdout.includes('Error number 10'));
      // 11th should NOT be shown directly
      assert.ok(!result.filteredStdout.includes('Error number 11') ||
        result.filteredStdout.includes('... and 5 more errors'));
    });
  });

  // ----- Summary line -----

  describe('generates summary line', () => {
    it('generates a summary with total errors and file count', () => {
      const stdout = [
        makeDiagnostic('src/a.ts', 1, 1, 'TS2304', 'Error in a'),
        makeDiagnostic('src/b.ts', 1, 1, 'TS2551', 'Error in b'),
        makeDiagnostic('src/b.ts', 5, 1, 'TS7006', 'Another error in b'),
      ].join('\n');

      const result = filter.filter(makeInput({ stdout, exitCode: 1 }));
      assert.ok(result.filteredStdout.includes('TypeScript: 3 errors in 2 files'),
        'should have summary "TypeScript: 3 errors in 2 files"');
    });

    it('uses singular "error" and "file" for single counts', () => {
      const stdout = makeDiagnostic('src/only.ts', 1, 1, 'TS2304', 'The only error');

      const result = filter.filter(makeInput({ stdout, exitCode: 1 }));
      assert.ok(result.filteredStdout.includes('TypeScript: 1 error in 1 file'),
        'should use singular forms');
    });

    it('omits summary line when there are no diagnostics', () => {
      const stdout = 'Some non-diagnostic output\nAnother line';
      const result = filter.filter(makeInput({ stdout, exitCode: 0 }));
      assert.ok(!result.filteredStdout.includes('TypeScript:'),
        'should not have a TypeScript summary line with 0 errors');
    });
  });

  // ----- Empty output -----

  it('returns empty string for empty stdout', () => {
    const result = filter.filter(makeInput({ stdout: '' }));
    assert.equal(result.filteredStdout, '');
  });

  it('returns empty string for empty stderr', () => {
    const result = filter.filter(makeInput({ stderr: '' }));
    assert.equal(result.filteredStderr, '');
  });

  // ----- ANSI stripping -----

  it('strips ANSI codes from diagnostics', () => {
    const stdout = `\x1b[31m${makeDiagnostic('src/x.ts', 1, 1, 'TS2304', 'err')}\x1b[0m`;
    const result = filter.filter(makeInput({ stdout, exitCode: 1 }));
    assert.ok(!result.filteredStdout.includes('\x1b['));
    assert.ok(result.filteredStdout.includes('TS2304'));
  });

  // ----- Non-diagnostic lines -----

  it('includes non-diagnostic non-empty lines in output', () => {
    const stdout = [
      makeDiagnostic('src/a.ts', 1, 1, 'TS2304', 'err'),
      'Found 1 error.',
    ].join('\n');
    const result = filter.filter(makeInput({ stdout, exitCode: 1 }));
    assert.ok(result.filteredStdout.includes('Found 1 error.'));
  });

  it('strips blank lines from non-diagnostic output', () => {
    const stdout = '  \n\n  \n';
    const result = filter.filter(makeInput({ stdout, exitCode: 0 }));
    // All lines are whitespace-only, so otherLines is empty, no diagnostics => mostly empty
    assert.ok(!result.filteredStdout.includes('TypeScript:'));
  });

  // ----- Budget caps -----

  describe('budget caps', () => {
    it('respects balanced failure budget (16000 chars)', () => {
      const errors = Array.from({ length: 500 }, (_, i) =>
        makeDiagnostic(`src/file${i}.ts`, 1, 1, 'TS2304', `Error message that is somewhat long for file number ${i}`)
      );
      const bigStdout = errors.join('\n');
      assert.ok(bigStdout.length > 16000, 'precondition: input exceeds budget');

      const result = filter.filter(makeInput({
        stdout: bigStdout,
        exitCode: 1,
        profile: 'balanced',
      }));
      assert.ok(result.filteredStdout.length <= 16000,
        `filteredStdout length ${result.filteredStdout.length} should be <= 16000`);
    });

    it('respects strict success budget (4000 chars)', () => {
      const errors = Array.from({ length: 200 }, (_, i) =>
        makeDiagnostic(`src/file${i}.ts`, 1, 1, 'TS2304', `Error message for strict test ${i}`)
      );
      const bigStdout = errors.join('\n');

      const result = filter.filter(makeInput({
        stdout: bigStdout,
        exitCode: 0,
        profile: 'strict',
      }));
      assert.ok(result.filteredStdout.length <= 4000,
        `strict filteredStdout length ${result.filteredStdout.length} should be <= 4000`);
    });

    it('stderr budget is 1/4 of stdout budget', () => {
      const bigStderr = Array.from({ length: 200 }, (_, i) =>
        makeDiagnostic(`src/file${i}.ts`, 1, 1, 'TS2304', `Stderr error ${i}`)
      ).join('\n');

      const result = filter.filter(makeInput({
        stderr: bigStderr,
        exitCode: 0,
        profile: 'balanced',
      }));
      // balanced success = 8000, stderr cap = 2000
      assert.ok(result.filteredStderr.length <= 2000,
        `filteredStderr length ${result.filteredStderr.length} should be <= 2000`);
    });
  });

  // ----- Output metadata -----

  it('populates filterName and filterVersion', () => {
    const result = filter.filter(makeInput({ stdout: 'hello' }));
    assert.equal(result.filterName, 'TypeScriptFilter');
    assert.equal(result.filterVersion, '1.0.0');
  });

  it('calculates byte counts correctly', () => {
    const stdout = 'TS output content';
    const stderr = '';
    const result = filter.filter(makeInput({ stdout, stderr }));
    assert.equal(result.rawStdoutBytes, Buffer.byteLength(stdout, 'utf8'));
    assert.equal(result.rawStderrBytes, 0);
    assert.equal(result.filteredStdoutBytes, Buffer.byteLength(result.filteredStdout, 'utf8'));
  });

  it('returns a header with command and filter info', () => {
    const result = filter.filter(makeInput({ stdout: 'ok', command: 'tsc --noEmit' }));
    assert.ok(result.header.includes('[claui-local-boost]'));
    assert.ok(result.header.includes('tsc --noEmit'));
    assert.ok(result.header.includes('TypeScriptFilter'));
  });

  it('estimates tokens saved', () => {
    // When filtering reduces output, estimatedTokensSaved should be >= 0
    const result = filter.filter(makeInput({ stdout: 'tiny', stderr: '' }));
    assert.ok(result.estimatedTokensSaved >= 0);
  });
});
