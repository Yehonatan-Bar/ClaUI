import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  getBranchChangedFiles,
  getBranchDiff,
  getChangedFiles,
  getWorkingDiff,
  MAX_DIFF_CHARS,
  readFileSafely,
  truncate,
} from '../../src/bridge-runtime/commands/contextProviders';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function makeRepo(): { dir: string; cleanup: () => void } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'claui-ctx-test-')));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'branch', '-M', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('getWorkingDiff: empty on a clean repo', () => {
  const { dir, cleanup } = makeRepo();
  try {
    assert.equal(getWorkingDiff(dir).trim(), '');
  } finally {
    cleanup();
  }
});

test('getWorkingDiff: picks up unstaged and staged changes', () => {
  const { dir, cleanup } = makeRepo();
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\nworld\n');
    assert.match(getWorkingDiff(dir), /\+world/);

    git(dir, 'add', '.');
    assert.match(getWorkingDiff(dir), /\+world/);
  } finally {
    cleanup();
  }
});

test('getChangedFiles: lists modified and untracked paths', () => {
  const { dir, cleanup } = makeRepo();
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\nworld\n');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'new file\n');
    const files = getChangedFiles(dir);
    assert.ok(files.includes('a.txt'), files.join(','));
    assert.ok(files.includes('b.txt'), files.join(','));
  } finally {
    cleanup();
  }
});

test('getChangedFiles: a filename with spaces is not mangled', () => {
  const { dir, cleanup } = makeRepo();
  try {
    fs.writeFileSync(path.join(dir, 'my file.txt'), 'content\n');
    const files = getChangedFiles(dir);
    assert.ok(files.includes('my file.txt'), files.join(','));
  } finally {
    cleanup();
  }
});

test('getChangedFiles: a rename reports the new path, not an "old -> new" string', () => {
  const { dir, cleanup } = makeRepo();
  try {
    git(dir, 'mv', 'a.txt', 'renamed.txt');
    const files = getChangedFiles(dir);
    assert.ok(files.includes('renamed.txt'), files.join(','));
    assert.ok(
      files.every((f) => !f.includes(' -> ')),
      files.join(','),
    );
  } finally {
    cleanup();
  }
});

test('getBranchDiff: diffs against a named base branch', () => {
  const { dir, cleanup } = makeRepo();
  try {
    git(dir, 'checkout', '-q', '-b', 'feature');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\nfeature\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'feature change');
    assert.match(getBranchDiff(dir, 'main'), /\+feature/);
  } finally {
    cleanup();
  }
});

test('getBranchDiff: a base starting with "-" cannot inject a git option', () => {
  const { dir, cleanup } = makeRepo();
  try {
    // Leave an uncommitted change: if `--line-prefix=INJECTED` were parsed as
    // a git OPTION (the vulnerable behavior) rather than an unresolvable
    // revision, it would print this working-tree change with the injected
    // prefix. With the fix, git fails to resolve the literal revision name
    // "--line-prefix=INJECTED...HEAD" and the call returns ''.
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\nunstaged\n');
    const result = getBranchDiff(dir, '--line-prefix=INJECTED');
    assert.equal(result, '');
    assert.ok(!result.includes('INJECTED'));
  } finally {
    cleanup();
  }
});

test('getBranchChangedFiles: a base starting with "-" cannot inject a git option', () => {
  const { dir, cleanup } = makeRepo();
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\nunstaged\n');
    const result = getBranchChangedFiles(dir, '--line-prefix=INJECTED');
    assert.deepEqual(result, []);
  } finally {
    cleanup();
  }
});

