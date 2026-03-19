# MCP Support for ClaUI - Implementation Plan

## Context

ClaUI wraps the Claude CLI in a VS Code webview. The Claude CLI already supports MCP: it connects to MCP servers, discovers tools/resources/prompts, and reports runtime state in the `system/init` event. ClaUI currently throws away most of that structure, keeps only server names, and renders them as static purple pills in the Dashboard Context tab.

**Goal:** add first-class MCP support to ClaUI with UX that makes MCP easy to discover, safe to configure, clear to debug, and practical to recover when it fails, without forcing the user into a terminal.

## Current State In ClaUI

ClaUI already has useful MCP-adjacent building blocks:

- `src/extension/webview/MessageHandler.ts`
  - Already forwards `system/init` metadata and extracts `mcp_servers`.
  - Already uses a structured prompt to ask Claude to call the `mcp__codex__codex` tool for Codex consultation.
- `src/webview/state/store.ts`
  - Already stores `sessionMetadata.mcpServers`.
- `src/webview/components/Dashboard/tabs/ContextTab.tsx`
  - Already shows active-session MCP server names.
- `src/webview/components/ChatView/PlanApprovalBar.tsx`
  - Already renders Claude pause states for approval/question flows and is the right starting point for MCP elicitation UX.
- `src/extension/process/envUtils.ts`
  - Already provides safe env sanitization and SecretStorage-backed key handling patterns.
- `src/extension/auth/AuthManager.ts`
  - Already establishes the pattern for one-shot Claude CLI management commands.
- `src/webview/App.tsx`
  - Already hosts multiple panel/overlay experiences (`Dashboard`, `SkillGen`, `Teams`, `BugReport`, `CodexConsultPanel`).

Current gaps:

- No dedicated MCP UI.
- No distinction between active-session MCP state and configured MCP state.
- No mutation tracking after ClaUI changes config.
- No restart/reconnect guidance after config changes.
- No add/remove/import flow.
- No first-class status/auth/trust/debug surface.
- No surfacing of MCP resources, prompts, or elicitation.
- MCP tool identity is flattened in some analytics/visualization paths, which loses the server identity.

---

## UX Principles

1. **Show session truth and config truth separately.**
   A server can be configured but not active in the current session.

2. **Track mutation truth explicitly.**
   If ClaUI just added or removed a server, the UI must say that runtime has not caught up yet.

3. **Never default users into raw JSON.**
   `.mcp.json` should be visible, but the primary flow should be a guided form.

4. **Every failure state must have a next action.**
   "Needs login", "restart required", "approval required", and "broken command" must each map to a concrete CTA.

5. **Secrets must never be pushed into workspace files.**
   Use SecretStorage and `${VAR}` env placeholders, not hardcoded tokens in `.mcp.json`.

6. **Be explicit about scope.**
   Users should always know whether a server is local, project, user, or managed.

7. **Be provider-aware.**
   Full MCP management is Claude-first. Codex tabs must not pretend to have Claude session MCP parity.

8. **Respect Windows reality.**
   The wizard must generate Windows-safe stdio commands and the extension must avoid shell-quoting traps.

---

## Core Product Decision

ClaUI should not become a second MCP execution engine.

Claude CLI remains the MCP client and source of truth for MCP execution. ClaUI provides:

- configuration UX
- discovery UX
- visibility and debugging
- session-aware recovery actions
- lightweight authoring helpers

This preserves parity with Claude Code, avoids re-implementing transport/auth/runtime semantics, and aligns with the current architecture.

---

## Data Truth Model (Three Layers)

| Layer | Source | Example |
|-------|--------|---------|
| **Runtime truth** | Active session `system/init.mcp_servers` and runtime tool list | Server `codex` is connected with 2 tools |
| **Config truth** | `~/.claude.json`, workspace `.mcp.json`, managed config, and any CLI-owned scope that can be discovered | Server `github` is configured at project scope |
| **Mutation truth** | What ClaUI just changed | ClaUI added `sentry`; restart still required |

The UI must track all three and clearly show drift, for example: `1 server pending restart`.

---

