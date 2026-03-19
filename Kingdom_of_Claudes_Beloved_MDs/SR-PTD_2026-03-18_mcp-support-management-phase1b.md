# SR-PTD - MCP Support Management Phase 1B

## Summary

Completed the remaining MCP plan on top of the Phase 1A visibility foundation.

This slice adds:

- guided add/import/remove/reset/restart flows
- curated template catalog
- project-scope diff preview before save
- SecretStorage-backed MCP secret handling
- restart-aware mutation tracking and CTAs
- provider-aware read-only gating outside Claude tabs

## Requirement Traceability

### Runtime/config/mutation separation

- `src/extension/mcp/McpRegistryService.ts`
- `src/extension/webview/MessageHandler.ts`
- `src/webview/state/store.ts`

### CLI-safe MCP mutations via `execFile`

- `src/extension/mcp/McpCliService.ts`

### Guided templates

- `src/extension/mcp/McpTemplateCatalog.ts`
- `src/webview/components/McpPanel/McpQuickAdd.tsx`
- `src/webview/components/McpPanel/McpAddWizard.tsx`

### SecretStorage-backed secrets with placeholder writes

- `src/extension/mcp/McpSecretsService.ts`
- `src/extension/process/ClaudeProcessManager.ts`
- `src/webview/components/McpPanel/McpAddForm.tsx`

### Project diff preview

- `src/extension/mcp/McpConfigService.ts`
- `src/extension/types/webview-messages.ts`
- `src/webview/components/McpPanel/McpAddWizard.tsx`

### Mutation handlers

- `src/extension/webview/MessageHandler.ts`

Implemented handlers:

- `mcpPreviewAddServer`
- `mcpAddServer`
- `mcpRemoveServer`
- `mcpImportDesktop`
- `mcpResetProjectChoices`
- `mcpRestartSession`

### Provider-aware UI gating

- `src/webview/components/McpPanel/McpPanel.tsx`
- `src/webview/components/McpPanel/McpWorkspaceTab.tsx`
- `src/webview/components/McpPanel/McpDebugTab.tsx`
- `src/webview/components/StatusBar/StatusBar.tsx`

## Verification

Local verification completed:

- `npm run build`
- `npm run deploy:local`
- `npm run verify:installed`

Manual VS Code session validation still requires:

- reload window
- live Claude session startup
- exercising MCP add/remove/restart/auth flows in the installed extension