test('getBranchChangedFiles: a filename with spaces is not mangled', () => {
  const { dir, cleanup } = makeRepo();
  try {
    git(dir, 'checkout', '-q', '-b', 'feature');
    fs.writeFileSync(path.join(dir, 'my new file.txt'), 'content\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'add file with spaces');
    const files = getBranchChangedFiles(dir, 'main');
    assert.ok(files.includes('my new file.txt'), files.join(','));
  } finally {
    cleanup();
  }
});

test('getWorkingDiff: an oversized diff surfaces a visible marker, never looks like an empty diff', () => {
  const { dir, cleanup } = makeRepo();
  try {
    // Exceeds the 4 MiB execFileSync capture buffer, forcing ENOBUFS.
    fs.writeFileSync(path.join(dir, 'a.txt'), 'z'.repeat(6 * 1024 * 1024));
    const result = getWorkingDiff(dir);
    assert.notEqual(result, '');
    assert.match(result, /too large to capture/i);
  } finally {
    cleanup();
  }
});

test('getBranchChangedFiles: scoped to the branch diff, not working-tree status', () => {
  const { dir, cleanup } = makeRepo();
  try {
    git(dir, 'checkout', '-q', '-b', 'feature');
    fs.writeFileSync(path.join(dir, 'branch-file.txt'), 'branch content\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'branch change');
    // Unrelated, unstaged working-tree change that must NOT appear.
    fs.writeFileSync(path.join(dir, 'unrelated.txt'), 'uncommitted\n');

    const branchFiles = getBranchChangedFiles(dir, 'main');
    assert.ok(branchFiles.includes('branch-file.txt'), branchFiles.join(','));
    assert.ok(!branchFiles.includes('unrelated.txt'), branchFiles.join(','));
  } finally {
    cleanup();
  }
});

test('git helpers never throw outside a git repo — they return empty results', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claui-ctx-nogit-'));
  try {
    assert.equal(getWorkingDiff(dir), '');
    assert.deepEqual(getChangedFiles(dir), []);
    assert.equal(getBranchDiff(dir, 'main'), '');
    assert.deepEqual(getBranchChangedFiles(dir, 'main'), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readFileSafely: reads a file inside cwd', () => {
  const { dir, cleanup } = makeRepo();
  try {
    assert.equal(readFileSafely(dir, 'a.txt'), 'hello\n');
  } finally {
    cleanup();
  }
});

test('readFileSafely: reads a file in a nested subdirectory', () => {
  const { dir, cleanup } = makeRepo();
  try {
    fs.mkdirSync(path.join(dir, 'sub', 'dir'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'sub', 'dir', 'nested.txt'), 'nested content\n');
    assert.equal(readFileSafely(dir, 'sub/dir/nested.txt'), 'nested content\n');
  } finally {
    cleanup();
  }
});

test('readFileSafely: refuses to escape cwd via a real sibling file', () => {
  const { dir, cleanup } = makeRepo();
  try {
    const sibling = path.join(path.dirname(dir), `claui-ctx-secret-${path.basename(dir)}.txt`);
    fs.writeFileSync(sibling, 'top secret\n');
    try {
      // Prove this is a real, readable file (not a "missing file" false
      // negative) before asserting the guard rejects reaching it via '..'.
      assert.equal(fs.readFileSync(sibling, 'utf8'), 'top secret\n');
      const rel = path.relative(dir, sibling);
      assert.equal(readFileSafely(dir, rel), null);
    } finally {
      fs.rmSync(sibling, { force: true });
    }
  } finally {
    cleanup();
  }
});

test('readFileSafely: refuses a symlink that escapes cwd', (t) => {
  const { dir, cleanup } = makeRepo();
  try {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claui-ctx-outside-'));
    const outsideFile = path.join(outsideDir, 'secret.txt');
    fs.writeFileSync(outsideFile, 'via symlink\n');
    const linkPath = path.join(dir, 'escape-link.txt');
    try {
      fs.symlinkSync(outsideFile, linkPath, 'file');
    } catch {
      // Creating symlinks can require elevated privileges on Windows; skip
      // rather than fail the suite in that environment.
      fs.rmSync(outsideDir, { recursive: true, force: true });
      t.skip('symlink creation not permitted in this environment');
      return;
    }
    try {
      assert.equal(readFileSafely(dir, 'escape-link.txt'), null);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  } finally {
    cleanup();
  }
});

test('readFileSafely: a real filename literally starting with ".." is not rejected', () => {
  const { dir, cleanup } = makeRepo();
  try {
    fs.writeFileSync(path.join(dir, '..config'), 'dotdot-prefixed name\n');
    assert.equal(readFileSafely(dir, '..config'), 'dotdot-prefixed name\n');
  } finally {
    cleanup();
  }
});

test('readFileSafely: refuses a directory junction that escapes cwd (Windows)', (t) => {
  if (process.platform !== 'win32') {
    t.skip('directory junctions are a Windows-only escape class');
    return;
  }
  const { dir, cleanup } = makeRepo();
  try {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claui-ctx-junction-'));
    fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'via junction\n');
    const juncPath = path.join(dir, 'junc');
    try {
      fs.symlinkSync(outsideDir, juncPath, 'junction');
    } catch {
      // Junctions normally need no elevated privileges, but fall back to a
      // skip rather than fail the suite if the environment disallows it.
      fs.rmSync(outsideDir, { recursive: true, force: true });
      t.skip('junction creation not permitted in this environment');
      return;
    }
    try {
      assert.equal(readFileSafely(dir, 'junc/secret.txt'), null);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  } finally {
    cleanup();
  }
});

test('readFileSafely: null for binary content (a NUL byte in the sampled range)', () => {
  const { dir, cleanup } = makeRepo();
  try {
    const bin = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG-ish header
    fs.writeFileSync(path.join(dir, 'image.png'), bin);
    assert.equal(readFileSafely(dir, 'image.png'), null);
  } finally {
    cleanup();
  }
});

test('readFileSafely: null for a missing file', () => {
  const { dir, cleanup } = makeRepo();
  try {
    assert.equal(readFileSafely(dir, 'does-not-exist.txt'), null);
  } finally {
    cleanup();
  }
});

test('readFileSafely: null for a directory', () => {
  const { dir, cleanup } = makeRepo();
  try {
    fs.mkdirSync(path.join(dir, 'adir'));
    assert.equal(readFileSafely(dir, 'adir'), null);
  } finally {
    cleanup();
  }
});

test('readFileSafely: bounds memory on a large file instead of reading it whole', () => {
  const { dir, cleanup } = makeRepo();
  try {
    const big = 'y'.repeat(500_000);
    fs.writeFileSync(path.join(dir, 'big.txt'), big);
    const result = readFileSafely(dir, 'big.txt', 1000);
    assert.ok(result && result.length < big.length);
    assert.match(result as string, /diff truncated/);
  } finally {
    cleanup();
  }
});

test('truncate: no-op under the cap', () => {
  const r = truncate('short', 100);
  assert.equal(r.text, 'short');
  assert.equal(r.truncated, false);
});

test('truncate: cuts and appends a note over the cap', () => {
  const big = 'x'.repeat(MAX_DIFF_CHARS + 500);
  const r = truncate(big, MAX_DIFF_CHARS);
  assert.equal(r.truncated, true);
  assert.ok(r.text.length < big.length);
  assert.match(r.text, /diff truncated/);
});

test('truncate: never splits a UTF-16 surrogate pair', () => {
  const text = `a${'x'.repeat(8)}\u{1F600}b`; // ...x😀b — emoji spans 2 code units
  const cutAtSurrogate = text.length - 2; // lands exactly between the surrogate pair
  const r = truncate(text, cutAtSurrogate);
  const kept = r.text.split('\n')[0];
  // Either both surrogate halves are kept, or neither is — never a lone high
  // surrogate at the end (which would be an invalid/unpaired code unit).
  const lastCode = kept.charCodeAt(kept.length - 1);
  assert.ok(lastCode < 0xd800 || lastCode > 0xdbff, `lone high surrogate left dangling: ${kept}`);
});
