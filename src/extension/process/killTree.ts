import { exec } from 'child_process';
import type { ChildProcess } from 'child_process';

/**
 * Kill a child process and its entire process tree.
 *
 * On Windows with `shell: true`, `child.kill('SIGTERM')` only kills the
 * cmd.exe wrapper — the actual node.exe child process becomes an orphan.
 * This helper uses `taskkill /F /T /PID` on Windows to kill the full tree.
 */
export function killProcessTree(child: ChildProcess): void {
  if (!child.pid) {
    try { child.kill('SIGTERM'); } catch { /* already dead */ }
    return;
  }
  if (process.platform === 'win32') {
    exec(`taskkill /F /T /PID ${child.pid}`, () => {
      // ignore failures — process may already be dead
    });
  } else {
    try { child.kill('SIGTERM'); } catch { /* already dead */ }
  }
}
