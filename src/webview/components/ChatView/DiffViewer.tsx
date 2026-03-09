import React, { useMemo, useState } from 'react';

export interface DiffViewerProps {
  filePath: string;
  oldContent: string;
  newContent: string;
}

type DiffLineType = 'add' | 'remove' | 'context';

interface DiffLine {
  type: DiffLineType;
  oldLineNum: number | null;
  newLineNum: number | null;
  content: string;
}

interface DiffHunk {
  lines: DiffLine[];
  foldedAfter: number; // number of context lines folded after this hunk
}

const CONTEXT_LINES = 3;
const MAX_FOLD_LABEL = 99;

/**
 * Compute a line-level LCS-based diff between two arrays of strings.
 * Returns a flat list of DiffLine entries.
 */
function computeDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS length table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Traceback to build diff
  const result: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({ type: 'context', oldLineNum: i, newLineNum: j, content: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: 'add', oldLineNum: null, newLineNum: j, content: newLines[j - 1] });
      j--;
    } else {
      result.push({ type: 'remove', oldLineNum: i, newLineNum: null, content: oldLines[i - 1] });
      i--;
    }
  }

  return result.reverse();
}

/**
 * Collapse long runs of context lines into hunks, keeping CONTEXT_LINES
 * around each changed line.
 */
function buildHunks(lines: DiffLine[]): { hunks: DiffHunk[]; addCount: number; removeCount: number } {
  let addCount = 0;
  let removeCount = 0;
  for (const l of lines) {
    if (l.type === 'add') addCount++;
    if (l.type === 'remove') removeCount++;
  }

  if (addCount === 0 && removeCount === 0) {
    // No changes — show nothing
    return { hunks: [], addCount: 0, removeCount: 0 };
  }

  // Determine which line indices should be shown (not folded)
  const shown = new Set<number>();
  for (let idx = 0; idx < lines.length; idx++) {
    if (lines[idx].type !== 'context') {
      for (let k = Math.max(0, idx - CONTEXT_LINES); k <= Math.min(lines.length - 1, idx + CONTEXT_LINES); k++) {
        shown.add(k);
      }
    }
  }

  // Group into hunks separated by folds
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffLine[] | null = null;
  let foldCount = 0;

  for (let idx = 0; idx < lines.length; idx++) {
    if (shown.has(idx)) {
      if (currentHunk === null) {
        if (foldCount > 0) {
          // Fold before first hunk
          hunks.push({ lines: [], foldedAfter: foldCount });
          foldCount = 0;
        }
        currentHunk = [];
      }
      currentHunk.push(lines[idx]);
    } else {
      // This context line is folded
      if (currentHunk !== null && currentHunk.length > 0) {
        hunks.push({ lines: currentHunk, foldedAfter: 0 });
        currentHunk = null;
      }
      foldCount++;
    }
  }

  if (currentHunk !== null && currentHunk.length > 0) {
    hunks.push({ lines: currentHunk, foldedAfter: foldCount });
  } else if (foldCount > 0 && hunks.length > 0) {
    hunks[hunks.length - 1].foldedAfter += foldCount;
  }

  return { hunks, addCount, removeCount };
}

export function DiffViewer({ filePath, oldContent, newContent }: DiffViewerProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);

  const { hunks, addCount, removeCount } = useMemo(() => {
    const oldLines = oldContent === '' ? [] : oldContent.split('\n');
    const newLines = newContent === '' ? [] : newContent.split('\n');

    // Remove trailing empty line that split() produces from trailing newline
    if (oldLines.length > 0 && oldLines[oldLines.length - 1] === '') oldLines.pop();
    if (newLines.length > 0 && newLines[newLines.length - 1] === '') newLines.pop();

    const diffLines = computeDiff(oldLines, newLines);
    return buildHunks(diffLines);
  }, [oldContent, newContent]);

  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
  const isNewFile = oldContent === '';

  const summaryParts: string[] = [];
  if (isNewFile) {
    summaryParts.push(`New file (+${addCount} lines)`);
  } else {
    if (addCount > 0) summaryParts.push(`+${addCount}`);
    if (removeCount > 0) summaryParts.push(`-${removeCount}`);
  }
  const summaryText = summaryParts.join(', ');

  if (hunks.length === 0 && !isNewFile) {
    return (
      <div className="diff-viewer diff-viewer--no-changes">
        <div className="diff-header">
          <span className="diff-file-name">{fileName}</span>
          <span className="diff-summary diff-summary--unchanged">no changes</span>
        </div>
      </div>
    );
  }

  return (
    <div className="diff-viewer">
      <div className="diff-header" onClick={() => setCollapsed(c => !c)}>
        <span className="diff-collapse-icon">{collapsed ? '▶' : '▼'}</span>
        <span className="diff-file-name">{fileName}</span>
        {summaryText && (
          <span className={`diff-summary ${isNewFile ? 'diff-summary--new' : ''}`}>
            {summaryText}
          </span>
        )}
      </div>

      {!collapsed && (
        <div className="diff-body">
          {hunks.map((hunk, hunkIdx) => (
            <React.Fragment key={hunkIdx}>
              {hunk.lines.length === 0 && hunk.foldedAfter > 0 && (
                <div className="diff-fold">
                  <span className="diff-fold-label">
                    ... {Math.min(hunk.foldedAfter, MAX_FOLD_LABEL)} lines
                  </span>
                </div>
              )}
              {hunk.lines.map((line, lineIdx) => (
                <div
                  key={lineIdx}
                  className={`diff-line diff-line--${line.type}`}
                >
                  <span className="diff-ln diff-ln--old">
                    {line.oldLineNum ?? ''}
                  </span>
                  <span className="diff-ln diff-ln--new">
                    {line.newLineNum ?? ''}
                  </span>
                  <span className="diff-sign">
                    {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                  </span>
                  <span className="diff-content">{line.content}</span>
                </div>
              ))}
              {hunk.foldedAfter > 0 && hunk.lines.length > 0 && (
                <div className="diff-fold">
                  <span className="diff-fold-label">
                    ... {Math.min(hunk.foldedAfter, MAX_FOLD_LABEL)} lines
                  </span>
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
