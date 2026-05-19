# Prompt Enhancer

AI-powered prompt rewriting that improves user prompts before sending them to Claude. Uses a one-shot CLI call with a meta-prompt that applies advanced prompt engineering techniques (scaffolding, structure, context cues) while preserving original intent and language.

## Key Files

| File | Purpose |
|------|---------|
| `src/extension/session/PromptEnhancer.ts` | Backend service - spawns one-shot `claude -p` CLI process |
| `src/extension/webview/MessageHandler.ts` | Routes `enhancePrompt` / `setAutoEnhance` / `setEnhancerModel` messages |
| `src/extension/session/SessionTab.ts` | Wires PromptEnhancer into the per-tab MessageHandler |
| `src/webview/components/InputArea/InputArea.tsx` | UI: enhance button, gear popover, auto-enhance intercept |
| `src/webview/hooks/useClaudeStream.ts` | Dispatches `enhancePromptResult` and `promptEnhancerSettings` to store |
| `src/webview/state/store.ts` | Zustand state: `isEnhancing`, `autoEnhanceEnabled`, `enhancerModel`, `enhancerPopoverOpen`, `enhanceComparisonData` |
| `src/webview/styles/global.css` | CSS for button group, popover, overlay, animations |
| `src/extension/types/webview-messages.ts` | 5 message types (3 webview->ext, 2 ext->webview) |

## Architecture

Follows the same one-shot CLI pattern as `SessionNamer`, `MessageTranslator`, and `TurnAnalyzer`:

```
InputArea (click/auto)
  -> postToExtension({ type: 'enhancePrompt', text, model })
  -> MessageHandler routes to PromptEnhancer.enhance()
  -> PromptEnhancer spawns `claude -p --model <model>`
  -> Pipes meta-prompt + user text to stdin
  -> Returns enhanced text via postMessage({ type: 'enhancePromptResult' })
  -> useClaudeStream dispatches CustomEvent('prompt-enhanced')
  -> InputArea listener shows comparison panel (or auto-sends if auto mode)
```

## Enhancement System Prompt

The meta-prompt instructs Claude to:
1. Preserve original intent exactly
2. Improve clarity, specificity, and structure
3. Add scaffolding (acceptance criteria, step-by-step approach, edge cases)
4. Use structured formatting (numbered steps, bullet points)
5. Add context cues ("Think step by step", "Consider edge cases")
6. Keep it concise (1.5-2x original length; for long prompts >1000 chars, focus on restructuring not expanding)
7. Match the language of the original prompt (Hebrew stays Hebrew)
8. Output only the enhanced text, no meta-commentary

Input is truncated to 3000 characters (with `[...truncated]` marker). Backend timeout is 60 seconds. Client-side safety timeout is 65 seconds (resets `isEnhancing` if backend result never arrives).

## UX Flows

### Manual Enhancement (with Comparison Panel)
1. User types prompt, clicks the sparkles button (or Ctrl+Shift+E)
2. Textarea dims with "Enhancing..." overlay (shows elapsed seconds for long prompts), button spins
3. Comparison panel appears above the input area showing both original and enhanced text
4. User reviews both versions, clicks "Use Enhanced" or "Use Original"
5. Selected text is placed in the textarea, comparison panel closes
6. User clicks Send

The comparison panel:
- Shows original (read-only) and enhanced (read-only, dashed accent border) text stacked vertically
- Each text area supports RTL auto-detection and has max-height 150px with scroll
- Escape key dismisses the panel (keeps original)
- Send button is disabled while the comparison panel is open

### Auto Enhancement
1. User enables auto-enhance via the gear popover toggle
2. Enhance button shows blue accent border (visual indicator)
3. User clicks Send -> enhancement runs automatically (pulsing border + overlay)
4. After enhancement completes, the enhanced text is auto-sent
5. If enhancement fails, the original text is sent as fallback

### Gear Popover
- Click gear icon -> popover appears above button group with pop-in animation
- Toggle: "Auto-enhance" on/off switch (persisted to VS Code settings)
- Dropdown: Model selector (Haiku / Sonnet 4.6 / Sonnet 4.5 / Opus 4.6)
- Click outside -> popover dismisses

## Message Protocol

### Webview -> Extension
- `enhancePrompt` - `{ text: string, model?: string }` - triggers enhancement
- `setAutoEnhance` - `{ enabled: boolean }` - persists toggle to config
- `setEnhancerModel` - `{ model: string }` - persists model to config

### Extension -> Webview
- `enhancePromptResult` - `{ success: boolean, enhancedText?: string, error?: string }`
- `promptEnhancerSettings` - `{ autoEnhance: boolean, enhancerModel: string }` - sent on ready + config change

## Zustand State

| Field | Type | Default | Persists across reset? |
|-------|------|---------|----------------------|
| `isEnhancing` | boolean | false | No (cleared on reset) |
| `autoEnhanceEnabled` | boolean | false | Yes |
| `enhancerModel` | string | `'claude-sonnet-4-6'` | Yes |
| `enhancerPopoverOpen` | boolean | false | No (cleared on reset) |
| `enhanceComparisonData` | `{ originalText, enhancedText } \| null` | null | No (cleared on reset) |

