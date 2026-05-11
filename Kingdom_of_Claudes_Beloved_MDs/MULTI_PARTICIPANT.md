# Multi-Participant Session (Phase 0 + Phase 1 + Phase 2 Tracks A-D)

## What This Is

A shared coding session where multiple humans and their code agents (Claude Code, Codex) participate in a single conversation. Each human sees the full transcript in real time. Each agent receives a prompt only when a message is deterministically addressed to it by the coordination server.

Current state: Phase 0 runtime is working, Phase 1 defines the protocol/type surface, Phase 2 implements all four tracks: Track A (A2A loop protection + guard service), Track B (rename handling, JSONL persistence, typing/activity relay), Track C (file change tracking / cancel / approval & conflict UI in the extension host), and Track D (Zustand store slice, useClaudeStream dispatch handlers, and React UI components). Track D is webview-only (can be developed/tested with mock data) and will be integrated with the extension host in Phase 4.

## Architecture

```
                     Coordination Server (Hub)
                     +---------------------------+
                     | Canonical Transcript       |
                     | Routing Engine             |
                     | Participant Registry       |
                     | A2A Loop Controller        |
                     | Guard Service              |
                     | Session Persistence        |
                     | Delta Context Builder      |
                     +------------+--------------+
                                  |
                 +----------------+----------------+
                 | WebSocket      | WebSocket      |
                 |                |                |
        +--------+------+  +-----+--------+
        | ClaUi (Alice) |  | ClaUi (Bob)  |
        | +-----------+ |  | +----------+ |
        | | Alice's   | |  | | Bob's    | |
        | | Claude    | |  | | Codex    | |
        | | Agent     | |  | | Agent    | |
        | +-----------+ |  | +----------+ |
        +---------------+  +--------------+
```

**Key Principle: Server Routes, Client Executes.** The server never talks to agents directly. It tells the owning ClaUi instance what prompt to send. ClaUi uses its existing process managers to deliver the prompt and streams the response back.

## Key Files

### Server (`server/src/`)

| File | Purpose |
|------|---------|
| `types.ts` | Data model and protocol contracts: Session, Participant, Message, AgentDelivery, AgentSeenState, DeliveryStatus, A2A approval state, typing/activity state, rename events, file change/conflict reports |
| `Router.ts` | Name validation (`normalizeName`, `extractRouteKey`, `validateParticipantName`), message routing (`routeMessage` - greedy longest-name match then routeKey fallback) |
| `CoordinationServer.ts` | WebSocket server: session management, join/leave lifecycle, human message routing, agent delivery creation, delta context building, agent prompt formatting, delivery status tracking, A2A gating via LoopController, rename handling, typing/activity relay, JSONL persistence |
| `LoopController.ts` | A2A loop protection state machine: `ask`/`budget`/`always`/`force` modes, budget counting, approval event lifecycle, guard-check triggering, human-intervention reset |
| `GuardService.ts` | One-shot LLM call to detect unproductive A2A loops. Calls Anthropic API with a structured prompt. 10s timeout, fail-safe to STOP. Configurable model via `CLAUI_GUARD_API_KEY` / `CLAUI_GUARD_MODEL` env vars |
| `SessionPersistence.ts` | Append-only JSONL persistence for session state. Writes events (init, join, msg, dlv, seen, pstat, leave, rename, loop, appr). Replays on startup to restore full state. One file per session |
| `index.ts` | Entry point with `ServerConfig`: port, persistence dir, guard API key/model (all via env vars) |

### Extension (`src/extension/multiparticipant/`)

