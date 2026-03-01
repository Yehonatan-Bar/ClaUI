# Bug: ExitPlanMode Infinite Loop & Approval Bar Visibility

## Summary

The plan approval bar (4 CLI-matching options) and AskUserQuestion interactive controls must be visible to the user when the model calls `ExitPlanMode` or `AskUserQuestion`. The CLI runs with `bypassPermissions` and auto-approves these tools, so the extension must detect them via stream events and show the UI independently.

**Date First Fixed**: 2026-02-23
**Date Second Fix**: 2026-02-23
**Date Third Fix**: 2026-02-24 (approval bar visibility)
**Date Fourth Fix**: 2026-02-25 (stuck Thinking after plan approval)
**Date Fifth Fix**: 2026-02-26 (approve click can be no-op if CLI did not auto-resume)
**Date Seventh Fix**: 2026-03-01 (approve click no-op when CLI auto-resumed with brief text and went idle)
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

---

## Current Defense Layers

| Layer | Location | What it prevents |
|-------|----------|------------------|
| `exitPlanModeProcessed` flag | MessageHandler.ts `notifyPlanApprovalRequired` | Stale re-triggers from late events/replays |
| Block ExitPlanMode approve/reject text to CLI | MessageHandler.ts `planApprovalResponse` | Spurious user messages for approve actions |
| ExitPlanMode feedback DOES send text to CLI | MessageHandler.ts `planApprovalResponse` | Feedback is real user content, not a loop risk |
| InputArea sends regular message (not feedback) | InputArea.tsx `sendMessage` | Text typed during ExitPlanMode goes as new user message, not dropped |
| Skip `processBusy:true` for ExitPlanMode approve | MessageHandler.ts `planApprovalResponse` | Stuck "Thinking..." indicator after plan approval |
| Send `processBusy:true` for ExitPlanMode feedback | MessageHandler.ts `planApprovalResponse` | UI shows thinking while Claude processes feedback |
| Immediate nudge when CLI idle (resultObserved) | MessageHandler.ts `scheduleExitPlanApproveResumeFallback` | Approve click no-op when CLI auto-resumed with brief text and went idle |
| Delayed approve fallback (only if no activity observed) | MessageHandler.ts `scheduleExitPlanApproveResumeFallback` | ExitPlanMode approve click becoming a no-op (CLI never auto-resumed) |
| Skip nudge when CLI actively working (resumeObserved only) | MessageHandler.ts `scheduleExitPlanApproveResumeFallback` | Spurious nudge while CLI is mid-implementation |

The `messageStart` clearing was **removed** as a defense layer because it made the approval bar invisible.

---

## Key Code

### notifyPlanApprovalRequired (MessageHandler.ts)

```typescript
private notifyPlanApprovalRequired(toolName: string): void {
  if (this.pendingApprovalTool === toolName) return;
  if (this.approvalResponseProcessed) return;

  const norm = toolName.trim().toLowerCase();
  const isExitPlanMode = norm === 'exitplanmode' || norm.endsWith('.exitplanmode');
  if (isExitPlanMode && this.exitPlanModeProcessed) return;

  this.log(`Plan approval required: tool=${toolName}`);
  this.pendingApprovalTool = toolName;
  this.webview.postMessage({ type: 'planApprovalRequired', toolName });
}
```

### messageStart handler (useClaudeStream.ts)

```typescript
case 'messageStart': {
  // Do NOT clear approval bars here. Both ExitPlanMode and AskUserQuestion
  // bars should persist until user interaction. The infinite loop is prevented
  // by exitPlanModeProcessed flag and blocking all ExitPlanMode text to CLI.
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
else if (pendingApproval) {
  setPendingApproval(null);
  postToExtension({ type: 'sendMessage', text: trimmed });
}
```

### planApprovalResponse handler (MessageHandler.ts)

```typescript
if (isExitPlanMode) {
  this.planModeActive = false;
  this.exitPlanModeProcessed = true;

  if (msg.action === 'feedback' && msg.feedback?.trim()) {
    // Feedback: send to CLI so Claude can revise the plan.
    // Reset exitPlanModeProcessed so new ExitPlanMode cycle can show bar.
    this.exitPlanModeProcessed = false;
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
// If CLI already completed (result/success observed) -> idle -> nudge immediately
if (this.pendingApprovalCycleResultObserved) {
  this.control.sendText('Yes, proceed with the plan.');
  this.webview.postMessage({ type: 'processBusy', busy: true });
  return;
}
// If CLI actively working (resume observed, no result yet) -> skip
if (this.pendingApprovalCycleResumeObserved) {
  return;
}
// No activity yet -> schedule delayed fallback
// Timer callback re-checks: resultObserved -> nudge, resumeObserved -> skip
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
7. Check logs (`Output -> ClaUi`): should see the ExitPlanMode close-bar log, plus either an auto-resume/result observation log or `"ExitPlanMode approve fallback firing - sending proceed nudge to CLI"`
8. Test AskUserQuestion: give a task that triggers a question, verify option buttons appear. After answering, "Thinking..." should show (text IS sent to CLI for AskUserQuestion).
