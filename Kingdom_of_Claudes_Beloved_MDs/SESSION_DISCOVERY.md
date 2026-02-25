# Session Discovery

## Purpose

Scans the `~/.claude/projects/` filesystem to discover all Claude Code sessions on disk, regardless of whether they were opened through ClaUi. This complements the existing Conversation History (`Ctrl+Shift+H`) which only shows sessions tracked in VS Code globalState.

## Key Files

| File | Path |
|------|------|
| SessionDiscovery.ts | `src/extension/session/SessionDiscovery.ts` |

## How It Works

### Discovery

Claude Code stores all sessions as `.jsonl` files in `~/.claude/projects/<workspace-dir>/`. The directory name is derived from the workspace path by replacing `:`, `\`, and `/` with `-` (e.g., `C:\projects\app` becomes `C--projects-app`).

`SessionDiscovery` class:
- `discoverAll()` - Scans all workspace directories, returns sessions sorted by mtime (newest first)
- `discoverForWorkspace(path)` - Returns sessions for a specific workspace only (handles Windows drive letter case mismatch)
- `extractFirstPrompt(filePath)` - Reads first 16KB of JSONL to find first user message (looks for `type: "queue-operation"` with `operation: "enqueue"`, or `type: "user"` entries). Truncated to 150 chars.
- `dirNameToLabel(dirName)` - Reverses directory name to readable path (e.g., `C--projects-app` -> `C:/projects/app`)
- `workspaceToDir(path)` - Converts workspace path to directory name

### QuickPick Flow

Two-step command registered as `claudeMirror.discoverSessions` (`Ctrl+Alt+D`):

1. **Scope picker** (skipped if no workspace is open):
   - "Current Workspace" - scans only the matching directory
   - "All Workspaces" - scans all directories

2. **Session picker**:
   - Label: first user prompt (or `Session <id>...` fallback)
   - Description: relative time + file size
   - Detail: workspace path (shown in all-workspaces mode)

On selection: creates a new Claude tab via `tabManager.createTabForProvider('claude')` and calls `startSession({ resume: sessionId })`.

## Edge Cases

- Missing `~/.claude/projects/` directory: returns empty result
- Corrupted JSONL lines: skipped via try/catch
- Windows drive letter case mismatch (C vs c): tries both variants
- Empty sessions (no user messages): fallback label
- Permission errors on files: silently skipped
- Large files: only reads first 16KB for prompt extraction

## Command & Keybinding

| Command | Keybinding | Title |
|---------|-----------|-------|
| `claudeMirror.discoverSessions` | `Ctrl+Alt+D` / `Cmd+Alt+D` | ClaUi: Discover All Sessions |

## Interaction with Other Components

- Uses `TabManager.createTabForProvider()` to create new session tabs
- Uses `SessionTab.startSession({ resume })` to resume discovered sessions
- Complements `SessionStore` (globalState-based history) and `ConversationReader` (JSONL parsing for conversation display)
