# Ultrathink Button & Glow Effect

Brain icon button in the input area that controls the `ultrathink` keyword injection to boost Claude's reasoning effort. The brain button keeps its **three-state cycle**: off -> single -> locked -> off. A separate **lock button sits above the brain button** as a direct shortcut into/out of `locked` mode. The word "ultrathink" also appears with an animated rainbow glow effect wherever it appears in chat messages.

## Three-State Cycle

| State | Visual | Behavior |
|-------|--------|----------|
| **Off** | Default (no glow) | No auto-injection. Click to activate for one prompt |
| **Single** | Subtle cyan glow | "ultrathink " prepended to the next send, then auto-resets to Off |
| **Locked** | Strong cyan glow + active lock button | "ultrathink " auto-prepended to every outgoing prompt |

Each click advances to the next state. To go from Single to Off, the user clicks twice (Single -> Locked -> Off).

When activating (Off -> Single), a random animation plays and "ultrathink " is prepended to the current textarea text. When transitioning to Locked, only the visual state changes (no animation). The lock button can also jump directly between Off/Single and Locked. When turning off from Locked, the "ultrathink " prefix is removed from the textarea if present.

The mode state is **persisted at project level** via VS Code's `workspaceState`. New tabs and reloads restore the mode automatically.

## Key Files

| File | Purpose |
|------|---------|
| `src/webview/components/InputArea/InputArea.tsx` | Brain button JSX, lock-toggle JSX, 3-state cycle handler, animation logic, reset on send |
| `src/webview/state/store.ts` | Zustand store: `ultrathinkMode` state + `setUltrathinkMode` setter |
| `src/webview/hooks/useClaudeStream.ts` | Receives `ultrathinkModeSetting` message from extension |
| `src/extension/webview/MessageHandler.ts` | Persists mode in `workspaceState`, sends on `ready`, migrates old boolean key |
| `src/extension/session/SessionTab.ts` | Wires `workspaceState` to MessageHandler |
| `src/extension/types/webview-messages.ts` | `SetUltrathinkModeRequest` + `UltrathinkModeSettingMessage` |
| `src/webview/components/ChatView/MarkdownContent.tsx` | Transforms "ultrathink" in rendered messages into `<span class="ultrathink-glow">` |
| `src/webview/components/ChatView/StreamingText.tsx` | Splits streaming text to render "ultrathink" with glow styling |
| `src/webview/styles/global.css` | Button styles, 4 animation keyframes, and `.ultrathink-glow` rainbow effect |

## How It Works

1. User sees two ultrathink controls in the vertical browse stack: a lock button on top and the brain button below it
2. Brain button state cycles: off -> single -> locked -> off
3. On Off -> Single: `handleUltrathink` picks a random animation from `['rocket', 'brain', 'wizard', 'turbo']`, plays it for 1.2s, then prepends `"ultrathink "` to textarea text
4. On Single -> Locked: Visual state changes only (stronger glow + lock button becomes active)
5. Clicking the lock button directly toggles `locked` on/off without waiting for the next brain-button cycle step
6. On Locked -> Off: Removes "ultrathink " prefix from textarea if present

## State

- `ultrathinkAnim`: Local React state in InputArea. `null` = idle (brain icon visible), `'rocket' | 'brain' | 'wizard' | 'turbo'` = animation playing
- `ultrathinkMode`: Zustand store state, persisted via `workspaceState` (project-level). `'off'` | `'single'` | `'locked'`

### Persistence Flow

1. User clicks either the brain button or the lock button -> `setUltrathinkMode(nextMode)` updates Zustand store
2. Simultaneously sends `{ type: 'setUltrathinkMode', mode }` to extension
3. `MessageHandler` persists to `workspaceState` key `'claui.ultrathinkMode'`
4. On webview `ready`, `MessageHandler.sendUltrathinkModeSetting()` reads from `workspaceState` and sends `{ type: 'ultrathinkModeSetting', mode }` to webview
5. `useClaudeStream` receives it and calls `setUltrathinkMode` in Zustand store

### Single-Use Reset

When the user sends a message while in `'single'` mode, after the message is dispatched, the mode is automatically reset to `'off'` (both in Zustand store and persisted via extension message).

### Backward Compatibility

`MessageHandler.sendUltrathinkModeSetting()` checks for the old boolean key `'claui.ultrathinkLocked'`. If found, it migrates the value (`true` -> `'locked'`, `false` -> `'off'`) to the new `'claui.ultrathinkMode'` key and deletes the old key.

## The 4 Animations

| Name | Emoji | Visual Effect | Keyframes |
|------|-------|---------------|-----------|
| Rocket Launch | Rocket | Flies upward with orange flame trail (pseudo-element) | `utRocketLaunch`, `utFlameTrail` |
| Brain on Fire | Brain | Pulses and glows with fiery orange drop-shadows | `utBrainFire`, `utBrainGlow` |
| Wizard Staff | Magic Wand | Rotates with purple lightning spark particles (box-shadow) | `utWizardCast`, `utSparks` |
| Turbo / NOS | Lightning | Shakes side-to-side with blue energy charge and speed lines | `utTurboIcon`, `utTurboCharge`, `utSpeedLine` |

