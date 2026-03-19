# ClaUi - Changelog

## v0.1.103 - 2026-03-19

**Fix: Activity Summary persists across turns**

- Activity summary panel no longer disappears when the user sends a new prompt
- Previously, the summary was cleared on every `processBusy: true` event, making it visible only in a narrow window between Haiku response and the next user message
- Now the summary stays visible until a new summary replaces it or the user dismisses it with the X button
- Existing dismiss features: X button (top-right), "Disable permanently" button (appears for 4 seconds after dismiss), and toggle in VitalsInfoPanel dropdown

---

## v0.1.01 - 2026-03-19

**Fix: MCP chip hidden when no servers are configured**

- The MCP status chip in the status bar is now completely hidden when there are no MCP servers in the inventory
- Previously, the chip always rendered (even showing "MCP error" with red styling when MCP had no servers), which was confusing
- When servers exist, the chip continues to show count, login, restart, and error states as before

**Improvement: Usage data auto-refresh**

- Usage data now auto-fetches when the webview first loads (on `ready` event), so the usage metric shows real data immediately
- After each Claude turn completes, usage data is automatically refreshed (throttled to once per 60 seconds to avoid excessive API calls)
- Previously, usage data only loaded when the user manually clicked the usage button

**Improvement: Progressive right-side status bar collapse**

- Status bar right-side elements (session timer, MCP chip, usage metric) now progressively collapse into their respective dropdowns as the panel narrows
- Stage 1 (< 580px): session timer moves into the View dropdown
- Stage 2 (< 500px): MCP chip moves into the Tools dropdown
- Stage 3 (< 430px): usage metric moves into the View dropdown
- All stages use hysteresis (20px gap between collapse and expand thresholds) to prevent flickering at boundary widths
- New CSS styles for collapsed elements inside dropdowns: labeled rows, full-width usage widget, and upward-opening usage popover

**Fix: Happy Coder session ID capture and seamless switch-back**

- Happy CLI emits its session ID as a raw `[DEV] Session: <id>` text line (not a JSON `system/init` event like Claude CLI)
- `ClaudeProcessManager` now detects this pattern and synthesizes a proper `system/init` event, so Happy sessions are tracked in `SessionStore` and appear in History
- This enables resuming Happy sessions from History (Ctrl+Shift+H) and the command palette, and supports the cross-device flow: start locally, continue on mobile, return to local seamlessly
- Updated `REMOTE_SESSIONS.md` documentation with the session ID capture mechanism and cross-device resume flow

---

## v0.1.000 - 2026-03-19

**Feature: MCP management and visibility (Phase 1A + 1B)**

- Added full MCP inventory support for Claude tabs, combining runtime session truth, config truth, and pending mutation truth into one merged model
- Added a dedicated MCP overlay with `Session`, `Workspace`, `Add`, and `Debug` tabs
- Added MCP status surfaces across the UI:
  - Status bar MCP chip with restart/login/error/read-only states
  - Context tab MCP pills that open the MCP panel
- Added guided MCP management flows for Claude tabs:
  - add server
  - remove server
  - import from Claude Desktop
  - reset project approval choices
  - restart/reconnect CTA flow
- Added project-scope `.mcp.json` diff preview before save
- Added curated MCP templates plus custom `stdio`, `http`, and `sse` configuration flows
- Added SecretStorage-backed MCP secret handling with `${VAR}` placeholders so secrets are never written directly to `.mcp.json`
- Added provider-aware MCP gating:
  - Claude tabs get full management
  - Codex/Happy tabs stay explicit read-only, with safe discovery/debug actions only
- Added MCP-specific diagnostics/reporting entry point:
  - prominent `Report MCP issue` button in the MCP panel
  - reuses the full bug-report flow with MCP-focused prefill
  - automatically attaches the current MCP inventory snapshot to preview, AI diagnosis context, ZIP contents, and final submission

