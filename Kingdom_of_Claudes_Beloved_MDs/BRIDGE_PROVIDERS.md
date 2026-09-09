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
- `bridge:council` or `bridge:council/<chair>` (the model council — see below)

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
- `src/bridge-runtime/config.ts` - reads `~/.claui/bridge.json`, `parseBridgeModel()`
  (a discriminated union: grok/antigravity/openai carry a model; `council` carries only an
  optional chair), API-key resolution (`apiKey` / `apiKeyEnv` / `apiKeyFile`), and the
  `council` config (`members` / `chair` / `timeoutMs`).
- `src/bridge-runtime/sessionStore.ts` - durable per-tab state keyed by the ClaUi session
  UUID (grok ACP session id, antigravity conversation id, or OpenAI chat history). Writes
  are atomic with a retry + in-place fallback (a rename over an existing file can
  transiently fail on Windows). History is bounded to 200 turns. Session ids are
  basename-guarded.
- `src/bridge-runtime/procUtils.ts` - `resolveExecutable()` (always shell-free, so a
  prompt is never shell-interpreted), `whichSync()`, `spawnCli()` (cross-spawn wrapper that
  can launch Windows `.cmd`/`.bat` shims without a shell), `killTree()` (blocking Windows
  `taskkill /F /T`), and `killTreeAsync()` (non-blocking taskkill, used by the council so an
  interrupt returns immediately).
- `src/bridge-runtime/fileLock.ts` - `acquireLock()`, a stale-tolerant cross-process
  mutex via atomic directory creation.
- `src/bridge-runtime/backends/grokAcp.ts` - Grok over the official CLI's ACP surface
  (`grok agent stdio`). Streams text/thinking, translates tool calls to Claude-style
  `tool_use`/`tool_result`. Also exports `runGrokCouncilPrompt()` - a throwaway, text-only
  (no-tools, reject-every-permission) session used by the council.
- `src/bridge-runtime/backends/council.ts` - the model council backend (see the Council
  section below).
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

## Model council

Selecting **Council · all models** (`bridge:council`, or `bridge:council/<chair>`) turns a
tab into a council. Each user turn fans out in parallel to several engine "members"; each
independent opinion is streamed as an assistant text section (`### <member-id> - OK/failed`)
in completion order; then a selectable **chair** synthesizes a single ruling. Everything is
plain streamed assistant text (no tool cards), so it lands as one assistant message and
exactly one result.

**Member grammar** (separator `/`): `claude[/<model>]`, `codex[/<model>]`, `grok[/<model>]`,
`openai/<providerId>/<model>` (the openai model may itself contain `/`; `<providerId>` must
match a configured `claudeMirror.bridge.openaiProviders` id). Default members when unset are
`codex, grok`. The roster is deduped by normalized id and capped at 6. Members are edited in
the UI via **Tools -> Council settings** (no need to hand-edit settings.json).

**Chair precedence**: an explicit `bridge:council/<chair>` value > `council.chair` setting >
first available member. A chair token that is not a roster member but is itself available is
used as an **external judge** (labelled). If the chair fails to synthesize, the council
falls back to the first successful member; if that also fails it presents the members'
individual opinions (never discarded).

