# Process Lifecycle & Cleanup

## Overview

ClaUi spawns child processes via `child_process.spawn()`. Most helper CLIs use `shell: true` on Windows, which creates a `cmd.exe` intermediary that prevents standard `SIGTERM` signals from reaching the actual `node.exe` child, so all process termination flows through a shared kill utility to handle this correctly. The Codex CLI spawns go through the `spawnCli` helper, which prefers a shell-free spawn for concrete executables so that arguments containing spaces (e.g. a workspace path under OneDrive) are not word-split by `cmd.exe`.

## Key Files

| File | Path | Purpose |
|------|------|---------|
| `killTree.ts` | `src/extension/process/killTree.ts` | Shared cross-platform process tree kill |
| `spawnCli.ts` | `src/extension/process/spawnCli.ts` | Space-safe CLI spawn (shell selection + Windows arg quoting) |
| `orphanCleanup.ts` | `src/extension/process/orphanCleanup.ts` | Startup cleanup of orphaned processes |

## killProcessTree(child)

Exported from `killTree.ts`. Used by all CLI spawn points in the extension. Every new process spawn MUST use `killProcessTree` for cleanup.

**Windows behavior**: Runs `taskkill /F /T /PID <pid>` which force-kills the process and all its descendants (the `/T` flag kills the entire tree).

**Unix behavior**: Sends `SIGTERM` to the child process.

### Consumers

| File | Context |
|------|---------|
| `ClaudeProcessManager.ts` | Main session process stop/cancel |
| `CodexExecProcessManager.ts` | Codex turn cancel/stop |
| `SessionNamer.ts` | Timeout kill of naming process |
| `CodexSessionNamer.ts` | Timeout kill of Codex naming process |
| `ActivitySummarizer.ts` | Timeout kill of summarizer process |
| `MessageTranslator.ts` | Timeout kill of translation process |
| `TurnAnalyzer.ts` | Timeout kill of analysis process |
| `PromptEnhancer.ts` | Timeout kill of enhancer process |
| `PromptTranslator.ts` | Timeout kill of translator process |
| `VisualProgressProcessor.ts` | Timeout kill of visual progress process |
| `SessionSummarizer.ts` | Timeout kill of summarizer process |
| `ClaudeCliCaller.ts` | Timeout kill of skill-gen CLI process |
| `AchievementInsightAnalyzer.ts` | Timeout kill of insight analysis process |
| `PythonPhaseRunner.ts` | Cancel/cleanup of Python subprocess |
| `executeShellCommand.ts` | Particle accelerator shell command cleanup |

## Orphan Cleanup

On extension activation, `cleanupOrphanedProcesses()` runs a PowerShell script that:

1. Finds all `node.exe` processes whose command line contains `stream-json` (ClaUi-specific marker)
2. Checks if each process's parent PID is still alive
3. Kills orphans (parent is dead)

This handles the case where VS Code crashes or the extension host dies without running `deactivate()`, leaving ClaUi-spawned CLI processes running indefinitely.

**Timeout**: 10 seconds. Runs asynchronously, does not block activation.

The script is passed to PowerShell via `-EncodedCommand` (base64 UTF-16LE) rather than inline `-Command "..."`. The script body contains its own double quotes (`"Name='node.exe'"`, `"killed:..."`) which would otherwise collide with cmd.exe's quote handling and break parsing.

## Normal Cleanup Flow

```
User closes tab / VS Code
  -> panel.onDidDispose() fires
    -> SessionTab.dispose() / CodexSessionTab.dispose()
      -> processManager.stop()
        -> killProcessTree(child)  // kills cmd.exe + node.exe tree
```

Extension deactivation:
```
VS Code closing
  -> deactivate()
    -> tabManager.closeAllTabs()
      -> each tab.dispose()
        -> processManager.stop()
```

## The Windows shell:true Problem

When spawning with `shell: true` on Windows:
```
VS Code extension host
  -> cmd.exe (shell wrapper)
    -> node.exe (actual claude CLI)
```

`child.kill('SIGTERM')` only kills `cmd.exe`, leaving `node.exe` as an orphan. `taskkill /F /T /PID` kills the entire tree including descendants.

## spawnCli: space-safe argument passing (Codex)

`spawnCli(command, args, options)` in `src/extension/process/spawnCli.ts` is used by `CodexExecProcessManager` and `CodexSessionNamer` to spawn `codex exec`.

The problem it solves: with `shell: true` on Windows, Node joins the command and every argument with single spaces **without quoting**, then passes the string to `cmd.exe`. Any argument containing a space is word-split by the shell. For `codex exec ... -C "<workspace>" -`, a workspace path with a space (for example `C:\Users\me\OneDrive\קבצים מצורפות\BrawlCast`) splits the single `-C <dir>` value into two tokens, which pushes the trailing `-` into a second positional slot and makes Codex exit with `error: unexpected argument '-' found`. The same corruption silently breaks `-c instructions="..."` whenever that text contains spaces.

Selection logic:

| `command` shape | Spawn mode | Reason |
|-----------------|-----------|--------|
| Concrete path, not `.cmd`/`.bat` (e.g. bundled `codex.exe`) | `shell: false` | Node passes argv straight to CreateProcess and quotes each element; spaces/metacharacters survive verbatim |
| Bare name (`codex`) or batch shim (`codex.cmd`) | `shell: true`, command + args quoted | A shell is required for PATH/PATHEXT resolution; quoting each argument prevents `cmd.exe` word-splitting |
| Non-Windows | `shell: false` | POSIX `execvp` resolves bare names via PATH; skipping the shell avoids space word-splitting |

`taskkill /F /T /PID` still cleans up both spawn modes: with `shell: false` it kills the `codex.exe` tree directly; with `shell: true` it kills the `cmd.exe` wrapper and its descendants.

## Webview Focus Diagnostics and Guardrails (2026-03)

To diagnose and stabilize intermittent "double-click required" behavior, focus handling now has explicit guardrails on both extension and webview sides:

- Extension (`SessionTab` / `CodexSessionTab`)
  - Logs `ViewState changed: active=... visible=...`
  - On active view-state: `Posting focusInput (view-state active)`
  - On window focus: `Scheduling focusInput (window focus delay=180ms)`
  - Throttle log: `Suppressing focusInput (...) due to throttle (...)`
  - Important change: **no `panel.reveal()` is executed from window-focus events**
- Webview (`InputArea`)
  - Receives `focusInput` and emits `[UiDebug][InputArea]` events:
    - `focusInputApplied`
    - `focusInputSuppressed` with reasons:
      - `recentPointer` (pointer/click happened in the last 280ms)
      - `interactiveActiveElement` (focus currently on button/tab/link/input/etc.)

This combination preserves auto-focus usability for typing while reducing cases where programmatic focus steals the user's first click.