## Architecture Decisions

### 1. Use CLI mutations, mixed discovery, and runtime init

- **Mutations** go through `claude mcp ...` commands so Claude CLI remains the validator and writer.
- **Known file-backed config** is read directly for display:
  - user scope from `~/.claude.json`
  - project scope from workspace `.mcp.json`
  - managed scope from the platform-specific managed config path
- **Opaque or CLI-owned scope discovery** falls back to `claude mcp list/get` when file ownership is not stable enough to rely on direct reads, especially for `local` scope.
- **Runtime truth** comes from enriched `system/init` handling.

### 2. Prefer inventory terminology over a flat "status" model

The extension needs a merged, UI-friendly inventory model, not just a runtime status array. Use:

- runtime snapshot for active-session truth
- config snapshot for next-session truth
- pending mutation records for restart-aware drift

### 3. Full-screen overlay panel plus status bar chip

- Add a dedicated `MCP` chip/button to the status bar.
- Add a full-screen overlay panel with 4 tabs:
  - `Session` for runtime truth
  - `Workspace` for configured truth
  - `Add` for guided setup and imports
  - `Debug` for logs, paths, commands, and last errors

### 4. Registry-based service split

Do not collapse MCP into a single monolithic service. Use at minimum:

- **`McpCliService`**
  - wraps `claude mcp` commands
  - normalizes output and stderr
  - feature-detects whether `list/get` return structured output
- **`McpConfigService`**
  - reads file-backed config
  - validates config shapes
  - generates project-scope diff previews
- **`McpRegistryService`**
  - merges runtime truth, config truth, and mutation truth
  - computes effective status and next-action CTA
  - groups tools by server
- **`McpTemplateCatalog`**
  - curated server templates
  - scope guidance
  - Windows-safe defaults
- **`McpSecretsService`**
  - SecretStorage-backed secret capture
  - emits `${VAR}` placeholders into config

### 5. No VS Code settings as a second MCP config system

- MCP config belongs to Claude CLI's own system.
- ClaUI provides a GUI over that system.
- Avoid dual source-of-truth and drift with VS Code settings.

### 6. Provider awareness is part of the product, not a footnote

- Claude tabs: full MCP runtime + config management
- Codex tabs: read-only config visibility or disabled panel with explanation
- Never imply Codex tabs have the same `system/init.mcp_servers` semantics unless the runtime really exposes them

### 7. Use `execFile`/argument arrays for CLI calls

Do not use shell-quoted `exec(...)` for MCP mutations. JSON payloads and Windows quoting make that brittle.

- Follow the `AuthManager.ts` pattern
- Call `claude` with an args array
- Pass `JSON.stringify(config)` as a single arg to `add-json`

---

## Phase 1A (Foundation + Visibility)

This is the smallest slice that delivers immediate value and establishes the right data model.

### Step 1: Type the MCP init payload properly

**File: `src/extension/types/stream-json.ts`**

Add a typed MCP runtime shape:

```ts
export interface McpServerInit {
  name: string;
  status?: string; // connected | needs-auth | error | disconnected | unknown
}
```

Change `mcp_servers` from `Record<string, unknown>[]` to `McpServerInit[]`.

### Step 2: Define shared MCP inventory and message contracts

**File: `src/extension/types/webview-messages.ts`**

Add a UI-friendly merged model:

```ts
export interface McpServerInfo {
  name: string;
  scope: 'local' | 'project' | 'user' | 'managed' | 'unknown';
  source: 'runtime' | 'config' | 'both';
  transport?: 'stdio' | 'sse' | 'http';
  runtimeStatus: 'connected' | 'needs-auth' | 'needs-approval' | 'error' | 'disconnected' | 'unknown';
  effectiveStatus: 'active' | 'configured' | 'pending_restart' | 'needs_auth' | 'needs_approval' | 'broken' | 'unknown';
  command?: string;
  args?: string[];
  url?: string;
  envKeys?: string[];
  headerKeys?: string[];
  tools: string[];
  resources?: string[];
  prompts?: string[];
  pendingMutation?: 'added' | 'removed' | 'updated' | 'imported';
  restartRequired?: boolean;
  lastError?: string;
  nextAction?: 'restart-session' | 'reconnect' | 'sign-in' | 'approve-project' | 'open-config' | 'none';
}

export interface McpMutationRecord {
  name: string;
  scope: 'local' | 'project' | 'user' | 'managed' | 'unknown';
  kind: 'added' | 'removed' | 'updated' | 'imported';
  timestamp: number;
  restartRequired: boolean;
}
```

