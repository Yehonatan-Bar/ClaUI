import { execFile } from 'child_process';
import * as os from 'os';

/** Active CLI processes provided by the caller (typically TabManager). */
export interface CliRoot {
  tabId: string;
  tabName: string;
  provider: 'claude' | 'codex';
  rootPid: number;
}

export type CliRootProvider = () => CliRoot[];

/** Categorization of a VS Code process, using command-line arguments when available. */
export type VsCodeProcessCategory =
  | 'main'
  | 'renderer'
  | 'extensionHost'
  | 'gpu'
  | 'utility'
  | 'crashpad'
  | 'pty'
  | 'other';

export interface VsCodeProcessSample {
  pid: number;
  parentPid: number;
  name: string;
  rssBytes: number;
  category: VsCodeProcessCategory;
}

export interface CliProcessSample {
  tabId: string;
  tabName: string;
  provider: 'claude' | 'codex';
  rootPid: number;
  /** Sum of working set across the root process and all descendants. */
  treeRssBytes: number;
  /** Number of processes in the tree (including the root). */
  processCount: number;
}

export interface MemorySnapshot {
  timestamp: number;
  /** Total physical memory on the machine, in bytes. */
  systemTotalBytes: number;
  /** Free physical memory, in bytes. */
  systemFreeBytes: number;
  /** Extension Host process (the Node.js process running this extension). */
  extensionHost: {
    pid: number;
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
  };
  /** All Code.exe processes, grouped for dashboard context. */
  vscodeProcesses: VsCodeProcessSample[];
  /** Aggregated per-tab CLI process trees. */
  cliProcesses: CliProcessSample[];
}

interface RawProcessRow {
  ProcessId: number;
  ParentProcessId: number;
  Name: string;
  WorkingSetSize: number;
  CommandLine: string | null;
}

const POWERSHELL_PROCESS_QUERY = String.raw`
$counter = Get-Counter '\Process(*)\ID Process','\Process(*)\Creating Process ID','\Process(*)\Working Set'
$rows = @{}
foreach ($sample in $counter.CounterSamples) {
  if ($sample.Path -notmatch '\\process\((?<instance>.+)\)\\(?<counter>[^\\]+)$') { continue }
  $instance = $Matches['instance']
  if ($instance -eq '_total' -or $instance -eq 'idle') { continue }
  if (-not $rows.ContainsKey($instance)) {
    $baseName = $instance -replace '#\d+$',''
    $rows[$instance] = [ordered]@{
      ProcessId = 0
      ParentProcessId = 0
      Name = "$baseName.exe"
      WorkingSetSize = 0
      CommandLine = $null
    }
  }
  switch ($Matches['counter'].ToLowerInvariant()) {
    'id process' { $rows[$instance]['ProcessId'] = [int]$sample.CookedValue; break }
    'creating process id' { $rows[$instance]['ParentProcessId'] = [int]$sample.CookedValue; break }
    'working set' { $rows[$instance]['WorkingSetSize'] = [Int64]$sample.CookedValue; break }
  }
}
$rows.Values | Where-Object { $_['ProcessId'] -gt 0 } | ConvertTo-Json -Compress -Depth 2
`.trim();

const PS_TIMEOUT_MS = 8000;
const PS_MAX_BUFFER_BYTES = 16 * 1024 * 1024; // 16 MB safety cap

/**
 * Collects memory consumption data for VS Code and ClaUi-spawned CLI processes.
 *
 * Sampling strategy (Windows):
 *  - Extension Host memory comes from process.memoryUsage() (free, instant).
 *  - Process info comes from a single PowerShell Get-Counter call.
 *  - Per-tab CLI memory is computed by walking parent->child relationships from
 *    each known root PID and summing WorkingSetSize across descendants.
 *
 * The sampler is stateless across calls, so callers can drive their own
 * intervals and stop them cleanly when no consumer (dashboard tab) is open.
 */
export class ProcessMemorySampler {
  private rootProvider: CliRootProvider = () => [];
  private log: (msg: string) => void = () => {};

  setRootProvider(fn: CliRootProvider): void {
    this.rootProvider = fn;
  }

  setLogger(fn: (msg: string) => void): void {
    this.log = fn;
  }

