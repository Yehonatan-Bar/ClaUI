# Codex Fast Mode

Snapshot: 2026-05-05

## User Surface

Codex tabs now expose a `Speed` selector inside the AI chip, next to the Codex model and reasoning selectors.

- `Default` leaves Codex CLI/config behavior untouched.
- `Fast` applies Codex Fast mode to new Codex turns.

The selector is available only in Codex tabs and changes apply on the next spawned Codex turn.

## Setting

VS Code setting:

- `claudeMirror.codex.serviceTier`
- Type: `"" | "fast"`
- Default: `""`

The empty value means ClaUi does not pass any service-tier override, so user-level `~/.codex/config.toml` and Codex CLI defaults still decide.

## Runtime

`CodexExecProcessManager` reads `claudeMirror.codex.serviceTier` for each `runTurn()` call. When the value is `fast`, it appends these Codex CLI config overrides to both first turns and resumed turns:

```text
-c service_tier="fast" -c features.fast_mode=true
```

This affects:

- `codex exec --json ... -`
- `codex exec ... resume --json <threadId> -`
- Codex BTW background turns, because they share `CodexExecProcessManager`

Auxiliary one-shot Codex calls that do not use `CodexExecProcessManager` remain unchanged:

- Codex auto session naming
- End-of-session summarizer Codex fallback

## Message Flow

- Webview request: `setCodexServiceTier`
- Extension update: `codexServiceTierSetting`
- Store state: `selectedCodexServiceTier`
- UI component: `CodexServiceTierSelector`

## Files

- `package.json`
- `src/extension/types/webview-messages.ts`
- `src/extension/webview/CodexMessageHandler.ts`
- `src/extension/process/CodexExecProcessManager.ts`
- `src/webview/state/store.ts`
- `src/webview/hooks/useClaudeStream.ts`
- `src/webview/components/ModelSelector/CodexServiceTierSelector.tsx`
- `src/webview/components/StatusBar/AIChip.tsx`
