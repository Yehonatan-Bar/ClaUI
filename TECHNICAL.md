# ClaUi - Technical Documentation

## Overview

A VS Code extension that provides a rich chat interface for Claude Code. The extension owns the Claude CLI process and distributes its output to a React-based webview chat UI (Phase 2 will add terminal mirroring).

**Architecture**: Each tab creates its own CLI process (`claude -p --output-format stream-json`), stream parser, and React webview panel. A `TabManager` coordinates multiple independent sessions running in parallel.

```
                   TabManager
                      |
           +----------+----------+
           |                     |
      SessionTab 1          SessionTab 2         ...
      +-----------+         +-----------+
      | Process   |         | Process   |
      | Demux     |         | Demux     |
      | Control   |         | Control   |
      | MsgHandler|         | MsgHandler|
      | Panel     |         | Panel     |
      +-----------+         +-----------+
```

---

## Quick Start

For build instructions, development setup, and contributing: see [DEVELOPMENT.md](DEVELOPMENT.md).

User-facing documentation (features, shortcuts, settings): see [README.md](README.md).

---

## Directory Structure

```
claude-code-mirror/
+-- package.json                          # Extension manifest, commands, settings, Activity Bar views
+-- tsconfig.json                         # TypeScript config (ES2022, JSX)
+-- webpack.config.js                     # Dual-target: extension (Node) + webview (browser)
+-- .vscodeignore
+-- dist/                                 # Build output
|   +-- extension.js                      #   Extension host bundle (15 KB)
|   +-- webview.js                        #   React webview bundle (170 KB)
+-- images/
|   +-- claui-activity.svg               # Activity Bar icon for the ClaUi sidebar container
+-- src/
|   +-- extension/                        # Extension host code (Node.js context)
|   |   +-- extension.ts                  #   Activation, creates TabManager
|   |   +-- commands.ts                   #   VS Code command handlers (routes via TabManager)
|   |   +-- sidebar/
|   |   |   +-- ClaUiSidebarViewProvider.ts #   Activity Bar sidebar launcher (WebviewViewProvider)
|   |   +-- process/
|   |   |   +-- ClaudeProcessManager.ts   #   Spawns and manages CLI process
|   |   |   +-- CodexCliDetector.ts        #  Shared Codex CLI detection, probing & candidate scoring
|   |   |   +-- CodexExecProcessManager.ts #  Spawns and manages Codex exec processes
|   |   |   +-- envUtils.ts               #   Shared env sanitization & API key management
|   |   |   +-- killTree.ts              #   Shared cross-platform process tree kill utility
|   |   |   +-- orphanCleanup.ts         #   Startup cleanup of orphaned ClaUi processes
|   |   |   +-- usageLimitParser.ts      #   Parses usage-limit errors into reset timestamps
|   |   |   +-- StreamDemux.ts            #   Parses JSON lines, routes events
|   |   |   +-- ControlProtocol.ts        #   Higher-level command API
|   |   +-- webview/
|   |   |   +-- WebviewProvider.ts        #   buildWebviewHtml() utility + legacy class
|   |   |   +-- MessageHandler.ts         #   postMessage bridge (uses WebviewBridge interface)
|   |   |   +-- HtmlPreviewPanel.ts       #   Opens HTML code blocks as rendered preview tabs
|   |   +-- session/
|   |   |   +-- SessionTab.ts             #   Per-tab bundle (process+demux+panel+handler)
|   |   |   +-- TabManager.ts             #   Manages all tabs, tracks active tab
|   |   |   +-- SessionNamer.ts           #   Auto-generates tab names via Haiku
|   |   |   +-- CodexSessionNamer.ts      #   Auto-generates Codex tab names via one-shot codex exec
|   |   |   +-- ActivitySummarizer.ts     #   Periodic tool activity summary via Haiku
|   |   |   +-- VisualProgressProcessor.ts #  VPM card generator: tool events -> visual cards + Haiku AI descriptions
|   |   |   +-- AdventureInterpreter.ts  #   Converts TurnRecords to AdventureBeats (dungeon crawler)
|   |   |   +-- MessageTranslator.ts      #   Translates assistant messages to Hebrew via Sonnet CLI call
|   |   |   +-- FileLogger.ts             #   Per-session file logging with rotation and rename
|   |   |   +-- SessionStore.ts           #   Persists session metadata in globalState
|   |   |   +-- ProjectAnalyticsStore.ts  #   Persists SessionSummary in workspaceState (per-project)
|   |   |   +-- ConversationReader.ts     #   Reads conversation history from Claude's session JSONL files
|   |   |   +-- PromptHistoryStore.ts     #   Persists prompt history (project + global scope)
|   |   |   +-- TurnAnalyzer.ts           #   Semantic turn analysis via Claude (mood, task type, outcome)
|   |   |   +-- PromptEnhancer.ts         #   AI-powered prompt rewriting via one-shot CLI call
|   |   |   +-- PromptTranslator.ts       #   Prompt-to-English translation via one-shot CLI call
|   |   |   +-- TokenUsageRatioTracker.ts #   Correlates token consumption with usage % (per-model + global, persisted)
|   |   |   +-- SessionDiscovery.ts       #   Discover all Claude sessions from ~/.claude/projects/ filesystem
|   |   |   +-- SessionFork.ts            #   Phase 3 stub (rewind)
|   |   +-- terminal/                     #   Phase 2 stubs
|   |   +-- feedback/
|   |   |   +-- FormspreeService.ts      #   Formspree.io feedback submission (text + file attachments)
|   |   |   +-- BugReportService.ts      #   Bug report lifecycle: auto-collect, AI chat, ZIP packaging, submission
|   |   |   +-- DiagnosticsCollector.ts  #   Collects system/environment info + recent logs
|   |   |   +-- BugReportTypes.ts        #   Shared WebviewBridge interface (avoids circular imports)
|   |   +-- auth/
|   |   |   +-- AuthManager.ts           #   Claude CLI auth status/login/logout helpers
|   |   +-- skillgen/
|   |   |   +-- SkillGenStore.ts          #   Document ledger persistence (globalState)
|   |   |   +-- SkillGenService.ts        #   Main orchestrator (scan, preflight, lock, pipeline, dedup, install)
|   |   |   +-- PhaseOrchestrator.ts      #   Phase-by-phase pipeline execution (replaces PythonPipelineRunner)
|   |   |   +-- ClaudeCliCaller.ts        #   Shared one-shot Claude CLI utility for AI phases
|   |   |   +-- DeduplicationEngine.ts    #   3-tier dedup (traceability, metadata similarity, AI placeholder)
|   |   |   +-- SkillInstaller.ts         #   Atomic skill installation with backup/rollback
|   |   |   +-- SrPtdBootstrap.ts         #   Auto-install SR-PTD skill + inject CLAUDE.md instructions
|   |   |   +-- phases/
|   |   |   |   +-- types.ts              #   Shared types (PhaseId, PhaseResult, progress ranges)
|   |   |   |   +-- PythonPhaseRunner.ts  #   Runs non-AI Python scripts (B, C.0-C.1, C.5, sanity)
|   |   |   |   +-- PhaseC2TagEnrichment.ts      #   AI tag enrichment via Claude CLI
|   |   |   |   +-- PhaseC3IncrementalClustering.ts  #   AI incremental clustering via Claude CLI
|   |   |   |   +-- PhaseC4CrossBucketMerge.ts       #   AI cross-bucket merging via Claude CLI
|   |   |   |   +-- PhaseDSkillSynthesis.ts          #   AI skill synthesis via Claude CLI (parallelized)
|   |   +-- teams/
|   |   |   +-- TeamTypes.ts             #   Core types (AgentStatus, TeamMember, TeamConfig, TeamTask, InboxMessage, TeamStateSnapshot)
|   |   |   +-- TeamDetector.ts          #   Scans ContentBlock[] for TeamCreate/TeamDelete tool_use
|   |   |   +-- TeamWatcher.ts           #   File watcher for ~/.claude/teams/ and ~/.claude/tasks/ (EventEmitter, polling fallback)
|   |   |   +-- TeamActions.ts           #   Write operations: sendMessage, createTask, updateTask, shutdownAgent
|   |   +-- achievements/
|   |   |   +-- AchievementCatalog.ts     #   30 achievement definitions, 7 categories
|   |   |   +-- AchievementStore.ts       #   Persistence via VS Code globalState (8 counters, 15 levels)
|   |   |   +-- AchievementEngine.ts      #   Game logic (files, languages, error cycles, goals)
|   |   |   +-- AchievementService.ts     #   Lifecycle bridge, streaks, tiers, AI insight wiring, GitHub auto-sync
|   |   |   +-- AchievementInsightAnalyzer.ts #  Sonnet CLI spawn for session analysis (once/day)
|   |   |   +-- GitHubSyncService.ts     #   GitHub PAT auth (SecretStorage), Gist CRUD, friend lookup, badge generation, auto-reconnect
|   |   +-- types/
|   |       +-- stream-json.ts            #   CLI protocol type definitions
|   |       +-- webview-messages.ts       #   postMessage contract
|   +-- webview/                          # React webview code (browser context)
|       +-- index.tsx                     #   React entry point
|       +-- App.tsx                       #   Main app with welcome/chat/status (StatusBar extracted to components/StatusBar/)
|       +-- state/store.ts               #   Zustand state management
|       +-- hooks/
|       |   +-- useClaudeStream.ts        #   postMessage event dispatcher
|       |   +-- useRtlDetection.ts        #   detectRtl() helper for InputArea (messages use dir="auto")
|       |   +-- useFileMention.ts         #   @ file mention trigger detection, debounced search, popup state
|       |   +-- useStatusBarCollapse.ts  #   3-stage responsive layout hook for grouped StatusBar (full/compact/minimal)
|       |   +-- useOutsideClick.ts      #   Centralized outside-click manager for all dropdowns/popovers
|       +-- components/
|       |   +-- ChatView/
|       |   |   +-- MessageList.tsx       #   Scrollable message list with scroll-to-bottom button
|       |   |   +-- MessageBubble.tsx     #   Single message with content blocks
|       |   |   +-- StreamingText.tsx     #   In-progress text with cursor
|       |   |   +-- ToolUseBlock.tsx      #   Tool use display (collapsible, plan-aware, TodoWrite visual card, agent/team delegation)
|       |   |   +-- AgentSpawnBlock.tsx  #   Inline agent spawn card with type badge, status dot, collapsible prompt/result
|       |   |   +-- AgentHierarchyBlock.tsx # Nested sub-agent tree visualization with connector lines
|       |   |   +-- TeamInlineWidget.tsx #   Compact inline team card with member status dots
|       |   |   +-- PlanApprovalBar.tsx  #   CLI-matching plan approval (4 options: clear+bypass, bypass, manual, feedback) or question UI (option buttons + custom answer)
|       |   |   +-- PromptHistoryPanel.tsx #  3-tab prompt history overlay (session/project/global)
|       |   |   +-- VisualProgress/
|       |   |   |   +-- VisualProgressView.tsx  #  VPM container with auto-scroll card timeline
|       |   |   |   +-- ProgressCard.tsx        #  Individual VPM card with character SVG, descriptions, meta
|       |   |   |   +-- characters/             #  10 animated SVG character components + index.ts (colors, labels, maps)
|       |   |   +-- CodeBlock.tsx         #   Syntax block with copy + HTML preview button
|       |   |   +-- MarkdownContent.tsx  #   Markdown rendering with sanitization and link detection
|       |   |   +-- filePathLinks.tsx   #   Clickable file path and URL detection and rendering
|       |   +-- InputArea/
|       |   |   +-- InputArea.tsx         #   Text input with RTL, Ctrl+Enter, clear session, interrupt/steer, usage-limit queue mode, scheduled messages, image paste, @ file mentions, ultrathink button, prompt navigation arrows
|       |   |   +-- FileMentionPopup.tsx  #   Autocomplete popup for @ file mentions
|       |   |   +-- GitPushPanel.tsx      #   Config panel for git push (status, ask Claude to configure)
|       |   |   +-- CodexConsultPanel.tsx #   Input panel for Codex GPT expert consultation
|       |   +-- ModelSelector/
|       |   |   +-- ModelSelector.tsx          #   Model dropdown (Sonnet/Opus/Haiku)
|       |   +-- PermissionModeSelector/
|       |   |   +-- PermissionModeSelector.tsx #   Full Access / Supervised mode toggle
|       |   +-- Vitals/
|       |   |   +-- SessionTimeline.tsx  #   Vertical color-coded turn minimap
|       |   |   +-- WeatherWidget.tsx    #   Animated weather mood icon
|       |   |   +-- CostHeatBar.tsx      #   Cost accumulation gradient bar
|       |   |   +-- VitalsContainer.tsx  #   Conditional wrapper for weather + cost bar + adventure
|       |   |   +-- AdventureWidget.tsx  #   Pixel-art dungeon crawler canvas wrapper
|       |   |   +-- VitalsInfoPanel.tsx  #   Info panel with explanations + toggles
|       |   |   +-- adventure/           #   Dungeon crawler engine
|       |   |       +-- types.ts         #     AdventureBeat, RoomType, AdventureConfig
|       |   |       +-- sprites.ts       #     Palette, 4x4 mini sprites, drawSprite()
|       |   |       +-- dungeon.ts       #     Maze class: generation, BFS, wall rendering, camera
|       |   |       +-- AdventureEngine.ts #   State machine, animation loop, renderer
|       |   +-- Achievements/
|       |   |   +-- AchievementPanel.tsx    #   Panel overlay (level, XP, goals, settings, Community + Share buttons)
|       |   |   +-- CommunityPanel.tsx      #   GitHub sync, friends list, side-by-side comparison
|       |   |   +-- ShareCard.tsx           #   Profile preview modal, copy markdown/shields badge
|       |   |   +-- AchievementToastStack.tsx #  Toast notifications for earned achievements
|       |   |   +-- SessionRecapCard.tsx     #   End-of-session summary card
|       |   |   +-- achievementI18n.ts       #   i18n translations (EN/HE) for all achievement + community UI
|       |   |   +-- levelThresholds.ts       #   XP level thresholds (shared with webview)
|       |   +-- SkillGen/
|       |   |   +-- SkillGenPanel.tsx     #   Full overlay panel (toggle, progress, history, actions)
|       |   |   +-- index.ts             #   Barrel export
|       |   +-- BugReport/
|       |   |   +-- BugReportPanel.tsx    #   Full-screen overlay (Quick/AI mode tabs, chat, script approve/reject)
|       |   |   +-- index.ts             #   Barrel export
|       |   +-- Dashboard/
|       |   |   +-- DashboardPanel.tsx    #   Root overlay (tab nav, close, Esc, Session/Project toggle)
|       |   |   +-- MetricsCards.tsx      #   8-card summary row
|       |   |   +-- TurnTable.tsx         #   Sortable paginated turn table
|       |   |   +-- dashboardUtils.ts     #   Colors, helpers, command categorization
|       |   |   +-- index.ts             #   Re-exports DashboardPanel
|       |   |   +-- tabs/
|       |   |   |   +-- OverviewTab.tsx   #     Session: Metrics + cost/duration charts + tools + mood
|       |   |   |   +-- TokensTab.tsx     #     Session: Token breakdown per turn
|       |   |   |   +-- ToolsTab.tsx      #     Session: Tool frequency + category donut
|       |   |   |   +-- TimelineTab.tsx   #     Session: Duration bar + task type + turn table
|       |   |   |   +-- CommandsTab.tsx   #     Session: Bash command timeline + filters
|       |   |   |   +-- ContextTab.tsx    #     Session: Metadata + conversation inspector
|       |   |   |   +-- ProjectOverviewTab.tsx  #  Project: Aggregated metrics + charts across sessions
|       |   |   |   +-- Project30DaysTab.tsx   #  Project: Last-30-days filtered analytics view
|       |   |   |   +-- ProjectSessionsTab.tsx  #  Project: Sortable/filterable session table
|       |   |   |   +-- ProjectTokensTab.tsx    #  Project: Aggregated token breakdown
|       |   |   |   +-- ProjectToolsTab.tsx     #  Project: Aggregated tool/category/task type
|       |   |   |   +-- UsageTab.tsx           #     Session: Usage widget (quota % per bucket)
|       |   |   |   +-- TokenRatioTab.tsx      #     Session: Token-usage ratio tracker (tokens per 1%)
|       |   |   +-- charts/
|       |   |       +-- RechartsWrappers.tsx  # 7 Recharts chart components
|       |   |       +-- SemanticWidgets.tsx   # MoodTimeline, FrustrationAlert, BugRepeatTracker
|       |   +-- Teams/
|       |   |   +-- TeamPanel.tsx           #   Full-screen overlay with 4 tabs (Topology, Tasks, Messages, Activity)
|       |   |   +-- TopologyTab.tsx         #   CSS Grid agent cards with status dots, badges, pulse animation
|       |   |   +-- TasksTab.tsx            #   Kanban board (Pending/InProgress/Completed) with inline add form
|       |   |   +-- MessagesTab.tsx         #   Chronological message feed with inline send form
|       |   |   +-- ActivityTab.tsx         #   Per-agent activity sections with shutdown buttons
|       |   |   +-- TeamStatusWidget.tsx    #   Draggable floating widget with progress bar
|       |   |   +-- teamColors.ts           #   Color constants for agents, statuses, tasks
|       |   |   +-- index.ts               #   Barrel exports
|       |   +-- ContextWidget/
|       |   |   +-- ContextUsageWidget.tsx  #   Thin draggable context strip (blue-first gradient + hover tooltip hit-zone)
|       |   +-- StatusBar/
|       |   |   +-- StatusBar.tsx            #   Grouped status bar: AI Chip + Session/Tools/View dropdowns + metrics
|       |   |   +-- AIChip.tsx               #   Compound control: Provider + Model + Permissions in one chip
|       |   |   +-- StatusBarGroupButton.tsx #   Reusable dropdown group button (uses useOutsideClick for outside-click handling)
|       |   +-- TextSettingsBar/
|       |       +-- TextSettingsBar.tsx   #   Font size/family/theme controls
|       +-- styles/
|           +-- global.css                #   VS Code theme variables
|           +-- markdown.css              #   Markdown element styles (headers, lists, tables, etc.)
|           +-- rtl.css                   #   RTL-specific overrides (includes Markdown RTL rules)
+-- sr-ptd-skill/                         # Bundled SR-PTD skill (installed to ~/.claude/skills/)
|   +-- SKILL.md                          #   Main skill instructions (949 lines)
|   +-- CLAUDE_MD_INSTRUCTIONS.md         #   Template for CLAUDE.md injection
|   +-- assets/
|   |   +-- full-template.md              #   Full SR-PTD template (Sections A-J)
|   |   +-- quick-template.md             #   Quick capture template
|   +-- references/
|       +-- example-completed.md          #   Worked example
+-- Kingdom_of_Claudes_Beloved_MDs/       # Detailed component documentation
    +-- API_KEY_MANAGEMENT.md             #   Environment sanitization & API key management
    +-- ARCHITECTURE.md                   #   Data flow and component interaction
    +-- ACTIVITY_SUMMARIZER.md            #   Periodic activity summary via Haiku
    +-- ADVENTURE_WIDGET.md              #   Pixel-art dungeon crawler session visualizer
    +-- CLAUDE_AUTH_LOGIN_LOGOUT.md      #   Claude CLI account login/logout/status integration
    +-- DRAG_AND_DROP_CHALLENGE.md        #   Why drag-and-drop is blocked, workarounds
    +-- FILE_LOGGER.md                    #   File-based logging with rotation and rename
    +-- FILE_MENTION.md                   #   @ file mention autocomplete feature
    +-- GIT_PUSH_BUTTON.md               #   Git push button and configuration
    +-- MARKDOWN_RENDERING.md            #   Markdown rendering pipeline (marked + DOMPurify)
    +-- MESSAGE_TRANSLATION.md           #   Hebrew translation via Sonnet CLI
    +-- PROJECT_30_DAYS_TAB.md          #   Project dashboard 30-day filtered tab behavior
    +-- SESSION_NAMER.md                  #   Auto-naming feature (data flow, gotchas, debugging)
    +-- SESSION_VITALS.md                 #   Session health dashboard (timeline, weather, cost bar)
    +-- SKILL_VISUAL_INDICATOR.md        #   Skill tool invocation visual indicators (badge, pill, category)
    +-- STREAM_JSON_PROTOCOL.md           #   CLI protocol reference
    +-- PROMPT_ENHANCER.md               #   AI prompt enhancement feature
    +-- USAGE_LIMIT_DEFERRED_SEND.md      #   Implemented usage-limit queue and deferred auto-send flow
    +-- USAGE_LIMIT_DEFERRED_SEND_PLAN.md #   Archived execution plan
    +-- SKILL_GENERATION.md             #   Auto skill generation from SR-PTD docs
```

