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

## Diagnostics (2026-03)

To investigate intermittent "first click did nothing" reports around history/plans actions, command-level diagnostics were added:

- `claudeMirror.showHistory` now logs scoped traces like:
  - `[showHistory#12] start`
  - `[showHistory#12] source selected=extension|all`
  - `[showHistory#12] session pick canceled ...`
  - `[showHistory#12] end durationMs=...`
- `claudeMirror.openPlanDocs` now logs scoped traces like:
  - `[openPlanDocs#7] start`
  - `[openPlanDocs#7] scan done in ... | workspacePlansDirs=... uniqueHtml=...`
  - `[openPlanDocs#7] picker canceled ...`
  - `[openPlanDocs#7] selected ...`
  - `[openPlanDocs#7] end durationMs=...`
- Both commands now include an in-flight guard to avoid overlapping pickers. Repeated clicks during an active run are logged as `ignored`.

---

# Merged from SESSION_NAMER.md

# Session Auto-Naming

## What It Does

When the user sends their first message in a tab, a background process spawns `claude -p --model claude-haiku-4-5-20251001` to generate a short (1-3 word) tab name. The name matches the language of the user's message (Hebrew or English). The tab title updates asynchronously once Haiku responds.

If anything fails (CLI not found, timeout, bad output), the default title stays. The user never sees an error.

## Files

| File | Role |
|------|------|
| `src/extension/session/SessionNamer.ts` | Spawns the CLI process, sanitizes output |
| `src/extension/webview/MessageHandler.ts` | Detects first message, triggers naming |
| `src/extension/session/SessionTab.ts` | Wires the above together, updates panel title |

## Data Flow

```
User sends first message
        |
        v
MessageHandler.triggerSessionNaming(text)
        |
        | checks: autoNameSessions config? firstMessageSent flag? namer attached?
        v
SessionNamer.generateName(text)
        |
        | spawns: claude -p --model claude-haiku-4-5-20251001
        | pipes prompt via stdin (NOT as CLI arg - see Gotchas)
        | waits for exit (max 10s)
        v
sanitize(stdout)
        |
        | strip quotes, punctuation; reject if empty, >40 chars, or >5 words
        v
returns string | null
        |
        v
MessageHandler calls titleCallback(name)
        |
        v
SessionTab.setTabName(name)  -->  panel.title = name
        |                          + persistSessionMetadata(name)
        v
Done (tab title updated)
```

## How the Prompt is Delivered

The prompt is written to the CLI process's **stdin**, not passed as a command-line argument:

```typescript
const args = ['-p', '--model', 'claude-haiku-4-5-20251001'];
const child = spawn(cliPath, args, { shell: true, ... });
child.stdin.write(prompt);
child.stdin.end();
```

The `-p` flag (print mode) without an inline prompt causes the CLI to read from stdin.

## The Prompt

```
Name this chat session in 1-3 words. Match the language of the user's message
(Hebrew or English). Reply with ONLY the name, nothing else.

User message: "<first 200 chars of user message>"
```

## Sanitization Rules

`SessionNamer.sanitize()` processes the raw CLI stdout:

1. Trim whitespace
2. Strip surrounding quotes (`"..."` or `'...'`)
3. Strip leading/trailing punctuation (`. , ! ? : ; -`)
4. **Reject** if empty -> return `null`
5. **Reject** if longer than 40 characters -> return `null`
6. **Reject** if more than 5 words -> return `null`

If sanitization rejects the output, the tab keeps its default title (`ClaUi N`).

## Flag Reset Points

The `firstMessageSent` flag in MessageHandler controls one-shot behavior. It resets to `false` on:

| Event | Why |
|-------|-----|
| `startSession` | New session started from UI |
| `clearSession` | User clicked clear / new session |
| `resumeSession` | Resuming a previous session |
| `forkSession` | Forking from a previous session |

This means each new/cleared/resumed session gets its own name from its own first message.

## Configuration

| Setting | Default | Effect |
|---------|---------|--------|
| `claudeMirror.autoNameSessions` | `true` | Set to `false` to disable naming entirely |
| `claudeMirror.cliPath` | `"claude"` | SessionNamer reads this to find the CLI |

## Safeguards

| Scenario | What Happens |
|----------|--------------|
| CLI not found | `spawn` error caught, returns `null` |
| Haiku takes >10s | Timer kills process with SIGTERM, returns `null` |
| Non-zero exit code | Returns `null` |
| Verbose/long output | Sanitization rejects (>40 chars or >5 words) |
| Panel disposed before name arrives | `disposed` check in callback prevents crash |
| Feature disabled | Config checked before spawning, skipped entirely |
| All errors | Logged to output channel, never shown to user |

## Environment Cleanup

Same pattern as `ClaudeProcessManager`: deletes `CLAUDECODE` and `CLAUDE_CODE_ENTRYPOINT` from the spawned process environment to prevent Claude CLI from detecting a nested session.

## Debugging

All logs go to the `ClaUi` output channel with `[SessionNaming]` and `SessionNamer:` prefixes.

**Key log lines to look for:**

```
[Tab N] [SessionNaming] triggerSessionNaming called   -- naming was triggered
[Tab N] [SessionNaming] SKIPPED: ...                  -- naming was skipped (check reason)
[Tab N] [SessionNaming] Launching generateName...      -- CLI spawn starting
[Tab N] SessionNamer: spawn succeeded, PID=...         -- process is running
[Tab N] SessionNamer: stdout chunk ...                 -- raw Haiku output
[Tab N] SessionNamer exited with code 0                -- process finished
[Tab N] SessionNamer: generated name "..."             -- sanitization passed
[Tab N] SessionNamer: output rejected after sanitization -- sanitization failed (check raw)
[Tab N] [SessionNaming] Calling titleCallback with "..." -- title being applied
```

## Gotcha: Shell Escaping (Fixed)

The prompt **must** be piped via stdin. An earlier implementation passed the prompt as a CLI argument (`-p "Name this..."`) but `shell: true` on Windows caused the shell to mangle multi-line strings, quotes, and Hebrew characters. Haiku only received the first word ("Name") and responded with a confused message instead of a tab name.

**Rule:** Never put the prompt in the `args` array. Always pipe via `stdin.write()` + `stdin.end()`.
.