| File | Purpose |
|------|---------|
| `MultiParticipantProtocol.ts` | Client-server WebSocket message type definitions (mirrors server types, including Phase 1 contracts) |
| `MultiParticipantClient.ts` | WebSocket client that connects to the coordination server, handles reconnection |
| `FileChangeTracker.ts` | Tracks file changes from agent tool_use events and filesystem snapshots. Dual-strategy: (1) structured tool tracking for Claude via StreamDemux, (2) snapshot-based mtime diffing for Codex. Emits `fileChanges` events |
| `HeadlessAgentRunner.ts` | Drives a local Claude or Codex agent without a visible webview. Creates process managers, demuxers, and a FileChangeTracker. Accepts `deliver()` calls, calls `startTurn`/`finishTurn` lifecycle, takes snapshots before Codex turns. Emits `agentEvent` and `fileChanges` events |
| `AgentBridge.ts` | Connects server `deliverPrompt` and `cancelAgent` commands to `HeadlessAgentRunner`, reports agent events and `fileChangeReport` messages back to server with workspace metadata |
| `MultiParticipantSessionTab.ts` | Shared UI tab: human input goes to server (not local agent), displays transcript from all participants, shows streaming agent output. Handles server messages for activity indicators, A2A approvals, guard stops, file conflict warnings, renames, and approval resolution. Inline HTML webview with notification banners and approval action buttons |

### Shared Webview Types

| File | Purpose |
|------|---------|
| `src/extension/types/webview-messages.ts` | Adds `mp*` postMessage contracts for the React multi-participant UI: session state, participants, messages, delivery status, streaming text, A2A approval, guard stop, participant activity, rename, conflicts, and join/errors |

### Webview Store & Components (Phase 2 Track D)

| File | Purpose |
|------|---------|
| `src/webview/state/store.ts` | Multi-participant Zustand state slice: `mpSession`, `mpParticipants`, `mpMessages`, `mpDeliveryStatuses`, `mpStreamingTexts`, `mpApprovals`, `mpTypingStates`, `mpFileConflicts`, plus all setter/update actions and `clearMpState` |
| `src/webview/hooks/useClaudeStream.ts` | Dispatch handlers mapping all `mp*` ExtensionToWebview messages to the store actions |
| `src/webview/components/MultiParticipant/ParticipantList.tsx` | Sidebar component: vertical list with status dot, kind badge (H/A), provider icon, route key label, typing indicator |
| `src/webview/components/MultiParticipant/JoinDialog.tsx` | Modal form: human name, agent name, provider selector, server URL. Client-side validation + server error display |
| `src/webview/components/MultiParticipant/ConflictWarning.tsx` | Banner showing file conflict warnings from overlapping agent edits. Dismissable per conflict |
| `src/webview/components/MultiParticipant/MpMessageBubble.tsx` | MP-specific message renderer: participant name badge with deterministic color (hash of participantId), author kind indicator, isMe/isMyAgent styling, delivery status dot, streaming text overlay, RTL support |
| `src/webview/components/MultiParticipant/mpColors.ts` | Deterministic color assignment: `hashParticipantColor(participantId)` maps to a 12-color palette |
| `src/webview/components/MultiParticipant/index.ts` | Barrel export for all MP components |

## Message Routing

Messages are routed by prefix matching:

1. **Full name match** (greedy, longest first): "Claude check this" -> routes to "Claude"
2. **RouteKey match** (first grapheme): "C: check this" -> routes to participant with routeKey "c"
3. **Delimiter required**: Must be followed by `:`, space, or end-of-string
4. **No match**: Message broadcast to all humans, no agent delivery

## Agent Delivery Lifecycle

```
Server creates delivery (pending)
  -> ClaUi accepts (acknowledged) -> broadcast thinking
    -> Agent process starts (running)
      -> First token received (streaming) -> broadcast streaming
        -> Agent completes (completed) -> broadcast idle
          -> Route response: if addressed to another agent -> A2A gate
```

Terminal states: `completed`, `failed`, `interrupted`, `not_delivered`

## Agent-to-Agent Loop Protection (Phase 2 Track A)

When an agent's completed response addresses another agent, the server detects this as agent-to-agent (A2A) communication and gates it through the `LoopController`.

### A2A Modes

| Mode | Behavior | Guard | Budget |
|------|----------|-------|--------|
| `ask` (default) | Pause before every A2A delivery, ask humans | N/A | N/A |
| `budget` | Allow N A2A messages, then pause | N/A | Decremented per A2A |
| `always` | Allow indefinitely, run guard every 20 consecutive A2A | Yes | N/A |
| `force` | Allow indefinitely, no guard, no pause | No | N/A |