---

## Component Index

**SessionTab** - Bundles all per-tab resources (process, demux, control, message handler, webview panel) and wires them together. Each tab is fully independent with its own CLI process. Generates a colored SVG icon for the VS Code tab bar and supports tab renaming via a hover button. Supports per-tab CLI override (`cliPathOverride`) so Happy provider sessions can reuse the same pipeline while spawning `happy` instead of `claude`. Exposes `getCliPathOverride()` and `getProvider()` via `WebviewBridge`, stamps `sessionStarted` with the active provider, and persists provider-aware metadata/analytics (`claude` vs `remote`). Detects missing CLI binaries and Happy auth-required stderr patterns, suppresses known non-fatal CLI stderr notices (for example `Using Claude Code v... from npm`), and sends targeted guidance to the webview instead of generic noise.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**TabManager** - Manages all SessionTab instances. Tracks the active (focused) tab, provides create/close/closeAll methods, shares a single status bar item, assigns distinct colors from an 8-color palette, and groups tabs in the same editor column.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**ClaUiSidebarViewProvider** - Provides the Activity Bar sidebar launcher view (`claui.sidebarLauncher`) and forwards button clicks from the sidebar webview to existing extension commands (start session, history, discovery, logs). This gives ClaUi a dedicated left-side VS Code icon without moving the main chat UI into the sidebar.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ACTIVITY_BAR_LAUNCHER.md`

**AuthManager** - Claude account auth helper for the extension host. Reads `.claude/.credentials.json` presence (legacy stub behavior) and now runs `claude auth status --json` / `claude auth logout` via `execFile` with a 10s timeout. Returns normalized `{ loggedIn, email, subscriptionType }` to `MessageHandler`, which forwards status to the webview and triggers logout refresh.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/CLAUDE_AUTH_LOGIN_LOGOUT.md`

