# ClaUi - Comprehensive Feature Catalog

**ClaUi** is a professional VS Code extension that transforms the Claude Code CLI into a full-featured visual IDE experience. It manages multiple independent Claude/Codex AI agent sessions in parallel, each with its own process and dedicated UI, while providing rich analytics, gamification, security controls, and advanced workflow tools.

---

## 1. Multi-Tab Session Architecture

**Core Concept:** Each conversation runs as a completely independent session with its own Claude CLI process, process state manager, output demultiplexer, and webview panel. A `TabManager` coordinates all tabs, tracks the active tab, and provides centralized lifecycle management.

**Key Capabilities:**
- **Parallel session execution** - Multiple tabs can run simultaneously without blocking each other; stopping one tab doesn't affect others
- **Per-tab color coding** - Each tab gets a unique color from an 8-color palette (blue, coral, green, orange, purple, cyan, gold, brick) for visual distinction at a glance
- **Auto-naming via AI** - First message is sent to a lightweight AI (Haiku for Claude, one-shot `codex exec` for Codex) to generate a short, descriptive tab name. Can be manually overridden with a pencil icon
- **Activity indicators** - Spinning animation in tab title shows when Claude is processing, with live summary of current tool activity (e.g., "reading files", "testing")
- **Session persistence** - All sessions are stored in VS Code `globalState` as `SessionStore` metadata (ID, name, model, timestamps, first prompt), capped at 100 entries, sorted by most recent first
- **Tab hibernation** - Long-inactive tabs can be "hibernated" (suspended) to free memory while preserving full conversation history for instant resume
- **Tab groups and folders** - Organize related tabs into color-coded groups with nested sub-folders; drag-and-drop reordering support

---

## 2. Conversation Management & History

**Resume & Fork System:**
- **Browse past sessions** - QuickPick modal shows all previous sessions with session name, model, relative timestamp, and first prompt preview
- **Resume sessions** - Restore any past session with full conversation history. Claude's state is resumed via the CLI `--resume` flag
- **Conversation reader** - Reads JSONL files directly from Claude's local session storage (`~/.claude/projects/<hash>/<session>.jsonl`) for instant history display, bypassing CLI replay delays
- **Fork from message** - Click "Fork" on any user message to branch into a new tab. Cloned conversation up to that message is copied; Codex tabs use UI-level fork with copied history and prefilled input area
- **BTW (Side Thought)** - Right-click anywhere to open a "btw..." context menu for off-topic questions without disrupting the main flow. Creates a new tab with conversation context up to the clicked message
- **Editable prompts** - Hover over any sent user message to reveal an "Edit" button. On resend, all subsequent messages are cleared, the CLI session restarts, and the edited prompt becomes the new first message

**Prompt History System:**
- **3-tier history** - Session (in-memory, current only), Project (VS Code `workspaceState`, per-workspace), Global (VS Code `globalState`, all workspaces)
- **History panel** - Modal overlay with 3 tabs (Session/Project/Global), text search filter, and click-to-insert into input area
- **Arrow navigation** - Up/Down arrows cycle through recent prompts in the input textarea directly
- **Auto-deduplication** - Every sent prompt automatically saves; duplicates are removed; capped at 200 per scope

---

## 3. Model & Provider Selection

**Claude Models:**
- Supported versions: Fable 5.1, Opus 5, Sonnet 5, Haiku 4.5, plus legacy versions (Opus 4.8/4.7/4.6, Sonnet 4.6/4.5)
- Model selector dropdown in status bar with friendly labels and live switching
- Selection persists to VS Code settings and is restored on startup
- Changing model during an active session stops and resumes it with the new model

**Codex (OpenAI GPT) Integration:**
- Full runtime support via `codex exec --json` for first turn and `codex exec resume --json` for follow-up turns
- Prompt passed via stdin to avoid Windows command-line length limits (~8,191 chars)
- Cancel kills only current turn process (logical session stays alive with thread ID)
- **Codex speed selector** - "Default" vs "Fast" dropdown; fast mode applies higher token-use credit pricing on supported models
- Image paste support (temporary files with `--image` flags)
- Git push integration works in Codex tabs
- Provider-specific UI gating (Codex tabs hide SkillGen, Usage, and other Claude-only features)

**Dual-Provider Switch:**
- Provider selector in status bar and quick-switch "Codex" button
- Selection persisted per tab

---

## 4. Permission Modes & Security

**Full Access Mode:**
- All tools enabled
- Claude: `--permission-mode bypassPermissions`
- Codex: `--dangerously-bypass-approvals-and-sandbox`
- Useful for autonomous agent work

**Supervised Mode:**
- Read-only tool set
- Claude: restricted `--allowedTools` (Read, Grep, Glob, WebFetch, WebSearch only)
- Codex: `--sandbox read-only`
- Better for untrusted code or human-in-the-loop work

**Mode Toggle:**
- Status bar dropdown to switch modes
- Takes effect on next process/session start (Claude) or next turn spawn (Codex)

---

## 5. Plan Approval & User Questions

**Plan Approval Bar:**
- Matches Claude CLI's 4-option approval flow:
  1. Clear context + bypass permissions (triggers context compaction)
  2. Bypass permissions only
  3. Manually approve edits (switches to supervised mode)
  4. Type feedback (sends text to CLI)
- Context usage percentage displayed when available

