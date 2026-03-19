# Environment Sanitization & API Key Management

## Purpose

All spawned CLI processes inherit `process.env` from the VS Code extension host. If a user has `ANTHROPIC_API_KEY` in their system environment, the Claude CLI picks it up and uses API-key auth instead of subscription auth -- causing "Credit balance is too low" errors on subscription-only accounts.

This module:
1. **Strips** inherited `ANTHROPIC_API_KEY` from all spawned processes (prevents accidental API key usage)
2. **Provides** an explicit API key input in the Settings panel so users CAN intentionally use an API key

## Key Files

| File | Purpose |
|------|---------|
| `src/extension/process/envUtils.ts` | Shared utility: env sanitization, key storage, key masking |
| `src/extension/types/webview-messages.ts` | `SetApiKeyRequest` and `ApiKeySettingMessage` message types |
| `src/webview/components/Vitals/VitalsInfoPanel.tsx` | API Key UI row (Set/Clear/masked display), alongside separate Claude Account login/logout controls |
| `src/webview/state/store.ts` | `hasApiKey`, `maskedApiKey` state fields |
| `src/webview/hooks/useClaudeStream.ts` | Handles `apiKeySetting` message from extension |

## Core Functions (`envUtils.ts`)

### `deleteEnvCaseInsensitive(env, target)`
Iterates all env keys and deletes any whose `toUpperCase()` matches the target. Required because Windows env vars are case-insensitive but Node.js preserves casing (e.g., `Anthropic_Api_Key` would survive a simple `delete env.ANTHROPIC_API_KEY`).

### `buildSanitizedEnv(): NodeJS.ProcessEnv`
Clones `process.env`, then strips:
- `CLAUDECODE` (nested-session prevention)
- `CLAUDE_CODE_ENTRYPOINT` (nested-session prevention)
- `ANTHROPIC_API_KEY` (prevents accidental API key auth)

Used by **Codex** processes (no key injection -- prevents secret leakage into agent-executed commands).

### `buildClaudeCliEnv(apiKey?: string): NodeJS.ProcessEnv`
Starts from `buildSanitizedEnv()`, then injects the user's explicit API key if provided. Used by all **Claude CLI** spawn points.

### `getStoredApiKey(secrets: vscode.SecretStorage): Promise<string | undefined>`
Reads the API key from VS Code SecretStorage. Key name: `claudeMirror.anthropicApiKey`.

### `setStoredApiKey(secrets: vscode.SecretStorage, apiKey: string): Promise<void>`
Stores or clears the API key. Empty string = delete.

### `maskApiKey(key: string | undefined): string`
Returns `****abcd` (last 4 chars) or empty string.

## Spawn Points (9 total)

All 9 CLI spawn points use `envUtils`:

| # | File | Function Used | Key Injection |
|---|------|---------------|---------------|
| 1 | `ClaudeProcessManager.ts` | `buildClaudeCliEnv(apiKey)` | Yes (reads from SecretStorage before spawn) |
| 2 | `CodexExecProcessManager.ts` | `buildSanitizedEnv()` | No (Codex path) |
| 3 | `SessionNamer.ts` | `buildClaudeCliEnv(apiKey)` | Yes (apiKey param) |
| 4 | `MessageTranslator.ts` | `buildClaudeCliEnv(apiKey)` | Yes (apiKey param) |
| 5 | `TurnAnalyzer.ts` | `buildClaudeCliEnv(this.apiKey)` | Yes (setApiKey setter) |
| 6 | `ActivitySummarizer.ts` | `buildClaudeCliEnv(this.apiKey)` | Yes (setApiKey setter) |
| 7 | `PromptEnhancer.ts` | `buildClaudeCliEnv(apiKey)` | Yes (apiKey param) |
| 8 | `AchievementInsightAnalyzer.ts` | `buildClaudeCliEnv(this.apiKey)` | Yes (refreshes from SecretStorage before spawn) |
| 9 | `ClaudeCliCaller.ts` | `buildClaudeCliEnv(this.apiKey)` | Yes (setApiKey setter, propagated from PhaseOrchestrator) |

**Skipped:** `PythonPhaseRunner.ts` spawns Python, not Claude CLI.

## API Key Threading

### On-demand spawners (apiKey parameter)
`SessionNamer`, `MessageTranslator`, `PromptEnhancer` -- the caller reads the key from SecretStorage just before calling.

### Scheduler-based spawners (setApiKey setter)
`TurnAnalyzer`, `ActivitySummarizer`, `AchievementInsightAnalyzer` -- receive the key via setter. `MessageHandler.refreshSchedulerApiKeys()` updates all three when the key changes and on session `ready`.

### Process managers (centralized reading)
`ClaudeProcessManager` reads the key from `this.context.secrets` in `start()`. `CodexExecProcessManager` only sanitizes.

### Global services (setSecrets)
`SkillGenService` and `AchievementInsightAnalyzer` are created in `extension.ts` outside any SessionTab. They receive `context.secrets` via `setSecrets()` and read the key fresh before each operation.

## Message Protocol

### Webview -> Extension
```typescript
interface SetApiKeyRequest {
  type: 'setApiKey';
  apiKey: string;  // empty string = clear
}
```

### Extension -> Webview
```typescript
interface ApiKeySettingMessage {
  type: 'apiKeySetting';
  hasKey: boolean;
  maskedKey: string;  // e.g. "****abcd" or ""
}
```

Sent on: webview `ready` event, after key set/clear.

## Settings UI

Located in `VitalsInfoPanel.tsx` (gear icon panel next to Vitals):

- **No key set**: Shows "Set" button. Clicking reveals a password input + Save/Cancel.
- **Key set**: Shows masked value (e.g., `****abcd`) + "Clear" button.
- Enter submits, Escape cancels.
- Key is stored in OS keychain via VS Code SecretStorage (`claudeMirror.anthropicApiKey`).
- Claude subscription login/logout is a separate row ("Claude Account") and uses Claude CLI auth commands, not SecretStorage.

## Security

- API key is stored in VS Code SecretStorage (OS keychain), never in settings or files
- Logging only outputs `hasAnthropicKey=true/false`, never the actual key value
- Codex processes never receive the API key (prevents leakage into agent-executed commands)
- Case-insensitive env var deletion prevents Windows bypass via alternate casing
