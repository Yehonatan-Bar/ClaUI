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

If sanitization rejects the output, the tab keeps its default title (`Claude Mirror N`).

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

All logs go to the `Claude Mirror` output channel with `[SessionNaming]` and `SessionNamer:` prefixes.

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