**Fix: RTL alignment for mixed Hebrew/English chat messages**

- Chat messages containing Hebrew/Arabic text now right-align even when the first character is English
- Previously, `dir="auto"` relied on the browser's first-strong-character heuristic, causing messages like "Hello world shalom" to stay left-aligned despite containing Hebrew
- Updated `MarkdownContent.tsx`, `StreamingText.tsx`, and `MessageBubble.tsx` to use `detectRtl()` which checks for any Hebrew/Arabic character in the text
- This matches the existing input area behavior where any Hebrew triggers RTL

**Feature: Codex GPT-5.4 model support**

- Added `gpt-5.4` as a first-class Codex model option in the fallback model selector list
- Kept dynamic Codex model discovery from `~/.codex/models_cache.json` as the primary source; fallback list is used when cache data is unavailable
- Aligned model naming with official OpenAI docs (`gpt-5.4`, not `gpt-5.4-codex`)

**Improvement: Codex reasoning effort parity (`none`)**

- Added `none` to the `CodexReasoningEffort` message-contract type
- Added `None` option to the Codex reasoning selector in the webview
- Updated extension setting manifest (`claudeMirror.codex.reasoningEffort`) to include `none` in enum + descriptions

**Improvement: GPT-5 context window heuristics**

- Updated webview context-limit mapping for GPT-5 family:
  - `gpt-5.4` / `gpt-5.4-pro` -> `1,050,000`
  - other `gpt-5*` models -> `400,000`
- Improves context usage percentage accuracy in the input context bar for Codex GPT-5 sessions

**Documentation updates**

- Updated README Codex reasoning-effort docs to include `none`
- Updated `Kingdom_of_Claudes_Beloved_MDs/CODEX_INTEGRATION_PROGRESS.md` with a dedicated 2026-03-18 GPT-5.4 alignment note
- Updated `TECHNICAL.md` with the Codex GPT-5.4 support update entry and manifest/runtime notes

**Feature: Usage-limit deferred send (Claude only)**

- When Claude returns a usage-limit error, the extension now detects it automatically and enters "deferred send" mode
- Users can queue their next prompt immediately; it will be auto-sent one minute after the limit resets
- New `usageLimitParser.ts` parses reset times from Claude error messages (absolute time, relative duration, time-only formats) with future-normalization
- Full state machine in `MessageHandler`: detects usage-limit errors on `result.error`, tracks reset time, schedules dispatch with retry on busy, clears on session lifecycle events (start/stop/resume/fork/clear/editAndResend/provider switch)
- Webview receives `usageLimitDetected` and `usageQueuedPromptState` messages to drive UI state
- Input area shows a warning banner with reset info and a queued-prompt chip when a prompt is staged
- Send button label changes to "Send When Available" and placeholder text updates during usage-limit mode
- New `queuePromptUntilUsageReset` message type for explicit queue requests from the webview
- Usage-limit state is cleared automatically on successful result, provider switch away from Claude, or any session lifecycle reset

**Feature: Prompt navigation arrows**

- Added up/down arrow buttons above the send button to scroll through previous user prompts in the chat
- Clicking the up arrow scrolls to the previous user message; down arrow scrolls to the next
- Navigation index resets when new messages are sent
- Messages scroll into view smoothly, centered in the viewport

**Feature: Project 30 Days dashboard tab**

- Added a "30 Days" tab under the Dashboard's Project mode
- Filters project session summaries to the last 30 calendar days and renders the existing project overview analytics on the filtered subset
- Shows session count and cutoff date in an info header; displays "No sessions in the last 30 days" when empty

**Improvement: Centralized outside-click handling**

- Created `useOutsideClick` hook that uses a single shared document `click` listener with a module-level registry instead of per-dropdown `mousedown` listeners
- Fixes the "first click does nothing" bug where `mousedown` fired before the target button's `click`, causing React to batch state updates that swallowed the click
- Migrated all outside-click logic: StatusBar (vitals, Babel Fish, usage popovers), StatusBarGroupButton, InputArea (enhancer popover, send settings popover)

