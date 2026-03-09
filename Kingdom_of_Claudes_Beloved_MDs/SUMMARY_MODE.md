# Summary Mode

Third display mode for assistant messages. When enabled, the chat area splits into two halves: a large animated visualization panel (50% width, full height) on the left, and messages (text only, tool blocks hidden) on the right.

## Key Design Decisions

- **Full-height side panel**: Animation occupies 50% of chat width and full height (not a small widget)
- **Session-fixed animation**: Animation type (0-4) randomly chosen once per session, persists until reset
- **Continuous progression**: Each tool call visibly advances the animation (1 tool = 1 visual element). Full progress reached at ~50 tool calls
- **Toggle persists**: `summaryModeEnabled` survives session reset (like `detailedDiffEnabled`)
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
| `src/webview/components/Vitals/VitalsInfoPanel.tsx` | Summary Mode toggle row |
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
