# Remote Control (MCP)

Lets external programs control ClaUi: MCP clients (Claude Code, Claude Desktop,
Cursor, Windsurf, VS Code's MCP support), Python/PowerShell/Node scripts, curl,
and Claude sessions running inside ClaUi itself. Remote callers can open and
close tabs, send prompts and wait for the reply, read transcripts, answer plan
approvals and questions, switch model / permission mode / effort, resume or
fork past sessions, search history, organize tab folders, read and change
`claudeMirror.*` settings, run ClaUi commands, follow every UI event, and reach
any other chat-UI feature through a generic, policy-checked UI-action tool.

Off by default (`claudeMirror.remoteControl.enabled`).

---

## Architecture

```
 MCP client (Claude Code / Desktop / Cursor / VS Code)     scripts / curl / Python
        |  stdio (newline-delimited JSON-RPC)                    |   HTTP + Bearer token
        v                                                        |
 ~/.claui/remote-control/bin/claui-mcp.js  (stable launcher)      |
   -> bin/<version>/mcp-server.js  (stdio MCP server)            |
        |  discovers windows in ~/.claui/remote-control/instances |
        |  POST /api/tools/<name>                                 |
        v                                                        v
 +----------------------- VS Code window (extension host) ------------------------+
 |  RemoteControlHttpServer  127.0.0.1:<port>   /mcp  /api/*  (token, Host/Origin) |
 |        |                                                                        |
 |  RemoteControlToolHandlers  -- validation + access policy --> TabManager, stores |
 |        |                                      \--> tab.dispatchRemoteMessage()   |
 |  EventLog <-- RemoteControlService.onTap <-- remoteControlTap <-- every tab      |
 |  TabStateTracker (live transcript + status per tab)                              |
 +--------------------------------------------------------------------------------+
```

Two ways in, same tools:

| Transport | Endpoint | Use |
|-----------|----------|-----|
| stdio MCP (recommended for MCP clients) | `node ~/.claui/remote-control/bin/claui-mcp.js` | Finds the right VS Code window automatically, serves the tool list even while VS Code is closed, adds `list_instances` / `select_instance` / `open_vscode_window` |
| HTTP (scripts, HTTP-capable MCP clients) | `http://127.0.0.1:<port>` | `POST /mcp` (MCP Streamable HTTP, stateless JSON), `GET /api/tools`, `POST /api/tools/<name>`, `GET /api/events`, `GET /api/events/stream` (SSE), `GET /api/status` |
| CLI | `node ~/.claui/remote-control/bin/claui.js <command>` | Shell scripts; exit codes reflect the turn status |

### Design rules

- **Hybrid API.** Lifecycle operations (create / close / focus / rename / resume /
  fork / hibernate / folders / provider handoff) call host-side APIs
  (`TabManager`, `TabGroupStore`, `vscode.commands`). Chat interactions (send,
  approvals, answers, model / permission / effort / fast mode, cancel, compact,
  schedule, every generic UI action) re-enter the tab's webview message handler
  through `dispatchRemoteMessage()`, so they behave exactly like a click in the
  chat UI and the UI stays in sync (the user sees the remote prompt as a normal
  chat bubble).
- **Observe everything.** `remoteControlTap` sees every extension -> webview
  message (`postMessage` / `postToWebview` in all three tab classes) and every
  webview -> extension action (real clicks and remote dispatches). It feeds
  `TabStateTracker` always (so transcripts are complete even if remote control is
  turned on mid-session) and `EventLog` while the server runs.
- **Turn tracking.** `armTurnWaiter()` subscribes BEFORE the action is
  dispatched, and remote sends are serialized per tab (`withSendLock`).

---

## Key files

| File | Role |
|------|------|
| `src/remote-control-shared/protocol.ts` | Paths (`~/.claui/remote-control/...`), routes, `InstanceInfo`, `RemoteEvent`, error codes, `RemoteControlError` |
| `src/remote-control-shared/toolCatalog.ts` | Single source of truth for all tools (schema, mutating / destructive / long-running, scope) + `toMcpTool()` annotations |
| `src/remote-control-shared/mcpProtocol.ts` | Transport-agnostic MCP JSON-RPC handler (`initialize`, `ping`, `tools/list`, `tools/call`, empty `resources/*` / `prompts/list`), server instructions |
| `src/remote-control-shared/instanceRegistry.ts` | Instance records (atomic writes, dead-PID cleanup), window selection, token file, constant-time compare |
| `src/remote-control-shared/httpClient.ts` | Minimal JSON HTTP client (runtime, CLI, tests) |
| `src/extension/remote-control/RemoteControlTap.ts` | Process-wide in/out observation point used by the tab classes |
| `src/extension/remote-control/RemoteControlService.ts` | Lifecycle (settings watcher, server start/stop, instance heartbeat), runtime install, status bar item, setup quick pick, client config generators, commands |
| `src/extension/remote-control/RemoteControlToolHandlers.ts` | Implementation of every `instance` tool; central validation + read-only check |
| `src/extension/remote-control/uiActionCatalog.generated.json` | Generated list of all 227 UI actions and 197 UI events with fields (from `webview-messages.ts`) |
| `src/extension/remote-control/core/RemoteControlHttpServer.ts` | Localhost server: Host/Origin checks, auth-before-body, routes, SSE, limits |
| `src/extension/remote-control/core/EventLog.ts` | Ring buffer (3000) + live subscribers + long-poll; live-only noisy types |
| `src/extension/remote-control/core/TabStateTracker.ts` | Per-tab transcript (upsert by messageId, history replace, tool results), busy / model / cost / last turn / pending approval / usage-limit / scheduled state |
| `src/extension/remote-control/core/TurnWaiter.ts` | Turn-completion state machine |
| `src/extension/remote-control/core/accessPolicy.ts` | Risk classes for UI actions, commands and setting writes; secret-key detection |
| `src/extension/remote-control/core/argValidator.ts` | JSON-schema-subset validator with global size / depth caps |
| `src/extension/remote-control/core/payloadCompactor.ts` | Size-bounds event payloads; elides base64; redacts credential keys |
| `src/extension/remote-control/core/contentFormat.ts` | Content blocks -> readable text (tools, results, thinking) |
| `src/extension/remote-control/core/scheduleTime.ts` | `+15m` / ISO / epoch parsing for `schedule_message` |
| `src/remote-control-runtime/mcpServer.ts` (+ `mcpServerMain.ts`) | stdio MCP server: concurrent requests, live-or-bundled tool list, forwarding, progress heartbeats |
| `src/remote-control-runtime/instanceClient.ts` | Window discovery + authenticated liveness probe (`/api/status` must echo the `instanceId`) + forwarding |
| `src/remote-control-runtime/localTools.ts` | `list_instances`, `select_instance`, `open_vscode_window` |
| `src/remote-control-runtime/cli.ts` | Command-line client |
| `scripts/generate-remote-control-catalog.js` | Regenerates the UI catalog (`npm run gen:remote-control-catalog`; `--check` fails when stale) |
| Edits in `SessionTab.ts`, `CodexSessionTab.ts` | tap calls, `dispatchRemoteMessage()`, `applyRemoteRename()`, `isWebviewReadyState`; the webview handler body lives in `handleIncomingWebviewMessage()` (unchanged behavior) |
| Edits in `MultiParticipantSessionTab.ts` | tap calls only (no remote dispatch for multi-participant tabs) |

Webpack target `remote-control-runtime` emits `dist/remote-control-runtime/mcp-server.js` and `cli.js`.

---

## On-disk layout (`~/.claui/remote-control/`)

| Path | Content |
|------|---------|
| `token` | 64-hex per-user secret, created on first enable (atomic write, mode 0600 where supported). Shared by all windows; every request re-reads it, so "Regenerate token" in any window revokes old clients everywhere |
| `instances/<instanceId>.json` | One per window serving remote control: pid, port, workspace folders/name, version, access level, startedAt, heartbeatAt (rewritten every 30 s), lastFocusedAt (set when the window gains focus; drives "most recently focused" selection). Deleted on shutdown; readers delete records of dead PIDs |
| `bin/<version>/mcp-server.js`, `bin/<version>/cli.js` | Runtime copied from the extension (hash-compared, atomic). Current + previous version kept |
| `bin/current.json` | `{ version, dir }` of the active runtime |
| `bin/claui-mcp.js`, `bin/claui.js` | Stable launchers that `require` the runtime named in `current.json` (MCP configs never change across updates) |

Override the root with `CLAUI_REMOTE_CONTROL_HOME` (used by tests).

---

## Window selection (stdio runtime / CLI)

1. `select_instance` / `CLAUI_INSTANCE` / `--instance` (instanceId, workspace path, or workspace-name substring). An explicit preference never silently falls back to another window.
2. The window whose workspace folder contains the client's cwd (deepest match, directory-boundary aware, case-insensitive on Windows).
3. The most recently focused window.

A candidate is used only after an authenticated `GET /api/status` answers with the
same `instanceId` (protects against stale records and PID reuse).

---

## Tools

Arguments are validated against each tool's schema before anything runs.
`tabId` accepts the id (`tab-3`), the tab number (`3`), or the exact tab name;
omitted = the active tab.

| Group | Tools |
|-------|-------|
| Status | `get_status`, `list_tabs`, `get_tab`, `list_models` |
| Tab lifecycle | `create_tab` (provider, model, permissionMode, effort, name, accountProfileId, prompt + wait), `close_tab`, `focus_tab`, `rename_tab`, `resume_session` (+ prompt), `fork_session`, `hibernate_tab` (light/deep), `wake_tab`, `stop_session`, `clear_session` |
| Conversation | `send_message` (text, images by path or base64, wait, timeoutSec, ifBusy wait/queue/reject, steer), `wait_for_idle`, `get_messages` (live or by sessionId from disk; text or blocks; paging), `get_last_response`, `cancel_response`, `compact_context`, `schedule_message` (`+15m` / ISO / epoch), `cancel_scheduled_message` |
| Approvals | `list_pending_approvals` (plan text, AskUserQuestion questions+options, permission tool input), `respond_to_approval` (approve / approve_clear_context / approve_manual / reject / feedback), `answer_question` (per-question answers or free text) |
| Per-tab settings | `set_model`, `set_permission_mode`, `set_effort` (Claude or Codex levels), `set_fast_mode` (Claude fast / Codex fast tier), `switch_provider` (context handoff Claude <-> Codex) |
| History | `list_sessions` (ClaUi store or every session file on disk), `search_conversations` (full text) |
| Folders | `list_groups`, `create_group`, `move_tab_to_group`, `delete_group` (tabs re-parented) |
| Extension | `get_settings` (values + schema; secrets redacted), `update_setting` (validated against the manifest), `list_commands`, `execute_command` (claudeMirror.* from the manifest), `list_ui_actions`, `dispatch_ui_action` (+ `waitForEvent`), `get_events` (long-poll), `show_notification` |
| Local (stdio runtime) | `list_instances`, `select_instance`, `open_vscode_window` |

### Turn results (`send_message`, `create_tab` / `resume_session` with prompt, `respond_to_approval`, `answer_question`, `wait_for_idle`)

```json
{
  "tabId": "tab-2",
  "status": "completed",
  "response": "assistant text of this turn",
  "toolCalls": [{ "name": "Bash", "input": "{\"command\":\"npm test\"}", "result": "...", "isError": false }],
  "pendingApproval": null,
  "turn": { "turnIndex": 3, "costUsd": 0.04, "durationMs": 9120, "toolNames": ["Bash"] },
  "cost": { "lastTurnUsd": 0.04, "totalUsd": 0.31, "inputTokens": 1200, "outputTokens": 640 },
  "sessionId": "8f1c...",
  "durationMs": 9480
}
```

`status` values:

| Status | Meaning | Next step |
|--------|---------|-----------|
| `completed` | Turn finished | - |
| `awaiting_approval` | Blocked on plan / question / permission (`pendingApproval` filled) | `respond_to_approval` or `answer_question` |
| `queued_usage_limit` | Usage limit hit; ClaUi auto-sends after the reset | wait |
| `cancelled` | A `cancelRequest` happened during the wait | - |
| `session_ended` | CLI session ended / crashed | send again or `resume_session` |
| `error` | Failed before the turn started (`error` filled) | check `get_tab.lastError` |
| `idle` | Nothing started (e.g. the text was consumed as an answer) | inspect `get_tab` |
| `timeout` | Still running when the wait ended | `wait_for_idle` |

### TurnWaiter rules

- `turnComplete` -> settle 400 ms -> `completed`; `processBusy:false` after the
  turn started -> settle 700 ms -> `completed` (a new `processBusy:true` cancels
  the settle); a pending approval at settle time -> `awaiting_approval`.
- `planApprovalRequired` -> `awaiting_approval`; `sessionEnded` -> `session_ended`;
  `usageQueuedPromptState{queued:true}` -> `queued_usage_limit`; inbound
  `cancelRequest` -> `cancelled`.
- `error` before the turn started -> `error` after 1.5 s unless busy begins.
- No start within the grace window (45 s for sends; 8 s for approvals, which in
  stream mode may finish without a new busy cycle) -> `idle` / `error`.

### Busy tabs

`send_message` with `ifBusy`: `wait` (default; waits for the running turn, then
sends), `queue` (send now; the CLI runs it next), `reject`. A pending approval is
not "busy": the text becomes the free-text answer (same as typing in the UI).
Deep-hibernated tabs are woken first.

### Events

`RemoteEvent = { seq, time, tabId, direction: 'out'|'in'|'system', type, data }`.

- `out`: every chat-UI message type (`assistantMessage`, `userMessage`, `processBusy`,
  `toolUseStart`, `toolResult`, `costUpdate`, `turnComplete`, `planApprovalRequired`,
  `error`, `sessionStarted`, `sessionEnded`, `usageLimitDetected`, ... - see
  `list_ui_actions {includeEvents:true}`).
- `in`: user / remote actions (`sendMessage`, `planApprovalResponse`, `setModel`, ...).
- `system`: `tabOpened`, `tabClosed`, `tabRenamed`, `tabBusyChanged`,
  `tabSessionAssigned`, `tabSleepChanged`, `remoteControlStarted`.
- Live-only (SSE with `includeLive=1`, never stored): `streamingText`,
  `toolUseInput`, `tabList`, `memorySnapshot`, BTW / merge / MP streaming deltas.
- Payloads are compacted (strings 4000 chars, arrays 100 items, depth 6); base64
  is elided and credential keys are redacted.

---

## Security model

Remote callers are local processes of the same OS user that can read the token
file. Anyone holding the token can run prompts, and in full-access permission
mode that means running code as the user. Admins and same-user processes are
trusted.

| Control | Detail |
|---------|--------|
| Bind | `127.0.0.1` only |
| Browser / CSRF | Requests with `Origin` or `Sec-Fetch-Site` are refused; POST bodies must be `application/json` |
| DNS rebinding | `Host` must be `127.0.0.1` / `localhost` / `[::1]` (optionally with our port) |
| Auth | Bearer or `X-ClaUi-Token`, constant-time compare, checked before any body is read. Tokens in URLs are rejected. `/health` is the only public route |
| Limits | 32 MB body, 64 concurrent requests, 16 SSE clients (each disconnected when more than 4 MB is waiting unread), 15 s header timeout, 30 s body-read timeout, images 10 MB each / 10 per message, argument string/array/depth caps |
| Abandoned calls | A queued `send_message` / approval whose caller disconnected or timed out before its turn is NOT dispatched (`status: cancelled`, `sent: false`); waiters on an already-aborted request resolve immediately |
| Access level | `accessLevel: readOnly` blocks every mutating tool (read-style UI queries such as `getProjectAnalytics` stay allowed) |
| Sensitive actions | UI actions are an allowlist (`accessPolicy.ts`): each of the 227 types sits in exactly one of BLOCKED / QUERY / NORMAL / SENSITIVE (a test enforces it), and anything unclassified - e.g. a UI action added later - is sensitive. Sensitive through `dispatch_ui_action`, `execute_command` and `update_setting`: credentials / API keys / sign-in, git push / worktrees / merges, MCP server config, security policy (Secret Protection, SPA, WAG, accelerator hooks and their settings), Bridge Provider routing (`setCouncilSettings`, every `bridge.*` setting - providers can point at any URL and key file), checkpoint revert/redo, external-folder import, SkillGen, files / URLs / terminals / clipboard / file pickers, external sends (bug report, feedback), data deletion, multi-participant actions, and settings holding paths, URLs, scripts or tokens. Blocked unless `allowSensitiveActions` is on |
| Never remote | `claudeMirror.remoteControl.*` settings and commands, non-ClaUi VS Code commands, commands missing from the manifest, webview lifecycle messages (`ready`, `diag`, telemetry) |
| Secrets | `get_settings` redacts token / API-key style values; event payloads redact credential keys |
| Logging | One line per request (`[RemoteControl][HTTP] #id METHOD path tool=name -> status (ms)`); prompt text and arguments are never logged |

**Recursion note:** registering the server with Claude Code at user scope also
gives the Claude sessions *inside* ClaUi these tools (they can open tabs and
delegate work to them). That is intentional and useful; use `readOnly` or do not
register at user scope if unwanted.

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `claudeMirror.remoteControl.enabled` | `false` | Run the control server for this window |
| `claudeMirror.remoteControl.port` | `0` | Fixed port, 0 = automatic. A busy fixed port falls back to a random one (logged) |
| `claudeMirror.remoteControl.accessLevel` | `"full"` | `full` or `readOnly` |
| `claudeMirror.remoteControl.allowSensitiveActions` | `false` | Allow the sensitive classes listed above |

## Commands

| Command | Purpose |
|---------|---------|
| `ClaUi: Remote Control (MCP) Setup` (`claudeMirror.remoteControl.setup`) | Quick pick: on/off, register with Claude Code, copy configs (Claude Code command, `mcpServers` JSON, VS Code `mcp.json`, HTTP endpoint + token), access level, sensitive actions, regenerate token, quick guide. Also the status-bar `MCP` item |
| `ClaUi: Enable / Disable Remote Control (MCP)` | Toggle `enabled` |
| `ClaUi: Register Remote Control with Claude Code` | `claude mcp add-json -s user claui {...}` via `McpCliService` (execFile, no shell); replaces an existing entry |
| `ClaUi: Copy Remote Control MCP Config` | `mcpServers` JSON |
| `ClaUi: Regenerate Remote Control Token` | New token for every window |
| `ClaUi: Remote Control Quick Guide` | Opens a generated markdown guide with this machine's real paths / port |

Generated stdio config: `command` = absolute `node` path when Node is on PATH,
otherwise VS Code's own Electron binary with `ELECTRON_RUN_AS_NODE=1`; `args` =
`[~/.claui/remote-control/bin/claui-mcp.js]`.

---

## Usage examples

Claude Code:

```
claude mcp add --scope user claui -- node "C:\Users\<you>\.claui\remote-control\bin\claui-mcp.js"
```

CLI (exit codes: 0 ok, 1 error, 2 awaiting approval, 3 timeout, 4 no window):

```
node ~/.claui/remote-control/bin/claui.js tabs
node ~/.claui/remote-control/bin/claui.js new --provider claude --model claude-sonnet-5-5 --prompt "Run the tests and summarize failures"
node ~/.claui/remote-control/bin/claui.js send "Now fix the first failure" --tab 2
node ~/.claui/remote-control/bin/claui.js approvals
node ~/.claui/remote-control/bin/claui.js approve --tab 2
node ~/.claui/remote-control/bin/claui.js events --follow --types turnComplete,planApprovalRequired
node ~/.claui/remote-control/bin/claui.js call dispatch_ui_action --json "{\"action\":{\"type\":\"getProjectAnalytics\"},\"waitForEvent\":\"projectAnalyticsData\"}"
```

Python (HTTP):

```python
import glob, json, os, urllib.request
home = os.path.expanduser("~/.claui/remote-control")
token = open(os.path.join(home, "token")).read().strip()
inst = json.load(open(sorted(glob.glob(os.path.join(home, "instances", "*.json")), key=os.path.getmtime)[-1]))
def call(tool, **args):
    req = urllib.request.Request(f"http://127.0.0.1:{inst['port']}/api/tools/{tool}",
        data=json.dumps(args).encode(), method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=900))["result"]
tab = call("create_tab", provider="claude", prompt="List the TODOs in this repo")
print(tab["response"])
```

---

## Tests

`npm run test:remote-control` (also checks the UI catalog is up to date):

- `tests/remote-control/catalogAndPolicy.test.ts` - catalog integrity, handler coverage, policy names exist, validator, schedule parsing
- `tests/remote-control/coreState.test.ts` - event log, compaction, formatting, tracker, turn waiter states
- `tests/remote-control/httpServer.test.ts` - auth, Origin/Host/URL-token refusals, REST + MCP over HTTP, events, SSE, port fallback
- `tests/remote-control/runtime.test.ts` - registry, selection, token, real stdio MCP server and CLI end-to-end against a live server

Live smoke test against a real window (manual; runs real Haiku turns, saves and restores the global model / effort / permission / fast-mode defaults it touches):

```
node --import tsx tests/remote-control/liveSmoke.ts [--instance <id|workspace>] [--with-question] [--keep-tab]
```

To run it without touching your main window, open a scratch folder whose
`.vscode/settings.json` sets `"claudeMirror.remoteControl.enabled": true` in an
Extension Development Host (`code --extensionDevelopmentPath=<repo> --new-window <folder>`).

## Limitations

- Multi-participant tabs are observable (events, list) but not remotely drivable.
- `permissionMode`, `effortLevel` and `fastMode` are global ClaUi settings; changing them from one tab applies to sessions started afterwards in all tabs (same as the UI).
- `execute_command` for commands that open pickers waits up to 120 s for the user, then returns `still_running`.
- Events are buffered in memory per window (last 3000); `get_events` reports when `sinceSeq` is older than the buffer.
- `open_vscode_window` needs the `code` command on PATH (or `CLAUI_CODE_CLI`).

Related: `MCP_SUPPORT.md` (managing MCP servers *used by* Claude sessions - the opposite direction), `ARCHITECTURE.md`.