**ClaudeProcessManager** - Spawns the Claude CLI child process with stream-json flags, handles stdin/stdout piping, process lifecycle, and crash detection. Uses the shared `killProcessTree()` utility on Windows to kill the entire process tree (required because `shell: true` creates a cmd.exe wrapper that SIGTERM alone cannot penetrate). Reads the user's API key from SecretStorage before each spawn and passes it via `buildClaudeCliEnv()`. Instantiated per-tab by SessionTab.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**Process Tree Kill (`killTree.ts`)** - Shared utility for cross-platform child process tree termination. On Windows, uses `taskkill /F /T /PID` to kill the cmd.exe wrapper AND all descendant processes. On Unix, uses standard `SIGTERM`. Used by all 13 CLI spawn points: `ClaudeProcessManager`, `CodexExecProcessManager`, `SessionNamer`, `CodexSessionNamer`, `ActivitySummarizer`, `VisualProgressProcessor`, `MessageTranslator`, `TurnAnalyzer`, `PromptEnhancer`, `PromptTranslator`, `ClaudeCliCaller`, `AchievementInsightAnalyzer`, `PythonPhaseRunner`.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/PROCESS_LIFECYCLE.md`

**Orphan Cleanup (`orphanCleanup.ts`)** - Runs on extension activation. Scans for orphaned node.exe processes from previous ClaUi sessions (identified by `stream-json` CLI flag in command line) whose parent process is dead, and kills them. Prevents zombie process accumulation when VS Code crashes or extension host dies without running `deactivate()`.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/PROCESS_LIFECYCLE.md`

**Environment Sanitization & API Key Management** - Shared utility (`envUtils.ts`) that sanitizes inherited environment variables for all spawned CLI processes. Strips `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, and `ANTHROPIC_API_KEY` (case-insensitive on Windows) from the inherited env. Two modes: `buildSanitizedEnv()` for Codex processes (no key injection), `buildClaudeCliEnv(apiKey?)` for Claude CLI processes (optional key injection). API key is stored in VS Code SecretStorage (OS keychain) and managed through the Settings panel UI. Used by all 9 CLI spawn points.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/API_KEY_MANAGEMENT.md`

**StreamDemux** - Receives raw CLI JSON events and demultiplexes them into typed, semantic events (textDelta, toolUseStart, messageDelta, assistantMessage, thinkingDetected, etc.) for UI consumers. Detects `thinking` content blocks, silently consumes thinking deltas, and emits `thinkingDetected` with effort level. Instantiated per-tab.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**WebviewProvider / buildWebviewHtml** - `buildWebviewHtml()` is an exported utility that generates CSP-safe HTML for webview panels. WebviewProvider class is retained for backward compatibility. SessionTab uses `buildWebviewHtml()` directly.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**MessageHandler** - Bidirectional bridge translating webview postMessages into CLI commands and StreamDemux events into webview messages. Accepts a `WebviewBridge` interface (implemented by SessionTab). Uses optional bridge hooks (`getCliPathOverride`, `getProvider`) so webview-triggered start/restart flows keep the tab's runtime routing (including Happy CLI override) and report the correct provider in `sessionStarted`. Triggers auto-naming on first user message. Detects plan approval pauses (ExitPlanMode/AskUserQuestion) and forwards approval responses.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**CodexMessageHandler** - Codex-specific webview/runtime bridge for `codex exec --json` sessions. Maps `CodexExecDemux` events into existing webview message types (including synthesized `messageStart`/`streamingText`/`messageStop` around complete Codex `agent_message` items), handles Codex settings/history/image sends, and serializes live turn message emission order. Additional hardening exists in the Codex tab and webview layers: `CodexSessionTab` serializes actual `panel.webview.postMessage(...)` deliveries by awaiting the VS Code Thenable in a FIFO queue, adds a turn-complete exit watchdog (force-stop if process lingers after `turn.completed`), recovers idle-but-running stale turns before starting a new one, and now supports approved mid-turn steering by cancelling the active turn before dispatching the new one. `CodexMessageHandler` keeps `processBusy` aligned with runtime state on send failures via `session.isTurnRunning()` and enforces a Codex-specific steer gate (`Stop`/`Steer`) when a turn is still active. It also assigns a fresh UI message ID for each Codex assistant message (instead of reusing raw `agent_message.id`, which can repeat across turns like `item_1`) to prevent long-session reply overwrite in the webview store. `useClaudeStream` also applies a Codex-only fallback that immediately upserts complete `assistantMessage` payloads so replies remain visible even if finalize/clear events arrive out of order.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/CODEX_INTEGRATION_PROGRESS.md`

**SessionNamer** - Spawns a one-shot `claude -p` process using Haiku to generate a 1-3 word tab name from the user's first message. Matches the language of the message (Hebrew/English). 10-second timeout, sanitized output, all errors silently logged.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/SESSION_NAMER.md`

**CodexSessionNamer** - Spawns a one-shot `codex exec --json` process (read-only sandbox) to generate a 1-3 word tab name from the first user message in Codex tabs. Uses `model_reasoning_effort=medium`, runs in the session/workspace `cwd` (same as normal Codex turns), parses `agent_message` JSON events, sanitizes output, and silently falls back if the CLI call fails. `CodexSessionTab` defers persistence/re-application when the name arrives before `thread.started` so the title is not overwritten by the temporary `Codex [threadId]` label.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/CODEX_INTEGRATION_PROGRESS.md`

**ActivitySummarizer** - Periodically summarizes Claude's tool activity via Haiku. After every N tool uses (configurable, default 3), sends enriched tool names to Haiku for a short label + full summary. Displays a detailed summary panel in the busy indicator (short label + full sentence). Updates status bar tooltip. Does NOT overwrite tab title (session name stays fixed). Debounces rapid tool uses, prevents concurrent calls.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ACTIVITY_SUMMARIZER.md`

**Message Translation** -- Translates assistant message text to a configurable target language (default: Hebrew) using a one-shot Claude Sonnet 4.6 CLI call. Language is selectable via the gear icon panel next to Vitals, or via the `claudeMirror.translationLanguage` VS Code setting. Supports 10 languages: Hebrew, Arabic, Russian, Spanish, French, German, Portuguese, Chinese, Japanese, Korean. RTL layout is applied automatically for Hebrew and Arabic. Triggered by a per-message button showing the target language name. Translations are cached per message; toggling is instant after first translation. Code blocks and technical terms are preserved.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/MESSAGE_TRANSLATION.md`

**FileLogger** - Writes log lines to disk files alongside the OutputChannel. Each session tab gets its own log file named `<session-name>_<dd-hh-mm>.log`. A global logger captures extension-level messages. Files auto-rotate at 2MB, rename when the session name changes, and new files are created on Reload Window or new session. Configurable via `claudeMirror.enableFileLogging` and `claudeMirror.logDirectory`.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/FILE_LOGGER.md`

**Stream-JSON Protocol** - Type definitions for the Claude CLI bidirectional JSON line protocol (stdin input, stdout output).
> Detail: `Kingdom_of_Claudes_Beloved_MDs/STREAM_JSON_PROTOCOL.md`

