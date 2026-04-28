# Implementation Plan — Smart Search across Past Sessions

## 0. Goal in one paragraph

A new tab type, **Smart Search**, opened from `StatusBar → Tools → Smart Search ▸ <model>`. The tab is a real Claude Code or Codex agent session, but spawned with a baked-in system prompt that turns the agent into a session-search specialist. The user types free-form questions ("which sessions did I work on auth?", "show me yesterday's failed builds"); the agent decides whether to (a) ask one clarifying question or (b) execute multi-step searches over `~/.claude/projects/` and `~/.codex/sessions/` using its own real tools (`Read`, `Glob`, `Grep`, `Bash`). Results render as cards with an "Open this session" button. Follow-up turns continue the same conversation — the agent already has full history.

The point: **we do not reinvent search.** We hand a Claude/Codex agent the problem and let it use ripgrep + transcript reads, multi-turn, with the user steering.

---

## 1. Why the existing primitives are not enough

| Primitive | Limitation |
|---|---|
| `ChatSearchService.ts:24` (`searchProject`) | Exact-string match over `.jsonl` lines. Claude only. Single-shot. No semantics. |
| `ChatSearchBar.tsx` | Open-session in-memory only, not past sessions. |
| `SessionDiscovery.ts:34` (`discoverAll`) | Walks `~/.claude/projects/` only. No Codex coverage. |
| `CodexConversationReader.ts` | Reads `~/.codex/sessions/<threadId>.jsonl` but is single-session, no search. |

The new feature is the union: agentic, cross-provider, conversational.

---

## 2. Architecture overview

```
StatusBar → Tools dropdown
   "Smart Search" group (new) with model picker
        ↓ postMessage { type: 'openSmartSearch', provider, model }
   MessageHandler routes to TabManager.createSmartSearchTab(provider, model)
        ↓
   SessionTab (Claude) OR CodexSessionTab (Codex) constructed with:
        kind: 'search'
        appendSystemPrompt: SMART_SEARCH_PROMPT
        allowedTools: ['Read','Glob','Grep','Bash']  (Claude path)
        sandbox: 'read-only'                          (Codex path)
        cwdOverride: os.homedir()                     (so transcript dirs are reachable)
        ↓
   Reuses ClaudeProcessManager / CodexExecProcessManager,
   StreamDemux, MessageHandler, WebviewPanel — unchanged.
        ↓
   sessionStarted event carries tabKind: 'search'
        ↓
   webview store sets tabKind; App.tsx mounts <SmartSearchView/> instead of <ChatView/>
        ↓
   MarkdownContent recognizes the `[[OPEN_SESSION:<id>:<provider>]]` token
   and renders a "Open session" button → resumeSession command.
```

**Reuse strategy:** the search tab is just a regular `SessionTab` with three flags toggled. No new process manager, no new stream parser, no new postMessage protocol. The webview branch is the only meaningful UI fork.

---

## 3. Phases

### Phase 1 — Plumbing (invisible to the user)

#### 1.1 Type additions

`src/extension/types/webview-messages.ts`:
- `sessionStarted` gets `tabKind?: 'chat' | 'search'` (default `'chat'`, omitted = chat).
- New inbound message: `{ type: 'openSmartSearch'; provider: ProviderId; model: string }`.

`src/extension/session/OpenTabsSnapshot.ts:4`:
- `OpenTabSnapshotEntry` gets `tabKind?: 'chat' | 'search'`. Existing entries default to chat.

#### 1.2 SessionTab + CodexSessionTab — kind/prompt injection

Constructor options gain (both classes):
```ts
kind?: 'chat' | 'search';            // default 'chat'
appendSystemPrompt?: string;          // text appended via CLI flag
allowedTools?: string[];              // Claude --allowed-tools
cwdOverride?: string;                 // overrides workspace cwd at spawn
```

Where these flags hit the spawn:
- `ClaudeProcessManager`: when `appendSystemPrompt` is set, append `--append-system-prompt <text>` to argv (Claude CLI supports this; verified on current CLI). When `allowedTools` is set, append `--allowed-tools "<space-joined>"`.
- `CodexExecProcessManager`: pass the prompt via `-c instructions=<text>` and force `--sandbox read-only` if `kind === 'search'`.
- `cwdOverride` replaces the workspace folder used to spawn the process.

`SessionTab.kind` is included on the `sessionStarted` event payload (`tabKind: this.kind`).

#### 1.3 New file — `src/extension/session/SmartSearchPrompt.ts`

Single export: a constant string prompt template (Section 5).

#### 1.4 TabManager extension (`TabManager.ts`)