## VS Code Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `claudeMirror.promptEnhancer.autoEnhance` | boolean | false | Auto-enhance prompts before sending |
| `claudeMirror.promptEnhancer.model` | string | `claude-sonnet-4-6` | Model used for enhancement |

## Auto-Send Race Condition Handling

The auto-enhance flow uses `autoSendAfterEnhanceRef` (a React ref, not state) to track whether Send was intercepted. When the `prompt-enhanced` CustomEvent fires:
- If `autoSendAfterEnhanceRef.current` is true: the enhanced text is auto-sent immediately, textarea is cleared (no comparison panel)
- If false: the comparison panel is shown with both original and enhanced text for user review

The original text is captured in `originalTextBeforeEnhanceRef` when `handleEnhancePrompt()` fires.

If enhancement fails (`prompt-enhance-failed` event) and auto-send was pending, the original text is sent as fallback. In manual mode, the enhance button flashes red for 2 seconds (`.enhance-error` CSS class) to indicate failure.

## CSS Components

- `.enhance-button-group` - flex container for the split button
- `.enhance-button` - sparkles icon, spins when enhancing, blue border when auto mode active, `.enhance-error` flashes red on failure
- `.enhance-gear-button` - gear icon, opens popover
- `.enhance-popover` - absolute-positioned settings panel with pop-in animation
- `.textarea-container.enhancing` - dims textarea, shows pulsing border + overlay
- `.enhance-toggle-btn` / `.enhance-toggle-knob` - toggle switch (matches VitalsInfoPanel pattern)
- `.enhance-model-select` - compact model dropdown
- `.enhance-comparison-panel` - comparison card above input area (pop-in animation)
- `.enhance-comparison-header` - title bar with close button
- `.enhance-comparison-section` - vertical section for each text (original / enhanced)
- `.enhance-comparison-text` - read-only scrollable text area, `.enhanced` variant has dashed accent border
- `.enhance-comparison-btn` - action buttons: `.original` (ghost) and `.enhanced` (primary)

## Reliability Safeguards

### Client-Side Safety Timeout
A 65-second timeout in InputArea resets `isEnhancing` to false if the backend never sends `enhancePromptResult`. This prevents the UI from getting permanently stuck in "Enhancing..." state. Both the manual enhance and auto-enhance paths set this timeout, and both the `prompt-enhanced` and `prompt-enhance-failed` event handlers clear it.

### Elapsed Time Progress
An interval counter shows elapsed seconds in the overlay. For long prompts (>1000 chars), it immediately shows "Enhancing long prompt... Ns". For shorter prompts, elapsed seconds appear after 5 seconds of waiting. The timer is cleaned up on success, failure, and safety timeout.

### Stdin Backpressure Handling
The stdin write to the child process checks the return value of `write()`. If the buffer is full (`false` return), it waits for the `drain` event before calling `end()`. This prevents data loss on Windows with large prompts containing multi-byte characters (e.g., Hebrew).

### Enhanced Error Logging
stderr output is accumulated in a buffer and included in all error, timeout, and empty-result log messages to aid debugging.

### Windows Process Kill
On Windows with `shell: true`, `child.kill('SIGTERM')` only kills the `cmd.exe` wrapper, leaving the actual `claude` CLI process orphaned. PromptEnhancer uses `taskkill /F /T /PID` (same pattern as ClaudeProcessManager) to kill the entire process tree on timeout.

### Error Feedback
- Auto-enhance failure: falls back to sending the original text (user doesn't notice)
- Manual enhance failure: enhance button flashes red for 2 seconds via `.enhance-error` CSS class

## Keyboard Shortcut

`Ctrl+Shift+E` triggers manual enhancement (same as clicking the sparkles button).

---

# Merged from ULTRATHINK_BUTTON.md

# Ultrathink Button & Glow Effect

Brain icon button in the input area that injects the `ultrathink` keyword to boost Claude's reasoning effort for the next turn. Plays a randomly-chosen CSS animation on each click for visual flair. The word "ultrathink" also appears with an animated rainbow glow effect wherever it appears in chat messages.

Includes a **lock toggle** (small lock button above the brain button inside the browse stack). When locked, "ultrathink " is automatically prepended to every outgoing prompt without needing to click the brain button each time. The brain button shows a persistent cyan glow while locked.

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

1. User clicks the brain button (top item in the vertical browse stack, above browse/paperclip)
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
.browse-stack                   - Vertical stack container (ultrathink on top, browse below)
.browse-stack .ultrathink-wrapper - Inline-flex wrapper scoped for stacked layout
.ultrathink-wrapper             - Inline-flex column for lock (top) + brain button (bottom)
.ultrathink-button              - Base button (global default 32x32; compact in browse stack)
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
.ut-lock-toggle                 - Lock button (global default absolute badge; compact static top button in browse stack)
.ut-lock-toggle.active          - Cyan highlight when locked
```

## JSX Structure

```tsx
<div className="ultrathink-wrapper">
  <button className={`ut-lock-toggle${ultrathinkLocked ? ' active' : ''}`}
          onClick={() => setUltrathinkLocked(prev => !prev)}
          data-tooltip="...">
    <svg>{/* locked/unlocked padlock icon */}</svg>
  </button>
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
