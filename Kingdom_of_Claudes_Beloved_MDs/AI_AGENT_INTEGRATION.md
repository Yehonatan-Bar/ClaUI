# Connect an AI agent to ClaUi (MCP)

ClaUi is a VS Code extension (Marketplace id `JhonBar.claude-code-mirror`) that gives Claude Code and Codex a
multi-tab chat UI. It ships its own **MCP server**, a **CLI** and **Node.js / Python client libraries**, so any AI
agent (Claude Code, Codex, Cursor, Claude Desktop, Windsurf, VS Code agents, or your own program) can control it:
open chat tabs, send prompts and read the replies, answer approvals, change models and settings, search history,
and follow everything that happens in the UI.

This guide ships inside the extension package. The same information, with this computer's real paths, is written
to `~/.claui/remote-control/CONNECT.md` (machine-readable: `connection.json`) when VS Code starts.

---

## The short answer

1. Have VS Code open with ClaUi installed (version 0.1.245 or newer). Nothing has to be turned on: ClaUi installs
   the connection tools into `~/.claui/remote-control/` when VS Code starts, and each window starts its control
   server automatically on the first request from a local tool.
2. Connect your agent:

| Agent | What to do |
|-------|------------|
| Agent inside VS Code (e.g. Copilot agent mode) | Nothing. ClaUi registers its MCP server with VS Code automatically (see `MCP: List Servers`). |
| Claude Code | Run the `register` command below once, then start a **new** Claude Code session. |
| Codex CLI | Run `mcp-config --client codex` below and add the printed block to `~/.codex/config.toml`. |
| Cursor / Claude Desktop / Windsurf / any MCP client | Run `mcp-config --client <name>` below and paste the printed JSON into the file it names. |
| Your own program | Use the Node.js or Python client library, the CLI, or the local HTTP API (see below). |

Register with Claude Code:

```powershell
# Windows PowerShell
node "$env:USERPROFILE\.claui\remote-control\bin\claui.js" register
```

```bat
:: Windows cmd
node "%USERPROFILE%\.claui\remote-control\bin\claui.js" register
```

```bash
# macOS / Linux
node ~/.claui/remote-control/bin/claui.js register
```

Print the configuration for another client (`codex`, `cursor`, `claude-desktop`, `windsurf`, `vscode`, `generic`):

```powershell
node "$env:USERPROFILE\.claui\remote-control\bin\claui.js" mcp-config --client codex
```

Check every step of the connection:

```powershell
node "$env:USERPROFILE\.claui\remote-control\bin\claui.js" doctor
```

After connecting, just ask the agent in plain language, for example "open a new ClaUi tab and ask it to run the
tests" or "what is the ClaUi tab named Refactor doing?".

---

## Details per agent

### Agents running inside VS Code

ClaUi contributes an MCP server definition provider (`claui.remoteControl`, VS Code 1.101+). Agents that use
VS Code's MCP registry see a server named **ClaUi** with no configuration. It is pinned to the window it was
registered in. VS Code may ask once to trust or start it.

### Claude Code

- `claui.js register` runs `claude mcp add-json -s user claui {...}` for you (options: `--scope user|project|local`,
  `--claude <path to claude>` when `claude` is not on PATH).
- Manual alternative (the exact line for your machine is in `~/.claui/remote-control/CONNECT.md`):
  `claude mcp add --scope user claui -- "<node>" "<home>/.claui/remote-control/bin/claui-mcp.js"`
- Already running sessions do not see new MCP servers: start a new session, then check with `/mcp` or
  `claude mcp list`.
- With user scope, Claude sessions running inside ClaUi tabs get the tools too (they can open tabs and delegate work).
- Remove: `claude mcp remove -s user claui`.

### Codex CLI

`claui.js mcp-config --client codex` prints a block like:

```toml
[mcp_servers.claui]
command = "C:\\Program Files\\nodejs\\node.exe"
args = ["C:\\Users\\<you>\\.claui\\remote-control\\bin\\claui-mcp.js"]
```

Add it to `~/.codex/config.toml` and start a new Codex session.

### Cursor, Claude Desktop, Windsurf, Cline, other MCP clients

The server is a **stdio** MCP server: command `node`, argument `~/.claui/remote-control/bin/claui-mcp.js`.
`claui.js mcp-config --client cursor` (or `claude-desktop`, `windsurf`, `generic`) prints the `mcpServers` JSON and
the config file location:

```json
{
  "mcpServers": {
    "claui": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\Users\\<you>\\.claui\\remote-control\\bin\\claui-mcp.js"]
    }
  }
}
```

The launcher path never changes when ClaUi updates. If Node.js is not installed, the printed config uses VS Code's
own executable with `ELECTRON_RUN_AS_NODE=1` instead.

### Your own program or script

Node.js:

```js
const path = require('path');
const os = require('os');
const claui = require(path.join(os.homedir(), '.claui', 'remote-control', 'bin', 'claui-client.js')).connect();
const tab = await claui.call('create_tab', { provider: 'claude', prompt: 'List the TODOs in this repo' });
console.log(tab.status, tab.response);
```

Python (3.8+, standard library only):

```python
import os, sys
sys.path.insert(0, os.path.join(os.path.expanduser("~"), ".claui", "remote-control", "bin"))
from claui_client import ClauiClient
claui = ClauiClient()
tab = claui.call("create_tab", provider="claude", prompt="List the TODOs in this repo")
print(tab["status"], tab["response"])
```

Shell (exit codes: 0 ok, 1 error, 2 waiting for an approval, 3 timeout, 4 no ClaUi window):

