# ClaUi

**The full IDE experience for Claude Code** -- multi-tab sessions, analytics dashboards, 65 achievements, dual AI providers, prompt enhancement, message translation, and deep customization, all inside VS Code.

ClaUi transforms the Claude Code CLI into a rich, interactive workspace. Run parallel conversations in colored tabs, track your coding patterns with real-time analytics, earn badges for milestones, enhance prompts with AI before sending, translate responses into 10 languages, and compare achievements with friends on GitHub. Whether you use Claude or OpenAI Codex, ClaUi gives you the tools to work smarter.

---

## At a Glance

- **Multi-tab sessions** with auto-naming, color coding, and activity summaries
- **Dual provider support** -- Claude and OpenAI Codex in the same UI
- **Analytics dashboard** -- session, project, and user-level insights with charts and token tracking
- **65 achievements** -- XP leveling, daily streaks, session goals, and GitHub community sync
- **Prompt Enhancer** -- AI-powered prompt rewriting before sending
- **Message Translation** -- translate assistant responses into 10 languages
- **Session Vitals** -- weather widget, timeline minimap, cost heat bar, and a pixel-art dungeon crawler
- **40+ settings** -- typing themes, font controls, RTL support, and granular feature toggles

---

## Features

### Chat & Sessions

Run multiple Claude conversations in parallel, each isolated in its own VS Code tab.

- **Multi-tab sessions** -- open as many conversations as you need, side by side
- **Tab colors** -- 8-color palette (blue, coral, green, orange, purple, cyan, gold, brick) for instant tab identification
- **Auto-naming** -- tabs are named automatically from your first message via a lightweight AI call
- **Tab renaming** -- click the pencil icon to rename any tab
- **Activity indicator** -- spinning indicator in the tab title shows when Claude is working, with a live summary of current activity
- **Conversation history** -- browse all past sessions, search by content, and resume any conversation
- **Session resume** -- Claude picks up exactly where it left off with the full conversation restored
- **Fork sessions** -- branch off from any point in a conversation
- **Edit messages** -- edit any previous message and re-run from that point
- **Clear session** -- wipe the conversation and start fresh without closing the tab
- **Session discovery** -- discover and browse all sessions across the workspace

### Smart Input

- **Image paste** -- paste images from clipboard with `Ctrl+V`; thumbnails preview above the input
- **@file mentions** -- type `@` to trigger workspace file search with autocomplete; navigate with arrows, select with Enter/Tab
- **Prompt history** -- 3-tier history panel (Session / Project / Global) with search; cycle through recent prompts with Arrow Up/Down
- **Prompt Enhancer** -- AI-powered prompt rewriting with manual (review before sending) and auto modes; configurable model (Haiku to Opus)
- **Cancel / interrupt / steer** -- press Escape or click Cancel/Stop to halt an in-flight turn; in Codex tabs, use **Steer** (with approval) to redirect mid-turn
- **File sending** -- three methods: right-click in Explorer, "+" button, or `Ctrl+Alt+Shift+C` shortcut
- **Plan approval** -- 4-option inline approval bar matching the Claude CLI (bypass permissions, supervised mode, feedback text, clear context)

### AI Intelligence

- **Dual provider** -- switch between Claude and Codex per session; each has its own model and settings
- **Model selection** -- choose Claude Sonnet, Opus, or Haiku (or Codex models) from the status bar
- **Codex reasoning effort** -- set reasoning depth (low / medium / high / xhigh) per Codex session
- **Semantic turn analysis** -- background AI classification of user mood, task type, outcome, and bug patterns per turn
- **Activity summarizer** -- AI-powered live summaries of what Claude is doing, shown in the tab title
- **Message translation** -- translate any assistant message to Hebrew, Arabic, Russian, Spanish, French, German, Portuguese, Chinese, Japanese, or Korean with one click; code blocks preserved
- **Codex consultation** -- "Consult" button sends your question to a GPT expert via MCP, with Claude continuing development based on the advice
- **Permission modes** -- Full Access or Supervised (read-only) with status bar toggle

### Analytics & Insights

A full-screen dashboard with three modes, opened from the "Dashboard" button in the status bar.

**Session mode (7 tabs):**
- Overview with metric cards, duration bars, tool frequency charts, mood timeline, and frustration alerts
- Token breakdown per turn (input, output, cache created, cache read)
- Tool frequency and category distribution charts
- Sortable paginated turn timeline table
- Command timeline with category filters (git, npm, test, build, deploy, search, file)
- Context inspector: session metadata, full conversation with expandable message blocks, search, and role filters
- Live Anthropic API usage: billing buckets, daily spend, monthly limits, auto-refresh