**AskUserQuestion Support:**
- Shows option buttons + custom answer input for every question in multi-question calls
- Stacked question groups with per-question answers
- Full-access mode: answers injected via `can_use_tool` control protocol
- Supervised mode: answers sent as user messages

**Plan Styling:**
- Blue-themed plan tool blocks
- Extracted plan text displayed instead of raw JSON
- `ExitPlanMode` closes the bar without sending user messages (prevents infinite loops)

---

## 6. Rich Input & Interaction

**Image Handling:**
- `Ctrl+V` pastes images from clipboard as base64 attachments
- Shows removable thumbnail preview above input before sending
- Works in both Claude and Codex tabs
- Codex tabs convert to temporary files with `--image` flags

**Send While Busy & Cancellation:**
- Send new prompt while Claude is responding (interrupts gracefully)
- `Escape` or Cancel button stops mid-response; session auto-resumes immediately
- Both Send and Cancel buttons visible during processing

**File Mentions & Insertion:**
- Type `@` to trigger workspace file search with autocomplete (150ms debounce)
- Navigate with ArrowUp/Down, select with Enter/Tab/click
- Replaces `@query` with relative file path
- Three file sending methods:
  1. Right-click in Explorer: "ClaUi: Send Path to Chat" (multi-file support)
  2. "+" button next to input to file picker
  3. `Ctrl+Alt+Shift+C` keyboard shortcut while editing

**RTL Support:**
- Full right-to-left support for Hebrew and Arabic
- Automatic direction detection on messages
- RTL-specific CSS overrides for proper rendering

**Custom Controls:**
- `Ctrl+Enter to send` (configurable; when enabled, Enter adds newline)
- `Ctrl+Alt+Enter` alternate send hotkey

---

## 7. Analytics Dashboard

A comprehensive 3-mode overlay (Session, Project, User) with rich metrics and visualizations.

### Session Mode (7 tabs):

**Overview:**
- 6 metric cards: turns completed, error rate, total tool uses, top tool, bash commands, avg duration
- Duration bar chart per turn (colored by task category)
- Tool frequency horizontal bar (top 15 tools)
- Turn category distribution donut chart
- Mood timeline (colored dots reflecting session health)
- Frustration alert (triggers on 3+ consecutive frustrated turns)

**Tokens:**
- Input, output, cache creation, cache read summary cards
- Stacked token bar per turn

**Tools:**
- Top 15 tools frequency
- Category distribution

**Timeline:**
- Turn duration bars (by category)
- Task type + outcome distribution
- Sortable, paginated turn table (15 rows/page)

**Commands:**
- Category filter chips (git, npm, test, build, deploy, search, file, other)
- Searchable command timeline
- Bug repeat tracker (when repeated bugs detected)

**Context:**
- Session metadata (ID, model, CWD, MCP servers, available tools)
- Full conversation inspector with expandable messages
- Each message shows: text, tool_use blocks (name + input), tool_result (output + error status), images
- Role-based filter (All/User/Assistant)
- Free-text search across message content and tool details
- Expand All/Collapse All controls

**Usage:**
- Live Anthropic API usage data (OAuth token from `~/.claude/.credentials.json`)
- Billing buckets with usage %, daily spend, monthly limit, reset dates
- Auto-refresh toggle with configurable interval
- Fixed period tabs (5 hours, 24 hours, 7 days, 14 days, 30 days, 2 months)

### Project Mode (5 tabs):

**Project Overview:**
- Aggregated metrics across all workspace sessions: total sessions, turns, tool uses, error rate, most used model, avg duration
- Turns per session bar chart
- Aggregated tool frequency (all sessions)
- Model usage distribution

**Project 30 Days:**
- Filtered view of last 30 days of sessions
- Reuses overview tab rendering

**Project Sessions:**
- Text-searchable, sortable table of all sessions
- Columns: Name, Date, Model, Turns, Errors, Duration, Top Tool
- Expandable rows showing token breakdown, tool frequency, category distribution

**Project Tokens:**
- Aggregated token summary cards
- Per-session token breakdown stacked bar

**Project Tools:**
- Aggregated tool frequency and category distribution

### User Mode (3 tabs):

**Token-Usage Ratio:**
- Correlates cost-weighted tokens with usage percentage changes over time
- Cost weight formula: Output=5x, CacheWrite=1.25x, Input=1x, CacheRead=0.1x
- Summary cards per billing bucket with trend indicators
- Global stats bar (total turns, raw tokens, weighted tokens, per-type breakdown)
- Trend line chart with period awareness (time labels for short periods, dates for long)
- 50-sample history table with date, bucket, usage %, raw delta, weighted delta
- "Resample Now" button for immediate usage fetch
- First baseline sample after 2 turns, then every 5 turns

**Memory:**
- Live process memory snapshot every 2.5s while tab is open
- Stat cards: VS Code RSS, Extension Host RSS (with V8 heap), ClaUi CLI tree total, system memory %
- Area chart tracking memory over time (last 240 samples ~10 min)
- Horizontal bar chart showing VS Code process categories (Main, Extension Host, other)
- Per-tab CLI tree table (tab name, provider, PID, descendant count, RSS)
- "Clear history" button for fresh reset

**Particle Accelerator:**
- Skill filter management UI (see Particle Accelerator section)

---

## 8. Semantic Turn Analysis (TurnAnalyzer)

