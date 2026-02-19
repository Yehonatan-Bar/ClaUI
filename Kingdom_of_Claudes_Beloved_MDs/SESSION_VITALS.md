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

### VitalsContainer
Wrapper that conditionally renders WeatherWidget + AdventureWidget + CostHeatBar when vitals are enabled.

- **File**: `src/webview/components/Vitals/VitalsContainer.tsx`
- AdventureWidget additionally requires `adventureEnabled` to be true

### VitalsInfoPanel
Dropdown panel opened by clicking the "Vitals" button in the StatusBar. Shows explanations of all vitals components and toggle switches.

- **File**: `src/webview/components/Vitals/VitalsInfoPanel.tsx`
- **Content**: Explains weather icon, cost heat bar, timeline, intensity borders, and adventure widget
- **Toggles**: Adventure Widget (separate toggle) and Show Vitals (master toggle)
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

- **Setting**: `claudeMirror.sessionVitals` (boolean, default `false`)
- **UI**: "Vitals" button in the StatusBar opens a `VitalsInfoPanel` dropdown with explanations and a toggle switch (active state highlighted with link color)
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
