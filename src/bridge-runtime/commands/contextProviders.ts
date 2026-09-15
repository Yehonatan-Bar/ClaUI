import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Deterministic local context for bridge command packets (git diff, changed
 * files, file reads) — used by both the macro path (packetBuilder.ts) and the
 * MCP tool server (mcp/commandMcpServer.ts) so they see identical context.
 *
 * Every function here is best-effort: git/fs failures never throw, they just
 * fall back to an empty result, so a missing repo or an unreadable file never
 * breaks a command turn.
 */

/** Cap on a single diff blob before truncation kicks in. */
export const MAX_DIFF_CHARS = 60_000;

/** Bound on execFileSync's captured stdout for a diff — comfortably above
 *  MAX_DIFF_CHARS (the diff is truncated to that anyway) without allocating an
 *  unreasonable buffer for a pathological diff. When exceeded, `runGitDiff`
 *  surfaces a visible marker instead of looking identical to "no diff". */
const GIT_MAX_BUFFER = 4 * 1024 * 1024;

/** Flags applied to every `git diff` invocation: never shell out to a
 *  configured external diff/textconv driver for content we're about to hand
 *  to a model. */
const DIFF_SAFETY_FLAGS = ['--no-ext-diff', '--no-textconv'];

const DIFF_TOO_LARGE_MARKER =
  '[diff too large to capture in full — ask the user to scope the review to specific files or a smaller range]';

function runGit(args: string[], cwd: string): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 10_000, maxBuffer: GIT_MAX_BUFFER });
  } catch {
    return '';
  }
}

/** Like `runGit`, but distinguishes "genuinely no diff" from "a diff exists
 *  but exceeded the capture buffer" (ENOBUFS) — the latter returns a visible
 *  marker so it is never silently mislabeled as "nothing changed". */
function runGitDiff(args: string[], cwd: string): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 10_000, maxBuffer: GIT_MAX_BUFFER });
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOBUFS') return DIFF_TOO_LARGE_MARKER;
    return '';
  }
}

const DEFAULT_TRUNCATION_NOTE = 'diff truncated — use your read/grep tools to inspect the full files';

/** Truncate `text` to at most `max` UTF-16 code units, appending `note` when
 *  cut (defaults to a diff-specific note; callers truncating something other
 *  than a diff, e.g. an offloaded co-processor report, should pass their own).
 *  Backs off one unit when the cut point would split a surrogate pair. */
export function truncate(
  text: string,
  max: number,
  note: string = DEFAULT_TRUNCATION_NOTE,
): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  let cut = max;
  const code = text.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1; // don't split a surrogate pair
  return {
    text: `${text.slice(0, cut)}\n[${note}]`,
    truncated: true,
  };
}

/** Combined `git diff` (unstaged) + `git diff --staged` in `cwd`. Both are
 *  fixed argv with no caller-controlled text, so no option-injection risk. */
export function getWorkingDiff(cwd: string): string {
  const staged = runGitDiff(['diff', ...DIFF_SAFETY_FLAGS, '--staged'], cwd);
  const unstaged = runGitDiff(['diff', ...DIFF_SAFETY_FLAGS], cwd);
  return [staged, unstaged].filter(Boolean).join('\n');
}

/** `git diff <base>...HEAD` in `cwd`. `base` comes from user config
 *  (commandTools.diffBase) and could start with `-`; `--end-of-options` stops
 *  git from parsing it as a flag (e.g. `--line-prefix=...`, `--output=...`). */
export function getBranchDiff(cwd: string, base: string): string {
  const b = String(base || 'main').trim() || 'main';
  return runGitDiff(['diff', ...DIFF_SAFETY_FLAGS, '--end-of-options', `${b}...HEAD`, '--'], cwd);
}

/** Changed file paths for a branch diff (`git diff --name-only <base>...HEAD`),
 *  scoped to the branch — distinct from the working-tree status used by
 *  `getChangedFiles`, so branch-mode commands never list unrelated
 *  uncommitted changes as if they were part of the branch. NUL-delimited (`-z`)
 *  so filenames with spaces, Unicode, or control characters are never mangled
 *  by newline-splitting + trim. */
export function getBranchChangedFiles(cwd: string, base: string): string[] {
  const b = String(base || 'main').trim() || 'main';
  const out = runGit(['diff', '--name-only', '-z', '--end-of-options', `${b}...HEAD`, '--'], cwd);
  if (!out) return [];
  return out.split('\0').filter((f) => f.length > 0);
}

/** Changed file paths (staged, unstaged, and untracked) via
 *  `git status --porcelain=v1 -z`. NUL-delimited parsing (rather than
 *  splitting on '\n' and trimming) so filenames with spaces, Unicode, or a
 *  rename's "old -> new" pair are handled correctly and never mangled. */
export function getChangedFiles(cwd: string): string[] {
  const out = runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'], cwd);
  if (!out) return [];
  const records = out.split('\0').filter((r) => r.length > 0);
  const files: string[] = [];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const status = rec.slice(0, 2);
    const filePath = rec.slice(3);
    if (filePath) files.push(filePath);
    // Renamed/copied entries carry a second NUL-separated record (the
    // original path) immediately after — consume it without emitting so a
    // filename never contains a literal " -> " arrow.
    if (status[0] === 'R' || status[0] === 'C' || status[1] === 'R' || status[1] === 'C') {
      i++;
    }
  }
  return files;
}

/** Read a file relative to `cwd`, refusing to escape it — including via a
 *  symlink/junction that resolves outside `cwd` — truncated to `maxChars`
 *  without ever loading more than a bounded amount into memory. */
export function readFileSafely(cwd: string, rel: string, maxChars: number = MAX_DIFF_CHARS): string | null {
  try {
    const root = fs.realpathSync.native(path.resolve(cwd));
    const target = fs.realpathSync.native(path.resolve(root, rel));
    const relToRoot = path.relative(root, target);
    // Exact traversal check: only reject when the relative path IS '..' or
    // starts with '..' + separator — a real filename like "..config" (which
    // lexically starts with "..") must NOT be rejected.
    if (relToRoot === '..' || relToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relToRoot)) {
      return null;
    }

    const stat = fs.statSync(target);
    if (!stat.isFile()) return null;

    // Bounded read: at most ~4 bytes per char (worst-case UTF-8), so a huge
    // file is never fully loaded just to be truncated afterwards.
    const readBytes = Math.min(stat.size, maxChars * 4);
    const fd = fs.openSync(target, 'r');
    try {
      const buf = Buffer.alloc(readBytes);
      const bytesRead = fs.readSync(fd, buf, 0, readBytes, 0);
      const slice = buf.subarray(0, bytesRead);
      // Binary detection (git's own heuristic): a NUL byte in the sampled
      // range means this isn't text worth decoding/handing to a model.
      if (slice.subarray(0, Math.min(slice.length, 8000)).includes(0)) return null;
      return truncate(slice.toString('utf8'), maxChars).text;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}
