# MCP Support Plan

## Goal

Add first-class MCP support to ClaUi with a UX that makes MCP easy to discover, safe to configure, clear to debug, and pleasant to use inside the existing chat workflow.

This should remove the current gap where users must leave the extension and drop to a terminal to understand which MCP servers exist, whether they are active, why they failed, or how to add them correctly.

## Current State In ClaUi

ClaUi already has a few useful MCP building blocks:

- `src/extension/webview/MessageHandler.ts`
  - Already uses a structured prompt to ask Claude to call the `mcp__codex__codex` tool for Codex consultation.
- `src/webview/components/ChatView/PlanApprovalBar.tsx`
  - Already renders Claude pause states for approval and question flows, which is the right starting point for MCP elicitation UX.
- `src/extension/webview/MessageHandler.ts`
  - Already forwards `system/init` metadata and extracts `mcp_servers`.
- `src/webview/state/store.ts`
  - Already stores `sessionMetadata.mcpServers`.
- `src/webview/components/Dashboard/tabs/ContextTab.tsx`
  - Already shows the active session's MCP server names.
- `src/extension/process/envUtils.ts`
  - Already provides safe env sanitization and SecretStorage-backed Anthropic key handling.
- `src/extension/auth/AuthManager.ts`
  - Already wraps Claude auth CLI calls and establishes the pattern for one-shot CLI management commands.
- `src/webview/App.tsx`
  - Already hosts multiple panel/overlay experiences (`Dashboard`, `SkillGen`, `Teams`, `BugReport`, `CodexConsultPanel`).

Current gaps:

- No dedicated MCP UI.
- No add/remove/import flow.
- No distinction between active session MCP state and configured MCP state.
- No server health/auth/trust status.
- No restart/reconnect guidance after config changes.
- No first-class surfacing of MCP resources, prompts, or elicitation.
- MCP tool names are flattened in some analytics/visualization paths, which loses the server identity.

## Core Product Decision

ClaUi should not become a second MCP execution engine.

Claude CLI should remain the MCP client and source of truth for actual MCP execution. ClaUi should wrap that with:

- configuration UX
- discovery UX
- visibility and debugging
- session-aware recovery actions
- lightweight authoring helpers

Why this is the right boundary:

- It preserves parity with Claude Code behavior.
- It avoids re-implementing MCP transport, auth, and runtime semantics in the extension.
- It keeps trust and security simpler.
- It aligns with the current architecture, where ClaUi already owns Claude CLI processes rather than replacing them.

## UX Principles

1. Show session truth and config truth separately.
   A server can be configured but not yet active in the current session.

2. Never default users into raw JSON.
   `.mcp.json` should be visible and editable, but the primary flow should be a guided form.

3. Every failure state must have a next action.
   "Needs login", "restart required", "approval required", and "broken command" must each have a specific CTA.

4. Secrets must never be pushed into workspace files by accident.
   Use SecretStorage and env placeholders, not hardcoded tokens in `.mcp.json`.

5. Be explicit about scope.
   Users should always know whether a server is local, project, user, or managed.

6. Be provider-aware.
   Full MCP management is Claude-first. Codex tabs should not pretend to have runtime MCP parity unless the runtime exposes it.

7. Respect Windows reality.
   The wizard must generate Windows-safe stdio commands, especially `cmd /c npx ...` where needed.

## Proposed UX

### 1. Status Bar MCP Chip

Add a dedicated `MCP` chip/button to the status bar near the existing AI/session controls.

Example states:

- `MCP 0`
- `MCP 3`
- `MCP 3 | restart needed`
- `MCP 2 | 1 needs login`
- `MCP error`

Behavior:

- Click opens the MCP panel.
- Tooltip explains whether the count is from the active session or pending config.
- In Codex tabs, show either a disabled state or a read-only note such as `MCP managed by Claude sessions`.

### 2. MCP Panel

Add a new overlay panel, following the existing `DashboardPanel` / `TeamPanel` / `SkillGenPanel` pattern.

Recommended tabs:

- `Session`
  - Runtime truth from the active Claude session.
- `Workspace`
  - Configured servers across scopes, grouped by `local`, `project`, `user`, `managed`.
- `Add`
  - Guided setup wizard and imports.
- `Debug`
  - Raw config paths, logs, copyable CLI commands, last errors.

Each server card should show:

- server name
- scope
- transport (`stdio`, `http`, `sse`)
- source of truth
- session status
- auth status
- last error
- whether a restart/reconnect is required
- tools/resources/prompts counts when discoverable

Each card should expose actions such as:

- `Reconnect`
- `Restart Session With Changes`
- `Open Config`
- `Copy CLI Command`
- `Remove`
- `Reset Project Approvals`