```bash
node ~/.claui/remote-control/bin/claui.js tabs
node ~/.claui/remote-control/bin/claui.js send "Run the tests and summarize the failures" --tab 1
node ~/.claui/remote-control/bin/claui.js call get_status
node ~/.claui/remote-control/bin/claui.js help
```

Raw HTTP (any language): each VS Code window has a record in `~/.claui/remote-control/instances/` with its port.
Send `Authorization: Bearer <contents of ~/.claui/remote-control/token>` to `http://127.0.0.1:<port>`:
`POST /mcp` (MCP Streamable HTTP), `GET /api/tools`, `POST /api/tools/<tool>` with a JSON arguments body,
`GET /api/events?since=<seq>&wait=<seconds>`, `GET /api/events/stream` (SSE). If the record says `"serving": false`,
first write any file named `<instanceId>__<anything>.json` into `~/.claui/remote-control/requests/` and wait until
the record says `"serving": true` (the bundled clients do this for you).

---

## What the agent can do (47 tools)

| Area | Tools |
|------|-------|
| Status | `get_status`, `list_tabs`, `get_tab`, `list_models` |
| Tabs | `create_tab` (provider, model, permission mode, effort, name, first prompt), `close_tab`, `focus_tab`, `rename_tab`, `resume_session`, `fork_session`, `hibernate_tab`, `wake_tab`, `stop_session`, `clear_session` |
| Conversation | `send_message` (waits for the reply and returns it, with tool calls, cost and status), `wait_for_idle`, `get_messages`, `get_last_response`, `cancel_response`, `compact_context`, `schedule_message`, `cancel_scheduled_message` |
| Approvals | `list_pending_approvals`, `respond_to_approval` (plans, permissions), `answer_question` (AskUserQuestion) |
| Per-tab settings | `set_model`, `set_permission_mode`, `set_effort`, `set_fast_mode`, `switch_provider` (Claude <-> Codex with context) |
| History | `list_sessions`, `search_conversations` |
| Folders | `list_groups`, `create_group`, `move_tab_to_group`, `delete_group` |
| Extension | `get_settings`, `update_setting`, `list_commands`, `execute_command`, `list_ui_actions`, `dispatch_ui_action` (every other UI feature), `get_events`, `show_notification` |
| Windows (MCP server only) | `list_instances`, `select_instance`, `open_vscode_window` |

Start with `get_status` or `list_tabs`. `send_message` behaves exactly like typing in the chat: the prompt appears in
the ClaUi tab as a normal message. A result with `"status": "awaiting_approval"` means the tab waits for a plan /
question / permission answer (`respond_to_approval` or `answer_question`). `tabId` accepts an id (`tab-3`), the tab
number (`3`), or the tab's exact name; omit it to use the active tab.

## Which VS Code window is controlled

1. The window chosen with `select_instance`, the `CLAUI_INSTANCE` environment variable or `--instance` (instance id,
   folder path or workspace name).
2. Otherwise the window whose open folder contains the agent's working directory.
3. Otherwise the most recently focused window.

`list_instances` shows all windows. Windows with Remote Control turned off are skipped.

## Settings and safety

- `claudeMirror.remoteControl.mode`: `auto` (default; starts when a local tool connects), `on` (from startup),
  `off` (never).
- `claudeMirror.remoteControl.accessLevel`: `full` (default) or `readOnly` (agents can only read).
- `claudeMirror.remoteControl.allowSensitiveActions` (default off): credentials, git push / worktrees, security
  policy, files / URLs and external sends stay blocked for agents unless this is on.
- The server listens on `127.0.0.1` only, every request needs the per-user token, and browser requests are refused.
  Anyone who can read the token (processes of the same OS user) can run prompts as that user.
- `ClaUi: Remote Control (MCP) Setup` (Command Palette, or the `MCP` item in the status bar while an agent is
  connected) has every option: mode, read-only, register with Claude Code, copy configs, regenerate the token,
  open the connection guide.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `~/.claui/remote-control/bin` does not exist | Open VS Code once after installing ClaUi. Or install from the extension folder: `node ~/.vscode/extensions/jhonbar.claude-code-mirror-<version>/dist/remote-control-runtime/cli.js install` |
| `no_instance: VS Code with the ClaUi extension is not running` | Open VS Code (the server lives in the VS Code window). The MCP tool `open_vscode_window` can open a folder. |
| `Remote Control is turned off` | Set `claudeMirror.remoteControl.mode` to `auto` or `on`. |
| Claude Code does not show the `claui` tools | Start a new session after `register`; check `/mcp`; run `claui.js doctor`. |
| `node` is not recognized | Install Node.js, or use the config printed by `mcp-config` (it falls back to VS Code's own executable). |
| The wrong window is controlled | Run the agent from the project's folder, or set `CLAUI_INSTANCE=<folder or name>`, or call `select_instance`. |
| `read_only_mode` / `forbidden` errors | `accessLevel` is `readOnly`, or the action is sensitive (`allowSensitiveActions`). |

## Files ClaUi creates

| Path | Purpose |
|------|---------|
| `~/.claui/remote-control/CONNECT.md`, `connection.json` | This guide with the machine's real paths and ready-to-paste configs |
| `~/.claui/remote-control/bin/claui-mcp.js` | stdio MCP server launcher (stable path) |
| `~/.claui/remote-control/bin/claui.js` | CLI (`help`, `register`, `mcp-config`, `doctor`, `tabs`, `send`, `call`, ...) |
| `~/.claui/remote-control/bin/claui-client.js`, `claui_client.py` | Node.js and Python client libraries |
| `~/.claui/remote-control/token` | Per-user secret required by every request |
| `~/.claui/remote-control/instances/` | One record per open VS Code window running ClaUi |

More: the extension README section "For AI agents and automation", and the project repository
https://github.com/Yehonatan-Bar/ClaUI.
