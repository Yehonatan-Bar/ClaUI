# ClaUi - Changelog

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
