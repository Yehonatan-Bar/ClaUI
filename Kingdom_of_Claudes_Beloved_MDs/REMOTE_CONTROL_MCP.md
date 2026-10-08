# Remote Control (MCP)

Lets external programs control ClaUi: MCP clients (Claude Code, Claude Desktop,
Cursor, Windsurf, VS Code's MCP support), Python/PowerShell/Node scripts, curl,
and Claude sessions running inside ClaUi itself. Remote callers can open and
close tabs, send prompts and wait for the reply, read transcripts, answer plan
approvals and questions, switch model / permission mode / effort, resume or
fork past sessions, search history, organize tab folders, read and change
`claudeMirror.*` settings, run ClaUi commands, follow every UI event, and reach
any other chat-UI feature through a generic, policy-checked UI-action tool.

**Zero setup.** Installing the extension is enough: no menu, no setting, no
manual enable. The connection pieces are installed on every activation, and the
localhost server starts by itself the first time a local tool connects
(`claudeMirror.remoteControl.mode`: `auto` default, `on`, `off`).

---

## Zero-setup for agents (what happens after installing the extension)

On every activation, in every VS Code window, `RemoteControlService`:

1. Writes this window's record `~/.claui/remote-control/instances/<instanceId>.json`
   (mode, `serving: false`, port 0 until it serves, workspace folders, last focus).
2. Creates the per-user token if missing.
3. Installs the runtime (`runtimeInstaller.ts`): versioned bundles plus stable
   launchers in `~/.claui/remote-control/bin/` (stdio MCP server, CLI, Node and
   Python clients). It also writes `connection.json` (machine-readable) and
   `CONNECT.md` (agent/human guide) with this machine's real paths and
   ready-to-paste configs for every common MCP client.
4. Registers the MCP server with VS Code's own MCP registry
   (`contributes.mcpServerDefinitionProviders` + `vscode.lm.registerMcpServerDefinitionProvider`,
   VS Code 1.101+). Agents running inside VS Code (e.g. Copilot agent mode) get
   the ClaUi tools with no configuration. The definition runs the bundled stdio
   server with VS Code's own Node (`process.execPath`, `ELECTRON_RUN_AS_NODE=1`),
   pinned to that window (`CLAUI_INSTANCE`). The API is feature-detected, so older
   VS Code versions just skip this step.
5. Watches `~/.claui/remote-control/requests/` (fs.watch + 3 s poll).

An external agent then needs one config entry (or `claui.js register` for
Claude Code). Its first real tool call makes the stdio server pick a window.
If that window is not serving yet (mode `auto`), the server drops
`requests/<instanceId>__<nonce>.json`. The window starts its HTTP server, sets
`serving: true` in its record, and the call proceeds, typically in under a
second. Listing tools (`tools/list`, run by MCP clients at every session start)
never starts a server: it serves the bundled catalog until the window is serving.

| Agent | What it needs |
|-------|---------------|
| Inside VS Code | Nothing (native registration) |
| Claude Code | `node ~/.claui/remote-control/bin/claui.js register` (or the `claude mcp add` line from `CONNECT.md`) |
| Claude Desktop / Cursor / Windsurf / Codex / any MCP client | The snippet from `node claui.js mcp-config --client <name>` or `connection.json` |
| Own code (Node / Python) | `require('~/.claui/remote-control/bin/claui-client.js').connect()` or `from claui_client import ClauiClient` |
| Shell scripts | `node ~/.claui/remote-control/bin/claui.js <command>` |
| Before VS Code was ever opened | `node ~/.vscode/extensions/jhonbar.claude-code-mirror-<version>/dist/remote-control-runtime/cli.js install` installs the launchers from the extension folder |

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
| stdio MCP (recommended for MCP clients) | `node ~/.claui/remote-control/bin/claui-mcp.js` | Finds the right VS Code window automatically and starts its server on demand. Serves the tool list even while VS Code is closed. Adds `list_instances` / `select_instance` / `open_vscode_window` |
| VS Code native | registered by the extension | Agents inside VS Code; same stdio server, pinned to the window |
| HTTP (scripts, HTTP-capable MCP clients) | `http://127.0.0.1:<port>` | `POST /mcp` (MCP Streamable HTTP, stateless JSON), `GET /api/tools`, `POST /api/tools/<name>`, `GET /api/events`, `GET /api/events/stream` (SSE), `GET /api/status`. Port is in the window record; if `serving` is false, drop a request file first (bundled clients do it) |
| Client libraries | `bin/claui-client.js` (Node), `bin/claui_client.py` (Python 3.8+, stdlib only) | Same discovery + on-demand start; `call(tool, args)`, `tools()`, `events()` |
| CLI | `node ~/.claui/remote-control/bin/claui.js <command>` | Shell scripts and agent setup (`install`, `mcp-config`, `register`, `doctor`, `connection`); exit codes reflect the turn status |

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
| `src/remote-control-shared/instanceRegistry.ts` | Window records (atomic writes, dead-PID cleanup, legacy-record normalization), window selection, start requests (`writeStartRequest` / `takeStartRequests`), token file, constant-time compare |
| `src/remote-control-shared/runtimeInstaller.ts` | Installs versioned bundles + stable launchers + Python client (never downgrades `current.json`, keeps one previous version). Resolves the node command, generates per-client configs (`clientConfigs()`), and writes `connection.json` / `CONNECT.md` |
| `src/remote-control-shared/pythonClient.ts` | Source of `claui_client.py` (written by the installer) |
| `src/remote-control-shared/httpClient.ts` | Minimal JSON HTTP client (runtime, CLI, tests) |
| `src/extension/remote-control/RemoteControlTap.ts` | Process-wide in/out observation point used by the tab classes |
| `src/extension/remote-control/RemoteControlService.ts` | Modes (incl. legacy `enabled` migration), window record + heartbeat, start-request watcher, server start/stop, runtime install at activation, VS Code MCP provider, status bar item, setup quick pick, commands |
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
| `src/remote-control-runtime/mcpServer.ts` (+ `mcpServerMain.ts`) | stdio MCP server: concurrent requests, tool list (live catalog only from an already-serving window, never starts one), forwarding, progress heartbeats |
| `src/remote-control-runtime/instanceClient.ts` | Window selection, on-demand start (request file + wait for `serving`), authenticated liveness probe (`/api/status` must echo the `instanceId`), forwarding |
| `src/remote-control-runtime/localTools.ts` | `list_instances`, `select_instance`, `open_vscode_window` |
| `src/remote-control-runtime/client.ts` | Node.js client library (`connect()`, `call()`, `events()`) |
| `src/remote-control-runtime/setupCommands.ts` | CLI `install`, `mcp-config`, `register` (Claude Code via `claude mcp add-json`, cross-spawn), `doctor`, `connection` |
| `src/remote-control-runtime/cli.ts` | Command-line client |
| `scripts/generate-remote-control-catalog.js` | Regenerates the UI catalog (`npm run gen:remote-control-catalog`; `--check` fails when stale) |
| Edits in `SessionTab.ts`, `CodexSessionTab.ts` | tap calls, `dispatchRemoteMessage()`, `applyRemoteRename()`, `isWebviewReadyState`; the webview handler body lives in `handleIncomingWebviewMessage()` (unchanged behavior) |
| Edits in `MultiParticipantSessionTab.ts` | tap calls only (no remote dispatch for multi-participant tabs) |

Webpack target `remote-control-runtime` emits `dist/remote-control-runtime/mcp-server.js`, `cli.js` and `client.js`.

---

## On-disk layout (`~/.claui/remote-control/`)

| Path | Content |
|------|---------|
| `token` | 64-hex per-user secret, created on first activation (atomic write, mode 0600 where supported). Shared by all windows; every request re-reads it, so "Regenerate token" in any window revokes old clients everywhere |
| `instances/<instanceId>.json` | One per window running ClaUi: pid, `mode`, `serving`, port (0 until serving), workspace folders/name, version, access level, startedAt, heartbeatAt (rewritten every 30 s), lastFocusedAt (set when the window gains focus; drives "most recently focused" selection). Deleted on shutdown. Readers skip records whose heartbeat is older than 2 min (a window that died without cleanup, whose PID may be reused) and delete them after 15 min, or at once when the PID is dead |
| `requests/<instanceId>__<nonce>.json` | On-demand start requests from clients; consumed by the addressed window; stale ones (> 2 min) are deleted by any window |
| `bin/<version>/{mcp-server,cli,client}.js` | Runtime copied from the extension (hash-compared, atomic). Current + previous version kept |
| `bin/current.json` | `{ version, dir }` of the active runtime; an older ClaUi build never moves it backwards (read-compare-write under `bin/.install.lock`) |
| `bin/claui-mcp.js`, `bin/claui.js`, `bin/claui-client.js` | Stable launchers / library entry that load the runtime named in `current.json` (configs never change across updates) |
| `bin/claui_client.py` | Python client (stdlib only); the installer embeds the tool catalog so `tools()` needs no server |
| `connection.json` | Machine-readable connection manifest: stdio command/args/env, per-client configs (claude-code, claude-desktop, cursor, windsurf, codex, vscode, generic), CLI, libraries, HTTP routes |
| `CONNECT.md` | The same as a guide for agents and humans (also opened by "Open connection guide") |

Override the root with `CLAUI_REMOTE_CONTROL_HOME` (used by tests).

---

## Window selection (stdio runtime / CLI)

1. `select_instance` / `CLAUI_INSTANCE` / `--instance` (instanceId, workspace path, or workspace-name substring). An explicit preference never silently falls back to another window.
2. The window whose workspace folder contains the client's cwd (deepest match, directory-boundary aware, case-insensitive on Windows).
3. The most recently focused window.

Windows in mode `off` are skipped unless chosen explicitly (then a clear
"turned off" error). A selected window that is not serving is asked to start
(mode `auto`; up to 20 s; a window that closes meanwhile fails at once). A
window is used only after an authenticated `GET /api/status` answers with the
same `instanceId` (protects against stale records and PID reuse).

Fallback: only a window picked by recency (rule 3) falls back to the next most
recently focused window when it does not answer. A window chosen explicitly or
by working-directory match is never silently swapped for another project's
window; the call fails with a clear error instead.

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
| On-demand start | In mode `auto` any process of the same OS user can make a window start serving (by writing a request file in the user's home), the same trust boundary as the token file. Until then no port is open. `off` disables it per window or globally |
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
| `claudeMirror.remoteControl.mode` | `"auto"` | `auto`: no port until a local client asks, then the window serves until it closes. `on`: serve from startup. `off`: never serve (the record still exists with `mode: off`, so clients get a clear error; the VS Code MCP registration is withdrawn) |
| `claudeMirror.remoteControl.port` | `0` | Fixed port, 0 = automatic. A busy fixed port falls back to a random one (logged) |
| `claudeMirror.remoteControl.accessLevel` | `"full"` | `full` or `readOnly` |
| `claudeMirror.remoteControl.allowSensitiveActions` | `false` | Allow the sensitive classes listed above |

Legacy: 0.1.244 used a boolean `claudeMirror.remoteControl.enabled`. When `mode`
is not set explicitly, `enabled: true` counts as `on` and an explicit
`enabled: false` as `off` (`RemoteControlService.effectiveMode`).

## Commands

| Command | Purpose |
|---------|---------|
| `ClaUi: Remote Control (MCP) Setup` (`claudeMirror.remoteControl.setup`) | Quick pick: mode, start serving now, register with Claude Code, copy configs (Claude Code command, `mcpServers` JSON, Codex TOML, HTTP endpoint + token), access level, sensitive actions, regenerate token, connection guide. Also the status-bar `MCP` item (shown while serving) |
| `ClaUi: Remote Control (MCP): Always On` / `Turn Off` | Set `mode` to `on` / `off` |
| `ClaUi: Register Remote Control with Claude Code` | `claude mcp add-json -s user claui {...}` via `McpCliService` (execFile, no shell); replaces an existing entry |
| `ClaUi: Copy Remote Control MCP Config` | `mcpServers` JSON |
| `ClaUi: Regenerate Remote Control Token` | New token for every window |
| `ClaUi: Remote Control Connection Guide` | Opens `~/.claui/remote-control/CONNECT.md` |

CLI setup commands (no VS Code UI needed):

| Command | Purpose |
|---------|---------|
| `claui.js install` | From the extension folder: install launchers + clients + manifest (VS Code does this on every activation) |
| `claui.js mcp-config [--client claude-code\|claude-desktop\|cursor\|windsurf\|codex\|vscode\|generic]` | Print ready-to-paste configs |
| `claui.js register [--scope user\|project\|local] [--claude PATH]` | Add the server to Claude Code (`claude mcp add-json`, cross-spawn safe for `.cmd` shims). Adds first; an existing `claui` entry is replaced only when the add reports it already exists |
| `claui.js doctor [--json]` | Checks runtime, launcher, token, node, windows (mode / serving), connection (starts on demand), Claude Code registration |
| `claui.js connection` | Print `connection.json` |

Generated stdio config: `command` = absolute `node` path when Node is on PATH,
otherwise VS Code's own Electron binary with `ELECTRON_RUN_AS_NODE=1`; `args` =
`[~/.claui/remote-control/bin/claui-mcp.js]`.

---

## Usage examples

Claude Code:

```
node ~/.claui/remote-control/bin/claui.js register
# or: claude mcp add --scope user claui -- node "C:\Users\<you>\.claui\remote-control\bin\claui-mcp.js"
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

Node.js:

```js
const claui = require(require('os').homedir() + '/.claui/remote-control/bin/claui-client.js').connect();
const tab = await claui.call('create_tab', { provider: 'claude', prompt: 'List the TODOs in this repo' });
console.log(tab.status, tab.response);
for await (const event of claui.events({ types: ['turnComplete'] })) console.log(event.tabId);
```

Python:

```python
import os, sys
sys.path.insert(0, os.path.join(os.path.expanduser("~"), ".claui", "remote-control", "bin"))
from claui_client import ClauiClient
claui = ClauiClient()
tab = claui.call("create_tab", provider="claude", prompt="List the TODOs in this repo")
print(tab["status"], tab["response"])
```

---

## Tests

`npm run test:remote-control` (also checks the UI catalog is up to date):

- `tests/remote-control/catalogAndPolicy.test.ts` - catalog integrity, handler coverage, allowlist completeness (every UI action classified once), validator, schedule parsing
- `tests/remote-control/coreState.test.ts` - event log, compaction, formatting, tracker, turn waiter states, aborted callers
- `tests/remote-control/httpServer.test.ts` - auth, Origin/Host/URL-token refusals, REST + MCP over HTTP, events, SSE (incl. slow-client disconnect), port fallback
- `tests/remote-control/runtime.test.ts` - registry, selection, token, start requests, a simulated `auto` window started on demand by the real stdio MCP server, CLI (incl. mode-off error, `mcp-config`), runtime installer (launchers, no downgrade, pruning, manifest), client-config escaping, stale heartbeats, recency-only fallback, Node client library, Python client (skipped without Python)

Live smoke test against a real window (manual; runs real Haiku turns, saves and restores the global model / effort / permission / fast-mode defaults it touches):

```
node --import tsx tests/remote-control/liveSmoke.ts [--instance <id|workspace>] [--with-question] [--keep-tab]
```

To run it without touching your main window, open a scratch folder in an
Extension Development Host (`code --extensionDevelopmentPath=<repo> --new-window <folder>`);
the default `auto` mode needs no settings. Close that window by its exact
title (WM_CLOSE to the top-level window), not with `CloseMainWindow()` on a
`Code.exe` process: the main process owns every VS Code window.

## Limitations

- Multi-participant tabs are observable (events, list) but not remotely drivable.
- `permissionMode`, `effortLevel` and `fastMode` are global ClaUi settings; changing them from one tab applies to sessions started afterwards in all tabs (same as the UI). `set_model` also updates the default model for new tabs (same as the picker).
- `execute_command` for commands that open pickers waits up to 120 s for the user, then returns `still_running`.
- Events are buffered in memory per window (last 3000); `get_events` reports when `sinceSeq` is older than the buffer.
- VS Code must be running: the server lives in the extension host. `open_vscode_window` needs the `code` command on PATH (or `CLAUI_CODE_CLI`).
- The native VS Code registration needs VS Code 1.101+ (older versions skip it; external clients are unaffected).
- A window whose extension host is killed without shutdown leaves its record until a reader notices the dead PID.

Related: `MCP_SUPPORT.md` (managing MCP servers *used by* Claude sessions - the opposite direction), `ARCHITECTURE.md`.
