# Global Tooltip System

## What It Does

A single, unified tooltip system for the entire ClaUi webview. Replaces scattered native browser `title` attributes with a styled, VS Code-themed tooltip that appears on hover over any element with a `data-tooltip` attribute.

## Why It Exists

Previously, tooltips were inconsistent: some elements used native `title` (plain, unstyled, OS-dependent), many had no tooltip at all, and there was no unified approach. This system provides a consistent, themed experience across all interactive elements.

## Architecture: Hybrid Event Delegation + React Portal

```
Document event delegation (mouseover/mouseout/scroll, capture phase)
   |
   v
Find closest [data-tooltip] ancestor via element.closest()
   |
   v
Start 400ms timer --> Calculate position --> Show tooltip via React state
   |
   v
Portal renders <div role="tooltip"> at document.body with CSS transitions
```

- **Zero per-component overhead** -- just add `data-tooltip="text"` to any element
- **React rendering** for position state management and smooth transitions
- **Automatic pickup of dynamically added elements** (no registration needed)

## Key Files

| File | Purpose |
|------|---------|
| `src/webview/components/Tooltip/GlobalTooltip.tsx` | Core tooltip component (~160 lines) |
| `src/webview/styles/global.css` | Tooltip CSS (`.global-tooltip` class, ~20 lines at end) |
| `src/webview/App.tsx` | Mounts `<GlobalTooltip delay={400} />` before closing `</div>` |

## Behaviors

| Behavior | Detail |
|----------|--------|
| Hover delay | 400ms (configurable via `delay` prop) |
| Position | Centered above trigger, 6px gap. Flips to bottom if near top edge. Tall triggers (>100px) anchor near mouse cursor |
| Horizontal shift | Stays within viewport with 8px margin |
| Post-render adjust | After tooltip renders, measures actual size and repositions if overflowing |
| Hide triggers | mouseout, scroll (any scrollable ancestor), new mouseover on different element |
| Accessibility | `role="tooltip"`, `id="claui-global-tooltip"`, dynamic `aria-describedby` on trigger |
| Touch guard | Skips all listeners if touch device detected |
| CSS transitions | 150ms opacity + transform for smooth fade in/out |

## CSS Theming

Uses VS Code theme variables for consistent appearance:

```css
background: var(--vscode-editorWidget-background, #252526);
border: 1px solid var(--vscode-editorWidget-border, #454545);
color: var(--vscode-editorWidget-foreground, #cccccc);
```

Fixed position, z-index 10000, max-width 320px, 4px 8px padding, 4px border-radius, 11px font-size.

## Migrated Components

All component files use `data-tooltip` instead of `title`:

- `App.tsx` - Error banner dismiss, WelcomeScreen buttons, SessionEndedBar buttons
- `StatusBar/StatusBar.tsx` - All 14+ status bar items (collapsed and expanded modes)
- `InputArea/InputArea.tsx` - Send, cancel, clear, file browse, history, enhancer buttons
- `ChatView/MessageBubble.tsx` - Copy, edit, fork, translate buttons
- `ChatView/CodeBlock.tsx` - Copy, expand/collapse toggle
- `ChatView/MessageList.tsx` - Scroll-to-bottom button
- `ChatView/PromptHistoryPanel.tsx` - Close button, prompt items
- `ChatView/ToolUseBlock.tsx` - Click to expand/collapse header
- `ChatView/PlanApprovalBar.tsx` - Question option descriptions
- `ModelSelector/ModelSelector.tsx` - Model dropdown, active label
- `PermissionModeSelector/PermissionModeSelector.tsx` - Mode dropdown
- `ProviderSelector/ProviderSelector.tsx` - Provider dropdown
- `TextSettingsBar/TextSettingsBar.tsx` - Toggle, size controls, close
- `Vitals/WeatherWidget.tsx` - Weather mood label
- `Vitals/VitalsInfoPanel.tsx` - Close, reset buttons
- `Vitals/AdventureWidget.tsx` - Adventure status tooltip
- `InputArea/GitPushPanel.tsx` - Close, send buttons
- `InputArea/CodexConsultPanel.tsx` - Close, send buttons
- `Achievements/AchievementPanel.tsx` - Info, community, share, settings, close buttons
- `Achievements/AchievementToastStack.tsx` - Dismiss button
- `Achievements/ShareCard.tsx` - Copy markdown, copy badge buttons
- `Achievements/CommunityPanel.tsx` - Publish, open profile, disconnect, refresh, compare, remove buttons
- `Dashboard/DashboardPanel.tsx` - Settings, close buttons
- `Dashboard/tabs/CommandsTab.tsx` - Full command text on truncated rows
- `Dashboard/charts/SemanticWidgets.tsx` - Mood timeline circles
- `SkillGen/SkillGenPanel.tsx` - Close, generate buttons
- `StatusBar/StatusBarGroupButton.tsx` - Dropdown toggle label

## Intentional Exclusions

| File | Reason |
|------|--------|
| `ChatView/MarkdownContent.tsx` | Generates HTML strings via `marked` renderer, not JSX |
| `ChatView/filePathLinks.tsx` | Functional "Ctrl+Click to open" titles during streaming |
| `SessionTimeline.tsx` | Per-segment tooltips use their own inline system; the container has a `data-tooltip` for the overall legend |
| Recharts `<Tooltip>` components | Entirely different chart data tooltip system |

## Usage

To add a tooltip to any element:

```tsx
<button data-tooltip="Descriptive text here">Click me</button>
```

Dynamic tooltips work too:

```tsx
<button data-tooltip={isActive ? 'Disable feature' : 'Enable feature'}>Toggle</button>
```

No imports, no wrapping components, no registration needed.

## Tall Trigger Anchoring

Elements taller than 100px (e.g., `.session-timeline`) use mouse-cursor-based positioning instead of element-center positioning. When the tooltip timer fires, a synthetic 20px-tall `DOMRect` is created at the mouse's Y position. This prevents the tooltip from being positioned off-screen when the trigger spans the full viewport height.

## Intensity Border Zone

The `.intensity-border-zone` is a thin (10px) absolutely-positioned div on the left edge of assistant messages. It carries a `data-tooltip` explaining the border color/width meaning. This avoids showing the tooltip when hovering anywhere on the message body.

## Multiline Tooltip Text

Tooltips support `\n` for line breaks via `white-space: pre-wrap` in CSS. Use this for detailed explanatory tooltips (e.g., color legends, feature descriptions).