**Markdown Rendering** - Text content in messages is rendered as formatted Markdown using `marked` (parser) and `DOMPurify` (sanitizer). Supports bold, italic, headers, lists, tables, blockquotes, inline code, links, and horizontal rules. Fenced code blocks are extracted first and rendered by `CodeBlock` (with copy/collapse); remaining text segments go through `MarkdownContent`. Bare file paths and URLs in rendered Markdown are linkified via DOM post-processing. `openFile` now normalizes pasted/link tokens (leading punctuation/wrappers), supports both `:line[:col]` and GitHub-style `#Lline[Ccol]` anchors, and falls back to basename/suffix lookup (including parent-folder lookup for `.xcodeproj`/`.xcworkspace` workspaces) before opening. Full RTL/Hebrew support with directional overrides for blockquotes, lists, and code.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/MARKDOWN_RENDERING.md`

**React Chat UI** - React 18 components for message display, streaming text, tool use blocks, code blocks, image display, and RTL-aware input. The input area supports sending prompts while busy (interrupt/steer). In Codex tabs, when a turn is active the controls switch to `Stop` + `Steer`; pressing `Steer` asks for approval and then interrupts the running turn before sending the new prompt. Ctrl+V pastes images from clipboard as base64 attachments (shown as thumbnails above the input, removable before sending) when the active provider capability `supportsImages` is enabled (Claude + Codex). In Codex tabs, image attachments are converted to temporary files and passed to `codex exec` / `codex exec resume` via repeatable `--image` flags. Clipboard shortcut/paste diagnostics from `InputArea` can be forwarded to the extension log as `[UiDebug][InputArea] ...` entries for troubleshooting paste/image issues in the webview. Both Send/Steer and Cancel/Stop buttons are visible during processing; Escape cancels/stops the current response.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**Usage-Limit Deferred Send** - Claude-only deferred-send mode for temporary usage-limit errors. When the CLI returns a usage-limit reset message, the extension parses reset time, flips InputArea into `Send When Available`, and allows immediate queueing. The queue is tab-local (latest prompt wins), supports text and image payloads, schedules auto-send at `resetAt + 60s`, and retries every 15 seconds if the process is still busy at fire time. State and timers are cleared on session lifecycle transitions, provider switch away from Claude, and after a successful result.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/USAGE_LIMIT_DEFERRED_SEND.md`

**Scheduled Messages** - Users can schedule a message to be sent at a specific future time via a toggle in the send settings gear popover. A date/time picker sets the target time (default: 1 hour from now); the extension-side timer dispatches the message when the time arrives. A blue banner shows the scheduled message status with a cancel option. Only one scheduled message at a time (latest wins). State lives on the extension side (survives webview reloads) and is cleared on session lifecycle events. Mirrors the usage-limit deferred send architecture.

**StatusBar (Grouped Layout)** - Bottom status bar reorganized with a UX-first grouped design. Uses **AI Chip** compound control (`AIChip.tsx`) showing Provider+Model+Permissions in one segmented button that opens a config panel with provider pills, model/permissions selectors, and carry-context. Features organized into **3 semantic group dropdowns**: **Session** (History, Plans, Prompts, Dashboard, Teams, Achievements), **Tools** (Git, Consult, Babel Fish, SkillDocs, Feedback/Bugs), **View** (TextSettings/Font, Vitals toggle+settings). Right side shows **passive metrics**: session clock, usage bar with inline progress indicator, and token In/Out counts. Uses `useStatusBarCollapse` with 3 responsive stages (`full` >=650px: all groups visible; `collapsed` 380-650px: Session + merged "More"; `minimal` <380px: single "Menu"). Reduces ~25 inline buttons to ~7 visible elements while keeping every feature exactly 1 click away. Dropdowns open upward with click-outside dismiss, mutual exclusivity, and Escape key support.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**Global Tooltip System** - Unified, VS Code-themed tooltip rendered via a single `GlobalTooltip` React component mounted at the App root. Uses document-level event delegation to detect `mouseover` on any element with a `data-tooltip` attribute, then renders a positioned tooltip via `createPortal`. 400ms hover delay, auto-flips above/below trigger, shifts horizontally to stay within viewport, hides on scroll. Accessible (`role="tooltip"`, dynamic `aria-describedby`). Touch-device guard. All ~25 component files use `data-tooltip="..."` instead of native `title` attributes.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/GLOBAL_TOOLTIP_SYSTEM.md`

**Image Lightbox** - Full-screen overlay for viewing images at natural size. Double-clicking any image (pending input thumbnails or message bubble images) opens a dark overlay with the image centered at up to 90vw/90vh. Closes on backdrop click or Escape key. Portal-based component (`ImageLightbox`) mounted at App root, driven by `lightboxImageSrc` Zustand state field. CSS class `.image-lightbox-overlay` at z-index 9999.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/IMAGE_LIGHTBOX.md`

**TextSettingsBar** - In-webview UI for adjusting chat text font size, font family, and typing personality theme. Supports Hebrew-friendly font presets and four rendering themes: Terminal Hacker, Retro, Zen, and Neo Zen. Settings are stored in Zustand and synced from VS Code configuration on startup and on change.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**ModelSelector** - Dropdown in the status bar for choosing the Claude model (Sonnet 4.6, Sonnet 4.5, Opus 4.6, Haiku 4.5, or CLI default). Selection is persisted to VS Code settings (`claudeMirror.model`) and synced back to the webview on startup and on change. Changing the model takes effect immediately: the current session is stopped and resumed with the new model (live switch via `SessionTab.switchModel()`). Shows the currently active model label when connected.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**PermissionModeSelector** - Dropdown in the status bar for choosing between "Full Access" and "Supervised" modes. Selection is persisted to VS Code settings (`claudeMirror.permissionMode`). In the Claude path, "Full Access" passes `--permission-mode bypassPermissions` and "Supervised" passes `--allowedTools` (read-only tool set). In the Codex path, "Full Access" passes `--dangerously-bypass-approvals-and-sandbox` and "Supervised" passes `--sandbox read-only`. Changes take effect on the next process/session start (Claude) or next turn spawn (Codex).

**GitPushButton** - One-click git add/commit/push via the `scripts/git-push.ps1` PowerShell script. The "Git" button in InputArea executes the script with the session tab name as commit message. A companion gear button opens a configuration panel where users can ask Claude to set up or modify the git push settings (`claudeMirror.gitPush.*`). If not configured (enabled=false), clicking the Git button opens the config panel instead. Results appear as auto-dismissing toast notifications.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/GIT_PUSH_BUTTON.md`
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**Ultrathink Button & Glow** - Brain icon button in the input area that injects the "ultrathink" keyword to boost Claude's reasoning effort. On click, plays one of 4 random CSS animations (Rocket Launch, Brain on Fire, Wizard Staff, Turbo/NOS) for 1.2s, then prepends "ultrathink " to the input text. Includes a lock toggle badge that, when active, auto-prepends "ultrathink" to every outgoing prompt. The word "ultrathink" also displays with an animated rainbow glow effect (cycling colors, sparkle particles) in both completed and streaming chat messages.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ULTRATHINK_BUTTON.md`

**Prompt Navigation Arrows** - Up/down arrow buttons above the Send button that scroll the chat view to the previous/next user prompt. Filters messages by `role === 'user'`, tracks an index ref, and uses `data-message-id` DOM queries with `scrollIntoView({ behavior: 'smooth', block: 'center' })`. Navigation index resets when new messages arrive.

**Clear Session** - Button in the input area that resets all UI state (messages, cost, streaming) and restarts the CLI process. Sends `clearSession` message to the extension, which stops the current process and spawns a new one.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**SessionStore** - Persists session metadata (ID, name, model, timestamps, first prompt) in VS Code `globalState`. The History command (`Ctrl+Shift+H`) first shows a source picker with two options: "Extension Sessions" (ClaUi-only sessions from SessionStore) and "All Sessions" (delegates to SessionDiscovery for disk-wide scan including CLI sessions). Extension Sessions shows session name, model, relative time, and first prompt line. Preserves existing names when sessions are resumed. Capped at 100 entries, sorted by most recently active.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**ConversationReader** - Reads full conversation history from Claude Code's local session storage (`~/.claude/projects/<project-hash>/<session-id>.jsonl`). When resuming a session, the CLI in pipe mode waits for user input before replaying messages. ConversationReader bypasses this by reading the JSONL file directly, merging partial assistant entries by message ID, filtering out tool_result and thinking blocks, and sending the conversation to the webview for immediate display. Used by `SessionTab.startSession()` during resume (not fork).
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**SessionDiscovery** - Scans `~/.claude/projects/` filesystem to discover all Claude Code sessions on disk, including sessions created outside ClaUi. Provides `discoverAll()` (all workspaces) and `discoverForWorkspace()` (current only). Extracts first user prompt from JSONL files (first 16KB scan). Two-step QuickPick: scope selection then session picker with relative time and file size. Keybinding: `Ctrl+Alt+D`.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/SESSION_DISCOVERY.md`

**PromptHistoryStore** - Persists user prompts at two scopes: project (`workspaceState`) and global (`globalState`). Prompts are saved on every `sendMessage`/`sendMessageWithImages` (and Codex text sends / edit-and-resend). Deduplicates consecutive entries, capped at 200 per scope. The webview requests history via `getPromptHistory` message and receives it via `promptHistoryResponse` (handled by both Claude and Codex message handlers).
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**Prompt History Panel** - Modal overlay with 3 tabs (Session / Project / Global) showing prompt history. Session tab uses in-memory `promptHistory` from the Zustand store. Project and Global tabs fetch from `PromptHistoryStore` via extension messaging. Includes text filter and click-to-insert into the input textarea. Opened via the "Prompts" button in the status bar (next to "History"). In collapsed mode, appears under the "More" dropdown.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**Error Banner Behavior** - Runtime errors from extension/webview messaging are stored in `store.lastError` and rendered by `App.tsx` as a top banner. Setup guidance errors (missing Claude/Codex CLI) stay persistent with action buttons. Generic command failures matching `Command failed (exit N)` auto-dismiss after 10 seconds, while still allowing manual dismiss.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**File Mention (@)** - Inline autocomplete triggered by typing `@` in the chat textarea. Searches workspace files via `vscode.workspace.findFiles()` with 150ms debounce, showing results in a popup above the input. Navigate with ArrowUp/Down, select with Enter/Tab/click. Replaces `@query` with the relative file path. Uses custom DOM events for extension-to-webview communication (same pattern as prompt history). All state is local to the `useFileMention` hook (not in Zustand).
> Detail: `Kingdom_of_Claudes_Beloved_MDs/FILE_MENTION.md`

**Plan Approval UI** - When Claude calls `ExitPlanMode` or `AskUserQuestion`, the extension detects this via the `messageDelta` event with `stop_reason: 'tool_use'` and shows a CLI-matching 4-option approval bar: (1) clear context + bypass permissions, (2) bypass permissions, (3) manually approve edits, (4) type feedback. The bar **persists until user interaction** (button click, typed message, or a new `planApprovalRequired` replacing it). For `ExitPlanMode`, approve actions close the bar without immediately sending user messages (the CLI usually auto-approves via bypassPermissions/allowedTools; immediate text would create spurious turns causing infinite loops). The approve fallback now re-checks while the CLI is busy and sends `"Continue with the implementation."` when the CLI becomes idle with no non-plan execution progress, with a 30s max-wait failsafe to prevent click no-op deadlocks. If non-plan execution activity (e.g., `TodoWrite`, `Read`) is observed after approval, the nudge is skipped and a later `ExitPlanMode` call is treated as a fresh cycle (not stale suppression) so the approval bar can reappear instead of deadlocking. Reject/feedback actions send text to the CLI. For `AskUserQuestion`, responses are sent as user messages. Option 1 also triggers context compaction. Option 3 switches to supervised permission mode. Context usage percentage is shown when token data is available. Debugging adds explicit approval-path logs (`[EPM_APPROVE]`, `[APPROVAL_STATE]`) and webview click telemetry (`[UiDebug][PlanApprovalBar]`) in `Output -> ClaUi`. Plan tool blocks render with distinct blue styling and show extracted plan text instead of raw JSON. `TodoWrite` blocks now render as a dedicated visual task card with progress bar, status counters, and color-coded todo rows instead of raw JSON.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`
> Bug history: `Kingdom_of_Claudes_Beloved_MDs/BUG_EXITPLANMODE_INFINITE_LOOP.md`

