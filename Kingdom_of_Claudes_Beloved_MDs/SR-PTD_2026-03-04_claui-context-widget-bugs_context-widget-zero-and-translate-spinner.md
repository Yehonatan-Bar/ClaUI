# SR-PTD - ClaUi Context Widget Bug Series + Translate Spinner Fix

**Date**: 2026-03-04 | **Type**: Bug Fix | **Domain**: ClaUi / Webview | **Complexity**: Medium

---

## Bug 1 (v0.1.76, COMMITTED): Context Widget Not Re-Rendering

### Trigger
> The floating context usage bar widget never updated after initial render. It always showed 0% even after Claude completed turns.

### Root Cause
`ContextUsageWidget` used a Zustand selector:
```typescript
const cost = useAppStore((s) => s.cost);
```
The `cost` object in the store was being mutated in place (or replaced with an equivalent reference), so Zustand's selector diffing decided nothing changed and never triggered a re-render.

### Fix Applied
Switched to polling `getState()` directly every 5 seconds:
```typescript
const [, setTick] = useState(0);
useEffect(() => {
  const id = setInterval(() => setTick((t) => t + 1), 5000);
  return () => clearInterval(id);
}, []);

const { inputTokens: rawIn } = useAppStore.getState().cost;
const model = useAppStore.getState().model;
```
Also simplified the widget from a large card (220px with labels) to a minimal 160x10px progress bar with tooltip only.

### Files Changed
- `src/webview/components/ContextWidget/ContextUsageWidget.tsx`

### Key Decision
**useAppStore selector vs getState() polling**: Zustand selectors are reactive but depend on immutable state updates. When unsure if state is being replaced immutably, polling with `getState()` is reliable, at the cost of a slight delay (5s max).

---

## Bug 2 (UNCOMMITTED -> FIXED): Context Widget Always Shows 0% (inputTokens Never Arrives)

### Trigger
> After the fix in v0.1.76, the widget now re-renders but still shows 0%. The bar never fills.

### Root Cause Evolution (3 Rounds)

**Round 1 (Initial)**: `costUpdate` used `success.usage?.input_tokens` which was often `undefined`.

**Round 2 (Three-layer fix)**: Added fallback chain capturing `input_tokens` from `message_start`, `assistant`, and `result` events. This fixed the data flow but the widget **still showed 0%**.

**Round 3 (The real root cause - Cache Tokens)**: Log analysis revealed the actual runtime data:
```json
"usage": {
  "input_tokens": 3,
  "cache_creation_input_tokens": 19121,
  "cache_read_input_tokens": 20499
}
```

The Anthropic API splits input tokens into **three categories**:
| Field | Meaning | Typical Value |
|-------|---------|---------------|
| `input_tokens` | Non-cached tokens | 1-5 (tiny!) |
| `cache_creation_input_tokens` | Tokens written to prompt cache | Thousands |
| `cache_read_input_tokens` | Tokens read from prompt cache | Thousands |

**Real context usage** = `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`

The code only read `input_tokens` (the non-cached portion, typically 1-5), so the percentage was `5/200000 = 0.0025%` - effectively invisible.

### Fix Applied (Third Round - Cache Token Summation)
Updated all three token sources to sum ALL token types:

**1. StreamDemux** (`src/extension/process/StreamDemux.ts`):
```typescript
private handleMessageStart(event: MessageStart): void {
  this.currentMessageId = event.message.id;
  const usage = event.message.usage;
  const totalInputTokens = (usage?.input_tokens ?? 0)
    + (usage?.cache_creation_input_tokens ?? 0)
    + (usage?.cache_read_input_tokens ?? 0);
  this.emit('messageStart', {
    messageId: event.message.id,
    model: event.message.model,
    inputTokens: totalInputTokens || undefined,
  });
}
```

**2. MessageHandler - assistant event** (`src/extension/webview/MessageHandler.ts`):
```typescript
const assistUsage = event.message.usage;
if (assistUsage) {
  const totalAssistInput = (assistUsage.input_tokens ?? 0)
    + (assistUsage.cache_creation_input_tokens ?? 0)
    + (assistUsage.cache_read_input_tokens ?? 0);
  if (totalAssistInput > 0) {
    this.lastAssistantInputTokens = totalAssistInput;
  }
}
```

**3. MessageHandler - result event** (`src/extension/webview/MessageHandler.ts`):
```typescript
const resultTotalInput = (success.usage?.input_tokens ?? 0)
  + (success.usage?.cache_creation_input_tokens ?? 0)
  + (success.usage?.cache_read_input_tokens ?? 0);
const resolvedInputTokens = resultTotalInput || this.lastAssistantInputTokens;
```

