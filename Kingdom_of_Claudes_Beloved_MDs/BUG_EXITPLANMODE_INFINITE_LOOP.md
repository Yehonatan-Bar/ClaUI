# Bug: ExitPlanMode Infinite Loop & Approval Bar Visibility

## Summary

The plan approval bar (4 CLI-matching options) and AskUserQuestion interactive controls must be visible to the user when the model calls `ExitPlanMode` or `AskUserQuestion`. The CLI runs with `bypassPermissions` and auto-approves these tools, so the extension must detect them via stream events and show the UI independently.

**Date First Fixed**: 2026-02-23
**Date Second Fix**: 2026-02-23
**Date Third Fix**: 2026-02-24 (approval bar visibility)
**Date Fourth Fix**: 2026-02-25 (stuck Thinking after plan approval)
**Date Fifth Fix**: 2026-02-26 (approve click can be no-op if CLI did not auto-resume)
**Date Seventh Fix**: 2026-03-01 (approve click no-op when CLI auto-resumed with brief text and went idle)
**Date Eighth Fix**: 2026-03-02 (typed text bypasses exitPlanModeProcessed guard)
**Date Ninth Fix**: 2026-03-02 (exitPlanModeProcessed not reset after context compaction)
**Date Tenth Fix**: 2026-03-02 (stale suppression deadlock after post-approval execution)
**Date Eleventh Fix**: 2026-03-03 (infinite reopen loop from unbounded Bug 10 re-open logic + deeper logging)
**Date Twelfth Fix**: 2026-03-04 (stale approval bar persists during execution - display-only)
**Date Thirteenth Fix**: 2026-03-04 (approval bar auto-dismissed by 5s timer before user can interact)
**Date Fourteenth Fix**: 2026-03-05 (approve click no-op when CLI auto-resumed AND completed - resumeObserved masks idle state)
**Severity**: Critical (blocks plan mode workflow)
**Files Modified**: `src/extension/webview/MessageHandler.ts`, `src/webview/hooks/useClaudeStream.ts`, `src/webview/components/InputArea/InputArea.tsx`

---

## Current Architecture

### Why the CLI auto-approves

ClaUI spawns the CLI with permission settings that auto-approve all tools:
- **Full-access mode** (`ClaudeProcessManager.ts:70`): `--permission-mode bypassPermissions`
- **Supervised mode** (`ClaudeProcessManager.ts:73-74`): `--allowedTools` list that includes both `AskUserQuestion` and `ExitPlanMode`

This means the CLI NEVER pauses for plan approval or user questions. The model calls the tool, the CLI auto-approves, and the model continues immediately.

### How ClaUI shows approval UI anyway

The extension detects these tools via CLI stream events and shows its own approval bar:

1. **Detection** (MessageHandler.ts): `messageDelta` with `stopReason === 'tool_use'` checks `currentMessageToolNames` for approval tools. Fallback: `assistantMessage` scans content blocks.
2. **Notification**: Posts `planApprovalRequired` to webview with `toolName`
3. **UI** (PlanApprovalBar.tsx): Shows 4 options for ExitPlanMode, or question options for AskUserQuestion
4. **Response** (MessageHandler.ts): Handles user choice - side effects only for ExitPlanMode, text to CLI for AskUserQuestion

---

## Bug History

### Original Bug (2026-02-23): Infinite Loop

**Cause**: The extension sent `"Yes, proceed with the plan."` as a user message to CLI stdin. Since the CLI had already auto-approved, this created a spurious conversation turn causing the model to call ExitPlanMode again.

**Fix**: Made approve actions close the bar without sending text.

### Recurrence (2026-02-23): Five Overlapping Issues

1. **Guard reset on `messageStart`**: Reset `pendingApprovalTool` and `approvalResponseProcessed`, allowing late events to re-trigger
2. **`assistantMessage` fallback re-trigger**: After guards were cleared, fallback detection re-showed the bar
3. **Stale approval bar**: `processBusy: false` didn't clear bar in webview
4. **User text routed as feedback**: Sent text via `control.sendText()` causing the loop
5. **No `planModeActive` guard**: Re-triggers happened even after ExitPlanMode was processed

**Fix**: Added `exitPlanModeProcessed` flag, cleared bar on `messageStart`, blocked ALL ExitPlanMode text to CLI.

### Third Bug (2026-02-24): Approval Bar Never Visible

**Cause**: The second fix's `messageStart` clearing was too aggressive. The CLI auto-approves ExitPlanMode and immediately starts the next turn. The `messageStart` handler cleared the approval bar before the user could see it:

```
planApprovalRequired -> bar shows -> messageStart (50ms later) -> bar cleared
```

