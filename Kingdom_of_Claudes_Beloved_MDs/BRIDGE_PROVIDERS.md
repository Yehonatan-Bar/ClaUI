# Bridge Providers

Drive non-Claude backends (xAI Grok, Google Antigravity, and any OpenAI-compatible
server) through ordinary ClaUi tabs. A bundled runtime impersonates the claude CLI's
`stream-json` protocol, so the whole webview pipeline (streaming text, thinking blocks,
tool chips, timeline) works unchanged against a different model behind it.

## Why it exists

Users bring their own subscription/CLI. Selecting a bridge model in the model picker
routes that tab to a non-Claude backend without a separate UI or a new tab class. Each
tab keeps its own conversation continuity per backend.

## How it integrates (the seam)

A bridge model reuses the same `cliPathOverride` seam as the Happy/remote provider: the
tab spawns the bundled bridge runtime instead of the claude CLI and restarts through the
normal `switchModel` path. The runtime speaks claude `stream-json` to the extension and
talks to the selected backend behind it.

Backend/model selection travels in the namespaced `--model` value:

- `bridge:grok/<model>`
- `bridge:antigravity/<model>`
- `bridge:openai/<providerId>/<model>`

Bridge values are **never** persisted to `claudeMirror.model`, so a new Claude tab can
never inherit a `bridge:*` value and hand it to the real claude CLI.

## Key files

**Runtime (Node CLI, bundled to `dist/bridge-runtime/cli.js`)**
- `src/bridge-runtime/cli.ts` - entry point; parses claude flags, selects the backend
  (explicit `--model` wins; a resumed session sticks to its stored backend), runs the
  turn loop.
- `src/bridge-runtime/protocol.ts` - claude `stream-json` emitter (`system/init`,
  `stream_event`, `assistant`, `result`) and stdin parser. `parseUserMessage()` extracts
  text + base64 images; `imagesOmittedNote()` produces the visible note for text-only
  backends.
- `src/bridge-runtime/config.ts` - reads `~/.claui/bridge.json`, `parseBridgeModel()`,
  API-key resolution (`apiKey` / `apiKeyEnv` / `apiKeyFile`).
- `src/bridge-runtime/sessionStore.ts` - durable per-tab state keyed by the ClaUi session
  UUID (grok ACP session id, antigravity conversation id, or OpenAI chat history). Writes
  are atomic with a retry + in-place fallback (a rename over an existing file can
  transiently fail on Windows). History is bounded to 200 turns. Session ids are
  basename-guarded.
- `src/bridge-runtime/procUtils.ts` - `resolveExecutable()` (always shell-free, so a
  prompt is never shell-interpreted), `whichSync()`, `killTree()` (Windows `taskkill /F /T`).
- `src/bridge-runtime/fileLock.ts` - `acquireLock()`, a stale-tolerant cross-process
  mutex via atomic directory creation.
- `src/bridge-runtime/backends/grokAcp.ts` - Grok over the official CLI's ACP surface
  (`grok agent stdio`). Streams text/thinking, translates tool calls to Claude-style
  `tool_use`/`tool_result`.
- `src/bridge-runtime/backends/antigravity.ts` - Antigravity via `agy` headless print
  mode. Discovers the new conversation id by diffing the brain dir under a lock.
- `src/bridge-runtime/backends/openaiCompat.ts` - direct HTTP + SSE to any
  `/v1/chat/completions` server; replays history per turn; forwards images to vision
  models as `image_url` parts.

**Extension side**
- `src/extension/bridge/BridgeProviderService.ts` - mirrors `claudeMirror.bridge.*` into
  `~/.claui/bridge.json`, detects installed CLIs (so backends only appear when runnable),
  builds model-picker options, guides CLI install, and checks for `node` on PATH.
- Integration touch points: `SessionTab.switchModel` (engage/release the bridge, enforce
  fresh session on provider-boundary crossings), `TabManager` (recompute the bridge
  command and restore the bridge selection on reload), `MessageHandler`
  (`sendBridgeModelOptions`, install-flow routing, live picker refresh on settings change).

## Permission model

The bridge mirrors ClaUi's own permission modes:

- **Full access** (`--permission-mode bypassPermissions`): backends run unattended. Grok
  auto-approves every tool permission; Antigravity runs with `--dangerously-skip-permissions`.
- **Supervised**: mirrors the real Claude CLI's read-only `--allowedTools` whitelist. Grok
  auto-approves only read-only tool kinds (`read`, `search`, `fetch`, `think`) and rejects
  execute/edit/delete/move (and any unknown kind). Antigravity keeps the `agy` CLI's own
  interactive permission gate (no `--dangerously-skip-permissions`).

### Security boundary (important)

ClaUi's guard hooks (Super Particle Accelerator secret-write guard, Workspace Access
Guard, secret protection) are `PreToolUse` hooks installed for the **claude** and
**codex** CLIs. Bridge backends execute their own tools with their own executors, so those
hooks do NOT apply to Grok or `agy`. Full-access bridge tabs run backend tools without
ClaUi's guardrails. This is inherent to driving a third-party CLI; supervised mode limits
Grok to read-only tools as the in-bridge safeguard.

## Session continuity and restore

- **Grok**: ACP session id, resumed via `session/load`; the model is applied via `modelId`
  at `session/new` and `session/set_model`. A hung turn times out; a crashed grok process
  is detected and the session is rebuilt rather than left hanging.
- **Antigravity**: conversation id discovered by diffing
  `~/.gemini/antigravity-cli/brain/` before/after the first turn, under a cross-process
  lock so concurrent tabs cannot bind the same id. No streaming (answer lands at turn end).
- **OpenAI-compatible**: the server is stateless; the bridge owns and replays chat history.

Provider-boundary switches (claude <-> bridge, or one bridge backend to another) always
start a fresh session. On window reload, the snapshot restores the bridge cliPathOverride
(recomputed from the current install) and the picker selection + in-memory backend key.

## Settings

- `claudeMirror.bridge.grok.enabled` / `.cliPath` / `.models`
- `claudeMirror.bridge.antigravity.enabled` / `.cliPath` / `.models`
- `claudeMirror.bridge.openaiProviders` - array of `{id, label, baseUrl, apiKeyEnv?,
  apiKeyFile?, apiKey?, models}`

Grok and Antigravity are enabled by default but only appear when the matching CLI is
detected; otherwise the picker shows an "Install CLI..." entry that primes (never
auto-runs) the official install command. OpenAI-compatible providers are empty by default.
No secrets in settings: prefer `apiKeyEnv` / `apiKeyFile`; local servers need none.

## Requirements & limitations

- The bundled runtime is a Node script and needs `node` on PATH. Engaging a bridge without
  `node` surfaces a clear error and reverts the picker.
- Usage/cost are reported as zero for bridge tabs (token/cost analytics do not apply).
- Antigravity has no streaming; long turns show a spinner until completion.
- Images are forwarded only to OpenAI-compatible vision models; Grok and Antigravity get a
  visible note instead of a silent drop.

## Tests

`tests/bridge/` (run with `npm run test:bridge`): model parsing and API-key resolution,
stdin/image parsing, session store (bounded history, atomic-write robustness, basename
guard), Grok supervised read-only decision, shell-free executable resolution, and an
end-to-end OpenAI SSE server test (streaming, non-streaming EOF flush, image pass-through,
HTTP error surfacing).
