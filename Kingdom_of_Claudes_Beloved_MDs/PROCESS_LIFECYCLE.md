# Process Lifecycle & Cleanup

## Overview

ClaUi spawns child processes via `child_process.spawn()` with `shell: true` on Windows. This creates a `cmd.exe` intermediary that prevents standard `SIGTERM` signals from reaching the actual `node.exe` child. All process termination flows through a shared utility to handle this correctly.

## Key Files

| File | Path | Purpose |
|------|------|---------|
| `killTree.ts` | `src/extension/process/killTree.ts` | Shared cross-platform process tree kill |
| `orphanCleanup.ts` | `src/extension/process/orphanCleanup.ts` | Startup cleanup of orphaned processes |

## killProcessTree(child)

Exported from `killTree.ts`. Used by all 12 CLI spawn points in the extension.

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
| `ClaudeCliCaller.ts` | Timeout kill of skill-gen CLI process |
| `AchievementInsightAnalyzer.ts` | Timeout kill of insight analysis process |
| `PythonPhaseRunner.ts` | Cancel/cleanup of Python subprocess |

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