Add webview -> extension messages:

- `McpRefreshRequest { type: 'mcpRefresh' }`
- `McpOpenConfigRequest { type: 'mcpOpenConfig'; scope?: string }`
- `McpOpenLogsRequest { type: 'mcpOpenLogs' }`
- `McpAddServerRequest { type: 'mcpAddServer'; name: string; config: McpServerConfig; scope: string }`
- `McpRemoveServerRequest { type: 'mcpRemoveServer'; name: string; scope: string }`
- `McpResetProjectChoicesRequest { type: 'mcpResetProjectChoices' }`
- `McpImportDesktopRequest { type: 'mcpImportDesktop' }`
- `McpRestartSessionRequest { type: 'mcpRestartSession' }`

Add extension -> webview messages:

- `McpInventoryMessage { type: 'mcpInventory'; servers: McpServerInfo[]; pendingRestartCount: number }`
- `McpOperationResultMessage { type: 'mcpOperationResult'; success: boolean; operation: string; name?: string; error?: string; restartNeeded?: boolean; nextAction?: string }`

Update `SessionMetadataMessage`:

- Change `mcpServers: string[]` to `mcpServers: McpServerInfo[]`
- Keep it runtime-only; use top-level MCP inventory for merged truth

### Step 3: Create extension-side MCP services

**New folder: `src/extension/mcp/`**

**`McpCliService.ts`**

Responsibilities:

- `listServers()`
- `getServer(name)`
- `addServer(name, config, scope)`
- `removeServer(name, scope)`
- `importFromDesktop()`
- `resetProjectChoices()`
- private `execCli(args, timeoutMs = 15000)` using `execFile`

Implementation notes:

- Reuse the one-shot CLI pattern from `AuthManager.ts`
- Normalize stderr into structured UI-safe errors
- Feature-detect structured output for `claude mcp list/get`; if absent, keep the parser here, not in handlers

**`McpConfigService.ts`**

Responsibilities:

- read workspace `.mcp.json`
- read user `~/.claude.json`
- read managed config if present
- best-effort discover local scope storage if it is file-backed
- expose `getConfigPaths(workspacePath)`
- validate config shapes
- generate project diff previews without directly mutating files

**`McpRegistryService.ts`**

Responsibilities:

- merge runtime truth + config truth + mutation truth
- compute `effectiveStatus`
- detect drift / pending restart
- infer `nextAction`
- map `mcp__<server>__<tool>` names back to server ownership
- produce grouped tool maps for UI

### Step 4: Enrich runtime init handling

**File: `src/extension/webview/MessageHandler.ts`**

Replace the current name-only extraction around the existing `system/init` handling with runtime objects that preserve status and tool ownership.

Pattern:

```ts
const runtimeMcpServers: McpServerInfo[] = Array.isArray(event.mcp_servers)
  ? event.mcp_servers
      .map((server: any) => ({
        name: String(server.name || server.id || ''),
        scope: 'unknown' as const,
        source: 'runtime' as const,
        runtimeStatus: String(server.status || 'unknown') as McpServerInfo['runtimeStatus'],
        effectiveStatus: 'unknown' as const,
        tools: (event.tools ?? []).filter((tool: string) => tool.startsWith(`mcp__${server.name}__`)),
      }))
      .filter(server => server.name)
  : [];
```

After init:

1. read config snapshots via `McpConfigService`
2. merge through `McpRegistryService`
3. post `mcpInventory`

Add message handlers in 1A for:

- `mcpRefresh`
- `mcpOpenConfig`
- `mcpOpenLogs`

