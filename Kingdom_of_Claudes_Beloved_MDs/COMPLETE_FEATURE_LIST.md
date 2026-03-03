# ClaUi - Complete Feature & Capability List

A comprehensive catalog of every feature and capability in the ClaUi VS Code extension.

---

## 1. Multi-Tab Session Management

- **Parallel sessions** - Run multiple independent Claude conversations simultaneously, each in its own VS Code editor tab with a dedicated CLI process
- **Tab color coding** - Each tab gets a unique color from an 8-color palette (blue, coral, green, orange, purple, cyan, gold, brick) for visual distinction
- **Auto-naming** - Tabs are automatically named based on your first message using a lightweight AI call (Haiku for Claude, codex exec for Codex)
- **Manual tab renaming** - Pencil icon in the top-right corner of any tab to rename it
- **Activity indicator** - Spinning indicator in the tab title while Claude is working, with a human-readable summary of current activity
- **Clear session** - Button in the input area to reset all UI state (messages, cost, streaming) and restart the CLI process from scratch
- **Session store** - Session metadata (ID, name, model, timestamps, first prompt) persisted in VS Code globalState, capped at 100 entries, sorted by most recent

---

## 2. Conversation History & Resume

- **Browse past sessions** - QuickPick list showing session name, model, relative time, and first prompt line
- **Resume sessions** - Continue any past session with full conversation restored in the UI. Claude picks up right where you left off
- **Conversation reader** - Reads JSONL files directly from Claude's local session storage (`~/.claude/projects/<hash>/<session>.jsonl`) for instant history display, bypassing the CLI replay delay
- **Fork from message** - Click "Fork" on any user message to create a new tab branching from that point. Claude tabs use CLI resume/fork semantics; Codex tabs use UI-level fork with prefilled input and copied history
- **Editable prompts** - Hover over a sent user message and click "Edit" to modify it inline. On send, all subsequent messages are removed, the CLI session restarts, and the edited prompt is sent as the first message. Only text-only messages are editable (not images). Hidden while the assistant is busy

---

## 3. Prompt History

- **3-tier history** - Session (in-memory from Zustand store), Project (VS Code workspaceState), and Global (VS Code globalState) scopes
- **History panel** - Modal overlay opened via "History" button in the status bar, with 3 tab navigation (Session / Project / Global), text filter, and click-to-insert into input textarea
- **Arrow Up/Down** - Cycle through recent prompts directly in the textarea without opening the panel
- **Auto-save** - Every sent prompt is automatically saved and deduplicated (capped at 200 per scope)

---

## 4. Input & Interaction

- **Image paste** - `Ctrl+V` pastes images from clipboard as base64 attachments, shown as removable thumbnails above the input before sending. Works in both Claude and Codex tabs. In Codex tabs, images are converted to temporary files and passed via `--image` flags
- **Send while busy (Interrupt)** - Send a new prompt while Claude is still responding. Matches Claude Code CLI behavior
- **Cancel with Escape** - Press Escape or click the Cancel button to stop Claude mid-response. The session auto-resumes so you can keep chatting immediately. Both Send and Cancel buttons are visible during processing
- **RTL support** - Full right-to-left support for Hebrew and Arabic, with automatic direction detection (`dir="auto"` on messages, `useRtlDetection` hook for InputArea)
- **File mention (@)** - Type `@` in the textarea to trigger workspace file search with autocomplete popup. 150ms debounce, navigate with ArrowUp/Down, select with Enter/Tab/click. Replaces `@query` with the relative file path
- **File sending** - Three methods:
  1. Right-click in Explorer: "ClaUi: Send Path to Chat" (works with multiple files)
  2. "+" button next to chat input to open a file picker
  3. `Ctrl+Alt+Shift+C` keyboard shortcut while editing a file
- **Ctrl+Enter to send** - Configurable via `claudeMirror.useCtrlEnterToSend`. When enabled, Enter adds a newline and Ctrl+Enter sends
- **Clipboard paste diagnostics** - Paste/shortcut issues from InputArea are forwarded to the extension log as `[UiDebug][InputArea]` entries for troubleshooting

