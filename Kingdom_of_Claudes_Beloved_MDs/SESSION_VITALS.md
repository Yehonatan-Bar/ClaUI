# Session Vitals

Visual session health dashboard providing real-time feedback about session activity through color-coded components.

## Components

### Session Timeline (Minimap)
Vertical 24px strip rendered alongside the message list (right side). Each turn is a colored segment proportional to its duration.

- **File**: `src/webview/components/Vitals/SessionTimeline.tsx`
- **Color map** by category:
  - `success` = green (#4caf50)
  - `error` = red (#f44336)
  - `discussion` = blue (#2196f3)
  - `code-write` = purple (#9c27b0)
  - `research` = orange (#ff9800)
  - `command` = cyan (#00bcd4)
- **Opacity**: Scales with turn cost relative to session max (`0.35 + 0.65 * costRatio`)
- **Position marker**: White triangle tracks current scroll position
- **Click-to-jump**: Clicking a segment scrolls the corresponding message into view
- **Hover tooltip**: Shows turn number, category, tools used, duration, and cost

### Weather Widget
20x20px animated icon fixed at top-right (`top: 28px; right: 6px`). Reflects session mood based on recent error/success patterns.

- **File**: `src/webview/components/Vitals/WeatherWidget.tsx`
- **8 moods**: clear, partly-sunny, cloudy, rainy, thunderstorm, rainbow, night, snowflake
- **Pulse animation**: CSS keyframe with configurable speed (slow/normal/fast)
- **Mood algorithm** (in `calculateWeather()` in `store.ts`):
  - No turns -> night/slow
  - 3+ errors in last 5 turns -> thunderstorm/fast
  - 2+ errors in last 5 -> rainy/fast
  - Previous error + current success -> rainbow/normal
  - 1 error in last 5 -> cloudy/normal
  - 1 error in last 8 -> partly-sunny/slow
  - 5+ success streak -> clear/slow
  - Default -> partly-sunny/slow
  - Session ended -> snowflake (disconnected) or night (completed)

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

### VitalsContainer
Wrapper that conditionally renders WeatherWidget + CostHeatBar when vitals are enabled.

- **File**: `src/webview/components/Vitals/VitalsContainer.tsx`

## Data Pipeline

```
CLI ResultSuccess/ResultError
    |
    v
MessageHandler.ts (result handler)
    - Snapshots toolNames BEFORE clearApprovalTracking()
    - Builds TurnRecord with categorizeTurn() helper
    - postMessage({ type: 'turnComplete', turn })
    |
    v
useClaudeStream.ts -> addTurnRecord(msg.turn)
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
- Priority: error > discussion (no tools) > code-write > command > research > success
- MCP tool name prefixes (e.g., `mcp__codex__codex`) are stripped to get the base tool name
- Tool classification:
  - Code-write: Write, Edit, NotebookEdit, MultiEdit
  - Research: Read, Grep, Glob, WebSearch, WebFetch
  - Command: Bash, Terminal

### TurnRecord Type
Defined in `src/extension/types/webview-messages.ts`:
```typescript
export type TurnCategory = 'success' | 'error' | 'discussion' | 'code-write' | 'research' | 'command';

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

- **Setting**: `claudeMirror.sessionVitals` (boolean, default `true`)
- **UI**: "Vitals" button in the StatusBar (active state highlighted with link color)
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
- Weather algorithm uses a simple sliding window - no persistence across sessions