**Failure/degraded handling**: fewer than 2 available members -> a diagnostic (with each
member's availability reason), no fan-out; 0 successes -> "no member produced an answer";
exactly 1 success -> that answer with a "degraded" note and no synthesis; >=2 -> chair
synthesis.

### Trust model (v1) - members cannot mutate anything

The council's members are non-mutating **by construction**:

- **openai** members: plain HTTP `/chat/completions` with NO `tools` param - structurally
  incapable of side effects.
- **codex** members: `codex exec --json --sandbox read-only --ephemeral --skip-git-repo-check -C
  <tmp>` (prompt on stdin) - read-only sandbox, run in a throwaway temp cwd. `--skip-git-repo-check`
  is required because the throwaway cwd is never a git repo (Codex otherwise refuses to run
  outside a trusted/git directory); this is safe here since read-only + throwaway cwd already
  make the turn non-mutating regardless of git/trust status.
- **grok** members: an ACP session in a throwaway temp cwd that rejects EVERY
  `session/request_permission` (text-only) - cannot run any tool.
- **claude** members: `claude -p --output-format json --restricted --permission-prompts none
  --strict-mcp-config --mcp-config '{"mcpServers":{}}'` (prompt on stdin) run in a throwaway
  temp cwd. `--restricted` removes the command/code-running tools (Bash) and confines file
  tools to the throwaway cwd; `--permission-prompts none` auto-denies anything that would
  prompt; the empty strict MCP config loads no MCP servers. It uses the user's existing Claude
  Code login (no `--bare`, so no API key is needed); because `--bare` is not used, the user's
  own settings/hooks may still load, but the flags above keep the turn non-mutating outside the
  throwaway cwd. Availability = the `claude` CLI is found (via `claudeMirror.cliPath` / PATH /
  known locations).

Every CLI member runs in a private throwaway temp directory (never full-access/bypass), and
the prompt is always passed as an argv element or stdin under `shell:false` (never
shell-interpolated). Temp dirs are removed only after the member's process has terminated
(force-kill escalation reaps a lingering child; the cwd is never deleted while a process is
still using it).

**The Antigravity local CLI is deferred to v2** and excluded from the v1 roster: its
no-mutation cannot be guaranteed without an OS-enforced sandbox. Its token still parses but
reports *unavailable* with a "deferred to v2" reason. To include GPT / Gemini / an external
Claude via the API instead of the local CLI, add them as OpenAI-compatible providers (the safe
HTTP no-tools path).

### Cost, timeouts, history

- **Cost is reported as 0** and cannot be computed: one council turn invokes several
  paid/subscription models. The convening header states this caveat in-chat.
- **Timeout**: `council.timeoutMs` (default 240000, clamped 15000-600000) applies per member
  and again for the chair; worst-case turn is about 2x that value.
- **History (v1)**: each council turn is independent (members receive only the current
  question + system prompt). The transcript is still persisted per session for resume, and a
  resumed council tab keeps its `council[/chair]` identity even before the first synthesis.

## Settings

- `claudeMirror.bridge.grok.enabled` / `.cliPath` / `.models`
- `claudeMirror.bridge.antigravity.enabled` / `.cliPath` / `.models`
- `claudeMirror.bridge.openaiProviders` - array of `{id, label, baseUrl, apiKeyEnv?,
  apiKeyFile?, apiKey?, models}`
- `claudeMirror.bridge.council.enabled` (default true) / `.members` (default `[]` = runtime
  defaults codex, grok) / `.chair` (default `''`) / `.timeoutMs` (default 240000)

All of the above are editable from the webview via **Tools -> Council settings** (the
`CouncilSettingsPanel`): toggle the picker entry, add/remove members (Claude Code / Codex /
Grok / any OpenAI-compatible provider), pick the chair, set the timeout, and manage OpenAI
providers with one-click presets for **GPT / Gemini / Claude API**. The panel reads via the
`getCouncilSettings` message and writes via `setCouncilSettings` (MessageHandler updates the
settings; `BridgeProviderService` re-syncs `~/.claui/bridge.json`). Per-engine availability
(claude / codex / grok installed?) comes from `BridgeProviderService.detectedEngines()`.

Grok and Antigravity are enabled by default but only appear when the matching CLI is
detected; otherwise the picker shows an "Install CLI..." entry that primes (never
auto-runs) the official install command. OpenAI-compatible providers are empty by default.
No secrets in settings: prefer `apiKeyEnv` / `apiKeyFile`; local servers need none. The
council entry appears whenever it is enabled and `node` is on PATH (it is NOT gated on CLI
detection - per-member availability is reported at runtime in-chat).

## Requirements & limitations

- The bundled runtime is a Node script and needs `node` on PATH. Engaging a bridge without
  `node` surfaces a clear error and reverts the picker.
- Usage/cost are reported as zero for bridge tabs (token/cost analytics do not apply).
- Antigravity has no streaming; long turns show a spinner until completion.
- Images are forwarded only to OpenAI-compatible vision models; Grok, Antigravity, and the
  council (text-only) get a visible note instead of a silent drop.
- The council is text-only, reports cost as 0 (a turn invokes several paid models), and in
  v1 treats each turn independently (members do not see prior turns).

## Tests

`tests/bridge/` (run with `npm run test:bridge`): model parsing and API-key resolution,
stdin/image parsing, session store (bounded history, atomic-write robustness, basename
guard), Grok supervised read-only decision, shell-free executable resolution, and an
end-to-end OpenAI SSE server test (streaming, non-streaming EOF flush, image pass-through,
HTTP error surfacing). `council.test.ts` covers `bridge:council[/chair]` parsing, member/
roster grammar (dedupe/cap/defaults), availability detection (absolute/known-location/PATH,
Windows `.cmd` shim, openai keyed/keyless/declared-empty), roster-ordered synthesis under
out-of-order completion, the 0/1/>=2-success paths, chair fallback chain, external judge,
image omit-note, interrupt/timeout (including a member that ignores the abort signal), the
temp-dir reaper (never deletes a live cwd), and the exact stream-json sequence (one result,
no tool_use).
