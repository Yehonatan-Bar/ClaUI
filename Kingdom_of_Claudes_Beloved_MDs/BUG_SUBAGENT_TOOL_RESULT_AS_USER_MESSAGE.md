# Bug: Sub-agent (Task) result rendered as a "YOU" message — FIXED

## One-line summary

When a Task / sub-agent finishes, its result is delivered by the CLI as a
`type: "user"` envelope. ClaUi used to misclassify it as a real user message and render
it as a "YOU" bubble (with Edit / Fork / Revert actions), instead of treating it as
tool output, and it corrupted the "last user message" used for turn analysis. This is now
fixed by a tool-result guard in the live `userMessage` handler (see **Fix** below).

## Symptom

Mid-session, a chat bubble appears styled as the user's own message ("YOU", with the
Copy / LTR / Edit / Fork / Revert action row) whose body is the flattened output of a
finished sub-agent, e.g.:

```
<task-id> toolu_XXXX  <...>/tasks/<task-id>.output  completed
Agent "Author iOS Live Activity native + widget" completed
... <the sub-agent's final report text> ...
```

The presence of the **Edit / Fork / Revert** buttons confirms it was rendered as a
genuine user message (those actions are only attached to real user input — see
`UserMessageDisplay.source === 'input'` in `webview-messages.ts`).

## When it happens

- The session uses **sub-agents** (the `Task` / `Agent` tool).
- A sub-agent completes, and the CLI emits the **top-level** Task result as a
  `type: "user"` event back to the main agent.
- It is independent of the Review Loop feature; sub-agent usage alone triggers it.

## Root cause

Tool results are user-role by Anthropic API convention. ClaUi must therefore decide,
for every `type: "user"` event, whether it is *real user input* or a *tool result*.
That decision is made in two places, and a top-level Task result slips through both.

### 1. Extension classification — `MessageHandler.ts`, `demux.on('userMessage', ...)`

The handler rejects an event from the "YOU" path only on these signals:

1. `event.parent_tool_use_id` is set → a sub-agent's **internal** event → dropped.
2. `event.isMeta === true` → CLI-synthetic content (skill body, dispatch context,
   system reminders) → routed to `syntheticToolContent`.

Everything else falls through and is posted as a real user message via
`postUserMessage(content)` (default `source: 'input'`).

A **finished top-level Task result has neither signal**: it is not a sub-agent
internal event (so no `parent_tool_use_id`), and it is not flagged `isMeta`. So it
reaches the fall-through.

Critically, just before the fall-through the handler normalizes non-array content:

```ts
const content = Array.isArray(event.message.content)
  ? event.message.content
  : [{ type: 'text', text: String(event.message.content) }];   // string -> text block
```

The raw user envelope's `content` is typed `string | ContentBlock[]` (see
`stream-json.ts`), and the CLI does deliver Task results with **string** content.
When that happens, the result text is wrapped into a **`text` block** — which then
looks exactly like ordinary user-typed text.

### 2. Webview safeguard — `store.ts`, `addUserMessage`

The store does filter tool results out of user bubbles:

```ts
const userVisibleContent = normalizedContent.filter(
  (block) => block.type !== 'tool_result'
);
if (userVisibleContent.length === 0) return;   // nothing to show
```

This is exactly why **normal** tool results (Read / Bash / etc.) never appear as
"YOU": they arrive as a `tool_result` **block** (an array), get filtered out, and the
bubble is skipped.

But the Task result that reached step 1 as a **`text` block** (because its content was
a string) is **not** a `tool_result` block, so this filter does not remove it. With
non-empty user-visible content remaining, the store appends a `role: 'user'` message
and renders the "YOU" bubble.

### Net effect

The only robust signal that a top-level `user` event is a tool result is a structured
`tool_result` content block. When the CLI flattens a Task result to a **string**, that
signal is lost, and none of the other guards (`parent_tool_use_id`, `isMeta`) apply —
so it renders as the user's own message.

## Impact

- **Cosmetic:** a fake "YOU" bubble containing sub-agent output clutters the chat.
- **Misleading actions:** the bubble exposes Edit / Fork / Revert. Forking or reverting
  from a turn that never existed as user input leads to incorrect fork/checkpoint
  behavior.
- **Data integrity:** the handler also runs
  `this.lastUserMessageText = userText` and appends to `recentUserMessages` from the
  Task result text. This pollutes the TurnAnalyzer context and the bug-repeat
  heuristic — the system "thinks" the user said the sub-agent's report.

## Not caused by the Review Loop

This is a pre-existing defect in core user-event classification. A session using
sub-agents triggers it regardless of whether the Review Loop ran. It surfaced during a
Review Loop session only because that session happened to use sub-agents.

## Fix (implemented)

A single guard in the live `userMessage` handler (`MessageHandler.ts`,
`demux.on('userMessage', ...)`) routes any tool-result envelope away from the "YOU"
path **before** it is treated as real user input. It fires when either signal holds:

1. **Structured signal** — the content contains a `tool_result` block (array content;
   normal Read/Bash/etc. results).
2. **Turn-state signal** — the envelope arrived while an assistant turn is in flight
   (`inAssistantTurn === true`) and is **not** the echo of a message ClaUi sent from its
   own input box (`flatText !== lastPostedUserMsg.text`). A top-level Task result loses
   signal (1) when the CLI flattens it to a string, but it always arrives mid-turn, so
   signal (2) still catches it.

When either holds, the handler logs and `return`s early — it does not post a `userMessage`
and does not update `lastUserMessageText` / `recentUserMessages`, so the TurnAnalyzer
context stays clean.

### Why genuine input and resume do not regress

- **Live / queued input** is rendered optimistically from the input box and recorded in
  `lastPostedUserMsg`. Its CLI echo matches `flatText`, so signal (2) excludes it; the
  optimistic bubble (with Edit/Fork/Revert) is the sole "YOU" source.
- **Resume** rebuilds the visible conversation from the **separate**
  `conversationHistory` path (`SessionTab.loadAndSendConversationHistory` ->
  `ConversationReader`), which already filters `tool_result` blocks. `--replay-user-messages`
  emits no `message_start`, so replayed user messages arrive at idle
  (`inAssistantTurn === false`) and pass the guard untouched.
- **Normal tool results** (array `tool_result` blocks) were already dropped downstream by
  `store.ts addUserMessage`; the guard now drops them one layer earlier, which also stops
  them polluting `lastUserMessageText`.

No webview-side change is required: the guard prevents the bad envelope from ever reaching
the webview, and a turn-state heuristic in `store.ts` would be unreliable (the webview does
not track turn state) and could suppress real input.

## Key code references

| File | Location | Role |
|------|----------|------|
| `src/extension/webview/MessageHandler.ts` | `demux.on('userMessage', ...)` | Classification; **tool-result guard (`hasToolResultBlock` / mid-turn-non-input)** on the fall-through; string -> text-block wrap |
| `src/extension/webview/MessageHandler.ts` | `postUserMessage()` | Posts `userMessage` with `source: 'input'` (enables Edit/Fork/Revert) |
| `src/webview/state/store.ts` | `addUserMessage()` | Filters `tool_result` blocks, but not a string flattened into a `text` block |
| `src/extension/types/stream-json.ts` | `UserMessage` / raw envelope | Envelope `content` is `string | ContentBlock[]` — string path is the leak |
| `src/extension/types/webview-messages.ts` | `UserMessageDisplay` | "Only 'input' messages are eligible for Fork / Revert" |