**Project mode (4 tabs):**
- Aggregated metrics across all past workspace sessions (200 session history)
- Sessions table with sort, filter, and expandable token/tool details
- Project-wide token breakdown and tool/category distribution

**User mode (1 tab):**
- Token-usage ratio tracker correlating cost-weighted tokens with Anthropic usage percentage
- Per-bucket trend analysis with summary cards, line charts, and sample history table

### Gamification & Social

- **65 achievements** across 7 categories: debugging, testing, refactor, collaboration, session, architecture, productivity
- **4 rarity levels** -- Common, Rare, Epic, Legendary
- **XP-based leveling** -- 25 tiers with progressive thresholds
- **Per-session goals** -- 2-3 randomly assigned goals per session with progress tracking
- **Daily streaks** -- consecutive day tracking with streak-based achievements (3, 7, 14, 30 days)
- **Session recap** -- end-of-session card showing duration, bugs fixed, tests passed, files touched, languages used, badges earned, and XP gained
- **AI session insight** -- once-per-day Sonnet analysis of your coding patterns with quality assessment and XP bonus
- **GitHub community sync** -- publish achievements to a public GitHub Gist via OAuth Device Flow
- **Friend system** -- discover friends by GitHub username, compare stats and achievement grids side-by-side
- **Shields.io badges** -- generate dynamic badges and markdown profile cards for your GitHub README
- **English + Hebrew i18n** -- full bilingual support for all achievement UI

### Visual & Customization

- **4 typing themes** -- Terminal Hacker (green-on-black typewriter), Retro (pixel CRT), Zen (soft minimal), Neo Zen (calm with blue-cyan accents)
- **Session Vitals** -- weather widget (animated mood icon), timeline minimap (color-coded turn segments), cost heat bar, turn intensity borders
- **Adventure Widget** -- pixel-art dungeon crawler that visualizes tool activity as a roguelike adventure with encounters, scrolls, anvils, traps, and dragons
- **Font settings** -- adjust chat font size (10-32px) and font family; includes Hebrew-friendly presets
- **RTL support** -- full right-to-left rendering for Hebrew and Arabic conversations
- **Markdown rendering** -- full GFM support with syntax-highlighted code blocks, copy button, collapse toggle, and clickable file paths

---

## Getting Started

### Prerequisites

| Requirement | How to install |
|-------------|----------------|
| **Claude Code CLI** | `npm install -g @anthropic-ai/claude-code`, then run `claude` once to sign in |
| **VS Code** | Version 1.85 or later |

### Quickstart

