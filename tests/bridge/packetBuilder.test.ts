import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildTaskPacket } from '../../src/bridge-runtime/commands/packetBuilder';
import { findBridgeCommand } from '../../src/bridge-runtime/commands/commandCatalog';
import { MAX_DIFF_CHARS } from '../../src/bridge-runtime/commands/contextProviders';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function makeRepo(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claui-packet-test-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'branch', '-M', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const codeReview = findBridgeCommand('code-review')!;
const branchCodeReview = { ...codeReview, context: { ...codeReview.context, diff: 'branch' as const } };

test('buildTaskPacket: hadContext=false when there is truly nothing to review', () => {
  const { dir, cleanup } = makeRepo();
  try {
    const packet = buildTaskPacket(codeReview, '', dir, 'main');
    assert.equal(packet.hadContext, false);
    assert.match(packet.text, /nothing to review/i);
    // Must not leak the absolute local path into text handed to a remote model.
    assert.ok(!packet.text.includes(dir));
  } finally {
    cleanup();
  }
});

test('buildTaskPacket: includes the rubric, changed files, and working diff', () => {
  const { dir, cleanup } = makeRepo();
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\nworld\n');
    const packet = buildTaskPacket(codeReview, '', dir, 'main');
    assert.equal(packet.hadContext, true);
    assert.match(packet.text, /Prioritize, in order/); // rubric text present
    assert.match(packet.text, /## Changed files/);
    assert.match(packet.text, /a\.txt/);
    assert.match(packet.text, /## Diff/);
    assert.match(packet.text, /\+world/);
  } finally {
    cleanup();
  }
});

test('buildTaskPacket: untracked-only changes still count as context and embed file contents', () => {
  const { dir, cleanup } = makeRepo();
  try {
    fs.writeFileSync(path.join(dir, 'new-file.txt'), 'brand new content\n');
    const packet = buildTaskPacket(codeReview, '', dir, 'main');
    assert.equal(packet.hadContext, true);
    assert.match(packet.text, /## Changed files/);
    assert.match(packet.text, /new-file\.txt/);
    // Text-only backends have no read tool of their own — the actual new-file
    // content must be embedded, not just a pointer to "use your tools".
    assert.match(packet.text, /New file contents/);
    assert.match(packet.text, /brand new content/);
  } finally {
    cleanup();
  }
});

test('buildTaskPacket: branch mode with no changes phrases "nothing to review" without working-tree wording', () => {
  const { dir, cleanup } = makeRepo();
  try {
    const packet = buildTaskPacket(branchCodeReview, '', dir, 'main');
    assert.equal(packet.hadContext, false);
    assert.match(packet.text, /between "main" and HEAD/);
    assert.ok(!/staged, unstaged, or untracked/.test(packet.text));
  } finally {
    cleanup();
  }
});

test('buildTaskPacket: branch-diff scoping sees only committed branch changes', () => {
  const { dir, cleanup } = makeRepo();
  try {
    git(dir, 'checkout', '-q', '-b', 'feature');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\nfeature\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'feature change');

    const packet = buildTaskPacket(branchCodeReview, '', dir, 'main');
    assert.equal(packet.hadContext, true);
    assert.match(packet.text, /\+feature/);
  } finally {
    cleanup();
  }
});

test('buildTaskPacket: branch-diff changed-file list excludes unrelated uncommitted changes', () => {
  const { dir, cleanup } = makeRepo();
  try {
    git(dir, 'checkout', '-q', '-b', 'feature');
    fs.writeFileSync(path.join(dir, 'branch-file.txt'), 'branch content\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'branch change');
    fs.writeFileSync(path.join(dir, 'unrelated.txt'), 'uncommitted\n');

    const packet = buildTaskPacket(branchCodeReview, '', dir, 'main');
    assert.match(packet.text, /branch-file\.txt/);
    assert.ok(!packet.text.includes('unrelated.txt'), packet.text);
  } finally {
    cleanup();
  }
});

test('buildTaskPacket: truncates a huge diff and appends the truncation note', () => {
  const { dir, cleanup } = makeRepo();
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'x'.repeat(MAX_DIFF_CHARS + 10_000));
    const packet = buildTaskPacket(codeReview, '', dir, 'main');
    assert.match(packet.text, /diff truncated/);
  } finally {
    cleanup();
  }
});

test('buildTaskPacket: user arg is appended as additional instructions', () => {
  const { dir, cleanup } = makeRepo();
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\nworld\n');
    const packet = buildTaskPacket(codeReview, 'focus on the auth module', dir, 'main');
    assert.match(packet.text, /Additional instructions from the user/);
    assert.match(packet.text, /focus on the auth module/);
  } finally {
    cleanup();
  }
});

