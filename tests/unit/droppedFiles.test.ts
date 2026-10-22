import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  MAX_DROPPED_FILES_PER_DROP,
  droppedUriToFsPath,
  matchDroppedItemsToSelection,
  pruneDroppedFiles,
  resolveDroppedPaths,
  sanitizeDroppedFileName,
  saveDroppedFiles,
} from '../../src/extension/webview/droppedFiles';
import type { CandidateStat } from '../../src/extension/webview/droppedFiles';
import { parseExplorerSelectionOutput } from '../../src/extension/webview/explorerSelection';

const isWindows = process.platform === 'win32';

function makeTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claui-drop-test-'));
}

function toBase64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

test('file URIs from VS Code drags become local paths', { skip: !isWindows }, () => {
  assert.equal(droppedUriToFsPath('file:///c%3A/projects/my%20app/a.ts'), 'c:\\projects\\my app\\a.ts');
  assert.equal(droppedUriToFsPath('file:///C:/Users/x/%D7%93%D7%95%D7%97.xlsx'), 'C:\\Users\\x\\דוח.xlsx');
  assert.equal(droppedUriToFsPath('file://server/share/doc.pdf'), '\\\\server\\share\\doc.pdf');
});

test('file URIs become posix paths on macOS / Linux', { skip: isWindows }, () => {
  assert.equal(droppedUriToFsPath('file:///home/u/my%20app/a.ts'), '/home/u/my app/a.ts');
});

test('vscode-remote URIs resolve to the remote path', () => {
  assert.equal(droppedUriToFsPath('vscode-remote://wsl%2Bubuntu/home/u/a.ts'), '/home/u/a.ts');
  assert.equal(droppedUriToFsPath('vscode-remote://ssh-remote%2Bbox/c:/work/a.ts'), 'c:/work/a.ts');
});

test('non-file URIs and garbage are ignored', () => {
  assert.equal(droppedUriToFsPath('https://example.com/a.ts'), null);
  assert.equal(droppedUriToFsPath('untitled:Untitled-1'), null);
  assert.equal(droppedUriToFsPath('not a uri'), null);
  assert.equal(droppedUriToFsPath(''), null);
});

test('resolveDroppedPaths keeps CodeFiles order (folders included) and dedupes URIs case-insensitively on Windows', { skip: !isWindows }, () => {
  const resolved = resolveDroppedPaths(
    ['C:\\proj\\src\\a.ts', 'C:\\proj\\src'],
    ['file:///c%3A/proj/src/a.ts', 'file:///c%3A/proj/src/b.ts', 'https://example.com/x'],
    'win32',
  );
  assert.deepEqual(resolved, ['C:\\proj\\src\\a.ts', 'C:\\proj\\src', 'c:\\proj\\src\\b.ts']);
});

test('resolveDroppedPaths on a Windows host rejects rooted paths without a drive', () => {
  assert.deepEqual(resolveDroppedPaths(['/home/u/a.ts', 'relative\\a.ts', 'D:\\ok.txt'], [], 'win32'), ['D:\\ok.txt']);
});

test('resolveDroppedPaths on a Linux host accepts remote paths', () => {
  assert.deepEqual(
    resolveDroppedPaths([], ['vscode-remote://wsl%2Bubuntu/home/u/a.ts', 'vscode-remote://wsl%2Bubuntu/home/u/a.ts'], 'linux'),
    ['/home/u/a.ts'],
  );
});

test('resolveDroppedPaths tolerates malformed input', () => {
  assert.deepEqual(resolveDroppedPaths(undefined, null, 'win32'), []);
  assert.deepEqual(resolveDroppedPaths('C:\\a.ts', { uri: 'x' }, 'win32'), []);
  assert.deepEqual(resolveDroppedPaths([42, '', '  '], [null], 'win32'), []);
});

