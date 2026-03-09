# Agent Teams Feature

ClaUi provides full visualization and flow control for Claude Code's experimental Agent Teams feature. When Claude spawns a coordinated team of agents, ClaUi detects the team creation and provides real-time monitoring through a floating widget, an overlay panel, and statusbar integration.

## Architecture

The feature is split across extension-side (Node.js) and webview-side (React) code:

### Extension Side (`src/extension/teams/`)

| File | Purpose |
|------|---------|
| `TeamTypes.ts` | Type definitions: `TeamMember`, `TeamConfig`, `TeamTask`, `InboxMessage`, `TeamStateSnapshot`, `AgentStatus` |
| `TeamWatcher.ts` | File system watcher using `fs.watch` + 2s polling fallback. Monitors `~/.claude/teams/{name}/` (config, inboxes) and `~/.claude/tasks/{name}/` (task files). Emits `TeamStateSnapshot` on changes via EventEmitter. Debounces at 100ms. Implements 3-layer idle detection (see below). |
| `TeamDetector.ts` | Scans `assistantMessage` content blocks for `TeamCreate` / `TeamDelete` tool_use calls to detect team lifecycle events. |
| `TeamActions.ts` | Handles user-initiated operations: `sendMessage()`, `createTask()`, `updateTask()`, `shutdownAgent()`. Writes directly to the team's JSON files on disk. |

### Integration Points

- **`SessionTab.ts`**: Creates `TeamWatcher` + `TeamDetector` + `TeamActions` when a team is detected. Forwards `TeamStateSnapshot` to webview as `teamStateUpdate` messages. Cleans up watcher on dispose. Also performs:
  - **Session recovery**: On `init` event, calls `recoverTeamForSession()` to scan `~/.claude/teams/` for a team matching the current `sessionId`, restoring the watcher if found.
  - **Stream-based idle detection**: In the `assistantMessage` handler, scans text content blocks for `idle_notification` JSON and calls `teamWatcher.markAgentIdle()` as a backup for file-based detection.
- **`MessageHandler.ts`**: Handles webview-to-extension team messages (`teamSendMessage`, `teamCreateTask`, `teamUpdateTask`, `teamShutdownAgent`) by delegating to `TeamActions`.
- **`webview-messages.ts`**: Defines all team message types for both directions (Extension->Webview: `teamStateUpdate`, `teamDetected`, `teamDismissed`; Webview->Extension: `teamPanelOpen`, `teamSendMessage`, `teamCreateTask`, `teamUpdateTask`, `teamShutdownAgent`).

### Webview Side (`src/webview/components/Teams/`)

| File | Purpose |
|------|---------|
| `TeamPanel.tsx` | Full-screen overlay (follows DashboardPanel pattern). Tabs: Topology, Tasks, Messages, Activity. ESC to close. |
| `TopologyTab.tsx` | CSS Grid of agent cards with status indicators, colors, and current task display. Working agents pulse. |
| `TasksTab.tsx` | Kanban board with 3 columns (Pending/In Progress/Completed). Task cards show owner, dependency chips. Inline "Add Task" form. |
| `MessagesTab.tsx` | Chronological message feed with colored sender dots, structured message formatting, and inline send form. |
| `ActivityTab.tsx` | Per-agent activity sections showing current task, last activity, status badge, and shutdown button. |
| `TeamStatusWidget.tsx` | Draggable floating widget (follows WeatherWidget pattern). Shows agent count, working/idle counts, task progress bar. Click opens TeamPanel. Minimizable. Position persisted to localStorage. |
| `teamColors.ts` | Color constants for agent statuses, task states, and the agent color palette. |
| `index.ts` | Barrel exports. |

### Inline Chat Visualization (`src/webview/components/ChatView/`)

| File | Purpose |
|------|---------|
| `AgentSpawnBlock.tsx` | Specialized card for `Agent`/`Task`/`dispatch_agent` tool_use blocks. Shows type badge (Explore=orange, Plan=blue, general-purpose=purple), pulsing status dot, description, background chip. Collapsible body with prompt text and result summary. Detects nested sub-agents in result text. |
| `AgentHierarchyBlock.tsx` | Tree visualization of nested sub-agents. Vertical connector line (2px border-left) with horizontal branches. Child cards use same styling as parent but smaller. |
| `TeamInlineWidget.tsx` | Compact inline card for `TeamCreate`/`TeamDelete` tool_use blocks. Shows team name, member count, task progress, member status dots, and "Open Team Panel" button. |