**Improvement: Provider switching within the same Claude tab**

- `MessageHandler` now syncs the CLI path override with the provider dropdown selection before starting a new session
- Allows Claude and Happy switching within the same `SessionTab` without needing to open a new tab
- `SessionTab.setCliPathOverride` now accepts `null` to clear the override (switching back to Claude)

**Improvement: Visual Progress auto-scroll reliability**

- `VisualProgressView` now always scrolls to bottom for newly added cards (not just when near bottom)
- For card updates (content changes on existing cards), still only auto-scrolls if already near the bottom (within 200px)

**Feature: BTW now works natively in Codex sessions**

- Added a dedicated headless `CodexBackgroundSession` for BTW side-conversations, with isolated per-turn `codex exec --json` flow and persistent BTW thread context
- Added full BTW lifecycle support in `CodexSessionTab` (`startBtwSession`, `sendBtwMessage`, `closeBtwSession`) and mapped Codex events to existing `btw*` webview messages
- Added BTW request routing in `CodexMessageHandler` so BTW actions from the webview are handled in Codex tabs (instead of being ignored)
- Seeded Codex BTW start with clipped recent context from the current tab to preserve conversational continuity in the side-thread
- Updated `BtwPopup` role label to be provider-aware (`Claude` / `Codex`) during BTW chat

**Improvement: BTW side-conversation reliability and UX polish**

- Reworked `BackgroundSession` to a single-phase fork flow (fork + immediate first message), avoiding the previous stuck behavior in pipe mode
- Fixed BTW event mapping in `SessionTab` to read nested `.message` payloads correctly, so assistant content renders instead of empty bubbles
- Added optimistic BTW user-message rendering (no wait for CLI echo), idempotent `initBtwSession`, and skipped echoed duplicates
- Added richer BTW diagnostics/log lines and small overlay behavior refinements in `MessageList`/`BtwPopup`

**Improvement: Token Ratio chart axis readability**

- `TokenRatioTab` now uses period-aware X-axis formatting:
  - `5 Hours` / `24 Hours`: shows time labels
  - `7 Days` and longer: shows date labels
- Tooltip label formatting was aligned with timestamp-based axis data

**Feature: Chat Search (session + cross-project)**

- Added a search bar for finding messages within the current session or across all project sessions
- **Session search** (client-side): instant case-insensitive text matching against all loaded messages, with match counter and prev/next navigation that scrolls to highlighted message bubbles
- **Project search** (extension-side): scans JSONL session files on disk using raw string matching (no full JSON parse) for 10-100x better performance; returns up to 50 results with snippet context
- Results dropdown shows session label, relative timestamp, role badge (user/assistant), and highlighted match snippet
- Clicking a project result resumes/opens that session via `claudeMirror.resumeSession`
- requestId-based cancellation discards stale responses when query changes mid-flight
- 300ms debounce on project search to avoid excessive filesystem scans; session search is immediate
- Keyboard shortcuts: `Ctrl+Shift+F` to open, `Escape` to close, `Enter`/`Shift+Enter` for next/prev match
- Matched messages highlighted with CSS outline using VS Code theme `findMatchHighlightBackground` colors; current match uses `findMatchBackground`
- New "Search" button in StatusBar session dropdown
- New files: `ChatSearchService.ts` (extension), `ChatSearchBar.tsx` (webview)
- New message types: `chatSearchProject`, `chatSearchResumeSession`, `chatSearchProjectResults`

**Documentation updates**

