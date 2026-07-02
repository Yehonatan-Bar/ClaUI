# Claude Model Controls (Model, Thinking Effort, Fast Mode)

Snapshot: 2026-07-02. Model lineup: Fable 5, Opus 4.8/4.7/4.6, Sonnet 5/4.6/4.5,
Haiku 4.5 are selectable; Mythos 5 is marked blocked.

This document covers the three Claude-side controls exposed in the AI chip's
model area:

1. **Model selection** (including Fable 5)
2. **Thinking effort level** (`--effort`)
3. **Fast mode** (`--settings` overlay)

All three are Claude-only: they are hidden in Codex tabs (`AIChip` gates them on
`!isCodexUi`, where `isCodexUi = provider === 'codex' || !providerCapabilities.supportsPermissionModeSelector`).
Codex has its own parallel controls (`CodexModelSelector`,
`CodexReasoningEffortSelector`, `CodexServiceTierSelector`).

A key behavioral distinction:

| Control | Applies | Mechanism |
|---------|---------|-----------|
| Model | Immediately (live switch of the running session) | `SessionTab.switchModel()` -> stop + restart/resume with `--model` |
| Effort | Next session start | persisted to config, read by `ClaudeProcessManager.start()` |
| Fast mode | Next session start | persisted to config, read by `ClaudeProcessManager.start()` |

---

## Shared architecture

All three controls follow the same dual-process contract:

```
Webview select  -->  store action (optimistic)  -->  postToExtension(request)
                                                          |
                                                          v
                                  MessageHandler case  -->  vscode config update
                                                          |
config change / 'ready'  -->  MessageHandler send method  -->  postMessage(setting)
                                                          |
                                                          v
                              useClaudeStream switch case  -->  store action  -->  UI reflects
```

The store is updated **optimistically** on selection (so the UI reflects the
choice instantly) and is **also** the sink for the authoritative setting message
that the extension echoes back on `ready` and on config change. This two-way
sync keeps the webview consistent across reloads and external `settings.json`
edits.

Relevant shared files:

- `src/extension/types/webview-messages.ts` — message contract (two unions:
  `WebviewToExtensionMessage`, `ExtensionToWebviewMessage`)
- `src/webview/state/store.ts` — Zustand store (`selected*` fields + `setSelected*` actions)
- `src/webview/hooks/useClaudeStream.ts` — dispatches incoming setting messages to the store
- `src/extension/webview/MessageHandler.ts` — request handlers, send methods, config watch
- `src/extension/process/ClaudeProcessManager.ts` — assembles CLI args and spawns the process
- `src/webview/components/StatusBar/AIChip.tsx` — hosts all selectors in the dropdown

---

## 1. Model selection (including Fable 5)

### User surface

The `Model` dropdown (`ModelSelector.tsx`) lives at the top of the AI chip
dropdown for Claude tabs. When connected, the currently active runtime model
label is shown next to the dropdown and as its tooltip (`Active: <label>`).

**Default-resolution hint.** Because the `Default` option passes no `--model`
flag and lets the CLI choose (see "CLI argument" below), `ModelSelector`
surfaces which model `Default` actually resolved to. This only applies when
`Default` is the active selection (`!selectedModel`) — with a specific model
chosen, the CLI-reported `model` merely echoes that explicit choice, so it would
not describe the default.

The hint resolves from two sources, in priority order:

1. **Live** (`liveDefaultLabel`): this session's own CLI-reported runtime model
   (`model` via `getClaudeModelLabel()`), available only once connected.
2. **Remembered** (`rememberedDefaultLabel`): the model the CLI resolved
   `Default` to **last time**, pushed from the extension's `globalState`
   (`lastResolvedDefaultModel` store field). Used as a fallback before the live
   value is known.

**Why a remembered fallback is needed.** The CLI's `system/init` event — the
only event that reports the resolved model — does **not** fire until the user
sends the **first message** of a session (verified in the process logs: a tab
can sit spawned-but-idle for minutes with no `init`). So on a freshly opened
`Default` tab the live model is unknown, and without the fallback the selector
could not show "the model that will run" before the first turn. Remembering the
last resolution lets it display the likely model immediately.

