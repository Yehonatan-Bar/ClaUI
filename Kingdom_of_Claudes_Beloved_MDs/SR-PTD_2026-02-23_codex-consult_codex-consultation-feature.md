# SR-PTD - Codex Consultation Feature

**Date**: 2026-02-23 | **Type**: Feature | **Domain**: ClaUi Extension / UI | **Complexity**: Medium

## Trigger
> User requested a "Consult Codex" button in ClaUi that opens an input panel, enriches the user's question with system context via Claude, calls the mcp__codex__codex MCP tool, displays the response in chat, and feeds it back to Claude to continue development.

## Workflow (numbered steps)
1. Added `CodexConsultRequest` message type to `src/extension/types/webview-messages.ts`
2. Added `codexConsultPanelOpen` boolean state + action to Zustand store (`src/webview/state/store.ts`)
3. Created `CodexConsultPanel` React component (`src/webview/components/InputArea/CodexConsultPanel.tsx`) following GitPushPanel pattern
4. Added "Consult" button to StatusBar in both expanded and collapsed modes (`src/webview/components/StatusBar/StatusBar.tsx`)
5. Rendered `CodexConsultPanel` conditionally in `App.tsx` above InputArea
6. Handled `codexConsult` message in `MessageHandler.ts` - builds structured prompt instructing Claude to enrich context and call `mcp__codex__codex`
7. Added CSS styles for panel (`.codex-consult-*`) and StatusBar button (`.status-bar-consult-btn`) in `global.css`
8. Built and deployed via `npm run deploy:local`
9. Updated TECHNICAL.md index + created detail doc `Kingdom_of_Claudes_Beloved_MDs/CODEX_CONSULTATION.md`

## Key Decisions
- **Architecture**: Send structured prompt to running Claude CLI instead of building separate backend -> Simplest approach, uses existing MCP tool access
- **UI placement**: Panel above InputArea (like GitPushPanel) + button in StatusBar -> Consistent with existing patterns
- **Prompt design**: Instructional prompt telling Claude to enrich + call mcp__codex__codex -> Claude naturally adds codebase context from conversation

## Knowledge Used
- **Code patterns**: GitPushPanel component pattern, StatusBar button pattern, WebviewToExtensionMessage union pattern, MessageHandler switch-case pattern
- **Architecture**: Webview <-> Extension postMessage protocol, ControlProtocol.sendText() for CLI injection, Zustand store state management
- **MCP**: `mcp__codex__codex` tool is available to the Claude CLI process but not directly to the extension

## Code Written

### CodexConsultPanel.tsx (new file - reusable pattern)
React component with textarea + submit button. Auto-focuses on mount. Ctrl+Enter sends, Escape closes. Disabled when busy or disconnected.

### MessageHandler codexConsult case (extension-side)
Builds multi-line structured prompt with instructions for Claude to enrich context and call Codex MCP tool. Sends via `control.sendText()`.

## Output Format
Structured prompt template sent to Claude CLI:
```
[Codex Consultation Request]
The user wants to consult with the Codex GPT expert...
INSTRUCTIONS: 1-4 steps...
USER'S QUESTION: {question}
```

## Issues -> Fixes
- No issues encountered during implementation

## Files Modified
| File | Change |
|------|--------|
| `src/extension/types/webview-messages.ts` | Added `CodexConsultRequest` type + union member |
| `src/webview/state/store.ts` | Added `codexConsultPanelOpen` state, action, reset |
| `src/webview/components/StatusBar/StatusBar.tsx` | Added Consult button (expanded + collapsed) |
| `src/webview/App.tsx` | Import + conditional render of CodexConsultPanel |
| `src/extension/webview/MessageHandler.ts` | Handle `codexConsult` message, build prompt, send to CLI |
| `src/webview/styles/global.css` | Panel styles + button styles |
| `TECHNICAL.md` | Added index entry + directory tree entry |

## Files Created
| File | Purpose |
|------|---------|
| `src/webview/components/InputArea/CodexConsultPanel.tsx` | Consultation input panel component |
| `Kingdom_of_Claudes_Beloved_MDs/CODEX_CONSULTATION.md` | Detail documentation |
| `Kingdom_of_Claudes_Beloved_MDs/PLAN_CODEX_CONSULTATION.html` | Hebrew management plan |

## Skill Potential: Medium
**Notes**: The "send structured prompt to Claude CLI to trigger MCP tool" pattern is reusable for other MCP integrations. The panel component pattern is well-established in the codebase.

## Tags
Languages: TypeScript, CSS | Domain: VS Code Extension, UI, MCP Integration | Services: Codex MCP