New method:
```ts
async createSmartSearchTab(opts: {
  provider: 'claude' | 'codex';
  model: string;
}): Promise<SessionTab | CodexSessionTab>
```
- Forwards through `createTabForProvider(opts.provider)` with the search-mode flags.
- Distinct slot color (e.g. magenta) so search tabs are visually obvious in the tab strip.
- The tab's display name defaults to `🔎 Search 1`, `🔎 Search 2`, …; rename works as today.

#### 1.5 Restore from snapshot

`TabManager.restoreFromSnapshot` reads `tabKind` and rebuilds search tabs in their kind. The agent process re-spawns with the same system prompt + allowed-tools — clean re-init, no transcript replay needed (search results are ephemeral and cheap to re-run).

---

### Phase 2 — Tools-dropdown entry + model picker

#### 2.1 StatusBar — new "Smart Search" submenu

`src/webview/components/StatusBar/StatusBar.tsx` lines 546–619 (`toolsItems`):

Insert a new collapsible group **"Smart Search"** with two sub-headers and the model rows:
```
🔎 Smart Search ▸
   ── Claude ──
      Opus 4.7
      Sonnet 4.6
      Haiku 4.5
   ── Codex ──
      GPT-5
      GPT-5 Pro
```
Click on any row dispatches:
```ts
postToExtension({ type: 'openSmartSearch', provider, model })
```

The model list is sourced from the existing `claudeModelDisplay.ts` (Claude) plus a small Codex catalog colocated in the same util.

#### 2.2 Extension handler

`MessageHandler.ts` adds `case 'openSmartSearch':` → `tabManager.createSmartSearchTab({ provider, model })`. No CodexMessageHandler change — the Tools dropdown lives in the webview chrome and dispatches through whichever message handler is wired to the active tab; we route via the `vscode.commands.executeCommand('claudeMirror.smartSearch.open', { provider, model })` indirection so the dispatch works from any tab.

A new VS Code command `claudeMirror.smartSearch.open` is registered in `commands.ts` and exposed in `package.json`.

#### 2.3 Setting

```jsonc
"claudeMirror.smartSearch.defaultModel": {
  "type": "string",
  "default": "claude-sonnet-4-6",
  "description": "Default model for Smart Search tabs (clicking the top-level Smart Search row, not a specific model)."
}
```

The top-level `Smart Search` button (clicking the parent, not a sub-item) opens with this default.

---

### Phase 3 — The Search View

#### 3.1 Webview routing — branch on `tabKind`

`src/webview/state/store.ts`: add `tabKind: 'chat' | 'search'`, default `'chat'`. Set on receipt of `sessionStarted`.

`src/webview/App.tsx` (around line 52, where `provider` is read): when `tabKind === 'search'`, mount `<SmartSearchView/>` in place of `<ChatView/>`. The InputArea, StatusBar, and Vitals are reused but with feature flags off (no plan-mode UI, no checkpoint UI, no PromptHistoryPanel, no Adventure widget).

#### 3.2 New file — `src/webview/components/SmartSearch/SmartSearchView.tsx`

Layout:
```
┌──────────────────────────────────────────────┐
│  🔎 Smart Search                  [model: ▾] │
│  Searching: ~/.claude + ~/.codex             │
├──────────────────────────────────────────────┤
│  (empty-state) Try:                          │
│   • "sessions where I worked on auth"        │
│   • "yesterday's failed builds"              │
│   • "find when I asked about Hebrew RTL"     │
├──────────────────────────────────────────────┤
│  <MessageList/>  ← reused from ChatView      │
│   (assistant messages may contain            │
│    [[OPEN_SESSION:...]] tokens that render   │
│    as result cards — see 3.3)                │
├──────────────────────────────────────────────┤
│  <InputArea/> placeholder = "Refine search…" │
└──────────────────────────────────────────────┘
```

Reuses:
- `MessageList` / `MessageBubble` / `StreamingText` / `MarkdownContent`
- `InputArea` (in a slimmed config — pass `mode='search'` to hide plan-mode buttons, file-mention, ultrathink, prompt-history)
- `ModelSelector` (already exists)

New: empty-state and the result-card transformer.

#### 3.3 Result-card transformer

`MarkdownContent.tsx` already linkifies file paths. Add: a regex pass over the post-markdown HTML that matches `[[OPEN_SESSION:<id>:<provider>]]` and replaces it with a button:
```html
<button class="open-session-btn" data-id="<id>" data-provider="<provider>">
  Open session →
</button>
```
A click handler in `SmartSearchView` listens at the container level (event delegation) and dispatches:
```ts
postToExtension({ type: 'resumeSessionInNewTab', sessionId, provider })
```

The extension already implements this resume pathway for Claude (`MessageHandler.ts:3041`); the Codex equivalent needs a thin wrapper around `CodexSessionTab`'s resume code path (one new branch in the handler — Codex sessions resume by passing `--resume <threadId>` to `codex` interactive, already supported).