1. Install ClaUi from the VS Code Marketplace
2. Press `Ctrl+Shift+C` to open a new Claude session
3. Type a message and press `Ctrl+Enter` to send

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+C` | Open a new Claude session |
| `Ctrl+Enter` | Send message |
| `Enter` | New line in input (does not send) |
| `Escape` | Cancel current response |
| `Ctrl+Shift+M` | Toggle Chat / Terminal view |
| `Ctrl+Shift+H` | Open conversation history |
| `Ctrl+Shift+E` | Prompt Enhancer (manual mode) |
| `Ctrl+Alt+Shift+C` | Send current file path to chat |
| `Ctrl+V` | Paste image from clipboard |
| `Ctrl+Alt+Q` | Stop current session |
| `Ctrl+Alt+K` | Compact context (free up token space) |
| `Ctrl+Alt+R` | Resume a previous session |
| `Ctrl+Alt+Enter` | Send message (alternative) |
| `Ctrl+Alt+P` | Open plan documents |
| `Ctrl+Alt+L` | Open log directory |
| `Ctrl+Alt+A` | Toggle achievements panel |
| `Ctrl+Alt+D` | Discover all sessions |

> **Mac users**: Replace `Ctrl` with `Cmd` for all shortcuts above.
>
> To customize shortcuts, open Keyboard Shortcuts (`Ctrl+K Ctrl+S`) and search for `claudeMirror`.

---

## Commands

Press `Ctrl+Shift+P` and type "ClaUi" to see all commands:

| Command | Action |
|---------|--------|
| **Start New Session** | Open a new Claude or Codex chat tab |
| **Stop Session** | Stop the active session's CLI process |
| **Toggle Chat/Terminal View** | Switch between chat UI and terminal output |
| **Send Message** | Send the current input |
| **Compact Context** | Compact the conversation to free token space |
| **Resume Session** | Resume a previous session by ID |
| **Conversation History** | Browse and resume past sessions |
| **Cancel Current Response** | Stop Claude's current response |
| **Send Path to Chat** | Insert a file or folder path into the chat input |
| **Open Plan Document** | Open plan docs from the current project |
| **Open Log Directory** | Open the session logs folder |
| **Toggle Achievements** | Open or close the achievements panel |
| **Send Feedback** | Open the feedback / issue reporter |
| **Discover All Sessions** | Scan and import all known sessions |

---

## Settings

All settings are under `claudeMirror.*` in VS Code Settings (`Ctrl+,`).

### Core

| Setting | Default | Description |
|---------|---------|-------------|
| `cliPath` | `"claude"` | Path to Claude CLI executable |
| `provider` | `"claude"` | Default provider: `claude` or `codex` |
| `model` | `""` | Claude model for new sessions (empty = CLI default) |
| `codex.model` | `""` | Codex model for new sessions |
| `codex.reasoningEffort` | `""` | Codex reasoning depth: `low`, `medium`, `high`, `xhigh` |
| `permissionMode` | `"full-access"` | `full-access` or `supervised` (read-only) |
| `useCtrlEnterToSend` | `true` | Ctrl+Enter sends, Enter adds newline |
| `autoRestart` | `true` | Auto-restart CLI process on crash |

### Display

| Setting | Default | Description |
|---------|---------|-------------|
| `chatFontSize` | `14` | Font size (px) for chat messages (10-32) |
| `chatFontFamily` | `""` | Font family (empty = VS Code default) |
| `typingTheme` | `"neo-zen"` | Visual theme: `terminal-hacker`, `retro`, `zen`, `neo-zen` |
| `autoNameSessions` | `true` | Auto-generate tab names from first message |
| `activitySummary` | `true` | Show live activity summary in tab title |
| `translationLanguage` | `"Hebrew"` | Target language for the Translate button |

### Analytics

| Setting | Default | Description |
|---------|---------|-------------|
| `analysisModel` | `"claude-haiku-4-5-20251001"` | Model for background analysis |
| `turnAnalysis.enabled` | `true` | Enable semantic turn analysis |
| `turnAnalysis.maxPerSession` | `30` | Max analysis calls per session |
| `sessionVitals` | `false` | Show Session Vitals dashboard |
| `adventureWidget` | `false` | Show pixel-art dungeon crawler |

### Achievements

| Setting | Default | Description |
|---------|---------|-------------|
| `achievements.enabled` | `true` | Enable the achievement system |
| `achievements.sound` | `false` | Play sound on achievement toast |
| `achievements.aiInsight` | `true` | AI-powered session insights (once per day) |
| `achievements.githubSync` | `false` | Auto-sync achievements to GitHub Gist |

### Prompt Enhancer

| Setting | Default | Description |
|---------|---------|-------------|
| `promptEnhancer.autoEnhance` | `false` | Auto-enhance prompts before sending |
| `promptEnhancer.model` | `"claude-sonnet-4-6"` | Model for prompt enhancement |

### Logging & Developer

| Setting | Default | Description |
|---------|---------|-------------|
| `enableFileLogging` | `true` | Write session logs to disk |
| `logDirectory` | `""` | Custom directory for log files |
| `gitPush.enabled` | `true` | Enable git push via status bar button |
| `gitPush.commitMessageTemplate` | `"{sessionName}"` | Commit message template |

> For the full list of 40+ settings including SkillGen and SR-PTD options, search `claudeMirror` in VS Code Settings.

---

## Developer Tools

- **Git push** -- one-click commit and push via a configurable PowerShell script and commit message template
- **File logging** -- per-session log files written to disk with auto-rotation (2MB) and auto-rename
- **Authentication management** -- Claude CLI login/logout/status display and Anthropic API key management from the Vitals gear panel
- **SR-PTD integration** -- auto-injects documentation instructions into your project's CLAUDE.md and installs the sr-ptd-skill
- **SkillGen** -- monitors your SR-PTD documents and automatically generates reusable Claude skills from accumulated work patterns via an 8-phase pipeline

---

## Sending Files

Three ways to reference files in your messages:

1. **Right-click in Explorer** -- select "ClaUi: Send Path to Chat" (works with multiple files)
2. **The "+" button** -- click the + button next to the chat input to open a file picker
3. **Keyboard shortcut** -- press `Ctrl+Alt+Shift+C` while focused on a file in the editor

The path is inserted into the input box so you can add context before sending.

---

## Feedback & Contributing

Have an idea, found a bug, or want to request a feature?

- **GitHub Issues**: [github.com/Yehonatan-Bar/ClaUI/issues](https://github.com/Yehonatan-Bar/ClaUI/issues)
- **Email**: [yonzbar@gmail.com](mailto:yonzbar@gmail.com)

For build instructions and architecture details, see [DEVELOPMENT.md](DEVELOPMENT.md).

## License

MIT
