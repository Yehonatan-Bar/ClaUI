# Skill Usage Visual Indicator

Three-layer visual indicator system that highlights when Claude invokes the Skill tool. Uses magenta (`#e040fb`) as the accent color across all layers, consistent with the `'skill'` turn category.

## Layer 1: SkillBadge (Message Stream)

When a `tool_use` block targets the Skill tool, the block renders with a distinctive magenta-accented card instead of the default tool block style.

- **File**: `src/webview/components/ChatView/ToolUseBlock.tsx`
- **Detection**: `toolName === 'Skill' || toolName.endsWith('__Skill')` (handles both direct and MCP-prefixed tool names)
- **CSS class**: `.skill-tool` applied to `.tool-use-block`
- **Header**: Magenta left-gradient background (`linear-gradient(90deg, rgba(224, 64, 251, 0.08) 0%, transparent 60%)`) with a 3px magenta left border
- **Skill name chip**: `.skill-name-chip` -- rounded pill displaying the invoked skill name, magenta text on translucent magenta background with 1px border, `border-radius: 10px`, font-size 11px
- **Streaming label**: Shows "invoking..." while the tool call is still streaming
- **Name extraction**: `extractSkillName()` parses the `skill` field from either the resolved `input` object or the raw `partialInput` JSON string (regex fallback: `/"skill"\s*:\s*"([^"]+)"/ `)

## Layer 2: Skill Pills (Above Input Toolbar)

Animated magenta pills appear above the input toolbar (above the Clear, attachment, and brain buttons). Skills accumulate across the session -- each unique skill invoked gets its own pill that persists for the rest of the session.

- **File**: `src/webview/components/InputArea/InputArea.tsx`
- **Container**: `.skill-pills-row` -- flex row with wrap, gap 6px, padding 4px 8px
- **Pill class**: `.skill-pill` -- inline-flex pill with translucent magenta background, 1px magenta border, border-radius 12px, max-width 160px (truncates with ellipsis)
- **Glowing dot**: `.skill-pill-dot` -- 6px magenta circle with `box-shadow` glow, animated via `skill-dot-glow` keyframes (2s infinite ease-in-out, shadow pulses between 4px and 8px spread)
- **Border animation**: `skill-pill-pulse` keyframes (2s infinite, border-color oscillates between 35% and 70% opacity)
- **Content**: Each pill displays a skill name from `sessionSkills` array in Zustand store
- **Tooltip**: `data-tooltip="Skill: {name}"`
- **Lifecycle**:
  - **Appears**: When `toolUseStart` fires with `toolName === 'Skill'` or `toolName.endsWith('__Skill')`, a pending flag is set; once `toolUseInput` streams the skill name, `addSessionSkill(name)` adds it (deduped)
  - **Persists**: Pills remain visible for the entire session
  - **Disappears**: `sessionSkills` resets to `[]` on `endSession`, `clearStreaming`, and `reset` actions

## Layer 3: Turn Category Integration

The `'skill'` turn category integrates into the existing Session Vitals system.

- **Color**: `#e040fb` (magenta) -- defined in `CATEGORY_COLORS` (SessionTimeline, dashboardUtils) and `INTENSITY_COLORS` (MessageBubble)
- **Label**: `'Skill'` -- defined in `CATEGORY_LABELS` (SessionTimeline) and `catLabels` (MessageBubble)

### Where it appears:

| Component | Effect |
|-----------|--------|
| **Session Timeline** | Magenta-colored segments for turns that used the Skill tool |
| **Intensity Borders** | Magenta left border on assistant messages from skill turns (width varies: 2px/3px/4px by tool count) |
| **Dashboard Charts** | Magenta in category distribution charts |
| **Weather Algorithm** | `'skill'` is classified as a productive category (same weight as `code-write`, `research`, `command`, `success`) |

### Turn Categorization Priority

In both `categorizeTurn()` (extension-side, `MessageHandler.ts`) and `categorizeTurnFromToolNames()` (webview-side, `turnVitals.ts`):

```
error > discussion (no tools) > skill > code-write > command > research > success
```

Skill takes precedence over code-write, command, and research. If a turn uses both Skill and Write tools, it is categorized as `'skill'`.

## State Management

### Zustand Store (`store.ts`)

| Field | Type | Purpose |
|-------|------|---------|
| `sessionSkills` | `string[]` | Accumulated skill names invoked during the session |
| `addSessionSkill` | `(name: string) => void` | Adds a skill name (deduped -- skips if already present) |

Resets to `[]` in: `endSession`, `clearStreaming`, `reset`.

### Stream Hook (`useClaudeStream.ts`)

- `toolUseStart`: Detects Skill tool, sets `pendingSkillExtraction = true` (module-level flag)
- `toolUseInput`: When pending, extracts skill name from streaming partial JSON via `extractSkillNameFromPartial()`, then calls `addSessionSkill(name)` and clears the pending flag
- `extractSkillNameFromPartial()`: Tries `JSON.parse()` first, falls back to regex match on `"skill": "..."` pattern

## CSS Details

All styles in `src/webview/styles/global.css`.

### Classes

| Class | Purpose |
|-------|---------|
| `.tool-use-block.skill-tool` | Magenta left border + gradient background on skill tool blocks |
| `.tool-use-block.skill-tool .tool-use-header` | Light text color for header |
| `.skill-name-chip` | Rounded magenta pill showing the skill name in the tool block |
| `.skill-pills-row` | Flex container for accumulated skill pills above input toolbar |
| `.skill-pill` | Animated pill in the skill pills row |
| `.skill-pill-dot` | Glowing magenta dot inside each pill |

### Animations

| Keyframe | Duration | Effect |
|----------|----------|--------|
| `skill-pill-pulse` | 2s infinite | Border color oscillates (35% -> 70% -> 35% opacity) |
| `skill-dot-glow` | 2s infinite | Box-shadow spread pulses (4px -> 8px -> 4px) |

### RTL Support

`src/webview/styles/rtl.css` flips `.skill-name-chip` margin (left -> right) under `[dir="rtl"]`. The skill pills row uses flex with gap, which auto-reverses in RTL.

## Key Files

| File | Role |
|------|------|
| `src/extension/types/webview-messages.ts` | `'skill'` in `TurnCategory` union type |
| `src/extension/webview/MessageHandler.ts` | `categorizeTurn()` -- `'Skill'` tool detection, priority above code-write |
| `src/webview/state/store.ts` | `sessionSkills` array + `addSessionSkill` action + lifecycle resets |
| `src/webview/hooks/useClaudeStream.ts` | Skill detection in `toolUseStart`, name extraction from `toolUseInput`, `pendingSkillExtraction` flag |
| `src/webview/components/InputArea/InputArea.tsx` | Layer 2: skill pills row rendering above input toolbar |
| `src/webview/components/ChatView/ToolUseBlock.tsx` | Layer 1: SkillBadge rendering, `extractSkillName()`, `.skill-tool` class |
| `src/webview/components/ChatView/MessageBubble.tsx` | `'skill'` in `INTENSITY_COLORS` + `catLabels` |
| `src/webview/components/Vitals/SessionTimeline.tsx` | `'skill'` in `CATEGORY_COLORS` + `CATEGORY_LABELS` |
| `src/webview/utils/turnVitals.ts` | `'Skill'` detection in webview-side category function |
| `src/webview/components/Dashboard/dashboardUtils.ts` | `'skill'` in dashboard `CATEGORY_COLORS` |
| `src/webview/styles/global.css` | All skill indicator CSS |
| `src/webview/styles/rtl.css` | RTL margin override for `.skill-name-chip` |