### 3. Guided Add Server Wizard

The primary setup flow should be a wizard, not "open terminal and remember flags".

Entry paths:

- `Recommended`
- `Import From Claude Desktop`
- `Custom HTTP`
- `Custom stdio`
- `Custom SSE`

Form design:

- scope picker with clear explanations
- transport-specific form fields
- Windows-aware command builder for stdio servers
- header/env inputs
- secret fields stored in SecretStorage or written as `${VAR}` placeholders
- project-scope preview showing the exact `.mcp.json` diff before save

After save:

- if the current session is stale, show:
  - `Restart session now`
  - `Try reconnect`
  - `Apply later`

Recommended built-in templates for day one:

- GitHub
- Playwright
- Sentry
- Codex
- Custom internal server

### 4. In-Session UX

Once MCP is configured, the chat experience should make server activity obvious.

#### Tool visibility

Today some paths flatten MCP names to the base tool name:

- `src/webview/utils/turnVitals.ts`
- `src/extension/session/VisualProgressProcessor.ts`

That is fine for generic categorization, but it is bad for MCP UX because `mcp__github__search_code` and `mcp__sentry__search_code` collapse into the same label.

Plan:

- preserve both `server` and `tool` identity in parsed tool metadata
- show `server -> tool` or a server badge plus tool name in `ToolUseBlock`
- keep base-name categorization only as a secondary analytics field

#### Auth and approval recovery

When Claude reports an MCP auth or trust problem:

- show a clear inline banner/card in the chat
- link it to the server detail in the MCP panel
- offer one-click actions where possible

Examples:

- `Sign in to Sentry`
- `Approve project servers`
- `Reconnect MCP`
- `Open .mcp.json`

#### MCP elicitation

MCP servers can request structured user input mid-flow.

ClaUi already has the right pattern in `PlanApprovalBar.tsx`. Reuse that experience for MCP elicitation rather than inventing a separate modal. The UI should display:

- the requesting server
- the question header
- the question text
- provided options
- custom answer input when allowed

### 5. Authoring UX

MCP is much better when users can discover prompts and resources without memorizing names.

#### `@` mentions

Extend the existing file mention flow so it can also surface MCP resources when discoverable.

Reuse:

- `src/webview/hooks/useFileMention.ts`
- `src/webview/components/InputArea/FileMentionPopup.tsx`

Preferred behavior:

- local files remain first-class
- MCP resources appear in a clearly labeled section beneath files
- results show the server badge and resource type

#### `/` prompt suggestions

Add MCP prompt suggestions to the input experience when prompt inventory is available.

Important constraint:

- do not assume prompt/resource discovery is always available in structured form

So the phased UX should be:

- Phase 1: quick-insert snippets and server examples
- Phase 2: structured prompt/resource autocomplete if Claude CLI exposes enough data

### 6. Debugging UX

The debug experience must be first-class because MCP failures are often config, auth, or environment issues.

The `Debug` tab should show:

- active session MCP inventory
- config inventory by scope
- known config file paths
  - project `.mcp.json`
  - user `~/.claude.json`
  - managed `managed-mcp.json`
- whether config changes are pending a restart
- last CLI command attempted
- last parse/mutation error
- quick actions:
  - `Open ClaUi logs`
  - `Copy claude mcp list`
  - `Copy claude mcp get <name>`
  - `Copy claude --mcp-debug`

### 7. Provider Awareness

ClaUi is now a dual-provider UI, but the MCP plan should be honest about where MCP state comes from.

V1 recommendation:

- Claude tabs: full MCP panel and runtime status
- Codex tabs: either read-only global/project config view or a disabled panel with explanation

Do not imply that Codex tabs have the same `system/init.mcp_servers` semantics unless the runtime actually exposes them.

## Proposed Architecture

### Extension-Side Services

#### `McpCliService`

Responsibilities:

- wrap `claude mcp` commands
- normalize outputs and errors
- support actions like:
  - `list`
  - `get`
  - `add`
  - `remove`
  - `add-from-claude-desktop`
  - `reset-project-choices`

Implementation note:

- if Claude CLI provides structured output, use it
- otherwise normalize text output centrally here rather than sprinkling parsing logic through handlers

#### `McpConfigService`

Responsibilities:

- read workspace `.mcp.json`
- detect project/user/managed config presence
- validate project config shape
- stage and write safe project-scope edits

This service should own JSON validation and diff preview generation.

#### `McpRegistryService`

Responsibilities:

- merge runtime session data with config data
- produce a UI-friendly inventory model
- track drift between:
  - active session state
  - configured state

This is the service that should decide statuses like:

- `active`
- `configured`
- `pending_restart`
- `needs_auth`
- `needs_approval`
- `broken`

#### `McpTemplateCatalog`

Responsibilities:

- ship curated server templates
- provide scope guidance
- provide transport-aware defaults
- provide Windows-safe command examples

#### `McpSecretsService`

Responsibilities:

- store user-entered secrets in SecretStorage
- emit env-placeholder references for project-scope config
- reuse the safety model already established in `envUtils.ts`

### Webview-Side Additions

Suggested new state:

- `mcpPanelOpen`
- `mcpInventory`
- `mcpRuntimeStatus`
- `mcpPendingMutations`
- `mcpLastError`

Suggested new components:

- `src/webview/components/Mcp/McpPanel.tsx`
- `src/webview/components/Mcp/McpServerCard.tsx`
- `src/webview/components/Mcp/McpAddWizard.tsx`
- `src/webview/components/Mcp/McpDebugTab.tsx`

Suggested new message-contract additions:

- `openMcpPanel`
- `refreshMcpInventory`
- `addMcpServer`
- `removeMcpServer`
- `openMcpConfig`
- `mcpInventory`
- `mcpMutationResult`

### Existing ClaUi Pieces To Reuse

- Overlay panel pattern:
  - `DashboardPanel`
  - `SkillGenPanel`
  - `TeamPanel`
- Guided one-shot MCP action pattern:
  - Codex consultation in `MessageHandler.ts`
- Approval / question UX:
  - `PlanApprovalBar.tsx`
- Secret and env handling:
  - `envUtils.ts`
- Claude CLI command wrapper pattern:
  - `AuthManager.ts`
- Existing MCP runtime metadata bridge:
  - `sessionMetadata` flow in `MessageHandler.ts`, `store.ts`, and `ContextTab.tsx`

### Data Truth Model

Treat these as different layers:

#### 1. Runtime truth

What the active Claude session currently knows:

- `system/init`
- `mcp_servers`

#### 2. Config truth

What the next Claude session should know:

- workspace `.mcp.json`
- user config
- managed config
- local scope via CLI-owned state

#### 3. Mutation truth

What ClaUi just changed:

- a newly added server
- a removed server
- a secret placeholder update
- imported desktop servers

The UI must clearly show when mutation truth has not yet become runtime truth.

### Delivery Plan

#### Phase 1: Read-Only Visibility

Ship first:

- status bar MCP chip
- MCP panel with `Session`, `Workspace`, `Debug`
- merged runtime/config inventory
- better Context tab MCP details
- provider-aware disabled/read-only behavior in Codex tabs

Acceptance bar:

- user can answer "what MCP servers do I have?" without leaving ClaUi
- user can tell whether the current session is stale relative to config

#### Phase 2: Guided Management

Ship next:

- add/remove/import flows
- recommended templates
- project diff preview
- SecretStorage-backed secret capture
- restart/reconnect CTA after mutation

Acceptance bar:

- user can successfully add a server from inside ClaUi without touching a terminal

#### Phase 3: In-Session Recovery And Elicitation

Ship next:

- inline auth/trust error cards
- reconnect/reset approval actions
- MCP elicitation routed through the existing approval/question UI
- server-aware tool cards

Acceptance bar:

- when MCP fails mid-task, the user gets a clear recovery path in the chat UI

#### Phase 4: Authoring Helpers And Analytics

Ship after the management flow is stable:

- resource mentions in the input UI
- prompt quick insert / autocomplete where discoverable
- preserve server identity in dashboards and VPM analytics

Acceptance bar:

- users can discover and reuse MCP capabilities without memorizing raw names

#### Phase 5: Team And Enterprise Polish

Optional but valuable:

- managed-policy visibility
- recommended project server packs
- richer diagnostics export
- workspace/team onboarding flows for project-scoped MCP

## Open Questions

1. Does the current Claude CLI expose structured output for `claude mcp list/get`, or do we need a resilient text parser?
2. Can `/mcp` actions be driven reliably through the current stream-json session path, or should restart/reconnect stay out-of-band?
3. How much prompt/resource metadata is discoverable in a stable machine-readable form?
4. How is `local` scope best surfaced if its storage remains CLI-owned rather than file-owned?
5. Should project-scope mutation always go through `claude mcp add/remove`, or should ClaUi directly edit `.mcp.json` for better diff UX?

## Recommended First Slice

Start with read-only inventory and session-vs-config visibility.

That is the smallest slice that delivers immediate value, has low protocol risk, and creates the foundation for the higher-touch wizard and in-chat recovery flows.

It also gives ClaUi a much better MCP story quickly:

- users see what is active
- users see what is configured
- users understand why something is not working
- future management flows have a natural home