---

## 5. Model & Provider Selection

- **Model selector** - Dropdown in the status bar for choosing: Sonnet 4.6, Sonnet 4.5, Opus 4.6, Haiku 4.5, or CLI default. Persisted to VS Code settings and synced on startup
- **Dual provider support** - Switch between Claude and Codex (OpenAI GPT) providers
- **Provider selector** - "Codex" quick-switch button and "Provider" dropdown (Claude / Codex) in the status bar. Selection is persisted
- **Codex integration** - Full runtime support via `codex exec --json`:
  - First turn via `codex exec --json ... -`
  - Follow-up turns via `codex exec resume --json <threadId> -`
  - Prompt passed through stdin
  - Cancel kills only the current turn process (logical session stays alive with threadId)
  - Image paste support (temp files with `--image` flags)
  - Git push support
  - Auto-naming via one-shot codex exec
  - Provider-specific UI gating (hides irrelevant buttons like SkillDocs and Usage)

---

## 6. Permission Modes

- **Full Access** - All tools available (`--permission-mode bypassPermissions` for Claude, `--dangerously-bypass-approvals-and-sandbox` for Codex)
- **Supervised** - Read-only tool set (`--allowedTools` read-only set for Claude, `--sandbox read-only` for Codex)
- **Status bar toggle** - "Full Access" / "Supervised" dropdown in the status bar. Changes take effect on next process/session start (Claude) or next turn spawn (Codex)

---

## 7. Plan Approval UI

- **4-option approval bar** matching the Claude CLI:
  1. Clear context + bypass permissions (also triggers context compaction)
  2. Bypass permissions
  3. Manually approve edits (switches to supervised permission mode)
  4. Type feedback (sends text to CLI)
- **AskUserQuestion support** - When Claude calls AskUserQuestion, shows option buttons + custom answer input. Responses are sent as user messages
- **Context usage display** - Shows token usage percentage when data is available
- **Distinct plan styling** - Plan tool blocks render with blue styling and show extracted plan text instead of raw JSON
- **ExitPlanMode handling** - Approve actions close the bar without sending user messages (prevents infinite loops). Reject/feedback actions send text to the CLI

---

## 8. Analytics Dashboard

A full-screen overlay with three modes, opened from the "Dashboard" button in the status bar.

### 8.1 Session Mode (Blue pill, 7 tabs)

**Overview:**
- 6 metric cards (turns, error rate, total tool uses, top tool, shell commands, avg duration)
- Duration bar per turn (colored by category)
- Tool frequency horizontal bar (top 15)
- Turn category donut chart
- Mood timeline strip (colored dots per turn)
- Frustration alert (triggers on 3+ consecutive frustrated turns)

**Tokens:**
- 4 mini stat cards (input, output, cache created, cache read)
- Stacked token bar per turn (input/output/cache create/cache read)

**Tools:**
- Tool frequency horizontal bar (top 15)
- Turn category donut chart

**Timeline:**
- Duration bar per turn (colored by category)
- Task type donut + outcome bar (semantic data only)
- Sortable paginated turn table (15 rows/page)

**Commands:**
- Category filter chips (git, npm, test, build, deploy, search, file, other)
- Searchable command timeline list
- Bug repeat tracker sidebar (when semantic data shows repeated bugs)

**Context:**
- Session metadata display (session ID, model, working directory, MCP servers, available tools list)
- Full conversation message inspector (all user and assistant messages)
- Each message expandable to show all content blocks: text, tool_use (name + input), tool_result (output + error status), images
- Role-based filter (All / User / Assistant)
- Free-text search across message content, tool names, and tool inputs
- Expand All / Collapse All controls

**Usage:**
- Fetches live Anthropic API usage data via UsageFetcher (OAuth token from `~/.claude/.credentials.json`)
- Displays billing buckets with usage percentage, daily spend, monthly limit, and reset dates
- Auto-refresh toggle with configurable interval

### 8.2 Project Mode (Purple pill, 4 tabs)