  async sample(): Promise<MemorySnapshot> {
    const memUsage = process.memoryUsage();
    const timestamp = Date.now();

    // Run system mem read and process query in parallel.
    const [rows] = await Promise.all([this.queryProcesses()]);

    const byPid = new Map<number, RawProcessRow>();
    for (const row of rows) {
      if (typeof row.ProcessId === 'number') {
        byPid.set(row.ProcessId, row);
      }
    }

    // Build a parent -> children index for tree walking.
    const children = new Map<number, number[]>();
    for (const row of rows) {
      const parent = row.ParentProcessId;
      if (typeof parent !== 'number') continue;
      const list = children.get(parent);
      if (list) {
        list.push(row.ProcessId);
      } else {
        children.set(parent, [row.ProcessId]);
      }
    }

    const codePids = new Set<number>();
    for (const row of rows) {
      if (String(row.Name).toLowerCase() === 'code.exe') {
        codePids.add(row.ProcessId);
      }
    }

    const vscodeProcesses: VsCodeProcessSample[] = [];
    for (const row of rows) {
      if (String(row.Name).toLowerCase() !== 'code.exe') continue;
      vscodeProcesses.push({
        pid: row.ProcessId,
        parentPid: row.ParentProcessId,
        name: row.Name,
        rssBytes: row.WorkingSetSize ?? 0,
        category: classifyVsCodeProcess(row, process.pid, codePids.has(row.ParentProcessId)),
      });
    }

    const roots = this.rootProvider();
    const cliProcesses: CliProcessSample[] = roots.map((root) => {
      const tree = collectTreeRss(root.rootPid, byPid, children);
      return {
        tabId: root.tabId,
        tabName: root.tabName,
        provider: root.provider,
        rootPid: root.rootPid,
        treeRssBytes: tree.totalRss,
        processCount: tree.count,
      };
    });

    return {
      timestamp,
      systemTotalBytes: os.totalmem(),
      systemFreeBytes: os.freemem(),
      extensionHost: {
        pid: process.pid,
        rssBytes: memUsage.rss,
        heapUsedBytes: memUsage.heapUsed,
        heapTotalBytes: memUsage.heapTotal,
        externalBytes: memUsage.external,
      },
      vscodeProcesses,
      cliProcesses,
    };
  }

  private queryProcesses(): Promise<RawProcessRow[]> {
    return new Promise((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', POWERSHELL_PROCESS_QUERY],
        { timeout: PS_TIMEOUT_MS, maxBuffer: PS_MAX_BUFFER_BYTES, windowsHide: true },
        (err, stdout, stderr) => {
          if (err) {
            this.log(`[MemorySampler] powershell failed: ${err.message} stderr=${stderr.slice(0, 200)}`);
            resolve([]);
            return;
          }
          resolve(parsePowerShellRows(stdout));
        },
      );
    });
  }
}

/** Parse the JSON output of ConvertTo-Json -Compress, which can be:
 *  - "" / "null"  (no rows)
 *  - a single object (one row)
 *  - an array of objects
 */
function parsePowerShellRows(stdout: string): RawProcessRow[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed as RawProcessRow[];
    }
    if (parsed && typeof parsed === 'object') {
      return [parsed as RawProcessRow];
    }
    return [];
  } catch {
    return [];
  }
}

/** Walk descendants of `rootPid` using the parent->children map.
 *  Cycles cannot occur in a real process table, but we guard against them
 *  with a visited set anyway so a stale snapshot can't loop forever. */
function collectTreeRss(
  rootPid: number,
  byPid: Map<number, RawProcessRow>,
  children: Map<number, number[]>,
): { totalRss: number; count: number } {
  const visited = new Set<number>();
  const stack = [rootPid];
  let totalRss = 0;
  let count = 0;
  while (stack.length > 0) {
    const pid = stack.pop()!;
    if (visited.has(pid)) continue;
    visited.add(pid);
    const row = byPid.get(pid);
    if (row) {
      totalRss += row.WorkingSetSize ?? 0;
      count += 1;
    }
    const kids = children.get(pid);
    if (kids) {
      for (const k of kids) {
        if (!visited.has(k)) stack.push(k);
      }
    }
  }
  return { totalRss, count };
}

/** Categorize a Code.exe process.
 *  The extension-host process is identified by PID match (process.pid in this
 *  code is the extension host itself). If command-line data is unavailable,
 *  fall back to parent relationship: root Code process is main; children are
 *  contextual VS Code processes. */
function classifyVsCodeProcess(
  row: RawProcessRow,
  extensionHostPid: number,
  parentIsCodeProcess: boolean,
): VsCodeProcessCategory {
  if (row.ProcessId === extensionHostPid) return 'extensionHost';
  const cmd = row.CommandLine ?? '';
  const typeMatch = cmd.match(/--type=([\w-]+)/);
  if (!typeMatch) return parentIsCodeProcess ? 'other' : 'main';
  const t = typeMatch[1];
  if (t === 'renderer') return 'renderer';
  if (t === 'gpu-process') return 'gpu';
  if (t === 'crashpad-handler') return 'crashpad';
  if (t === 'utility') {
    if (/--utility-sub-type=node\.mojom\.NodeService/i.test(cmd)) return 'extensionHost';
    if (/ptyHost/i.test(cmd)) return 'pty';
    return 'utility';
  }
  return 'other';
}
