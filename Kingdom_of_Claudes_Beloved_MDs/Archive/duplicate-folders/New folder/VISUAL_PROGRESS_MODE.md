# Visual Progress Mode (VPM)

Card-based visual progress display that shows what Claude is doing in real time. Each tool action generates an animated card with a category-specific SVG character illustration and description, flowing in a vertical timeline alongside messages.

## Architecture

When VPM is enabled, the chat area splits into a side panel (340px) and messages:

```
chat-area-wrapper.vpm-split-layout (flex row)
  |-- vpm-container (340px, full height, scrollable)
  |     |-- VisualProgressView
  |           |-- ProgressCard[] (vertical timeline with connectors)
  |                 |-- Character SVG (animated, category-specific)
  |                 |-- Description (template -> AI enriched)
  |                 |-- Metadata (tool name, file path, timestamp)
  |-- MessageList (remaining width, standard messages)
```

## Data Flow

```
CLI stdout -> StreamDemux -> MessageHandler -> VisualProgressProcessor
                                                |
                                          [toolUseStart]
                                                |
                                          Template card (immediate)
                                          postMessage -> webview
                                                |
                                          [blockStop with full input]
                                                |
                                          Enriched template card
                                          postMessage -> webview (upsert)
                                                |
                                          [optional Haiku API call]
                                                |
                                          AI description update
                                          postMessage -> webview (patch)
```

## Tool Categories

10 categories, each with a distinct color, SVG character, and label:

| Category | Color | Character | Tools |
|----------|-------|-----------|-------|
| reading | #4FC3F7 | Person with book | Read |
| writing | #81C784 | Person at desk | Write |
| editing | #FFD54F | Person with pencil | Edit, NotebookEdit, MultiEdit |
| searching | #FF8A65 | Person with magnifying glass | Grep, Glob |
| executing | #CE93D8 | Person at terminal | Bash, Terminal |
| delegating | #90CAF9 | Person dispatching messenger | Agent, Task, dispatch_agent |
| planning | #A5D6A7 | Person with clipboard | TodoWrite |
| skill | #F48FB1 | Person with wizard hat | Skill |
| deciding | #B0BEC5 | Person at crossroads | ExitPlanMode, EnterPlanMode, AskUserQuestion |
| researching | #80DEEA | Person with globe | WebFetch, WebSearch |

## Files

### Extension Side

| Path | Purpose |
|------|---------|
| `src/extension/session/VisualProgressProcessor.ts` | Core processor: tool events -> cards, Haiku queue, caching |

Key methods:
- `onToolUseStart(toolName, toolId, blockIndex)` - Emits template card immediately
- `onBlockStop(blockIndex, accumulatedInput)` - Enriches card with parsed input details, queues Haiku
- `updateAssistantContext(text)` - Maintains last 200 chars of assistant text for Haiku context
- `reset()` - Clears state on session start/end

### Webview Side

| Path | Purpose |
|------|---------|
| `src/webview/components/ChatView/VisualProgress/VisualProgressView.tsx` | Container with auto-scroll, empty state |
| `src/webview/components/ChatView/VisualProgress/ProgressCard.tsx` | Individual card: character, descriptions, metadata |
| `src/webview/components/ChatView/VisualProgress/characters/index.ts` | Category maps (colors, labels, characters), toolToCategory(), templateDescription() |
| `src/webview/components/ChatView/VisualProgress/characters/*.tsx` | 10 animated SVG character components |

### Modified Files

| Path | Changes |
|------|---------|
| `package.json` | Added `claudeMirror.visualProgressMode` and `claudeMirror.vpmAiDescriptions` settings |
| `src/webview/state/store.ts` | Added `ToolCategory`, `VisualProgressCard` types, state fields, upsert/update/clear actions |
| `src/extension/types/webview-messages.ts` | Added `SetVpmEnabledRequest`, `VpmSettingMessage`, `VisualProgressCardMessage`, `VisualProgressCardUpdateMessage` |
| `src/webview/components/Vitals/VitalsInfoPanel.tsx` | Display Mode slider (4-position: Normal, Summary, Visual, Diff) |
| `src/extension/webview/MessageHandler.ts` | Wired VPM processor, config watcher, setting sync, demux hooks |
| `src/extension/session/SessionTab.ts` | Instantiates VisualProgressProcessor, wires to MessageHandler |
| `src/webview/hooks/useClaudeStream.ts` | Handles `vpmSetting`, `visualProgressCard`, `visualProgressCardUpdate` messages |
| `src/webview/App.tsx` | VPM split layout rendering, conditional timeline hiding |
| `src/webview/styles/global.css` | VPM CSS: cards, connectors, animations, split layout |