**Asynchronous Background Analysis:**
- After each turn completes, spawns one-shot Claude CLI process to classify:
  - User mood (frustrated, neutral, satisfied, focused)
  - Task outcome (success, partial, failure, unclear)
  - Task type (feature, bug_fix, testing, refactor, documentation, deployment, research, other)
  - Bug repetition (whether user is hitting the same error repeatedly)
  - Analysis confidence level

**Cost Controls:**
- Queue (max 20 pending analyses)
- Per-session cap (default 30, configurable)
- Timeout (default 30s, configurable)
- Enable/disable toggle via settings or Vitals gear panel

**Configuration:**
- Configurable model via `claudeMirror.analysisModel` (default: Haiku)
- Can switch to Sonnet for higher quality

**Results Display:**
- Merged into turn history via `turnSemantics` postMessage
- Used by Timeline, Commands, and Dashboard tabs to color-code turns and track trends

---

## 9. Session Vitals Dashboard

Visual session health monitoring system with 4 components:

**Weather Widget:**
- Animated mood icon reflecting session state
- Clear sky = smooth sailing, storms = many errors, rainbow = just recovered
- Sliding window algorithm based on recent turn outcomes

**Session Timeline:**
- Vertical color-coded minimap on right side
- Each segment = one completed Claude turn
- Colors:
  - Green = success
  - Red = error/failure
  - Blue = discussion only (no tools)
  - Purple = code-write tools (Write/Edit/MultiEdit)
  - Orange = research tools (Read/Grep/Glob/WebSearch)
  - Cyan = command tools (Bash/Terminal)
  - Magenta = skill tool invocations
- Click any segment to jump to that turn's message

**Turn Intensity Borders:**
- Colored left border on assistant messages (same colors as timeline)
- Border width reflects tool activity:
  - Thin = 0 tools
  - Medium = 1-3 tools
  - Thick = 4+ tools

**Skill Visual Indicator:**
- Three-layer system for skill invocations:
  1. Magenta-accented card in message stream with skill name
  2. Animated magenta pill with glowing dot in status bar during invocation
  3. Magenta turn category in timeline and dashboard charts

**Vitals Toggle:**
- Button in StatusBar to show/hide all vitals components
- Settings via Vitals gear dropdown

---

## 10. Adventure Widget (Pixel-Art Dungeon Crawler)

**Immersive Visual Session Metaphor:**
- 220x220 cell thin-wall maze rendered on Canvas 2D
- Each CLI turn extends the maze with new encounters
- Player encounters reflect turn activities:
  - Scrolls = Read operations
  - Anvils = Edit operations
  - Traps = Single errors
  - Dragons = 3+ errors in one turn
  - Treasure = Recovery from errors

**Visual Engine:**
- 4x4 mini sprites with PICO-8 color palette
- BFS pathfinding for optimal routes
- Camera tracking following player movement
- State machine animations: IDLE, WALKING, ENCOUNTER, RESOLUTION

**Toggles:**
- Can be enabled/disabled independently via `claudeMirror.adventureWidget` setting or Vitals gear panel
- Visible only when vitals are enabled

---

## 11. Achievements & Gamification System

**65 Achievements Across 7 Categories:**

**Debugging (12):** First Blood, Speed Patch, Bug Squasher, Hot Streak, Persistence, Error Whisperer, Bug Slayer tiers (I-IV)

**Testing (10):** Test First, Test Marathon, Test Driven Dev, Quality Gate, Green Wave, Green Streak, Test Master tiers (I-IV)

**Refactoring (8):** Tidy Up, Clean Sweep, Heavy Refactor, Surgeon, Mega Refactor, Edit Veteran tiers (I-III)

**Session (11):** Night Owl, Early Bird, Weekend Warrior, Marathon, Deep Focus, Sprint, Half Century, Centurion, Double Centurion

**Architecture (7+):** Tracked by file/language complexity and config edits

**Collaboration & Productivity:** Various cross-session milestones

**Rarity System:**
- Common (10 XP), Rare (25-40 XP), Epic (45-70 XP), Legendary (180-250 XP)
- Rarity-colored toast notifications with optional sound effects

**XP & Leveling:**
- 25 levels with progressive XP thresholds
- Per-session goals (7 templates assigned to each session)
- Daily streaks tracked (consecutive days with sessions)

**Session Recap Card:**
- Shown at session end or on manual "live recap snapshot" request
- Displays: duration, bugs fixed, tests passed, files touched, languages used, badges earned, XP gained, coding pattern
- AI-powered insights via one-shot Sonnet CLI (once per day, optional)
- Session quality badge and coding pattern classification

**Community & Social Features:**
- **GitHub Gist publishing** - Publish achievements to public Gist (`claui-achievements.json`)
- **Friend system** - Discover friends by GitHub username; 15-minute friend cache
- **Side-by-side comparison** - Compare stats and achievement grids with friends
- **Shields.io badges** - Generate dynamic badges for GitHub README
- **Markdown profile cards** - Copy-paste profile table for GitHub profiles
- **Auto-reconnect** - Reconnects to GitHub on extension activation

**i18n:**
- Full English + Hebrew translation
- Language selector in achievement panel

---

## 12. Activity Summarizer

**Periodic Human-Readable Summaries:**
- After every N tool uses (configurable, default 3), sends enriched tool names to Haiku
- Returns: short label (3-5 words) + full 1-sentence summary

**Display:**
- Shows in tab title activity indicator area
- Updates status bar tooltip with latest summary
- Does not overwrite session name (tab name stays fixed)