**Open Plan Docs** - "Plans" button in the status bar that opens HTML plan documents from both `Kingdom_of_Claudes_Beloved_MDs/` and the project root in the default browser. Files from both locations are merged and sorted by modification time (newest first), with a location tag (Kingdom/Root) in the QuickPick description. Single file opens directly; multiple files show a QuickPick. When no plan documents exist in either location, offers to activate the Plans feature by injecting a "Plan mode" prompt into the project's `CLAUDE.md` (with Hebrew or English language choice). Also available via Command Palette (`claudeMirror.openPlanDocs`).
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**Editable Prompts** - Users can edit previously sent messages by hovering over a user message and clicking "Edit". The message content switches to an inline textarea. On send, all messages from the edit point onward are removed from the UI, the current CLI session is stopped, then **resumed** with `--resume <sessionId>` (without `--replay-user-messages` to avoid re-emitting old messages). The edited prompt is sent into the resumed session so Claude retains full prior conversation context. Only text-only user messages are editable (not images). The edit button is hidden while the assistant is busy.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**Fork Conversation** - Users can fork the conversation from any user message by hovering and clicking "Fork". The webview sends a truncated message history (everything before the selected user message) plus the selected message text. `claudeMirror.forkFromMessage` creates a new tab using the same provider as the source session. Claude tabs use a **two-phase fork**: Phase 1 spawns `claude --resume <id> --fork-session` (without `--replay-user-messages`) which creates the fork and exits; the exit handler detects `forkInProgress`, captures the new session ID, then Phase 2 resumes the forked session interactively with `--resume <new-id> --skipReplay`. Codex tabs use a simple UI-level fork (new Codex session, copied history snapshot in the webview, and the forked message prefilled in the input box, without resuming the original thread). **BTW (Side Thought)**: Right-click anywhere in the message list to open a "btw..." context menu. In compose mode, users can either open a new tab (same fork flow as above) or click **Send** to start an in-place floating side chat. Claude tabs route BTW chat through `BackgroundSession` (forked Claude side process). Codex tabs route BTW chat through `CodexBackgroundSession` (dedicated Codex side thread, seeded with clipped recent context from the current tab). This keeps BTW chat isolated from the main message stream while using the active provider. Key files: `BtwContextMenu.tsx`, `BtwPopup.tsx`, `MessageBubble.tsx` (Fork button), `MessageList.tsx` (handlers for both fork and BTW), `MessageHandler.ts` / `CodexMessageHandler.ts` (BTW + fork routing), `BackgroundSession.ts` / `CodexBackgroundSession.ts`, `SessionTab.ts` / `CodexSessionTab.ts`, `commands.ts` (`claudeMirror.forkFromMessage`), `App.tsx` (fork completion logic), `InputArea.tsx` (`fork-set-input` listener).
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ARCHITECTURE.md`

**Session Vitals** - Visual session health dashboard with 5 components: Session Timeline (vertical color-coded minimap alongside messages, click-to-jump), Weather Widget (animated mood icon reflecting error/success patterns), Cost Heat Bar (gradient strip showing cost accumulation), Turn Intensity Borders (colored left border on assistant messages based on tool activity), and a Vitals toggle button in the StatusBar. The Vitals gear dropdown (`VitalsInfoPanel`) also hosts quick settings utilities including API key management and Claude CLI account Login/Logout/Refresh controls (status shown as email + subscription type when available). Data pipeline: `MessageHandler` builds `TurnRecord` on each CLI result event, sends to webview via `turnComplete` postMessage, stored in Zustand (`turnHistory[]`, `turnByMessageId{}`). Weather mood recalculated on each turn via sliding window algorithm. All components hidden when vitals disabled.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/SESSION_VITALS.md`

**Skill Visual Indicator** - Three-layer visual system for Skill tool invocations: (1) SkillBadge in the message stream -- magenta-accented card with skill name chip and "invoking..." streaming label; (2) Status bar skill pill -- animated magenta pill with glowing dot, appears during active invocation, disappears on turn completion; (3) Turn category integration -- `'skill'` category with magenta color (`#e040fb`) in timeline segments, intensity borders, and dashboard charts.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/SKILL_VISUAL_INDICATOR.md`

**Adventure Widget** - Pixel-art dungeon crawler that visualizes session activity as a thin-wall maze grid. Each CLI turn extends the maze and maps to an encounter: scrolls (Read), anvils (Edit), traps (errors), dragons (3+ errors), treasure (recovery). Canvas 2D engine with 4x4 mini sprites on a 40x40 cell maze, PICO-8 palette, BFS pathfinding, state machine (IDLE/WALKING/ENCOUNTER/RESOLUTION). Extension-side `AdventureInterpreter` converts `TurnRecord` to `AdventureBeat` via deterministic rules. Toggleable separately from main vitals.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ADVENTURE_WIDGET.md`

**Display Mode Slider** - A 4-position slider in the Vitals panel selects the active display mode: **Normal** (default, standard output), **Summary**, **Visual Progress**, or **Detailed Diff**. All modes are mutually exclusive -- the slider sets all 3 boolean flags atomically. Replaces the previous individual toggles.

**Summary Mode** - When enabled, splits the chat area 50/50: a full-height animated visualization panel on the left, and text-only messages on the right. Animation type is session-fixed (randomly chosen from 5 types: Building Blocks, Progress Path, Puzzle Assembly, Rocket Launch, Growing Tree). Each tool call visibly advances the animation (continuous progression, full at ~50 tools). Tool blocks are hidden from messages. Persists across sessions.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/SUMMARY_MODE.md`

**Visual Progress Mode (VPM)** - Card-based visual progress display that shows what Claude is doing in real time. Each tool action generates an animated card with a category-specific SVG character illustration and a template description. Cards flow in a vertical timeline with connecting arrows in a 340px side panel alongside messages. Extension-side `VisualProgressProcessor` maps tool events to 10 categories (reading, writing, editing, searching, executing, delegating, planning, skill, deciding, researching), emits template cards at `toolUseStart`, enriches with full input details at `blockStop`, and optionally queues Haiku API calls for AI-generated natural language descriptions (max 2 concurrent, cached, 8s timeout). Webview uses upsert logic so cards update in-place. AI descriptions toggle separately.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/VISUAL_PROGRESS_MODE.md`

**Achievements / Trophy** - Gamification system that awards badges for coding milestones. Features: 30 achievements across 7 categories (debugging, testing, refactor, collaboration, session, architecture, productivity), 4 rarities, XP-based leveling (15 tiers), per-session goals (7 templates), daily streaks, file/language tracking, frontend/backend classification, error cycle detection, toast notifications with optional sound, session recap card with AI insights, and full i18n (EN+HE). AI Session Insight: spawns Sonnet CLI once per day at session end for deeper analysis (quality, pattern, XP bonus). Includes a live recap snapshot request (`requestSessionRecapSnapshot`) used by an idle reminder nudge (1 hour idle, with Later=3h deferral / Dismiss) without ending the session. Edit-and-resend now abandons the current achievement session state and restarts cleanly without emitting a false session recap. **Community / GitHub Sync**: Publish achievements to a public GitHub Gist, discover and compare with other developers via friend lookup, generate shields.io dynamic badges and markdown profile cards for GitHub README. Backend: `AchievementEngine`, `AchievementCatalog`, `AchievementStore`, `AchievementService`, `AchievementInsightAnalyzer`, `GitHubSyncService`. Frontend: `AchievementPanel`, `CommunityPanel`, `ShareCard`, `AchievementToastStack`, `SessionRecapCard`, `achievementI18n.ts`.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ACHIEVEMENTS.md`

**Analytics Dashboard** - Full-screen overlay with three modes: **Session** (7 tabs: Overview, Tokens, Tools, Timeline, Commands, Context, Usage), **Project** (5 tabs: Overview, 30 Days, Sessions, Tokens, Tools), and **User** (Token Ratio). A pill toggle in the header switches modes (blue=Session, purple=Project, amber=User). Session mode shows current-session analytics from Zustand `turnHistory`. Project mode aggregates `SessionSummary` records across all past sessions in the workspace, persisted in `ProjectAnalyticsStore` (VS Code `workspaceState`, survives restarts). User mode shows global user-level analytics from VS Code `globalState` (shared across all workspaces). Session summaries are auto-saved from ALL exit paths (normal exit, crash, tab close, VS Code close, session clear, edit-and-resend) via `flushTurnRecords()` + `analyticsSaved` guard to prevent data loss and double-save. Project data is loaded on demand. Usage and Token Ratio period chips use a fixed period list (`5 Hours`, `24 Hours`, `7 Days`, `14 Days`, `30 Days`, `2 Months`) and show empty states when a specific bucket has no data.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ANALYTICS_DASHBOARD.md`

