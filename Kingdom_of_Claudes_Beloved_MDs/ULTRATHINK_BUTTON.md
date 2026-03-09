# Ultrathink Button & Glow Effect

Brain icon button in the input area that injects the `ultrathink` keyword to boost Claude's reasoning effort for the next turn. Plays a randomly-chosen CSS animation on each click for visual flair. The word "ultrathink" also appears with an animated rainbow glow effect wherever it appears in chat messages.

Includes a **lock toggle** (small lock badge at bottom-right of the brain button). When locked, "ultrathink " is automatically prepended to every outgoing prompt without needing to click the brain button each time. The brain button shows a persistent cyan glow while locked.

The lock state is **persisted at project level** via VS Code's `workspaceState`. When the user locks ultrathink in any session tab, it remains locked across all sessions in that project until explicitly unlocked. New tabs and reloads restore the lock state automatically.

## Key Files

| File | Purpose |
|------|---------|
| `src/webview/components/InputArea/InputArea.tsx` | Button JSX, lock toggle handler, animation logic |
| `src/webview/state/store.ts` | Zustand store: `ultrathinkLocked` state + `setUltrathinkLocked` setter |
| `src/webview/hooks/useClaudeStream.ts` | Receives `ultrathinkLockedSetting` message from extension |
| `src/extension/webview/MessageHandler.ts` | Persists lock in `workspaceState`, sends on `ready` |
| `src/extension/session/SessionTab.ts` | Wires `workspaceState` to MessageHandler |
| `src/extension/types/webview-messages.ts` | `SetUltrathinkLockedRequest` + `UltrathinkLockedSettingMessage` |
| `src/webview/components/ChatView/MarkdownContent.tsx` | Transforms "ultrathink" in rendered messages into `<span class="ultrathink-glow">` |
| `src/webview/components/ChatView/StreamingText.tsx` | Splits streaming text to render "ultrathink" with glow styling |
| `src/webview/styles/global.css` | Button styles, 4 animation keyframes, and `.ultrathink-glow` rainbow effect |

## How It Works

1. User clicks the brain button (between browse/paperclip and textarea)
2. `handleUltrathink` picks a random animation from `['rocket', 'brain', 'wizard', 'turbo']`
3. Sets `ultrathinkAnim` state to the chosen animation name
4. CSS animation plays for 1.2 seconds via conditional class `ultrathink-anim-{name}`
5. After 1.2s timeout: prepends `"ultrathink "` to textarea text, clears animation state, resizes textarea, focuses and places cursor at end

## State

- `ultrathinkAnim`: Local React state in InputArea. `null` = idle (brain icon visible), `'rocket' | 'brain' | 'wizard' | 'turbo'` = animation playing
- `ultrathinkLocked`: Zustand store state, persisted via `workspaceState` (project-level). `false` = manual mode, `true` = auto-inject on every send

### Persistence Flow (Lock)

1. User toggles lock -> `setUltrathinkLocked(next)` updates Zustand store
2. Simultaneously sends `{ type: 'setUltrathinkLocked', locked }` to extension
3. `MessageHandler` persists to `workspaceState` key `'claui.ultrathinkLocked'`
4. On webview `ready`, `MessageHandler.sendUltrathinkLockedSetting()` reads from `workspaceState` and sends `{ type: 'ultrathinkLockedSetting', locked }` to webview
5. `useClaudeStream` receives it and calls `setUltrathinkLocked` in Zustand store

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
| Empty textarea | Results in `"ultrathink "` (with trailing space) |
| Text already starts with `"ultrathink"` (case-insensitive) | Animation plays but text is not modified |
| Disconnected / not connected | Button is disabled |
| Double-click during animation | Guarded by `ultrathinkAnim` state check - second click is no-op |
| Undo after injection | Works - new text is pushed to `UndoManager` |
| Lock active + text already starts with "ultrathink" | No double-prepend (case-insensitive check) |
| Lock active + empty text | Sends "ultrathink " (same as manual click on empty) |

## CSS Class Structure

```
.ultrathink-wrapper             - Inline-flex container for brain button + lock badge
.ultrathink-button              - Base button (32x32, matches browse-button pattern)
.ultrathink-button:hover        - VS Code hover background + focus border
.ultrathink-button:disabled     - Grayed out
.ultrathink-button.animating    - Blue border glow, pointer-events: none
.ultrathink-button.locked       - Persistent cyan glow (border + box-shadow + background tint)
  .ut-default-icon              - Brain emoji (hidden during animation via opacity: 0)
  .ultrathink-anim              - Absolute-positioned animation container (z-index: 50)
    .ultrathink-anim-rocket     - Rocket animation variant
    .ultrathink-anim-brain      - Brain fire animation variant
    .ultrathink-anim-wizard     - Wizard animation variant
    .ultrathink-anim-turbo      - Turbo animation variant
      .ut-emoji                 - The animated emoji element (font-size: 20px)
.ut-lock-toggle                 - Lock badge (16x16 circle, absolute bottom-right of wrapper)
.ut-lock-toggle.active          - Cyan highlight when locked
```

## JSX Structure

```tsx
<div className="ultrathink-wrapper">
  <button className={`ultrathink-button${ultrathinkAnim ? ' animating' : ''}${ultrathinkLocked ? ' locked' : ''}`}
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
  <button className={`ut-lock-toggle${ultrathinkLocked ? ' active' : ''}`}
          onClick={() => setUltrathinkLocked(prev => !prev)}
          data-tooltip="...">
    <svg>{/* locked/unlocked padlock icon */}</svg>
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

- **Browse Button** - Adjacent button to the left (file picker)
- **Textarea** - Adjacent element to the right (receives the injected text)
- **UndoManager** - Text change is pushed to undo stack for Ctrl+Z support
- **MarkdownContent** - Renders glow in completed messages
- **StreamingText** - Renders glow in streaming messages
