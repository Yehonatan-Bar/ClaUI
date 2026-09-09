import { ChildProcess, spawn, spawnSync, SpawnOptions } from 'child_process';
import crossSpawn = require('cross-spawn');
import * as fs from 'fs';
import * as path from 'path';

/**
 * Process/spawn helpers shared by the bridge backends.
 *
 * The central rule here is: NEVER pass untrusted text (a user prompt) to a
 * child process spawned with `shell: true`. On Windows a prompt containing `&`,
 * `|`, `^`, `>` etc. would be reinterpreted by cmd.exe as extra commands
 * (command injection — see the Node docs warning for child_process.spawn). To
 * avoid that we always resolve the target CLI to a concrete executable and
 * spawn with `shell: false`, so argv elements reach the process verbatim.
 */

/** Resolve a bare command to an absolute path via the OS resolver
 *  (`where` on Windows, `which` elsewhere). Returns the first hit, or null. */
export function whichSync(command: string): string | null {
  try {
    const probe = process.platform === 'win32' ? 'where' : 'which';
    const res = spawnSync(probe, [command], {
      timeout: 3000,
      windowsHide: true,
      encoding: 'utf8',
    });
    if (res.status !== 0 || !res.stdout) return null;
    const first = res.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)[0];
    return first || null;
  } catch {
    return null;
  }
}

/**
 * Resolve a configured CLI to a concrete, shell-free invocation.
 * Priority: an absolute path that exists → a known install location → OS PATH
 * resolution. ALWAYS returns `useShell: false` so a user prompt passed as an
 * argv element can never be reinterpreted by a shell.
 *
 * On Windows, if PATH resolution lands on a `.cmd`/`.bat` shim (which cannot be
 * spawned without a shell on modern Node), we prefer a sibling `.exe` when one
 * exists; otherwise we return the resolved path and let spawn surface a clear
 * error rather than falling back to an injectable shell.
 */
export function resolveExecutable(
  configured: string,
  fallback: string,
  knownLocations: string[] = [],
): { command: string; useShell: false } {
  const c = (configured || fallback).trim() || fallback;
  if (path.isAbsolute(c)) {
    return { command: c, useShell: false };
  }
  for (const loc of knownLocations) {
    if (loc && fs.existsSync(loc)) {
      return { command: loc, useShell: false };
    }
  }
  const resolved = whichSync(c);
  if (resolved) {
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)) {
      const exe = resolved.replace(/\.(cmd|bat)$/i, '.exe');
      if (fs.existsSync(exe)) {
        return { command: exe, useShell: false };
      }
    }
    return { command: resolved, useShell: false };
  }
  return { command: c, useShell: false };
}

/**
 * Spawn a CLI executable WITHOUT losing argv boundaries and WITHOUT a shell.
 *
 * On Windows, npm-installed CLIs are commonly `.cmd`/`.bat` shims that modern
 * Node cannot spawn without a shell; `cross-spawn` resolves the shim and applies
 * the correct Windows escaping so argv elements (including a user prompt) reach
 * the process verbatim — never reinterpreted by cmd.exe. This is the same
 * approach the extension uses, kept self-contained here so the runtime bundle
 * does not import any extension code.
 */
export function spawnCli(
  command: string,
  args: string[],
  options: SpawnOptions = {},
): ChildProcess {
  return crossSpawn(command, args, {
    ...options,
    // Never allow a caller to reintroduce shell string parsing. cross-spawn
    // invokes cmd.exe itself only when a Windows shim actually requires it.
    shell: false,
    windowsHide: process.platform === 'win32' ? true : options.windowsHide,
  });
}

/**
 * Kill a child and its descendants. `child.kill()` on Windows with a shell
 * wrapper only kills the wrapper, leaving the real CLI (and its own children)
 * running — mirror ClaudeProcessManager and use `taskkill /F /T`.
 */
export function killTree(child: ChildProcess | null | undefined): void {
  if (!child) return;
  const pid = child.pid;
  if (process.platform === 'win32' && typeof pid === 'number') {
    try {
      spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
        timeout: 5000,
        windowsHide: true,
      });
      return;
    } catch {
      /* fall through to best-effort kill */
    }
  }
  try {
    child.kill();
  } catch {
    /* already dead */
  }
}

/**
 * Non-blocking process-tree kill. Unlike `killTree` (which uses a *blocking*
 * spawnSync + 5s timeout), this fires `taskkill /F /T` and returns immediately,
 * so a caller killing many children at once (e.g. a council interrupt under
 * Promise.all) is not stalled ~5s per child. Windows-first: elsewhere it falls
 * back to a plain SIGTERM (no process-group kill) — a documented v1 limitation.
 */
export function killTreeAsync(child: ChildProcess | null | undefined): void {
  if (!child) return;
  const pid = child.pid;
  if (process.platform === 'win32' && typeof pid === 'number') {
    try {
      const killer = spawn('taskkill', ['/F', '/T', '/PID', String(pid)], {
        windowsHide: true,
        detached: true,
        stdio: 'ignore',
      });
      killer.on('error', () => {
        /* best-effort; nothing to await */
      });
      killer.unref();
      return;
    } catch {
      /* fall through to best-effort kill */
    }
  }
  try {
    child.kill('SIGTERM');
  } catch {
    /* already dead */
  }
}