**Project 30 Days Tab** - Additional Project-mode analytics tab that filters `projectSessions` to the last 30 days (`startedAt >= now - 30d`) and reuses `ProjectOverviewTab` charts/metrics on the filtered subset. Displays contextual count + cutoff date banner and an empty-state message when no recent sessions exist.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/PROJECT_30_DAYS_TAB.md`

**TurnAnalyzer** - Background semantic analysis engine (enabled by default). After each turn completes, spawns a one-shot Claude CLI process (using `claudeMirror.analysisModel`) to classify user mood, task type, outcome, and bug repetition. Results arrive asynchronously and merge into `turnHistory` via `turnSemantics` postMessage. Includes queue (max 20), per-session cap, timeout, and enable flag for cost control.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ANALYTICS_DASHBOARD.md`

**Token-Usage Ratio Tracker** - Correlates token consumption with Anthropic usage percentage to answer "how many tokens equal 1% of usage?" Uses cost-weighted token calculation (Output=5x, CacheWrite=1.25x, Input=1x, CacheRead=0.1x) so the ratio accurately reflects actual API spend. Global singleton (`TokenUsageRatioTracker`) injected via extension.ts -> TabManager -> SessionTab -> MessageHandler. Samples every 5 turns: records cumulative weighted tokens, fetches usage % via `UsageFetcher`, computes delta-based `tokensPerPercent` ratio. Stores up to 500 samples in VS Code `globalState` (persists across sessions). Groups samples by billing bucket, computes per-bucket summaries (avg, latest, trend). Displayed in the dashboard's **User** mode (top-level, alongside Session and Project) since it operates at user level, not session or project level. Dashboard `TokenRatioTab` shows summary cards with cost weight info, Recharts trend line, raw + weighted token columns in samples table. The trend chart uses period-aware X-axis labels (time for 5/24-hour buckets, date for 7-day+ buckets). Serialized write queue prevents race conditions from concurrent tabs.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/ANALYTICS_DASHBOARD.md`

**Auto Skill Generation** - Automatically generates Claude skills from accumulated SR-PTD documentation files. Scans a configurable docs directory, maintains a persistent document ledger (fingerprint-based change detection), and triggers a phase-orchestrated pipeline when the pending document count reaches a configurable threshold. The pipeline runs 8 phases: non-AI phases (B, C.0-C.1, C.5, sanity) execute as Python subprocesses, while AI phases (C.2 tag enrichment, C.3 incremental clustering, C.4 cross-bucket merge, D skill synthesis) use Claude Code CLI one-shot calls -- no API key required. Features configurable min-docs thresholds (C3 minDocsPerBucket=3, C4 minDocsPerSkill=3), aggressive merge bias (maxSkillsPerRollup=2), 120-char trigger-first descriptions, lower dedup upgrade threshold (0.45), usage tracking via `SkillUsageTracker` (`_usage.json`), and auto-archiving when skills exceed maxSkills cap (50). 3-tier deduplication, atomic install with backup/rollback, cross-process locking, resume support. Backend: `SkillGenStore`, `SkillGenService`, `PhaseOrchestrator`, `ClaudeCliCaller`, `phases/*`, `DeduplicationEngine`, `SkillInstaller`, `SkillUsageTracker`. Frontend: `SkillGenPanel`.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/SKILL_GENERATION.md`

**SR-PTD Bootstrap** - On activation, automatically installs the bundled SR-PTD skill to `~/.claude/skills/sr-ptd-skill/` and injects post-task documentation instructions into the project-level `CLAUDE.md`. Skill files are only overwritten when the bundled version changes (size comparison). CLAUDE.md injection uses marker-based duplicate detection (`MANDATORY: Post-Task Documentation (SR-PTD)`). The docs save path in the template uses the configured `claudeMirror.skillGen.docsDirectory` value. Enabled by default, can be disabled via `claudeMirror.srPtdAutoInject`.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/SKILL_GENERATION.md`

**Prompt Enhancer** - AI-powered prompt rewriting that improves user prompts before sending. Uses a one-shot `claude -p` CLI call with a meta-prompt applying advanced prompt engineering (scaffolding, structure, context cues). Manual mode: sparkles button or Ctrl+Shift+E opens a comparison panel showing original and enhanced prompts stacked vertically for side-by-side review. Auto mode: intercepts Send, enhances, then auto-sends (falls back to original on failure). Gear popover with auto-enhance toggle and model selector. Configurable via `claudeMirror.promptEnhancer.*` settings.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/PROMPT_ENHANCER.md`

**Babel Fish (Unified Translation)** - Bi-directional translation layer that lets users work in their native language while Claude Code receives and responds in English. One master toggle in the StatusBar enables auto-translation in both directions: user prompts are translated to English (via PromptTranslator), and Claude's responses are auto-translated back to the user's chosen language (via MessageTranslator). Settings panel accessible via "Babel Fish" button next to Vitals, with language selector and info (!) explainer. Supports 10 languages. Both translators use Sonnet 4.6.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/PROMPT_TRANSLATOR.md`

**Codex Consultation** - Consult an external GPT expert (Codex) directly from the chat UI. A "Consult" button in the StatusBar opens an input panel where the user types a question. The question is sent to the Claude CLI session as a structured prompt instructing Claude to enrich it with system context and call the `mcp__codex__codex` MCP tool. The Codex response streams into the chat, and Claude continues development based on the advice.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/CODEX_CONSULTATION.md`

**File Path Insertion** - Drag-and-drop into editor-area webviews is blocked by VS Code, so direct drop is not supported. Supported workflows are: `+` file picker, Explorer context command `ClaUi: Send Path to Chat`, and keyboard shortcut `Ctrl+Alt+Shift+C` (active editor file path).
> Detail: `Kingdom_of_Claudes_Beloved_MDs/DRAG_AND_DROP_CHALLENGE.md`

**FormspreeService** - Standalone service for sending user feedback (text + optional file attachments) to the developer via Formspree.io. Write-only endpoint, no secrets in the codebase. Supports native multipart file uploads (paid plan) with automatic fallback to base64-embedded files in the message body (free plan). 15-second timeout, logger injection, follows GitHubSyncService patterns.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/FORMSPREE_FEEDBACK.md`

**Full Bug Report** - Comprehensive in-extension bug reporting. 4th option in the Feedback QuickPick. Opens an overlay panel with two modes: Quick Report (required text description + auto-collected diagnostics) and AI-Assisted Report (chat with Claude Sonnet for guided diagnosis, with script suggestion approve/reject). Auto-collects system info, VS Code environment, CLI versions, and recent logs. Packages everything into a ZIP via `adm-zip` and submits via `FormspreeService`. Privacy-first: nothing sent until explicit user approval. Backend: `BugReportService`, `DiagnosticsCollector`. Frontend: `BugReportPanel`.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/BUG_REPORT_FEATURE.md`

**Agent Teams** -- Visualization and flow control for Claude Code's experimental Agent Teams feature. Auto-detects team creation/deletion from CLI stream (`TeamCreate`/`TeamDelete` tool_use blocks). Watches `~/.claude/teams/{name}/` and `~/.claude/tasks/{name}/` directories for live state updates (config, tasks, inbox messages) via `TeamWatcher` (EventEmitter, 100ms debounce, 2s polling fallback). Full-screen overlay panel with 4 tabs: Topology (agent cards with status dots and pulse animation), Tasks (kanban board with inline add), Messages (chronological feed with inline send), Activity (per-agent status with shutdown). Draggable floating widget shows team name, agent counts, and task progress bar. **Inline chat visualization**: `AgentSpawnBlock` renders specialized cards for `Agent`/`Task`/`dispatch_agent` tool_use blocks with type badge (Explore=orange, Plan=blue, general-purpose=purple), pulsing status dot, description, and collapsible prompt/result. `AgentHierarchyBlock` renders nested sub-agent trees with connector lines. `TeamInlineWidget` renders compact inline team cards with member status dots. `ToolUseBlock` delegates to these components when detecting agent/team tool names. `MessageBubble` pairs agent tool_use blocks with their tool_result for inline display. Backend: `TeamDetector`, `TeamWatcher`, `TeamActions`, `TeamTypes`. Frontend: `TeamPanel`, `TeamStatusWidget`, `TopologyTab`, `TasksTab`, `MessagesTab`, `ActivityTab`, `AgentSpawnBlock`, `AgentHierarchyBlock`, `TeamInlineWidget`. Keybinding: `Ctrl+Alt+T`.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/AGENT_TEAMS.md`