### Guard Service

Invoked at every 20th consecutive A2A message in `always` mode. Calls a configurable lightweight LLM (default: Haiku) with the last 5 messages and session context. Outputs CONTINUE or STOP. Any non-CONTINUE response or error/timeout is treated as STOP (fail-safe).

### Approval Flow

1. Server creates `ApprovalEvent` (pending) and broadcasts `agentToAgentApproval` + `a2aPendingApproval` to all humans
2. Any human can respond with: `deny`, `approve-count` (sets budget), `approve-always` (with guard), `approve-force` (dangerous)
3. First response wins. Server broadcasts `approvalResolved`
4. On approval: delivery is created for the target agent. On deny: no delivery, mode resets to `ask`

### Human Intervention Reset

Any human-to-agent message resets `consecutiveA2aCount` to 0 and `lastGuardCheckAt` to 0.

### Serialization

A2A routing is serialized via a promise chain (`a2aRoutingChain`) to prevent race conditions when multiple agents complete simultaneously (e.g., double budget decrement).

## Rename Handling (Phase 2 Track B)

Clients send `renameParticipant` with the target participantId and new name. Server validates via `validateParticipantName` with `excludeParticipantId`, updates the participant record, creates a `RenameEvent`, and broadcasts `participantRenamed`. On conflict, sends `renameRejected`. Rename notices are included in the next agent's delta context prompt.

## Session Persistence (Phase 2 Track B)

`SessionPersistence` writes append-only JSONL events to `session-{id}.jsonl`:
- Event types: `init`, `join`, `msg`, `dlv`, `seen`, `pstat`, `leave`, `rename`, `loop`, `appr`
- On server restart: replays all events to rebuild full session state (session, participants, transcript, deliveries, seen states, loop state, approvals, rename events)
- All participants are marked offline on restore (they must reconnect)
- Enabled via `CLAUI_PERSISTENCE_DIR` env var

## Typing/Activity Relay (Phase 2 Track B)

- Humans send `typingIndicator` (idle/typing) -> server broadcasts `participantActivity` to all other clients
- Agent delivery events trigger activity broadcasts: `accepted` -> thinking, `firstToken` -> streaming, `completed`/`failed` -> idle
- Human typing state auto-resets to idle when a message is sent

## Delta Context

Agents receive only messages they haven't seen:
- **First delivery**: session opening + last 5 messages + current task
- **Subsequent**: only messages with `seq > lastAckedDeliveredSeq` + current task
- `AgentSeenState` is advanced only after the owning ClaUi acknowledges the delivery

## Codex Auto-Steer

When a new delivery arrives for a busy Codex agent:
1. Cancel the current turn (`processManager.cancelTurn()`)
2. Wait up to 8s for it to stop
3. Mark the old delivery as `interrupted`
4. Start the new delivery

## File Change Tracking (Phase 2 Track C)

`FileChangeTracker` detects which files an agent modifies during a delivery turn, enabling the server to detect overlapping edits and warn about conflicts.

### Dual-Strategy Detection

**Strategy 1 -- Claude tool-use tracking:**
- Listens to `toolUseStart`, `toolUseDelta`, and `blockStop` events from `StreamDemux`
- Tracks only write-capable tools: `Edit`, `MultiEdit`, `Write`, `NotebookEdit`
- Accumulates partial JSON during `toolUseDelta`, parses `file_path`/`path` on `blockStop`
- Classifies change kind: `Write` -> `create`, others -> `modify`
- Resolves absolute paths relative to workspace root
- Source reported as `'tool-use'`

**Strategy 2 -- Codex snapshot-based fallback:**
- Before each Codex turn: `takeSnapshotBefore()` scans the workspace (top N directory levels, default 2)
- After turn completion: `diffSnapshot()` rescans and compares mtimes
- Detects creates (new files), modifies (mtime increased), and deletes (files removed)
- Excludes common non-source directories (`node_modules`, `.git`, `dist`, `venv`, etc.)
- Source reported as `'snapshot'`

