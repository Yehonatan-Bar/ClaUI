import { ChildProcess, spawnSync } from 'child_process';
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