Both ExitPlanMode and AskUserQuestion bars were affected (AskUserQuestion was replaced by ExitPlanMode bar before being cleared).

**Fix**:
1. **Removed `messageStart` clearing** in `useClaudeStream.ts` - approval bars now persist until user interaction
2. **Fixed InputArea text routing** - text typed during ExitPlanMode bar is sent as a regular message (not silently-dropped feedback)

### Fourth Bug (2026-02-25): Stuck "Thinking..." After Plan Approval

**Cause**: After clicking approve on the ExitPlanMode approval bar, `processBusy: true` was unconditionally sent to the webview (line 811). But for ExitPlanMode, no text is sent to the CLI (the CLI already auto-approved and moved on). By the time the user clicks approve, the CLI may have already finished implementing and sent `result` with `processBusy: false`. The new `processBusy: true` has no matching `processBusy: false`, leaving the webview permanently stuck showing "Thinking...".

**Symptoms**: After approving a plan, the UI shows only "Thinking..." indefinitely. Implementation messages (tool calls, text) may exist in the chat above the indicator but the user doesn't notice them because of the stuck indicator.

**Fix**: Skip sending `processBusy: true` for ExitPlanMode approval responses. Since no text is sent to the CLI, the session isn't becoming busy. The approval bar is already cleared by the webview component itself (`setPendingApproval(null)` in PlanApprovalBar.tsx).

### Fifth Bug (2026-02-26): Approve Click Does Nothing (No Auto-Resume)

**Cause**: In some sessions, clicking approve on the `ExitPlanMode` bar did not result in any further Claude activity. The extension correctly avoided sending `"Yes, proceed with the plan."` (to prevent the historical infinite loop), but in these cases the CLI also did not auto-resume, so the click became a no-op.

**Fix**: Keep the no-immediate-send behavior, but add a delayed fallback. After an `ExitPlanMode` approve click, the extension waits briefly for post-approval **meaningful activity** (e.g., `toolUseStart` or streamed text). If no progress is observed, it sends a single `"Yes, proceed with the plan."` nudge and sets `processBusy: true` at that moment only.

**Follow-up (2026-02-26, same fix cycle)**: `messageStart` / `result` alone were too weak as a resume signal; Claude can emit a short empty turn and `result/success` immediately after `ExitPlanMode` without starting implementation. The fallback logic was tightened to cancel only on real progress (`toolUseStart` / `textDelta`), preventing false "already resumed" decisions.

### Sixth Bug (2026-03-01): ExitPlanMode Feedback Silently Dropped

**Cause**: When the user selected option 4 (feedback/comment on the plan), the `planApprovalResponse` handler treated ALL ExitPlanMode actions identically -- closing the bar without sending text to the CLI. The feedback text was silently discarded. The UI showed as "done" (no busy indicator, no activity), and the user's feedback never reached Claude.

**Fix**: Carved out the feedback action from the ExitPlanMode "don't send text" block. For ExitPlanMode + feedback:
1. The feedback text IS sent to the CLI via `sendText()` (unlike approve which would loop)
2. An optimistic `userMessage` is posted to the webview so the user sees their feedback in the chat
3. `processBusy: true` is sent so the UI shows "Thinking..." while Claude processes
4. `exitPlanModeProcessed` is reset to `false` so a new ExitPlanMode cycle can trigger the approval bar after Claude revises the plan

**Why this doesn't cause the infinite loop**: The original loop was caused by sending "Yes, proceed with the plan." -- a message that made the model call ExitPlanMode again. Feedback provides actual user content ("change X in the plan") that directs the model to revise, not to re-approve.

### Seventh Bug (2026-03-01): Approve Click No-Op When CLI Auto-Resumed With Brief Text

**Cause**: After ExitPlanMode, the CLI auto-approved and the model started a new turn. But instead of implementing, the model only output a brief "The updated plan is ready for your review..." text and reached `result/success` (idle). The `textDelta` from this plan-presentation text was counted as "resume observed" (`pendingApprovalCycleResumeObserved = true`), and the subsequent `result/success` set `pendingApprovalCycleResultObserved = true`. The approval bar remained visible. When the user clicked approve (after reading the plan), `scheduleExitPlanApproveResumeFallback` checked:

```
if (resumeObserved || resultObserved) → skip
```

Both flags were true, so the fallback was skipped entirely. No text was sent to the CLI, no `processBusy:true` was posted. The click was a complete no-op while the CLI sat idle.

**Root cause**: The fallback logic treated "resumed + completed" the same as "actively working". But `resultObserved = true` means the CLI turn completed and the CLI is idle -- it NEEDS a nudge, not a skip.

