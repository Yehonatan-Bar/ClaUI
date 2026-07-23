import * as path from 'path';
import { spawn } from 'child_process';
import type { ChildProcess, SpawnOptions } from 'child_process';

/**
 * Spawn a CLI executable (Codex/Claude) whose path or arguments may contain
 * spaces or shell metacharacters.
 *
 * Windows footgun this exists to avoid:
 *   `spawn(command, args, { shell: true })` on Windows joins the command and every
 *   argument with single spaces WITHOUT quoting any of them, then hands the whole
 *   string to `cmd.exe`. Any argument that contains a space is then word-split by
 *   the shell. For `codex exec ... -C "<workspace>" -`, a workspace path with a
 *   space (e.g. `C:\Users\me\OneDrive\קבצים מצורפות\BrawlCast`) turns the single
 *   `-C <dir>` value into two tokens, which pushes the trailing `-` into a second
 *   positional slot and makes Codex fail with `error: unexpected argument '-' found`.
 *   The same corruption silently breaks `-c instructions="..."` whenever that text
 *   contains spaces.
 *
 * Strategy:
 *   - Concrete executable path (contains a path separator and is NOT a .cmd/.bat
 *     batch file): spawn WITHOUT a shell. Node then passes the argv straight to
 *     CreateProcess and quotes each element correctly, so spaces and metacharacters
 *     survive verbatim. This is the common case (the bundled `codex.exe`).
 *   - Bare command name (`codex`) or batch shim (`codex.cmd`): a shell is required
 *     for PATH/PATHEXT resolution, so keep `shell: true` but quote the command and
 *     every argument so `cmd.exe` cannot split them on spaces.
 *   - Non-Windows: spawn without a shell. POSIX `execvp` resolves bare names via
 *     PATH, and skipping the shell likewise avoids space word-splitting.
 */
export function spawnCli(command: string, args: string[], options: SpawnOptions): ChildProcess {
  if (process.platform !== 'win32') {
    return spawn(command, args, { ...options, shell: false });
  }

  const extension = path.extname(command).toLowerCase();
  const isBatchFile = extension === '.cmd' || extension === '.bat';
  const isConcretePath = /[\\/]/.test(command);

  if (isConcretePath && !isBatchFile) {
    // e.g. C:\Users\...\bin\windows-x86_64\codex.exe — run it directly, no shell.
    return spawn(command, args, { ...options, shell: false, windowsHide: true });
  }

  // Bare name or .cmd/.bat: keep the shell for resolution, but quote everything so
  // spaces in the command path or the arguments do not get word-split by cmd.exe.
  const quotedCommand = quoteWindowsShellArg(command);
  const quotedArgs = args.map(quoteWindowsShellArg);
  return spawn(quotedCommand, quotedArgs, { ...options, shell: true, windowsHide: true });
}

/**
 * Quote a single argument for `cmd.exe` so that spaces do not word-split it.
 * Wraps the value in double quotes when it contains whitespace, a quote, or a cmd
 * metacharacter, escaping any embedded double quotes. Values with no special
 * characters (e.g. `--json`, `-C`, `-`) are returned unchanged.
 */
function quoteWindowsShellArg(value: string): string {
  if (value === '') {
    return '""';
  }
  if (!/[\s"&|<>^()%!]/.test(value)) {
    return value;
  }
  const escaped = value.replace(/"/g, '\\"');
  return `"${escaped}"`;
}