**Happy Provider (remote)** -- The internal provider id remains `'remote'`, but implementation now reuses the standard `SessionTab` + `ClaudeProcessManager` pipeline and only swaps the executable path to Happy CLI via `ProcessStartOptions.cliPathOverride`. `TabManager.createRemoteTab()` creates a regular `SessionTab` and sets `claudeMirror.happy.cliPath` (default `happy`). Both command-driven and webview-driven start/restart paths honor this override. Auth flow is handled by spawning `happy auth` via command `claudeMirror.authenticateHappy`, and `SessionTab` detects auth-required stderr patterns to show targeted guidance.
> Detail: `Kingdom_of_Claudes_Beloved_MDs/REMOTE_SESSIONS.md`

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `claudeMirror.cliPath` | `"claude"` | Path to Claude CLI executable |
| `claudeMirror.happy.cliPath` | `"happy"` | Path to the Happy Coder CLI executable (used by provider `'remote'`) |
| `claudeMirror.useCtrlEnterToSend` | `true` | Ctrl+Enter sends, Enter adds newline |
| `claudeMirror.autoRestart` | `true` | Auto-restart process on crash |
| `claudeMirror.chatFontSize` | `14` | Font size (px) for chat messages (10-32) |
| `claudeMirror.chatFontFamily` | `""` | Font family for chat messages (empty = VS Code default) |
| `claudeMirror.typingTheme` | `"neo-zen"` | Response rendering personality theme: "terminal-hacker", "retro", "zen", or "neo-zen" |
| `claudeMirror.autoNameSessions` | `true` | Auto-generate tab names from first message (Claude: Haiku, Codex: one-shot codex exec) |
| `claudeMirror.activitySummary` | `true` | Periodically summarize tool activity in busy indicator via Haiku |
| `claudeMirror.activitySummaryThreshold` | `3` | Tool uses before triggering an activity summary (1-10) |
| `claudeMirror.model` | `""` | Claude model to use for new sessions (empty = CLI default) |
| `claudeMirror.permissionMode` | `"full-access"` | Permission mode: "full-access" (all tools) or "supervised" (read-only tools only) |
| `claudeMirror.enableFileLogging` | `true` | Write logs to disk files in addition to the Output Channel |
| `claudeMirror.logDirectory` | `""` | Directory for log files (empty = extension's default storage) |
| `claudeMirror.sessionVitals` | `false` | Show Session Vitals dashboard (timeline, weather, cost bar, turn borders) |
| `claudeMirror.adventureWidget` | `false` | Show pixel-art dungeon crawler adventure widget |
| `claudeMirror.summaryMode` | `false` | Summary Mode: hide tool details, show animated activity summaries |
| `claudeMirror.visualProgressMode` | `false` | Visual Progress Mode: animated card-based progress display (mutually exclusive with Summary Mode) |
| `claudeMirror.vpmAiDescriptions` | `true` | Use Haiku AI to generate natural language descriptions for VPM cards |
| `claudeMirror.analysisModel` | `"claude-haiku-4-5-20251001"` | Model for background analysis (session naming, summaries, semantic turn analysis) |
| `claudeMirror.turnAnalysis.enabled` | `false` | Enable background semantic analysis for dashboard insights |
| `claudeMirror.turnAnalysis.maxPerSession` | `30` | Max semantic analysis calls per session tab |
| `claudeMirror.turnAnalysis.timeoutMs` | `30000` | Timeout for a single semantic analysis call |

> **Note:** `turnAnalysis.enabled` and `analysisModel` are also configurable inline via the Vitals gear button in the StatusBar. Changes sync bidirectionally with VS Code settings.

| `claudeMirror.promptEnhancer.autoEnhance` | `false` | Automatically enhance prompts before sending |
| `claudeMirror.promptEnhancer.model` | `"claude-sonnet-4-6"` | Model used for prompt enhancement (Haiku/Sonnet 4.6/Sonnet 4.5/Opus 4.6) |
| `claudeMirror.promptTranslator.enabled` | `false` | Translate prompts to English before sending them to Claude |
| `claudeMirror.promptTranslator.autoTranslate` | `false` | Automatically send the translated prompt (requires translation enabled) |
| `claudeMirror.gitPush.enabled` | `true` | Whether git push is configured and ready to use via the Git button |
| `claudeMirror.gitPush.scriptPath` | `"scripts/git-push.ps1"` | Path to the git push script (relative to workspace root) |
| `claudeMirror.gitPush.commitMessageTemplate` | `"{sessionName}"` | Commit message template ({sessionName} = tab name) |
| `claudeMirror.srPtdAutoInject` | `true` | Automatically inject SR-PTD instructions into project CLAUDE.md and install sr-ptd-skill |
| `claudeMirror.skillGen.enabled` | `true` | Enable auto skill generation feature (toggleable via gear icon in UI) |
| `claudeMirror.skillGen.threshold` | `5` | Number of new SR-PTD docs to trigger generation (1-50) |
| `claudeMirror.skillGen.docsDirectory` | `"C:\\projects\\Skills\\Dev_doc_for_skills"` | Directory containing SR-PTD documents |
| `claudeMirror.skillGen.docsPattern` | `"SR-PTD_*.md"` | Glob pattern for SR-PTD files |
| `claudeMirror.skillGen.skillsDirectory` | `"~/.claude/skills"` | Target directory for generated skills |
| `claudeMirror.skillGen.pythonPath` | `"python"` | Path to Python executable |
| `claudeMirror.skillGen.toolkitPath` | `""` | Path to skill generation toolkit |
| `claudeMirror.skillGen.workspaceDir` | `""` | Isolated workspace directory for pipeline |
| `claudeMirror.skillGen.pipelineMode` | `"run_pipeline"` | Pipeline mode (legacy, ignored by PhaseOrchestrator) |
| `claudeMirror.skillGen.autoRun` | `true` | Automatically run pipeline when threshold reached |
| `claudeMirror.skillGen.timeoutMs` | `300000` | Pipeline timeout in milliseconds (5 min default) |
| `claudeMirror.skillGen.aiDeduplication` | `false` | Enable AI-powered deduplication (Tier 3) |
| `claudeMirror.teams.enabled` | `true` | Enable Agent Teams detection and visualization |
| `claudeMirror.teams.autoOpenPanel` | `true` | Auto-open team panel when a team is detected |
| `claudeMirror.teams.pollIntervalMs` | `2000` | Polling interval for team file watching (ms) |

---

## Dependencies

| Package | Purpose |
|---------|---------|
| react 18 | Webview UI framework |
| react-dom 18 | React DOM renderer |
| zustand 4 | Lightweight state management |
| marked | Markdown-to-HTML parser (GFM support) |
| dompurify | HTML sanitizer for XSS prevention |
| recharts 3 | D3-backed React chart library (analytics dashboard) |
| webpack 5 | Bundling (dual-target) |
| ts-loader | TypeScript compilation in webpack |
| css-loader + style-loader | CSS bundling for webview |

---

## CLI Data Format Gotchas

The Claude CLI's stream-json protocol has several data format inconsistencies that the webview must handle defensively:

### User message content can be a string

With `--replay-user-messages`, the CLI echoes back `user` events. The `content` field may be a **plain string** instead of the expected `ContentBlock[]` array. If you call `.filter()` or `.map()` on it, React crashes and the entire component tree unmounts (text disappears).

**Fix**: Always normalize content before use:
```typescript
const normalized: ContentBlock[] = typeof content === 'string'
  ? [{ type: 'text', text: content }]
  : Array.isArray(content) ? content : [{ type: 'text', text: String(content) }];
```

This normalization is applied in `addUserMessage` (store) and defensively in `MessageBubble`.

### Result event cost fields may be undefined

The `result/success` event's `cost_usd`, `total_cost_usd`, and `usage` fields can be `undefined`. Calling `.toFixed()` on undefined crashes `StatusBar`.

**Fix**: Use nullish coalescing: `(cost?.costUsd ?? 0).toFixed(4)`

### General rule

**Never trust CLI event field types at runtime.** Always use defensive access (`?.`, `?? default`, `Array.isArray()` checks) for any data coming from the CLI protocol. The TypeScript interfaces describe the *ideal* shape, not the guaranteed runtime shape.

---

## Build & Deploy Workflow

### Critical rule (prevents stale-code bugs)

`npm run build` updates only your workspace `dist/`.
VS Code runs the extension from the installed folder under:

```
%USERPROFILE%\.vscode\extensions\
```

If you skip packaging + install, VS Code may run old code even though local source is updated.

### Canonical update flow (always use this)

Preferred:

```bash
cd C:\projects\claude-code-mirror
npm run deploy:local
```

Manual equivalent:

```bash
cd C:\projects\claude-code-mirror
npm run build
npx vsce package --allow-missing-repository
# Install the VSIX matching the current version in package.json:
code --install-extension claude-code-mirror-*.vsix --force
```

Then run `Developer: Reload Window`.

### Post-install verification checklist (mandatory for new commands/menu/keybindings)

Fast path:

```bash
cd C:\projects\claude-code-mirror
npm run verify:installed
```

Manual checks:

Run these checks after installing:

```powershell
# 1) Verify the latest installed extension folder
$ext = Get-ChildItem -Path "$env:USERPROFILE\.vscode\extensions" -Directory `
  | Where-Object { $_.Name -like '*claude-code-mirror*' } `
  | Sort-Object LastWriteTime -Descending `
  | Select-Object -First 1
$ext.FullName

# 2) Verify installed manifest contains expected contributions
Get-Content -Path (Join-Path $ext.FullName 'package.json') `
  | Select-String -Pattern 'claudeMirror.sendFilePathToChat|keybindings|menus|editor/context|explorer/context'

# 3) Verify installed runtime bundle contains expected command symbol
Select-String -Path (Join-Path $ext.FullName 'dist\extension.js') `
  -Pattern 'sendFilePathToChat' | Select-Object -First 1
```

If any check fails, VS Code is still on stale code. Re-run package/install and reload window.

### Troubleshooting stale installs quickly

1. Confirm extension is installed: `code --list-extensions --show-versions | rg claude-code-mirror`
2. Reinstall with `--force`.
3. Reload window (`Developer: Reload Window`).
4. Check `Output -> ClaUi` for fresh startup timestamps after reload.

### Production build note

`npm run build` (which runs `webpack --mode production`) **strips `console.log` statements** via terser minification. Use `--mode development` when you need diagnostic logging in the webview.

### Debugging the webview

Open `Developer: Open Webview Developer Tools` in VS Code to access the webview's browser console. This shows React errors, state logs, and network issues. The webview runs inside a sandboxed iframe with a strict CSP.

### Blank webview panel (VS Code rendering bug)

The webview panel may open completely blank - no HTML renders at all (not even plain text without JavaScript). This is a **VS Code / Chromium webview rendering bug** where the webview iframe fails to initialize properly. It is NOT a code issue.

**Fix**: Open `Developer: Toggle Developer Tools` (Ctrl+Shift+I). This forces the webview to repaint and content appears. You can close Developer Tools immediately after - the webview will keep working.

**Symptoms**: The Output channel (`ClaUi`) shows `Webview: creating new panel` and `HTML length = ...` but no `Webview: received message type="ready"`. The panel is visible but empty.

**Known triggers**: VS Code reload, VS Code updates, certain window layouts. Observed on VS Code 1.109.0.

---

## Error Boundary

The React app is wrapped in an `ErrorBoundary` component (`index.tsx`) that catches render crashes and displays the error message + stack trace directly in the webview panel, instead of showing a blank screen. This is critical for debugging because webview errors are otherwise silent.

---

## VS Code Marketplace Publishing

### Publisher Info

| Item | Value |
|------|-------|
| Publisher ID | `JhonBar` |
| Publisher Name | Jhon Bar |
| Marketplace Manage | https://marketplace.visualstudio.com/manage/publishers/JhonBar |
| Extension URL | https://marketplace.visualstudio.com/items?itemName=JhonBar.claude-code-mirror |
| Azure DevOps (PAT) | https://dev.azure.com/yonzbar/_usersSettings/tokens |
| Repository | https://github.com/Yehonatan-Bar/ClaUI |

### PAT (Personal Access Token) Requirements

When creating/renewing a PAT at the Azure DevOps link above:
- **Organization**: Must be **"All accessible organizations"** (not a specific org)
- **Scopes**: Custom defined > **Marketplace > Manage**
- PAT expires periodically - renew when `vsce publish` fails with auth errors

### Publishing an Update (Step by Step)

After making code changes and testing locally with `npm run deploy:local`:

```bash
cd C:\projects\claude-code-mirror

# 1. Make sure you're logged in (one-time, or after PAT renewal)
vsce login JhonBar

# 2. Publish with automatic version bump
vsce publish patch
```

**What `vsce publish patch` does automatically:**
1. Bumps `version` in `package.json` (e.g., `0.1.0` -> `0.1.1`)
2. Runs `npm run build` (via the `vscode:prepublish` script)
3. Packages everything into a `.vsix` (respecting `.vscodeignore`)
4. Uploads to the Marketplace
5. Verification runs (usually takes up to 5 minutes)

**Version bump options:**

| Command | Example | Use when |
|---------|---------|----------|
| `vsce publish patch` | 0.1.0 -> 0.1.1 | Bug fixes, small changes |
| `vsce publish minor` | 0.1.1 -> 0.2.0 | New features |
| `vsce publish major` | 0.2.0 -> 1.0.0 | Breaking changes |

**After publishing:**
- Update `CHANGELOG.md` with the new version entry
- Users with auto-update enabled will get the new version automatically
- The Marketplace page (`README.md`) updates within a few minutes

### Publishing via Website (Fallback)

If PAT/CLI issues prevent `vsce publish`:

```bash
# Build the .vsix package only
vsce package
```

Then upload the `.vsix` manually at https://marketplace.visualstudio.com/manage/publishers/JhonBar

Note: Manual upload does NOT auto-bump the version. Update `version` in `package.json` yourself before running `vsce package`.

### Pre-publish Checklist

1. Test locally with `npm run deploy:local` + VS Code reload
2. Ensure `npm run build` succeeds
3. Verify `images/icon.png` exists (copied from `src/logo.png`)

### Key Files for Marketplace

| File | Purpose |
|------|---------|
| `package.json` | Extension manifest (`publisher`, `icon`, `repository`, `license`) |
| `README.md` | Displayed as the extension's Marketplace page |
| `CHANGELOG.md` | Displayed in the "Changelog" tab on Marketplace |
| `LICENSE` | MIT license |
| `images/icon.png` | Extension icon (must NOT be in `src/` - excluded by `.vscodeignore`) |
| `.vscodeignore` | Controls what goes into the `.vsix` package |

### Tool Installation

```bash
npm install -g @vscode/vsce
```

---

## Implementation Phases

| Phase | Status | Description |
|-------|--------|-------------|
| **1. Core Chat** | Done | Process management, stream parsing, React chat UI |
| **1.5 Multi-Tab** | Done | Multiple parallel sessions in separate VS Code tabs (SessionTab + TabManager) |
| **2. Terminal Mirror** | Stub | PseudoTerminal mirroring same session |
| **3. Sessions** | Partial | Multi-tab sessions (done), resume (done), fork from message (done), conversation history (done), rewind (stub) |
| **4. Input** | Partial | File picker + Explorer send-path + keyboard shortcut (done), send-while-busy interrupt (done), image paste via Ctrl+V (done), RTL enhancements (done), editable prompts (done) |
| **5. Accounts** | Stub | Multi-account, compact mode, cost tracking |
| **6. Polish** | Pending | Virtualized scrolling, error recovery, theming |

---

## 2026-03-05 - Provider Handoff (Claude <-> Codex) Mid-Session

### New Components (Component Index Additions)

- `src/extension/session/handoff/HandoffTypes.ts`
  - Unified handoff capsule/stage contracts.
- `src/extension/session/handoff/HandoffContextBuilder.ts`
  - Builds provider-neutral `HandoffCapsule` from source tab snapshot/history.
- `src/extension/session/handoff/HandoffPromptComposer.ts`
  - Composes the target-session opening prompt from capsule data.
- `src/extension/session/handoff/HandoffArtifactStore.ts`
  - Saves handoff artifacts (`.json` + `.md`) under managed logs with secret redaction and size budgeting.
- `src/extension/session/handoff/HandoffOrchestrator.ts`
  - End-to-end handoff state machine (`collecting_context` -> `completed|failed`).

### Updated Components

- `src/extension/session/TabManager.ts`
  - Added `handoffSession(...)` API with per-tab lock + cooldown.
  - Integrates `HandoffOrchestrator` and posts `handoffProgress` stage events to source webview.
  - Links source/target session metadata for audit/debug.
- `src/extension/session/SessionTab.ts`
  - Added handoff snapshot API (`collectHandoffSnapshot()`), busy getter (`isBusyState()`), and deferred-context staging API (`setPendingHandoffPrompt()`).
- `src/extension/session/CodexSessionTab.ts`
  - Added handoff snapshot API, provider getter (`getProvider()`), and deferred-context staging API.
- `src/extension/webview/MessageHandler.ts`
  - Added `switchProviderWithContext` request handling and deferred handoff-context injection on first user turn.
- `src/extension/webview/CodexMessageHandler.ts`
  - Added `switchProviderWithContext` handling, deferred handoff-context injection on first user turn, and clipboard support for handoff fallback.
- `src/extension/commands.ts`
  - Added command: `claudeMirror.switchProviderWithContext` (explicit command-palette flow).
- `src/extension/types/webview-messages.ts`
  - Added `switchProviderWithContext` request and `handoffProgress` extension event.
- `src/webview/state/store.ts`
  - Added handoff UI state (`handoffStage`, target, error, artifact/manual prompt).
- `src/webview/hooks/useClaudeStream.ts`
  - Handles `handoffProgress` and auto-clears completed state.
- `src/webview/components/StatusBar/StatusBar.tsx`
  - Added clear action split:
    - `Switch (Carry Context)`
    - existing provider buttons keep `Open Clean Session` behavior.
  - Added one-line handoff progress/failure banner and manual fallback button.
- `src/webview/components/InputArea/InputArea.tsx`
  - Locks input/actions during active handoff stages and shows lock/progress indicator.
- `src/extension/session/SessionStore.ts`
  - Added handoff metadata fields:
    - `handoffSourceTabId`, `handoffSourceProvider`
    - `handoffTargetTabId`, `handoffTargetProvider`
    - `handoffArtifactPath`, `handoffCompletedAt`

### Directory Structure Delta

Under `src/extension/session/`:

- Added folder: `handoff/`
- Added files:
  - `HandoffTypes.ts`
  - `HandoffContextBuilder.ts`
  - `HandoffPromptComposer.ts`
  - `HandoffArtifactStore.ts`
  - `HandoffOrchestrator.ts`

### Manifest/Settings Delta

Added command in `package.json`:

- `claudeMirror.switchProviderWithContext` (`ClaUi: Switch Provider (Carry Context)`)

Added settings:

- `claudeMirror.handoff.enabled` (default: `true`)
- `claudeMirror.handoff.storeArtifacts` (default: `true`)

### Runtime Notes

- Cross-provider resume is still clean-session based (no shared hidden memory transfer).
- Context transfer uses `HandoffCapsule` + deferred first-user-turn injection (no automatic send on switch).
- On failure, target tab remains open and manual capsule prompt is available for copy/send fallback.

### Detail Doc

- `Kingdom_of_Claudes_Beloved_MDs/PROVIDER_HANDOFF.md`

---

## 2026-03-11 - BTW Codex Parity

### New Components (Component Index Additions)

- `src/extension/session/CodexBackgroundSession.ts`
  - Headless Codex BTW runtime for side-conversation overlay.
  - Emits BTW-compatible event stream (`messageStart`, `textDelta`, `assistantMessage`, `messageStop`, `result`) from `codex exec --json` demux events.
  - Persists BTW `threadId` across turns while keeping the main tab session untouched.

### Updated Components

- `src/extension/session/CodexSessionTab.ts`
  - Added full BTW lifecycle: `startBtwSession()`, `sendBtwMessage()`, `closeBtwSession()`.
  - Added Codex BTW event forwarding (`btwMessageStart`, `btwStreamingText`, `btwAssistantMessage`, `btwResult`, `btwSessionEnded`).
  - Added bootstrap prompt builder that seeds Codex BTW with clipped recent context from `collectHandoffSnapshot()`.
- `src/extension/webview/CodexMessageHandler.ts`
  - Added routing for webview BTW requests: `startBtwSession`, `sendBtwMessage`, `closeBtwSession`.
- `src/webview/components/ChatView/BtwPopup.tsx`
  - Assistant role label in BTW overlay is now provider-aware (`Claude` vs `Codex`).

### Directory Structure Delta

Under `src/extension/session/`:

- Added file:
  - `CodexBackgroundSession.ts`

### Manifest/Settings Delta

- None.

### Runtime Notes

- BTW chat now follows the active provider:
  - Claude tab -> Claude background BTW session.
  - Codex tab -> Codex background BTW session.
- UI store/state contract is unchanged (`btw*` messages), so existing BTW overlay logic in webview remains shared.

### Detail Doc

- `Kingdom_of_Claudes_Beloved_MDs/btw_bug.md`
