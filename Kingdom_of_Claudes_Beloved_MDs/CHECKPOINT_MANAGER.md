# Checkpoint Manager

Per-session file change tracking that enables reverting and re-applying code modifications made by Claude during a conversation.

## What It Does

Each time Claude modifies files via Write, Edit, MultiEdit, or NotebookEdit tools in response to a user prompt, the CheckpointManager captures a "before" and "after" snapshot of every affected file. Users can then:

- **Revert**: Click "Revert" on any user message to undo all file changes from that prompt onward
- **Redo**: After reverting, click "Redo" to re-apply the previously undone changes

## Key Files

| File | Path | Purpose |
|------|------|---------|
| CheckpointManager | `src/extension/session/CheckpointManager.ts` | Core engine: capture, revert, redo, conflict detection |
| MessageHandler integration | `src/extension/webview/MessageHandler.ts` | Hooks blockStop (before-capture) and handleResultEvent (after-capture) |
| SessionTab wiring | `src/extension/session/SessionTab.ts` | Instantiates CheckpointManager per tab |
| Message types | `src/extension/types/webview-messages.ts` | CheckpointState, CheckpointSummary, request/result messages |
| Store | `src/webview/state/store.ts` | checkpointState, checkpointResult state + actions |
| useClaudeStream | `src/webview/hooks/useClaudeStream.ts` | Dispatches checkpointState and checkpointResult to store |
| MessageBubble | `src/webview/components/ChatView/MessageBubble.tsx` | Revert/Redo buttons on user messages, scanning all assistant messages in that user turn |
| MessageList | `src/webview/components/ChatView/MessageList.tsx` | Button handlers that resolve checkpoints from any assistant message in the turn |
| CSS | `src/webview/styles/global.css` | Button styles, .message-reverted dimming |

## Data Flow

```
blockStop event (code-write tool)
  -> CheckpointManager.captureBeforeContent(filePath, toolName)
     reads file content BEFORE tool executes (blockStop fires before execution)
     dedupes by filePath per turn (first capture wins)

handleResultEvent (turn complete)
  -> CheckpointManager.finalizeTurn(turnIndex, messageId)
     reads current file content (the "after" state)
     creates Checkpoint if any files actually changed
     sends CheckpointState to webview

webview finalize (messageStop)
  -> Zustand finalizes assistant message from streamed blocks
     or falls back to the last assistant snapshot when Claude emits a
     snapshot-only reply with no accumulated streaming blocks
     ensures checkpoint messageId exists in chat history for button lookup

User clicks "Revert" on prompt N
  -> webview sends checkpointRevert { turnIndex }
  -> CheckpointManager.revert(turnIndex)
     restores "before" content for all files from turn N onward
     deletes files that were newly created
     detects conflicts (files modified externally)
  -> sends CheckpointResult + updated CheckpointState to webview
```

## Checkpoint Structure

Each checkpoint stores:
- `turnIndex` / `messageId` - Links to the assistant turn
- `timestamp` - When the checkpoint was created
- `files[]` - Array of `{ filePath, before, after, toolName }`
  - `before: null` = file was newly created
  - `after: null` = file was deleted

## Session Isolation

Each SessionTab has its own CheckpointManager instance. Checkpoints only track files modified by that session's tools. When reverting, conflict detection compares the current disk content with the expected "after" state -- if they differ (e.g., another session modified the same file), the conflicting file is skipped and reported.

On `clearSession` and `editAndResend`, the extension resets the session's CheckpointManager and immediately posts an empty `checkpointState` so the webview cannot keep stale revert/redo affordances from the previous branch.

## Redo Branch

When the user reverts to turn N and then sends a new prompt (creating new work), the old checkpoints from turn N+1 onward are discarded. The redo branch is lost -- this mirrors standard undo/redo semantics.

## Limitations

- Only tracks Write, Edit, MultiEdit, NotebookEdit tools (not Bash file changes)
- Files > 1MB are skipped
- Binary files are skipped
- In-memory storage only (checkpoints are lost when the session tab closes)