**Integration**: `ToolUseBlock.tsx` detects agent/team tool names and delegates rendering to these components. `MessageBubble.tsx` pairs agent `tool_use` blocks with their matching `tool_result` (by `tool_use_id`) so the agent card can display the result inline. Paired `tool_result` blocks are suppressed from standalone rendering. `MessageHandler.ts` categorizes agent tools under the `research` turn category for timeline/intensity border coloring.

### Store (`src/webview/state/store.ts`)

Team state fields: `teamActive`, `teamName`, `teamConfig`, `teamTasks`, `teamAgentStatuses`, `teamRecentMessages`, `teamPanelOpen`, `teamPanelActiveTab`.

Actions: `setTeamState()`, `setTeamActive()`, `setTeamPanelOpen()`, `clearTeamState()`.

All team state is reset on session reset.

### Stream Hook (`src/webview/hooks/useClaudeStream.ts`)

Handles three message types: `teamStateUpdate` (full snapshot), `teamDetected` (activate), `teamDismissed` (clear).

## Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `claudeMirror.teams.enabled` | boolean | true | Enable Agent Teams visualization |
| `claudeMirror.teams.autoOpenPanel` | boolean | false | Auto-open Teams panel on detection |
| `claudeMirror.teams.pollIntervalMs` | number | 2000 | Polling interval for file changes |

## Command & Keybinding

| Command | Keybinding | Description |
|---------|-----------|-------------|
| `claudeMirror.toggleTeamPanel` | `Ctrl+Alt+T` | Toggle Agent Teams panel |

## Detection Flow

1. User asks Claude to create a team
2. Claude calls `TeamCreate` tool
3. `StreamDemux` emits `assistantMessage` event
4. `SessionTab` runs `TeamDetector.detectTeamActivity()` on content blocks
5. On detection, `SessionTab.startTeamWatcher()` creates `TeamWatcher` and `TeamActions`
6. `TeamWatcher` reads initial state and starts watching files
7. Webview receives `teamDetected` -> shows `TeamStatusWidget`
8. Webview receives `teamStateUpdate` snapshots on every file change
9. When team is deleted, `teamDismissed` is sent and state is cleared

### Session Recovery

On `init` event (session start/resume), `recoverTeamForSession()` scans all directories under `~/.claude/teams/`. For each team, it reads `config.json` and checks if the `sessionId` matches the current session. If found, the watcher is restored automatically without needing a new `TeamCreate` tool call.

## Agent Status — 3-Layer Idle Detection

Claude Code's internal tasks (`metadata._internal: true`) often stay `in_progress` even after an agent finishes work, causing agents to appear stuck as "working". The `TeamWatcher.deriveAgentStatuses()` method uses a 3-layer approach to accurately determine agent status:

### Layer 1: File-Based Inbox Detection
Reads each agent's inbox messages (flat JSON arrays under `~/.claude/teams/{name}/inboxes/`). If the agent's most recent message is an `idle_notification`, status is set to `idle`. Handles both top-level `type` field and JSON embedded inside the `text` field (Claude Code's actual format).

### Layer 2: Stream-Based Backup
`SessionTab` scans incoming `assistantMessage` content blocks for `idle_notification` JSON text. When found, it calls `teamWatcher.markAgentIdle(agentName)`, which stores the agent in a `streamIdleAgents` map. If Layer 1 didn't detect idle but the stream map contains the agent, status is overridden to `idle`. This handles cases where file reads miss the notification (e.g., file locks, timing).

### Layer 3: Stale Internal Task Heuristic
If an agent still shows `working` after Layers 1-2, and the only in-progress tasks are internal tasks (`metadata._internal: true`), and the agent has sent at least one message, the status is overridden to `idle`. This catches the common case where Claude Code creates tracking tasks that never get marked complete.

### Diagnostic Logging
All three layers emit `[TeamWatcher]` log entries to the `ClaUi` output channel, including per-agent status derivation with task counts, message counts, and the detection reason. Check `Output -> ClaUi` to diagnose status issues.

## Auto-Prompt on All Agents Idle

When all team agents transition to idle while Claude Code is waiting for user input, ClaUi automatically sends a prompt to Claude Code to trigger it to continue and report results. This solves the common problem where Claude's turn ends before agents finish, leaving the session stuck waiting for user input.

**How it works** (`SessionTab.checkAllAgentsIdleAutoPrompt()`):

1. Tracks whether any agent has been seen as `working` at least once (prevents triggering on a brand-new team)
2. When all agents are `idle`, Claude is not busy, and at least one message exists, sends:
   > "All team agents have completed their work and are now idle. Please check the inbox messages, review the results, and provide a summary report."
3. The prompt appears in the chat UI as a user message so the user sees what happened
4. A guard flag (`teamAutoPromptSent`) prevents duplicate sends; it resets when any agent starts working again
