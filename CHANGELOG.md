# ClaUi - Changelog

## v0.1.82 - 2026-03-04

**Feature: Ultrathink button with random animations**

- Added a brain icon button between the browse/paperclip button and the textarea in the input area
- Clicking the button injects the `ultrathink` keyword (boosts Claude's reasoning effort) into the prompt
- Each click randomly plays one of 4 CSS animations for 1.2 seconds before prepending the text:
  - Rocket Launch - rocket flies upward with an orange flame trail
  - Brain on Fire - brain pulses with fiery glow and drop-shadows
  - Wizard Staff - wand rotates with purple lightning spark particles
  - Turbo/NOS - shakes with blue energy charge and speed lines
- Guards against double-click during animation, skips prepend if "ultrathink" already present
- The word "ultrathink" also renders with an animated rainbow glow effect in chat messages (both completed and streaming)

## v0.1.78 - 2026-03-04

**Fix: Context widget always showing 0% (cache token summation)**

- Fixed the context usage bar permanently stuck at 0% despite token data arriving correctly
- Root cause: the Anthropic API splits input tokens into three fields when prompt caching is active — `input_tokens` (non-cached, typically 1–5), `cache_creation_input_tokens`, and `cache_read_input_tokens`. The code only read `input_tokens`, so a turn consuming ~40K tokens reported just 3, yielding 0.0025% — invisible
- Fixed `StreamDemux.handleMessageStart()` to sum all three token fields before emitting `messageStart`
- Fixed `MessageHandler` assistant-event handler to sum all three fields when updating `lastAssistantInputTokens`
- Fixed `MessageHandler` result-event handler to sum all three fields before the final fallback resolution
- Real context usage is now correctly calculated as `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`
- Enhanced `costUpdate` diagnostic log to show all three components and the resolved total

**Fix: Translate spinner stuck after manual translation**

- Fixed loading spinner continuing to spin after a successful manual translation
- Root cause: the manual translate code path set the translated text in the textarea but forgot to call `setIsTranslatingPrompt(false)`, leaving the UI permanently in "translating" state
- Added the missing state clear before the `setText()` call in `InputArea.tsx`

## v0.1.76 - 2026-03-04

**Fix: Context widget not updating + simplified to minimal bar**

- Fixed the floating context widget not re-rendering when new token data arrived — now polls the store every 5 seconds via `getState()` instead of relying on zustand selector reactivity
- Simplified the floating widget to a pure progress bar strip (160x10px) with no text, labels, or background box — just a colored bar that grows as context fills up
- Tooltip on hover still shows the exact percentage

## v0.1.75 - 2026-03-04

**Fix: Stale plan approval bar persisting during execution**

- Fixed the "Plan Ready for Review" approval bar staying visible after the model already moved on to executing the plan
- Root cause: the CLI auto-approves ExitPlanMode and resumes execution, but the webview never received a signal to dismiss the bar (only user-initiated actions sent `processBusy: true`)
- Added a 5-second delayed auto-dismiss timer: when `messageStart` arrives while an ExitPlanMode bar is showing, the bar auto-clears after 5s if the user hasn't interacted
- AskUserQuestion bars are unaffected (user's answer is content-meaningful)
- Timer is safely cancelled on user interaction, new approval, or cleanup

## v0.1.74 - 2026-03-04

**Feature: Context window usage indicator**

- Added a real-time context consumption indicator showing how much of the AI's conversation memory has been used
- **Usage button mini-strip**: a thin colored bar appears at the bottom of the Usage button reflecting current context % at a glance
- **Usage popover section**: opening the Usage button now shows a "Context window" progress bar with exact percentage and a toggle for the floating widget
- **Floating draggable widget**: a compact panel showing the context bar, token count (`used / max`), and model name — draggable anywhere on screen, position persists across reloads
- Color coding: green < 50%, yellow 50–80%, red > 80%
- No backend changes required — data comes from the existing `inputTokens` field already emitted per turn

## v0.1.73 - 2026-03-04

**Feature: Visual TodoWrite cards in chat**

- `TodoWrite` tool blocks now render as a visual, user-friendly task card instead of raw JSON
- Added progress UI: completion bar plus summary chips (`%`, `done`, `doing`, `queued`)
- Todos are shown as color-coded rows by status (`completed`, `in_progress`, `pending`) with cleaner readability
- `activeForm` text is displayed as a secondary line per task when available
- `TodoWrite` blocks open expanded by default (still collapsible), while all other tool blocks keep existing behavior

## v0.1.72 - 2026-03-04

**Fix: StatusBar responsive collapse rework**

- Fixed collapse stages triggering at wrong widths (stage 3 showing when stage 1 should be active)
- Root cause: `scrollWidth` overflow guard created a feedback loop, cascading through all stages on a single resize event. Removed overflow detection entirely; stages now use pure width thresholds with hysteresis gaps
- Raised full-to-medium threshold (1080 -> 1350) so the transition fires before buttons clip
- Added a **More** dropdown to medium mode (stage 2) containing all items that move out of the inline layout (provider/model/permission selectors, Git, Dashboard, Teams, Consult, SkillDocs, Achievements, Usage, Vitals toggle)
- Lowered minimal threshold (680 -> 480) so stage 3 (collapsed) stays active longer before everything collapses into a single Menu dropdown
- All 4 stages now transition correctly in both directions when resizing

## v0.1.71 - 2026-03-03

**Feature: HTML Preview inside VS Code**

- HTML code blocks in chat now show a "Preview" button that opens the rendered HTML in a new VS Code tab (no external browser needed)
- Plan documents (HTML) now open in an in-editor preview tab instead of launching the default browser
- Full HTML documents (with `<!DOCTYPE html>`) are rendered directly; code snippets get a minimal wrapper with a permissive CSP

## v0.1.70 - 2026-03-02

**Feature: Happy provider integration (remote)**

Added a first-class Happy flow while keeping provider id `remote` for compatibility:
- New Happy tabs now use the existing `SessionTab` + `ClaudeProcessManager` pipeline with CLI override (`happy` instead of `claude`)
- Added `claudeMirror.happy.cliPath` setting and `ClaUi: Authenticate Happy Coder` command (`happy auth`)
- Webview-initiated start/resume/restart flows now preserve provider routing correctly
- Provider labels updated in UI from `Remote` to `Happy`
- Added targeted Happy auth/missing-CLI guidance and filtered non-fatal stderr noise (for example `Using Claude Code v... from npm`) from red error banners

## v0.1.69 - 2026-03-02

**Bug Fix: Plan mode stuck after context compaction**

After a plan cycle completed and context was later compacted, the model could get permanently stuck in plan mode. The `exitPlanModeProcessed` guard (which prevents infinite ExitPlanMode loops) was never reset after compaction, so when the model re-entered plan mode and called ExitPlanMode, the approval bar was suppressed and the user had no way to proceed.

Fix: Added a `compactPending` flag that resets `exitPlanModeProcessed` on the first assistant turn after compaction, giving the model a clean slate to trigger the approval bar again.

**Bug Fix: ExitPlanMode stale-suppression deadlock after approval**

In some sessions, Claude started implementation after plan approval (`TodoWrite`/`Read`) and then called `ExitPlanMode` again. The extension still treated that call as stale because `exitPlanModeProcessed` remained true, so the approval bar was suppressed and the session deadlocked in plan mode.

Fix: Track post-approval non-plan activity and, when detected, treat a later `ExitPlanMode` call as a fresh cycle (reset stale guard + show approval bar) instead of suppressing it.

## v0.1.67 - 2026-03-02

**Bug Fix: Duplicate user prompt display**

User messages sometimes appeared twice in the chat. Root cause: pressing Ctrl+Enter could fire multiple keydown events (key-repeat) before React's async `setText('')` took effect, sending the same message twice.

Fix applied in two layers:
- **InputArea.tsx**: Added a ref-based guard that blocks identical text sent within 500ms
- **store.ts**: Improved the dedup logic to scan backwards through recent messages (not just the last one) within a 15-second window, handling cases where assistant events interleave between the optimistic display and CLI echo

## v0.1.66 - 2026-03-02

**Feature: Streaming output implementation**

Added real-time streaming display for Claude's responses instead of waiting for complete output.

## v0.1.0 - 2025-02-18

**Initial Release**

Core extension providing a rich chat interface for Claude Code inside VS Code:
- Multi-tab session management with color-coded tabs
- Markdown rendering with syntax-highlighted code blocks
- Tool use visualization (file edits, bash commands, search results)
- Session auto-naming using Claude Haiku
- Conversation history browser
- File path sending from Explorer/Editor context menus
- Context compaction and session resume
- Plan document viewer with approval UI
- Permission mode selector (Full Access / Supervised)
- File logging with per-session log files
- Configurable font size and font family
