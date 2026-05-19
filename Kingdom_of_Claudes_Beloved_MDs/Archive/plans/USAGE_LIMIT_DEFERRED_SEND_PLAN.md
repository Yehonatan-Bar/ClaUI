# Usage Limit Deferred Send - Execution Plan (Archived)

> Implemented on **March 11, 2026**.  
> Current state snapshot: `Kingdom_of_Claudes_Beloved_MDs/USAGE_LIMIT_DEFERRED_SEND.md`

## Goal

When Claude returns:

`Claude usage limit reached. Your limit will reset at [Time]`

the input UX should switch into a "queue" mode:

1. Send button label changes to **`Send When Available`**.
2. A helper message explains that the user can send now and the prompt will be auto-sent after reset.
3. If the user sends, the prompt is queued and automatically sent **1 minute after reset time**.

## UX Copy (English)

- Send button: `Send When Available`
- Helper text (under input): `Usage limit reached. You can send now; your prompt will be queued and sent automatically one minute after your limit resets.`
- Queued confirmation: `Prompt queued for 3:01 PM.`
- If user sends again while queued: `Queued prompt updated. The latest prompt will be sent at 3:01 PM.`

## Scope (V1)

- Provider: Claude path only.
- Queue size: one queued prompt per tab (latest prompt wins).
- Delay rule: `scheduledSendAt = resetAt + 60_000`.
- Supports both text-only and image prompts (reuse existing send paths).

## Architecture Changes

### 1. Message Contract (`src/extension/types/webview-messages.ts`)

Add webview -> extension request:

- `queuePromptUntilUsageReset`
  - payload: `{ text: string; images?: WebviewImageData[] }`

Add extension -> webview messages:

- `usageLimitDetected`
  - payload: `{ active: boolean; resetAtMs?: number; resetDisplay: string; rawMessage: string }`
- `usageQueuedPromptState`
  - payload: `{ queued: boolean; scheduledSendAtMs?: number; summary?: string }`

### 2. Usage-Limit Detection (Extension)

Primary detection point:

- `src/extension/webview/MessageHandler.ts` in `result` error branch (already receives `ResultError.error`).

Add parser utility:

- New file: `src/extension/process/usageLimitParser.ts`

Parser responsibilities:

- Detect usage-limit message patterns.
- Extract reset time from text.
- Produce `resetAtMs` (absolute epoch).
- Fallback strategy:
  - If absolute datetime exists in message -> use directly.
  - If only time exists (e.g., `3pm`) -> infer next occurrence in local timezone.
  - If parse fails -> keep current behavior (error only, no queue mode).

### 3. Queue Scheduler (Extension, tab-local)

In `MessageHandler` add state:

- `usageLimitActive: boolean`
- `usageLimitResetAtMs: number | null`
- `queuedUsagePrompt: { text: string; images?: WebviewImageData[] } | null`
- `queuedUsageTimer: ReturnType<typeof setTimeout> | null`

Flow:

1. On detected usage-limit error:
   - set usage-limit state
   - post `usageLimitDetected` to webview
2. On `queuePromptUntilUsageReset`:
   - store/replace queued prompt
   - schedule timer for `resetAtMs + 1 minute`
   - post `usageQueuedPromptState`
3. When timer fires:
   - if process is busy, retry every 15s until idle
   - send prompt via existing paths (`sendText` / `sendWithImages`)
   - post optimistic `userMessage`, `processBusy: true`
   - clear queued state and notify webview

### 4. Webview State (`src/webview/state/store.ts`)

Add fields:

- `usageLimit: { active: boolean; resetAtMs: number | null; resetDisplay: string; rawMessage: string | null }`
- `usageQueuedPrompt: { queued: boolean; scheduledSendAtMs: number | null; summary: string | null }`

Add setters:

- `setUsageLimitState(...)`
- `setUsageQueuedPromptState(...)`

### 5. Webview Event Handling (`src/webview/hooks/useClaudeStream.ts`)

Handle new messages:

- `usageLimitDetected`
- `usageQueuedPromptState`

and update Zustand via new setters.

### 6. Input UI (`src/webview/components/InputArea/InputArea.tsx`)

Behavior changes:

- Derive `isUsageLimitMode = usageLimit.active && provider === 'claude'`.
- In usage-limit mode:
  - send button label -> `Send When Available`
  - tooltip updated to queue behavior
  - helper text rendered near input
- `sendMessage()` branching:
  - if usage-limit mode: post `queuePromptUntilUsageReset` instead of immediate `sendMessage`
  - keep prompt history insertion behavior
  - clear input after queue request succeeds

### 7. Styling (`src/webview/styles/global.css`)

Add small info UI styles:

- `.usage-limit-helper`
- `.usage-limit-queued-chip` (optional line showing scheduled time)

Use existing VS Code theme variables (no hardcoded palette drift).

## Edge Cases

- If reset time is in the past when parsed -> schedule next day at that time.
- If user queues multiple prompts -> latest replaces previous queued prompt.
- If user clears session -> clear queued prompt and timer.
- If provider switches away from Claude -> clear usage-limit queue state.
- If post-reset send still receives usage-limit error -> re-enter limit mode with new reset time (no silent loop).

## Implementation Steps

1. Add message types and compile.
2. Implement `usageLimitParser.ts` and unit-test parser logic (table-driven cases).
3. Add MessageHandler queue state + timer lifecycle + cleanup on clear/reset/dispose.
4. Add Zustand state and `useClaudeStream` handlers.
5. Update InputArea label/tooltips/helper + queue-send branch.
6. Add CSS for helper/queued indicator.
7. Manual QA matrix below.

## Manual QA Matrix

1. Limit detection:
   - Inject error text and verify button changes to `Send When Available`.
2. Queue behavior:
   - Send prompt in limit mode and verify queued confirmation appears.
3. Auto-dispatch timing:
   - Verify dispatch occurs at `resetAt + 1m`.
4. Replace queued prompt:
   - Queue prompt A, then prompt B; only B should send.
5. Busy-at-fire:
   - Keep process busy at fire time; confirm retry and eventual send.
6. Clear session:
   - Queue prompt, clear session, verify no delayed send occurs.
7. Provider switch:
   - Queue under Claude, switch provider, verify queue cleared.

## Acceptance Criteria

- Usage-limit message automatically activates queue mode UI.
- Send button label becomes `Send When Available`.
- User sees clear helper text that prompt can be sent now and will be auto-sent after reset.
- Queued prompt dispatches automatically one minute after reset.
- No duplicate sends, no stale timers after clear/reset/dispose.