When `Default` is selected, `resolvedDefaultLabel = liveDefaultLabel ??
rememberedDefaultLabel` drives:

- **Tooltip** (`data-tooltip` on the `<select>`):
  - live known: `Default: Claude CLI is running <label>`
  - remembered only: `Default: Claude CLI will run <label> (confirmed once the session starts)`
  - neither: `Default: Claude CLI picks the model (resolved once the session starts)`
- **Inline option label:** the `Default` option text becomes `Default (<label>)`
  (e.g. `Default (Opus 4.6)`) so the resolved/likely model is visible in the open
  dropdown, where native `<option>` elements cannot render the CSS `data-tooltip`.

**Persistence + push.** When a session spawned with no `--model` reaches its
`system/init` (so `event.model` *is* the default resolution), `MessageHandler`
guards on `!processManager.configuredModel` (and rejects `unknown` / `connected`
placeholders), persists `event.model` to `globalState` key
`claui.lastResolvedDefaultModel`, and pushes a `defaultModelHint` message. The
same value is re-sent to every webview from the `ready` handler
(`sendDefaultModelHint`), so new tabs get it before their first turn.

### Options

Defined once in `src/webview/utils/claudeModelDisplay.ts` (`CLAUDE_MODEL_OPTIONS`)
and mirrored in the `claudeMirror.model` enum in `package.json`:

| Label | Model id (`--model` value) |
|-------|----------------------------|
| Mythos 5 (Blocked) | `claude-mythos-5` |
| Default | `""` (CLI default) |
| Fable 5 | `claude-fable-5` |
| Opus 4.8 | `claude-opus-4-8` |
| Opus 4.7 | `claude-opus-4-7` |
| Sonnet 5 | `claude-sonnet-5` |
| Sonnet 4.6 | `claude-sonnet-4-6` |
| Sonnet 4.5 | `claude-sonnet-4-5-20250929` |
| Opus 4.6 | `claude-opus-4-6` |
| Haiku 4.5 | `claude-haiku-4-5-20251001` |

If `selectedModel` is a value not present in the list (e.g. a model id typed
directly into `settings.json`), `ModelSelector` appends a synthetic
`Custom (<label>)` option so the dropdown can display the current selection.

Mythos 5 (`claude-mythos-5`) is listed first (at the top of the dropdown, above
`Default`). It is a specialized/preview model — it has no entry in the CLI's
general model/pricing table and ships a `claude-mythos-preview` variant, so it is
surfaced for selection but is not a general-availability lineup model. Fable 5
(alias `fable`, full id `claude-fable-5`) follows after `Default`. It is a
general-availability model — Anthropic's most capable — with a 1M-token context
window, so its label carries no `(Blocked)` marker.

**Context windows are not uniform.** `getModelMaxContext()` in
`src/webview/utils/modelContextLimits.ts` returns `1_000_000` for the 1M-context
models — Fable 5, Opus 4.6/4.7/4.8, Sonnet 4.6, and Sonnet 5 — and `200_000` for
everything else (Sonnet 4.5, Haiku 4.5, Mythos 5, and older Claude models), so the
context-usage gauge scales correctly. `inferClaudeModelLabel()` also treats
`fable` and `mythos` as known families.

Sonnet 5 (alias `claude-sonnet-5`, dated id `claude-sonnet-5-20260630`) is
Anthropic's most agentic Sonnet — near-Opus quality at Sonnet-tier cost, with a
1M-token context window. Its dated id resolves to the `Sonnet 5` label via the
`value-<suffix>` prefix match in `getClaudeModelLabel()`.

### Message flow

- Webview request: `setModel` (`{ type, model }`)
- Extension echo: `modelSetting` (`{ type, model }`)
- Store state: `selectedModel: string`
- Store action: `setSelectedModel`
- UI component: `ModelSelector`

### Live switching

`MessageHandler` handles `setModel` by (a) persisting `claudeMirror.model` and
(b) calling `this.webview.switchModel(model)` if available. `SessionTab.switchModel()`
distinguishes two cases:

