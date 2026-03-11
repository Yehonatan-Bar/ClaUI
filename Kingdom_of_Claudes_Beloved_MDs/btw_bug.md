# BTW Feature - Bug Fix History

## Feature Overview

The "btw..." feature allows users to have a **separate side-conversation** that floats above the current session in an overlay panel. The conversation does NOT pollute the main session's message stream.

- Right-click -> "btw..." -> type a message -> "Send"
- A floating chat overlay appears showing the btw conversation independently
- The main session is completely unaffected
- Follow-up messages can be sent in the overlay
- Closing the overlay kills the background session

## Architecture

- **BackgroundSession** (`src/extension/session/BackgroundSession.ts`): Headless CLI session that forks from the parent session. Owns its own `ClaudeProcessManager`, `StreamDemux`, and `ControlProtocol`. Uses single-phase approach: fork + immediate message send.
- **SessionTab** manages the btw lifecycle: `startBtwSession()`, `wireBtwSessionEvents()`, `sendBtwMessage()`, `closeBtwSession()`.
- **Webview** has separate Zustand store state (`btwSession`) with its own messages/streaming/busy arrays.
- **Message routing**: Extension sends btw-prefixed messages (`btwSessionStarted`, `btwStreamingText`, etc.) to webview. Webview sends `startBtwSession`, `sendBtwMessage`, `closeBtwSession` to extension.

## Bug: BTW Overlay Stuck - Fix Attempts Timeline

### Root Cause Discovery

Two separate bugs were found:

**Bug 1 - Backend hang**: The Claude CLI in **pipe mode** (`-p`) with `--fork-session` does NOT exit after forking. It stays alive on the forked session, waiting for stdin input. This made the two-phase fork approach (wait for exit, then resume) hang forever.

**Bug 2 - Data nesting mismatch**: The `wireBtwSessionEvents()` method in SessionTab accessed event data at the wrong nesting level. The CLI events `AssistantMessage` and `UserMessage` have data nested under `.message`:

```typescript
// CLI event structure:
AssistantMessage = { type: 'assistant', message: { id, content, model, ... } }
UserMessage      = { type: 'user',      message: { role, content } }

// BUG - wireBtwSessionEvents used:
data.id, data.content, data.model          // all undefined!

// FIX - should be:
data.message.id, data.message.content, data.message.model
```

This caused:
- Completed assistant messages had **empty content** (`[]`)
- Streaming text rendered briefly, then was replaced by an empty message showing just "Claude" role label
- User saw "Claude" with no text below it

---

### Attempt 1: Two-Phase Fork via ProcessManager (Original)

**Approach**: Use `processManager.start({ resume, fork: true })` for phase 1. Wait for process exit. Read `processManager.currentSessionId` from `system/init` event. Then start phase 2 with `processManager.start({ resume: forkedId, skipReplay: true })`.

**Result**: Stuck on "Starting session...". The fork process never exited because pipe mode keeps it alive. No `system/init` event emitted. The exit handler never fired.

**Diagnosis difficulty**: No logging from the process manager (missing `setLogger()` call), so the process appeared to hang silently.

---

### Attempt 2: Add Diagnostic Logging

**Change**: Added `this.processManager.setLogger(...)` to BackgroundSession constructor.

**Result**: Logs now showed the process spawning but no events or exit. Still stuck.

---

### Attempt 3: Direct Spawn Without Pipe Mode

**Approach**: Bypass `processManager` for phase 1. Spawn `claude --resume <id> --fork-session --output-format stream-json --verbose` directly (no `-p` flag). Parse stdout for session ID. Then use `processManager` for phase 2.

**Result**: Fork phase 1 succeeded! Process exited with code 0. But initial implementation looked for `system/init` event in stdout to get the session ID - this event is NOT emitted without pipe mode.

**Symptom**: "Fork failed: no session ID in output"

---

### Attempt 4: Extract session_id from hook_started Event

**Change**: Instead of only looking for `system/init`, extract `session_id` from ANY JSON event in the fork stdout (the `hook_started` event contains it).

**Result**: Session ID captured successfully. Phase 2 started. But phase 2 process crashed with **exit code 1** after ~2.5 seconds. No stderr output visible.

**Likely cause**: The `session_id` from `hook_started` may not be the actual forked session ID that can be resumed, OR the forked session file wasn't in a resumable state.

---

### Attempt 5: Back to ProcessManager for Both Phases

**Approach**: Revert to using `processManager.start({ resume, fork: true })` for phase 1 (same approach as SessionTab). Added comprehensive logging for all events, raw output, stderr, and demux emissions.

**Result**: Same hang as Attempt 1. Logs confirmed the fork process stays alive in pipe mode.

---

### Attempt 6: Single-Phase Approach (Fixed Bug 1)

**Key insight**: The CLI in pipe mode with `--fork-session` doesn't exit because it's designed to stay alive on the forked session. The two-phase approach was fundamentally wrong.