**Strategy 2b -- Codex command heuristic parsing:**
- Listens to `commandExecutionComplete` events from `CodexExecDemux`
- Regex patterns extract file paths from redirect (`>`, `>>`), `tee`, `cp`, and `mv` commands
- Only counts successful commands (exit code 0 or null)
- Adds to pending changes alongside snapshot results

### Turn Lifecycle

1. `HeadlessAgentRunner` calls `fileTracker.startTurn(deliveryId)` before each delivery
2. For Codex: calls `fileTracker.takeSnapshotBefore()` after `startTurn`
3. During the turn: tool-use events or command events accumulate changes
4. On completion: `fileTracker.finishTurn()` emits tool-use changes; for Codex, `fileTracker.diffSnapshot()` emits snapshot changes
5. `HeadlessAgentRunner` forwards `fileChanges` events from the tracker
6. `AgentBridge` listens for `fileChanges` and sends a `fileChangeReport` to the server with workspace metadata (`workspaceId`, `workspaceRoot`, `source`, `changes`, `reportedAt`)

### Cancel Agent

`AgentBridge` handles `cancelAgent` server messages by calling `runner.cancel(deliveryId)` with agent participant ID filtering (ignores cancels targeted at other agents).

## Extension Host UI (MultiParticipantSessionTab)

The inline HTML webview in `MultiParticipantSessionTab` handles the following server message types with corresponding UI elements:

### Server Message Handlers

| Server Message | Handler | UI Effect |
|----------------|---------|-----------|
| `participantRenamed` | `handleParticipantRenamed` | Updates participant list, shows info notification toast |
| `participantActivity` | `handleParticipantActivity` | Shows typing/thinking/streaming indicator next to participant name |
| `agentToAgentApproval` | `handleAgentToAgentApproval` | Approval banner with source/target agent names and message preview |
| `fileConflictWarning` | `handleFileConflictWarning` | Warning banner showing conflicting file paths and agents (dismissable) |
| `guardStop` | `handleGuardStop` | Error-styled banner with reason and recent message previews |
| `approvalResolved` | `handleApprovalResolved` | Removes the corresponding approval/guard banner |

### Webview Message Handlers

| Webview Message | Action |
|-----------------|--------|
| `approvalDecision` | Sends decision to server (`deny`, `approve-count` with budget 5, `approve-always`, `approve-force`) |
| `dismissConflict` | Removes conflict from `activeConflicts` map |

### Notification Banners

The webview has a `#notifications` area that renders three styles of banners:
- **Approval** (blue): A2A approval requests with Deny / Allow 5 / Always / Force buttons
- **Guard** (red): Guard stop alerts with the same approval action buttons
- **Conflict** (yellow): File conflict warnings, dismissable with an X button
- **Info** (muted): Rename notifications and other informational toasts, auto-dismissable

### State Tracked

- `activityStates: Map<string, MPTypingState>` -- per-participant typing/thinking/streaming state
- `pendingApprovals: Map<string, MPApprovalEvent>` -- pending A2A and guard stop approvals
- `activeConflicts: Map<string, MPFileConflictWarning>` -- active file conflict warnings

## Phase 1 Protocol Surface

Phase 1 extends types only. The protocol now has contracts for:

- **A2A loop control**: `agentToAgentApproval`, `approvalDecision`, `approvalResolved`, `a2aPendingApproval`, `guardStop`, plus `AgentLoopControlState` and `ApprovalEvent`.
- **Typing/activity**: client `typingIndicator` and server `participantActivity` using `TypingState` (`idle`, `typing`, `thinking`, `streaming`).
- **Workspace/file coordination**: client `fileChangeReport`, server `fileConflictWarning`, and server `cancelAgent`.
- **Rename flow**: client `renameParticipant`, server `participantRenamed`, `renameRejected`, and `RenameEvent`.
- **Session policy fields**: `agentMode` (`execute` or `plan-only`) and `allowRemoteSteer` (`owner-only`, `ask`, `always`).
- **React bridge contracts**: `mpJoinSession`, `mpSendMessage`, `mpSessionState`, `mpNewMessage`, `mpDeliveryStatus`, `mpAgentToAgentApproval`, `mpGuardStop`, `mpFileConflictWarning`, and related `mp*` messages in `webview-messages.ts`.