### Files Changed
- `src/extension/types/stream-json.ts` (added `usage` with cache fields to `MessageStart`)
- `src/extension/process/StreamDemux.ts` (sum all token types in `messageStart` emit)
- `src/extension/webview/MessageHandler.ts` (sum all token types in both `assistant` and `result` handlers)
- `src/extension/session/SessionTab.ts` (diagnostic logging)

### Key Insight
**Anthropic API cache tokens are the majority of context usage**: With prompt caching enabled (default for Claude Code), `input_tokens` only represents the tiny non-cached portion (1-5 tokens). The real context consumption is in `cache_creation_input_tokens` + `cache_read_input_tokens`. Any feature measuring context usage MUST sum all three fields.

---

## Bug 3 (UNCOMMITTED): Translate Loading Spinner Stuck After Manual Translation

### Trigger
> After using the manual translate feature in the input area, the loading spinner kept spinning indefinitely. The translated text appeared in the box correctly, but the UI was stuck in "translating" state.

### Root Cause
In `InputArea.tsx`, the manual translate path set the translated text but forgot to clear the translating state:
```typescript
// Missing line before setText:
// useAppStore.getState().setIsTranslatingPrompt(false);  <-- WAS ABSENT
setText(translated);
```

### Fix Applied
Added the missing state clear before updating the textarea content:
```typescript
useAppStore.getState().setIsTranslatingPrompt(false);
setText(translated);
undoMgr.push(translated, translated.length);
```

### Files Changed
- `src/webview/components/InputArea/InputArea.tsx`

---

## Key Patterns From This Session

### Pattern 1: Zustand Selector vs getState() Polling
- **Problem**: Selector-based subscriptions may silently fail if state isn't replaced immutably
- **Diagnostic**: If a React component doesn't re-render after store updates, suspect selector diffing
- **Solution**: Poll `getState()` with `setInterval` if immediate reactivity isn't critical (acceptable for display widgets with <10s latency)

### Pattern 2: CLI Event Paths Are Mode-Dependent
- **Problem**: `assistant` type events only fire during session resume, NOT during live streaming
- **Rule**: For live-session data, consume from `stream_event` -> `message_start` (which wraps the Anthropic API's streaming response including `usage`)
- **Rule**: For session-resume data, consume from `assistant` events (complete messages with `usage`)
- **Pattern**: Track values from BOTH paths in a shared member variable, use as fallback chain in downstream consumers

### Pattern 3: Anthropic API Cache Tokens Are the Real Context Usage
- **Problem**: `input_tokens` alone is only the non-cached portion (1-5 tokens with prompt caching)
- **Rule**: Total context = `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`
- **Diagnostic**: If a context/token metric shows near-zero values, check if cache tokens are being ignored
- **Pattern**: Always sum all three token fields when measuring actual context window consumption

### Pattern 4: CLI Event Fields Are Not Guaranteed
- **Problem**: `result.usage.input_tokens` often undefined even when tokens were used
- **Rule**: Never rely on a single CLI event as the sole source of truth for any field
- **Pattern**: Build a fallback chain: `message_start.usage` -> `assistant.usage` -> `result.usage`

### Pattern 5: State Cleanup After Async Operations
- **Problem**: Loading state set to `true` before async op, never set to `false` on completion
- **Prevention**: When adding a loading flag, immediately write both the `set(true)` and `set(false)` lines, then fill in the async code between them

---

## Skill Potential
**Score**: Medium-High (16/25)
- Frequency: 4 (CLI event path confusion will recur for any new feature consuming streaming data)
- Consistency: 3 (similar pattern each time)
- Complexity: 4 (non-obvious dual event paths, requires understanding CLI internals)
- Codifiability: 3 (clear rules emerging)
- Tool-ability: 2 (no reusable scripts)

**Notes**: The CLI dual-event-path pattern is critical knowledge for any future feature that consumes live streaming data. Should be documented in the ClaUi skill and TECHNICAL.md.

---

## Tags
**Languages**: TypeScript, React
**Frameworks/Libs**: Zustand, VS Code Webview API, Anthropic Streaming API
**Domain**: webview, state management, token tracking, CLI event parsing
**Task Pattern**: bug fix, state sync, async cleanup, event path tracing
**Systems Touched**: MessageHandler, StreamDemux, MessageStart type, ContextUsageWidget, InputArea, SessionTab
