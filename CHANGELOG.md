# ClaUi - Changelog

## v0.1.180 - 2026-05-29

**Feature: Claude Opus 4.8 model support**

- Added `claude-opus-4-8` as a first-class option in the status-bar model selector and the `claudeMirror.model` enum, rendered as **Opus 4.8**
- Model display normalization (`claudeModelDisplay.ts`) now infers labels generically from the model id (e.g. `claude-opus-4-8` -> `Opus 4.8`), so the AI chip, assistant message badges, and dashboard metadata render correctly even without an explicit table entry
- Selecting a model id directly in `settings.json` that is not in the option list surfaces a synthetic `Custom (<label>)` entry so the dropdown can still display the active selection
- Live model switching preserved: at session start the process restarts **fresh** with the new model; mid-session it stops and **resumes** (`--resume <id> --model <id>`) so the conversation is retained. A switch also re-reads the current effort/fast-mode config

**Fix: Model selection reflects immediately in the AI chip**

- Picking a model now updates the chip instantly instead of waiting for the CLI to report it on the next turn. The chip resolves `displayModel = selectedModel || model` (optimistic user choice first, CLI-reported model as fallback)

**Feature: Claude thinking effort levels**

- New `Effort` dropdown (`ClaudeEffortSelector.tsx`) directly below the model selector in the AI chip, with levels `Default / Low / Medium / High / Extra High / Max`
- Maps to the Claude CLI `--effort <level>` flag (verified on CLI v2.1.152+); `Default` (`""`) passes no flag and uses the model default (High for Opus 4.8)
- New setting `claudeMirror.effortLevel` (string enum, default `""`). Effort is always sourced from config, so it applies on the next session start (including the fresh restart performed by a model switch)
- New message types: `setClaudeEffort` (webview -> extension), `claudeEffortSetting` (extension -> webview). Store state `selectedClaudeEffort`
- `ultracode` (Claude Code's session-only xhigh + dynamic-workflow mode) is intentionally **not** modeled as an effort level — only the persistent `--effort` levels are surfaced

**Feature: Claude Fast mode**

- New `Speed` selector (`ClaudeFastModeSelector.tsx`) in the AI chip (Claude tabs only) with options `Default` and `Fast`, mirroring the existing Codex Speed selector
- Fast mode delivers ~2.5x faster output on Opus models (4.8/4.7/4.6) at higher cost; it has no effect on Sonnet/Haiku (the UI does not block selecting it there)
- New setting `claudeMirror.fastMode` (boolean, default `false`). Applies when the next session starts
- Applied by writing a small settings overlay file (`{"fastMode":true}`) to global storage and passing it as `--settings "<path>"`. A quoted file path is used rather than an inline JSON string because, on Windows `cmd.exe` via `shell: true`, the JSON string gets mangled (quotes stripped) while a quoted path survives intact
- A lightning indicator (`↯`) appears in the AI chip while fast mode is active, with a "Fast mode enabled (~2.5x output speed)" tooltip
- New message types: `setClaudeFastMode` (webview -> extension), `claudeFastModeSetting` (extension -> webview). Store state `selectedClaudeFastMode`
- New detail doc consolidating all three controls: `Kingdom_of_Claudes_Beloved_MDs/CLAUDE_MODEL_CONTROLS.md`

**Improvement: Usage tracking verified and clarified under the new model controls**

- Confirmed the **usage-remaining widget** (`UsageWidget` / `UsageFetcher`) is unaffected: utilization is computed server-side by the Anthropic OAuth usage API, so Opus 4.8, effort, and fast-mode cost are already reflected in the percentages it shows. Opus 4.8 spend rolls into the existing `*_opus` buckets
- Confirmed the **Token Ratio dashboard** (`TokenUsageRatioTracker`) handles Opus 4.8 with no change — `normalizeModelCategory()` matches via `.includes('opus')`, so 4.8 lands in the `opus` per-model buckets. Effort is captured automatically as output tokens (weighted 5x); it raises volume, not the weight structure
- Documented that fast mode's per-token price premium is not modeled in the cost weights — it is absorbed by the server utilization signal, so `tokensPerPercent` correctly dips while fast mode is active (quota burns faster). Per-fast-mode bucketing is infeasible since the usage API only splits buckets by period + model
- Updated the `COST_WEIGHTS` comment in `TokenUsageRatioTracker.ts` and added a one-line interpretation note to the Token Ratio tab's cost-weight info box so the metric is read correctly when effort/fast mode are active
- Updated detail docs: `ANALYTICS_DASHBOARD.md` (new "Interaction with Model, Effort, and Fast Mode" section + usage-tab note) and `CLAUDE_MODEL_CONTROLS.md` (new "Impact on usage tracking" cross-reference)

---

## v0.1.173 - 2026-05-24

**Feature: Super Particle Accelerator (SPA) — hook-based secret write guard**

- New security system that intercepts every AI agent write operation (Edit, Write, MultiEdit, Bash, MCP tool calls) and blocks attempts to write secrets into the codebase
- Installs hooks into both Claude Code (`.claude/settings.json`) and Codex (`.codex/hooks.json`) that run before and after tool operations, scanning for secrets and blocking or auditing operations that contain them
- **Three-layer architecture**: Runtime layer (standalone Node.js hook scripts, separate webpack target, no VS Code dependencies), Extension layer (lifecycle management, hook install/uninstall, env vars, audit reader, exception management), UI layer (React status badge and settings/audit panel in StatusBar)
- **Deny-first policy engine** (`SecretWritePolicyEngine`) with 5 waterfall gates: Gate 0 (no findings -> allow), Gate 1 (all placeholders/low-confidence -> allow), Gate 2 (public/client path -> hard deny, no exceptions, ignores audit mode), Gate 3 (gitignored env file + `allowIgnoredEnvFiles` -> audit), Gate 4 (covered by valid exception -> audit), Default (deny or audit based on mode)
- **Path classification** (`PathClassifier`): classifies file paths into 5 risk categories — `public-client-code`, `generated-public-artifact`, `server-code`, `local-secret-file`, `unknown-repository-file`. Public paths (`public/`, `dist/`, `build/`, `static/`, `client/`, `frontend/`, `web/`, `*.bundle.js`, `*.min.js`) are hard-denied with no exception bypass
- **Git state scanning** (`GitStateScanner`): scans staged, unstaged, and untracked files; blocks `git add`/`commit`/`push` when secrets are detected; verifies `.env` files are actually gitignored via `git check-ignore` before allowing through Gate 3
- **Baseline deduplication** (`BaselineStore`): per-session baseline JSON so Stop hook only reports new findings, not pre-existing secrets in the working tree
- **Exception system** (`ExceptionLoader`, `SpaExceptionStore`): scoped temporary approvals with atomic write and `consumeMany` support
- **Audit trail** (`AuditWriter`): JSONL audit files at `<storeDir>/audit/YYYY-MM-DD.jsonl` with safe redaction (max 25% revealed, capped at 8 chars, SHA-256 hash of raw value)
- **Security properties**: Fail-closed on PreToolUse (timeouts/errors produce deny), fail-open on PostToolUse/Stop, large content truncation at 2MB (scanned, not skipped), configurable entropy threshold (default 4.2), SPA hooks ordered before PA hooks
- **File-based runtime activation**: `runtime-enabled.json` enables mid-session toggling for tabs spawned before SPA was enabled — their env vars are fixed from spawn time but they discover the file-based settings as fallback
- **Hook events**: PreToolUse (edit/write/bash/mcp, fail-closed), PermissionRequest (Codex Bash, fail-closed), PostToolUse (Bash output, audit-only, fail-open), Stop (working tree scan, baseline-filtered, fail-open)
- Two entry points: `claude-spa.js` and `codex-spa.js`, built as a fourth webpack target (`super-particle-accelerator-runtime`)
- 11 VS Code settings under `claudeMirror.superParticleAccelerator.*` (enabled, mode, scanEditTools, scanBashCommands, scanMcpTools, scanWorkingTreeOnStop, blockGitCommitPush, allowIgnoredEnvFiles, entropyThreshold, frontendPathGlobs, allowedSecretFileGlobs). Feature disabled by default
- 77 tests across 10 test files: policy engine gates, path classification, scanner + redaction, JSONL audit writing, exception loading, baseline store, entropy threshold wiring, runtime settings, gitignore bypass security, large content truncation security
- New files: 7 extension services in `src/extension/super-particle-accelerator/`, 8 runtime modules in `src/super-particle-accelerator-runtime/` (+ `hooks/`), 2 webview components, 1 shared types file
- New detail doc: `Kingdom_of_Claudes_Beloved_MDs/SUPER_PARTICLE_ACCELERATOR.md`

**Feature: Secret Protection Demo — comprehensive test suite for secret detection**

- End-to-end demo test runner (`run-demo-test.ts`) that exercises all scanner, policy engine, and redaction layers against 15+ categorized fixture files
- **Fixture categories**: code files (hardcoded secrets, config with credentials, connection strings, GCP service accounts), git files (staged secrets diffs, credential output), PII files (user data, payment data, internal network references), command files (exfiltration, risky, safe), clean files (benign URLs, normal code, public config, readme text), crypto (fake JWT tokens), protected paths
- HTML report generator (`generate-html-report.ts`) produces a visual summary of all scan results with per-fixture breakdown, finding counts, and redaction samples
- Test manifest (`fixtures/manifest.json`) with 621 lines defining expected findings per fixture for regression testing
- `results/` directory with `.gitignore` for generated output

---

## v0.1.171 - 2026-05-22

**Feature: Secret Protection Broker — multi-boundary DLP system**

- Comprehensive data loss prevention layer that protects 13 boundaries where secrets can leak from an AI coding agent session: prompt submission, context attachment, file reads, command preflight/output, git diff/publish, MCP request/response, browser capture, persistence writes, telemetry/diagnostic export
- **Destination-aware policy**: the correct action (block, redact, warn, allow) depends on the destination kind — 9 destination types: `local_agent`, `remote_model_provider`, `terminal_stdout_to_agent`, `local_disk`, `git_remote`, `mcp_server`, `browser_context`, `telemetry_backend`, `diagnostic_export`

**6 scanners** (`src/shared/secret-protection/scanners/`):

- `CompositeSecretScanner` — orchestrator that runs all sub-scanners and deduplicates findings
- `RegexRuleScanner` — 14 rule packs covering AWS/Azure/GCP cloud secrets, GitHub/OpenAI/Anthropic/Slack/Stripe provider keys, private keys, git credentials, exfiltration commands, internal network topology, PII, protected paths
- `EntropyScanner` — Shannon entropy analysis for high-entropy strings that may be secrets, with configurable threshold
- `EnvValueScanner` — matches environment variable values against content
- `PathSensitivityClassifier` — classifies file paths by sensitivity (`.env`, `.pem`, `.key`, `.ssh/`, `.aws/`)
- `PiiAndInternalTopologyScanner` — detects internal hostnames, IP ranges, and personally identifiable information
- `StructuredPayloadScanner` — detects secrets inside JSON, YAML, and structured payloads; includes browser capture detection for Codex sessions

**Core engines**:

- `PolicyEngine` — destination-aware decision matrix that maps (finding severity x destination trust tier) to action (block/redact/warn/allow)
- `RedactionEngine` — produces structured `<REDACTED type="..." id="sec_xxxx" source="..." length="..." />` tokens with safe partial reveal
- `AuditEventWriter` — append-only JSONL audit with no raw secret values (only hashes, rule IDs, counts)
- `CommandRiskClassifier` — classifies shell commands into risk classes (network_upload, credential_discovery, data_exfiltration) with severity and approval requirements
- `DestinationClassifier` — maps runtime context to destination kind and trust tier
- `ApprovalEngine` — interactive approval flow for medium-risk operations with scoped temporary exceptions
- `ComplianceReporter` — generates summary reports from audit log data

**4 boundary scanners**:

- `ExtensionOutboundScanner` — scans extension-to-model traffic (prompt assembly, context injection)
- `ServerOutboundScanner` — scans server-side payloads (multi-participant session routing)
- `GitPublicationScanner` — scans git diff/add/commit/push for secrets before publication to remotes
- `WebviewOutboundScanner` — scans webview-originated content (browser captures, user prompt text)

**UI surfaces**:

- `SecretProtectionStatusBadge` in StatusBar showing DLP status
- `SettingsPanel` with DLP mode selector (off/observe/balanced/strict) and boundary toggles
- `AuditLogPanel` showing audit events with timeline and filtering
- `OutboundManifestPanel` showing outbound content manifest
- Message-level DLP badges: "Secrets" badge when `secretsDetected` is true, "Redacted" badge when `redactionApplied` is true, rendered on `MessageBubble`
- Codex sessions receive DLP instructions explaining `<REDACTED ... />` tokens

**Configuration**: 11 VS Code settings under `claudeMirror.secretProtection.*` (enabled, mode, blockProtectedPaths, scanPrompts, scanTerminalOutput, scanGitPublication, scanMcp, requireBrowserCaptureApproval, exceptionMaxMinutes, auditRetentionDays, enableEntropyScanner). Optional project-level policy at `.claui/secret-protection.policy.json`

- 30+ tests across scanners, policy engine, redaction engine, audit writer, approval engine, Git publication, multi-way redaction, backward compatibility
- New detail docs: `Kingdom_of_Claudes_Beloved_MDs/SECRET_PROTECTION_BROKER.md`, `Kingdom_of_Claudes_Beloved_MDs/DLP_SETUP.md`

**Feature: Workstream Map — Git commit ingestor**

- New `GitCommitIngestor` that reads recent git commits and feeds them into the Workstream Map classification pipeline, providing richer session-to-workstream mapping based on actual code changes

**Improvement: Particle Accelerator hook enhancements**

- PA pre-tool-use hooks for both Claude and Codex now integrate with the Secret Protection Broker, scanning tool arguments for secrets before allowing execution
- Codex PermissionRequest hook added for Bash commands
- Codex `codex exec` now receives DLP-related system instructions when Secret Protection is enabled

**Improvement: Documentation archive reorganization**

- Moved obsolete plan documents, duplicate folder copies, and completed implementation plans into `Kingdom_of_Claudes_Beloved_MDs/Archive/` with subdirectories for `duplicate-folders/`, `html-content/`, and `plans/`
- Added `Archive/README.md` explaining the archive structure
- Generated `DOCS_AUDIT_REPORT_2026-05-19.md` documenting the cleanup decisions

**Improvement: Model display updates**

- Claude model display labels updated: `claude-opus-4-6` renders as `Opus 4.6` (previously showed raw model ID)
- Codex model selector and Smart Search view updated to use consistent display normalization

---

## v0.1.167 - 2026-05-19

**Feature: Vertical Tab Rail enhancements**

- **Native tab hiding**: When vertical tab mode is active, VS Code's native horizontal tab strip is automatically hidden (`workbench.editor.showTabs` set to `'none'`). The original value is saved and restored when switching back to horizontal mode, when a regular document gets focus, or on extension shutdown. Re-entering a ClaUi panel re-hides the native tabs automatically
- **Resizable rail width**: The vertical tab rail can now be resized by dragging the handle on its right edge (80px-300px range). Double-click the handle to reset to the CSS default (`clamp(96px, 28vw, 132px)`). Width is stored in Zustand state and applied as a CSS custom property override
- **Multi-participant tab support**: The vertical tab rail now appears on multi-participant session tabs. Previously, only chat and search tabs showed the rail. `wrapWithRail()` was lifted to the `App` component level so all tab kinds are wrapped uniformly. Added `requestTabList`, `focusTab`, `closeTab`, `reorderTabs`, and `setTabLayout` message handlers to `MultiParticipantSessionTab.ts`
- **Document focus restore**: When a regular document (TextEditor) gains focus while vertical mode is active, native tabs are restored so the document's tab strip is visible. Returning to a ClaUi panel re-hides them. Uses `onDidChangeActiveTextEditor` and `WebviewPanel.onDidChangeViewState` listeners
- **Hover-to-close button**: The provider letter (C for Claude, X for Codex, H for Happy) on each vertical tab item becomes a red X close button on hover. Clicking it sends `closeTab` to the extension, which disposes the tab. Uses CSS `::after` content swap with `data-letter` attribute
- **Drag-and-drop reordering**: Tabs in the vertical rail can be reordered by dragging them up or down. A blue drop indicator line shows the target position during drag. On drop, the new order is persisted via `orderInGroup` on each snapshot entry. New command: `claudeMirror.tabs.reorder`, new message type: `reorderTabs`
- New commands: `claudeMirror.tabs.close`, `claudeMirror.tabs.reorder` (both hidden from command palette)
- New message types: `CloseTabRequest`, `ReorderTabsRequest`

---

## v0.1.145 - 2026-05-13

**Feature: Particle Accelerator — local command output compressor for AI agent sessions**

- New system that intercepts Bash commands from coding agents (Claude/Codex), runs them through a local `claui-run` CLI, and returns compressed, secret-redacted output — reducing token consumption by 2-8x per command
- Three execution contexts: Extension host (orchestration), standalone `claui-run` CLI (separate webpack bundle, total network isolation), and webview (monitoring dashboard)
- **Secret redaction**: Two-phase approach — exact env variable value matching (longest-first) plus 14 regex rules for GitHub PATs, AWS keys, JWTs, OpenAI keys, Anthropic keys, Slack tokens, Stripe keys, Google API keys, private key blocks, basic auth URLs, DB URL creds, bearer tokens. Fail-closed: on error, entire output is suppressed
- **7 output filters**: Generic fallback (ANSI strip, spinner removal, duplicate line collapsing, head/tail preservation), plus specialized filters for npm/pnpm/yarn/bun, pytest, Jest/Vitest, tsc, and eslint — each with domain-specific compression logic
- **3 budget profiles**: balanced (8k/16k chars), strict (4k/8k), verbose (32k/32k)
- **Command eligibility**: Deterministic classifier with deny list (ssh, sudo, vim, long-running servers) and allow list (~40 patterns covering git, npm, python, rust, go, etc.)
- **Pre-tool-use hooks**: Installed into `.claude/settings.json` and `.codex/hooks.json`. Intercepts eligible Bash tool calls and rewrites them to `claui-run --claui-encoded-shell-command <base64url-encoded command>`, preserving the original exit code
- **No-network guard**: The `claui-run` process overrides `globalThis.fetch` and patches `module.constructor.prototype.require` to block `http`, `https`, `net`, `dgram`, `http2` modules — ensuring the runtime can never exfiltrate data
- **Trace analytics**: Every processed command writes a JSON trace file. Dashboard shows total commands, tokens saved, and compression ratio. Individual trace cards show command family, duration, exit code, compression, and redaction count
- **3-tier retention**: Raw logs (7d/100MB), traces (30d/10k files), daily aggregate reports (90d)
- **UI**: Status badge in StatusBar (green/red dot with command count and tokens saved), settings panel with enable/disable toggle and hook install/uninstall buttons, trace dashboard tab in the main Dashboard
- Built as a third webpack target (`particle-accelerator-runtime`) with `optimization.minimize = false` (stdout is intentional output)
- 12 VS Code settings under `claudeMirror.particleAccelerator.*`. Feature is disabled by default (`enabled: false`)
- 11 test files covering SecretRedactor, CommandEligibility, CommandTraceWriter, ContextStore, EnvBuilder, all filters, both hooks, and a static no-network import ban verification
- New files: 8 extension services in `src/extension/particle-accelerator/`, 11 runtime files in `src/particle-accelerator-runtime/` (+ `filters/` + `hooks/`), 4 webview components in `src/webview/components/ParticleAccelerator/`, 1 dashboard tab
- New detail doc: `Kingdom_of_Claudes_Beloved_MDs/PARTICLE_ACCELERATOR.md`

**Feature: Goal — autonomous objective tracking for AI agent sessions**

- Users can define an autonomous objective via a "Goal" item in the StatusBar Tools dropdown. The AI works autonomously toward the goal without requiring repeated "continue" nudging — ideal for migrations, refactors, and full feature implementations
- **Set Goal mode**: Popover with a textarea and "Set Goal (Ctrl+Enter)" submit button. Sets the objective by sending `/goal <text>` as a message to the CLI (both Claude Code and Codex CLIs natively support the `/goal` command)
- **Active Goal mode**: Popover shows the current objective text with "Check Status" (sends `/goal`) and "Clear Goal" (sends `/goal clear`) buttons
- A green banner appears above the input area while a goal is active, showing the objective text (truncated to 80 chars with full text in tooltip) and an X button to clear
- Goal state (`goalActive`, `goalObjective`) is stored in the Zustand store and is tab-scoped — each tab has independent goal state
- New message types: `SetGoalStateRequest` (webview to extension), `GoalStateSettingMessage` (extension to webview)
- ~170 lines of CSS for goal button, popover, and active banner styling
- Known limitations: no automatic goal completion detection (user must clear manually), single goal per tab, state is lost on tab close/reload

**Fix: Goal state persistence corrected to tab-scoped only**

- Removed `workspaceState` persistence for goal state that was introduced in the initial implementation — goal state is now exclusively tab-scoped in the Zustand store
- Prevents stale goal state from persisting across tab restarts and avoids cross-tab interference

---

## v0.1.142 - 2026-05-12

**Feature: Multi-Participant Sessions — shared coding conversations with multiple humans and AI agents**

- New session type where multiple humans and their AI code agents (Claude Code / Codex) participate in a single shared conversation in real time. Each human runs their own VS Code instance with ClaUi, connects to a shared coordination server, and all participants see the full transcript
- **Architecture**: Client-server via WebSocket with hub-and-spoke topology. The server routes messages and maintains the canonical transcript; agents run locally on each participant's machine ("Server Routes, Client Executes")
- **Coordination Server** (standalone Node.js process, `server/src/`, 8 files): WebSocket server managing session lifecycle, join/leave/rejoin, message routing, participant registry, A2A (agent-to-agent) loop controller, LLM-based guard service, JSONL persistence, ping/pong keepalive (10s), and stream coalescing (50ms window)
- **Smart message routing**: Greedy longest-name prefix matching determines which agent receives a message. Typing `Claude check this file` routes to the "Claude" agent. Single-character route-key shorthand also supported (`C: check this`). Unaddressed messages broadcast to all humans but trigger no agent
- **Delta context delivery**: Agents receive only messages they haven't seen — not the full transcript. First delivery includes session opening + last 5 messages + current task; subsequent deliveries include only messages after `lastAckedDeliveredSeq`
- **A2A loop protection**: 4 modes — `ask` (default: pauses for human approval before every A2A delivery), `budget` (allows N then pauses), `always` (allows indefinitely, guard check every 20 consecutive A2A messages), `force` (no guard, requires confirmation). Guard service uses Claude Haiku to detect unproductive loops (repeated delegation, circular requests, no progress). 10s timeout, fail-safe to STOP
- **Approval dialog**: Modal with Deny, Allow N, Always Allow, and Force options. Pulse indicator on participant list when approval is pending
- **File conflict detection**: Tracks which files each agent modifies. Claude uses structured tool_use interception (Edit/MultiEdit/Write/NotebookEdit). Codex uses filesystem snapshot mtime diffing. Conflicts trigger a warning broadcast to all humans
- **Reconnection**: Exponential backoff (1s base, 30s max, 20 attempts) with jitter. Messages queued during disconnect are flushed on reconnect. Identity-preserving rejoin sends stored participant IDs and `lastSeenSeq` for seamless delta replay
- **Session persistence**: Append-only JSONL files per session, replayed on server restart to restore full state. All participants marked offline on restore (must reconnect)
- **Webview UI**: Full React interface with `MPSessionView` (layout), `MPChatView` (scrollable message list), `MpMessageBubble` (color-coded per participant with delivery status pills), `ParticipantList` (sidebar with status dots, kind badges, route keys), `ParticipantAutocomplete` (@-mention dropdown), `JoinDialog` (server URL, human name, agent name, provider selector), `ApprovalDialog`, `GuardStopNotification`, `ActivityIndicators` (typing/thinking/streaming animations), `ConflictWarning`
- Deterministic participant colors via FNV-1a hash of participant ID
- New command: `claudeMirror.joinMultiParticipantSession` with workspace settings setup flow
- `App.tsx` routes to `MPSessionView` when `tabKind === 'multiparticipant'`
- 18 new MP state fields + 19 action methods in the Zustand store, 16 `mp*` message types dispatched in `useClaudeStream.ts`
- Extension client module (`src/extension/multiparticipant/`, 7 files): `MultiParticipantClient` (WebSocket + auto-reconnect), `MultiParticipantSessionTab` (VS Code webview panel), `HeadlessAgentRunner` (drives local Claude/Codex without visible webview), `AgentBridge` (connects server commands to runner), `FileChangeTracker` (dual-strategy file monitoring)
- Configurable via env vars: `CLAUI_SERVER_PORT` (default 9120), `CLAUI_SESSION_TOKEN`, `CLAUI_PERSISTENCE_DIR`, `CLAUI_GUARD_API_KEY`, `CLAUI_GUARD_MODEL`
- VS Code settings: `claudeMirror.multiParticipant.serverUrl`, `.authToken`, `.defaultHumanName`, `.defaultAgentName`, `.defaultAgentProvider`
- New detail doc: `Kingdom_of_Claudes_Beloved_MDs/MULTI_PARTICIPANT.md`

---

## v0.1.138 - 2026-05-06

**Feature: Image lightbox copy to clipboard**

- Added a **Copy** button to the lightbox drawing toolbar that copies the image (with any pencil/rect/arrow annotations baked in) to the OS clipboard as a PNG
- Right-clicking anywhere on the lightbox stage opens a custom context menu with a "Copy image" action (replacing VS Code's native context menu, which cannot copy images from webviews)
- Copy renders the image and all shape overlays onto an off-screen canvas at the image's natural resolution, converts to a PNG blob, and writes it via `navigator.clipboard.write` with `ClipboardItem`
- Shape coordinates are stored as 0-1 ratios, so the exported image faithfully reproduces annotations at full resolution regardless of the displayed size
- A brief toast notification ("Copied" / "Copy failed") slides in at the bottom of the overlay and auto-fades after 1.5 seconds
- Escape key dismisses the context menu first (if open) before closing the lightbox itself
- New CSS: `.image-lightbox-ctx-backdrop`, `.image-lightbox-ctx-menu`, `.image-lightbox-ctx-item`, `.image-lightbox-toast` with fade animation

---

## v0.1.137 - 2026-05-05

**Feature: Workstream Map — AI-powered subway-map project visualization**

- New "Workstream Map" view that groups sessions into logical workstreams (coherent threads of work with a goal, status, and history) and renders them as a subway-map style SVG visualization
- AI-powered classification pipeline: scopes sessions to open tabs + last 3 days, performs heuristic pre-clustering (git branch, file overlap Jaccard > 0.3, temporal proximity), then classifies via Sonnet CLI call piped through stdin
- Stations represent meaningful events within sessions (milestones, decisions, blockers, code changes, failures) — extracted 1-5 per session via Sonnet in batches
- Deterministic lane-based SVG layout with framer-motion animations: path draw-in, flowing particles on active/blocked workstreams, spring-based zoom transitions, CSS station entrance animations
- Visual encodings: line color by status, dashed for low confidence, shape by station type (circle/diamond/square/triangle/star/lock/X), size by importance, glow states for attention/recent/resolved
- Four composable layers: Current State (resume markers, blocker highlights), Resume View (change summary after 24h inactivity), Plan Overlay (planned vs actual steps), Resolve Mode (interactive editing)
- Resolve mode supports renaming, status changes, session reassignment, pin/unpin, and natural language commands via `WorkstreamNLEditor` (pattern matching + Sonnet fallback)
- Pan/zoom with drag, mouse wheel, double-click reset, and minimap
- Importance/attention scoring via weighted composite heuristics (recency, volume, blockers)
- Snapshot capture with SHA-256 dedup (max 20 snapshots per project)
- Backend: `WorkstreamManager` orchestrator + 13 service classes (WorkstreamClassifier, StationExtractor, CurrentStateSynthesizer, ResumeStateBuilder, PlanRealityAnalyzer, WorkstreamNLEditor, WorkstreamImportanceScorer, SessionBackfiller, FileTracker, WorkstreamStore, WorkstreamSnapshotStore, UserPortfolioStore, UserPortfolioManager)
- Frontend: 21 React/SVG components in `WorkstreamMap/` directory
- Commands: `claudeMirror.openWorkstreamMap`, `claudeMirror.openWorkstreamPortfolio`
- New detail doc: `Kingdom_of_Claudes_Beloved_MDs/WORKSTREAM_MAP.md`
- Full spec: `Kingdom_of_Claudes_Beloved_MDs/WORKSTREAM_MAP_PLAN_REWRITE.md`

**Feature: User Portfolio View — cross-project workstream display**

- Top-level portfolio view that shows all projects across workspaces in one place, answering "which project should I open?" before the user even opens a workspace
- Data persisted in VS Code `globalState` (shared across all workspaces) via `UserPortfolioStore`. Key: `workstreamMap.portfolio`, max 30 projects, auto-prune after 180 days based on `lastClassifiedAt`
- Project health scoring computed in priority order: blocked (has blocked workstreams) > stale (no activity 21+ days) > needs_attention (uncertain workstreams or 7-21 days inactive) > healthy (fallback)
- Cross-project resume algorithm: filters to 30-day activity, prioritizes blocked > active > recent, picks top workstream within winning project
- `ProjectCard` component: health-colored border, workstream status badges, mini subway SVG lines, live-updating relative timestamps (60-second interval via `useLiveRelativeTime` hook), hover tooltip with full details
- Cached map view: clicking a non-current-workspace project card shows its cached `ProjectMapState` as a read-only map snapshot with `CachedMapBanner` displaying stale date and "Open Workspace" action
- Missing/deleted project cards are grayed out with "(not found)" label and disabled click
- Auto-open: on first portfolio data load, if 2+ projects exist and no prior portfolio data was loaded, automatically zooms to portfolio view
- "All Projects" button in `MapHeader` (visible when portfolio has 2+ projects) and Back button in `MapControls` for portfolio navigation
- Clickable resume recommendation banner navigates to the recommended project
- Backfill mechanism: every map data request auto-publishes to portfolio, so projects classified before the feature existed get portfolio entries on next map view
- Path validation via `fs.existsSync()` on portfolio data serve (not on store write)
- `currentWorkspacePath` sent from extension to webview via postMessage for accurate current-workspace detection
- Zoom levels: `'portfolio' | 'project' | 'workstream' | 'station_detail'`

**Feature: Codex Fast Mode**

- Codex sessions now expose a "Speed" selector in the AI chip (status bar), with options "Default" and "Fast"
- When "Fast" is selected, `CodexExecProcessManager` appends `-c service_tier="fast" -c features.fast_mode=true` to all Codex CLI spawns (first turns, resumed turns, and BTW background turns)
- New VS Code setting: `claudeMirror.codex.serviceTier` (type `"" | "fast"`, default `""`)
- Setting is persisted globally and synced to the webview via `codexServiceTierSetting` message on init and on change
- Auxiliary one-shot Codex calls (auto session naming, end-of-session summarizer fallback) are unaffected
- New UI component: `CodexServiceTierSelector.tsx` (rendered inside `AIChip` only for Codex tabs)
- New message types: `setCodexServiceTier` (webview -> extension), `codexServiceTierSetting` (extension -> webview)
- New detail doc: `Kingdom_of_Claudes_Beloved_MDs/CODEX_FAST_MODE.md`

---

## v0.1.123 - 2026-05-03

**Fix: Silent crash resume — break the stale-resume-target loop**

- New `resumeTargetMissingDetected` flag set when stderr matches `No conversation found with session ID:`. The exit-handler classifier now declines silent resume in this case (the same way `claudeCliMissingDetected` and the Happy auth path already work) so the tab does not loop forever respawning against a session id that no longer exists on disk
- Highest-priority branch in the exit handler: when `resumeTargetMissingDetected` is true, we surface a single clean error toast (`Could not resume session <prefix>: no conversation file found on disk`) and stop. No silent retry, no Restart prompt — restarting would just fail again with the same broken id
- `escalateToVisibleCrash` is now idempotent (early-returns when the tab is already de-armed and the queue is empty), and locks silent resume out for the rest of the cycle by setting `silentResumeAttempts = maxAttempts`. A clean turn (`result/success`) resets attempts back to 0 so a future legitimate crash gets the full retry budget again
- For the `fresh-session` reason, the Restart prompt is suppressed entirely (the on-disk JSONL is missing, so a Restart would just fail). The user gets one clear sentence about the broken session and what to do
- Reset of `resumeTargetMissingDetected` happens in `startSession` (alongside the existing CLI-missing/auth resets) and at the top of `beginSilentResume`, so a stale flag from a prior spawn cannot poison the next attempt

## v0.1.122 - 2026-05-03

**Feature: Silent crash resume**

- When a CLI subprocess (Claude or Codex) exits with a non-zero code, the legacy "process exited - Restart?" toast and `sessionEnded` UI no longer fire. The tab stays visually intact (history visible, input enabled) and is armed for a transparent respawn
- On the next user-sent message (or on Claude tab focus), the extension silently respawns the CLI with `--resume <sessionId>` (Claude) / `--resume <threadId>` (Codex) using `skipReplay`, flushes any queued prompts in arrival order, and streams responses normally. Typical perceived latency: 2-5 s on the first turn after the crash
- Mid-stream crash UX: the partial assistant bubble is finalized with a muted `(message ended unexpectedly)` footer rendered via the new `ChatMessage.interrupted` flag; subsequent assistant output renders as a fresh bubble below it
- Subtle "(reconnecting...)" hint appears in the input area only after a configurable delay (default 4 s) so brief resumes feel snappy
- Failure paths (`timeout`, `spawn-error`, `exit-while-spawning`, `cap-exhausted`, `fresh-session`) escalate cleanly to the visible Restart UX, restoring the user's typed text via a new `messageDeferred -> messageDeferredFailed -> silent-resume-restore-input` handoff so no input is lost
- Resume-with-fresh-session branch handles missing/corrupt JSONL: the new conversation continues with a single non-modal "could not restore previous conversation; starting fresh" toast instead of dumping the user back to a Restart prompt
- Per-tab `silentResumeAttempts` cap prevents crash loops; default 2 consecutive silent attempts before falling through to the visible UX. Counter resets on a clean turn (Claude `result` event / Codex `turnCompleted`)
- Codex parity: spawn-per-turn is naturally compatible — the next `sendTurn` already passes `--resume <threadId>`, so Codex parity is mostly suppressing the "process exited with code N" error toast and finalizing any partial bubble. Cap, telemetry, and reset behavior match Claude
- New configuration: `claudeMirror.silentCrashResume.enabled` (default `true`), `.maxAttempts` (1-5, default 2), `.timeoutMs` (3000-60000, default 15000), `.reconnectingHintDelayMs` (1000-30000, default 4000). Reads happen lazily so changes take effect on the next crash
- Telemetry tagged `[SilentResume]` in `Output -> ClaUi` and per-tab files: `armed`, `spawning`, `start() resolved`, `resumed`, `resumed-with-fresh-session`, `timeout`, `spawn-error`, `failed reason=...`, `cap-exhausted`, plus a STATUS_BREAKPOINT (`0x80000003` / exit code `2147483651`) recurrence note
- New webview message variants: `interruptedAssistantMessage`, `messageDeferred`, `messageDeferredDelivered`, `messageDeferredFailed`, `silentResumeStatus`. New `WebviewBridge` hooks: `isSilentResumeArmed?`, `enqueueSilentResume?`
- New detail doc: `Kingdom_of_Claudes_Beloved_MDs/SILENT_CRASH_RESUME.md`

## v0.1.119 - 2026-04-28

**Feature: Smart Search — agentic cross-provider session search**

- New tab kind that delegates "find a past session" to a real Claude Code or Codex agent. The user types free-form questions; the agent ripgreps over `~/.claude/projects/` and `~/.codex/sessions/`, reads the most promising hits, and returns result cards with an "Open session" button that opens the chosen session in a fresh ClaUi chat tab
- Entry point lives in the **StatusBar -> Tools** dropdown under a new "Smart Search" group with two header rows ("Smart Search - Claude" / "Smart Search - Codex") and per-model rows (Opus 4.7, Sonnet 4.6, Haiku 4.5; GPT-5, GPT-5 Pro). Click dispatches `openSmartSearch` to the active tab; both `MessageHandler` and `CodexMessageHandler` forward to the new VS Code command `claudeMirror.smartSearch.open`
- `TabManager.createSmartSearchTab` allocates a normal `SessionTab` / `CodexSessionTab` but calls a new `configureSearchMode({...})` method first. This bakes in the `SMART_SEARCH_PROMPT` (built by `SmartSearchPrompt.ts`, branches on whether Bash is allowed), a read-only allow-list (`Read,Glob,Grep`, plus `Bash` when `claudeMirror.smartSearch.allowBash` is true), and `cwd=$HOME` so the agent can see both Claude and Codex history roots
- Search-mode flags reach the CLIs: `ClaudeProcessManager.start` emits `--append-system-prompt <text> --allowedTools "..."` (the presence of `allowedTools` forces the read-only branch and skips `--permission-mode bypassPermissions`). `CodexExecProcessManager.runTurn` emits `-c instructions=<TOML-escaped-prompt>` and forces `--sandbox read-only` on every turn; the user prompt is written to stdin unchanged so the system prompt does not pollute the transcript
- Search tabs are visually distinct: slot color overridden to magenta (`#FF00C8`); the webview routes `tabKind === 'search'` to a dedicated `SmartSearchView` (header + MessageList + minimal input) with a `SearchEmptyState` example-query nudge
- Result cards emit `[[OPEN_SESSION:<sessionId>:<provider>]]` tokens. `MarkdownContent.tsx` runs a regex pass after DOMPurify to replace each token with an `.open-session-btn` element; clicks post `openSessionFromSearch` which routes to `claudeMirror.resumeSession` with an explicit `providerHint` so sessions discovered on disk (not in `SessionStore`) still open with the correct provider
- Snapshot persistence: `OpenTabSnapshotEntry` carries `tabKind` and `searchModel`. `buildSnapshot` keeps search tabs even without a sessionId (Codex search tabs only get a stable threadId after the first turn), and `restoreFromSnapshot` calls `configureSearchMode` + `startSession({ cwd: $HOME })` for those entries — never `resume` (clean re-init, no transcript replay)
- New settings: `claudeMirror.smartSearch.defaultModel` (default `claude-sonnet-4-6`, used when the command is invoked without a model arg) and `claudeMirror.smartSearch.allowBash` (default `true`)
- New detail doc: `Kingdom_of_Claudes_Beloved_MDs/SMART_SEARCH.md`

**Feature: Tab Folders & sub-folders (Sessions sidebar TreeView)**

- New Activity Bar TreeView (`claudeMirror.sessionsTree`) under the **ClaUi** view container that organizes session tabs into nestable folders. VS Code's native editor tab strip cannot be nested, so folders surface in the sidebar alongside the existing launcher
- Folder records (`TabGroup`: `id`, `parentId?`, `label`, `color`, `order`, `createdAt`) are stored in `workspaceState` under `claudeMirror.tabGroups` via the new `TabGroupStore`. Tab membership rides on `OpenTabSnapshotEntry` via two new optional fields: `groupId?` and `orderInGroup?`. Both stores are scoped per workspace, so folders never bleed between projects
- `TabGroupStore` provides Memento-backed CRUD (`createGroup`, `renameGroup`, `setGroupColor`, `moveGroup`, `deleteGroup`, `reorderWithinParent`) plus an `onDidChange` event. `moveGroup` walks the proposed parent chain before mutating and throws on cycle
- Native tab icons re-skin with the folder color: every `SessionTab` / `CodexSessionTab` exposes `applyTabColor(color)`; `TabManager.applyEffectiveTabIcon` re-runs SVG circle generation when a tab moves into/out of a folder, when a folder's color changes (the `TabGroupStore.onDidChange` listener fans out to every assigned tab), and when a tab is restored from snapshot
- New commands wired into the Sessions view: `claudeMirror.groups.create`, `claudeMirror.groups.createSubfolder`, `claudeMirror.groups.rename`, `claudeMirror.groups.changeColor`, `claudeMirror.groups.delete`, `claudeMirror.tabs.moveToGroup`, `claudeMirror.tabs.removeFromGroup`, `claudeMirror.tabs.focus`. Right-click menus filter via `viewItem == tabGroup` / `viewItem == tabLeaf`; all handlers accept a tree node from the menu **or** fall back to a QuickPick when launched from the Command Palette
- Folder deletion is opt-in destructive: a three-way QuickPick lets the user cascade-close all child tabs, reparent them to the grandparent, or cancel
- Restore behavior: `TabManager.restoreFromSnapshot` rebuilds `snapshotEntries` after the restore loop and copies `groupId` / `orderInGroup` from the original snapshot entry by sessionId, so folder assignments survive workspace close/open. Group records themselves persist independently in `workspaceState`
- New setting `claudeMirror.tabs.indicateGroupOnTitle` (default `false`): when a tab belongs to a folder, prefix its native tab title with a colored bar character — useful when tab icons are not visible
- New detail doc: `Kingdom_of_Claudes_Beloved_MDs/TAB_GROUPS.md`

**Feature: End-of-Session AI summary (tree tooltip)**

- Every session now gets a 1-3 sentence AI summary generated when its CLI process exits, shown on hover in the new Sessions TreeView tab leaves. Independent of `claudeMirror.activitySummary`
- New `SessionSummarizer.ts` pipeline: reads the Claude transcript from `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` via `ConversationReader` (Codex transcripts pass through `fallbackMessages`), skips sessions with fewer than 2 user messages, truncates to ~4000 chars (~30% head + tail-weighted), and prompts: *"Summarize this session in 1-3 sentences for a hover preview. Focus on the topic and outcome. Match the user's language."*
- Two-rung fallback: primary attempt spawns `claude -p --model <claudeMirror.analysisModel>` (default Haiku 4.5) with a 35s timeout; on non-zero exit, timeout, or empty stdout, falls back to `codex exec --json --sandbox read-only -c model_reasoning_effort=low` (45s timeout). Output is sanitized (strip wrapping quotes/backticks, 600-char cap) and stored on `SessionMetadata` as `summary`, `summaryGeneratedAt`, `summaryProvider` (`'haiku'` | `'codex'`)
- Triggered fire-and-forget from `SessionTab.maybeRunSummarizer(reason)` on the process-exit path — both successful exit and crash branches; the stop-button path routes through `processManager.stop()` -> exit event so it is covered automatically. A per-tab `summarizerRan` boolean guards against double-fire
- Display: `TabGroupsTreeProvider.buildTabTooltip()` builds a `vscode.MarkdownString` showing the tab name + provider/session-id meta + horizontal rule + summary text + relative-time hint (`generated 5m ago`); placeholder `_Summary will appear after the session ends._` until generated. Refresh fans out via `SessionTab` -> `callbacks.onSummaryGenerated(sessionId)` -> `TabManager.notifySummaryChanged()` -> tree refresh
- New setting `claudeMirror.sessionEndSummary` (default `true`)
- New detail doc: `Kingdom_of_Claudes_Beloved_MDs/SESSION_SUMMARY.md`

---

## v0.1.116 - 2026-04-27

**Improvement: Lazy session restore on startup**

- When `restoreSessionsOnStartup` reopens multiple tabs, only the originally-active tab eagerly spawns its CLI process. Every other restored tab creates its webview panel, restores its title, and seeds the session id, but the CLI process is **not** spawned until the user actually focuses that tab. Restoring 10 tabs no longer means launching 10 Claude/Codex CLIs at once
- New `SessionTab.prepareForLazyResume(sessionId)` / `CodexSessionTab.prepareForLazyResume(sessionId)` set `pendingResumeSessionId`, seed the process manager with the id (so `tab.sessionId` is accurate before spawn), restore the tab name from `sessionStore`, and skip the CLI spawn
- `TabManager.restoreFromSnapshot` decides per-entry whether to call `startSession({ resume })` (eager, only for `snapshot.activeSessionId`) or `prepareForLazyResume` (lazy, everything else); lazy tabs are collected and `armLazyWake()` is scheduled via `setTimeout(0)` so the synthetic view-state-active events fired during panel creation and the originally-active reveal cannot prematurely wake them
- `panel.onDidChangeViewState` in both tab classes checks `lazyWakeArmed && pendingResumeSessionId` before calling `startSession({ resume })`; both flags are cleared synchronously before the await so re-entrant view-state events cannot double-trigger
- Updated `Kingdom_of_Claudes_Beloved_MDs/SESSION_RESTORE.md` and the Session Restore entry in `TECHNICAL.md` to describe the lazy-spawn model

**Feature: Crash-loop breaker for session restore**

- Auto-restore could previously trigger a boot loop: if a restored session caused the extension host to crash, the next launch would re-restore the same session and crash again
- New sticky `claudeMirror.restoreInProgress` Memento flag in `workspaceState`. `TabManager.restoreFromSnapshot` writes `true` before the restore loop and clears it in `finally`. If activation sees the flag still `true`, the previous run died mid-restore — auto-restore is skipped this launch and the user is shown a warning toast: `ClaUi did not finish restoring N sessions last time, possibly due to a crash. Auto-restore was skipped to avoid a loop.` with `Restore now` and `Skip` buttons
- `Restore now` re-invokes `restoreFromSnapshot({ force: true })` to bypass the check; the flag is cleared either way so the next launch is allowed to auto-restore again
- New `OpenTabsSnapshotStore.isRestoreInProgress()` / `setRestoreInProgress(value)` methods, backed by the new `RESTORE_IN_PROGRESS_KEY = 'claudeMirror.restoreInProgress'` Memento key

**Improvement: Single-phase Claude fork**

- The two-phase fork flow (spawn `--fork-session` to create the new session and exit, then spawn again with `--resume <new-id>` to start the interactive session) is replaced by a single-phase fork that matches `BackgroundSession.startFork`
- The new tab spawns `claude --resume <parent-id> --fork-session` once, posts the parent's history to the webview via `forkInit`, and pre-fills the selected text in the input area. The CLI stays alive on the not-yet-forked session waiting for stdin. When the user presses Send, the CLI performs the fork inline and emits `system/init` with the new forked session id; `sessionStarted` is updated automatically and the conversation continues normally
- Removed the `forkInProgress` field and the corresponding post-exit phase-2 spawn block from `SessionTab.wireProcessEvents`. Updated the Fork Conversation entry in `TECHNICAL.md`

**Bug Fix: Edit-and-resend now works on restored tabs and refuses to drop context**

- Edit-and-resend used to silently fall back to a fresh session when no session id was known yet — which dropped all prior conversation context. It also failed on freshly restored tabs because `processManager.currentSessionId` was `null` until the first turn fired (Claude CLI's pipe mode emits `system/init` only after the first stdin message)
- `ClaudeProcessManager.seedSessionId(id)` lets callers pre-populate the session id between resume and first turn. `SessionTab.startSession({ resume })` and `prepareForLazyResume` both seed the id immediately, so restored tabs return the correct `sessionId` before the CLI emits init
- `MessageHandler.editAndResend` no longer silently falls back to a fresh session: when no session id is available it surfaces an explicit error (`Cannot edit message: the session has not been initialised yet. Send a new message first, then try editing again.`) and clears `processBusy` instead of dropping context

**Bug Fix: Checkpoint capture reliable in webpack production builds**

- The Revert button on a user message could fail to appear because the demux's `blockStop` listener has been observed to silently not fire in webpack production builds (the same `EventEmitter` issue previously seen with the `result` event), so `captureBeforeContent` was never called for code-write tools
- `MessageHandler.captureCheckpointForToolBlock(toolName, rawInput, source)` extracted as a public method (still called from the demux path). Added a parallel direct path: `SessionTab.wireProcessEvents` now observes raw `content_block_start` / `content_block_delta` / `content_block_stop` stream events itself, accumulates `input_json_delta` chunks, and calls `captureCheckpointForToolBlock` on `content_block_stop` for code-write tools
- The two paths are idempotent — `CheckpointManager.captureBeforeContent` dedupes by absolute path — so a duplicate call from whichever path fires second is a no-op

**Feature: Image lightbox markup tools**

- The lightbox now opens on **single-click** of any image (pending input thumbnails or message bubble images), not double-click, matching the more common single-click-to-zoom pattern
- Added a drawing toolbar above the image with three tools: **Pencil** (free draw), **Rect** (rectangle), and **Arrow** (line with arrowhead). A 5-color swatch picker (red / yellow / green / blue / white) sets the stroke color, and **Undo** / **Clear** revert the last shape or wipe all shapes
- Drawing happens on a `<canvas>` overlay sized to the image's rendered dimensions; shape coordinates are stored as 0–1 ratios so they stay correctly positioned when the image is resized. A `ResizeObserver` keeps the canvas in sync with the image's actual layout size
- Toolbar interactions stop click-propagation so they do not close the lightbox; the backdrop and Escape still close

**Improvement: Error banner expand/collapse for long messages**

- Long error messages no longer push the chat layout around: the error banner now clamps to 2 lines with a `Show more` / `Show less` toggle when the message would overflow
- Expanded state allows up to `40vh` with internal scroll. Toggle visibility is driven by a runtime `scrollHeight > clientHeight` check on the message container so it appears only when needed
- Banner layout reworked to a column with a dedicated actions row (`error-banner__actions`) so the toggle and dismiss buttons don't fight the message text for horizontal space; CLI-missing inline-button banners are unaffected

---

## v0.1.115 - 2026-04-20

**Bug Fix: Restore Last Sessions snapshot wipe on shutdown**

- Closing VS Code with one or more open ClaUi tabs sometimes left an empty `claudeMirror.openTabsSnapshot` on disk, so on the next workspace open the "Restore Last Sessions" feature found nothing to restore (log showed `[OpenTabsSnapshot] No entries to restore`)
- Root cause: a fire-and-forget `flushSnapshotSync()` raced against the panel-disposal cascade. Each `WebviewPanel.onDidDispose` triggered `handleTabClosed`, which deleted the entry from `snapshotEntries` and scheduled a 500 ms debounced write — that timer then fired AFTER the good write and overwrote the snapshot with `entries: []`. `deactivate()` returned synchronously, so VS Code could kill the extension host before the good write was guaranteed to land
- Fix: `TabManager` gained an `isShuttingDown` field. `closeAllTabs()` is now `async`: it sets the guard, cancels any pending debounce timer, captures `buildSnapshot()` BEFORE disposing tabs, disposes them, then `await`s `snapshotStore.set(captured)`. `handleTabClosed` and `schedulePersistSnapshot` short-circuit when shutting down (defense in depth)
- `extension.ts deactivate()` is now `async` and `await`s `closeAllTabs()`, so VS Code holds the extension host alive until the Memento write actually lands on disk (per the documented `deactivate(): Thenable` contract)
- Removed the now-unused `flushSnapshotSync` method

**Bug Fix: Orphan-process cleanup PowerShell parsing error on Windows**

- `[OrphanCleanup] Failed: ...` errors appeared on every extension activation on Windows. The PowerShell script wrapped via `powershell -Command "..."` contained literal double quotes (`"Name='node.exe'"`, `"killed:..."`) that collided with cmd.exe's quote handling, breaking script parsing
- Fix: `orphanCleanup.ts` now passes the script via PowerShell's `-EncodedCommand` (base64 UTF-16LE), which sidesteps cmd.exe quoting entirely. The multi-line script body is preserved as-is — no more `.replace(/\n/g, '; ')` workaround

**Feature: Per-message LTR alignment toggle**

- Each message bubble now has a small "LTR / Auto" button next to Copy and Translate. Clicking it forces left-to-right alignment for that single message only — it does NOT affect other messages, the input area, or the StatusBar. The button is hidden at rest and fades in on bubble hover, matching the Translate-button pattern
- New Zustand state `messageForcedLtr: Set<string>` and action `toggleMessageForcedLtr(messageId)` mirror the existing `showingTranslation` Set pattern. The Set is cleared on session change
- `MessageBubble` subscribes via `s.messageForcedLtr.has(message.id)` so only the affected bubble re-renders when its own flag flips. The boolean is prop-drilled through `ContentBlockList → ContentBlockRenderer → TextBlockRenderer → MarkdownContent` to keep leaf renderers stateless
- Removed the previous global alignment scope: `textSettings.forceLtr` was deleted from the store, the StatusBar `AlignmentToggle` button (`status-bar-alignment-toggle` CSS) was removed, the `useEffectiveDir` React hook was deleted, and `InputArea` / `StreamingText` reverted to plain `detectRtl(text)` for direction
- New CSS class `.alignment-message-btn` (with `.forced-ltr` modifier when active) mirrors `.translate-message-btn`: float-right, opacity 0 at rest, opacity 1 on `.message:hover`, `--vscode-textLink-foreground` when active

**Documentation**

- Updated `Kingdom_of_Claudes_Beloved_MDs/SESSION_RESTORE.md` to describe the new capture-then-await shutdown flow and the `isShuttingDown` guard (replacing the obsolete "synchronous flush" description)
- Updated `Kingdom_of_Claudes_Beloved_MDs/PROCESS_LIFECYCLE.md` to note the `-EncodedCommand` PowerShell invocation
- Updated `Kingdom_of_Claudes_Beloved_MDs/MARKDOWN_RENDERING.md` and `ARCHITECTURE.md` to describe the per-message LTR override and the `messageForcedLtr` Set
- Updated `TECHNICAL.md` to remove the old global alignment toggle reference from the TextSettingsBar entry

---

## v0.1.113 - 2026-04-16

**Improvement: Claude Opus 4.7 display support**

- Added `claude-opus-4-7` as a first-class Claude model option in `claudeMirror.model` and the status-bar model selector
- Added shared Claude model display normalization so runtime IDs such as `claude-opus-4-7` render as `Opus 4.7` in the AI chip, assistant message badges, and dashboard metadata
- Kept CLI default behavior intact: when no extension model override is selected, the UI still uses the runtime model reported by Claude Code

## v0.1.112 - 2026-04-16

**Feature: Restore Open Sessions on VS Code Startup**

- New setting `claudeMirror.restoreSessionsOnStartup` (default `true`): when VS Code reopens a workspace, all ClaUi session tabs that were open when it last closed are automatically resumed using each session's persistent `session_id` / `threadId` via `--resume` / `codex exec resume`
- Per-workspace snapshot stored in `workspaceState` under `claudeMirror.openTabsSnapshot`: entries record `tabNumber`, `provider`, `sessionId`, optional `customName`, and (for remote/Happy tabs) `cliPathOverride`
- Writes are debounced 500 ms and coalesce across tab create / focus / close / rename / session-id-assigned events; `closeAllTabs()` performs a final synchronous flush so VS Code crashes still preserve recent state
- `TabManager.restoreFromSnapshot()` runs after orphan cleanup in `activate()`, filters entries to the current workspace, de-dupes by `sessionId`, caps at 10 tabs, and spawns them serially inside a progress notification; per-tab failures are caught and summarized in a toast
- First-install auto-open is suppressed only when restoration actually produced tabs, so a fresh workspace with an empty snapshot still sees the welcome tab
- Toggle is exposed in two synchronized places: the VS Code Settings editor (`restoreSessionsOnStartup`) and the in-app gear panel (StatusBar ⚙ → VitalsInfoPanel, row labeled "Restore Last Sessions"); `onDidChangeConfiguration` keeps both views in sync
- `SessionTabCallbacks` gained two optional hooks (`onSessionIdAssigned`, `onNameChanged`) fired by both `SessionTab` and `CodexSessionTab` so the snapshot can track IDs and user-assigned names as they become available
- Default placeholder names (`ClaUi N`, `Codex N`, `Session N`) are filtered via `isDefaultTabName` so only user-meaningful names are persisted
- `DiagnosticsCollector` includes `restoreSessionsOnStartup` in bug-report settings output

**Feature: Scheduled Prompts for Codex Sessions**

- Users can schedule a message to be sent to Codex at a future time using the scheduled-message UI in the input area
- Backend (`CodexMessageHandler`) queues the prompt with an optional image payload and dispatches it via `setTimeout` when the scheduled time arrives
- If the session is busy at fire time, the dispatch retries automatically after 15 seconds; if the session is no longer active, the scheduled message is cancelled with a user-visible error
- Scheduling state (pending text preview, target time) is synced to the webview via `scheduledMessageState` messages so the UI can show/cancel the queued prompt
- Scheduled prompts are cleared on session start, resume, stop, clear, and edit-and-resend to avoid stale dispatches

**Improvement: Explicit Codex -> Claude Code handoff entry points**

- Added a dedicated command palette action: `ClaUi: Carry Codex Session to Claude Code` (`claudeMirror.carryCodexToClaudeCode`) which only activates from a Codex tab
- The generic `switchProviderWithContext` command now shares the same `runProviderHandoff()` helper, reducing code duplication
- Codex-tab handoff CTA now says `Carry to Claude Code` and the handoff banner uses `Claude Code` for the Claude target label throughout the UI (AIChip, StatusBar, package.json descriptions)
- `scripts/verify-installed.ps1` verifies the new command is present in both the manifest and the runtime bundle
- `scripts/deploy-local.ps1` now explicitly resolves the `code.cmd` / `code` CLI path instead of relying on bare shell resolution

**Improvement: Ultrathink lock button restored as a dedicated control**

- Restored a visible lock-toggle button above the brain icon as a direct shortcut to `locked` mode
- The lock button is a small circle with a lock/unlock SVG icon that toggles between `off` and `locked`; the brain button continues to cycle `off -> single -> locked -> off`
- Extracted `persistUltrathinkMode()` and `stripUltrathinkPrefix()` helpers to share logic between the lock toggle and the brain cycle, fixing a stale-closure bug in `sendMessage` (missing `setUltrathinkMode` in dependency array)
- Removed the non-interactive lock badge overlay that was previously displayed on the brain in locked mode
- CSS updated: `.ut-lock-badge` replaced by `.ut-lock-toggle` with hover, active, and disabled states; `.ultrathink-wrapper` now uses column flex layout with a 2px gap

**Improvement: Handler lifecycle reset on session transitions**

- Both `MessageHandler` and `CodexMessageHandler` now expose `resetTransientStateForHostLifecycle(reason)` which clears scheduled prompts, handoff state, usage-limit queues, plan-mode flags, and approval tracking in one call
- `SessionTab` and `CodexSessionTab` call this method on `startSession`, `stopSession`, `clearSession`, and `dispose`, replacing scattered `clearPendingHandoffPrompt()` calls
- Both handlers now implement `dispose()` to clean up timers and deferred state when a tab is destroyed

---

## v0.1.110 - 2026-03-31

**Improvement: Usage API diagnostic logging**

- `UsageFetcher` now captures the raw JSON response from the Anthropic usage API and passes it through as `rawDiagnostic` on the fetch result
- `MessageHandler` logs the full raw API response under the `[USAGE_RAW_API]` tag for investigating which period buckets the API actually returns

**Improvement: Token Ratio Tab rewrite**

- Replaced the flat multi-period layout with a two-quota-window view: **5-Hour Quota** and **7-Day Quota** (the two windows the API actually provides)
- Added an X-axis time-range selector (24 Hours / 14 Days / 30 Days / 2 Months) so users can zoom the chart history independently of the quota window
- Axis tick formatting now adapts to the selected time range (time-only for 24h, date-only for longer ranges)
- Refactored bucket-key parsing into `parseBucketModelLabel()` for cleaner per-window grouping

---

## v0.1.109 - 2026-03-30

**Feature: Tab Name Chip**

- Added a floating chip in the top-left corner of the webview that displays the current tab's session name
- The chip is invisible at rest and fades in when hovering anywhere over the window (opacity 0.55), making it unobtrusive during normal use
- Hovering directly over the chip brings it to full opacity and reveals a tooltip with the full Activity Summary text
- The last Activity Summary text is persisted in `lastActivitySummaryText` so the tooltip remains available even after the session goes idle
- `SessionTab.setTabName()` now sends a `tabNameUpdate` message to the webview on every name change, and also sends the current name immediately on `ready` so the chip is populated from the first moment the panel opens
- New message type: `TabNameUpdateMessage`

**Feature: Chat Search in Codex Sessions**

- Codex sessions now support project-wide Chat Search (previously only available in Claude sessions)
- `CodexMessageHandler` handles `chatSearchProject` and `chatSearchResumeSession` messages, lazy-loading `ChatSearchService`
- Resuming a session from search results now executes `claudeMirror.resumeSession` command directly

**Improvement: Tab Wrapping for Multiple ClaUi Tabs**

- When a second (or subsequent) ClaUi tab is opened, the extension now automatically enables `workbench.editor.wrapTabs` globally, preventing tabs from overflowing into a horizontal scroll bar

**Improvement: Chat Search Available on Empty Sessions**

- The Chat Search bar is now rendered outside the `hasMessages` conditional in `App.tsx`, so project-wide search is accessible even before any messages are sent

**Improvement: Chat Search Stays Open on Resume**

- Clicking a project search result to resume a session no longer closes the search bar, allowing users to browse and open multiple results without re-opening search each time

**Fix: Chat Search Searches All Sessions**

- `ChatSearchService.searchProject()` no longer requires a `workspacePath` parameter and now calls `discoverAll()` instead of `discoverForWorkspace()`, so cross-session search covers all sessions regardless of which workspace folder is active

**Fix: Chat Search Dropdown Positioning**

- Removed `position: absolute` from `.chat-search-project-dropdown`, fixing layout issues where the dropdown overlapped other content instead of flowing naturally

**Fix: Resume Session Accepts Direct ID**

- `claudeMirror.resumeSession` command now accepts an optional `passedSessionId` parameter, skipping the input box prompt when called programmatically (e.g., from Chat Search)

**Fix: Checkpoint File Path Extraction for Large Writes**

- Checkpoint's `captureBeforeContent` now extracts `file_path`/`notebook_path` via regex before falling back to `JSON.parse`, because `rawInput` can be truncated at 8000 chars (memory guard) causing parse failures for Write tools with large file content

**Fix: InputArea Stale Closure**

- Added `scheduleMessageEnabled` and `scheduleMessageAtMs` to the `useCallback` dependency array in `InputArea`, preventing a stale closure when scheduled-message state changes

---

## v0.1.107 - 2026-03-24

**Feature: Checkpoint — Revert & Redo File Changes**

- Each user message that resulted in file changes now shows a **Revert** button in the message header (next to Edit/Fork/Copy)
- Clicking Revert undoes all file changes made by Claude from that prompt through the end of the session, restoring each file to its state before that turn
- After reverting, a **Redo** button appears on the reverted messages, allowing re-applying the changes
- Supports all four file-writing tools: `Write`, `Edit`, `MultiEdit`, `NotebookEdit`
- Session-isolated: each tab has its own independent checkpoint history — reverting in one tab never affects another
- Conflict detection: if a file was modified externally after Claude wrote it, the revert skips that file and reports the conflict rather than silently overwriting
- Redo branch management: if the user reverts and then sends a new prompt, the old redo branch is discarded (like Git — new work replaces the old future)
- Files larger than 1MB and binary files are skipped automatically
- Reverted messages are visually dimmed (opacity 0.4) to indicate they are in the reverted range
- New backend class: `CheckpointManager.ts` (one instance per session tab)

---

## v0.1.106 - 2026-03-23

**Feature: SkillDocs first-time onboarding**

- Added a floating action button (FAB) with a pulsing green glow at the bottom-left for users who have not yet seen the SkillDocs onboarding
- Clicking the FAB opens a modal explaining what SkillDocs does: reads SR-PTD docs, uses AI to detect patterns, and generates skill files in `~/.claude/skills/`
- Modal supports 16 languages (English, Hebrew, Arabic, Spanish, French, German, Russian, Chinese, Japanese, Korean, Portuguese, Italian, Dutch, Polish, Turkish, Hindi); Hebrew and Arabic use RTL layout
- Two decision buttons: "Enable" and "Skip" — decision is persisted in VS Code `globalState` and survives across workspaces and sessions
- If the user skips, SkillGen is disabled globally; if enabled, the SkillGen button appears in the StatusBar Tools dropdown
- The SkillGen dropdown item is hidden until onboarding is completed (the FAB is the sole entry point beforehand)
- New component: `SkillGenOnboarding.tsx`; new message type: `skillGenOnboardingDecision`

---

## v0.1.105 - 2026-03-23

**Improvement: Clean model switch at session start**

- When switching models before any message has been sent, the session now performs a fresh start with the new model instead of a stop-and-resume
- Previously, switching the model on an empty session still used the resume path, which was semantically incorrect
- Added `isAtSessionStart` getter on `MessageHandler` (returns `true` when `firstMessageSent` is still false)
- `SessionTab.switchModel()` uses this flag to decide: fresh start (no messages yet) vs. resume with the new model (mid-conversation)

---

## v0.1.104 - 2026-03-23

**Bug Fix: Activity Summary visible when feature is disabled**

- The Activity Summary bar could appear even after the feature was toggled off, because stale summary data remained in the Zustand store
- Fixed by gating the layout condition on `activitySummaryEnabled` in `App.tsx`, guarding incoming `activitySummary` messages in `useClaudeStream.ts`, and clearing the summary when the setting is disabled in `store.ts`

**Improvement: Ultrathink 3-state mode (off / single / locked)**

- Replaced the 2-state toggle (off/locked) with a 3-state cycle: **off → single → locked → off**
- `single` mode auto-resets to `off` after one message is sent (one-shot ultrathink)
- `locked` mode persists across messages (equivalent to the old "locked")
- Removed the separate lock toggle button — the brain button now cycles through all three states; a lock badge icon appears in `locked` mode
- Workspace state key migrated from boolean `claui.ultrathinkLocked` to string `claui.ultrathinkMode` (`'off'` | `'single'` | `'locked'`), with backward-compatibility conversion

**Improvement: MCP restart banner lifecycle feedback**

- The MCP panel's restart banner now reflects the full operation lifecycle: amber (idle) → "Restarting..." (in-flight) → green success or red failure
- Restart button is disabled while in-flight and hidden after success

**Fix: Result handler reliability — dual-path processing**

- The `result` event handler was extracted from the inline demux listener into a public `handleResultEvent()` method with a dedup guard
- Added a direct call path from `SessionTab.wireProcessEvents` as a reliable backup, since the demux `EventEmitter` listener has been observed to silently not fire in webpack production builds

**Fix: SessionTimeline stale memo comparator**

- `SessionTimeline` `React.memo` comparator now checks reference equality on `turnHistory`, not just array length, ensuring re-renders when new items are appended

**Improvement: Codex consultation prompts shortened**

- Consultation prompts rewritten to stay under 200 words; previous verbose prompts (400+ words) caused 5–10 minute hangs
- Consultation sandbox changed from `workspace-write` to `read-only`

---

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
