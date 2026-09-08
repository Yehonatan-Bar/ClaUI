# Usage Limit Deferred Send

## Status

Active for the Claude provider path. Two related behaviors share one scheduler:

1. **Manual deferred send** — the user queues a prompt when Claude returns a usage-limit error; it is auto-sent one minute after reset.
2. **Auto-Continue on limit** — an opt-in Tools-menu toggle that, on detecting a session/usage limit, automatically queues a fixed continuation prompt (default `המשך`) with no user typing.

## User Experience

### Manual deferred send

When Claude returns a usage-limit reset message:

1. Input enters usage-limit mode.
2. Send button text changes to `Send When Available`.
3. Helper copy explains that the prompt can be queued now and auto-sent later.
4. User can send text-only or text+images; the prompt is queued per tab.
5. The queued prompt is auto-sent one minute after reset time.

### Auto-Continue on limit

1. Toggle `Auto-continue on limit` lives in the status-bar **Tools** dropdown (off by default).
2. When on and Claude reports a session/usage limit (e.g. `You've hit your session limit · resets 5pm (Asia/Jerusalem)`), the extension parses the reset time and automatically queues the continuation prompt.
3. The prompt is auto-sent one minute after reset (`resetAt + 60s`), reusing the deferred-send scheduler and 15s busy-retry.
4. If the post-reset send hits the limit again, detection re-arms with the new reset time — forming a persistent auto-continue loop until the session succeeds.
5. Toggling on while a limit is already active arms immediately; toggling off clears any auto-queued prompt.

## Scope

- Provider: Claude only.
- Queue size: one queued prompt per tab.
- Replacement policy: latest queued prompt wins (manual send or auto-continue).
- Schedule rule: `scheduledSendAt = resetAt + 60_000`.
- Retry rule: if still busy at fire time, retry every 15 seconds.

## Configuration

- `claudeMirror.autoContinueOnLimit.enabled` (boolean, default `false`) — the Tools-menu toggle.
- `claudeMirror.autoContinueOnLimit.prompt` (string, default `המשך`) — the auto-sent continuation text.

## Extension Implementation

### Usage-limit parsing

- File: `src/extension/process/usageLimitParser.ts`
- Entry point: `parseUsageLimitError(rawMessage, nowMs?)`
- Behavior:
- Detects usage-limit strings, including the session-limit banner form (`hit your … limit`, `session limit`) where `resets` is not adjacent to `limit`.
- Parses reset time from absolute datetime, time-only text (`5pm`, `5:30pm`), or relative duration.
- A bare-`resets <time>` fallback in `extractResetSegment` handles the banner form; it only runs when the stricter patterns miss, so legacy inputs are unaffected.
- Normalizes to a future timestamp and returns `{ resetAtMs, resetDisplay }`.
- Tests: `tests/process/usageLimitParser.test.ts` (`npm run test:usage-limit`).

### Auto-continue arming

- File: `src/extension/webview/MessageHandler.ts`
- `handleUsageLimitDetected()` calls `maybeAutoQueueContinuePrompt()`, which — when the toggle is on and provider is Claude — populates `queuedUsagePrompt` with the configured prompt and schedules it via the shared `scheduleQueuedUsageDispatch()` path.
- Secondary detection: the `assistantMessage` handler scans assistant text for the banner (guarded: only when the toggle is on and no limit is already armed), covering CLI builds that surface the limit as assistant text rather than a `result` error.
- Setting plumbing mirrors the review-loop toggle: `setAutoContinueOnLimit` request, `autoContinueOnLimitSetting` broadcast, sent on webview init.

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
- Webview -> extension messages: `queuePromptUntilUsageReset`, `setAutoContinueOnLimit`
- Extension -> webview messages: `usageLimitDetected`, `usageQueuedPromptState`, `autoContinueOnLimitSetting`

### State and event handling

- Files: `src/webview/state/store.ts`, `src/webview/hooks/useClaudeStream.ts`
- Zustand state: `usageLimit`, `usageQueuedPrompt`, `autoContinueOnLimit`
- Added setters and message handlers for the new extension events.
- State resets on session end/reset and when switching away from Claude.

### Tools-menu toggle

- File: `src/webview/components/StatusBar/StatusBar.tsx`
- `Auto-continue on limit` switch in the **Tools** dropdown (reuses the `review-loop-toggle` switch styling).
- On change: `setAutoContinueOnLimit(next)` + posts `setAutoContinueOnLimit` to the extension.

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
