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
| `src/webview/components/Vitals/VitalsInfoPanel.tsx` | Added VPM toggle with mutual exclusion vs Summary Mode |
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

VPM and Summary Mode are mutually exclusive:
- Enabling VPM disables Summary Mode (and vice versa)
- Enforced in `VitalsInfoPanel.tsx` toggle handlers
- Both send `setVpmEnabled`/`setSummaryMode` messages to persist in VS Code config

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