**Project Overview:**
- 6 aggregated metric cards (total sessions, total turns, total tool uses, overall error rate, most used model, avg session duration)
- Turns per session bar chart
- Aggregated tool frequency horizontal bar (top 15, all sessions combined)
- Aggregated category distribution donut (all sessions combined)
- Model usage horizontal bar chart

**Project Sessions:**
- Sortable/filterable session table across all past workspace sessions

**Project Tokens:**
- Aggregated token breakdown across all sessions

**Project Tools:**
- Aggregated tool/category/task type distribution across all sessions

### 8.3 User Mode (Amber pill, 1 tab)

**Token-Usage Ratio:**
- Correlates cost-weighted token consumption with Anthropic usage percentage
- Cost weight formula: Output=5x, CacheWrite=1.25x, Input=1x, CacheRead=0.1x
- Summary cards: one per billing bucket showing latest weighted tokensPerPercent, trend arrow, sample count
- Global stats bar: total turns tracked, raw tokens, weighted tokens, per-type breakdown with cost multiplier labels
- Trend line chart (Recharts LineChart): weighted tokensPerPercent over time, one colored line per bucket
- Samples table: last 50 samples (Date, Bucket, Usage%, Raw Delta, Weighted Delta, Delta Usage%, Weighted Tok/1%)
- "Resample Now" button for immediate usage fetch without waiting for automatic interval
- "Clear Data" button to reset all stored samples
- First baseline sample created after just 2 turns; subsequent samples every 5 turns

### 8.4 Data Persistence

- **Session mode** - Data from Zustand `turnHistory[]` (in-memory, current session)
- **Project mode** - `SessionSummary[]` persisted in VS Code `workspaceState` via `ProjectAnalyticsStore` (200 session cap, survives restarts)
- **User mode** - Global `globalState` shared across all workspaces (500 sample cap)
- **Auto-save** - Session summaries saved from ALL exit paths (normal exit, crash, tab close, VS Code close, session clear, edit-and-resend) via `flushTurnRecords()` with guard to prevent double-save

---

## 9. Semantic Turn Analysis (TurnAnalyzer)

- **Background AI analysis** - After each turn completes, spawns a one-shot Claude CLI process to classify user mood, task type, outcome, and bug repetition
- **Asynchronous results** - Results arrive asynchronously and merge into `turnHistory` via `turnSemantics` postMessage
- **Cost controls** - Queue (max 20), per-session cap (configurable, default 30), timeout (configurable, default 30s), enable/disable toggle
- **Configurable model** - Uses `claudeMirror.analysisModel` setting

---

## 10. Session Vitals

A visual session health dashboard with 5 components:

- **Weather Widget** - Animated mood icon reflecting error/success patterns via sliding window algorithm. Clear sky = smooth sailing, storms = many errors, rainbow = just recovered from errors
- **Session Timeline** - Vertical color-coded minimap alongside messages on the right side. Each segment = one completed Claude turn. Colors:
  - Green = success
  - Red = error/failure
  - Blue = discussion only (no tools)
  - Purple = code-write tools (Write/Edit/MultiEdit/NotebookEdit)
  - Orange = research tools (Read/Grep/Glob/WebSearch/WebFetch)
  - Cyan = command tools (Bash/Terminal)
  - Click any segment to jump to that message
- **Cost Heat Bar** - Gradient strip showing cumulative cost accumulation over the session
- **Turn Intensity Borders** - Colored left border on assistant messages using the same category colors as the timeline. Border width reflects tool activity:
  - Thin/light = 0 tools
  - Medium = 1-3 tools
  - Thick/strong = 4+ tools
- **Vitals toggle** - Button in the StatusBar to show/hide all vitals components

---

## 11. Adventure Widget (Dungeon Crawler)

- **Pixel-art maze** - Each CLI turn extends a 40x40 cell thin-wall maze rendered on a Canvas 2D engine
- **Encounter mapping** - Each turn maps to an encounter type:
  - Scrolls = Read operations
  - Anvils = Edit operations
  - Traps = errors
  - Dragons = 3+ errors in a turn
  - Treasure = recovery from errors
