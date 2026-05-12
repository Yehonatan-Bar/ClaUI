# Multi-Participant Session

## What This Is

A shared coding session where multiple humans and their code agents (Claude Code, Codex) participate in a single conversation. Each human sees the full transcript in real time. Each agent receives a prompt only when a message is deterministically addressed to it by the coordination server.

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
                     | Ping/Pong Keepalive        |
                     | Stream Coalescing          |
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
| `types.ts` | Data model and protocol contracts: Session, Participant, Message, AgentDelivery, AgentSeenState, DeliveryStatus, A2A approval state, typing/activity state, rename events, file change/conflict reports. Includes `rejoinSession`, `rejoinAccepted/Rejected`, and `ping/pong` messages |
| `Router.ts` | Name validation (`normalizeName`, `extractRouteKey`, `validateParticipantName`), message routing (`routeMessage` - greedy longest-name match then routeKey fallback) |
| `CoordinationServer.ts` | WebSocket server: session management, join/leave/rejoin lifecycle, human message routing, agent delivery creation, delta context building, agent prompt formatting, delivery status tracking, A2A gating via LoopController, rename handling, typing/activity relay, JSONL persistence, ping/pong keepalive (10s interval), textDelta stream coalescing (50ms window) |
| `LoopController.ts` | A2A loop protection state machine: `ask`/`budget`/`always`/`force` modes, budget counting, approval event lifecycle, guard-check triggering, human-intervention reset |
| `GuardService.ts` | One-shot LLM call to detect unproductive A2A loops. Calls Anthropic API with a structured prompt. 10s timeout, fail-safe to STOP. Configurable model via `CLAUI_GUARD_API_KEY` / `CLAUI_GUARD_MODEL` env vars |
| `SessionPersistence.ts` | Append-only JSONL persistence for session state. Writes events (init, join, msg, dlv, seen, pstat, leave, rename, loop, appr). Replays on startup to restore full state. One file per session |
| `index.ts` | Entry point with `ServerConfig`: port, persistence dir, guard API key/model (all via env vars) |

### Extension (`src/extension/multiparticipant/`)

| File | Purpose |
|------|---------|
| `MultiParticipantProtocol.ts` | Client-server WebSocket message type definitions (mirrors server types). Includes `rejoinSession`, `rejoinAccepted/Rejected`, `ping/pong` |
| `MultiParticipantClient.ts` | WebSocket client with auto-reconnect (exponential backoff, max 20 attempts), session identity tracking for rejoin, message queuing during disconnect, ping timeout detection (15s) |
| `FileChangeTracker.ts` | Tracks file changes from agent tool_use events and filesystem snapshots. Dual-strategy: (1) structured tool tracking for Claude via StreamDemux, (2) snapshot-based mtime diffing for Codex |
| `HeadlessAgentRunner.ts` | Drives a local Claude or Codex agent without a visible webview. Creates process managers, demuxers, and a FileChangeTracker. Accepts `deliver()` calls, emits `agentEvent` and `fileChanges` events |
| `AgentBridge.ts` | Connects server `deliverPrompt` and `cancelAgent` commands to `HeadlessAgentRunner`, reports agent events and `fileChangeReport` messages back to server |
| `MultiParticipantSessionTab.ts` | Shared UI tab using the React webview bundle (`buildWebviewHtml`). Sets `tabKind: 'multiparticipant'` so `App.tsx` renders `MPSessionView`. Translates server messages to `mp`-prefixed `ExtensionToWebviewMessage` types for the Zustand store. Handles rejoin on reconnect |

### Webview Components (`src/webview/components/MultiParticipant/`)

| File | Purpose |
|------|---------|
| `MPSessionView.tsx` | Top-level layout: header (session name + connection badge), sidebar (ParticipantList), main area (MPChatView + MPInputArea), JoinDialog overlay, ApprovalDialog modal, connecting spinner |
| `MPChatView.tsx` | Scrollable message list with auto-scroll-to-bottom, streaming text area for active deliveries, ConflictWarning and GuardStopNotification banners |
| `MPInputArea.tsx` | Text input with ParticipantAutocomplete, typing indicator emission (500ms debounce, 5s auto-idle), ActivityIndicators display |
| `MpMessageBubble.tsx` | Message renderer: participant color border, kind badges, delivery status pills, trigger-message links, rename detection, RTL support, streaming cursor |
| `ParticipantList.tsx` | Sidebar: status dots, kind badges, provider labels, route key labels, approval pulse indicator, Stop A2A button |
| `ParticipantAutocomplete.tsx` | Dropdown autocomplete matching participant names/route keys, Tab/Enter accept, arrow navigation |
| `ActivityIndicators.tsx` | Per-participant activity: bouncing dots (typing), spinning ring (thinking), pulsing dot (streaming) |
| `ApprovalDialog.tsx` | Modal for A2A approval: Deny, Allow N, Always Allow, Force (with confirmation) |
| `GuardStopNotification.tsx` | Inline banner for guard stops with reason, message previews, and approval actions |
| `ConflictWarning.tsx` | File conflict warning banners, dismissable per conflict |
| `JoinDialog.tsx` | Modal form: server URL, human name, agent name, provider selector |
| `mpColors.ts` | Deterministic color assignment via FNV-1a hash of participantId, 12-color palette |
| `mpTypes.ts` | Re-exports protocol types for webview import convenience |
| `index.ts` | Barrel export for all MP components |

