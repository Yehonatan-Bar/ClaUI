import { execFile } from 'child_process';

/**
 * Original paths for files dropped from Windows File Explorer / the Desktop.
 *
 * The webview only sees the contents of OS-dropped files, never their path.
 * The files a user drags out of Explorer are always the selected items of the
 * source window, so the extension asks Explorer (Shell.Application COM) for
 * the selected items of every open window/tab and of the Desktop, and the
 * caller matches the dropped files against that short list (name + size +
 * mtime, see matchDroppedItemsToSelection in droppedFiles.ts). No filesystem
 * search is involved.
 *
 * The query is started when the drag enters the chat panel (prefetch), so its
 * ~0.5 s PowerShell start-up is hidden behind the drag. Windows only.
 */

/**
 * Prints a JSON array of selected file-system paths. Non-ASCII characters are
 * escaped as \uXXXX so the console code page cannot corrupt Hebrew paths.
 */
const EXPLORER_SELECTION_QUERY = String.raw`
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject Shell.Application
$rows = New-Object System.Collections.Generic.List[string]
function Add-Selection($folderView) {
  foreach ($item in @($folderView.SelectedItems())) {
    if ($item -and $item.IsFileSystem -and $item.Path) { $rows.Add([string]$item.Path) }
  }
}
foreach ($window in @($shell.Windows())) {
  try { $view = $window.Document; if ($view -and $view.Folder) { Add-Selection $view } } catch {}
}
try {
  $desktopHwnd = 0
  $desktop = $shell.Windows().FindWindowSW(0, $null, 8, [ref]$desktopHwnd, 1)
  if ($desktop) { Add-Selection $desktop.Document }
} catch {}
$json = ConvertTo-Json -InputObject @($rows.ToArray()) -Compress
[regex]::Replace($json, '[^\x00-\x7F]', { param($m) '\u{0:x4}' -f [int][char]$m.Value })
`;

const SELECTION_QUERY_TIMEOUT_MS = 5000;
/** dragenter fires again each time the pointer re-enters the panel; reuse the running query */
const PREFETCH_REUSE_MS = 1500;
/** A prefetched snapshot older than this is not trusted for a drop */
const SNAPSHOT_MAX_AGE_MS = 60_000;

interface SelectionSnapshot {
  startedAt: number;
  paths: Promise<string[]>;
}

let latestSnapshot: SelectionSnapshot | null = null;

export function isExplorerSelectionSupported(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32';
}

/** Parse the query output; tolerates empty output and PowerShell's single-value (non-array) JSON. */
export function parseExplorerSelectionOutput(stdout: string): string[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const values = Array.isArray(parsed) ? parsed : [parsed];
    return values.filter((value): value is string => typeof value === 'string' && value.length > 0);
  } catch {
    return [];
  }
}

function queryExplorerSelection(log: (line: string) => void): Promise<string[]> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', EXPLORER_SELECTION_QUERY],
      { timeout: SELECTION_QUERY_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          log(`File drop: Explorer selection query failed after ${Date.now() - startedAt} ms: ${err.message} ${String(stderr).slice(0, 200)}`);
          resolve([]);
          return;
        }
        const paths = parseExplorerSelectionOutput(String(stdout));
        log(`File drop: Explorer selection query returned ${paths.length} item(s) in ${Date.now() - startedAt} ms`);
        resolve(paths);
      },
    );
  });
}

/** Start a selection snapshot while the user is still dragging (called on the webview's dragenter). */
export function prefetchExplorerSelection(log: (line: string) => void): void {
  if (!isExplorerSelectionSupported()) return;
  if (latestSnapshot && Date.now() - latestSnapshot.startedAt < PREFETCH_REUSE_MS) return;
  latestSnapshot = { startedAt: Date.now(), paths: queryExplorerSelection(log) };
}

/**
 * Selection for a drop: the prefetched snapshot when there is a recent one
 * (`prefetched: true`), otherwise a fresh query. Each snapshot serves one drop.
 */
export function takeExplorerSelectionForDrop(log: (line: string) => void): { paths: Promise<string[]>; prefetched: boolean } {
  if (!isExplorerSelectionSupported()) {
    return { paths: Promise.resolve([]), prefetched: false };
  }
  const snapshot = latestSnapshot;
  latestSnapshot = null;
  if (snapshot && Date.now() - snapshot.startedAt <= SNAPSHOT_MAX_AGE_MS) {
    return { paths: snapshot.paths, prefetched: true };
  }
  return { paths: queryExplorerSelection(log), prefetched: false };
}

/** Fresh query, used when a snapshot taken during the drag did not contain the dropped files. */
export function queryExplorerSelectionNow(log: (line: string) => void): Promise<string[]> {
  return isExplorerSelectionSupported() ? queryExplorerSelection(log) : Promise.resolve([]);
}