- **Visual engine** - 4x4 mini sprites with PICO-8 palette, BFS pathfinding, camera tracking
- **State machine** - IDLE / WALKING / ENCOUNTER / RESOLUTION animation states
- **Toggleable independently** - Can be enabled/disabled separately from main vitals via `claudeMirror.adventureWidget` or the Vitals gear panel

---

## 12. Achievements / Trophy System

### 12.1 Core System

- **65 achievements** across 7 categories: debugging, testing, refactor, collaboration, session, architecture, productivity
- **4 rarity levels** - Common, Rare, Epic, Legendary
- **XP-based leveling** - 25 tiers with progressive XP thresholds
- **Per-session goals** - 7 goal templates assigned per session
- **Daily streaks** - Consecutive day tracking for streak-based achievements
- **File/language tracking** - Detects programming languages used, classifies files as frontend/backend
- **Error cycle detection** - Tracks repeated errors and bug fix patterns
- **Config file detection** - Recognizes configuration file edits
- **Cancel count tracking** - Tracks response cancellations per session

### 12.2 Notifications & UI

- **Toast notifications** - Rarity-colored toast stack with auto-dismiss (5s) and optional sound effect
- **Achievement panel** - Overlay showing level, XP bar, unlocked count, session goals, language selector, info modal
- **Trophy count in status bar** - Shows total unlocked achievements count (e.g., "26 gbiea") directly in the status bar
- **Session recap card** - End-of-session summary showing duration, bugs fixed, tests passed, files touched, languages used, badges earned, XP gained, coding pattern
- **AI session insight** - Spawns Sonnet CLI once per day at session end for deeper analysis (quality assessment, coding pattern, XP bonus)
- **Idle reminder** - After 1 hour of inactivity, nudges with a live recap snapshot. Options: Later (3h deferral) / Dismiss. Does not end the session
- **Edit-and-resend handling** - Silently abandons current achievement session state and restarts cleanly without false recap

### 12.3 i18n

- **Full English + Hebrew translation** - All UI strings, achievement titles, descriptions, community strings via `achievementI18n.ts`
- **Language selector** - Toggle between EN and HE in the achievement panel

---

## 13. Community & Social (GitHub Sync)

- **GitHub Gist publishing** - Publish achievements to a public GitHub Gist (`claui-achievements.json`)
- **Authentication** - GitHub OAuth Device Flow (preferred) with PAT fallback. Token stored in VS Code SecretStorage (OS keychain)
- **Friend system** - Discover and add friends by GitHub username. 15-minute friend cache
- **Side-by-side comparison** - Compare your stats and achievement grid with friends
- **Community panel** - Full overlay with GitHub Connect card, sync status bar, Friends tab (list + add/remove), Compare tab
- **Share Card** - Modal with visual profile preview (level, XP bar, achievements)
- **Shields.io badges** - Generate dynamic badges for GitHub README
- **Markdown profile card** - Copyable markdown table for GitHub profiles
- **Auto-reconnect** - Reconnects to GitHub on extension activation
- **Friend avatars** - Displays GitHub avatars (CSP allows `avatars.githubusercontent.com`)

---

## 14. Activity Summarizer

- **Periodic summaries** - After every N tool uses (configurable via `claudeMirror.activitySummaryThreshold`, default 3), sends enriched tool names to Haiku for a short label + full summary sentence
- **Busy indicator** - Displays the short label + full sentence in the activity indicator area of the tab
- **Status bar tooltip** - Updated with the latest activity summary
- **Debounce** - Prevents concurrent Haiku calls on rapid tool use sequences
- **Does not overwrite tab title** - Session name stays fixed; activity summary is shown separately

---

## 15. Message Translation

- **10 languages supported** - Hebrew, Arabic, Russian, Spanish, French, German, Portuguese, Chinese, Japanese, Korean
- **Per-message button** - Shows the target language name on each assistant message
- **One-shot Sonnet 4.6 CLI** - Translates using Claude Sonnet via a one-shot CLI call
- **Preserves code** - Code blocks and technical terms are kept intact
- **Cached** - Translations are cached per message; toggling is instant after first translation
- **Auto RTL** - Hebrew and Arabic automatically get right-to-left layout
- **Configurable** - Via "Translate to" dropdown in Vitals gear panel, or `claudeMirror.translationLanguage` VS Code setting