**Fix**: Split the condition in `scheduleExitPlanApproveResumeFallback` into three cases:
1. `resultObserved` (CLI completed and idle) -> send proceed nudge immediately
2. `resumeObserved && !resultObserved` (CLI actively working) -> skip (don't interfere)
3. Neither flag set (no activity yet) -> schedule delayed fallback (existing behavior)

Also updated `markApprovalCycleResultObserved` to NOT cancel the fallback timer. The timer callback now checks `pendingApprovalCycleResultObserved` itself and sends the nudge if the CLI went idle during the wait.

**Why this doesn't cause the infinite loop**: The proceed nudge is only sent when the CLI is confirmed idle (`result/success` already received). The `exitPlanModeProcessed` flag prevents any subsequent ExitPlanMode call from showing a new approval bar, breaking the loop.

### Eighth Bug (2026-03-02): Typed Text Bypasses exitPlanModeProcessed Guard

**Cause**: When the user typed text (e.g., "Yes, proceed with the plan.") in the InputArea while the ExitPlanMode approval bar was visible, the text was sent as a regular `sendMessage` (line 347 of InputArea.tsx). The extension's `sendMessage` handler called `clearApprovalTracking()` but **never set `exitPlanModeProcessed = true`**. The button-click path sets this flag via the `planApprovalResponse` handler, but the typed-text path bypassed it entirely.

**Sequence**:
1. ExitPlanMode approval bar shown, `exitPlanModeProcessed = false`
2. User types text, InputArea sends `sendMessage`
3. `sendMessage` handler: `clearApprovalTracking()` clears `pendingApprovalTool` but `exitPlanModeProcessed` stays `false`
4. `messageStart`: resets `approvalResponseProcessed = false`, `pendingApprovalTool = null`
5. Model responds: calls TodoWrite, Bash (implementation) AND ExitPlanMode (spurious)
6. `notifyPlanApprovalRequired` checks `exitPlanModeProcessed` -> **false** -> notification fires
7. Approval bar re-appears -> loop

**Fix** (two parts):

1. **`sendMessage`/`sendMessageWithImages` handlers**: Before `clearApprovalTracking()`, check if `pendingApprovalTool` is ExitPlanMode. If so, set `planModeActive = false` and `exitPlanModeProcessed = true`. Also cancel any pending fallback timer. This ensures typed text has the same guard effect as clicking a button.

2. **Fallback nudge text**: Changed from `"Yes, proceed with the plan."` to `"Continue with the implementation."` across all fallback paths. The old text sounded like a plan approval message, which could confuse the model into calling ExitPlanMode again. The new text is a neutral implementation directive.

**Why this is the definitive fix**: The `exitPlanModeProcessed` flag was always the correct defense -- it was just never set in the typed-text code path. Now ALL paths that dismiss the ExitPlanMode approval bar (button clicks, typed text, images) set the flag, ensuring any subsequent ExitPlanMode calls from the model are suppressed regardless of how the user responded.

### Ninth Bug (2026-03-02): exitPlanModeProcessed Not Reset After Context Compaction

**Cause**: After a full plan cycle (EnterPlanMode -> ExitPlanMode -> user approves -> implementation), `exitPlanModeProcessed` is `true`. When the context is later compacted (user-initiated or via approve+compact), the CLI summarizes the conversation and the model may re-enter plan mode. After compaction, the model calls `ExitPlanMode` without first calling `EnterPlanMode` (because compaction strips the conversation history and the model doesn't "remember" it needs to call EnterPlanMode). The `notifyPlanApprovalRequired` guard checks `exitPlanModeProcessed` -> `true` -> suppresses the notification. The approval bar never shows and the model is permanently stuck in plan mode.

**Sequence**:
1. First plan cycle completes: `exitPlanModeProcessed = true`
2. Implementation proceeds, context grows
3. Context compaction requested (any trigger: user, approve+compact)
4. CLI compacts, model re-enters plan mode after compaction
5. Model calls `ExitPlanMode` (no `EnterPlanMode` first -- compaction lost that context)
6. `notifyPlanApprovalRequired`: `isExitPlanMode && this.exitPlanModeProcessed` -> `true` -> suppressed
7. Log: `"Suppressing stale ExitPlanMode notification - already processed in this plan cycle"`
8. Approval bar never shows. Model stuck in plan mode.

**Fix**: Added a `compactPending` flag to MessageHandler:
1. When compaction is requested (via `compact` webview message, ExitPlanMode `approveClearBypass`, or non-ExitPlanMode `approveClearBypass`), set `compactPending = true`
2. In the `messageStart` handler, if `compactPending` is true, reset `exitPlanModeProcessed = false` and `compactPending = false`
3. This ensures the first assistant turn after compaction gets a clean slate while late events from the pre-compaction turn are still suppressed

**Why the reset is safe**: The `compactPending` flag ensures the reset only happens on the FIRST `messageStart` after compaction, not immediately. Pre-compaction late events (which fire before `messageStart`) are still suppressed by `exitPlanModeProcessed = true`. The reset only takes effect when the CLI starts a new turn after compaction completes.

### Tenth Bug (2026-03-02): Stale Suppression Deadlock After Post-Approval Execution

**Cause**: After the user approved ExitPlanMode, the model could start real implementation work (e.g., `TodoWrite`, `Read`) and then call `ExitPlanMode` again. `notifyPlanApprovalRequired` always suppressed this because `exitPlanModeProcessed` was still `true`, assuming the call was stale. In this case it was not stale: the model had already progressed into execution and then re-entered plan mode. The suppression hid the approval bar and the model got stuck asking for approval with no UI action available.

**Fix**:
1. Added `postExitPlanNonPlanActivityObserved` to track concrete non-plan tool activity after ExitPlanMode was approved.
2. When non-plan tool activity is observed (and no approval bar is currently pending), mark the cycle as having post-approval execution.
3. In `notifyPlanApprovalRequired`, if `ExitPlanMode` arrives while `exitPlanModeProcessed=true` **and** post-approval execution was observed, treat it as a fresh cycle: reset the processed guard and show the approval bar instead of suppressing it.

**Why this is safe**: Truly stale replays still have no post-approval non-plan activity and remain suppressed. Only sessions that demonstrably moved into execution can re-open an ExitPlanMode approval cycle.

### Eleventh Bug (2026-03-03): Infinite Reopen Loop (Bug 10 Re-open Has No Limit)

**Cause**: Bug 10's fix detects post-approval non-plan activity and re-opens the ExitPlanMode approval cycle. But it has **no limit on how many times it can re-open**. If the model enters a pattern of: do some work -> call ExitPlanMode -> user approves -> do some work -> call ExitPlanMode again, the Bug 10 fix fires every time (because `postExitPlanNonPlanActivityObserved = true` after each round of work), creating an infinite loop of approval bars.

**Sequence**:
1. ExitPlanMode called -> approval bar shown
2. User approves -> `exitPlanModeProcessed = true`, `postExitPlanNonPlanActivityObserved = false`
3. Model calls TodoWrite (or other non-plan tool) -> `postExitPlanNonPlanActivityObserved = true`
4. Model calls ExitPlanMode again -> Bug 10 detects post-approval activity -> resets guard -> bar shown
5. User approves again -> cycle restarts at step 2
6. Steps 2-5 repeat indefinitely

**Root cause**: Bug 10's re-open logic was unbounded. Every round of {approve, do work, ExitPlanMode} qualified as a "fresh cycle", allowing infinite re-opens.

**Fix**:
1. Added `exitPlanModeReopenCount` counter to track how many times Bug 10's re-open logic fires
2. Added `MAX_EXITPLANMODE_REOPENS = 2` constant
3. In `notifyPlanApprovalRequired`, when Bug 10 would re-open: check `exitPlanModeReopenCount >= MAX_EXITPLANMODE_REOPENS`. If exceeded, suppress the notification instead of re-opening
4. Reset counter to 0 when `EnterPlanMode` is detected (legitimate new plan cycle), on compaction, or on session restart (edit-and-resend)

**Why this is safe**: The first 2 re-opens are still allowed (covers legitimate re-entries like context compaction or the model genuinely needing to re-plan). After 2 re-opens, the model is likely in a loop and further ExitPlanMode calls are suppressed. A fresh `EnterPlanMode` resets the counter, so if the model properly enters plan mode again, the approval bar will work normally.

**Deeper logging**: Added `logApprovalState()` diagnostic method that dumps ALL approval-related flags at key lifecycle moments (messageStart, messageDelta, result, sendMessage, planApprovalResponse, notifyPlanApprovalRequired). This makes future debugging much easier -- every state transition is captured in the Output -> ClaUi log.

### Twelfth Bug (2026-03-04): Stale Approval Bar Persists During Execution (Display-Only)

**Cause**: After ExitPlanMode was detected, the extension sent `planApprovalRequired` to the webview, which showed the approval bar and set `isBusy = false`. The CLI auto-approved and the model started a new turn, but the extension's `messageStart` handler only sent a `messageStart` event to the webview -- NOT `processBusy: true`. The webview's `messageStart` handler intentionally did NOT clear `pendingApproval` (Bug 3 fix). Since `processBusy: true` is only sent on user-initiated actions (sendMessage, planApprovalResponse), it was never sent during CLI auto-resume. Result: the approval bar stayed visible indefinitely while the model executed Steps 1-5+.

**Root cause**: The webview had no mechanism to auto-dismiss ExitPlanMode bars when the model moved on. The Bug 3 fix (don't clear on messageStart) was correct for preventing the bar from flashing too fast, but it left no fallback for when the user simply doesn't interact.

**Fix**: Added a 5-second delayed auto-dismiss timer in the webview's `messageStart` handler (`useClaudeStream.ts`):

1. When `messageStart` arrives while `pendingApproval` is set for ExitPlanMode, start a 5-second timer
2. When the timer fires, if the same `pendingApproval` object is still active (user didn't interact), clear it
3. Timer is cancelled when: user clicks a button (`processBusy` handler clears it), a new `planApprovalRequired` arrives, or the effect cleans up
4. Uses object reference comparison (`s.pendingApproval === ref`) to avoid clearing a different/newer approval bar
5. Only applies to ExitPlanMode bars, NOT AskUserQuestion (where the user's answer is content-meaningful)

**Why this is safe**: The timer only clears the bar if the EXACT same approval object is still active after 5 seconds. If the user clicks any button, `setPendingApproval(null)` is called (different reference). If a new `planApprovalRequired` arrives, the timer is cancelled explicitly. The 5-second window gives ample time for users to click an option, while ensuring stale bars don't persist indefinitely. AskUserQuestion bars are unaffected.

### Thirteenth Bug (2026-03-04): Approval Bar Auto-Dismissed Before User Can Interact

**Cause**: Bug 12's 5-second auto-dismiss timer cleared the ExitPlanMode approval bar while the user was still reading the plan. The CLI auto-approves ExitPlanMode and starts a new turn within ~50ms. The `messageStart` handler in the webview started a 5-second timer that auto-dismissed the bar. The user sees the options flash and disappear. Additionally, the `scheduleExitPlanApproveResumeFallback` checked `resultObserved` before `resumeObserved`, which could send a spurious "Continue with the implementation" nudge even when the CLI had already started new work after ExitPlanMode.

**Symptoms**: Plan mode options appear briefly (5 seconds) then vanish. The model continues with a summary of what it did. When the user sends a new prompt and the model calls ExitPlanMode at the END of its turn (no auto-resume), the bar stays and the user can interact -- confirming the timer was the cause.

**Fix** (two parts):

1. **Removed the 5-second auto-dismiss timer** from `useClaudeStream.ts` `messageStart` handler. The ExitPlanMode bar now persists until user interaction (clicking a button, typing a message, or a new `planApprovalRequired` replacing it). This reverts Bug 12's approach -- a persistent stale bar (cosmetic issue) is far preferable to an invisible bar (functional issue).

2. **Fixed priority in `scheduleExitPlanApproveResumeFallback`**: Check `resumeObserved` BEFORE `resultObserved`. If the CLI has shown post-ExitPlanMode activity (text or tool use from the auto-resumed turn), the model has already moved on. Sending a nudge at this point would inject a spurious user message mid-execution. The nudge is only sent when `resultObserved && !resumeObserved` (CLI completed ExitPlanMode turn but hasn't started new work). Same fix applied inside the delayed fallback timer callback.

**Why this is safe**: The bar is still cleared by all user-initiated actions: clicking approve/reject/feedback buttons (`PlanApprovalBar` calls `setPendingApproval(null)`), typing a message (`processBusy: true` clears `pendingApproval`), or a new `planApprovalRequired` replacing it. The `exitPlanModeProcessed` flag still prevents stale re-triggers. When the user clicks approve after the model has already completed execution, `scheduleExitPlanApproveResumeFallback` correctly skips the nudge (either `resumeObserved` is true, or the approval cycle state was already cleared by the post-ExitPlanMode turn's result handler).

### Fourteenth Bug (2026-03-05): Approve Click No-Op When CLI Auto-Resumed AND Completed

**Cause**: Bug 13's fix checked `resumeObserved` first and skipped the nudge when true, assuming the CLI was "actively working". But when the CLI auto-resumed with brief plan-summary text and then completed, BOTH `resumeObserved` and `resultObserved` were true. The code skipped the nudge (because `resumeObserved` was checked first), even though the CLI was idle. Neither `processBusy:true` nor a nudge text was sent. The user saw the approval bar disappear with no subsequent activity.

**Why both flags are true**: After ExitPlanMode is detected, `notifyPlanApprovalRequired` sets `pendingApprovalTool = 'ExitPlanMode'`. The CLI auto-approves, the ExitPlanMode turn completes (result -> `resultObserved = true`), and a new turn starts (`messageStart` clears `pendingApprovalTool = null`). During the new turn, text output (`textDelta`) calls `markApprovalCycleResumeObserved`, which now passes the `pendingApprovalTool` guard (because it's null) and sets `resumeObserved = true`. When the brief turn completes, the CLI goes idle. By the time the user clicks approve, both flags are true but the CLI is idle.

**Root cause**: `resumeObserved` and `resultObserved` are lifecycle flags that track what HAPPENED during the approval cycle, not the CLI's CURRENT state. When both are true, the CLI was working but has since finished. The Bug 13 priority (`resumeObserved` first) incorrectly treated this as "actively working".

**Fix**: Replaced the fragile `resumeObserved`/`resultObserved` logic in `scheduleExitPlanApproveResumeFallback` with a direct `inAssistantTurn` flag that tracks whether the CLI is between `messageStart` and `result` events:

1. **Added `inAssistantTurn` flag** to MessageHandler: set `true` on `messageStart`, `false` on `result`. This is a direct, real-time idle/busy indicator.

2. **Rewrote `scheduleExitPlanApproveResumeFallback`**:
   - If `!inAssistantTurn` (CLI idle): send nudge immediately
   - If `inAssistantTurn` (CLI busy): schedule a delayed check via `postApproveNudgeTimer`
   - Timer callback: if CLI went idle, send nudge; if still busy (implementing), skip

3. **Decoupled timer from approval cycle state**: The new `postApproveNudgeTimer` is separate from the existing `exitPlanApproveResumeFallbackTimer`. It is NOT cancelled by `clearApprovalCycleState()` (called by the result handler) or `markApprovalCycleResumeObserved()`. This prevents the result handler from prematurely cancelling the pending nudge. The timer is only cancelled by: user sending a message (`sendMessage`/`sendMessageWithImages`), a new approval bar appearing (`notifyPlanApprovalRequired`), or a non-approve ExitPlanMode response.

**Why this doesn't cause the infinite loop**: The `exitPlanModeProcessed` flag is still set when the user clicks approve (`markExitPlanModeProcessed` in `planApprovalResponse`). Any subsequent ExitPlanMode calls from the model after the nudge are suppressed by this flag. The nudge text ("Continue with the implementation.") is a neutral implementation directive, not an approval message.

---

## Current Defense Layers

| Layer | Location | What it prevents |
|-------|----------|------------------|
| `exitPlanModeProcessed` flag | MessageHandler.ts `notifyPlanApprovalRequired` | Stale re-triggers from late events/replays |
| Block ExitPlanMode approve/reject text to CLI | MessageHandler.ts `planApprovalResponse` | Spurious user messages for approve actions |
| ExitPlanMode feedback DOES send text to CLI | MessageHandler.ts `planApprovalResponse` | Feedback is real user content, not a loop risk |
| InputArea sends regular message (not feedback) | InputArea.tsx `sendMessage` | Text typed during ExitPlanMode goes as new user message, not dropped |
| `sendMessage` sets `exitPlanModeProcessed` | MessageHandler.ts `sendMessage` handler | Typed text bypassing the button-click guard (Bug 8 fix) |
| Skip `processBusy:true` for ExitPlanMode approve | MessageHandler.ts `planApprovalResponse` | Stuck "Thinking..." indicator after plan approval |
| Send `processBusy:true` for ExitPlanMode feedback | MessageHandler.ts `planApprovalResponse` | UI shows thinking while Claude processes feedback |
| `inAssistantTurn` flag for approve nudge | MessageHandler.ts `scheduleExitPlanApproveResumeFallback` | Approve click no-op: uses direct idle/busy check instead of fragile resumeObserved/resultObserved (Bug 14 fix) |
| `postApproveNudgeTimer` (decoupled from cycle state) | MessageHandler.ts `scheduleExitPlanApproveResumeFallback` | Delayed nudge survives result-handler cleanup (Bug 14 fix) |
| Neutral nudge text | MessageHandler.ts all fallback paths | Prevents model from associating nudge with plan approval |
| `compactPending` -> reset `exitPlanModeProcessed` on messageStart | MessageHandler.ts `messageStart` handler | Stuck plan mode after context compaction (Bug 9 fix) |
| `postExitPlanNonPlanActivityObserved` re-opens ExitPlanMode cycle after real execution | MessageHandler.ts `toolUseStart` + `notifyPlanApprovalRequired` | Deadlock where legitimate ExitPlanMode is suppressed as stale (Bug 10 fix) |
| `exitPlanModeReopenCount` limits Bug 10 re-opens to MAX_EXITPLANMODE_REOPENS | MessageHandler.ts `notifyPlanApprovalRequired` | Infinite reopen loop from unbounded Bug 10 logic (Bug 11 fix) |
| `logApprovalState()` diagnostic dumps at every lifecycle point | MessageHandler.ts throughout | Comprehensive state visibility for debugging (Bug 11 enhancement) |
| Persistent approval bar (no auto-dismiss) | useClaudeStream.ts `messageStart` handler | Bar stays until user interaction; reverts Bug 12's 5s timer (Bug 13 fix) |

The `messageStart` clearing was **removed** (Bug 3) and the auto-dismiss timer was **removed** (Bug 13). The bar now persists until user interaction.

---

## Key Code

### notifyPlanApprovalRequired (MessageHandler.ts)

```typescript
private notifyPlanApprovalRequired(toolName: string): void {
  if (this.pendingApprovalTool === toolName) return;
  if (this.approvalResponseProcessed) return;

  const norm = toolName.trim().toLowerCase();
  const isExitPlanMode = norm === 'exitplanmode' || norm.endsWith('.exitplanmode');
  if (isExitPlanMode && this.exitPlanModeProcessed) {
    if (this.postExitPlanNonPlanActivityObserved) {
      // Bug 11 fix: limit re-opens to prevent infinite loop
      if (this.exitPlanModeReopenCount >= MAX_EXITPLANMODE_REOPENS) {
        // Suppress - model is likely in a loop
        return;
      }
      this.exitPlanModeReopenCount++;
      this.resetExitPlanModeProcessed('post-approval non-plan activity detected');
    } else {
      return;
    }
  }

  this.log(`Plan approval required: tool=${toolName} cycle=${this.pendingApprovalCycleId}`);
  this.logApprovalState('showing-approval-bar');
  this.pendingApprovalTool = toolName;
  this.webview.postMessage({ type: 'planApprovalRequired', toolName });
}
```

### messageStart handler (useClaudeStream.ts)

```typescript
case 'messageStart': {
  // Do NOT clear ExitPlanMode approval bars here. The CLI auto-approves
  // ExitPlanMode and messageStart arrives ~50ms later. Clearing here
  // (Bug 3) or auto-dismissing with a timer (Bug 12) both cause the
  // bar to disappear before the user can interact.
  //
  // The bar persists until user interaction: clicking a button,
  // typing a message, or a new planApprovalRequired replacing it.
  handleMessageStart(msg.messageId, msg.model);
  break;
}
```

### InputArea text routing (InputArea.tsx)

```typescript
// AskUserQuestion: route as answer
if (pendingApproval.toolName === 'AskUserQuestion') {
  postToExtension({ type: 'planApprovalResponse', action: 'questionAnswer', ... });
}
// ExitPlanMode: clear bar, send as regular message
// (extension's sendMessage handler sets exitPlanModeProcessed=true)
else if (pendingApproval) {
  setPendingApproval(null);
  postToExtension({ type: 'sendMessage', text: trimmed });
}
```

### sendMessage handler - ExitPlanMode guard (MessageHandler.ts)

```typescript
case 'sendMessage':
  // If there was a pending ExitPlanMode approval, mark it as processed
  // so subsequent ExitPlanMode calls from the model are suppressed.
  if (this.pendingApprovalTool) {
    const pendingNorm = this.pendingApprovalTool.trim().toLowerCase();
    if (pendingNorm === 'exitplanmode' || pendingNorm.endsWith('.exitplanmode')) {
      this.markExitPlanModeProcessed('user sent text while ExitPlanMode approval bar was active');
    }
  }
  this.cancelExitPlanApproveResumeFallback();
  this.clearApprovalTracking();
  // ... send text to CLI ...
```

### planApprovalResponse handler (MessageHandler.ts)

```typescript
if (isExitPlanMode) {
  this.markExitPlanModeProcessed(`planApprovalResponse:${msg.action}`);

  if (msg.action === 'feedback' && msg.feedback?.trim()) {
    // Feedback: send to CLI so Claude can revise the plan.
    // Reset exitPlanModeProcessed so new ExitPlanMode cycle can show bar.
    this.resetExitPlanModeProcessed('ExitPlanMode feedback requested plan revision');
    this.webview.postMessage({ type: 'userMessage', content: [...] }); // optimistic
    this.control.sendText(msg.feedback.trim());
  } else {
    // Approve/reject: close bar without sending text (CLI auto-approves).
    if (msg.action === 'approveClearBypass') this.control.compact();
    else if (msg.action === 'approveManual') { /* switch permission mode */ }
    // Approve actions schedule fallback (immediate nudge if CLI idle,
    // delayed nudge if no activity yet, skip if CLI actively working).
  }
}
// ... (non-ExitPlanMode branches send text to CLI) ...
this.clearApprovalTracking();
this.approvalResponseProcessed = true;
// Send processBusy:true for non-ExitPlanMode and ExitPlanMode feedback.
// Skip for ExitPlanMode approve (CLI already auto-resumed).
const isExitPlanFeedback = isExitPlanMode && msg.action === 'feedback';
if (!isExitPlanMode || isExitPlanFeedback) {
  this.webview.postMessage({ type: 'processBusy', busy: true });
}
```

### scheduleExitPlanApproveResumeFallback (MessageHandler.ts)

```typescript
// Bug 14 fix: Use inAssistantTurn instead of resumeObserved/resultObserved.
// inAssistantTurn is true between messageStart and result — a direct idle/busy indicator.
if (!this.inAssistantTurn) {
  // CLI is idle — send nudge immediately
  this.control.sendText('Continue with the implementation.');
  this.webview.postMessage({ type: 'processBusy', busy: true });
  return;
}
// CLI is in an active turn — schedule delayed check via postApproveNudgeTimer
// (decoupled from approval cycle state, survives result-handler cleanup)
// Timer callback: !inAssistantTurn -> nudge, inAssistantTurn -> skip (implementing)
```

---

## Bar Lifecycle

The approval bar is cleared when:
1. **User clicks a button** -> PlanApprovalBar calls `setPendingApproval(null)` directly. For non-ExitPlanMode, extension immediately sends text + `processBusy:true`. For ExitPlanMode approve, extension closes the bar and waits briefly for auto-resume; if none is observed, it sends a single proceed nudge + `processBusy:true`. For ExitPlanMode feedback, extension sends the feedback text to CLI + `processBusy:true`.
2. **User sends a regular message** -> `sendMessage` -> `processBusy: true` -> bar cleared
3. **New `planApprovalRequired` replaces it** (e.g., AskUserQuestion replaced by ExitPlanMode)
4. **Session resets**

The bar is NOT cleared on:
- `messageStart` (removed - caused bar to be invisible)
- `processBusy: false` (result event - bar should persist)
- `costUpdate` (intentionally preserved)

---

## Known Limitation: AskUserQuestion + ExitPlanMode Overlap

If the model calls AskUserQuestion and then ExitPlanMode in quick succession (common when CLI auto-approves AskUserQuestion), the ExitPlanMode bar replaces the AskUserQuestion bar. The user only sees ExitPlanMode options.

**Root cause**: The CLI auto-approves AskUserQuestion (via `bypassPermissions`), so the model doesn't wait for the answer and immediately proceeds to ExitPlanMode.

**Potential future fix**: Change `full-access` mode to use `--allowedTools` (listing all tools except AskUserQuestion/ExitPlanMode) instead of `--permission-mode bypassPermissions`. This would make the CLI pause on both tools.

---

## How to Verify

1. Start a session in ClaUi
2. Give a task that triggers plan mode (e.g., ask Claude to plan a complex feature)
3. When the approval bar appears with 4 options, verify it stays visible
4. Click any approve button -> verify model continues without bar re-appearing
5. **Verify NO stuck "Thinking..."** -> after clicking approve, the indicator should NOT show "Thinking..." indefinitely. If the CLI already finished, no indicator should show. If still executing, tool activity messages should appear. If the CLI fails to auto-resume, the delayed fallback should start execution within a few seconds.
6. Test typing text while bar is visible -> verify it sends as regular message (not dropped)
7. Check logs (`Output -> ClaUi`) for these diagnostic prefixes:
   - `[APPROVAL_STATE]` - full state dump at every key lifecycle moment (messageStart, result, sendMessage, planApprovalResponse, messageDelta, assistantMessage fallback, notifyPlanApprovalRequired)
   - `[EPM_TRACK]` - `notePostExitPlanNonPlanActivity` skip/track decisions (shows whether CLI ran tools before user clicked)
   - `[EPM_CYCLE]` - `markApprovalCycleResumeObserved` / `markApprovalCycleResultObserved` decisions (shows CLI resume/idle detection)
   - Look for `reopenCount=N/2` in `[APPROVAL_STATE]` lines to confirm Bug 11 counter is working
8. Test AskUserQuestion: give a task that triggers a question, verify option buttons appear. After answering, "Thinking..." should show (text IS sent to CLI for AskUserQuestion).
9. Test multi-cycle plan mode (model does work then re-plans): verify up to 2 re-opens work (approval bar shows), and the 3rd re-open is suppressed with log `"Suppressing ExitPlanMode reopen - hit max reopens"`.