- **At session start** (`messageHandler.isAtSessionStart`, no messages sent yet):
  stop the process and start a **fresh** session with `{ model }` — no resume —
  so the session is clean and uses the new model from the first turn.
- **Mid-session** (an active `currentSessionId` exists): stop and **resume**
  with `{ resume: sessionId, model }`, preserving the conversation.

In both branches `suppressNextExit` is set and `processBusy` is toggled around
the restart. Because `ClaudeProcessManager.start()` falls back to config for
effort and fast mode (see below), a model switch also picks up the current
effort/fast-mode configuration.

### CLI argument

`ClaudeProcessManager.start()` resolves:

```ts
const rawModel = options?.model || config.get('model', '');
const selectedModel = rawModel && !rawModel.includes('(') ? rawModel : '';
if (selectedModel) args.push('--model', selectedModel);
```

The `!rawModel.includes('(')` guard skips display-only labels such as
`Codex (default)` that are not real model ids.

### Display label resolution

`claudeModelDisplay.ts` exposes:

- `getClaudeModelLabel(model)` — exact match against `CLAUDE_MODEL_OPTIONS`
  (also matches `value-<suffix>` prefixes), then falls back to
  `inferClaudeModelLabel()`, which parses ids like `claude-opus-4-7` into
  `Opus 4.7` generically (so future ids such as `claude-opus-4-8` render
  correctly even without a table entry). Pass-through values `connected` /
  `unknown` are returned verbatim.
- `getClaudeModelCompactLabel(model)` — the same label, stripped of any
  `claude-` prefix and `-YYYYMMDD` date suffix for compact chip rendering.

### Immediate-display behavior (selected vs. active model)

The AI chip shows the model the user **selected** as soon as they pick it,
rather than waiting for the CLI to report it on the next turn:

```ts
const displayModel = selectedModel || model; // selectedModel = user choice, model = CLI-reported
const modelDisplayName = getClaudeModelLabel(displayModel);
const shortModelName = getClaudeModelCompactLabel(displayModel);
```

`selectedModel` is the optimistic store value set on selection; `model` is the
runtime model reported by the CLI via `sessionStarted` / `messageStart`. Using
`selectedModel || model` makes the chip reflect a model change instantly.

---

## 2. Thinking effort levels

### User surface

The `Effort` dropdown (`ClaudeEffortSelector.tsx`) sits directly below the model
dropdown in the AI chip. Tooltip: "Claude thinking effort level (applies on next
session start)".

### Levels

`ClaudeEffortLevel = '' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'`.

| Label | `--effort` value | Notes |
|-------|------------------|-------|
| Default | `""` | model default (High for Opus 4.8); no flag passed |
| Low | `low` | efficient, minimal token usage |
| Medium | `medium` | balanced cost/quality |
| High | `high` | default for Opus 4.8 |
| Extra High | `xhigh` | recommended for coding tasks |
| Max | `max` | maximum capability, highest token usage |

### Setting

- `claudeMirror.effortLevel`
- Type: `string` (enum above)
- Default: `""`

### Message flow

- Webview request: `setClaudeEffort` (`{ type, effort }`)
- Extension echo: `claudeEffortSetting` (`{ type, effort }`)
- Store state: `selectedClaudeEffort: ClaudeEffortLevel`
- Store action: `setSelectedClaudeEffort`
- UI component: `ClaudeEffortSelector`

### Runtime

`ClaudeProcessManager.start()`:

```ts
const effortLevel = options?.effortLevel || config.get('effortLevel', '');
if (effortLevel) args.push('--effort', effortLevel);
```

The `--effort` flag exists on the installed Claude CLI (verified on v2.1.152+).
Effort is **not** passed as a per-call option by any current caller, so it is
always sourced from config and therefore applies on the next session start
(including the fresh restart performed by a model switch).

### Per-message effort badge (chat display)

Each assistant message can render a small badge next to its header showing the
thinking effort that was actually used for that turn (e.g. `Opus 4.8` + `high`).
The badge label must reflect the real selected level, including `xhigh` / `max`,
rather than a hardcoded default.

`MessageHandler` tracks two fields for this:

| Field | Scope | Source |
|-------|-------|--------|
| `currentThinkingEffort` | per message (reset on every `messageStart`) | explicit per-message signal, else session effort |
| `sessionThinkingEffort` | per session (persists across messages) | CLI `system/init` `thinking_effort`, else configured `claudeMirror.effortLevel` |

Resolution logic:

- On `system/init`: if the event carries `thinking_effort`, both fields are set
  to it. Otherwise `sessionThinkingEffort` is reset to the configured
  `effortLevel` (or `null`), so a new session never inherits a stale level.
- On `assistantMessage`: if the message contains `thinking` blocks but no
  explicit per-message effort was captured, the badge is labeled with
  `sessionThinkingEffort || 'high'` (the `'high'` is a last-resort fallback only
  when nothing else is known).
- On `thinkingDetected` (live streaming): the demux reports a generic `'high'`
  when it sees thinking blocks without a level; `MessageHandler` overrides it
  with `sessionThinkingEffort` when available before posting
  `thinkingEffortUpdate`.

The effort string flows to the webview as `thinkingEffort` on `assistantMessage`
(persisted badge) and as `thinkingEffortUpdate` (live badge). The webview applies
it verbatim as a dynamic CSS class, so any level renders without code changes:

- Persisted badge: `MessageBubble.tsx` -> `thinking-effort-badge thinking-effort-<level>`
- Live badge: `MessageList.tsx` -> adds `thinking-effort-live`
- Styles: `.thinking-effort-{low,medium,high,xhigh,max}` in `global.css` with
  escalating intensity (green -> yellow -> orange -> deep orange -> red); unknown
  values fall back to the neutral `.thinking-effort-badge` base style.

High-intensity animation for `xhigh` / `max` — two phases:

- **Live (streaming):** while the model is actively thinking, the **live** badge
  animates dramatically — `xhigh` crackles like an electric spark
  (`thinking-effort-spark`: pulsing box-shadow + text-shadow glow) and `max`
  surges like an energy blast (`thinking-effort-blast`: flowing red/orange
  gradient + strong glow). Scoped to the compound selectors
  `.thinking-effort-xhigh.thinking-effort-live` / `.thinking-effort-max.thinking-effort-live`
  (highest specificity, so they win over the base glow below while live).
- **Settled (completed):** once the turn ends and `thinking-effort-live` is
  removed, the badge falls back to its base rule, which carries a **slow, gentle
  glow** (`thinking-effort-glow-xhigh` 3.2s / `thinking-effort-glow-max` 2.8s — a
  soft box-shadow that rises and fades). So the badge "starts hot and calms
  down" rather than freezing or going fully static.

All four animations are disabled under `@media (prefers-reduced-motion: reduce)`
(the bold color remains). Lower levels (`low`/`medium`/`high`) have no persistent
glow and use only the generic `thinking-effort-pulse` opacity pulse while live.

### Note on `ultracode`

