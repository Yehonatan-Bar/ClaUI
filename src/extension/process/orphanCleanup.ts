import { exec } from 'child_process';

/**
 * On Windows, find and kill orphaned node.exe processes that were spawned by
 * previous ClaUi sessions but never cleaned up (e.g. VS Code crashed, extension
 * host died, or the deactivate hook didn't run).
 *
 * Detection: looks for node.exe processes whose command line contains the
 * ClaUi-specific `--output-format stream-json` flag (main sessions) or
 * `--input-format stream-json` flag. These are only used by ClaUi, not by
 * terminal-based Claude Code sessions.
 *
 * Safety: only kills processes whose parent PID no longer exists (true orphans).
 */
export function cleanupOrphanedProcesses(log: (msg: string) => void): void {
  if (process.platform !== 'win32') {
    return;
  }

  // PowerShell script that:
  // 1. Finds node.exe processes with ClaUi-specific CLI flags
  // 2. Checks if their parent process is still alive
  // 3. Kills orphans (parent is dead)
  const script = `
$marker = 'stream-json'
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match $marker }
$killed = 0
foreach ($p in $procs) {
  $parent = Get-Process -Id $p.ParentProcessId -ErrorAction SilentlyContinue
  if (-not $parent) {
    try {
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
      $killed++
    } catch {}
  }
}
Write-Output "killed:$killed total:$(($procs | Measure-Object).Count)"
`.trim().replace(/\n/g, '; ');

  exec(
    `powershell -NoProfile -NonInteractive -Command "${script}"`,
    { timeout: 10_000 },
    (err, stdout) => {
      if (err) {
        log(`[OrphanCleanup] Failed: ${err.message}`);
        return;
      }
      const output = stdout.trim();
      log(`[OrphanCleanup] ${output}`);
    }
  );
}