#### 3.4 Streaming UX

The agent will run `Bash → ripgrep …` etc. The **existing** ToolUseBlock collapse UI already shows tool calls as collapsible cards — perfect for showing "the agent ran ripgrep, here's what it ran." No new UI for streaming the agent's intermediate work; ToolUseBlock just appears in the stream as it does in chat.

---

### Phase 4 — Persistence, polish, docs

#### 4.1 Snapshot restore

Existing snapshot already captures sessionId + provider; we add `tabKind`. On restore, search tabs re-spawn with their original model (stored in `customName` extension or a new `model?: string` field on the snapshot entry).

#### 4.2 `package.json`

```jsonc
"commands": [
  { "command": "claudeMirror.smartSearch.open",
    "title": "ClaUi: Open Smart Search" }
],
"configuration": {
  "claudeMirror.smartSearch.defaultModel": { ... },
  "claudeMirror.smartSearch.allowBash": {
    "type": "boolean", "default": true,
    "description": "Allow the search agent to run Bash (ripgrep). Disable for Read+Glob+Grep only."
  }
}
```

No new view container — reuses the existing webview panel column.

#### 4.3 Detail doc + index

- New: `Kingdom_of_Claudes_Beloved_MDs/SMART_SEARCH.md`
- Updated: `TECHNICAL.md` index — entry under Component Index pointing at SMART_SEARCH.md, plus the `package.json` settings table refresh.

---

## 4. CLI spawn args (concrete)

### Claude (search mode)
```
claude
  --output-format stream-json
  --verbose
  --model <userSelectedModel>
  --append-system-prompt <SMART_SEARCH_PROMPT>
  --allowed-tools "Read Glob Grep Bash"        # Bash dropped if allowBash=false
  --permission-mode acceptEdits                 # never matters; agent is read-only by prompt
  [--cwd $HOME]                                 # so ~/.claude/... + ~/.codex/... are reachable
```

### Codex (search mode)
```
codex
  --json
  --sandbox read-only
  -c instructions=<SMART_SEARCH_PROMPT>
  -c model_reasoning_effort=medium              # or 'high' if user picks GPT-5 Pro
  --model <userSelectedModel>
  -C $HOME
```

(Mirrors the proven patterns at `SessionNamer.ts:39-42` and `CodexSessionNamer.ts:33-42`. The only deltas: full interactive process — not `exec` one-shot — `--append-system-prompt`/`-c instructions=`, and `cwd = $HOME`.)

---

## 5. The system prompt (`SmartSearchPrompt.ts`)

```
You are the Smart Search agent for ClaUi (a VS Code chat extension that
wraps Claude Code and Codex). Your sole job is to help the user find past
sessions in their transcripts.

TRANSCRIPT LOCATIONS (you have read access):
- Claude:  ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
- Codex:   ~/.codex/sessions/<threadId>.jsonl
Each line of a .jsonl is one event: user message, assistant message, tool
use, or tool result. The first user message is usually the best signal of
what a session was about.

ON EACH USER TURN, DECIDE ONE OF:

(A) ASK ONE CLARIFYING QUESTION
    Only when the request is genuinely ambiguous (e.g. "find that thing").
    Ask exactly ONE question, terse. Do not search yet.

(B) SEARCH
    Use Bash + ripgrep first to scan the .jsonl files; then Read the most
    promising hits to extract a quoted snippet. Multi-step is expected.
    Constrain ripgrep to the two transcript dirs only.
    Do not write or edit files. Do not modify state.

OUTPUT FORMAT FOR RESULTS:
For each session you found, emit ONE result card:

  ### <one-line summary of what the session was about>
  - When: <YYYY-MM-DD HH:MM>  (from the .jsonl mtime or first event)
  - Provider: <Claude | Codex>
  - Match: > "<short quoted snippet, ≤ 200 chars>"
  [[OPEN_SESSION:<sessionId>:<claude|codex>]]

Then a single closing line:
  > Want me to narrow this further or open one of these?

RULES:
- Be terse. The user is here for results, not essays.
- If zero matches: say so in one sentence and suggest a relaxation.
- If >10 matches: show the top 5 and offer to expand.
- Match the user's language (Hebrew or English).
- Never invent a session that doesn't exist on disk.
```

---

## 6. Files touched

**New (4):**
- `src/extension/session/SmartSearchPrompt.ts`
- `src/webview/components/SmartSearch/SmartSearchView.tsx`
- `src/webview/components/SmartSearch/SearchEmptyState.tsx`
- `Kingdom_of_Claudes_Beloved_MDs/SMART_SEARCH.md`

