# Double-Click Focus Fix (2026-03)

## Problem

Users reported that some UI actions required two clicks:

- Session tab switching
- `History` / `Plans` from StatusBar
- Selecting sessions from history/search style lists

## Root Cause

Focus was being forced too aggressively when VS Code window focus changed:

1. Extension handled `onDidChangeWindowState`.
2. If panel was active, it called `panel.reveal(...)`.
3. Then it posted `focusInput` shortly after.
4. Webview focused the textarea immediately.

This sequence could steal focus during user click interactions and make the first click appear ignored.

## Implemented Fix

### 1) Extension-side focus hardening

Files:

- `src/extension/session/SessionTab.ts`
- `src/extension/session/CodexSessionTab.ts`

Changes:

- Removed `panel.reveal(...)` from window-focus handler.
- Added delayed scheduling for window-focus `focusInput` (`180ms`).
- Added `focusInput` throttle (`250ms`) to dedupe rapid focus cascades.
- Added logs:
  - `Scheduling focusInput (window focus delay=...)`
  - `Suppressing focusInput (...) due to throttle (...)`
  - `Posting focusInput (...)`

### 2) Webview-side focus guard

File:

- `src/webview/components/InputArea/InputArea.tsx`

Changes:

- Track recent `pointerdown` / `click` timestamps.
- On `claui-focus-input`, suppress textarea focus when:
  - user pointer interaction was very recent (`< 280ms`), or
  - current active element is interactive (`button`, `tab`, `a`, `input`, etc.).
- Added UI debug logs:
  - `focusInputApplied`
  - `focusInputSuppressed` (`recentPointer` / `interactiveActiveElement`)

## Rollback

If this change needs to be reverted quickly:

```powershell
git checkout -- `
  src/extension/session/SessionTab.ts `
  src/extension/session/CodexSessionTab.ts `
  src/webview/components/InputArea/InputArea.tsx `
  Kingdom_of_Claudes_Beloved_MDs/PROCESS_LIFECYCLE.md `
  TECHNICAL.md `
  Kingdom_of_Claudes_Beloved_MDs/DOUBLE_CLICK_FOCUS_FIX_2026-03.md
```

Then redeploy:

```powershell
npm run deploy:local
npm run verify:installed
```

## Validation Signals

After repro steps, inspect `Output -> ClaUi` and verify:

- focus logs show scheduling/throttle behavior
- no `panel.reveal` logs on window-focus path
- `UiDebug` focus suppression appears when clicks happen near focus transitions
