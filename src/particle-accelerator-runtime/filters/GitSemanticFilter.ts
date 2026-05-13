import { FilterInput, FilterOutput } from '../../extension/particle-accelerator/ParticleAcceleratorTypes';
import { OutputFilter } from './OutputFilterRegistry';
import { stripAnsi, getBudgetCap, applyBudgetCap, buildFilterOutput } from './filterUtils';

const SUPPORTS_PATTERN = /^git\s+(diff|log|show|status|branch|blame|merge|stash)\b/;

export class GitSemanticFilter implements OutputFilter {
  name = 'GitSemanticFilter';
  version = '1.0.0';

  supports(input: FilterInput): boolean {
    return SUPPORTS_PATTERN.test(input.command.trim());
  }

  filter(input: FilterInput): FilterOutput {
    const sub = detectSubcommand(input.command);
    const cap = getBudgetCap(input.profile, input.exitCode, input.budgetOverrides);
    const stderrCap = Math.floor(cap / 4);

    let filteredStdout: string;
    switch (sub) {
      case 'diff':
        filteredStdout = filterDiff(input.stdout, cap);
        break;
      case 'log':
        filteredStdout = filterLog(input.stdout, cap);
        break;
      case 'show':
        filteredStdout = filterShow(input.stdout, cap);
        break;
      case 'status':
        filteredStdout = filterStatus(input.stdout, cap);
        break;
      default:
        filteredStdout = filterGenericGit(input.stdout, cap);
        break;
    }

    const filteredStderr = applyBudgetCap(stripAnsi(input.stderr), stderrCap);
    return buildFilterOutput(input, filteredStdout, filteredStderr, this.name, this.version);
  }
}

function detectSubcommand(command: string): string {
  const match = /^git\s+(\S+)/.exec(command.trim());
  return match ? match[1] : 'unknown';
}

// ─── git diff ──────────────────────────────────────────────────────────

interface DiffFile {
  header: string;
  fileA: string;
  fileB: string;
  hunks: string[];
  additions: number;
  deletions: number;
}

function filterDiff(text: string, budget: number): string {
  if (!text) return '';
  const cleaned = stripAnsi(text);

  if (cleaned.length <= budget) return cleaned;

  const files = parseDiffFiles(cleaned);
  if (files.length === 0) return applyBudgetCap(cleaned, budget);

  const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);

  const parts: string[] = [];
  parts.push(`${files.length} file${files.length === 1 ? '' : 's'} changed, +${totalAdditions} insertions, -${totalDeletions} deletions`);
  parts.push('');

  const MAX_HUNKS_PER_FILE = 5;
  const MAX_LINES_PER_HUNK = 40;

  let usedChars = parts.join('\n').length;
  let filesShown = 0;

  for (const file of files) {
    const fileHeader = `--- ${file.fileB} (+${file.additions}/-${file.deletions}) ---`;

    if (usedChars + fileHeader.length + 100 > budget && filesShown > 0) {
      parts.push(`[... and ${files.length - filesShown} more files ...]`);
      break;
    }

    parts.push(fileHeader);
    filesShown++;

    const hunkCount = Math.min(file.hunks.length, MAX_HUNKS_PER_FILE);
    for (let i = 0; i < hunkCount; i++) {
      const hunkLines = file.hunks[i].split('\n');
      if (hunkLines.length > MAX_LINES_PER_HUNK) {
        parts.push(hunkLines.slice(0, MAX_LINES_PER_HUNK).join('\n'));
        parts.push(`  [... ${hunkLines.length - MAX_LINES_PER_HUNK} more lines in hunk ...]`);
      } else {
        parts.push(file.hunks[i]);
      }
    }
    if (file.hunks.length > MAX_HUNKS_PER_FILE) {
      parts.push(`  [... ${file.hunks.length - MAX_HUNKS_PER_FILE} more hunks ...]`);
    }
    parts.push('');
    usedChars = parts.join('\n').length;
  }

  return applyBudgetCap(parts.join('\n'), budget);
}

