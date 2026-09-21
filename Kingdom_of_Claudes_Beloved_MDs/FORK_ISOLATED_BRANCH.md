# Fork From Message — Isolated Branch

## What this is

"Fork" opens a new tab that branches a conversation from a chosen user message.
The new tab shows the history up to (but not including) that message, pre-fills
its text in the input, and — critically — the underlying model (Claude or Codex)
resumes with the **same truncated context**, in an **isolated** session that does
not mutate the original.

Fork is offered only on user input messages (`isInputPrompt` in
`MessageBubble.tsx`), so the cut always lands at a user turn and the kept prefix
ends on the previous assistant turn.

## Entry point

- Webview: `MessageList.handleFork` posts `forkFromMessage` with `sessionId`,
  `forkMessageIndex` (index into the webview `messages` array), `promptText`, and
  `messages` (history before the fork).
- Extension: both `MessageHandler` and `CodexMessageHandler` route it to the
  `claudeMirror.forkFromMessage` command (`commands.ts`), which branches on the
  source session's provider.

## Claude fork — `SessionTruncator`

File: `src/extension/session/SessionTruncator.ts`

Claude transcripts live at `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`.
The truncator writes a NEW `<uuid>.jsonl` next to the original containing only the
events up to the fork point, rewrites the `sessionId` fields, strips `last-prompt`
markers, then the fork resumes it with `--resume <newId>` (no `--fork-session`,
`skipReplay: true`). Because the CLI reconstructs a genuinely shorter conversation,
`inputTokens` drops and the context bar reflects reality.

Cut selection:
1. `findCutPoint` — first line whose UI-message index reaches `forkMessageIndex`.
2. `ensureValidConversation` — if the last assistant before the cut ends on a
   `tool_use`, extend forward through the agentic loop to its terminal assistant.
3. `ensureEndsWithAssistant` — trim trailing user/tool_result/metadata so the file
   ends on an assistant whose final block is **not** a `tool_use`. If the trailing
   assistant would end on a `tool_use` (its `tool_result` was trimmed away, e.g.
   an interrupted turn), the whole group is dropped and it walks back to the
   previous terminal assistant. This guarantees every `tool_use` keeps its matching
   `tool_result`, so the Anthropic API never rejects the resumed conversation.

## Codex fork — `CodexSessionTruncator`

File: `src/extension/session/CodexSessionTruncator.ts`

Codex rollouts live at `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<threadId>.jsonl`.
The first line is `session_meta` whose `payload.id` equals the thread id (also
embedded in the filename); the rest are `response_item`s (`message` roles
developer/user/assistant, `reasoning`, `custom_tool_call`, `custom_tool_call_output`)
plus bookkeeping lines. Codex tool calls are **separate** response items (never
nested in an assistant `message`), so cutting immediately after any assistant
`message` is always API-valid.

The truncator copies the parent rollout truncated to the fork point into a new
`rollout-<ts>-<newThreadId>.jsonl` under today's date folder, rewrites the thread
id everywhere (whole-string replace of the UUID), and returns the new thread id.
`codex exec resume <newThreadId>` locates rollouts by scanning `~/.codex/sessions`
for the id, so it loads the truncated copy with full context while the original
thread is untouched.

Counting mirrors `CodexConversationReader`: only `message` items with role
user/assistant are UI messages. `snapToAssistantMessage` moves the cut back to end
right after the last assistant `message`.

## Wiring (`commands.ts` `forkFromMessage`)

- `forkMessageIndex === 0` → start a fresh session (nothing to keep).
- provider `claude` → `SessionTruncator`; on success `startSession({ resume: newId,
  skipReplay: true, truncatedFork: true })`, else fall back to `--fork-session`.
- provider `codex` → `CodexSessionTruncator`; on success `startSession({ resume:
  newThreadId, truncatedFork: true })`, else fall back to `startSession({ resume:
  parentThreadId })` (context preserved, non-isolated) — never a zero-context thread.

`SessionTab`/`CodexSessionTab.startSession` treat `truncatedFork` like a resume of
the new (isolated) session for the model — set the session/thread id to the copy —
but skip transcript replay and instead render history via the `forkInit` webview
message.

## Why the Codex fork was broken

Previously `CodexSessionTab.startSession` set `threadId = null` on a fork and never
loaded context, yet still sent `forkInit`. The tab displayed the whole conversation
while the Codex model started a brand-new thread with zero memory. The isolated
truncated rollout fixes this.

## Tests

`tests/unit/SessionTruncator.test.ts` and `tests/unit/CodexSessionTruncator.test.ts`
(run via `npm run test:truncator`). Covers simple/agentic/meta/partial cuts, the
dangling-`tool_use` tail (interrupted turn), and the Codex isolated rollout copy.