---

## 16. Prompt Enhancer

- **AI-powered rewriting** - Improves user prompts before sending using a meta-prompt with advanced prompt engineering techniques (scaffolding, structure, context cues)
- **Manual mode** - Sparkles button (near Send) or `Ctrl+Shift+E` opens a comparison panel showing original and enhanced prompts stacked vertically for side-by-side review
- **Auto mode** - Intercepts Send, enhances the prompt, then auto-sends. Falls back to original on failure
- **Gear popover** - Opens next to the sparkles button with auto-enhance toggle and model selector
- **Configurable model** - Haiku / Sonnet 4.6 / Sonnet 4.5 / Opus 4.6 via `claudeMirror.promptEnhancer.model`

---

## 17. Codex Consultation

- **GPT expert consultation** - "Consult" button in the StatusBar opens an input panel
- **Context enrichment** - The user's question is sent to the Claude CLI session as a structured prompt, instructing Claude to enrich it with system context and call the `mcp__codex__codex` MCP tool
- **Streamed response** - Codex advice streams into the chat conversation
- **Development continuation** - Claude continues development based on the Codex advice

---

## 18. Text Settings & Typing Themes

### 18.1 Text Settings

- **Font size** - Adjustable 10-32px via slider in the "Aa" panel
- **Font family** - Hebrew-friendly presets + custom font family input
- **Persistent** - Settings stored in Zustand and synced from VS Code configuration

### 18.2 Typing Personality Themes (4 themes)

**Terminal Hacker:**
- Green-on-black color scheme with high contrast
- Typewriter-like streaming with prominent cursor
- Technical, sharp, fast feel

**Retro:**
- CRT-inspired color palette with vintage atmosphere
- Subtle scanline effects simulating old screens
- Monospace typography with nostalgic character

**Zen:**
- Minimalist design with calm colors
- Soft, gentle animations with smooth transitions
- Slow "breathing" pace on live elements

**Neo Zen:**
- Cool blue-turquoise palette with futuristic touch
- Smooth glass-like effect with soft glow on cursor/indicators
- Still minimalist, no aggressive effects

### 18.3 Theme Behavior

- **Instant application** - Theme changes apply immediately to all messages including history, no reload needed
- **Affects display only** - Does not change content, model, tokens, or logic
- **Persistent** - Saved in `claudeMirror.typingTheme` setting, survives VS Code restarts

---

## 19. Markdown Rendering

- **Full GFM support** - Bold, italic, headers, lists, tables, blockquotes, inline code, links, horizontal rules
- **Fenced code blocks** - Extracted first and rendered by `CodeBlock` component with syntax highlighting, copy button, collapse toggle, and HTML preview button (opens rendered HTML in a new VS Code tab)
- **HTML sanitization** - DOMPurify for XSS prevention on all rendered markdown
- **Clickable file paths** - Bare file paths and URLs in rendered markdown are auto-linkified via DOM post-processing (`filePathLinks.tsx`)
- **RTL/Hebrew support** - Full directional overrides for blockquotes, lists, and code blocks. Dedicated `rtl.css` with markdown-specific RTL rules

---

## 20. Git Push Integration

- **One-click push** - "Git" button in the status bar executes `scripts/git-push.ps1` PowerShell script for git add/commit/push
- **Session name as commit message** - Uses the tab name as the commit message (configurable template via `claudeMirror.gitPush.commitMessageTemplate`)
- **Config panel** - Gear button next to Git opens a configuration panel where users can ask Claude to set up or modify git push settings
- **Auto-open config** - If not configured (enabled=false), clicking the Git button opens the config panel instead of pushing
- **Toast notifications** - Success/failure results shown as auto-dismissing toast notifications
- **Codex support** - Git push also works in Codex tabs with the same behavior

---

## 21. Auto Skill Generation (SkillGen)