- Added `Kingdom_of_Claudes_Beloved_MDs/btw_bug.md` with BTW bug-fix investigation history and architecture notes
- Added `Kingdom_of_Claudes_Beloved_MDs/USAGE_LIMIT_DEFERRED_SEND_PLAN.md` (planned usage-limit deferred-send flow)
- Added `Kingdom_of_Claudes_Beloved_MDs/PROJECT_30_DAYS_TAB.md` with Project 30 Days tab documentation
- Updated `TECHNICAL.md` and analytics/token-ratio details to reflect the new docs and chart behavior
- Updated `Kingdom_of_Claudes_Beloved_MDs/btw_bug.md` and `TECHNICAL.md` with Codex BTW architecture and runtime flow

## v0.1.91 - 2026-03-11

**Release: version bump**

- Updated extension version from `0.1.90` to `0.1.91` in `package.json` and `package-lock.json`

**Fix: BTW side-conversation infinite/stuck flow**

- Introduced a new headless `BackgroundSession` to run BTW conversations separately from the main tab session
- Added full BTW message contract between webview and extension (`start/send/close` requests and streaming lifecycle events)
- Added BTW chat overlay mode with follow-up messaging, independent state, and busy/streaming handling
- Improved right-click context menu (selection-aware actions + BTW entry) and BTW popup flow (Send vs New Tab paths)

## v0.1.89 - 2026-03-11

**Feature: Image Lightbox (Double-Click to Enlarge)**

- Double-clicking any image (pending input thumbnails or message bubble images) opens a full-screen lightbox overlay
- Image displayed at natural size (up to 90vw/90vh) centered on a dark semi-transparent backdrop
- Close by clicking the backdrop or pressing Escape
- Zoom-in cursor on all clickable images; zoom-out cursor on the overlay backdrop
- Portal-based component (`ImageLightbox`) mounted at App root, driven by `lightboxImageSrc` Zustand state field

**Feature: Display Mode Slider**

- Replaced the three separate toggles (Summary Mode, Visual Progress, Detailed Diff) in the Vitals gear panel with a unified 4-position slider
- Positions: Normal (0), Summary (1), Visual (2), Diff (3) -- mutually exclusive, only one active at a time
- Clicking the track or labels switches modes; smooth animated thumb transition

**Improvement: Auto-focus input on panel/window focus**

- Textarea in the input area now automatically regains focus when the webview panel becomes active (tab switch) or when the VS Code window regains OS focus
- Uses a custom `claui-focus-input` event dispatched from the extension via `focusInput` message, with `requestAnimationFrame` to ensure the iframe has settled
- Applied to both Claude and Codex session tabs

**Improvement: Codex CLI auto-detection on missing CLI**

- When Codex CLI is not found at runtime, the extension now attempts auto-detection (bundled VS Code extensions, npm prefix, common install locations) before showing the "not found" guidance
- Extracted shared CLI detection logic into `CodexCliDetector.ts`, used by both `CodexSessionTab` and `CodexMessageHandler`
- If a working CLI is found, it is auto-configured and the user is informed to retry

## v0.1.87 - 2026-03-09

**Feature: Visual Progress Mode**

- New display mode that replaces raw tool output with animated visual cards showing what Claude is doing in real time
- Each tool call generates a card with category classification (reading, writing, editing, searching, executing, delegating, planning, skill, deciding, researching) and template-based descriptions
- AI-enriched descriptions via Haiku explain the "why" in first person (e.g., "I'm reading the config file to understand the data flow")
- Bash commands are parsed into human-readable text (git, npm, python, node, file operations)
- Max 2 concurrent Haiku calls with queue, 8-second timeout, and response caching
- New setting: `claudeMirror.visualProgressMode` (default: off)
- New setting: `claudeMirror.vpmAiDescriptions` (default: on) -- toggle AI descriptions

**Feature: Summary Mode**