`ultracode` (Claude Code's xhigh + dynamic-workflow session mode) is a
session-only CLI mode and is intentionally **not** modeled as an effort level
here; only the persistent `--effort` levels above are surfaced.

---

## 3. Fast mode

### User surface

The `Speed` dropdown (`ClaudeFastModeSelector.tsx`) sits below the effort
dropdown in the AI chip. Options are `Default` and `Fast`. When `Fast` is
selected, a lightning indicator (the U+21AF glyph) appears in the AI chip beside
the model name (`.ai-chip-fast` in `global.css`). Tooltip: "Claude Fast mode
(~2.5x faster output on Opus, costs more; applies on next session start)".

Fast mode roughly 2.5x's output tokens/sec. It only has an effect on Opus models
(4.8/4.7/4.6); it is a no-op on Sonnet/Haiku and costs more on supported models.
The selector is intentionally **not** gated by the selected model (to avoid the
control popping in and out of the UI); the CLI decides whether fast mode applies.

### Setting

- `claudeMirror.fastMode`
- Type: `boolean`
- Default: `false`

### Message flow

- Webview request: `setClaudeFastMode` (`{ type, fastMode }`)
- Extension echo: `claudeFastModeSetting` (`{ type, fastMode }`)
- Store state: `selectedClaudeFastMode: boolean`
- Store action: `setSelectedClaudeFastMode`
- UI component: `ClaudeFastModeSelector`

### Runtime — settings overlay file

There is **no** dedicated `--fast` / `--speed` CLI flag, so fast mode is applied
through a minimal settings overlay passed via `--settings`.

`ClaudeProcessManager.start()`:

```ts
const fastMode = options?.fastMode ?? config.get('fastMode', false);
if (fastMode) {
  const settingsPath = this.writeFastModeSettingsFile();
  if (settingsPath) args.push('--settings', `"${settingsPath}"`);
}
```

`writeFastModeSettingsFile()` writes a minimal overlay into the extension's
global storage directory and returns its absolute path:

```
<globalStorageUri>/claude-fast-mode-settings.json   ->   {"fastMode":true}
```

(The directory is created with `fs.mkdirSync(dir, { recursive: true })`; write
failures are logged and degrade gracefully to "no fast mode".)

### Why a quoted file path, not a JSON string

The CLI is spawned with `shell: true` (see `ClaudeProcessManager` — required on
Windows so the `.cmd` shim resolves). Passing `--settings '{"fastMode":true}'`
as an inline JSON string is **mangled** by `cmd.exe`: the double quotes are
stripped, yielding `{fastMode:true}`, which is invalid JSON and rejected by the
CLI. A **quoted absolute path** (`--settings "<path>"`) survives the shell
intact, including paths containing spaces. This was determined empirically by
testing against the real Windows `cmd.exe` runtime.

Because the overlay only sets the `fastMode` key, the CLI merges it into the
standard settings hierarchy rather than replacing user/project settings.

Note: `options.fastMode` uses `??` (not `||`) so an explicit `false` from a
caller can override a truthy config value; absent the option, config decides.

---

## Combined CLI argument assembly

Within `ClaudeProcessManager.start()`, the model-related flags are appended in
this order (after permission-mode and system-prompt handling):

```
... --model <id> --effort <level> --settings "<fast-mode-overlay-path>" [--resume <id> [--fork-session]] ...
```

Each is conditional: `--model` only when a real id resolves, `--effort` only for
a non-empty level, `--settings` only when fast mode is enabled.

---

## Settings reference

| Setting | Type | Default | Effect |
|---------|------|---------|--------|
| `claudeMirror.model` | string (enum) | `""` | Model id for new sessions; also live-switches the active session |
| `claudeMirror.effortLevel` | string (enum) | `""` | Thinking effort -> `--effort`; applies on next session start |
| `claudeMirror.fastMode` | boolean | `false` | Fast mode -> `--settings` overlay; Opus only; applies on next session start |

---

## Message contract reference

| Direction | Type | Payload | Purpose |
|-----------|------|---------|---------|
| Webview -> Ext | `setModel` | `model: string` | persist model + live switch |
| Ext -> Webview | `modelSetting` | `model: string` | echo current model on ready/change |
| Ext -> Webview | `defaultModelHint` | `model: string` | last model the CLI resolved `Default` to (for the pre-turn hint); `""` if none known |
| Webview -> Ext | `setClaudeEffort` | `effort: ClaudeEffortLevel` | persist effort |
| Ext -> Webview | `claudeEffortSetting` | `effort: ClaudeEffortLevel` | echo current effort |
| Webview -> Ext | `setClaudeFastMode` | `fastMode: boolean` | persist fast mode |
| Ext -> Webview | `claudeFastModeSetting` | `fastMode: boolean` | echo current fast mode |

The extension sends all three setting messages in the `ready` handler
(`sendModelSetting`, `sendClaudeEffortSetting`, `sendClaudeFastModeSetting`) and
re-sends the relevant one from its `onDidChangeConfiguration` watch when
`claudeMirror.model` / `claudeMirror.effortLevel` / `claudeMirror.fastMode`
changes. The `ready` handler additionally sends `defaultModelHint`
(`sendDefaultModelHint`, sourced from `globalState`); it is pushed again from the
`system/init` handler whenever a `Default` session resolves its model.

---

## Files

- `package.json` — `claudeMirror.model`, `claudeMirror.effortLevel`, `claudeMirror.fastMode`
- `src/extension/types/webview-messages.ts` — `ClaudeEffortLevel`,
  `SetModelRequest`/`ModelSettingMessage`, `DefaultModelHintMessage`,
  `SetClaudeEffortRequest`/`ClaudeEffortSettingMessage`,
  `SetClaudeFastModeRequest`/`ClaudeFastModeSettingMessage` (+ union entries)
- `src/extension/webview/MessageHandler.ts` — `setModel`/`setClaudeEffort`/`setClaudeFastMode`
  cases, `sendModelSetting`/`sendClaudeEffortSetting`/`sendClaudeFastModeSetting`, `ready` + config watch;
  `sendDefaultModelHint` + `system/init` persistence of `claui.lastResolvedDefaultModel` to `globalState`;
  `currentThinkingEffort`/`sessionThinkingEffort` fields + badge-label resolution (init / assistantMessage / thinkingDetected handlers)
- `src/extension/process/ClaudeProcessManager.ts` — `ProcessStartOptions`
  (`model`, `effortLevel`, `fastMode`), `--model`/`--effort`/`--settings` assembly,
  `writeFastModeSettingsFile()`
- `src/extension/session/SessionTab.ts` — `switchModel()` live-switch logic
- `src/webview/state/store.ts` — `selectedModel`, `lastResolvedDefaultModel`,
  `selectedClaudeEffort`, `selectedClaudeFastMode`
  (+ `setSelectedModel`/`setLastResolvedDefaultModel`/other `setSelected*` actions)
- `src/webview/hooks/useClaudeStream.ts` — `modelSetting`/`defaultModelHint`/`claudeEffortSetting`/`claudeFastModeSetting` cases
- `src/webview/utils/claudeModelDisplay.ts` — `CLAUDE_MODEL_OPTIONS`, `getClaudeModelLabel`, `getClaudeModelCompactLabel`
- `src/webview/components/ModelSelector/ModelSelector.tsx`
- `src/webview/components/ModelSelector/ClaudeEffortSelector.tsx`
- `src/webview/components/ModelSelector/ClaudeFastModeSelector.tsx`
- `src/webview/components/StatusBar/AIChip.tsx` — hosts the selectors + `↯` indicator + immediate model display
- `src/webview/components/ChatView/MessageBubble.tsx` — per-message effort badge
- `src/webview/components/ChatView/MessageList.tsx` — live (streaming) effort badge
- `src/webview/styles/global.css` — `.ai-chip-fast` indicator style;
  `.thinking-effort-{badge,low,medium,high,xhigh,max,live}` badge styles

---

## Known limitations / constraints

- **Effort and fast mode apply on the next session start**, not mid-session.
  This is deliberate: switching mid-session would force a cache miss and (for
  fast mode) extra cost. Only model switches are live.
- **Fast mode is Opus-only** at the CLI level; selecting it on Sonnet/Haiku has
  no effect (and the UI does not block it).
- **Fast mode relies on `--settings` merge semantics.** If a future CLI version
  changes `--settings` to replace rather than merge, the overlay would need to
  include the full settings set.
- The fast-mode overlay file is shared across tabs (single path in global
  storage); it only ever contains `{"fastMode":true}`, so concurrent reads are safe.

## Impact on usage tracking

The two consumer usage features are largely insulated from these controls:

- The **usage-remaining widget** (`UsageWidget` / `UsageFetcher`) reads
  server-computed utilization from the Anthropic OAuth usage API, so model
  (incl. Opus 4.8), effort, and fast-mode cost are already baked into the
  percentages it shows — no client-side adjustment.
- The **Token Ratio dashboard** (`TokenUsageRatioTracker`) buckets per model
  category, so Opus 4.8 maps to `opus` automatically. Effort raises token volume
  but not the per-token-type weights. Fast mode's per-token price premium is not
  modeled in the weights; it surfaces as a lower `tokensPerPercent` (quota burns
  faster) via the server utilization signal.

> Detail: `Kingdom_of_Claudes_Beloved_MDs/ANALYTICS_DASHBOARD.md`
> (section "Interaction with Model, Effort, and Fast Mode")