- **SR-PTD pipeline** - Scans a configurable directory for accumulated SR-PTD development documentation files
- **Document ledger** - Persistent fingerprint-based change detection to track new/modified documents
- **Threshold trigger** - Automatically triggers when pending document count reaches configurable threshold (default 5)
- **8-phase pipeline:**
  - Non-AI phases (B, C.0-C.1, C.5, sanity) execute as Python subprocesses
  - AI phases (C.2 tag enrichment, C.3 incremental clustering, C.4 cross-bucket merge, D skill synthesis) use Claude Code CLI one-shot calls (no API key required)
- **3-tier deduplication** - Traceability fingerprint, trigram metadata similarity matching, AI placeholder
- **Atomic installation** - Skill installation with backup/rollback to `~/.claude/skills/`
- **Cross-process locking** - Prevents concurrent pipeline runs
- **Resume support** - Via `.pipeline_progress.json` for interrupted pipelines
- **Webview panel** - Full overlay with progress bar, history table, and Generate Now / Cancel controls
- **Status bar indicator** - Shows pending/threshold count (e.g., "SkillDocs 33/50") with pulse animation when threshold is reached
- **"!" info button** - Adjacent to the SkillDocs counter for additional information

---

## 22. SR-PTD Bootstrap (Auto-Inject)

- **Auto-install** - On extension activation, installs the bundled SR-PTD skill to `~/.claude/skills/sr-ptd-skill/`
- **CLAUDE.md injection** - Injects post-task documentation instructions into the project-level `CLAUDE.md`
- **Smart updates** - Skill files only overwritten when the bundled version changes (size comparison)
- **Duplicate detection** - Uses marker-based detection (`MANDATORY: Post-Task Documentation (SR-PTD)`) to prevent duplicate injection
- **Configurable** - Enabled by default, can be disabled via `claudeMirror.srPtdAutoInject`

---

## 23. Authentication & API Key Management