### Shared Integration Points

| File | MP Changes |
|------|------------|
| `src/webview/state/store.ts` | `tabKind` type includes `'multiparticipant'`. 18 MP state fields + 19 action methods in the Zustand store |
| `src/webview/hooks/useClaudeStream.ts` | Dispatches 16 `mp*` ExtensionToWebview message types to store actions |
| `src/webview/App.tsx` | Routes to `MPSessionView` when `tabKind === 'multiparticipant'` |
| `src/extension/types/webview-messages.ts` | 8 webview-to-extension + 16 extension-to-webview MP message interfaces. `tabKind` includes `'multiparticipant'` |
| `src/extension/commands.ts` | `claudeMirror.joinMultiParticipantSession` command |
| `package.json` | Command + `claudeMirror.multiParticipant.serverUrl` setting |
| `src/webview/styles/global.css` | MP animations (cursor-blink, dot-bounce, spin, pulse, approval-pulse) + MP layout styles (session view, header, chat view, input area, streaming area, connection badges) |

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

## Agent-to-Agent Loop Protection

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

## Reconnection Handling

### Client Auto-Reconnect

`MultiParticipantClient` implements exponential backoff reconnection:
- Base delay: 1s, max delay: 30s, max attempts: 20
- Jitter factor: 0.85-1.15x to prevent thundering herd
- Queues messages sent during disconnect, flushes on reconnect
- Tracks `humanParticipantId`, `agentParticipantId`, and `lastSeenSeq` for identity-preserving rejoin

### Rejoin Protocol

On reconnect, if the client has stored identity:
1. Client sends `rejoinSession` with `humanParticipantId`, `agentParticipantId`, `lastSeenSeq`
2. Server looks up existing participants, marks them online, computes delta transcript (`seq > lastSeenSeq`)
3. Server responds with `rejoinAccepted` containing the delta (not full transcript)
4. If participants not found, server sends `rejoinRejected`

### Ping/Pong Keepalive

- Server sends `ping` every 10s to all connected clients
- Client responds with `pong` and resets a 15s timeout timer
- If no ping received within 15s, client closes connection to trigger auto-reconnect

## Performance Optimizations

### Stream Coalescing

The server coalesces rapid `textDelta` agent events within a 50ms window:
- Multiple deltas arriving within 50ms are accumulated into a single `agentStreamingText` broadcast
- Buffer is flushed immediately when a delivery reaches a terminal state (completed, failed, interrupted)
- Reduces WebSocket frame count during fast streaming

## Delta Context

Agents receive only messages they haven't seen:
- **First delivery**: session opening + last 5 messages + current task
- **Subsequent**: only messages with `seq > lastAckedDeliveredSeq` + current task
- `AgentSeenState` is advanced only after the owning ClaUi acknowledges the delivery

## Session Persistence

`SessionPersistence` writes append-only JSONL events to `session-{id}.jsonl`:
- Event types: `init`, `join`, `msg`, `dlv`, `seen`, `pstat`, `leave`, `rename`, `loop`, `appr`
- On server restart: replays all events to rebuild full session state
- All participants are marked offline on restore (they must reconnect)
- Enabled via `CLAUI_PERSISTENCE_DIR` env var

## File Change Tracking

`FileChangeTracker` detects which files an agent modifies during a delivery turn:
- **Claude**: Structured tool-use tracking via StreamDemux (Edit, MultiEdit, Write, NotebookEdit)
- **Codex**: Snapshot-based mtime diffing + command heuristic parsing

## How to Use

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

## Environment Variables (Server)

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUI_SERVER_PORT` | `9120` | Server listen port |
| `CLAUI_PERSISTENCE_DIR` | (none) | Directory for JSONL session persistence |
| `CLAUI_GUARD_API_KEY` | (none) | Anthropic API key for guard model |
| `CLAUI_GUARD_MODEL` | `claude-haiku-4-5-20251001` | Model for guard checks |
| `CLAUI_GUARD_API_URL` | (Anthropic default) | Custom API endpoint for guard |