**Approach**:
1. `processManager.start({ resume: sessionId, fork: true })` - CLI forks and stays alive
2. Immediately send the first message via `control.sendText(promptText)` - no waiting for exit or init
3. CLI processes the fork setup + the first message, then streams back the response
4. Single process handles the entire btw session lifecycle

**Result**: Backend now works perfectly. Logs confirmed full event flow:
```
hook_started -> hook_response -> system/init -> messageStart -> textDelta (many) -> assistantMessage -> messageStop -> result
```
Follow-up messages also work. BUT the overlay showed "Claude" role label with empty text. Bug 2 discovered.

---

### Attempt 7: Fix Data Nesting in wireBtwSessionEvents (Fixed Bug 2)

**Root cause**: `wireBtwSessionEvents()` in SessionTab destructured event data at the wrong level.

The demux emits `assistantMessage` with the full `AssistantMessage` CLI event object:
```typescript
{ type: 'assistant', message: { id: string, content: ContentBlock[], model: string, ... } }
```

But the handler used `data.id` / `data.content` instead of `data.message.id` / `data.message.content`. Same issue for `userMessage` events.

**Fix**: Changed both handlers to correctly access `data.message.*`:
```typescript
// Before (WRONG):
btw.on('assistantMessage', (data: { id, content, model }) => { ... })

// After (CORRECT):
btw.on('assistantMessage', (data: { message: { id, content, model } }) => {
  const msg = data.message;
  // use msg.id, msg.content, msg.model
})
```

**Status**: Fixed. Assistant messages render correctly.

---

### Attempt 8: Optimistic User Message Display (Fixed Bug 3)

**Problem**: User messages were invisible in the btw overlay. They only appeared when the CLI echoed them back via the `userMessage` demux event, which could take seconds (or never, if the CLI doesn't echo).

**Root cause**: The UI only added user messages when the `btwUserMessage` event arrived from the extension (CLI echo). No optimistic/client-side display.

**Fix**: Add user messages to the Zustand store immediately when the user sends them, before the CLI processes anything:

1. **BtwPopup.tsx**: Both `handleChatKeyDown` (Enter key) and `handleChatSend` (button click) now call `addBtwUserMessage([{ type: 'text', text }])` before `postToExtension`.

2. **MessageList.tsx**: `handleStartBtwSession` (first message) now calls `initBtwSession()` + `addBtwUserMessage()` immediately before `postToExtension`.

3. **store.ts**: `initBtwSession` made idempotent - skips if `btwSession` already exists, so the CLI echo of `btwSessionStarted` doesn't wipe the optimistic user message.

4. **useClaudeStream.ts**: `btwUserMessage` handler changed to no-op (skip CLI echo) to prevent duplicate user messages.

**Status**: Deployed.

---

## Key Technical Lessons

1. **CLI pipe mode behavior**: The Claude CLI with `-p` does NOT emit `system/init` until it receives stdin input. With `--fork-session`, it does NOT exit - it stays alive on the forked session. Solution: send the first message immediately after spawning.

2. **`setLogger()` is essential**: Without calling `processManager.setLogger()`, the process manager's internal diagnostics (spawn command, PID, env) are invisible. Always set it.

3. **Event data nesting**: The StreamDemux emits some events with flat data (`messageStart`, `textDelta`) and others with the full CLI event structure (`assistantMessage`, `userMessage`). When wiring event handlers, always check the actual shape emitted by the demux, not assumptions.

4. **Debugging layered systems**: When a feature spans extension -> CLI -> demux -> event forwarding -> webview store -> React render, always verify each layer independently. The backend can work perfectly while the webview rendering is broken due to data shape mismatches.

5. **Optimistic UI for chat**: User messages should be added to the local store immediately when sent, not when the backend echoes them. The CLI echo can be skipped entirely (no-op handler) since the btw session is ephemeral with no resume/replay. Make init functions idempotent to prevent the backend echo from wiping optimistic state.

## Files Modified

| File | Changes |
|---|---|
| `src/extension/session/BackgroundSession.ts` | Complete rewrite - single-phase fork approach |
| `src/extension/session/SessionTab.ts` | btw lifecycle + fixed `.message` nesting in wireBtwSessionEvents |
| `src/extension/webview/MessageHandler.ts` | WebviewBridge interface + message handlers |
| `src/extension/types/webview-messages.ts` | 11 new btw message types |
| `src/webview/state/store.ts` | Separate `btwSession` state + 8 actions |
| `src/webview/hooks/useClaudeStream.ts` | 8 btw event handlers |
| `src/webview/components/ChatView/BtwPopup.tsx` | Overlay UI with compose/chat modes |
| `src/webview/components/ChatView/MessageList.tsx` | btw session start/close handlers |
| `src/webview/styles/global.css` | Floating overlay panel CSS |
