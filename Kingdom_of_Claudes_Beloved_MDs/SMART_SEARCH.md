# Smart Search

A new tab kind in ClaUi that delegates "find a past session" to a real
Claude Code or Codex agent, spawned with a baked-in system prompt and a
read-only tool allow-list. The user types free-form questions; the agent
ripgreps over `~/.claude/projects/` and `~/.codex/sessions/`, reads the
most promising hits, and returns result cards with an "Open session"
button that opens the chosen session in a fresh ClaUi chat tab.

## Why

The pre-existing primitives only partially solve search:

| Primitive | Limitation |
|---|---|
| `ChatSearchService.searchProject` | Exact-string match, Claude only, single-shot. |
| `ChatSearchBar` | In-memory of the open session, not past sessions. |
| `SessionDiscovery.discoverAll` | Walks `~/.claude/projects/` only, no Codex. |
| `CodexConversationReader` | Single-session reader, no search. |

Smart Search is the union: agentic, cross-provider, conversational.

## How it's wired

1. **Entry point** — `StatusBar -> Tools` dropdown adds a "Smart Search"
   group with two header rows ("Smart Search - Claude" / "Smart Search -
   Codex") followed by model rows (Opus 4.7, Sonnet 4.6, Haiku 4.5; GPT-5.6
   Sol, GPT-5.6 Terra, GPT-5.6 Luna, GPT-5.5, GPT-5.3-Codex-Spark). Click
   dispatches `{ type: 'openSmartSearch', provider, model }` to the active
   tab's MessageHandler.

2. **Handler routing** — `MessageHandler.ts` and `CodexMessageHandler.ts`
   both forward `openSmartSearch` to the VS Code command
   `claudeMirror.smartSearch.open` so the active tab does not need to know
   about TabManager.

3. **Command** — `commands.ts` registers `claudeMirror.smartSearch.open`,
   which calls `tabManager.createSmartSearchTab({ provider, model })`.

4. **Tab creation** — `TabManager.createSmartSearchTab`:
   - calls `createTabForProvider(provider)` to allocate a regular
     `SessionTab` (Claude) or `CodexSessionTab` (Codex);
   - calls `tab.configureSearchMode({...})` with the SMART_SEARCH_PROMPT,
     a read-only allow-list (`Read`, `Glob`, `Grep`, plus `Bash` if the
     `claudeMirror.smartSearch.allowBash` setting is true), and `cwd=$HOME`;
   - calls `await tab.startSession({ cwd: $HOME, model: <picked> })`;
   - overrides the slot color to magenta (`#FF00C8`) so search tabs are
     visually obvious in the tab strip.

5. **Process spawn** — search-mode flags reach the CLIs:
   - `ClaudeProcessManager.start({ appendSystemPrompt, allowedTools, cwd })`
     emits `--append-system-prompt <text> --allowedTools "Read,Glob,Grep,Bash"`.
     The presence of `allowedTools` forces the read-only branch (skips
     `--permission-mode bypassPermissions`).
   - `CodexExecProcessManager.runTurn({ appendSystemPrompt, forceReadOnlySandbox })`
     emits `-c instructions=<toml-escaped-prompt>` and forces
     `--sandbox read-only` on every turn. The TOML basic-string escape
     (`\\`, `\"`, `\n`, `\r`, `\t`) is built by `toTomlBasicString` so the
     value is a single-line argument; Codex parses it as a TOML string and
     uses it as the session's system instructions. The user prompt is
     written to stdin unchanged — no transcript pollution.

6. **Webview routing** — `sessionStarted` events now carry `tabKind`. The
   webview store stores it; `App.tsx` does an early return into
   `<SmartSearchView/>` when `tabKind === 'search'`.

7. **Result cards** — the agent emits cards containing
   `[[OPEN_SESSION:<sessionId>:<provider>]]`. `MarkdownContent.tsx` runs
   a regex pass after DOMPurify to replace this token with
   `<span class="open-session-btn" data-session-id=... data-provider=...>`.
   A click delegate posts `{ type: 'openSessionFromSearch', sessionId,
   provider }`, which both handlers route to `claudeMirror.resumeSession`
   passing the explicit provider hint so sessions discovered on disk (not
   in `SessionStore`) still open with the correct provider.