- **Claude CLI auth integration** - Login/logout/status via `claude auth status --json` and `claude auth logout` with 10s timeout
- **Account display** - Shows signed-in email + subscription type (e.g., "team") in the Vitals gear panel
- **Refresh button** - Re-check auth status without restarting
- **Logout button** - Log out of Claude CLI directly from the UI
- **API key storage** - VS Code SecretStorage (OS keychain) for Anthropic API keys
- **API Key "Set" button** - In the Vitals gear panel for managing the key
- **Environment sanitization** - Shared utility (`envUtils.ts`) strips `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, and `ANTHROPIC_API_KEY` (case-insensitive on Windows) from all spawned CLI processes. Two modes: `buildSanitizedEnv()` for Codex processes, `buildClaudeCliEnv(apiKey?)` for Claude processes

---

## 24. File Logging

- **Per-session log files** - Named `<session-name>_<dd-hh-mm>.log`
- **Global logger** - Extension-level messages captured separately
- **Auto-rotate** - Files auto-rotate at 2MB
- **Auto-rename** - Log files rename when the session name changes
- **New files on reload** - Fresh log file created on Reload Window or new session
- **Configurable** - Enable/disable via `claudeMirror.enableFileLogging`, custom directory via `claudeMirror.logDirectory`
- **Open logs command** - `Ctrl+Alt+L` opens the log directory

---

## 25. Responsive Status Bar

### 25.1 Always-Visible Items

- **Active Session Timer** - Real-time elapsed clock (HH:MM:SS) showing session duration
- **Git** - One-click git push button
- **Aa** - Text settings (font size, font family, typing theme)
- **Token Counters** - Live "In: X Out: Y" showing input/output token counts

### 25.2 Full-Width Items (visible above ~620px)

- Feedback, Plans, History, Prompts, Model selector, Permissions, Costs, Dashboard, SkillDocs, Trophy, Vitals, Consult, Usage

### 25.3 Collapsed Mode (below ~620px)

- **"More" dropdown** - Feedback, Plans, History, Prompts, Model, Permissions, Costs, Dashboard
- **"Tools" dropdown** - Skills, Trophy, Vitals

### 25.4 Behavior

- Uses `ResizeObserver` hook (`useStatusBarCollapse`) to detect panel width
- Dropdowns open upward with click-outside dismiss, mutual exclusivity, and Escape key support
- Provider-specific gating: Codex mode hides SkillDocs, "!" info button, and Usage button
- Disabled with tooltips (instead of disappearing) when a feature is unavailable for the current provider

---

## 26. Vitals Quick-Settings Panel (Gear Dropdown)

A consolidated settings hub accessible via the Vitals gear icon, containing:

- **Vitals feature explanations** - Descriptions of Weather, Timeline, Intensity Borders, Adventure Widget
- **Claude Account** - Shows signed-in email + subscription type, with Refresh and Logout buttons
- **API Key** - "Set" button for managing the Anthropic API key
- **Translate to** - Language dropdown for message translation target (10 languages)
- **Adventure Widget** - Toggle on/off
- **Semantic Analysis** - Toggle TurnAnalyzer on/off
- **Analysis Model** - Dropdown for background analysis model (e.g., "Sonnet (balanced)")
- **Skill Generation** - Toggle auto skill generation on/off
- **Usage Widget** - Toggle inline usage display on/off
- **Show Vitals** - Master toggle for the entire vitals dashboard

All toggles sync bidirectionally with VS Code settings.

---

## 27. Global Tooltip System

- **Unified tooltips** - Single `GlobalTooltip` React component mounted at the App root via `createPortal`
- **VS Code themed** - Matches VS Code's native look and feel
- **Event delegation** - Document-level `mouseover` detection on any element with a `data-tooltip` attribute
- **Smart positioning** - Auto-flips above/below trigger element, shifts horizontally to stay within viewport
- **400ms hover delay** - Prevents tooltip flicker
- **Accessible** - `role="tooltip"`, dynamic `aria-describedby`
- **Touch-device guard** - Tooltips disabled on touch devices
- **Hides on scroll** - Tooltip dismissed when the page scrolls
- **~25 components** use `data-tooltip` instead of native `title` attributes

---

## 28. Open Plan Documents

- **Plans button** - In the status bar, opens HTML plan documents from both `Kingdom_of_Claudes_Beloved_MDs/` and the project root
- **QuickPick** - Multiple files merged and sorted by modification time (newest first) with location tags (Kingdom/Root)
- **Single-file shortcut** - If only one plan exists, opens it directly in the default browser
- **Plan activation** - If no plan documents exist, offers to inject a "Plan mode" prompt into the project's `CLAUDE.md` with Hebrew or English language choice
- **Keyboard shortcut** - `Ctrl+Alt+P`
- **Command Palette** - Also available via `claudeMirror.openPlanDocs`

---

## 29. Feedback Button

- **Status bar button** - "Feedback" button in the status bar for submitting feedback about the extension
- **Collapsed mode** - Appears under the "More" dropdown when the status bar is narrow

---

## 30. Error Handling & Resilience

- **Error Boundary** - React crashes display error message + stack trace directly in the webview panel instead of a blank screen
- **Auto-restart** - CLI process auto-restarts on crash (configurable via `claudeMirror.autoRestart`)
- **CLI not found detection** - Detects when Claude CLI is not installed (via stderr pattern matching) and shows an informative setup banner with install instructions instead of a generic crash
- **Defensive data handling** - All CLI event fields use `?.`, `?? default`, `Array.isArray()` guards. User message content normalized (string or array), cost fields use nullish coalescing
- **Process tree kill** - On Windows, uses `taskkill /F /T /PID` to kill the entire process tree (required because `shell: true` creates a cmd.exe wrapper that SIGTERM alone cannot reach)

---

## 31. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+C` | Open a new Claude session |
| `Ctrl+Enter` | Send message |
| `Enter` | New line in input (does not send) |
| `Escape` | Cancel current response |
| `Ctrl+Shift+M` | Toggle Chat/Terminal view |
| `Ctrl+Shift+H` | Open conversation history |
| `Ctrl+Alt+Shift+C` | Send current file path to chat |
| `Ctrl+V` | Paste image from clipboard |
| `Ctrl+Alt+Q` | Stop current session |
| `Ctrl+Alt+K` | Compact context (free up token space) |
| `Ctrl+Alt+R` | Resume a previous session |
| `Ctrl+Alt+Enter` | Send message (via input box) |
| `Ctrl+Alt+P` | Open plan documents |
| `Ctrl+Alt+L` | Open log directory |
| `Ctrl+Alt+A` | Toggle achievements panel |
| `Ctrl+Shift+E` | Prompt enhancer (manual mode) |

