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
6. Keep it concise (1.5-3x original length)
7. Match the language of the original prompt (Hebrew stays Hebrew)
8. Output only the enhanced text, no meta-commentary

Input is truncated to 4000 characters. Timeout is 30 seconds.

## UX Flows

### Manual Enhancement (with Comparison Panel)
1. User types prompt, clicks the sparkles button (or Ctrl+Shift+E)
2. Textarea dims with "Enhancing..." overlay, button spins
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

If enhancement fails (`prompt-enhance-failed` event) and auto-send was pending, the original text is sent as fallback.

## CSS Components

- `.enhance-button-group` - flex container for the split button
- `.enhance-button` - sparkles icon, spins when enhancing, blue border when auto mode active
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

## Keyboard Shortcut

`Ctrl+Shift+E` triggers manual enhancement (same as clicking the sparkles button).