## Card Lifecycle

1. **toolUseStart**: `VisualProgressProcessor.onToolUseStart()` creates a card with template description (e.g., "Reading...") and `isStreaming: true`. Sent to webview immediately.

2. **blockStop**: `onBlockStop()` parses accumulated JSON input, extracts `filePath`/`command`/`pattern`, updates the card with enriched template (e.g., "Reading store.ts...") and `isStreaming: false`. Uses `blockToCardId` map to correlate blockIndex to cardId.

3. **AI enrichment** (optional): If `vpmAiDescriptions` is enabled and the tool isn't in `SKIP_AI_TOOLS`, a Haiku CLI call is queued. Max 2 concurrent calls, 8s timeout, results cached by `toolName:input` key. Updates card via `visualProgressCardUpdate` message.

## Haiku Integration

Uses the proven CLI-spawn pattern from SessionNamer:
- Spawns `claude -p --model claude-haiku-4-5-20251001`
- Prompt asks for 1-2 sentence first-person description with context
- Max 2 concurrent calls (queue-based)
- 8s timeout with partial output fallback
- Caches results by `toolName:input` key to avoid duplicate calls
- `sanitizeOutput()` handles JSON-stream format, plain text, and quoted strings

## Mutual Exclusion

All display modes (Normal, Summary, Visual Progress, Detailed Diff) are mutually exclusive:
- Selected via a 4-position slider in `VitalsInfoPanel.tsx`
- The slider sets all 3 boolean flags atomically (only the selected mode is true, others false)
- All 3 messages (`setVpmEnabled`, `setSummaryModeEnabled`, `setDetailedDiffViewEnabled`) are sent to persist in VS Code config

## Store State

```typescript
// Types
type ToolCategory = 'reading' | 'writing' | 'editing' | 'searching' | 'executing'
  | 'delegating' | 'planning' | 'skill' | 'deciding' | 'researching';

interface VisualProgressCard {
  id: string;
  category: ToolCategory;
  toolName: string;
  description: string;
  aiDescription?: string;
  filePath?: string;
  command?: string;
  pattern?: string;
  timestamp: number;
  isStreaming: boolean;
}

// State fields
vpmEnabled: boolean;           // false by default
visualProgressCards: VisualProgressCard[];

// Actions
setVpmEnabled(enabled: boolean)
addVisualProgressCard(card)     // upsert: update if same ID exists
updateCardDescription(cardId, description)
clearVisualProgressCards()
```

Cards are cleared when a brand new session starts (in `setSession` action).

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `claudeMirror.visualProgressMode` | `false` | Enable VPM side panel |
| `claudeMirror.vpmAiDescriptions` | `true` | Enable Haiku AI description enrichment |

## CSS Animations

- `vpm-card-enter`: Slide-in from left with bounce easing (0.5s)
- `vpm-dot-pulse`: Streaming dots animation (1.4s loop)
- Category-colored left border on each card
- Connector arrows between cards in the timeline

---

# Merged from SUMMARY_MODE.md

# Summary Mode

Third display mode for assistant messages. When enabled, the chat area splits into two halves: a large animated visualization panel (50% width, full height) on the left, and messages (text only, tool blocks hidden) on the right.

## Key Design Decisions

- **Full-height side panel**: Animation occupies 50% of chat width and full height (not a small widget)
- **Session-fixed animation**: Animation type (0-4) randomly chosen once per session, persists until reset
- **Continuous progression**: Each tool call visibly advances the animation (1 tool = 1 visual element). Full progress reached at ~50 tool calls
- **Persists across sessions**: `summaryModeEnabled` survives session reset (like `detailedDiffEnabled`)
- **Text blocks preserved**: Only tool_use/tool_result blocks are hidden; text blocks render normally in the messages column

## Architecture

When summary mode is enabled:
```
chat-area-wrapper.sm-split-layout (flex row)
  |-- sm-side-panel (50% width, full height)
  |     |-- SummaryModeDisplay (animation fills container)
  |           |-- AnimComponent (SVG, 300x500 viewBox, responsive)
  |-- MessageList (50% width, text-only messages)
```

`SummaryModeWidget` is rendered as a sibling of `MessageList` inside `chat-area-wrapper` (not above InputArea).

