# ClaUi - Changelog

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
