# Session Vitals

Visual session health dashboard providing real-time feedback about session activity through color-coded components.

## Components

### Session Timeline (Minimap)
Vertical 24px strip rendered alongside the message list (right side). Each turn is a colored segment proportional to its duration. Has an info trigger ("?") at the top that shows a legend tooltip on hover explaining what the timeline is and the color codes.

- **File**: `src/webview/components/Vitals/SessionTimeline.tsx`
- **Structure**: Info trigger at top (18px, flex-shrink: 0) + segments container (flex: 1) below
- **Info trigger**: "?" button at top of timeline. Hover shows a styled legend tooltip with description, color legend, and usage hint. Positioned to the left of the timeline (right: 28px).
- **Color map** by category (defined in `CATEGORY_COLORS` and `CATEGORY_LABELS`):
  - `success` = green (#4caf50) / "Success"
  - `error` = red (#f44336) / "Error"
  - `discussion` = blue (#2196f3) / "Discussion"
  - `code-write` = purple (#9c27b0) / "Code Write"
  - `research` = orange (#ff9800) / "Research"
  - `command` = cyan (#00bcd4) / "Command"
  - `skill` = magenta (#e040fb) / "Skill"
- **Opacity**: Scales with turn cost relative to session max (`0.35 + 0.65 * costRatio`)
- **Position marker**: White triangle tracks current scroll position
- **Click-to-jump**: Clicking a segment scrolls the corresponding message into view
- **Hover tooltip**: Shows turn number, category, tools used, duration, and cost

### Weather Widget
20x20px animated icon fixed-position (default `top: 28px; left: 32px`). Reflects overall session health via a **multi-dimensional composite score**. **Draggable**: click and drag to reposition anywhere in the webview; position persists in `localStorage` (`claui-weather-pos`). **Clickable**: clicking (without dragging) opens a popover with a detailed explanation of the current mood state. A 4px dead zone distinguishes click from drag.

- **File**: `src/webview/components/Vitals/WeatherWidget.tsx`
- **Drag**: mousedown on icon starts tracking; mousemove updates position; mouseup saves to localStorage. Uses `useRef` for drag state (avoids re-renders during drag).
- **Click popover**: Shows the weather symbol, label, and a human-readable description of what the current mood means. Closes on outside click.
- **8 moods**: clear, partly-sunny, cloudy, rainy, thunderstorm, rainbow, night, snowflake
- **Pulse animation**: CSS keyframe with configurable speed (slow/normal/fast)
- **Mood algorithm** (in `calculateWeather()` in `store.ts`) - composite of 4 dimensions:
  1. **Error pressure** (30%): errors in last 5 turns / total recent turns
  2. **Cost velocity** (25%): recent per-turn cost vs session average (0 at normal, 1 at 3x)
  3. **Momentum** (25%): recent turn duration vs session average (rising = worse)
  4. **Productivity flow** (20%): ratio of productive categories (code-write, research, command) vs discussion/error
  - Composite < 0.15 -> clear/slow
  - Composite 0.15-0.30 -> partly-sunny/normal
  - Composite 0.30-0.45 -> cloudy/normal
  - Composite 0.45-0.60 -> rainy/fast
  - Composite 0.60+ -> thunderstorm/fast
  - **Special overrides**: previous error + current success -> rainbow/normal; no turns -> night/slow; disconnected -> snowflake

### Cost Heat Bar
4px horizontal gradient strip showing cost accumulation.

- **File**: `src/webview/components/Vitals/CostHeatBar.tsx`
- **Gradient**: green -> yellow -> orange -> red
- **Fill**: `width = min(totalCostUsd / budgetUsd * 100, 100)%` (budget default = $1.00)
- **Hidden** when cost is 0

### Turn Intensity Borders
Colored left border on each assistant message bubble, reflecting the turn's category and tool intensity.

- **File**: Logic in `src/webview/components/ChatView/MessageBubble.tsx`
- **Width**: 2px (no tools) / 3px (1-3 tools) / 4px (4+ tools)
- **Color**: Category color with opacity based on tool count (40% / 70% / 100%)
- **Tooltip**: Hover text explains the category, tool count, width, and lists all 7 category colors including magenta for skill

### VitalsContainer
Wrapper that conditionally renders WeatherWidget + AdventureWidget + CostHeatBar when vitals are enabled.

- **File**: `src/webview/components/Vitals/VitalsContainer.tsx`
- AdventureWidget additionally requires `adventureEnabled` to be true

### VitalsInfoPanel
Dropdown panel opened by clicking the gear settings button in the StatusBar. Shows explanations of all vitals components and toggle switches.

- **File**: `src/webview/components/Vitals/VitalsInfoPanel.tsx`
- **Content**: Explains weather icon, cost heat bar, timeline, intensity borders, and adventure widget
- **Tooltips**: Every setting label has a `data-tooltip` attribute providing a description of the feature. Uses the global tooltip system (event-delegated via `data-tooltip` attribute, styled as `.global-tooltip` in `global.css`).
- **Settings rows** (each with descriptive tooltip on hover):
  - **Claude Account**: Login/Logout/Refresh buttons for Claude CLI authentication
  - **API Key**: Set/Clear explicit Anthropic API key (stored in OS keychain)
  - **Translate to**: Language selector for automatic response translation
  - **Adventure Widget**: Toggle + Reset position button
  - **Semantic Analysis**: Toggle AI-powered turn analysis
  - **Analysis Model**: Choose Haiku/Sonnet/Opus for analysis
  - **Skill Generation**: Toggle automatic skill file generation
  - **Usage Widget**: Toggle floating cost/token widget + Reset position
  - **Show Vitals**: Toggle the entire vitals display (weather, timeline, borders)
- **State**: Claude auth status is mirrored into Zustand (`claudeAuthLoggedIn`, `claudeAuthEmail`, `claudeAuthSubscriptionType`) via `claudeAuthStatus` postMessage
- **Extension flow**: `MessageHandler` sends auth status on webview `ready` and on explicit refresh/logout
- **Closes on**: clicking the close button or clicking outside the panel

### Adventure Widget
Pixel-art dungeon crawler canvas, documented separately.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ADVENTURE_WIDGET.md`

## Data Pipeline

```
CLI ResultSuccess/ResultError
    |
    v
MessageHandler.ts (result handler)
    - Snapshots toolNames BEFORE clearApprovalTracking()
    - Builds TurnRecord with categorizeTurn() helper
    - postMessage({ type: 'turnComplete', turn })
    - Calls AdventureInterpreter.interpret(turn) -> postMessage({ type: 'adventureBeat', beat })
    |
    v
useClaudeStream.ts -> addTurnRecord(msg.turn) / addAdventureBeat(msg.beat)
    |
    v
Zustand store
    - turnHistory[] (capped at 200)
    - turnByMessageId{} (O(1) lookup)
    - weather (recalculated on every addTurnRecord)
    |
    v
React components (SessionTimeline, WeatherWidget, CostHeatBar, MessageBubble)
```

### Turn Categorization
Helper function `categorizeTurn()` in `MessageHandler.ts`:
- Priority: error > discussion (no tools) > skill > code-write > command > research > success
- MCP tool name prefixes (e.g., `mcp__codex__codex`) are stripped to get the base tool name
- Tool classification:
  - Skill: Skill (the Claude Skill tool)
  - Code-write: Write, Edit, NotebookEdit, MultiEdit
  - Research: Read, Grep, Glob, WebSearch, WebFetch
  - Command: Bash, Terminal

### TurnRecord Type
Defined in `src/extension/types/webview-messages.ts`:
```typescript
export type TurnCategory = 'success' | 'error' | 'discussion' | 'code-write' | 'research' | 'command' | 'skill';

export interface TurnRecord {
  turnIndex: number;
  toolNames: string[];
  toolCount: number;
  durationMs: number;
  costUsd: number;
  totalCostUsd: number;
  isError: boolean;
  category: TurnCategory;
  timestamp: number;
  messageId: string;
}
```

## Toggle

- **Setting**: `claudeMirror.sessionVitals` (boolean, default `false`)
- **UI**: "Vitals" button in the StatusBar toggles vitals on/off; the adjacent gear button opens `VitalsInfoPanel` with explanations and settings
- **Behavior**: Hides ALL vitals components (timeline, weather, cost bar, intensity borders) when disabled
- **Sync**: Two-way sync between VS Code settings and webview (same pattern as other settings)

## Key Files

| File | Changes |
|------|---------|
| `src/extension/types/webview-messages.ts` | TurnRecord, TurnCategory, 3 new message types |
| `src/extension/webview/MessageHandler.ts` | TurnRecord building in result handler, vitals setting sync |
| `package.json` | `claudeMirror.sessionVitals` setting |
| `src/webview/state/store.ts` | Vitals state slice (turnHistory, weather, turnByMessageId) |
| `src/webview/hooks/useClaudeStream.ts` | turnComplete + vitalsSetting handlers |
| `src/webview/App.tsx` | VitalsContainer, chat-area-wrapper layout, toggle button |
| `src/webview/components/Vitals/SessionTimeline.tsx` | Timeline minimap component |
| `src/webview/components/Vitals/WeatherWidget.tsx` | Weather mood icon |
| `src/webview/components/Vitals/CostHeatBar.tsx` | Cost gradient bar |
| `src/webview/components/Vitals/VitalsContainer.tsx` | Conditional wrapper |
| `src/webview/components/Vitals/VitalsInfoPanel.tsx` | Info panel with explanations + toggle |
| `src/extension/auth/AuthManager.ts` | Claude auth status/logout helpers (`auth status --json`, `auth logout`) |
| `src/webview/components/ChatView/MessageBubble.tsx` | Turn intensity borders |
| `src/webview/components/ChatView/MessageList.tsx` | Scroll fraction tracking |
| `src/webview/styles/global.css` | All vitals CSS |

## Performance

- Vitals components only update on `turnComplete` events (once per completed turn), NOT on streaming text deltas
- `SessionTimeline` uses `React.memo` with custom comparator - re-renders only when turn count or scroll fraction changes
- `WeatherWidget` and `CostHeatBar` use `React.memo`
- `turnByMessageId` provides O(1) lookup in `MessageBubble` (no array scanning)
- Turn history capped at 200 entries to prevent memory growth

## Limitations

- Session resume: Historical turns don't have TurnRecords (timeline starts empty on resume)
- `duration_ms` may be undefined for some CLI versions (falls back to 0, segments use equal heights)
- Weather algorithm uses a sliding window over recent turns - no persistence across sessions
- Cost velocity and momentum scores need a few turns of history to be meaningful (early turns default to low scores)

---

# Merged from ACTIVITY_SUMMARIZER.md

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
- Cost: ~$0.0002 per call, negligible.

---

# Merged from USAGE_LIMIT_DEFERRED_SEND.md

# Usage Limit Deferred Send

## Status

Implemented on **March 11, 2026**.

This feature is active for the Claude provider path and lets users queue a prompt when Claude returns a temporary usage-limit error.

## User Experience

When Claude returns a usage-limit reset message:

1. Input enters usage-limit mode.
2. Send button text changes to `Send When Available`.
3. Helper copy explains that the prompt can be queued now and auto-sent later.
4. User can send text-only or text+images; the prompt is queued per tab.
5. The queued prompt is auto-sent one minute after reset time.

## Scope (V1)

- Provider: Claude only.
- Queue size: one queued prompt per tab.
- Replacement policy: latest queued prompt wins.
- Schedule rule: `scheduledSendAt = resetAt + 60_000`.
- Retry rule: if still busy at fire time, retry every 15 seconds.

## Extension Implementation

### Usage-limit parsing

- File: `src/extension/process/usageLimitParser.ts`
- Entry point: `parseUsageLimitError(rawMessage, nowMs?)`
- Behavior:
- Detects usage-limit strings.
- Parses reset time from absolute datetime, time-only text, or relative duration.
- Normalizes to a future timestamp and returns `{ resetAtMs, resetDisplay }`.

### Queue scheduler and lifecycle

- File: `src/extension/webview/MessageHandler.ts`
- State:
- usage-limit active flag and reset timestamp
- queued prompt payload (text + optional images)
- scheduled fire time and timer handle
- Flow:
1. In the `result` error branch, usage-limit errors activate queue mode.
2. `queuePromptUntilUsageReset` stores/replaces the prompt and schedules a timer.
3. At fire time, prompt is sent through existing `sendText`/`sendWithImages` paths.
4. If blocked (assistant turn/approval state), retry is scheduled after 15 seconds.
- Cleanup:
- clears usage-limit and queue state on `startSession`, `stopSession`, `resumeSession`, `forkSession`, `clearSession`, `editAndResend`
- clears state when provider changes away from Claude
- clears state after successful Claude result

## Webview Implementation

### Message contract

- File: `src/extension/types/webview-messages.ts`
- Added webview -> extension message: `queuePromptUntilUsageReset`
- Added extension -> webview messages: `usageLimitDetected`, `usageQueuedPromptState`

### State and event handling

- Files: `src/webview/state/store.ts`, `src/webview/hooks/useClaudeStream.ts`
- Added Zustand state: `usageLimit`, `usageQueuedPrompt`
- Added setters and message handlers for the new extension events.
- State resets on session end/reset and when switching away from Claude.

### Input UI behavior

- File: `src/webview/components/InputArea/InputArea.tsx`
- Usage-limit mode condition: `usageLimit.active && provider === 'claude'`
- In usage-limit mode:
- send action posts `queuePromptUntilUsageReset` instead of immediate send
- input and images clear after queue request
- helper text and queued summary chip are shown
- send label becomes `Send When Available`
- placeholder and tooltip switch to queue copy

### Styling

- File: `src/webview/styles/global.css`
- Added `.usage-limit-helper` and `.usage-limit-queued-chip`.

## Notes

- This feature does not change Codex/Remote provider behavior.
- If a post-reset send still hits usage limit, the next error re-enters usage-limit mode with the new reset time.
