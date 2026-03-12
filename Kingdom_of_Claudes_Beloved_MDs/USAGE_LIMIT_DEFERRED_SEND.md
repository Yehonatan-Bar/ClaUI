# Usage Limit Deferred Send

## Status

Implemented on **March 11, 2026**.

This feature is active for the Claude provider path and lets users queue a prompt when Claude returns a temporary usage-limit error.

## User Experience

When Claude returns a usage-limit reset message:

1. Input enters usage-limit mode.
2. Send button text changes to `Send When Available`.
3. Helper copy explains that the prompt can be queued now and auto-sent later.
4. User can send text-only or text+images; the prompt is queued per tab.
5. The queued prompt is auto-sent one minute after reset time.

## Scope (V1)

- Provider: Claude only.
- Queue size: one queued prompt per tab.
- Replacement policy: latest queued prompt wins.
- Schedule rule: `scheduledSendAt = resetAt + 60_000`.
- Retry rule: if still busy at fire time, retry every 15 seconds.

## Extension Implementation

### Usage-limit parsing

- File: `src/extension/process/usageLimitParser.ts`
- Entry point: `parseUsageLimitError(rawMessage, nowMs?)`
- Behavior:
- Detects usage-limit strings.
- Parses reset time from absolute datetime, time-only text, or relative duration.
- Normalizes to a future timestamp and returns `{ resetAtMs, resetDisplay }`.

### Queue scheduler and lifecycle

- File: `src/extension/webview/MessageHandler.ts`
- State:
- usage-limit active flag and reset timestamp
- queued prompt payload (text + optional images)
- scheduled fire time and timer handle
- Flow:
1. In the `result` error branch, usage-limit errors activate queue mode.
2. `queuePromptUntilUsageReset` stores/replaces the prompt and schedules a timer.
3. At fire time, prompt is sent through existing `sendText`/`sendWithImages` paths.
4. If blocked (assistant turn/approval state), retry is scheduled after 15 seconds.
- Cleanup:
- clears usage-limit and queue state on `startSession`, `stopSession`, `resumeSession`, `forkSession`, `clearSession`, `editAndResend`
- clears state when provider changes away from Claude
- clears state after successful Claude result

## Webview Implementation

### Message contract

- File: `src/extension/types/webview-messages.ts`
- Added webview -> extension message: `queuePromptUntilUsageReset`
- Added extension -> webview messages: `usageLimitDetected`, `usageQueuedPromptState`

### State and event handling

- Files: `src/webview/state/store.ts`, `src/webview/hooks/useClaudeStream.ts`
- Added Zustand state: `usageLimit`, `usageQueuedPrompt`
- Added setters and message handlers for the new extension events.
- State resets on session end/reset and when switching away from Claude.

### Input UI behavior

- File: `src/webview/components/InputArea/InputArea.tsx`
- Usage-limit mode condition: `usageLimit.active && provider === 'claude'`
- In usage-limit mode:
- send action posts `queuePromptUntilUsageReset` instead of immediate send
- input and images clear after queue request
- helper text and queued summary chip are shown
- send label becomes `Send When Available`
- placeholder and tooltip switch to queue copy

### Styling

- File: `src/webview/styles/global.css`
- Added `.usage-limit-helper` and `.usage-limit-queued-chip`.

## Notes

- This feature does not change Codex/Remote provider behavior.
- If a post-reset send still hits usage limit, the next error re-enters usage-limit mode with the new reset time.