## Files

### New Files
| Path | Purpose |
|------|---------|
| `src/webview/components/ChatView/SummaryMode/SummaryModeWidget.tsx` | Persistent session-level side panel widget |
| `src/webview/components/ChatView/SummaryMode/SummaryModeDisplay.tsx` | Animation selector + container (no text) |
| `src/webview/components/ChatView/SummaryMode/animations/shared.ts` | `getProgress()`, `PALETTE`, `AnimationProps`, viewbox constants |
| `src/webview/components/ChatView/SummaryMode/animations/BuildingBlocks.tsx` | Brick wall building from bottom up, each tool = one brick |
| `src/webview/components/ChatView/SummaryMode/animations/ProgressPath.tsx` | Winding mountain trail with checkpoints, path reveals progressively |
| `src/webview/components/ChatView/SummaryMode/animations/PuzzleAssembly.tsx` | 6x8 jigsaw puzzle assembling from center outward |
| `src/webview/components/ChatView/SummaryMode/animations/RocketLaunch.tsx` | Rocket ascending from ground through atmosphere to deep space |
| `src/webview/components/ChatView/SummaryMode/animations/GrowingTree.tsx` | Tree growing trunk, branches, leaves, fruits; birds on completion |

### Modified Files
| Path | Change |
|------|--------|
| `package.json` | `claudeMirror.summaryMode` boolean setting |
| `src/extension/types/webview-messages.ts` | Message interfaces for summary mode toggle/settings |
| `src/webview/state/store.ts` | `summaryModeEnabled`, `sessionAnimationIndex`, `sessionToolCount` state + actions |
| `src/webview/hooks/useClaudeStream.ts` | Handles summary mode messages; increments tool count on `toolActivity` |
| `src/extension/webview/MessageHandler.ts` | `sendSummaryModeSetting()`, ready handler, toggle, config watcher |
| `src/webview/App.tsx` | Split layout when summary mode enabled; widget inside chat-area-wrapper |
| `src/webview/components/ChatView/MessageBubble.tsx` | Summary mode branch hides tool blocks, shows text only |
| `src/webview/components/Vitals/VitalsInfoPanel.tsx` | Display Mode slider (4-position: Normal, Summary, Visual, Diff) |
| `src/webview/styles/global.css` | Split layout CSS, animation keyframes |

## 5 Animation Types

| Index | Name | Visual |
|-------|------|--------|
| 0 | Building Blocks | Brick wall stacking bottom-up in offset rows (~120 bricks max) |
| 1 | Progress Path | Winding trail from bottom to top with 13 checkpoints |
| 2 | Puzzle Assembly | 6x8 jigsaw grid (48 pieces), center-outward fill order |
| 3 | Rocket Launch | Rocket rising, sky darkening to space, 40 stars appearing, exhaust trail |
| 4 | Growing Tree | Trunk, 12 branches, 19 leaves, 5 fruits, birds on completion |

## Progression Model

Continuous, not staged. `getProgress(toolCount)` returns 0.0-1.0 (full at 50 tools).

Each animation maps toolCount directly to visible elements:
- BuildingBlocks/PuzzleAssembly: `visible = min(toolCount, maxPieces)`
- ProgressPath: `dashOffset = pathLength * (1 - progress)`
- RocketLaunch: `rocketY = lerp(bottom, top, progress)`
- GrowingTree: trunk height, branches, leaves, fruits appear at specific progress thresholds

## Data Flow

1. Extension `MessageHandler` receives tool activity from CLI
2. Sends `toolActivity` message to webview (existing)
3. `useClaudeStream` calls `incrementSessionToolCount()` on each `toolActivity`
4. `SummaryModeWidget` reads `sessionToolCount` from store, passes to `SummaryModeDisplay`
5. Animation component renders based on current `toolCount`

## CSS Classes

All prefixed with `sm-`:
- Layout: `.sm-split-layout`, `.sm-side-panel`, `.sm-animation-fill`
- Shared: `.sm-glow-pulse` (completion glow)
- Building Blocks: `.sm-block-slide-in`
- Progress Path: `.sm-station-pulse`, `.sm-flag-wave`
- Puzzle: `.sm-puzzle-fly-in-{0-3}`
- Rocket: `.sm-rocket-flame`, `.sm-star-twinkle`
- Tree: `.sm-tree-grow`, `.sm-branch-grow`, `.sm-leaf-bud`, `.sm-leaf-sway`, `.sm-bird-fly`
