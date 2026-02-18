# Activity Summarizer

Periodically summarizes Claude's tool activity via Haiku and updates the busy indicator and status bar tooltip. The tab title (set by SessionNamer) is never overwritten.

## Key Files

| File | Role |
|------|------|
| `src/extension/session/ActivitySummarizer.ts` | Core class: accumulation, debouncing, Haiku spawn, response parsing |
| `src/extension/webview/MessageHandler.ts` | Integration: tool context capture, blockStop handler, summary forwarding |
| `src/extension/session/SessionTab.ts` | Orchestration: instantiation, callbacks, status bar tooltip updates |
| `src/webview/state/store.ts` | State: `activitySummary` field (shortLabel + fullSummary) |
| `src/webview/hooks/useClaudeStream.ts` | Message handler: dispatches `activitySummary` to store |
| `src/webview/App.tsx` | UI: busy indicator shows short label + full summary detail panel |

## How It Works

### Flow

1. **Tool tracking**: `MessageHandler` hooks into `toolUseStart` and `toolUseDelta` events. On `toolUseStart`, it maps blockIndex -> toolName. On `toolUseDelta`, it captures the first ~150 chars of JSON input for context enrichment.

2. **Enrichment**: On `blockStop`, the tool name is enriched with context from its JSON input (e.g., `Read` becomes `Read (src/auth.ts)`). The enriched name is recorded to `ActivitySummarizer.recordToolUse()`.

3. **Threshold + debounce**: After accumulating N tool uses (default: 3, configurable via `claudeMirror.activitySummaryThreshold`), the summarizer waits 2 seconds (debounce) to batch rapid tool uses, then calls Haiku.

4. **Haiku call**: Spawns `claude -p --model claude-haiku-4-5-20251001` with a prompt listing the recent tools. Same spawn pattern as `SessionNamer` (stdin pipe, env cleanup, 10s timeout).

5. **Response parsing**: Haiku returns exactly 2 lines:
   - Line 1: Short activity label (3-6 words) for the tab title
   - Line 2: One-sentence summary for the tooltip

   The response is sanitized (quotes stripped, length limits enforced, word count checked).

6. **UI update**: The summary is forwarded to:
   - `SessionTab` callback -> updates `statusBarItem.tooltip` (tab title is NOT changed)
   - Webview via `activitySummary` message -> updates busy indicator with short label + full summary detail panel

   The busy indicator displays two lines when an activity summary is present:
   - Top: thinking dots + short label (e.g., "Refactoring auth module...")
   - Bottom: full summary sentence in a highlighted panel with fade-in animation

   The activity summary state is cleared at the start of each new turn (`processBusy` with `busy=true`), so each turn starts with "Thinking..." and transitions to the summary after the threshold is reached.

### Haiku Prompt

```
You are summarizing Claude Code's current activity based on its tool usage.

Tools used (most recent last):
- Read (src/utils/auth.ts)
- Edit (src/utils/auth.ts)
- Bash (npm test)

Respond with EXACTLY two lines:
Line 1: Short activity label (3-6 words) for a tab title
Line 2: One-sentence summary of what Claude is doing

Match the language of any file paths or context. Reply with ONLY the two lines.
```

## Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `claudeMirror.activitySummary` | boolean | `true` | Enable/disable the feature |
| `claudeMirror.activitySummaryThreshold` | number | `3` | Tool uses before triggering a summary |

## Relationship to SessionNamer

`ActivitySummarizer` is a sibling to `SessionNamer`, not an extension of it. They share the same spawn pattern but have different responsibilities:

| | SessionNamer | ActivitySummarizer |
|---|---|---|
| **Trigger** | First user message (once) | Every N tool uses (repeating) |
| **Input** | User message text | List of enriched tool names |
| **Output** | 1-3 word session name | Short label + full summary |
| **Lifecycle** | One-shot | Stateful (accumulates, debounces, resets) |

## Safeguards

- `inFlight` flag prevents concurrent Haiku calls
- `reset()` called on `startSession`, `clearSession`, `editAndResend`
- Config check (`claudeMirror.activitySummary`) at `recordToolUse` time
- 10-second timeout on Haiku process
- `disposed` check in SessionTab callback prevents post-dispose crashes
- Cost: ~$0.0002 per call, negligible
