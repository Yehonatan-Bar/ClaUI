# Provider Handoff (Claude <-> Codex)

## Goal

Allow switching providers mid-session while preserving practical task continuity via a structured handoff capsule.

## What Happens

1. User triggers `Switch (Carry Context)` from status bar (or command palette command).
2. Extension validates source tab is idle and handoff feature is enabled.
3. Source tab snapshot is collected and normalized.
4. A `HandoffCapsule` is built and (optionally) persisted as JSON/Markdown artifact under managed logs.
5. Target provider tab is opened with `forkInit` history copy for visual continuity.
6. Target starts a clean session and stages one-time handoff context in memory (no automatic send to the model).
7. On the first user message in the target tab, the staged context is prepended to that user turn payload and consumed.
8. Handoff is marked completed immediately after staging; UI continues as a normal chat flow.

## State Machine

- `idle`
- `collecting_context`
- `creating_target_tab`
- `starting_target_session`
- `arming_first_user_prompt`
- `completed`
- `failed`

## Safety/Hardening

- Busy guard: cannot switch while current turn is running.
- Per-tab lock: prevents duplicate concurrent switches.
- Cooldown: prevents rapid ping-pong switching.
- Secret redaction before artifact persistence.
- Failure fallback: user can copy manual capsule prompt and send manually.

## Settings

- `claudeMirror.handoff.enabled`
- `claudeMirror.handoff.storeArtifacts`

## Main Files

- `src/extension/session/handoff/HandoffTypes.ts`
- `src/extension/session/handoff/HandoffContextBuilder.ts`
- `src/extension/session/handoff/HandoffPromptComposer.ts`
- `src/extension/session/handoff/HandoffArtifactStore.ts`
- `src/extension/session/handoff/HandoffOrchestrator.ts`
- `src/extension/session/TabManager.ts`
- `src/webview/components/StatusBar/StatusBar.tsx`
- `src/webview/components/InputArea/InputArea.tsx`
- `src/webview/state/store.ts`
- `src/extension/types/webview-messages.ts`