8. **Snapshot persistence** — `OpenTabSnapshotEntry` carries `tabKind` and
   `searchModel`. `buildSnapshot` keeps search tabs even without a
   sessionId (Codex search tabs may not have a threadId before the first
   turn), and `restoreFromSnapshot` calls `configureSearchMode` +
   `startSession({ cwd: $HOME })` for those entries, never `resume` (per
   plan: clean re-init, no transcript replay).

## Key files

### Extension side

| File | Role |
|---|---|
| `src/extension/session/SmartSearchPrompt.ts` | Exports `buildSmartSearchPrompt({ bashAvailable })`. The Bash-available variant tells the agent to use ripgrep + `ls -t`; the no-Bash variant tells it to use the `Glob` and `Grep` tools instead. |
| `src/extension/session/TabManager.ts` | `createSmartSearchTab`, `SMART_SEARCH_COLOR`, restore branch. |
| `src/extension/session/SessionTab.ts` | `configureSearchMode`, `getTabKind`, search-mode argv flow. |
| `src/extension/session/CodexSessionTab.ts` | Mirror of the above for Codex. |
| `src/extension/session/OpenTabsSnapshot.ts` | `tabKind`, `searchModel` snapshot fields. |
| `src/extension/process/ClaudeProcessManager.ts` | `appendSystemPrompt` + `allowedTools` argv injection. |
| `src/extension/process/CodexExecProcessManager.ts` | `appendSystemPrompt` preamble + `forceReadOnlySandbox`. |
| `src/extension/webview/MessageHandler.ts` | `openSmartSearch` + `openSessionFromSearch` cases (Claude). |
| `src/extension/webview/CodexMessageHandler.ts` | Same cases for Codex tabs. |
| `src/extension/commands.ts` | Registers `claudeMirror.smartSearch.open`; extends `claudeMirror.resumeSession` with `providerHint`. |

### Webview side

| File | Role |
|---|---|
| `src/webview/components/SmartSearch/SmartSearchView.tsx` | The search view (header + MessageList + minimal input). |
| `src/webview/components/SmartSearch/SearchEmptyState.tsx` | Example-query nudge shown before the first message. |
| `src/webview/components/StatusBar/StatusBar.tsx` | Tools dropdown rows for the Claude + Codex submenus. |
| `src/webview/components/ChatView/MarkdownContent.tsx` | `[[OPEN_SESSION:...]]` -> `.open-session-btn` transformer + click handler. |
| `src/webview/state/store.ts` | `tabKind` field + `setTabKind` setter. |
| `src/webview/App.tsx` | Early-return branch on `tabKind === 'search'`. |
| `src/webview/styles/global.css` | `.smart-search-*` and `.open-session-btn` styles. |

## Settings

| Setting | Type | Default | Notes |
|---|---|---|---|
| `claudeMirror.smartSearch.defaultModel` | string | `claude-sonnet-4-6` | Used when `claudeMirror.smartSearch.open` is invoked without a `model` argument (e.g. from the command palette). |
| `claudeMirror.smartSearch.allowBash` | boolean | `true` | When false, the agent's allow-list is `Read,Glob,Grep` only (no Bash, no ripgrep). |

## Wire protocol additions

- `SessionStartedMessage.tabKind?: 'chat' \| 'search'` — set by SessionTab/
  CodexSessionTab; consumed by `useClaudeStream` and routed to `setSession`.
- Inbound `OpenSmartSearchRequest { type, provider, model }`.
- Inbound `OpenSessionFromSearchRequest { type, sessionId, provider }`.

## CLI spawn examples

### Claude search mode

```
claude -p --verbose --output-format stream-json --input-format stream-json \\
  --include-partial-messages --replay-user-messages \\
  --allowedTools Read,Glob,Grep,Bash \\
  --append-system-prompt "<SMART_SEARCH_PROMPT>" \\
  --model <user-picked-model>
# cwd = $HOME
```

### Codex search mode (per turn)

```
codex exec --json --sandbox read-only -C $HOME \\
  --model <user-picked-model> \\
  -c 'instructions="<TOML-escaped SMART_SEARCH_PROMPT>"' -
# stdin = <the user query>
```

## Limits

- The agent is read-only by tool allow-list AND prompt; it cannot write
  files or modify state.
- "Open session" verifies provider via the explicit hint; sessions on
  disk that aren't in `SessionStore` still resume cleanly.
- Codex search tabs only get a stable threadId after the first turn —
  before that, the snapshot persists tabKind but no sessionId.
- Out of scope: vector / embedding search; search across other providers
  (Happy / Gemini); background pre-indexing.