**Debounce:**
- Prevents concurrent Haiku calls on rapid tool sequences

---

## 13. Message Translation

**Supported Languages:** Hebrew, Arabic, Russian, Spanish, French, German, Portuguese, Chinese, Japanese, Korean

**Per-Message Translation:**
- Language button on each assistant message
- One-shot Sonnet 4.6 CLI call (not cached by default)
- Preserves code blocks and technical terms intact

**Caching:**
- Translations cached per message; toggling is instant after first translation

**Auto RTL:**
- Hebrew and Arabic automatically get right-to-left layout

**Configuration:**
- "Translate to" dropdown in Vitals gear panel
- `claudeMirror.translationLanguage` setting

---

## 14. Prompt Enhancer

**AI-Powered Prompt Rewriting:**
- Uses meta-prompt with advanced prompt engineering techniques
- Scaffolding, structure, context cues

**Two Modes:**

**Manual Mode:**
- Sparkles button near Send opens comparison panel
- Original and enhanced prompts shown side-by-side
- User can review and edit before sending

**Auto Mode:**
- Intercepts Send, enhances automatically, then sends
- Falls back to original on failure

**Configuration:**
- Gear popover with auto-enhance toggle
- Model selector (Haiku, Sonnet 4.6, Sonnet 4.5, Opus 4.6)
- `claudeMirror.promptEnhancer.model` setting

---

## 15. Codex Expert Consultation

**GPT Expert Integration:**
- "Consult" button in StatusBar opens input panel
- User's question enriched with Claude CLI context
- Claude calls `mcp__codex__codex` MCP tool to fetch GPT advice
- Codex response streams back into conversation
- Claude continues development based on advice

---

## 16. Text Settings & Typing Personality Themes

**Font Customization:**
- Font size slider (10-32px via "Aa" panel)
- Font family presets (Hebrew-friendly) + custom input
- Settings persist in Zustand and VS Code config

**4 Typing Personality Themes:**

**Terminal Hacker:**
- Green-on-black, high contrast
- Typewriter streaming with prominent cursor
- Technical, sharp, fast feel

**Retro:**
- CRT-inspired palette with vintage atmosphere
- Subtle scanline effects
- Monospace nostalgia

**Zen:**
- Minimalist calm colors
- Soft animations, smooth transitions
- Slow "breathing" pace

**Neo Zen:**
- Cool blue-turquoise, futuristic
- Glass-like effect with soft cursor glow
- Still minimalist, no aggressive effects

**Instant Application:**
- Theme changes apply immediately to all messages and history
- Display-only (no content/model/token changes)
- Persisted in `claudeMirror.typingTheme` setting

---

## 17. Markdown Rendering & Code Blocks

**Full GitHub Flavored Markdown:**
- Bold, italic, headers, lists, tables, blockquotes, inline code, links, horizontal rules

**Fenced Code Blocks:**
- Extracted and rendered by `CodeBlock` component
- Syntax highlighting for 50+ languages
- Copy button, collapse toggle, HTML preview button (renders in new VS Code tab)

**XSS Protection:**
- DOMPurify sanitization on all rendered markdown

**Clickable File Paths & URLs:**
- Bare file paths and URLs auto-linkified via DOM post-processing
- Smart detection with fallback to text if path doesn't exist

**RTL/Hebrew Support:**
- Full directional overrides for blockquotes, lists, code blocks
- Dedicated `rtl.css` with markdown-specific RTL rules

---

## 18. Git Push Integration

**One-Click Git Workflow:**
- "Git" button in status bar executes `scripts/git-push.ps1` PowerShell script
- Runs: `git add .`, `git commit -m "<session-name>"`, `git push`

**Customization:**
- Config panel (gear button next to Git) to set up or modify settings
- Session name as default commit message (customizable template)
- Auto-opens config panel if not yet configured

**Feedback:**
- Toast notifications show success/failure results
- Works in both Claude and Codex tabs

---

## 19. Auto Skill Generation (SkillGen)

**SR-PTD (Search Result - Prompt Templating Documentation) Pipeline:**

**Document Scanning:**
- Scans configurable directory for accumulated SR-PTD documentation files
- Fingerprint-based change detection for new/modified documents
- Persistent ledger of processed documents

**8-Phase Pipeline:**
- **B (Extract)** - Python subprocess, non-AI
- **C.0-C.1 (Normalize)** - Python subprocess, non-AI
- **C.2 (Tag Enrichment)** - Claude CLI one-shot
- **C.3 (Incremental Clustering)** - Claude CLI one-shot
- **C.4 (Cross-Bucket Merge)** - Claude CLI one-shot
- **C.5 (Sanity)** - Python subprocess, non-AI
- **D (Skill Synthesis)** - Claude CLI one-shot (parallelized)
- **Sanity check** - Python subprocess, non-AI

**3-Tier Deduplication:**
1. Traceability fingerprint (exact match)
2. Trigram metadata similarity
3. AI placeholder detection

**Atomic Installation:**
- Skill installation with automatic backup/rollback
- Installed to `~/.claude/skills/`
- Cross-process file locking prevents concurrent runs

**Resume Support:**
- `.pipeline_progress.json` tracks interrupted pipelines for resume

**UI:**
- Full overlay panel with progress bar, history table
- "Generate Now" / "Cancel" controls
- Status bar indicator showing pending/threshold count

