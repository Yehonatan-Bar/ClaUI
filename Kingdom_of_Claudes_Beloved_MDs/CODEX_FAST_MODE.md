# Codex Fast Mode

Snapshot: 2026-09-06

## User Surface

Codex tabs expose a `Speed` selector inside the AI chip, next to the Codex model and reasoning selectors.

- `Default` leaves Codex CLI/config behavior untouched.
- `Fast` applies Codex Fast mode to new Codex turns.

The selector is available only in Codex tabs and changes apply on the next spawned Codex turn.

### Capability-based Fast (never silently sent)

`Fast` is offered only for models whose capability metadata advertises it (`supportsFast`, derived from the CLI cache `additional_speed_tiers` / `service_tiers`, or the static fallback table `src/webview/utils/codexModels.ts`). For a model that does not support Fast, the option renders disabled (`Fast (Unavailable)`); if the saved selection is already `fast`, it renders as `Fast (Unsupported)` with a `Fast unsupported` warning chip instead of being sent silently. Fast uses more credits and can also be blocked by workspace or residency policy. Models with no metadata at all keep Fast enabled so the CLI can decide.

This is enforced end-to-end: `CodexExecProcessManager.runTurn()` drops the Fast override when the CLI cache positively reports `supportsFast === false` for the selected model (an empty cache or the default model `''` are left untouched).

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
- `src/extension/process/CodexExecProcessManager.ts` (Fast capability guard)
- `src/extension/process/codexModelCache.ts` (`supportsFast` from cache)
- `src/webview/state/store.ts`
- `src/webview/hooks/useClaudeStream.ts`
- `src/webview/utils/codexModels.ts` (`supportsFast` fallback + resolver)
- `src/webview/components/ModelSelector/CodexServiceTierSelector.tsx`
- `src/webview/components/StatusBar/AIChip.tsx`