Mac users: Replace `Ctrl` with `Cmd` for all shortcuts.

---

## 32. Configuration Reference

| Setting | Default | Description |
|---------|---------|-------------|
| `claudeMirror.cliPath` | `"claude"` | Path to Claude CLI executable |
| `claudeMirror.useCtrlEnterToSend` | `true` | Ctrl+Enter sends, Enter adds newline |
| `claudeMirror.autoRestart` | `true` | Auto-restart process on crash |
| `claudeMirror.chatFontSize` | `14` | Font size (px) for chat messages (10-32) |
| `claudeMirror.chatFontFamily` | `""` | Font family for chat messages |
| `claudeMirror.typingTheme` | `"neo-zen"` | Typing personality theme |
| `claudeMirror.autoNameSessions` | `true` | Auto-generate tab names from first message |
| `claudeMirror.activitySummary` | `true` | Periodically summarize tool activity via Haiku |
| `claudeMirror.activitySummaryThreshold` | `3` | Tool uses before triggering summary (1-10) |
| `claudeMirror.model` | `""` | Claude model for new sessions |
| `claudeMirror.permissionMode` | `"full-access"` | Permission mode (full-access / supervised) |
| `claudeMirror.enableFileLogging` | `true` | Write logs to disk files |
| `claudeMirror.logDirectory` | `""` | Directory for log files |
| `claudeMirror.sessionVitals` | `false` | Show Session Vitals dashboard |
| `claudeMirror.adventureWidget` | `false` | Show pixel-art dungeon crawler |
| `claudeMirror.analysisModel` | `"claude-haiku-4-5-20251001"` | Model for background analysis |
| `claudeMirror.turnAnalysis.enabled` | `false` | Enable semantic turn analysis |
| `claudeMirror.turnAnalysis.maxPerSession` | `30` | Max analysis calls per session |
| `claudeMirror.turnAnalysis.timeoutMs` | `30000` | Timeout per analysis call |
| `claudeMirror.promptEnhancer.autoEnhance` | `false` | Auto-enhance prompts before sending |
| `claudeMirror.promptEnhancer.model` | `"claude-sonnet-4-6"` | Model for prompt enhancement |
| `claudeMirror.gitPush.enabled` | `true` | Enable git push via Git button |
| `claudeMirror.gitPush.scriptPath` | `"scripts/git-push.ps1"` | Path to git push script |
| `claudeMirror.gitPush.commitMessageTemplate` | `"{sessionName}"` | Commit message template |
| `claudeMirror.srPtdAutoInject` | `true` | Auto-inject SR-PTD instructions |
| `claudeMirror.skillGen.enabled` | `true` | Enable auto skill generation |
| `claudeMirror.skillGen.threshold` | `5` | New docs to trigger generation (1-50) |
| `claudeMirror.skillGen.docsDirectory` | `"C:\\projects\\Skills\\Dev_doc_for_skills"` | SR-PTD documents directory |
| `claudeMirror.skillGen.docsPattern` | `"SR-PTD_*.md"` | Glob pattern for SR-PTD files |
| `claudeMirror.skillGen.skillsDirectory` | `"~/.claude/skills"` | Target directory for generated skills |
| `claudeMirror.skillGen.autoRun` | `true` | Auto-run when threshold reached |
| `claudeMirror.skillGen.timeoutMs` | `300000` | Pipeline timeout (5 min default) |
| `claudeMirror.skillGen.aiDeduplication` | `false` | Enable AI-powered deduplication |

---

## Summary

**32 major feature categories comprising approximately 160+ individual capabilities.**

ClaUi transforms the Claude Code CLI into a full-featured visual IDE experience with multi-tab sessions, analytics, gamification, AI-powered prompt enhancement, dual provider support (Claude + Codex), social features, and deep customization.