function parseDiffFiles(text: string): DiffFile[] {
  const sections = text.split(/^(?=diff --git )/m);
  const files: DiffFile[] = [];

  for (const section of sections) {
    if (!section.startsWith('diff --git ')) continue;

    const headerMatch = /^diff --git a\/(.+?) b\/(.+?)$/m.exec(section);
    if (!headerMatch) continue;

    const hunks: string[] = [];
    const hunkParts = section.split(/^(?=@@)/m);
    for (let i = 1; i < hunkParts.length; i++) {
      hunks.push(hunkParts[i].trimEnd());
    }

    let additions = 0;
    let deletions = 0;
    const lines = section.split('\n');
    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++;
      if (line.startsWith('-') && !line.startsWith('---')) deletions++;
    }

    files.push({
      header: `diff --git a/${headerMatch[1]} b/${headerMatch[2]}`,
      fileA: headerMatch[1],
      fileB: headerMatch[2],
      hunks,
      additions,
      deletions,
    });
  }

  return files;
}

// ─── git log ──────────────────────────────────────────────────────────

function filterLog(text: string, budget: number): string {
  if (!text) return '';
  const cleaned = stripAnsi(text);

  if (cleaned.length <= budget) return cleaned;

  const commits = cleaned.split(/^(?=commit [a-f0-9]{7,})/m).filter(Boolean);
  const MAX_COMMITS = 25;
  const MAX_MESSAGE_LINES = 8;

  const parts: string[] = [];

  const shown = Math.min(commits.length, MAX_COMMITS);
  for (let i = 0; i < shown; i++) {
    const entry = commits[i];
    const entryLines = entry.split('\n');

    // Truncate long commit messages
    if (entryLines.length > MAX_MESSAGE_LINES + 4) {
      parts.push(entryLines.slice(0, MAX_MESSAGE_LINES + 4).join('\n'));
      parts.push(`    [... ${entryLines.length - MAX_MESSAGE_LINES - 4} more lines ...]`);
      parts.push('');
    } else {
      parts.push(entry.trimEnd());
    }
  }

  if (commits.length > MAX_COMMITS) {
    parts.push(`[... and ${commits.length - MAX_COMMITS} more commits ...]`);
  }

  return applyBudgetCap(parts.join('\n'), budget);
}

// ─── git status ─────────────────────────────────────────────────────

function filterStatus(text: string, budget: number): string {
  if (!text) return '';
  const cleaned = stripAnsi(text);

  if (cleaned.length <= budget) return cleaned;

  const lines = cleaned.split('\n');
  const MAX_UNTRACKED = 15;
  let inUntracked = false;
  let untrackedCount = 0;
  const kept: string[] = [];

  for (const line of lines) {
    if (/^Untracked files:/i.test(line)) {
      inUntracked = true;
      kept.push(line);
      continue;
    }

    if (inUntracked) {
      if (!line.startsWith('\t') && line.trim()) {
        inUntracked = false;
        kept.push(line);
        continue;
      }
      if (line.startsWith('\t')) {
        untrackedCount++;
        if (untrackedCount <= MAX_UNTRACKED) {
          kept.push(line);
        } else if (untrackedCount === MAX_UNTRACKED + 1) {
          kept.push(`\t... and more untracked files`);
        }
        continue;
      }
    }

    kept.push(line);
  }

  if (untrackedCount > MAX_UNTRACKED) {
    kept.push(`(${untrackedCount} untracked files total)`);
  }

  return applyBudgetCap(kept.join('\n'), budget);
}

// ─── git show ─────────────────────────────────────────────────────────

function filterShow(text: string, budget: number): string {
  if (!text) return '';
  const cleaned = stripAnsi(text);

  if (cleaned.length <= budget) return cleaned;

  const diffStart = cleaned.indexOf('\ndiff --git ');
  if (diffStart === -1) return applyBudgetCap(cleaned, budget);

  const metadata = cleaned.slice(0, diffStart + 1);
  const diffPart = cleaned.slice(diffStart + 1);

  const metaBudget = Math.min(metadata.length, Math.floor(budget * 0.2));
  const diffBudget = budget - metaBudget;

  const filteredMeta = applyBudgetCap(metadata, metaBudget);
  const filteredDiffPart = filterDiff(diffPart, diffBudget);

  return filteredMeta + '\n' + filteredDiffPart;
}

// ─── generic git (branch, blame, stash, merge) ─────────────────────

function filterGenericGit(text: string, budget: number): string {
  if (!text) return '';
  return applyBudgetCap(stripAnsi(text), budget);
}