Mutation handlers (`mcpAddServer`, `mcpRemoveServer`, `mcpImportDesktop`, `mcpResetProjectChoices`, `mcpRestartSession`) land in Phase 1B.

### Step 5: Separate runtime metadata from merged inventory in the store

**File: `src/webview/state/store.ts`**

Keep `sessionMetadata` for runtime data, but stop overloading it as the full MCP model.

Update:

```ts
sessionMetadata: {
  tools: string[];
  model: string;
  cwd: string;
  mcpServers: McpServerInfo[]; // runtime-only
} | null;

mcpPanelOpen: boolean;
mcpSelectedTab: 'session' | 'workspace' | 'add' | 'debug';
mcpInventory: McpServerInfo[];
mcpPendingMutations: McpMutationRecord[];
mcpPendingRestartCount: number;
mcpLoading: boolean;
mcpLastError: string | null;
mcpLastOperation: { op: string; name?: string; success: boolean } | null;
```

### Step 6: Create the read-only MCP panel shell and server grouping UI

**New folder: `src/webview/components/McpPanel/`**

Create:

- `McpPanel.tsx`
- `McpServerCard.tsx`
- `McpToolsMap.tsx`
- `McpSessionTab.tsx`
- `McpWorkspaceTab.tsx`
- `McpDebugTab.tsx`
- `index.ts`

Panel behavior:

- fixed-position overlay, aligned with existing panel patterns
- ESC closes
- header shows total count, pending restart badge, refresh button, close button
- 4-tab structure from day one: `Session | Workspace | Add | Debug`
- if management slips, `Add` can ship as a placeholder in 1A rather than forcing a late panel redesign

`McpSessionTab.tsx`:

- shows runtime truth
- shows a stale-session banner if config and runtime differ
- uses `McpToolsMap.tsx` to group tools by server instead of a flat list

`McpWorkspaceTab.tsx`:

- shows config truth grouped by scope
- shows `source`, `transport`, `command/url`, and restart-required badges

`McpDebugTab.tsx`:

- shows config file paths
- active vs configured comparison
- last error / last operation
- copyable commands:
  - `claude mcp list`
  - `claude mcp get <name>`
  - `claude --mcp-debug`
- link/button to open ClaUI logs

`McpServerCard.tsx`:

- standardizes badge/status/action layout across Session and Workspace tabs

`McpToolsMap.tsx`:

- groups runtime tools by server
- preserves `server -> tool` identity
- becomes the reusable building block for later chat/dashboard work

### Step 7: Wire the webview and command surfaces

**Files:**

- `src/webview/App.tsx`
- `src/webview/hooks/useClaudeStream.ts`
- `src/webview/components/StatusBar/StatusBar.tsx`
- `src/webview/components/Dashboard/tabs/ContextTab.tsx`
- `src/extension/commands.ts`
- `package.json`

Webview message handling:

```ts
case 'mcpInventory':
  useAppStore.getState().setMcpInventory(msg.servers);
  useAppStore.getState().setMcpPendingRestartCount(msg.pendingRestartCount);
  useAppStore.getState().setMcpLoading(false);
  break;
case 'mcpOperationResult':
  useAppStore.getState().setMcpLoading(false);
  useAppStore.getState().setMcpLastOperation({ op: msg.operation, name: msg.name, success: msg.success });
  if (!msg.success) useAppStore.getState().setMcpLastError(msg.error || 'Operation failed');
  break;
```

Status bar chip:

- `MCP 0`
- `MCP 3`
- `MCP 3 | restart needed`
- `MCP 2 | 1 needs login`
- `MCP error`

Context tab changes:

- color-code pills by status
- show tool count
- clicking a pill opens the MCP panel

Commands:

- add `claudeMirror.toggleMcpPanel`
- declare it in `package.json`

### Step 8: Update documentation for the new model

- Update `TECHNICAL.md`:
  - component index
  - directory structure
  - `sessionMetadata.mcpServers` now typed objects
  - new MCP services/components
- Create `Kingdom_of_Claudes_Beloved_MDs/MCP_SUPPORT.md`
- Add an SR-PTD doc for the implementation
- Remove or update any stale MCP documentation so docs remain a snapshot of reality