- New display mode that hides tool details from messages and shows animated activity summaries instead
- When enabled, the chat layout splits 50/50 with an animation panel and the message list
- 5 animated SVG visualizations that progress with each tool call (reach 100% at 50 calls):
  - Building Blocks -- brick wall assembling from bottom to top
  - Progress Path -- winding mountain trail with checkpoints
  - Puzzle Assembly -- jigsaw puzzle assembling from center outward
  - Rocket Launch -- rocket ascending through atmosphere into space
  - Growing Tree -- seed growing into a full tree with branches, leaves, and fruit
- Each animation has a unique completion state (golden glow, birds, flags, etc.)
- New setting: `claudeMirror.summaryMode` (default: off)

**Feature: Detailed Diff View**

- Inline file diffs for Write and Edit tool operations showing added/removed lines
- For Edit/MultiEdit: shows old_string vs new_string as a colored diff
- For Write: captures file content before the write, then diffs old vs new
- LCS-based diff algorithm with context-line folding (3 lines around changes)
- Collapsible diff blocks with +/- line counts in the header
- New file creation shown as all-green additions; capped at 500KB per file
- New setting: `claudeMirror.detailedDiffView` (default: off)

**Feature: Agent/Task tool visualization**

- Agent, Task, and dispatch_agent tool calls now render as specialized visual cards
- Cards show agent type badge (Explore/Plan/general-purpose) with color coding
- Status indicators (running/completed/error) with animated dots
- Collapsible prompt and result sections; background agents show a "BG" chip
- Nested sub-agent hierarchy tree visualization with connector lines
- Partial JSON parsing during streaming for immediate display
- Agent tool_result blocks are paired inline with their tool_use (not as standalone blocks)

**Feature: Expand/Collapse All tool blocks**

- New toggle button on assistant messages to expand or collapse ALL tool/result blocks at once across the entire message list

**Feature: Ultrathink Lock (project-level)**

- Ultrathink (extended thinking) toggle state now persists per-project using VS Code's `workspaceState`
- Lock state survives across sessions within the same workspace

**Bug Fix: Duplicate user message display (reworked)**

- Rewrote the user message dedup logic to properly handle late CLI echo arrivals
- Optimistic sends always go through; CLI echo sends are suppressed if they match the last optimistic text regardless of time elapsed
- Applied to both Claude and Codex message handlers

**Bug Fix: ExitPlanMode approval bar persistence (Bug 16)**

- Added `exitPlanModeBarActive` flag that persists even after `pendingApprovalTool` is cleared by `messageStart`
- When user sends text/images while the bar is active, the plan is correctly marked as processed
- Auto-dismiss: when the model starts using non-plan tools (implementation begun), the approval bar is automatically dismissed
- New `planApprovalDismissed` message type sent to webview to clear the bar
- Bar properly cleared on cancel, clearSession, and edit-and-resend

**Bug Fix: Model label passed as CLI argument**

- Both ClaudeProcessManager and CodexExecProcessManager now skip display-only labels like "Codex (default)" that contain parentheses, preventing invalid `--model` CLI arguments

**Bug Fix: Translation error display**

- Translation failures now surface in the UI with error state styling, "Translation failed - click to retry" tooltip, and a Retry button

**Bug Fix: Codex CLI auto-recovery when not on PATH**

- When Codex CLI is not found on PATH, ClaUi now automatically searches bundled VS Code extensions, common install locations, and npm prefix before showing the "not found" error
- If a working Codex CLI is found (e.g., bundled inside the official Codex VS Code extension), it is auto-configured in `claudeMirror.codex.cliPath` and the user is informed to retry
- Previously, the sophisticated detection logic only ran during the manual "Auto-setup" flow, not during runtime error recovery
- Extracted CLI detection into shared utility `CodexCliDetector.ts` used by both `CodexSessionTab` and `CodexMessageHandler`

**Bug Fix: Auto-dismiss transient command errors**

- Non-fatal "command failed (exit N)" error banners now auto-dismiss after 10 seconds instead of persisting until manually cleared

**Improvement: Translation timeout scaling**

- Translation CLI calls now use `--max-tokens 16000` with dynamic timeout: 45s base + 10s per 1000 chars, capped at 120s (previously fixed 30s)

