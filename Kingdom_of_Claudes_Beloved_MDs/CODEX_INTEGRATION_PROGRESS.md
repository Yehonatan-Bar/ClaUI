# Codex Integration Progress

## Codex CLI Error Detection and Auto-Detect Validation

**CLI Missing Detection** (`CodexSessionTab.isLikelyCodexCliMissing()`):
Recognizes these patterns on stderr to show proper install guidance instead of generic errors:
- `'codex' is not recognized as an internal or external command` (Windows CMD)
- `codex: command not found` (Unix shells)
- `spawn codex enoent` / `enoent codex` (Node.js spawn errors)
- `the system cannot find the path/file specified` (Windows OS-level error, commonly emitted by extension-bundled binaries that fail on `exec` mode)

**Auto-Detect & Auto-Configure** (`CodexCliDetector.ts` - shared utility):
Detection logic is extracted into `src/extension/process/CodexCliDetector.ts` and used by both `CodexSessionTab` (runtime recovery) and `CodexMessageHandler` (auto-setup / auto-detect UI flows).

- All candidates are probed with `codex --version` to verify they are functional
- Extension-bundled candidates (source: `official-extension-bundled`) also get a secondary `codex exec --help` probe, because bundled binaries may pass `--version` but fail on `exec` mode due to missing internal resources
- If the exec probe returns OS-level path errors, the candidate is filtered out

**Candidate Sources** (checked in order):
1. PATH shorthand (`codex` on PATH)
2. `where.exe codex` / `which codex` results
3. Extension-bundled binaries (`.vscode/extensions/openai.chatgpt-*/bin/*/codex.exe`)
4. Common install locations (`%APPDATA%\npm\codex.cmd`, etc.)
5. npm prefix fallback (when auto-setup is used)

**Auto-Recovery on CLI Missing:**
When a Codex turn fails because the CLI is not found (process exit/error or login precheck), `CodexSessionTab` now runs `findWorkingCodexCliCandidates()` before showing the install guidance error. If a working candidate is found, it is automatically saved to `claudeMirror.codex.cliPath` and the user is informed to retry. This handles the common case where the official Codex VS Code extension is installed (bundling the binary) but `codex` is not on PATH.

## 2026-03-18 - GPT-5.4 Codex support alignment

Updated Codex model/reasoning UX to align with current OpenAI model docs:

- Added `gpt-5.4` to the Codex model selector fallback options (`CodexModelSelector`).
  - Dynamic model loading from `~/.codex/models_cache.json` remains the primary source.
  - Fallback list now includes GPT-5.4 for cases where cache is missing/unreadable.
- Added explicit `none` reasoning effort support end-to-end:
  - `CodexReasoningEffort` type now includes `'none'`
  - Codex Reasoning selector now includes `None`
  - `claudeMirror.codex.reasoningEffort` enum in `package.json` now includes `none`
- Updated GPT context-window heuristics used by the webview context bar:
  - `gpt-5.4` / `gpt-5.4-pro` -> `1,050,000`
  - other `gpt-5*` -> `400,000`

Reference basis (official OpenAI docs):
- GPT-5.4 supports Codex/Codex CLI and includes `reasoning.effort=none`
- GPT-5.4 / GPT-5.4-pro use 1.05M context, GPT-5.3-codex uses 400K context

## 2026-02-25 - Codex image paste/send support

- Enabled image capability in `CodexMessageHandler` (`supportsImages: true`) so Codex tabs accept pasted image attachments in `InputArea`.
- Implemented `sendMessageWithImages` handling in `CodexMessageHandler` (posts a local user message with image blocks + sends the turn through the Codex runtime).
- Added Codex session/runtime support for image attachments:
  - `CodexSessionTab.sendWithImages(...)`
  - `CodexExecProcessManager` temp image file creation from webview base64 payloads
  - `codex exec` / `codex exec resume` args now include repeatable `--image <tempFile>` flags
  - temp image files are cleaned up after turn exit/error