All animations are pure CSS using transforms, opacity, filter, box-shadow, and pseudo-elements. No external resources - fully CSP-compatible.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Empty textarea + activate | Results in `"ultrathink "` (with trailing space) |
| Text already starts with `"ultrathink"` (case-insensitive) | Animation plays but text is not modified |
| Disconnected / not connected | Button is disabled |
| Double-click during animation | Guarded by `ultrathinkAnim` state check - second click is no-op |
| Undo after injection | Works - new text is pushed to `UndoManager` |
| Lock button click while in Off or Single | Jumps directly to Locked without animation |
| Single/Locked mode + text already starts with "ultrathink" | No double-prepend (case-insensitive check) |
| Single/Locked mode + empty text | Sends "ultrathink " (same as manual click on empty) |
| Turn off while "ultrathink " is in textarea | Prefix is removed from textarea |

## CSS Class Structure

```
.browse-stack                   - Vertical stack container (ultrathink on top, browse below)
.browse-stack .ultrathink-wrapper - Inline-flex wrapper scoped for stacked layout
.ultrathink-wrapper             - Inline-flex column wrapper for lock (top) + brain button (bottom)
.ut-lock-toggle                 - Small lock button above the brain button
.ut-lock-toggle.active          - Cyan-highlighted locked shortcut state
.ultrathink-button              - Base button (global default 32x32; compact in browse stack)
.ultrathink-button:hover        - VS Code hover background + focus border
.ultrathink-button:disabled     - Grayed out
.ultrathink-button.animating    - Blue border glow, pointer-events: none
.ultrathink-button.mode-single  - Subtle cyan glow (border + light box-shadow + background tint)
.ultrathink-button.mode-locked  - Strong cyan glow (border + prominent box-shadow + background tint)
  .ut-default-icon              - Brain emoji (hidden during animation via opacity: 0)
  .ultrathink-anim              - Absolute-positioned animation container (z-index: 50)
    .ultrathink-anim-rocket     - Rocket animation variant
    .ultrathink-anim-brain      - Brain fire animation variant
    .ultrathink-anim-wizard     - Wizard animation variant
    .ultrathink-anim-turbo      - Turbo animation variant
      .ut-emoji                 - The animated emoji element (font-size: 20px)
```

## JSX Structure

```tsx
<div className="ultrathink-wrapper">
  <button className={`ut-lock-toggle${ultrathinkMode === 'locked' ? ' active' : ''}`}
          onClick={handleUltrathinkLockToggle}
          disabled={!isConnected || !!ultrathinkAnim}
          data-tooltip="...">
    <svg>{/* locked / unlocked padlock icon */}</svg>
  </button>
  <button className={`ultrathink-button${ultrathinkAnim ? ' animating' : ''}${ultrathinkMode === 'single' ? ' mode-single' : ''}${ultrathinkMode === 'locked' ? ' mode-locked' : ''}`}
          onClick={handleUltrathink}
          disabled={!isConnected || !!ultrathinkAnim}
          data-tooltip="...">
    <span className="ut-default-icon">{brain emoji}</span>
    {ultrathinkAnim && (
      <div className={`ultrathink-anim ultrathink-anim-${ultrathinkAnim}`}>
        {/* Conditionally render the animation-specific emoji */}
      </div>
    )}
  </button>
</div>
```

## Glow Effect in Chat Messages

The word "ultrathink" is highlighted with an animated rainbow glow effect wherever it appears in chat messages (both user and assistant).

### How it works

- **Completed messages** (`MarkdownContent.tsx`): After Markdown is parsed and sanitized, a regex replaces `\bultrathink\b` (case-insensitive) with `<span class="ultrathink-glow">ultrathink</span>`. This happens in the `useMemo` that produces `sanitizedHtml`.
- **Streaming messages** (`StreamingText.tsx`): The plain-text `displayText` is split around "ultrathink" using `String.split()` with a capturing group. Matched segments are wrapped in `<span className="ultrathink-glow">`.

### CSS Effect (`.ultrathink-glow`)

| Property | Effect |
|----------|--------|
| `background: linear-gradient(90deg, ...)` with `background-size: 300%` | Rainbow color gradient that scrolls |
| `background-clip: text` + `-webkit-text-fill-color: transparent` | Colors applied to text only |
| `animation: utGlowShift 3s linear infinite` | Continuous color cycling |
| `::before` pseudo-element | Blurred gradient halo behind text |
| `::after` pseudo-element | Animated sparkle particles via `box-shadow` |
| `font-weight: 800` | Bold emphasis |

Keyframes:
- `utGlowShift` - Shifts `background-position` from 0% to 300% for continuous color flow
- `utSparkleParticles` - Animates box-shadow dots that fade in/out around the text

## Related Components

- **Browse Button** - Sits directly below Ultrathink in the same `browse-stack` (file picker)
- **Textarea** - Adjacent element to the right (receives the injected text)
- **UndoManager** - Text change is pushed to undo stack for Ctrl+Z support
- **MarkdownContent** - Renders glow in completed messages
- **StreamingText** - Renders glow in streaming messages