**Improvement: SkillGen pipeline**

- Fresh runs now clean workspace subdirectories to prevent stale data accumulation
- Incremental enrichment: reuses cached card enrichments to avoid duplicate API calls

## v0.1.86 - 2026-03-06

**Feature: Usage dashboard period selector**

- Both the Usage tab and Token Ratio tab now have clickable period-selector tabs (5 Hours, 24 Hours, 7 Days, 14 Days, 30 Days, 2 Months) instead of a flat list of all buckets
- Dynamic/future-proof usage parsing: any new API time windows or models are auto-detected without code changes
- Cards display model name (Opus, Sonnet, Haiku) as the title; period context provided by the tab selector
- Chart legend and colors are now consistent per model across all time periods
- New time periods supported: 24 Hours, 14 Days, 30 Days, 2 Months; new model: Haiku

**Bug Fix: Robust file-reference opening from chat links**

- Fixed chat file links failing with `The editor could not be opened because the file was not found` for references like `:LocalModelServer.swift#L103`
- Root cause: `openFile` parsed only `:line[:col]` suffixes and treated leading punctuation / `#L...` anchors as literal path text
- Added `openFile` normalization in both Claude and Codex handlers:
  - trims wrapper/punctuation noise around tokens
  - supports GitHub-style anchors (`#L123`, `#L123C7`, range suffixes)
  - keeps existing `:line[:col]` support
  - adds fallback basename/suffix lookup when relative paths are incomplete
  - adds parent-folder fallback for `.xcodeproj` / `.xcworkspace` workspace roots

## v0.1.85 - 2026-03-06

**Improvement: Deferred handoff context injection**

- Reworked provider handoff to use deferred prompt injection instead of immediate auto-send
- Handoff context is now staged and injected into the first user message sent in the target tab, rather than being sent automatically as a standalone prompt
- Removed `claudeMirror.handoff.autoSend` setting (no longer needed)
- Handoff prompt is composed as prior conversation history/context (not a directive), giving the user control over when the handoff context is consumed
- Staged context is cleared on session start/resume/clear/fork to prevent stale injection
- Codex message ID collisions fixed: agent messages now use unique UI IDs instead of reusable Codex item IDs

## v0.1.84 - 2026-03-05

**Feature: Mid-session provider handoff with context (Claude <-> Codex)**

- Added explicit provider handoff flow that preserves task continuity using a structured `Handoff Capsule` (instead of unsupported cross-provider hidden-memory resume)
- Added a full handoff pipeline in the extension (`HandoffTypes`, `HandoffContextBuilder`, `HandoffPromptComposer`, `HandoffArtifactStore`, `HandoffOrchestrator`) and integrated it into `TabManager`
- Added stage-based handoff state machine and progress updates to the webview: `collecting_context` -> `creating_target_tab` -> `starting_target_session` -> `injecting_handoff_prompt` -> `awaiting_first_reply` -> `completed|failed`
- Added source/target metadata linking in `SessionStore` for audit/debug (`handoffSource*`, `handoffTarget*`, `handoffArtifactPath`, `handoffCompletedAt`)
- Added command palette action: `ClaUi: Switch Provider (Carry Context)`
- Added webview status bar UX split:
  - `Switch (Carry Context)` for migration
  - Existing provider buttons remain clean-session open flow
- Added input lock during active handoff stages and a manual fallback (`Send capsule manually`) when handoff fails
- Added new settings:
  - `claudeMirror.handoff.enabled`
  - `claudeMirror.handoff.storeArtifacts`

**Fixes included in v0.1.84 (Plan Approval reliability)**

- Fixed plan approval click no-op cases where options disappeared and implementation did not continue (Bug 14)
- Hardened ExitPlanMode approve fallback for compact/busy edge cases with retry/final-nudge behavior (Bug 15)

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
