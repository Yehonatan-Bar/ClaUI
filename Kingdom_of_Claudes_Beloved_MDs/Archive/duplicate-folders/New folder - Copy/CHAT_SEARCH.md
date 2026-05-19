# Chat Search

## What It Does

Provides a search bar for finding text across chat messages. Two scopes:

1. **Session Search** - Instant client-side search within the current session's loaded messages
2. **Project Search** - Extension-side search across all JSONL session files for the current workspace

## Key Files

| File | Purpose |
|------|---------|
| `src/webview/components/ChatView/ChatSearchBar.tsx` | React component: search input, scope toggle, navigation, project results dropdown |
| `src/extension/session/ChatSearchService.ts` | Extension-side service for cross-session JSONL file search |
| `src/extension/types/webview-messages.ts` | Message types: `ChatSearchProjectRequest`, `ChatSearchResumeSessionRequest`, `ChatSearchProjectResultMessage`, `ChatSearchProjectResult` |
| `src/webview/state/store.ts` | Zustand state: `chatSearchOpen`, `chatSearchQuery`, `chatSearchScope`, `chatSearchMatchIds`, `chatSearchCurrentIndex`, `chatSearchProjectResults`, `chatSearchProjectLoading`, `chatSearchProjectRequestId` |
| `src/extension/webview/MessageHandler.ts` | Switch cases: `chatSearchProject`, `chatSearchResumeSession` |
| `src/webview/hooks/useClaudeStream.ts` | Handler: `chatSearchProjectResults` |
| `src/webview/styles/global.css` | CSS section: `/* Chat Search Bar */` |

## Architecture

### Session Search (Client-side)

When the user types a query in "Session" scope:
1. `setChatSearchQuery()` in Zustand store iterates `state.messages`
2. Extracts text from each message's `ContentBlock[]` (type `text` blocks only)
3. Performs case-insensitive substring match
4. Populates `chatSearchMatchIds` with matching message IDs
5. `MessageBubble` applies `search-match` / `search-current-match` CSS classes based on store state
6. Navigation arrows cycle through `chatSearchCurrentIndex` and scroll to the matching element

**Performance**: Pure in-memory, no debounce needed. Sub-millisecond for typical sessions.

### Project Search (Extension-side)

When the user types a query in "Project" scope:
1. Debounced (300ms), webview sends `chatSearchProject` message with `query` and `requestId`
2. `MessageHandler` delegates to `ChatSearchService.searchProject()`
3. Service uses `SessionDiscovery.discoverForWorkspace()` to list JSONL files (newest first)
4. For each file: reads as raw UTF-8, splits into lines, performs `line.toLowerCase().includes(queryLower)` per line
5. Only matching lines are JSON-parsed to extract role, text, and snippet context
6. Cancellation: checks `currentRequestId === requestId` between files
7. Returns max 50 results with `ChatSearchProjectResult` objects
8. Clicking a result sends `chatSearchResumeSession` which runs `claudeMirror.resumeSession` command

**Performance**: Raw string search is 10-100x faster than full JSON parsing. File iteration stops at 50 results.

## UI

- Activated via: StatusBar > Session > Search, or `Ctrl+Shift+F`
- Compact single-row bar above the message list
- Layout: `[Input] [Session|Project toggle] [match count] [arrows] [close]`
- Project results appear as a dropdown below the bar
- Escape or close button dismisses the search

## Message Flow

```
[Session Search]
User types -> setChatSearchQuery() -> filters messages in-memory -> chatSearchMatchIds updated
-> MessageBubble re-renders with search-match CSS class -> scroll to current match

[Project Search]
User types -> debounce 300ms -> postToExtension('chatSearchProject') ->
MessageHandler.handleChatSearchProject() -> ChatSearchService.searchProject() ->
reads JSONL files with raw string matching -> postMessage('chatSearchProjectResults') ->
useClaudeStream handler -> setChatSearchProjectResults() -> dropdown renders results
```
