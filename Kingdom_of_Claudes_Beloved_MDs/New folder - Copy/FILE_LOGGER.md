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