---

## Phase 1B (Guided Management)

This builds on the visibility foundation and delivers the actual add/remove/manage flow.

### Step 9: Add a curated template catalog and Add wizard

**New file: `src/extension/mcp/McpTemplateCatalog.ts`**

Responsibilities:

- ship curated server templates
- provide descriptions and scope guidance
- provide Windows-safe defaults

Recommended first templates:

- GitHub
- Playwright
- Sentry
- Brave Search
- Slack
- Postgres
- Context7
- Codex

**New webview files:**

- `McpAddWizard.tsx`
- `McpQuickAdd.tsx`
- `McpAddForm.tsx`

Wizard entry points:

- `Recommended`
- `Import from Claude Desktop`
- `Custom stdio`
- `Custom HTTP`
- `Custom SSE`

### Step 10: Add SecretStorage-backed secret handling

**New file: `src/extension/mcp/McpSecretsService.ts`**

Responsibilities:

- store user-entered secrets in SecretStorage
- emit `${VAR_NAME}` placeholders for project config
- expose only env key names back to the UI
- never echo raw secrets into logs or webview state

UI rules:

- secret fields are visually distinct from normal env vars
- saving project-scope config stores the secret in SecretStorage and writes only the placeholder to `.mcp.json`
- debug UI may show that a secret reference exists, but never the value

### Step 11: Add mutation handlers and restart-aware recovery actions

**Files:**

- `src/extension/webview/MessageHandler.ts`
- `src/extension/mcp/McpCliService.ts`
- `src/extension/mcp/McpConfigService.ts`
- `src/extension/mcp/McpRegistryService.ts`

Implement handlers for:

- `mcpAddServer`
- `mcpRemoveServer`
- `mcpImportDesktop`
- `mcpResetProjectChoices`
- `mcpRestartSession`

After every mutation:

1. write through Claude CLI
2. record a mutation-truth entry
3. refresh config snapshots
4. rebuild merged inventory
5. post an operation result and updated inventory
6. show restart/reconnect CTA

Required CTAs:

- `Restart session now`
- `Try reconnect`
- `Apply later`

Project-scope adds must show the exact `.mcp.json` diff preview before save.

Remove flow must require confirmation.

### Step 12: Finalize provider-aware behavior

- Claude tabs: full add/remove/import/restart controls
- Codex tabs: read-only Session/Workspace/Debug or disabled MCP panel with explanation
- Add/remove/restart actions are hidden or disabled in Codex tabs
- Copy/open debug actions may remain available

---

## Phase 2 (Future) - In-Session Recovery And Monitoring

- **Server-aware `ToolUseBlock`**
  - Show `server -> tool` badge in chat tool cards instead of flattening the tool name.
  - Touch points:
    - `src/webview/components/ChatView/ToolUseBlock.tsx`
    - `src/webview/utils/turnVitals.ts`
    - `src/extension/session/VisualProgressProcessor.ts`
- **Inline auth/trust recovery**
  - When Claude reports MCP auth/trust failure mid-chat, show an inline recovery card with actions such as:
    - `Sign in`
    - `Approve project servers`
    - `Reconnect MCP`
    - `Open .mcp.json`
- **MCP elicitation UX**
  - Reuse `PlanApprovalBar.tsx` for structured server questions mid-flow.
- **Config watchers**
  - Watch `.mcp.json` and file-backed user config for external edits and auto-refresh inventory.
- **Health monitoring**
  - Track `mcp__` tool call activity by server and detect stale connections.

---

## Phase 3 (Future) - Authoring Helpers And Analytics

- **`@` mentions for MCP resources**
  - Extend `useFileMention.ts` and `FileMentionPopup.tsx` to surface MCP resources beneath local files.
- **`/` prompt suggestions**
  - Surface MCP prompts when prompt inventory is discoverable in a stable machine-readable form.
- **Dashboard MCP analytics**
  - Add per-session MCP activity stats and tool counts per server.
- **In-place server editing**
  - Edit by remove + re-add through CLI-backed flows.