**Auto-Trigger:**
- Automatic threshold-based trigger (default 5 documents)
- Manual "Generate Now" button

---

## 20. SR-PTD Bootstrap (Auto-Inject)

**Smart Installation:**
- On extension activation, installs bundled SR-PTD skill to `~/.claude/skills/sr-ptd-skill/`
- CLAUDE.md injection for post-task documentation instructions

**Change Detection:**
- Only overwrites skill files when bundled version changes (size comparison)
- Duplicate injection prevention via marker detection

**Configuration:**
- Enabled by default via `claudeMirror.srPtdAutoInject`

---

## 21. Authentication & API Key Management

**Claude CLI Auth Integration:**
- Login/logout/status via `claude auth status --json` and `claude auth logout`
- 10s timeout with fallback

**Account Display:**
- Shows signed-in email + subscription type (e.g., "team")
- Located in Vitals gear panel

**API Key Management:**
- VS Code SecretStorage (OS keychain) for Anthropic API keys
- "Set" button in Vitals gear panel

**Environment Sanitization:**
- Strips `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `ANTHROPIC_API_KEY` from all spawned CLI processes
- Case-insensitive on Windows
- Two modes: `buildSanitizedEnv()` for Codex, `buildClaudeCliEnv(apiKey?)` for Claude

---

## 22. File Logging

**Per-Session Logging:**
- Named logs: `<session-name>_<dd-hh-mm>.log`
- Global extension-level logs separate
- Auto-rotate at 2MB
- Auto-rename when session name changes

**Configuration:**
- Enable/disable via `claudeMirror.enableFileLogging`
- Custom directory via `claudeMirror.logDirectory`
- `Ctrl+Alt+L` opens log directory

---

## 23. Responsive Status Bar

**Dynamic Layout Stages:**

**Stage 1 - Full Width:**
- All status controls visible inline

**Stage 2 - Medium Width:**
- Shows: History, Feedback, Plans, Babel Fish icon
- Vitals gear remains visible outside

**Stage 3 - Collapsed:**
- "More" dropdown: Feedback, Plans, History, Prompts, Provider/Model/Permissions, Dashboard, Teams/Consult
- "Tools" dropdown: Git, SkillDocs, Trophy, Usage, Babel Fish, Vitals toggle
- Always visible: Session Timer, Vitals gear, Aa

**Stage 4 - Minimal:**
- Single "Menu" dropdown with all actions
- Only Vitals gear visible

**Smart Behavior:**
- `ResizeObserver` with hysteresis thresholds
- Dropdowns open upward with click-outside dismiss
- Webview-blur auto-close
- Mutual exclusivity (only one dropdown open)
- Escape key support
- Provider-specific gating (Codex hides SkillDocs, Usage)

---

## 24. Vitals Quick-Settings Panel

Consolidated settings hub accessible via Vitals gear icon:

- **Vitals feature explanations** - Weather, Timeline, Intensity Borders, Adventure Widget
- **Claude Account** - Email, subscription type, Refresh, Logout buttons
- **API Key** - "Set" button
- **Translate to** - 10-language dropdown
- **Adventure Widget** - Toggle on/off
- **Semantic Analysis** - Toggle and model selector
- **Skill Generation** - Toggle
- **Usage Widget** - Toggle
- **Show Vitals** - Master toggle

All toggles sync bidirectionally with VS Code settings.

---

## 25. Global Tooltip System

**Unified Tooltip Component:**
- Single `GlobalTooltip` React component via `createPortal` at App root
- VS Code-themed styling

**Smart Positioning:**
- Auto-flips above/below to stay visible
- Shifts horizontally to stay within viewport
- 400ms hover delay prevents flicker

**Accessibility:**
- `role="tooltip"`, dynamic `aria-describedby`
- Touch-device guard (disabled on touch)
- Dismissed on scroll

**Usage:**
- ~25 components use `data-tooltip` attribute instead of native `title`

---

## 26. Workstream Map & Portfolio

**Subway-Map Style Session Visualization:**
- Groups sessions into logical workstreams (coherent threads of work with goal, status, history)
- SVG rendering with pan/zoom controls, dot grid background, minimap
- Deterministic lane-based layout algorithm

**Workstream Data Model:**
- Type: feature, bug_fix, research, refactor, infrastructure, experiment, uncategorized
- Status: active, completed, blocked, uncertain, research, abandoned, planning
- Contains 1-5 "stations" (meaningful events within session)
- AI-classified confidence score
- Current state synthesis (blockers, next actions)

**Station Types:**
- Shapes include: circle (session), diamond (decision), square (code_change), triangle (problem), star (milestone), X cross (failure), lock (blocker), junction (split/merge)
- Evidence-backed with supporting data links
- Importance and attention scoring

**Classification Pipeline:**
1. Enrich sessions with metadata (files, git info, prompts)
2. Ingest orphan git commits (14 days)
3. Heuristic pre-cluster by branch, file overlap, temporal proximity
4. Sonnet AI classification into workstreams
5. Extract 1-5 stations per session (Sonnet)
6. Synthesize project + per-workstream current state
7. Score importance/attention
8. Save with snapshot capture

**Visual Encoding:**
- Line colors by status (green=completed, red=blocked, blue=active, etc.)
- Line texture: solid ≥70% confidence, dashed <70%
- Active/blocked workstreams have flowing particle animation + neon glow
- Station glow animation for recent/attention/resolved states

**Session Scoping:**
- Open tab sessions (even if ended, tab still open)
- Recent sessions (last 4 days)
- Git-inferred sessions (orphan commits from last 14 days)
- Caps: 50 workstreams, 500 stations per project

**External Folder Import:**
- Opt-in explicit folder scanning (user selects folder path)
- Supported formats: .md, .txt, .rst, .json, .yaml, .html, .xml, .docx
- Caps: 80 files, 6-level depth, 8k chars/file, 70k total budget
- Creates one `external_folder` workstream + stations
- Dashed line texture distinguishes imported evidence

**Cross-Project Portfolio:**
- Top-level view across all projects (stored in `globalState`)
- Project health scoring (blocked, stale, needs_attention, healthy)
- Cross-project resume recommendation algorithm
- Max 30 projects, auto-prune after 180 days inactive

**Commands:**
- `claudeMirror.openWorkstreamMap` - Toggle workstream map view
- `claudeMirror.openWorkstreamPortfolio` - Show cross-project portfolio

---

## 27. Tab Groups & Organization

**Folder System:**
- Color-coded folders (using same palette as tabs)
- Custom names for each folder
- Nested sub-folders supported

**Drag-and-Drop:**
- Reorder tabs within and between groups
- Move entire groups
- Move single tabs into/out of folders

**Collapse State:**
- Remember collapsed/expanded state per folder
- Persisted in `workspaceState`

---

## 28. Session Summary & End-of-Session Card

**Automatic Session Recap:**
- Shown when session ends (any exit path: normal, crash, tab close, VS Code close, session clear)
- Displays: duration, bugs fixed, tests passed, files touched, languages used, coding pattern
- Badges earned this session, total XP gained
- AI-powered insights (once per day via Sonnet)

**Idle Session Reminder:**
- After 1 hour of inactivity, shows live recap snapshot nudge
- Options: Later (3h deferral) or Dismiss
- Does not end the session

**Live Recap Snapshots:**
- Manual "request session recap snapshot" path for live summaries without ending session
- Used by idle reminder and other features

---

## 29. Usage Limit & Deferred Send

**Smart Queue Management:**
- When usage limits are hit, messages are queued (not sent)
- Queue shows estimated reset time
- Messages are automatically sent when usage resets

**Visual Feedback:**
- Queue status displayed in status bar
- Pending message count shown
- Option to view queued messages

---

## 30. Provider Handoff

**Cross-Provider Context Transfer:**
- Orchestrated transfer of conversation context between Claude and Codex
- 5-phase state machine: collecting_context → creating_target_tab → starting_target_session → arming_first_user_prompt → completed/failed

**Use Case:**
- Start research in Claude, hand off to Codex for implementation
- Or vice versa

---

## 31. Particle Accelerator (Command Output Compression)

**What It Does:**
Local-only command output compressor. Intercepts Bash commands from AI agents, routes eligible commands through `claui-run` CLI, redacts secrets, filters and compresses noisy output, preserves exit codes, writes trace files.

**Three Execution Contexts:**
- **Extension host** (Node.js): `ParticleAcceleratorService`, lifecycle, settings, hooks
- **claui-run CLI** (separate Node.js process): command execution, redaction, filtering
- **Webview** (browser): status badge, settings panel, trace dashboard

**Pre-Tool-Use Hook:**
- Rewrites: `bash "git status"` → `bash "claui-run --claui-encoded-shell-command <base64url>"`
- Eligible Bash commands intercepted and routed through claui-run
- MCP tool arguments also scanned (see Secret Protection)

**Output Filtering:**
Registry pattern with 9 filters (user-defined, JavaScript/npm, pytest, jest/vitest, TypeScript, ESLint, git semantic, 55+ declarative, generic fallback). Each filter:
- Suppresses noise patterns
- Preserves important output
- Groups by file where applicable
- Caps token budget (balanced: 8k, strict: 4k, verbose: 32k)

**Secret Redaction:**
- Env-value scanning (KEY=VALUE where KEY matches sensitive patterns)
- Regex rules (GitHub PATs, AWS keys, JWTs, OpenAI keys, etc.)
- Fail-closed: outputs suppression message on error

**Command Eligibility:**
- Deny redirections (`>`, `>>`), command substitutions (`$()`, backticks)
- Deny SSH, sudo, vim, npm run dev, docker run, etc.
- Allow ~80 patterns with filter hints
- Default: eligible with GenericFilter

**Codex Integration:**
- Instruction-only mode: appends claui-run usage instruction to Codex args
- Guides Codex to use claui-run without requiring hook installation

**Analytics:**
- Per-session stats: command count, tokens saved, compression ratio
- Daily aggregate reports
- 3-tier retention: recent (raw), old (compressed), archive (purged)

**Status Badge & Panel:**
- StatusBar badge (green=on, red=off, orange=warn)
- Settings panel with enable toggle, mode selector
- Trace dashboard with aggregate stats and per-command details

---

## 32. Super Particle Accelerator (Secret Write Guard)

**What It Does:**
Hook-based secret interception that blocks AI agents from writing secrets into the codebase. Differs from Particle Accelerator (terminal-output filtering) by protecting write operations.

**Three Execution Contexts:**
- **Extension host**: `SuperParticleAcceleratorService`, settings, exceptions, audit
- **Hook scripts** (separate Node.js process): secret scanning, policy evaluation, audit writing
- **Webview**: status badge, audit panel, settings

**Hook Events:**
- **PreToolUse** (Edit/Write/Bash/MCP) - Block writes that would leak secrets
- **PermissionRequest** (Codex Bash) - Block MCP requests with secrets
- **PostToolUse** (Bash output) - Audit side effects
- **Stop** (working tree scan) - Report pre-existing secrets at session end

**5-Gate Deny-First Policy:**
1. No findings (allow)
2. Placeholders/low-confidence (allow)
3. Public/client path (hard deny, no exceptions)
4. Gitignored env file (audit only)
5. Exception match (audit only)
6. Default (deny or audit based on mode)

**Path Classification (5 Risk Levels):**
- `public-client-code` - Hard deny (public/, dist/, build/, static/, client/, frontend/, web/, *.bundle.js, *.min.js)
- `generated-public-artifact`
- `server-code`
- `local-secret-file`
- `unknown-repository-file`

**Git State Scanning:**
- Scans staged, unstaged, untracked files
- Blocks `git add`/`commit`/`push` when secrets detected
- Verifies `.env` is actually gitignored via `git check-ignore`

**Two Modes:**
- `block` - Deny writes
- `audit` - Log only (Gate 2 always denies regardless)

**Exception System:**
- Scoped temporary approvals
- Atomic writes with max-use limits and expiry
- File-based activation (enable mid-session for already-running tabs)

**Audit Trail:**
- JSONL audit files with safe redaction (max 25% revealed, capped at 8 chars, SHA-256 hash)

**Baseline Deduplication:**
- Per-session baseline so Stop hook only reports new findings, not pre-existing secrets

**Configuration:**
- 11 VS Code settings under `claudeMirror.superParticleAccelerator.*`
- Entropy threshold (default 4.2, more sensitive than Secret Protection's 4.5)
- SPA hooks ordered before PA hooks (ensure secret scanning runs first)

**Testing:**
- 77 tests covering policy engine, path classification, scanning, audit, exceptions, baselines, entropy, runtime settings

---

## 33. Secret Protection Broker (Comprehensive DLP)

**What It Does:**
Multi-boundary, destination-aware DLP broker that protects 9+ boundaries where secrets can leak (user prompt, context, files, commands, terminal, MCP, browser, Git, persistence).

**13 Granular Boundaries:**
`prompt.submit`, `context.attach`, `file.read_for_context`, `command.preflight`, `command.output`, `git.diff`, `git.publish`, `mcp.request`, `mcp.response`, `browser.capture`, `persistence.write`, `telemetry.export`, `diagnostic.export`

**9 Destination Kinds:**
`local_agent`, `remote_model_provider`, `terminal_stdout_to_agent`, `local_disk`, `git_remote`, `mcp_server`, `browser_context`, `telemetry_backend`, `diagnostic_export`

**10 Scanners (6 Core + 4 Boundary-Specific):**

**Core Scanners:**
1. **EnvValueScanner** - Env KEY=VALUE patterns with HMAC-based IDs
2. **RegexRuleScanner** - Provider token patterns (14 built-in + rule pack rules)
3. **EntropyScanner** - Shannon entropy on tokens >16 chars (opt-in, threshold 4.5)
4. **PathSensitivityClassifier** - File paths by sensitivity (6 finder patterns)
5. **StructuredPayloadScanner** - JSON/YAML sensitive key detection
6. **PiiAndInternalTopologyScanner** - Email, RFC 1918 IPs, internal hostnames

**Boundary-Specific Scanners:**
- ExtensionOutboundScanner (passwords, conn strings, stack traces, auth headers)
- WebviewOutboundScanner (pasted API keys, private keys, JWTs, webhooks)
- ServerOutboundScanner (DB creds, URL tokens, PII, cert material)
- GitPublicationScanner (sensitive files, added-line secrets)

**13 Rule Packs (45 Rules Total):**
- Cloud: AWS (4), GCP (3), Azure (3)
- Providers: GitHub (4), OpenAI (2), Anthropic (1), Slack (4), Stripe (3)
- VCS: Git (2)
- Files: Protected paths (8)
- PII: Email, phone, SSN (3)
- Topology: Internal IPs, hostnames (4)
- Commands: Exfiltration patterns (4)

**Destination-Aware Policy Engine:**
- Finding x destination → action matrix (block, redact, audit, allow)
- Mode-aware (strict, balanced, observe)
- Exception-checking

**Redaction Engine:**
- Replaces finding spans with structured `<REDACTED type="..." id="sec_..." />` tokens
- Overlapping span resolution by severity (highest wins)
- Streaming mode with 200-char overlap buffer and deferred processing
- Tracks `replacedBytes` for accurate audit metrics

**Command Risk Classifier:**
- 16 risk classes (agent_control_write, shell_obfuscation, network_exfil, credential_reader, etc.)
- Cross-pipe analysis (secret-reader piped to network command = critical)
- Hard-block detection when multiple risk classes combined

**Project-Level Policy:**
`.claui/secret-protection.policy.json`:
- `protectedPaths` - Glob patterns for sensitive files
- `internalDomains` - Internal hostname patterns
- `allowedModelProviders`, `allowedMcpServers`, `allowedGitRemotes`
- `blockedCommands` - Hard-block command patterns
- `approvalRequiredCommandClasses` - Risk classes needing approval
- `hardBlockRules` - Rules that always block
- `allowlistedSecretHmacs` - Pre-approved secret hashes

**11 VS Code Settings:**
`enabled`, `mode` (off/observe/balanced/strict), `blockProtectedPaths`, `scanPrompts`, `scanTerminalOutput`, `scanGitPublication`, `scanMcp`, `requireBrowserCaptureApproval`, `exceptionMaxMinutes`, `auditRetentionDays`, `enableEntropyScanner`

**Audit & Compliance:**
- **AuditStore** - Date-partitioned JSONL audit backend with filters, stats, retention cleanup
- **ComplianceReporter** - SOC 2 CC6/CC7 and GDPR Article 32/5 evidence generation (no raw secrets exposed)
- Per-finding audit: rule ID, type, severity, action, redaction stats, boundary, destination

---

## 34. Workspace Access Guard (WAG)

**What It Does:**
Controls which file system paths AI agents can access. Complements Secret Protection by enforcing path-based access control at the file boundary.

**Architecture:**
Three layers:
1. **Extension host** - `WorkspaceAccessGuardService`, settings, policy loading, audit
2. **Hook scripts** - Path normalization, policy evaluation, audit writing
3. **Webview** - Settings panel (UI for approved roots)

**Path Normalization:**
- Windows/Git Bash/WSL/tilde/relative path unification
- Containment checking (is path within allowed root?)

**Command Path Extraction:**
- Shell command tokenization and access-kind classification
- Detects direct file access vs pipe/redirect operations

**Policy Layers:**
1. User-approved roots (explicit allowlist via UI)
2. Org-level default policy (built-in fallback for enterprises)
3. Deny list for system-critical paths

**Audit Trail:**
- Per-boundary audit JSONL files
- Tracks accessed paths, allowed/blocked decisions

---

## 35. MCP Support (Model Context Protocol)

**Scope:**
Full Phase 1A + Phase 1B for Claude tabs.

**Features:**
- Typed runtime MCP data from `system/init`
- Merged runtime/config/mutation inventory
- Overlay panel with Session, Workspace, Add, Debug tabs
- Status bar MCP chip
- Context tab MCP pills linking to panel
- Guided add/import/remove/reset/restart flows
- Project-scope diff preview before save
- SecretStorage-backed secret handling with `${VAR}` placeholders
- Provider-aware gating (Codex/Happy read-only)

**Three Source-of-Truth Layers:**

1. **Runtime truth** - Claude `system/init.mcp_servers`, stored in `sessionMetadata.mcpServers`
2. **Config truth** - `.mcp.json`, `~/.claude.json`, local entries, CLI fallback
3. **Mutation truth** - Pending add/remove changes before restart

**CLI Services:**
- `McpCliService` - `claude mcp` wrapper using only argument arrays
- `McpConfigService` - Reads all config sources, falls back to CLI
- `McpRegistryService` - Merges truth layers, computes `effectiveStatus`, `restartRequired`

**Curated Templates:**
GitHub, Playwright, Brave Search, Sentry, Slack, Postgres, Context7, Codex (Windows-safe defaults)

**Secret Handling:**
- Secrets stored in VS Code SecretStorage
- Config files store only `${PLACEHOLDER}` references
- Secrets re-hydrated on session start
- Removed when server removed

---

## 36. Smart Search

**Dedicated search tabs** - Read-only tool allowlists, magenta slot color

**Model selection** - Choose which model to use for search queries

---

## 37. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+C` | Open new Claude session |
| `Ctrl+Enter` | Send message |
| `Enter` | New line (Ctrl+Enter mode) |
| `Escape` | Cancel response |
| `Ctrl+Shift+M` | Toggle Chat/Terminal view |
| `Ctrl+Shift+H` | Open conversation history |
| `Ctrl+Alt+Shift+C` | Send current file path |
| `Ctrl+V` | Paste image from clipboard |
| `Ctrl+Alt+Q` | Stop current session |
| `Ctrl+Alt+K` | Compact context |
| `Ctrl+Alt+R` | Resume previous session |
| `Ctrl+Alt+Enter` | Send message (via input box) |
| `Ctrl+Alt+P` | Open plan documents |
| `Ctrl+Alt+L` | Open log directory |
| `Ctrl+Alt+A` | Toggle achievements panel |
| `Ctrl+Alt+D` | Discover sessions (disk scan) |
| `Ctrl+Alt+T` | Toggle team panel |

Mac users: Replace `Ctrl` with `Cmd`

---

## Summary

**ClaUi comprises ~200+ individual capabilities** organized into **39 major feature categories**. It transforms the Claude Code CLI into a full-featured visual IDE with:

- **Multi-session management** - Parallel independent tabs with persistence
- **Rich analytics** - Session, project, and user-level metrics with semantic analysis
- **Gamification** - Achievements, XP, streaks, and social features
- **Security** - Secret write blocking (SPA), boundary-aware DLP, path access control
- **Workflow tools** - Git integration, prompt enhancement, skill generation, workstream mapping
- **AI quality** - Turn analysis, activity summarization, message translation, prompt enhancing
- **Dual providers** - Claude + Codex support with provider handoff
- **Advanced input** - Image paste, file mentions, autocomplete, RTL support
- **Output optimization** - Particle Accelerator filtering, command compression
- **Deep customization** - Fonts, themes, typing personalities, extensive settings

All features are designed around **minimal user friction**, **security-first defaults**, and **rich observability** into AI agent behavior.