- Result: pasted screenshots/images now send in Codex tabs (same InputArea UX as Claude mode).

## 2026-02-25 - Codex Git Push UI/Runtime support

- Enabled Git Push capability in `CodexMessageHandler` (`supportsGitPush: true`) so the status-bar Git button remains usable in Codex tabs.
- Added Codex handling for:
  - `gitPush` (runs the configured PowerShell script exactly like Claude flow)
  - `getGitPushSettings` (syncs `claudeMirror.gitPush.*` to the webview)
  - `gitPushConfig` (sends a configuration instruction prompt through the active Codex session)
- Result: Git controls no longer disappear or stay disabled in Codex tabs; they behave like the Claude path (subject to the user's gitPush configuration).

## 2026-02-23 - Stage 1 completed (Provider Foundation + UI Switch)

Completed only the first stage from `Codex_integration.txt`:

- Added VS Code settings:
  - `claudeMirror.provider` (`claude` / `codex`)
  - `claudeMirror.codex.cliPath`
  - `claudeMirror.codex.model`
- Added provider message types between extension and webview:
  - `setProvider` (webview -> extension)
  - `providerSetting` (extension -> webview)
  - `provider` field on `sessionStarted` (currently sent as `claude`)
- Updated Claude `MessageHandler` to:
  - persist provider selection in VS Code settings
  - send provider setting on webview `ready`
  - sync provider setting on config changes
- Added webview state fields:
  - `provider` (current tab provider)
  - `selectedProvider` (default provider for new sessions)
- Added UI in `StatusBar`:
  - `Codex` quick button
  - provider selector dropdown (`Claude` / `Codex`)
  - provider selection is persisted
- Added `ProviderSelector` component and matching CSS styles.

What was intentionally NOT implemented yet:

- No Codex runtime/process integration
- No provider-based tab routing (`TabManager` / commands)
- No capabilities gating / Codex-specific UI behavior changes

Claude behavior remains unchanged.

## Handoff Notes for Stage 2 (Codex Runtime MVP)

Important details already in place (do not break):

- `selectedProvider` in the webview store is the default provider for new sessions/tabs.
- `provider` in the webview store is the current tab/session provider.
- `providerSetting` message currently syncs only the default provider setting from VS Code config.
- Claude `MessageHandler` now sends `provider: 'claude'` on `sessionStarted` messages so the webview can track current tab provider.

Current UI behavior (Stage 1 only):

- The `Codex` button in the status bar currently only sets `claudeMirror.provider = codex`.
- It does **not** open a new tab or start a Codex runtime yet.
- The button is disabled while the current tab is busy (to match the plan direction and avoid switching during turns).

Stage 2 implementation guidance (to align with Stage 1 foundation):

- Keep Claude runtime path unchanged; add a separate Codex path (`Codex*` classes).
- When Codex runtime is implemented, Codex session/tab messages should send `provider: 'codex'` in `sessionStarted`.
- `claudeMirror.codex.cliPath` and `claudeMirror.codex.model` already exist in settings but are not used yet.
- Provider-based tab/session routing still needs to be added in `TabManager` and commands (`startSession`, later history/resume routing).

Verification note:

- `npm run build` passed after Stage 1 changes (extension + webview). A local shell/profile CLI module error may print after build output in this environment, but webpack compilation succeeded.

## 2026-02-23 - Stage 2 completed (Codex Runtime MVP: End-to-End Basic Chat)

Completed only the second stage from `Codex_integration.txt`:

- Added a separate Codex runtime path (parallel to Claude, without refactoring Claude path):
  - `src/extension/types/codex-exec-json.ts`
  - `src/extension/process/CodexExecProcessManager.ts`
  - `src/extension/process/CodexExecDemux.ts`
  - `src/extension/webview/CodexMessageHandler.ts`
  - `src/extension/session/CodexSessionTab.ts`
- Implemented Codex turn execution model:
  - first turn via `codex exec --json ... -`
  - follow-up turns via `codex exec resume --json <threadId> -`
  - prompt is passed through `stdin`
  - cancel kills only the current turn process (logical session stays in tab with `threadId`)
- Implemented text-first receive flow for Codex:
  - maps Codex `agent_message` to existing webview `messageStart` / `assistantMessage` / `messageStop`
  - maps `turn.completed.usage` to `costUpdate` (with `costUsd=0`) + `turnComplete`
  - basic command execution tracking (`command_execution`) is collected into `bashCommands`
- Routed tab/session creation by provider in Stage 2 scope:
  - `TabManager` can now create `Claude` or `Codex` tabs (`createTabForProvider`)
  - `claudeMirror.startSession` uses `claudeMirror.provider`
  - `claudeMirror.resumeSession` also routes by current provider setting
  - `toggleView` (when no active tab exists) creates a tab for current provider

What is intentionally NOT implemented yet (left for later stages):

- No Codex `SessionStore` persistence integration
- No Codex history loading from local session JSONL (`CodexConversationReader` not implemented yet)
- No provider field persisted in session metadata / analytics summaries yet
- `showHistory` is still Claude-oriented (not provider-aware)
- No capabilities UI gating yet (Claude-only features may still appear in Codex tabs)

Important implementation notes for the next developer (Stage 3: Session Store + History + Resume):

- Stage 2 `CodexSessionTab` keeps a logical session in-memory (`threadId`) but does **not** save it to `SessionStore` yet.
- Stage 2 `resumeSession` command routing is provider-based by current setting only; it does **not** infer provider from stored session metadata yet.
- `showHistory` still opens tabs via existing Claude-oriented flow; provider-aware history routing is still required.
- `TabManager.createTabForProvider(provider)` already exists and should be reused by Stage 3 history/resume routing.
- `CodexMessageHandler` and `CodexSessionTab` already send `provider: 'codex'` in `sessionStarted` messages (webview current-tab provider sync is working).
- `CodexExecDemux` is implemented against real observed `codex exec --json` events (`thread.started`, `turn.started`, `item.started/completed`, `turn.completed`) from local CLI runs.
- Codex CLI may emit non-fatal warnings on `stderr` (example: PowerShell shell snapshot warning). Current Codex tab logic ignores the known shell-snapshot warning pattern.
- When adding `provider` to `SessionStore` metadata, keep backward compatibility exactly as planned:
  - missing `provider` => treat as `claude`
- Stage 3 should preserve existing Claude history/resume behavior for legacy entries (no migration breakage).

Verification note:

- `npm run build` passed after Stage 2 changes (extension + webview). The same local shell/profile CLI noise may appear after build output in this environment, but webpack compilation succeeded.

## 2026-02-23 - Stage 3 completed (Session Store + History + Resume for Codex)

Completed only the third stage from `Codex_integration.txt`:

- Added `provider` to `SessionStore` metadata (`claude` / `codex`) with backward compatibility:
  - old entries missing `provider` are treated as `claude`
  - `getSession()` / `getSessions()` normalize legacy entries on read
- Updated Claude session metadata saves to persist `provider: 'claude'`
- Added `src/extension/session/CodexConversationReader.ts`:
  - reads local Codex JSONL history from `~/.codex/sessions`
  - best-effort parser (permissive, ignores unknown shapes, returns `[]` on parse/read issues)
  - prefers newest matching file and tries to match `cwd` (via `session_meta`) when available
- Updated `CodexSessionTab` to Stage 3 behavior:
  - restore stored session name/metadata on resume
  - load and send Codex conversation history to webview on resume
  - persist Codex session metadata to `SessionStore` (`provider: 'codex'`) when thread ID arrives / turns complete
- Updated commands (`showHistory` / `resumeSession`) to be provider-aware:
  - `showHistory` displays provider in QuickPick (`Claude | ...` / `Codex | ...`)
  - history selection opens the correct tab type via `TabManager.createTabForProvider(...)`
  - manual `resumeSession` now prefers stored provider when the session ID already exists in `SessionStore` (fallback: current provider setting)

What is intentionally NOT implemented yet (left for later stages):

- No `providerCapabilities` message from extension to webview yet
- No UI gating/hiding for unsupported Codex MVP features yet (Plan Approval / Fork / Compact / Claude-only permission mode)
- No provider-specific model selector rendering changes yet (Claude vs Codex conditional UI)
- No analytics `SessionSummary.provider` persistence yet (planned later stage)

Important implementation notes for the next developer (Stage 4: Capabilities + UI Gating):

- `provider` in webview state = current tab/session provider (comes from `sessionStarted.provider`).
- `providerSetting` message = default provider setting for new tabs/sessions (VS Code config), not the current tab provider.
- History/resume routing is now provider-aware and should stay that way:
  - `showHistory` uses stored metadata provider
  - legacy entries without provider still resolve to Claude via `SessionStore` normalization
- Codex tabs currently still show some Claude-only UI actions; many are already rejected in `CodexMessageHandler` with explicit "not supported in Codex MVP yet" errors, but Stage 4 should hide/disable them in the UI instead of relying on runtime errors.
- `CodexConversationReader` is intentionally best-effort (local format may change). If Stage 4 touches replay-related UX, do not assume strict Codex JSONL schema stability.
- Keep Claude path unchanged where possible; Stage 4 should mainly add capability plumbing (`providerCapabilities`) and conditional rendering/gating in webview.

## 2026-02-25 - Codex auto session naming parity

- Added `src/extension/session/CodexSessionNamer.ts` to mirror Claude's first-message auto naming behavior for Codex tabs.
- `CodexSessionTab.sendText()` now triggers a one-shot naming request on the first user prompt (honors `claudeMirror.autoNameSessions`).
- Naming runs through `codex exec --json` with read-only sandbox and `model_reasoning_effort=medium`, using the same workspace/session `cwd` as normal Codex turns, then updates:
  - tab title
  - persisted session metadata (when `threadId` exists / later on thread start via `baseTitle`)
  - per-tab file log name (`FileLogger.updateSessionName`)
- Parser accepts the common `agent_message.item.text` shape and a fallback `agent_message.item.content[]` text shape.
- Fixed Codex tab-title race: if auto-naming returns before `thread.started`, `CodexSessionTab` now defers metadata save and reapplies the generated name when the thread ID arrives instead of overwriting it with `Codex [id]`.
- Manual tab rename in Codex tabs now also persists the session name into `SessionStore` (not only the visible tab title / log filename).
- Failures/timeouts are non-fatal and only logged, matching Claude-style best-effort behavior.

Verification note:

- `npm run build` passed after Stage 3 changes (extension + webview). The same local shell/profile CLI noise may appear after build output in this environment, but webpack compilation succeeded.

## 2026-02-23 - Stage 4 completed (Capabilities + UI Gating for Codex MVP)

Completed only the fourth stage from `Codex_integration.txt`:

- Added `providerCapabilities` to the extension <-> webview message contract.
- Claude and Codex handlers now send provider capability flags on webview `ready`:
  - Claude: feature flags mostly `true`
  - Codex MVP: disables unsupported features (plan approval, fork, compact, permission selector, etc.)
- Added `providerCapabilities` to webview Zustand state and wired handling in `useClaudeStream`.
- Added UI gating so Codex tabs no longer show unsupported/broken controls:
  - hide Plan Approval bar
  - hide Fork action in message UI
  - hide Claude permission mode selector
  - conditional provider-specific model selector rendering (Claude `ModelSelector` vs new `CodexModelSelector`)
- Also hid other currently broken Codex UI controls already rejected at runtime by `CodexMessageHandler` (to keep Codex tab intentional):
  - translation button
  - prompt enhancer UI / auto-enhance path
  - git push controls
  - Codex consult button/panel
- Clipboard image-paste diagnostics were later added in `InputArea` (`uiDebugLog` -> `Output -> ClaUi`) and were used to confirm the earlier Codex image block (`supportsImages: false`) before the follow-up runtime support was implemented.

What is intentionally NOT implemented yet (left for later stages):

- No `provider` field persisted in analytics `SessionSummary` yet
- No analytics/dashboard schema updates for mixed Claude/Codex summaries yet
- No dedicated regression matrix execution/documentation yet (manual QA still needed)

Important implementation notes for the next developer (Stage 5: Analytics + Hardening + Regression Testing):

- `providerCapabilities` now controls the Codex UX; prefer adding new UI gates via capabilities instead of scattering `if (provider === 'codex')` checks.
- Capability flags are sent by both handlers on webview `ready`, and the webview stores them in `providerCapabilities`.
- Webview `reset()` currently preserves both `provider` (current tab provider) and `providerCapabilities` so a Codex tab stays correctly gated after clear/reset.
- Codex runtime already emits basic turn telemetry (`bashCommands`, tokens when available, `costUsd=0`) into webview `turnComplete`; Stage 5 should focus on persisting/aggregating analytics with provider support, not reworking the runtime mapping.
- `supportsCompact` is included in capabilities plumbing, but there is no visible compact button in the current webview UI to gate yet.
- History/resume/provider routing from Stage 3 should be kept intact while running the Stage 5 regression matrix (especially legacy sessions without `provider` -> Claude fallback).

## 2026-02-25 - Codex permission mode wiring (write access fix)

Root cause fixed:

- Codex tabs were not forwarding `claudeMirror.permissionMode` to the `codex exec` CLI, so Codex fell back to the user's local CLI/config defaults (which can be read-only).

What changed:

- `CodexExecProcessManager` now reads `claudeMirror.permissionMode` and maps it to Codex CLI flags:
  - `full-access` -> `--dangerously-bypass-approvals-and-sandbox`
  - `supervised` -> `--sandbox read-only`
- `CodexMessageHandler` now enables the Permission Mode selector in Codex tabs and handles `setPermissionMode` / `permissionModeSetting` sync.

Operational note:

- This change requires packaging + installing the extension (`npm run deploy:local`) and a VS Code window reload. `npm run build` alone only updates local `dist/` and does not update the installed extension copy under `~/.vscode/extensions/`.

Verification note:

- `npm run build` passed after Stage 4 changes (extension + webview). Standard webpack size warnings remain.

## 2026-02-23 - Stage 5 completed (Analytics + Hardening + Regression Smoke)

Completed only the fifth stage from `Codex_integration.txt`:

- Added `provider` to project analytics session summaries (`SessionSummary.provider`).
- Updated analytics persistence for Claude and Codex summaries:
  - Claude summaries now save `provider: 'claude'`
  - Codex summaries now save `provider: 'codex'`
- Implemented Codex project analytics summary persistence in `CodexSessionTab`:
  - summary build/save on logical session stop
  - summary build/save on clear (before reset)
  - summary build/save on tab dispose/close
  - double-save guard for the same logical session (`analyticsSaved`)
- Added backward-compatible analytics normalization in `ProjectAnalyticsStore`:
  - legacy stored summaries missing `provider` are treated as `claude`
  - mixed old/new analytics summaries remain readable/sortable
- Codex command telemetry mapping for turn records remains active and was hardened slightly:
  - `command_execution` -> `bashCommands` (ignores blank command strings)
  - tokens preserved when present from `turn.completed.usage`
  - `costUsd=0` / `totalCostUsd=0` remain explicit for Codex turns

Regression matrix execution status (Stage 5):

- `npm run build` passed after Stage 5 changes (extension + webview).
- Manual VS Code UI regression matrix was **not fully executable in this headless terminal environment** (no interactive VS Code/webview session available here).
- Verified by codepath review + build smoke:
  - Claude flow unchanged in runtime path (parallel Codex changes only; Claude summary now adds provider field)
  - provider switching plumbing unchanged from Stage 4
  - Codex turn telemetry path still emits `turnComplete` with tokens / `bashCommands` / explicit zero cost
  - mixed analytics summary migration hardened (legacy missing `provider` => Claude fallback)
  - dashboard/vitals compile path stable (`SessionSummary` type updated and build succeeds)

Remaining manual QA to run in VS Code before merge (interactive):

- Claude flow unchanged
- provider switching
- Codex start/send/cancel/resume/history
- mixed history migration (SessionStore + analytics data)
- dashboard/vitals stability with mixed Claude/Codex summaries

## 2026-02-23 - Post-Stage 5 follow-up (Codex UX + Runtime Hardening + Reasoning Effort)

Follow-up changes implemented after Stage 5 based on interactive VS Code testing:

- Provider quick buttons (`Claude` / `Codex`) in the status bar now open a **new tab** for the selected provider (not just change the default provider setting):
  - added `openProviderTab` webview -> extension message
  - extension handlers update `claudeMirror.provider` and then execute `claudeMirror.startSession`
  - button behavior prevents tab spam when the current tab is already that provider
- Added focused diagnostics/logging for provider switching and Codex startup debugging:
  - webview button click diagnostics (`diag`) for provider quick buttons
  - extension-side logs for provider setting save success/failure and config change propagation
  - webview debug logging for selected outbound messages (`setProvider`, `openProviderTab`, `startSession`)

Codex runtime hardening (observed during manual testing):

- Fixed a false-positive Codex error in UI for `rg` commands with `exit 1` (ripgrep "no matches found"):
  - `rg`/`rg.exe` exit code `1` is now treated as non-fatal in Codex command telemetry mapping
- Added stdout tail flush on Codex process exit:
  - if the final JSONL event arrives without a trailing newline, it is now parsed on process exit instead of being dropped
- Added extra Codex turn diagnostics:
  - logs outbound `sendMessage` preview/length in `CodexMessageHandler`
  - surfaces an explicit error if `turn.completed` arrives without any `agent_message` event (instead of silent no-response)

Codex reasoning effort support (new user-facing capability):

- Added Codex reasoning effort setting + UI selector (`None` / `Low` / `Medium` / `High` / `Extra High`, plus `Default`)
- New VS Code setting:
  - `claudeMirror.codex.reasoningEffort` (`'' | none | low | medium | high | xhigh`)
- Codex webview handler now syncs this setting to/from the webview (`setCodexReasoningEffort` / `codexReasoningEffortSetting`)
- `CodexExecProcessManager` now forwards reasoning effort to the Codex CLI using:
  - `-c model_reasoning_effort=<value>`
  - applied to both first-turn (`codex exec`) and follow-up (`codex exec resume`) runs

Verification note:

- `npm run build` passed after these follow-up changes (extension + webview).

## 2026-02-25 - Prompt History parity fix (Codex)

- Fixed Codex prompt history panel project/global tabs not loading in Codex tabs:
  - `CodexMessageHandler` now handles `getPromptHistory` and returns `promptHistoryResponse`
- Added prompt history persistence for Codex `editAndResend` path so edited prompts also enter shared project/global history
- Result: prompt history is now shared/visible across Claude + Codex modes via the same `PromptHistoryStore`

## 2026-02-25 - Codex "stuck" UI fix (webview message ordering race)

- Investigated stuck-looking Codex tabs where the CLI had already completed (`agent_message` + `turn.completed`, exit code `0`) but the webview showed no reply / transient thinking only.
- Root cause was a UI ordering race in Codex mode:
  - `CodexExecDemux` can emit `item.completed(agent_message)` and `turn.completed` back-to-back
  - `CodexMessageHandler` was posting multiple webview messages immediately (`messageStart`, `streamingText`, `assistantMessage`, `messageStop`, `costUpdate`, `turnComplete`, `processBusy=false`) without serialization
  - under unlucky ordering, the webview could finalize/clear before the synthetic Codex message sequence was fully applied
- Fix:
  - added a small FIFO `postToWebview(...)` queue inside `CodexMessageHandler`
  - routed Codex live turn lifecycle messages (user send/busy, demux `turnStarted`, `agentMessage`, `turnCompleted`, demux errors, command-error UI) through the queue
  - preserves event order at the extension->webview boundary and prevents lost/missing Codex replies caused by end-of-turn reordering

### Follow-up (same day): reproduction still observed after FIFO fix

- Reproduced again on tab `המשך פריסה לשרת` (user reported last message at ~11:27 local time; extension/per-tab logs show ~09:27 because log line timestamps are UTC-style while file names are local time).
- Logs confirmed the turn was fully successful end-to-end on the CLI + extension side:
  - `Codex agent_message` emitted
  - `Codex JSON: turn.completed`
  - `setBusy(false) prev=true`
  - process exit `code=0`
  - Codex JSONL file contains the full `agent_message` final text and `task_complete`
- Added a second hardening layer in the webview (`useClaudeStream`):
  - when provider is Codex and an `assistantMessage` arrives while a streaming message is active, immediately `addAssistantMessage(...)` (upsert by message ID) in addition to updating the snapshot
  - this preserves the reply even if `messageStop` / `costUpdate` / `processBusy(false)` finalize/clear ordering is still unlucky at the webview boundary

### Follow-up (same day): reproduction still observed again (`בעיית גישה מקומית`, ~12:04 local)

- New repro still showed the same pattern in logs for Codex Tab 2:
  - `Codex agent_message`
  - `Codex JSON: turn.completed`
  - `setBusy(false) prev=true`
  - process exit `code=0`
- User observation strongly narrowed scope further:
  - after `Developer: Reload Window`, the missing live replies appear in the conversation history
  - this indicates messages are being persisted/available, but live webview delivery/render synchronization is failing
- Added a third hardening layer at the actual VS Code webview boundary (`CodexSessionTab`):
  - `CodexSessionTab.postMessage()` no longer fire-and-forgets `void panel.webview.postMessage(msg)`
  - it now queues deliveries and awaits the VS Code `Thenable<boolean>` from `panel.webview.postMessage(...)`
  - `flushPendingMessages()` also routes through the same queue
  - this preserves message order at the real async delivery layer (not only at `CodexMessageHandler` call order)

## 2026-03-02 - Codex long-session "stuck" turn recovery hardening

- Investigated recurring reports where long Codex sessions appear idle/stuck and follow-up sends fail with `A Codex turn is already running`.
- Added runtime recovery in `CodexSessionTab`:
  - turn-complete exit watchdog (`10s`) now force-stops lingering Codex processes that do not exit after `turn.completed`
  - `sendTurn(...)` now detects stale idle-running state (`isTurnRunning=true` while tab busy state is false) and force-stops before retrying the new turn
- Added busy-state alignment in `CodexMessageHandler`:
  - introduced `CodexSessionController.isTurnRunning()`
  - send failure paths (`sendMessage`, `sendMessageWithImages`, `gitPushConfig`) now set `processBusy` based on real runtime state instead of forcing `false`
- Goal of these changes:
  - prevent false-idle UI while a process is still alive
  - reduce stuck loops where new sends are blocked by a zombie/lingering process

## 2026-03-05 - Codex live reply missing fix (message-id reuse across turns)

- Reproduced "stuck" reports where Codex actually completed the turn and wrote the reply to history/jsonl, but the live webview did not show a new assistant bubble.
- Root cause:
  - Codex `agent_message.id` values are not globally unique across a session (frequent repeats like `item_1` on later turns).
  - webview state uses assistant `messageId` for upsert semantics, so reused IDs caused new replies to overwrite earlier assistant messages instead of appending.
- Fix in `CodexMessageHandler`:
  - stop using raw `agent_message.id` as the UI message ID
  - always generate a fresh UI message ID via `nextMessageId()` per emitted assistant message
  - keep raw Codex ID in logs (`rawId=...`) for diagnostics
- Result:
  - completed replies now consistently appear live in long Codex sessions instead of being silently overwritten in-place.

## 2026-03-05 - Codex mid-turn steer support (Stop + Steer parity)

- Implemented approved mid-turn steering for Codex tabs instead of hard-failing with `A Codex turn is already running`.
- Webview/Input changes (`InputArea.tsx`):
  - when provider is Codex and a turn is active, button labels now match Codex UX intent: `Stop` + `Steer`
  - pressing `Steer` is now a two-step flow (`Steer` -> `Confirm Steer`) before dispatch
  - steer sends now carry `steer: true` on `sendMessage` / `sendMessageWithImages`
  - auto-enhance / prompt-translate interception is skipped while Codex is busy so steer action is immediate
- Message contract update (`webview-messages.ts`):
  - added optional `steer?: boolean` on `SendTextMessage` and `SendMessageWithImages`
- Runtime/session changes:
  - `CodexMessageHandler` now enforces steer gating when a Codex turn is active+busy (non-steer sends are rejected with a steer/stop hint)
  - `CodexSessionTab.sendTurn(...)` now accepts steer mode and performs: cancel current turn -> wait for stop (timeout guarded) -> dispatch new turn
  - this preserves the existing stale-idle recovery path while adding explicit behavior for true in-flight turns
- Result:
  - users can send guidance mid-turn in Codex tabs with explicit approval, matching expected `Stop`/`Steer` workflow.

## 2026-03-05 - Claude <-> Codex Mid-Session Handoff Implemented

Implemented cross-provider switching with structured context transfer (`Handoff Capsule`) instead of unsupported cross-provider hidden-memory resume.

### Delivered

- New extension handoff module:
  - `HandoffTypes`, `HandoffContextBuilder`, `HandoffPromptComposer`, `HandoffArtifactStore`, `HandoffOrchestrator`.
- `TabManager.handoffSession(...)`:
  - source busy guard
  - per-tab lock + cooldown
  - stage progress logging and UI updates
  - source/target metadata linking in `SessionStore`
- `SessionTab` + `CodexSessionTab` additions:
  - `collectHandoffSnapshot()`
  - `waitForNextAssistantReply()`
  - handoff-aware provider/busy accessors
- Webview protocol and UX:
  - new request: `switchProviderWithContext`
  - new event: `handoffProgress`
  - status bar action split: `Switch (Carry Context)` vs clean provider-open path
  - input lock during active handoff stages
  - failed-handoff fallback: copy capsule prompt for manual send
- Explicit command palette flow:
  - `ClaUi: Switch Provider (Carry Context)`
- New settings:
  - `claudeMirror.handoff.enabled`
  - `claudeMirror.handoff.storeArtifacts`

### 2026-03-05 - Handoff flow correction: no automatic model prompt on switch

- Updated provider handoff to be UI-only during switch (no immediate LLM prompt injection).
- New behavior:
  - handoff capsule/prompt is staged as deferred context in target tab runtime
  - first user `sendMessage` (or image send) in target tab carries that staged context
  - staged context is consumed after the first successful user send
- This prevents unintended autonomous execution right after provider switch and keeps the UX aligned with normal chat turns.

### Known Limitations

- Cross-provider transfer remains prompt/capsule based; no shared internal model memory is possible.
- Metadata linking depends on available persisted session IDs; very early failures may produce partial linkage.
- Capsule quality depends on recoverable text/history; very long sessions are deterministically truncated and marked `truncated=true`.