test('buildTaskPacket: untracked-content block hard-caps total size without truncating mid-fence', () => {
  const { dir, cleanup } = makeRepo();
  try {
    // Several files each under the per-file cap (8,000) but together well
    // over MAX_DIFF_CHARS (60,000), so some must be dropped whole rather than
    // having the joined text truncated mid-block (which would strip a
    // closing fence).
    for (let i = 0; i < 10; i++) {
      fs.writeFileSync(path.join(dir, `file${i}.txt`), 'z'.repeat(7_500));
    }
    const packet = buildTaskPacket(codeReview, '', dir, 'main');
    assert.equal(packet.hadContext, true);
    assert.ok(packet.text.length <= MAX_DIFF_CHARS + 2_000, `packet text too large: ${packet.text.length}`);

    const section = packet.text.split('## New file contents')[1] ?? '';
    // Every opening fence has a matching closing fence of the same length —
    // never cut off mid-block.
    const fenceLines = [...section.matchAll(/^(`{3,})$/gm)].map((m) => m[1]);
    assert.ok(fenceLines.length > 0 && fenceLines.length % 2 === 0, `unbalanced fences: ${fenceLines.length}`);
    for (let i = 0; i < fenceLines.length; i += 2) {
      assert.equal(fenceLines[i], fenceLines[i + 1], 'opening/closing fence length mismatch');
    }
    // The omission note (proving some files were dropped, not silently
    // truncated) sits after the last closing fence, never inside one.
    const lastFenceEnd = section.lastIndexOf(fenceLines[fenceLines.length - 1]);
    const noteIndex = section.indexOf('omitted here for length');
    assert.ok(noteIndex > lastFenceEnd, 'omission note should appear after the last fenced block');
  } finally {
    cleanup();
  }
});

test('buildTaskPacket: a filename with Markdown-structural characters is rendered as a single escaped token', () => {
  const { dir, cleanup } = makeRepo();
  try {
    // '#', backticks and spaces are valid on NTFS (unlike a literal newline,
    // which git-tracked filenames could carry on POSIX filesystems but which
    // cannot be created directly on this Windows dev machine to test against).
    const trickyName = '## fake `heading`.txt';
    fs.writeFileSync(path.join(dir, trickyName), 'content\n');
    const packet = buildTaskPacket(codeReview, '', dir, 'main');
    assert.equal(packet.hadContext, true);
    // The filename must appear as a single JSON-encoded token rather than raw
    // text that could be mistaken for a Markdown heading/fence.
    assert.ok(packet.text.includes(`- ${JSON.stringify(trickyName)}`), packet.text);
  } finally {
    cleanup();
  }
});

test('buildTaskPacket: binary untracked files are skipped, not decoded as garbled text', () => {
  const { dir, cleanup } = makeRepo();
  try {
    const bin = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00, 0x41, 0x42]);
    fs.writeFileSync(path.join(dir, 'image.bin'), bin);
    const packet = buildTaskPacket(codeReview, '', dir, 'main');
    assert.equal(packet.hadContext, true);
    assert.match(packet.text, /image\.bin/); // listed as a changed file
    assert.ok(!packet.text.includes(' ')); // but its raw bytes are never embedded
  } finally {
    cleanup();
  }
});

test('buildTaskPacket: a diff containing a markdown fence cannot break out of the packet fence', () => {
  const { dir, cleanup } = makeRepo();
  try {
    // A changed markdown file whose content itself contains a ``` fence — the
    // unified diff will contain a line like " ```js" (context) or "+```js".
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n```js\ncode\n```\n');
    const packet = buildTaskPacket(codeReview, '', dir, 'main');
    assert.equal(packet.hadContext, true);
    // The opening fence around the diff must use MORE backticks than any run
    // found inside the diff content, so an embedded ``` can't close it early.
    const match = packet.text.match(/\n(`{3,})diff\n/);
    assert.ok(match, 'expected a fenced diff block');
    const fenceLen = match![1].length;
    assert.ok(fenceLen > 3, `fence should be longer than the embedded \`\`\` run, got ${fenceLen}`);
  } finally {
    cleanup();
  }
});
