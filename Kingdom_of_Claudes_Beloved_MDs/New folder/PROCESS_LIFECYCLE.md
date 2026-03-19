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

---

# Merged from FILE_LOGGER.md

# FileLogger - File-Based Logging

## Purpose

Writes all OutputChannel log lines to disk files so they persist across VS Code sessions, reloads, and restarts. Each session tab gets its own log file, and a global log file captures extension-level messages from all tabs.

## Key Files

| File | Path |
|------|------|
| FileLogger class | `src/extension/session/FileLogger.ts` |
| Global logger creation | `src/extension/extension.ts` |
| Per-tab logger creation | `src/extension/session/SessionTab.ts` |
| LogDir pass-through | `src/extension/session/TabManager.ts` |
| Open Log Directory command | `src/extension/commands.ts` |

## Architecture

```
extension.ts
  |
  +-- globalFileLogger (FileLogger)       <-- extension-level logs
  |     writes: extension_18-14-30.log
  |
  +-- TabManager (receives logDir)
        |
        +-- SessionTab 1
        |     +-- fileLogger (FileLogger)  <-- tab-specific logs
        |     |     writes: Fix_login_bug_18-14-30.log
        |     +-- tabLog() dual-writes to OutputChannel + fileLogger
        |
        +-- SessionTab 2
              +-- fileLogger (FileLogger)
              |     writes: session-2_18-14-32.log
              +-- tabLog() dual-writes to OutputChannel + fileLogger
```

## File Naming

Format: `<session-name>_<dd-hh-mm>.log`

- `dd` = day of month (zero-padded)
- `hh` = hour (24h, zero-padded)
- `mm` = minute (zero-padded)
- Session name is sanitized: `<>:"/\|?*` replaced with `_`, spaces replaced with `_`, max 80 chars
- Hebrew characters pass through (NTFS supports them)

Examples:
- `extension_18-14-30.log` (global logger)
- `session-1_18-14-30.log` (tab 1, before auto-naming)
- `Fix_login_bug_18-14-30.log` (tab 1, after auto-naming renames the file)

## New File Triggers

A new log file is created when:

1. **Developer: Reload Window** - `deactivate()` disposes all loggers; `activate()` creates fresh instances with new timestamps
2. **File exceeds 2MB** - `write()` tracks file size in-memory, calls `rotate()` when exceeded (new timestamp in new file name)
3. **New session tab** - each `SessionTab` constructor creates its own `FileLogger`

## Session Name Updates

When the session name changes (auto-naming or manual rename):

1. `FileLogger.updateSessionName(newName)` is called
2. The current write stream is closed
3. The file is renamed on disk (e.g., `session-1_18-14-30.log` -> `Fix_login_bug_18-14-30.log`)
4. A new write stream is opened at the renamed path

If the rename fails (file locked, etc.), a new file is created at the new path.

## Log Directory

Default: `<globalStorageUri>/logs/` (typically `%APPDATA%/Code/User/globalStorage/claude-code-mirror.claude-code-mirror/logs/`)

Override: `claudeMirror.logDirectory` setting

Access: `ClaUi: Open Log Directory` command opens the folder in the system file explorer.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `claudeMirror.enableFileLogging` | `true` | Enable/disable writing logs to disk |
| `claudeMirror.logDirectory` | `""` | Custom log directory (empty = default) |

## Dual-Write Behavior

Messages appear in:
- **OutputChannel** (VS Code "ClaUi" output) - always, unchanged
- **Global log file** - all messages from all tabs + extension lifecycle
- **Per-tab log file** - only that tab's messages (via `tabLog` closure)

## Implementation Details

- Uses `fs.createWriteStream` with `flags: 'a'` (append mode) for efficient buffered writes
- File size tracked in-memory via byte counter (no `fs.stat` per write)
- All filesystem operations wrapped in try/catch to prevent logging failures from crashing the extension
- `dispose()` called in both `SessionTab.dispose()` and `panel.onDidDispose()` to handle both programmatic and user-initiated tab closure