- **Connection testing**
  - Add `Test Connection` per server.
- **Import/export helpers**
  - Share project-scoped snippets between developers.

---

## Phase 4 (Future) - Team And Enterprise Polish

- managed-policy visibility
- recommended project server packs
- richer diagnostics export
- workspace/team onboarding flows for project-scoped MCP

---

## Files Modified (Phase 1A + 1B)

| File | Change |
|------|--------|
| `src/extension/types/stream-json.ts` | Add `McpServerInit`, type `mcp_servers` |
| `src/extension/types/webview-messages.ts` | Add MCP inventory/mutation/message types, update `SessionMetadataMessage` |
| `src/extension/webview/MessageHandler.ts` | Enrich init handling, add MCP panel/config/mutation handlers |
| `src/webview/state/store.ts` | Separate runtime metadata from merged MCP inventory state |
| `src/webview/hooks/useClaudeStream.ts` | Handle `mcpInventory` and `mcpOperationResult` |
| `src/webview/App.tsx` | Render `McpPanel` |
| `src/webview/components/StatusBar/StatusBar.tsx` | Add MCP chip/button |
| `src/webview/components/Dashboard/tabs/ContextTab.tsx` | Render typed MCP pills, counts, click-to-open |
| `src/extension/commands.ts` | Register `toggleMcpPanel` |
| `package.json` | Add MCP command declaration |
| `TECHNICAL.md` | Update component index, directory structure, MCP state model |

## New Files (Phase 1A + 1B)

| File | Purpose |
|------|---------|
| `src/extension/mcp/McpCliService.ts` | CLI wrapper for list/get/add/remove/import/reset |
| `src/extension/mcp/McpConfigService.ts` | Config reading, validation, and diff preview generation |
| `src/extension/mcp/McpRegistryService.ts` | Runtime/config/mutation merge and effective status computation |
| `src/extension/mcp/McpTemplateCatalog.ts` | Curated templates and Windows-safe defaults |
| `src/extension/mcp/McpSecretsService.ts` | SecretStorage-backed secret handling |
| `src/webview/components/McpPanel/McpPanel.tsx` | Main MCP overlay shell |
| `src/webview/components/McpPanel/McpServerCard.tsx` | Shared server card UI |
| `src/webview/components/McpPanel/McpToolsMap.tsx` | Tool-to-server grouping view |
| `src/webview/components/McpPanel/McpSessionTab.tsx` | Runtime truth tab |
| `src/webview/components/McpPanel/McpWorkspaceTab.tsx` | Config truth tab grouped by scope |
| `src/webview/components/McpPanel/McpAddWizard.tsx` | Guided add flow |
| `src/webview/components/McpPanel/McpAddForm.tsx` | Custom transport-aware form |
| `src/webview/components/McpPanel/McpQuickAdd.tsx` | Curated server gallery |
| `src/webview/components/McpPanel/McpDebugTab.tsx` | Debug and diagnostics tab |
| `src/webview/components/McpPanel/index.ts` | Barrel exports |
| `Kingdom_of_Claudes_Beloved_MDs/MCP_SUPPORT.md` | Detail documentation for implemented MCP support |
| `Kingdom_of_Claudes_Beloved_MDs/SR-PTD_*.md` | Implementation traceability doc |

---

## Existing Code To Reuse

| Pattern | Source | Reuse For |
|---------|--------|-----------|
| Overlay panel shell | `DashboardPanel`, `TeamPanel`, `SkillGenPanel` | `McpPanel` structure and ESC handling |
| One-shot CLI wrapper | `AuthManager.ts` | `McpCliService` process pattern |
| Secret/env handling | `envUtils.ts` | `McpSecretsService` safety model |
| Runtime metadata bridge | `MessageHandler.ts` + `store.ts` + `ContextTab.tsx` | Enriched MCP data flow |
| Approval/question UX | `PlanApprovalBar.tsx` | MCP elicitation |
| File/resource mentions | `useFileMention.ts`, `FileMentionPopup.tsx` | MCP resource mentions |
| Tool identity parsing | `turnVitals.ts`, `VisualProgressProcessor.ts` | Preserve server-aware MCP tool identity in Phase 2 |