**Modified (10):**
- `src/extension/types/webview-messages.ts` — `tabKind`, `openSmartSearch` message
- `src/extension/session/OpenTabsSnapshot.ts` — `tabKind`, `model`
- `src/extension/session/SessionTab.ts` — kind/appendSystemPrompt/allowedTools/cwdOverride
- `src/extension/session/CodexSessionTab.ts` — parallel changes
- `src/extension/session/TabManager.ts` — `createSmartSearchTab`, snapshot round-trip
- `src/extension/process/ClaudeProcessManager.ts` — argv flags
- `src/extension/process/CodexExecProcessManager.ts` — `instructions=` + sandbox
- `src/extension/webview/MessageHandler.ts` — `openSmartSearch` + `resumeSessionInNewTab` (Codex branch)
- `src/extension/commands.ts` — register `claudeMirror.smartSearch.open`
- `src/webview/state/store.ts` — `tabKind`
- `src/webview/App.tsx` — branch on `tabKind`
- `src/webview/components/StatusBar/StatusBar.tsx` — Smart Search submenu
- `src/webview/components/ChatView/MarkdownContent.tsx` — `[[OPEN_SESSION:...]]` transformer
- `package.json` — command, settings
- `TECHNICAL.md` — index

---

## 7. Open product decisions (worth your call before I implement)

| # | Decision | Default I would ship |
|---|---|---|
| 1 | Search scope: current workspace only or **all** of `~/.claude/projects/`? | All. Then expose a `--scope workspace` flag the prompt can mention if user asks. |
| 2 | Allow `Bash` tool? Powerful (ripgrep, ls, find) but slower and lets the agent stray. | Yes by default; setting to disable. |
| 3 | Provider switch mid-conversation? Loses context. | New tab required; tooltip explains why. |
| 4 | "Open session" — resume vs read-only view? | Resume in a new chat tab (existing pathway). |
| 5 | Pre-tab model picker (the submenu) vs open-then-pick. | Submenu picker (one click vs two). |
| 6 | Show Codex sessions even if user has no Codex CLI installed? | Yes — list them; "Open" only works if Codex is installed (we already detect this via `CodexCliDetector.ts`). |

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Agent ripgreps thousands of jsonl files and burns tokens. | Prompt instructs it to start with `ls -t` to narrow by recency, then ripgrep narrowed set. |
| Claude CLI `--append-system-prompt` flag not present on user's installed version. | Feature-detect at activation; fall back to injecting prompt as the first synthetic user message. |
| `tabKind` collisions on restore (snapshot says search but the prompt module is gone). | Default unknown kinds back to `'chat'`. |
| Result cards rendered for sessions that no longer exist. | "Open session" handler verifies the file exists; otherwise toasts `Session not found`. |
| Webview UI regressions from new branching. | Snapshot tests for App.tsx routing (chat path unchanged); manual smoke checklist below. |

---

## 9. Test plan

**Unit:**
- `SmartSearchPrompt.ts` — snapshot the prompt string (catch accidental edits).
- TabManager — `createSmartSearchTab` produces a tab with `kind === 'search'` and the right argv flags (mock spawn).
- OpenTabsSnapshot round-trip with `tabKind`.

**Manual smoke:**
1. `Tools → Smart Search → Sonnet 4.6` → new tab opens with magenta slot color and 🔎 badge.
2. Type "find sessions where I added a status bar" → agent ripgreps, returns ≥1 result card with `[[OPEN_SESSION:...]]` rendering as a button.
3. Click result → new chat tab resumes that session.
4. Continue in same search tab: "narrow to last week" → agent issues a refined search, references the prior list.
5. Reload VS Code → search tab restores with same model and a fresh empty conversation (do not attempt to replay the previous chat).
6. Repeat 1–2 with Codex GPT-5 → confirm Codex transcripts in `~/.codex/sessions/` are searched too.
7. Disable `claudeMirror.smartSearch.allowBash` → confirm agent falls back to `Glob`/`Grep` tools.

---

## 10. Suggested merge order

1. **1.1 + 1.2 + 1.3** — types, prompt, SessionTab flags (no UI yet).
2. **1.4 + 1.5** — TabManager + snapshot.
3. **2.1 + 2.2 + 2.3** — Tools dropdown + handler + setting (now openable, but plain Chat UI).
4. **3.1 + 3.2** — webview branch + SmartSearchView shell.
5. **3.3** — result-card transformer + Codex resume.
6. **3.4** — empty-state + slimmed InputArea.
7. **4** — docs, settings, version bump, SR-PTD.

---

## 11. Out of scope (explicit)

- Vector / embedding search. The agent's ripgrep + read pattern is enough; embeddings would be a separate, later, optional feature.
- Search across other providers' transcripts (Happy, Gemini, etc.) — we currently only persist Claude + Codex.
- Indexing or background pre-computation — the agent runs live; results take seconds, which is acceptable for a deliberate "search tab" interaction.
- Sharing search results between tabs — each search tab is its own conversation.