test('sanitizeDroppedFileName keeps safe names and Unicode, fixes unsafe ones', () => {
  assert.equal(sanitizeDroppedFileName('report.pdf'), 'report.pdf');
  assert.equal(sanitizeDroppedFileName('דוח רבעוני.xlsx'), 'דוח רבעוני.xlsx');
  assert.equal(sanitizeDroppedFileName('a<b>:c?.txt'), 'a_b__c_.txt');
  assert.equal(sanitizeDroppedFileName('C:\\fake\\dir\\x.txt'), 'x.txt');
  assert.equal(sanitizeDroppedFileName('name. '), 'name');
  assert.equal(sanitizeDroppedFileName('CON.txt'), '_CON.txt');
  assert.equal(sanitizeDroppedFileName('..'), 'dropped-file');
  assert.equal(sanitizeDroppedFileName(undefined), 'dropped-file');
  const longName = `${'x'.repeat(300)}.pdf`;
  const sanitizedLong = sanitizeDroppedFileName(longName);
  assert.equal(sanitizedLong.length, 180);
  assert.ok(sanitizedLong.endsWith('.pdf'));
});

test('saveDroppedFiles writes copies into one fresh folder without overwriting same-name files', async () => {
  const rootDir = makeTempRoot();
  try {
    const result = await saveDroppedFiles(
      [
        { name: 'notes.txt', base64: toBase64('first') },
        { name: 'notes.txt', base64: toBase64('second') },
        { name: 'דוח.csv', base64: toBase64('a,b') },
      ],
      rootDir,
    );
    assert.equal(result.skipped.length, 0);
    assert.deepEqual(result.paths.map((p) => path.basename(p)), ['notes.txt', 'notes (2).txt', 'דוח.csv']);
    assert.ok(result.paths.every((p) => path.dirname(p) === result.dropDir));
    assert.ok(result.dropDir.startsWith(rootDir));
    assert.equal(fs.readFileSync(result.paths[0], 'utf8'), 'first');
    assert.equal(fs.readFileSync(result.paths[1], 'utf8'), 'second');
    assert.equal(fs.readFileSync(result.paths[2], 'utf8'), 'a,b');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('saveDroppedFiles skips invalid, oversized and excess entries', async () => {
  const rootDir = makeTempRoot();
  try {
    const oversizedBase64 = 'A'.repeat(Math.ceil((25 * 1024 * 1024 * 4) / 3) + 8);
    const result = await saveDroppedFiles(
      [
        { name: 'missing-content.txt' },
        null,
        { name: 'huge.bin', base64: oversizedBase64 },
        { name: 'ok.txt', base64: toBase64('ok') },
      ],
      rootDir,
    );
    assert.deepEqual(result.paths.map((p) => path.basename(p)), ['ok.txt']);
    assert.deepEqual(result.skipped.map((s) => s.name), ['missing-content.txt', 'file 2', 'huge.bin']);

    const manyFiles = Array.from({ length: MAX_DROPPED_FILES_PER_DROP + 2 }, (_, index) => ({
      name: `f${index}.txt`,
      base64: toBase64(String(index)),
    }));
    const manyResult = await saveDroppedFiles(manyFiles, rootDir);
    assert.equal(manyResult.paths.length, MAX_DROPPED_FILES_PER_DROP);
    assert.equal(manyResult.skipped.length, 2);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('saveDroppedFiles creates no folder when nothing is saved', async () => {
  const rootDir = makeTempRoot();
  try {
    const result = await saveDroppedFiles('not an array', rootDir);
    assert.deepEqual(result.paths, []);
    assert.equal(fs.existsSync(result.dropDir), false);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('pruneDroppedFiles removes only drop folders older than the retention window', async () => {
  const rootDir = makeTempRoot();
  try {
    const oldFolder = path.join(rootDir, 'old-drop');
    const freshFolder = path.join(rootDir, 'fresh-drop');
    fs.mkdirSync(oldFolder);
    fs.mkdirSync(freshFolder);
    fs.writeFileSync(path.join(oldFolder, 'a.txt'), 'a');
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    fs.utimesSync(oldFolder, tenDaysAgo, tenDaysAgo);

    const removedCount = await pruneDroppedFiles(rootDir);
    assert.equal(removedCount, 1);
    assert.equal(fs.existsSync(oldFolder), false);
    assert.equal(fs.existsSync(freshFolder), true);
    assert.equal(await pruneDroppedFiles(path.join(rootDir, 'does-not-exist')), 0);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

// --- Original paths for OS drops: matching against the File Explorer selection ---

function fakeStat(table: Record<string, CandidateStat>) {
  const statCalls: string[] = [];
  const statPath = async (candidatePath: string) => {
    statCalls.push(candidatePath);
    return table[candidatePath] ?? null;
  };
  return { statPath, statCalls };
}

const MTIME = Date.UTC(2026, 9, 20, 10, 0, 0);
const fileStat = (size: number, mtimeMs = MTIME): CandidateStat => ({ isDirectory: false, size, mtimeMs });
const folderStat: CandidateStat = { isDirectory: true, size: 0, mtimeMs: MTIME };

test('matchDroppedItemsToSelection maps a dropped file to the selected original (case-insensitive on Windows)', async () => {
  const { statPath } = fakeStat({ 'C:\\Docs\\Report.PDF': fileStat(1234) });
  const resolved = await matchDroppedItemsToSelection(
    [{ name: 'report.pdf', size: 1234, lastModified: MTIME + 1500, isDirectory: false }],
    ['C:\\Docs\\Report.PDF', 'C:\\Docs\\other.txt'],
    statPath,
    'win32',
  );
  assert.deepEqual(resolved, ['C:\\Docs\\Report.PDF']);
});

test('matchDroppedItemsToSelection only stats candidates whose name matches', async () => {
  const { statPath, statCalls } = fakeStat({ 'C:\\a\\x.txt': fileStat(1) });
  await matchDroppedItemsToSelection(
    [{ name: 'x.txt', size: 1, lastModified: MTIME, isDirectory: false }],
    ['C:\\a\\x.txt', 'C:\\a\\y.txt', 'C:\\b\\z.txt'],
    statPath,
    'win32',
  );
  assert.deepEqual(statCalls, ['C:\\a\\x.txt']);
});

test('matchDroppedItemsToSelection rejects size or date mismatches (fail closed)', async () => {
  const { statPath } = fakeStat({
    'C:\\a\\size.txt': fileStat(10),
    'C:\\a\\date.txt': fileStat(5, MTIME + 60_000),
  });
  const resolved = await matchDroppedItemsToSelection(
    [
      { name: 'size.txt', size: 11, lastModified: MTIME, isDirectory: false },
      { name: 'date.txt', size: 5, lastModified: MTIME, isDirectory: false },
      { name: 'missing.txt', size: 5, lastModified: MTIME, isDirectory: false },
    ],
    ['C:\\a\\size.txt', 'C:\\a\\date.txt', 'C:\\a\\missing.txt'],
    statPath,
    'win32',
  );
  assert.deepEqual(resolved, [null, null, null]);
});

test('matchDroppedItemsToSelection ignores the date when the webview did not know it', async () => {
  const { statPath } = fakeStat({ 'C:\\a\\x.bin': fileStat(7, MTIME + 99_000) });
  const resolved = await matchDroppedItemsToSelection(
    [{ name: 'x.bin', size: 7, lastModified: 0, isDirectory: false }],
    ['C:\\a\\x.bin'],
    statPath,
    'win32',
  );
  assert.deepEqual(resolved, ['C:\\a\\x.bin']);
});

test('matchDroppedItemsToSelection leaves identical candidates unresolved instead of guessing', async () => {
  const { statPath } = fakeStat({ 'C:\\one\\same.txt': fileStat(3), 'D:\\two\\same.txt': fileStat(3) });
  const resolved = await matchDroppedItemsToSelection(
    [{ name: 'same.txt', size: 3, lastModified: MTIME, isDirectory: false }],
    ['C:\\one\\same.txt', 'D:\\two\\same.txt'],
    statPath,
    'win32',
  );
  assert.deepEqual(resolved, [null]);
});

test('matchDroppedItemsToSelection dedupes the same path selected in two windows', async () => {
  const { statPath } = fakeStat({ 'C:\\one\\same.txt': fileStat(3) });
  const resolved = await matchDroppedItemsToSelection(
    [{ name: 'same.txt', size: 3, lastModified: MTIME, isDirectory: false }],
    ['C:\\one\\same.txt', 'c:\\ONE\\same.txt'],
    statPath,
    'win32',
  );
  assert.deepEqual(resolved, ['C:\\one\\same.txt']);
});

test('matchDroppedItemsToSelection resolves folders and same-name files from different folders', async () => {
  const { statPath } = fakeStat({
    'C:\\proj\\src': folderStat,
    'C:\\a\\notes.md': fileStat(100),
    'C:\\b\\notes.md': fileStat(200),
    'C:\\c\\notes.md': folderStat,
  });
  const resolved = await matchDroppedItemsToSelection(
    [
      { name: 'notes.md', size: 200, lastModified: MTIME, isDirectory: false },
      { name: 'notes.md', size: 100, lastModified: MTIME, isDirectory: false },
      { name: 'src', size: -1, lastModified: 0, isDirectory: true },
    ],
    ['C:\\a\\notes.md', 'C:\\b\\notes.md', 'C:\\c\\notes.md', 'C:\\proj\\src'],
    statPath,
    'win32',
  );
  assert.deepEqual(resolved, ['C:\\b\\notes.md', 'C:\\a\\notes.md', 'C:\\proj\\src']);
});

test('matchDroppedItemsToSelection tolerates malformed input', async () => {
  const { statPath } = fakeStat({});
  assert.deepEqual(await matchDroppedItemsToSelection('nope', ['C:\\a.txt'], statPath, 'win32'), []);
  assert.deepEqual(await matchDroppedItemsToSelection([null, { name: 5 }], ['C:\\a.txt'], statPath, 'win32'), [null, null]);
  assert.deepEqual(
    await matchDroppedItemsToSelection([{ name: 'a.txt', size: 1, lastModified: 0, isDirectory: false }], [], statPath, 'win32'),
    [null],
  );
});

test('matchDroppedItemsToSelection works against the real filesystem', async () => {
  const rootDir = makeTempRoot();
  try {
    const filePath = path.join(rootDir, 'דוח רבעוני.txt');
    fs.writeFileSync(filePath, 'hello');
    const stats = fs.statSync(filePath);
    const resolved = await matchDroppedItemsToSelection(
      [{ name: 'דוח רבעוני.txt', size: 5, lastModified: Math.floor(stats.mtimeMs), isDirectory: false }],
      [filePath, path.join(rootDir, 'does-not-exist.txt')],
    );
    assert.deepEqual(resolved, [filePath]);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('parseExplorerSelectionOutput handles arrays, single values, escapes and junk', () => {
  assert.deepEqual(parseExplorerSelectionOutput(''), []);
  assert.deepEqual(parseExplorerSelectionOutput('[]'), []);
  assert.deepEqual(parseExplorerSelectionOutput('"C:\\\\a.txt"'), ['C:\\a.txt']);
  assert.deepEqual(parseExplorerSelectionOutput('["C:\\\\a.txt","C:\\\\b"]\r\n'), ['C:\\a.txt', 'C:\\b']);
  assert.deepEqual(parseExplorerSelectionOutput('["C:\\\\x\\\\\\u05d3\\u05d5\\u05d7.txt"]'), ['C:\\x\\דוח.txt']);
  assert.deepEqual(parseExplorerSelectionOutput('[1, null, ""]'), []);
  assert.deepEqual(parseExplorerSelectionOutput('Access denied'), []);
});
