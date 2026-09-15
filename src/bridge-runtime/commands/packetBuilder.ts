import { BridgeCommandSpec } from './commandCatalog';
import {
  getBranchChangedFiles,
  getBranchDiff,
  getChangedFiles,
  getWorkingDiff,
  MAX_DIFF_CHARS,
  readFileSafely,
  truncate,
} from './contextProviders';

/**
 * Backend-agnostic task packet: rubric + local context, ready to hand to any
 * model. Produces the exact text both Layer A (macro rewrite) and Layer B
 * (MCP tool result) return, so the two layers never diverge.
 */
export interface TaskPacket {
  /** Short human-readable label for the task (not sent to the model). */
  title: string;
  /** Rubric + gathered context, ready to hand to a model. */
  text: string;
  /** False when there was nothing to act on (e.g. no local diff/changes). */
  hadContext: boolean;
}

function titleFor(spec: BridgeCommandSpec): string {
  switch (spec.name) {
    case 'code-review':
      return 'Code review of current changes';
    case 'security-review':
      return 'Security review of current changes';
    case 'simplify':
      return 'Simplify pass over current changes';
    default:
      return spec.description;
  }
}

/** Single-line, unambiguous rendering for a value that may itself contain
 *  newlines, quotes, or Markdown-structural characters (a filename from a
 *  branch diff may come from another contributor; a diffBase comes from
 *  workspace config) — so it can never be mistaken for packet structure. */
function inline(value: string): string {
  return JSON.stringify(value);
}

/** Wrap `text` in a fenced code block using a backtick run longer than any run
 *  already present in the text — so embedded ``` (e.g. a changed markdown
 *  file, or a new file whose content contains a fence) can never prematurely
 *  close the packet's fence. */
function fence(text: string, lang: string): string {
  const runs = text.match(/`+/g) || [];
  const longest = runs.reduce((max, r) => Math.max(max, r.length), 0);
  const tick = '`'.repeat(Math.max(3, longest + 1));
  return `${tick}${lang}\n${text}\n${tick}`;
}

/** Per-file cap for embedded untracked-file content, well under MAX_DIFF_CHARS
 *  so several new files can be embedded without one dominating the packet. */
const UNTRACKED_FILE_CAP = 8_000;

/** Headroom reserved for the trailing "N more files omitted" note, so it is
 *  never itself the thing that pushes the block over MAX_DIFF_CHARS. */
const OMITTED_NOTE_RESERVE = 200;

/** Some backends are text-only (no read tool of their own) — for brand-new
 *  untracked files, `git diff` has nothing to show, so embed bounded file
 *  contents directly rather than pointing at a tool the backend may not have.
 *  Best-effort: unreadable entries (binary, too large, a directory) are
 *  silently skipped rather than failing the whole packet.
 *
 *  Budgets whole fenced blocks BEFORE appending them (rather than truncating
 *  the joined, already-fenced text afterwards) so the hard MAX_DIFF_CHARS cap
 *  never cuts through a block's closing fence — a dropped block is instead
 *  reported by a trailing note placed outside every fence. */
function buildUntrackedContentBlock(cwd: string, files: string[]): string {
  const parts: string[] = [];
  let omitted = 0;
  for (const f of files) {
    const content = readFileSafely(cwd, f, UNTRACKED_FILE_CAP);
    if (content === null) continue; // unreadable/binary — silently skipped
    const block = `--- ${inline(f)} (new file) ---\n${fence(content, '')}`;
    const candidateLength = parts.length ? parts.join('\n\n').length + 2 + block.length : block.length;
    if (candidateLength > MAX_DIFF_CHARS - OMITTED_NOTE_RESERVE) {
      omitted++;
      continue;
    }
    parts.push(block);
  }
  let text = parts.join('\n\n');
  if (omitted > 0) {
    text +=
      `\n\n[${omitted} more new file${omitted === 1 ? '' : 's'} omitted here for length — ` +
      'ask the user to paste their contents if you need to see them]';
  }
  return text;
}

export function buildTaskPacket(
  spec: BridgeCommandSpec,
  arg: string,
  cwd: string,
  diffBase: string,
): TaskPacket {
  const title = titleFor(spec);
  const isBranch = spec.context.diff === 'branch';

  let rawDiff = '';
  if (spec.context.diff === 'working') rawDiff = getWorkingDiff(cwd);
  else if (isBranch) rawDiff = getBranchDiff(cwd, diffBase);

  const changedFiles = spec.context.includeChangedFileList
    ? isBranch
      ? getBranchChangedFiles(cwd, diffBase)
      : getChangedFiles(cwd)
    : [];

  const hasDiff = !!rawDiff.trim();
  const hasContext = spec.context.diff === 'none' || hasDiff || changedFiles.length > 0;

  if (!hasContext) {
    const reason = isBranch
      ? `no changes were found between ${inline(diffBase || 'main')} and HEAD (or that base ref could not be resolved)`
      : 'no staged, unstaged, or untracked changes were found in this workspace';
    return {
      title,
      hadContext: false,
      text:
        `${spec.rubric.trim()}\n\nThere is nothing to review right now — ${reason}. Tell the user ` +
        "there's nothing to review and ask them to make some changes first (or check the branch/base is correct).",
    };
  }

  const sections: string[] = [spec.rubric.trim()];

  if (arg) {
    sections.push(
      spec.context.argAsTarget ? `\n## Target\n${arg}` : `\n## Additional instructions from the user\n${arg}`,
    );
  }

  if (spec.context.includeChangedFileList) {
    sections.push(
      changedFiles.length
        ? `\n## Changed files\n${changedFiles.map((f) => `- ${inline(f)}`).join('\n')}`
        : '\n## Changed files\n(none detected)',
    );
  }

  if (spec.context.diff !== 'none') {
    if (hasDiff) {
      const { text: diffText } = truncate(rawDiff, MAX_DIFF_CHARS);
      sections.push(`\n## Diff\n${fence(diffText, 'diff')}`);
    } else if (!isBranch && changedFiles.length) {
      // Working mode with untracked-only changes: git diff has nothing to
      // show for brand-new files. Embed bounded file contents directly since
      // some backends (OpenAI-compatible, council members) are text-only and
      // have no read tool of their own to fetch these.
      const content = buildUntrackedContentBlock(cwd, changedFiles);
      sections.push(
        content
          ? `\n## New file contents (untracked — no diff available)\n${content}`
          : '\n## Diff\n(the changed files above have no readable content to embed here — likely binary)',
      );
    } else {
      sections.push('\n## Diff\n(no tracked diff for this range)');
    }
  }

  return { title, text: sections.join('\n'), hadContext: true };
}