---

## Verification

1. **Deploy locally:** `npm run deploy:local`
2. **Reload VS Code:** `Ctrl+Shift+P` -> `Developer: Reload Window`
3. **Verify installed package:** `npm run verify:installed`
4. **Start a Claude session:** inspect `Output -> ClaUi` for enriched runtime MCP inventory and status data.
5. **Status bar chip:** verify MCP counts and restart/auth/error states render correctly.
6. **Panel open:** click the MCP chip or run `ClaUi: MCP Servers`.
7. **Session tab:** verify runtime servers show correct status dots and grouped tools.
8. **Workspace tab:** verify servers are grouped by scope and show transport/command/url/source correctly.
9. **Debug tab:** verify config paths, last error, and copyable CLI commands.
10. **Quick Add:** verify a recommended template pre-fills with Windows-safe defaults.
11. **Secret handling:** verify project-scope save writes `${VAR}` placeholders and stores the actual secret in SecretStorage only.
12. **Add/remove/import/reset flows:** verify each operation refreshes inventory and sets `restart needed` state when appropriate.
13. **Restart CTA:** verify `Restart session now` actually clears pending restart drift.
14. **Context tab:** verify typed, color-coded MCP pills open the MCP panel.
15. **Codex tab:** verify read-only or disabled MCP behavior is explicit and honest.
16. **If the panel renders blank after reload:** force a repaint with `Developer: Toggle Developer Tools`, then check for `ready` messages and use `Developer: Open Webview Developer Tools` if React errors are suspected.

---

## Risks

| Risk | Mitigation |
|------|------------|
| `claude mcp list/get` may not expose stable structured output | Centralize parsing and feature detection in `McpCliService` |
| Windows quoting breaks `add-json` if implemented with `exec` | Use `execFile` with argument arrays, never shell-quoted JSON |
| `local` scope storage may be CLI-owned or opaque | Treat local scope as best-effort file discovery plus CLI fallback |
| `~/.claude.json` shape may change | Read defensively with validation and fallback to empty snapshots |
| Breaking change from `mcpServers: string[]` to typed objects | Update all consumers atomically and keep runtime-only vs merged inventory separate |
| CLI commands can be slow or fail intermittently | Use timeouts, loading states, and preserve last known inventory on failure |
| Project diff preview may diverge from the CLI's final write shape | Generate preview from normalized config transforms and clearly label it as projected output |
| Secrets could leak into logs or workspace files | Keep raw secrets in SecretStorage only and never echo values back to the UI |
| Claude.ai cloud connectors may appear only at runtime | Always preserve runtime-only servers even if no file-backed config exists |
| Mutation truth may be lost if it exists only in ephemeral component state | Store pending mutations in Zustand until restart or explicit refresh clears them |
| Codex tabs may overpromise unsupported runtime parity | Hard-disable or read-only gate unsupported actions |

---

## Open Questions

1. Does the current Claude CLI expose machine-readable output for `claude mcp list/get`, or is a resilient text parser still required?
2. Can "Reconnect" be driven through an existing session control path, or should restart/reconnect remain explicit out-of-band actions?
3. How much prompt/resource inventory is actually discoverable in a stable format today?
4. What is the most reliable way to surface `local` scope if its storage remains CLI-owned rather than file-owned?
5. Should project-scope mutation always flow through `claude mcp add/remove`, or is there any justified case for direct `.mcp.json` editing after the MVP?
6. Does the runtime ever expose structured auth/trust failure metadata, or will CTA inference depend on stderr / tool failure text in V1?

---

## Recommended First Slice

If scope needs to be cut, start with Phase 1A only:

- status bar MCP chip
- Session / Workspace / Debug panel
- merged runtime/config inventory
- pending restart detection
- provider-aware read-only or disabled behavior in Codex tabs

That slice already lets the user answer:

- What MCP servers do I have?
- Which ones are active right now?
- Which ones are only configured for the next session?
- Why is something missing or stale?

Then layer guided management on top of that foundation in Phase 1B.
