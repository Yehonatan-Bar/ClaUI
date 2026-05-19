# MCP Support

## Scope

ClaUi now implements the planned MCP feature set through **Phase 1A + Phase 1B** for Claude tabs:

- typed runtime MCP data from `system/init`
- merged runtime/config/mutation inventory
- MCP overlay panel with `Session`, `Workspace`, `Add`, and `Debug` tabs
- status bar MCP chip
- Context tab MCP pills that open the panel
- guided add/import/remove/reset/restart flows
- project-scope diff preview before save
- SecretStorage-backed MCP secret handling with `${VAR}` placeholders
- explicit provider-aware gating for non-Claude tabs

Codex and Happy tabs remain read-only for MCP management.

## Source Of Truth Model

ClaUi keeps three MCP truth layers separate:

1. **Runtime truth**
   - Source: Claude `system/init.mcp_servers` plus runtime `tools`
   - Stored in `sessionMetadata.mcpServers`
   - Used by `McpSessionTab`

2. **Config truth**
   - Source: `.mcp.json`, `~/.claude.json`, local project entries under `projects[...]`, managed config candidates, and CLI fallback (`claude mcp list/get`)
   - Stored in `mcpInventory`
   - Used by `McpWorkspaceTab`

3. **Mutation truth**
   - Source: ClaUi-managed add/remove changes that runtime has not applied yet
   - Tracked as `mcpPendingMutations`
   - Merged through `McpRegistryService` to produce restart-aware drift

## Extension Architecture

### `src/extension/mcp/McpCliService.ts`

- wraps `claude mcp ...` with `execFile`
- uses argument arrays only
- uses `add-json` as the canonical mutation path
- parses current text output from:
  - `claude mcp list`
  - `claude mcp get <name>`

### `src/extension/mcp/McpConfigService.ts`

- reads:
  - workspace `.mcp.json`
  - user `~/.claude.json`
  - local project entries in `~/.claude.json -> projects[workspacePath].mcpServers`
  - managed config candidates
- falls back to `claude mcp list/get` when file-backed discovery is incomplete
- generates projected config diffs for add flows

### `src/extension/mcp/McpRegistryService.ts`

- builds runtime `McpServerInfo[]` from `system/init`
- preserves MCP tool ownership via `mcp__<server>__<tool>` parsing
- merges runtime truth + config truth + mutation truth
- computes:
  - `effectiveStatus`
  - `restartRequired`
  - `nextAction`
  - pending restart count

### `src/extension/mcp/McpTemplateCatalog.ts`

- ships curated templates for:
  - GitHub
  - Playwright
  - Brave Search
  - Sentry
  - Slack
  - Postgres
  - Context7
  - Codex
- uses Windows-safe defaults for stdio templates

### `src/extension/mcp/McpSecretsService.ts`

- stores MCP secret values in VS Code SecretStorage
- keeps an index so secrets can be re-hydrated into process env on future Claude runs
- removes secrets when a server is removed from the same scope
- never sends raw secret values back to the webview

## Secret Handling Model

Project/user/local configs store only placeholders such as:

```json
{
  "headers": {
    "Authorization": "Bearer ${GITHUB_TOKEN}"
  }
}
```

The real `GITHUB_TOKEN` value is stored in SecretStorage.

When ClaUi launches Claude CLI, it injects the indexed MCP secret env vars into the spawned process so placeholder expansion works for ClaUi-run sessions.

Important limitation:

- this env injection only applies to Claude sessions launched by ClaUi
- external terminal `claude` runs still need their own environment configured

## Message Flow

### Runtime init

`MessageHandler.ts` now:

1. receives `system/init`
2. converts `event.mcp_servers` into typed runtime MCP objects
3. stores them in `sessionMetadata.mcpServers`
4. reads config snapshot through `McpConfigService`
5. merges through `McpRegistryService`
6. posts `mcpInventory` to the webview

### Webview ready

On `ready`, the handler now sends:

- `mcpCatalog`
- config-derived `mcpInventory`

This allows the Add tab and status chip to work even before a Claude session starts.

### Mutation flows

Implemented requests:

- `mcpPreviewAddServer`
- `mcpAddServer`
- `mcpRemoveServer`
- `mcpImportDesktop`
- `mcpResetProjectChoices`
- `mcpRestartSession`

After successful mutations ClaUi:

1. writes through Claude CLI
2. stores secrets if present
3. records pending mutation truth when needed
4. rebuilds merged inventory
5. posts `mcpOperationResult`
6. surfaces restart/reconnect CTAs in the panel

## Webview State

`src/webview/state/store.ts` now separates:

- `sessionMetadata.mcpServers`
  - runtime-only
- `mcpInventory`
  - merged runtime/config/mutation inventory
- `mcpTemplates`
  - guided add template catalog
- `mcpDiffPreview`
  - projected `.mcp.json` diff for add flows
- `mcpPanelOpen`
- `mcpSelectedTab`
- `mcpPendingRestartCount`
- `mcpLoading`
- `mcpLastError`
- `mcpLastOperation`
- `mcpConfigPaths`

## UI Surfaces

### Status bar

`StatusBar.tsx` adds an MCP chip:

- `MCP <count>`
- `MCP <count> | restart needed`
- `MCP <count> | <n> needs login`
- `MCP error`
- `MCP read-only`

### Context tab

`ContextTab.tsx` shows typed MCP pills:

- color reflects merged status
- tool count is included when available
- clicking a pill opens the MCP panel on the `Session` tab

### MCP panel

`src/webview/components/McpPanel/`

- `Session`
  - active-session runtime truth
  - tool grouping by server
  - drift banner when config/runtime differ
- `Workspace`
  - configured truth grouped by scope
  - remove action per configured server
- `Add`
  - recommended templates
  - custom stdio/http/sse forms
  - Claude Desktop import
  - project diff preview before save
- `Debug`
  - config paths
  - runtime vs configured comparison
  - last error / last operation
  - copyable commands
  - reset project approval choices
- prominent `Report MCP issue` CTA in the panel header
  - opens the shared bug report overlay with MCP-specific prefill
  - attaches the current MCP inventory snapshot to the report preview, AI diagnosis prompt, ZIP, and final submission

## Provider Behavior

- **Claude tabs**
  - full Phase 1A/1B MCP visibility and management
- **Codex tabs**
  - explicit read-only panel behavior
  - no add/remove/import/reset/restart actions
  - refresh, open-config, and open-logs remain available for discovery/debugging
- **Happy tabs**
  - same read-only treatment as non-Claude providers

## Current Limitations

- no in-session auth recovery card yet
- no config watchers yet
- no MCP resource `@` mention integration yet
- no MCP prompt discovery in slash-command UI yet
- no in-place edit flow; updates still mean remove + re-add

## Verification Notes

Primary verification path:

- `npm run deploy:local`
- reload VS Code
- `npm run verify:installed`
- start a Claude session
- confirm:
  - MCP chip count/status
  - Session tab runtime truth
  - Workspace tab scoped config truth
  - Add tab template/custom/import flows
  - `Report MCP issue` opens the bug report overlay with MCP wording and attached MCP snapshot preview
  - project diff preview before save
  - remove/import/reset/restart actions
  - Debug tab paths/commands/log button
  - Context pills open MCP panel
  - Codex tabs remain read-only
