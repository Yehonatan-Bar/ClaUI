import type { ChildProcess, SpawnOptions } from 'child_process';
import crossSpawn = require('cross-spawn');

/**
 * Spawn a CLI executable (Codex/Claude) without losing argv boundaries.
 *
 * On Windows, npm-installed CLIs are commonly `.cmd` shims. Passing them through
 * Node's `shell: true` loses argument boundaries for values containing spaces,
 * while manually wrapping every argument in quotes corrupts nested TOML quotes
 * such as `instructions="Read the \"Changed files\" list"`. In the latter case,
 * Codex sees an unintended positional prompt and rejects the final stdin marker
 * (`-`) with exit code 2.
 *
 * `cross-spawn` handles executable/PATHEXT resolution and applies the complete
 * Windows escaping algorithm for batch shims, including backslashes before
 * quotes and cmd metacharacters. Callers still receive the real child process,
 * so the existing process-tree cancellation logic remains unchanged.
 */
export function spawnCli(command: string, args: string[], options: SpawnOptions): ChildProcess {
  return crossSpawn(command, args, {
    ...options,
    // Never allow a caller to reintroduce shell string parsing. cross-spawn
    // invokes cmd.exe itself only when a Windows shim actually requires it.
    shell: false,
    windowsHide: process.platform === 'win32' ? true : options.windowsHide,
  });
}