## How to Use (Phase 0)

### Start the Server
```bash
cd server
npm install
npm run build
npm start
# Server listens on ws://localhost:9120
```

### Join from VS Code
1. Run command: `ClaUi: Join Multi-Participant Session`
2. Enter server URL (default: `ws://localhost:9120`)
3. Enter your display name (e.g., "Alice")
4. Enter your agent's name (e.g., "Claude")
5. Select provider (Claude or Codex)

### Send Messages
- Type normally to broadcast to all humans
- Prefix with agent name to address it: "Claude check this file"
- Prefix with route key: "C: check this file"

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `claudeMirror.multiParticipant.serverUrl` | `ws://localhost:9120` | Coordination server URL |

## Current Runtime Scope

- Server with session management, routing, delivery lifecycle
- Extension WebSocket client and agent bridge
- Headless Claude and Codex agent runners
- File change tracking (tool-use for Claude, snapshot + command heuristic for Codex)
- Agent cancel support via server `cancelAgent` messages
- Shared UI tab with message display, input, activity indicators, notifications
- A2A approval and guard stop banners with approval action buttons (Deny/Allow 5/Always/Force)
- File conflict warning banners (dismissable)
- Participant rename notification toasts
- Name validation with Intl.Segmenter (Hebrew, emoji support)
- Delta context for agent prompts
- Codex auto-steer busy policy
- Delivery status tracking and broadcast
- A2A loop protection with 4 modes (ask/budget/always/force)
- Guard service (configurable LLM model, 10s timeout, fail-safe)
- Approval event lifecycle (create, broadcast, resolve)
- Rename handling with validation and broadcast
- Typing/activity indicator relay (typing, thinking, streaming, idle)
- Session persistence (JSONL append-only, replay on restart)
- Agent response routing (detect A2A, gate via LoopController)
- Plan-only mode prompt injection
- Rename notices in agent delta context

## Phase 2 Track D: Zustand Store Slice

The store slice (`store.ts`) holds all MP-related state and actions:

**State fields**: `mpConnectionStatus`, `mpSession`, `mpParticipants`, `mpMessages`, `mpMyHumanId`, `mpMyAgentId`, `mpApprovals`, `mpTypingStates`, `mpFileConflicts`, `mpStreamingTexts` (keyed by deliveryId), `mpDeliveryStatuses`, `mpJoinDialogOpen`, `mpJoinError`, `mpRenameError`, `mpDismissedConflictIds`.

**Key actions**: `setMpSession` (full hydration from sessionState), `addMpMessage`, `updateMpParticipant`, `removeMpParticipant`, `setMpDeliveryStatus`, `appendMpStreamingText` (supports both delta and accumulated text), `addMpApprovalEvent`, `resolveMpApproval`, `setMpFileConflict` (upsert by conflictId), `setMpTypingState` (upsert by participantId), `clearMpState`.

All state is cleared on session `reset()`.

## Server Configuration (Environment Variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUI_SERVER_PORT` | `9120` | WebSocket server port |
| `CLAUI_PERSISTENCE_DIR` | (disabled) | Directory for JSONL session persistence |
| `CLAUI_GUARD_API_KEY` | (disabled) | Anthropic API key for guard model |
| `CLAUI_GUARD_MODEL` | `claude-haiku-4-5-20251001` | Guard model name |
| `CLAUI_GUARD_API_URL` | `https://api.anthropic.com/v1/messages` | Custom API URL |

## Not Yet Implemented (Runtime)

- Workspace overlap detection (server-side file tracking, Phase 3 Track E)
- Webview indicators, delivery status badges, autocomplete (Phase 3 Track F)
- Approval dialog and manual stop UI in React webview (Phase 3 Track G)
- React webview integration with extension host (Phase 4)
- Reconnection handling
- Git workspace isolation modes
- Multiple concurrent sessions per server
