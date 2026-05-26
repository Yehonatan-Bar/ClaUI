# Fork Context Truncation - Solution Specification

## The Need

When a user forks a conversation from message N (e.g., at 40% of the conversation), **the model should only see messages 1..N-1**. Currently, the fork is cosmetic only: the UI shows the truncated history, but the CLI session retains the full conversation. The context utilization bar correctly reflects this -- it stays high because the model truly processes the entire original context.

The user expects (and rightfully so) that forking at an early point means the model gets a fresh, shorter context -- as if the conversation had only reached that point.

---

## Current Architecture

### Fork Flow (step by step)

**1. User clicks "Fork" on message N in the UI**

File: `src/webview/components/ChatView/MessageList.tsx:67-85`

```typescript
const messageIndex = state.messages.findIndex((m) => m.id === messageId);
const messagesBeforeFork = state.messages.slice(0, messageIndex);
postToExtension({
  type: 'forkFromMessage',
  sessionId,
  forkMessageIndex: messageIndex,
  promptText: messageText,       // text of message N (to pre-fill the input)
  messages: messagesBeforeFork,  // messages 0..N-1 (for UI display only)
});
```

**2. Extension receives the request and creates a new tab**

File: `src/extension/commands.ts:784-803`

```typescript
const tab = tabManager.createTabForProvider(sourceProvider);
tab.setForkInit({ promptText, messages: messages || [] });
await tab.startSession({ resume: sessionId, fork: true });
```

Key: `resume: sessionId` is the **original** session ID (the full conversation).

**3. SessionTab starts the CLI process**

File: `src/extension/session/SessionTab.ts:910-958`

- Calls `processManager.start({ resume: sessionId, fork: true })`
- Then sends `forkInit` message to the webview with only the truncated messages
- Skips `--replay-user-messages` for forks (line 93-96 in ClaudeProcessManager)

**4. CLI is spawned with full-session fork**

File: `src/extension/process/ClaudeProcessManager.ts:128-132`

```typescript
if (options?.resume) {
  args.push('--resume', options.resume);
  if (options.fork) {
    args.push('--fork-session');
  }
}
```

Final CLI command:
```
claude -p --verbose --output-format stream-json --input-format stream-json
       --include-partial-messages --resume <ORIGINAL_SESSION_ID> --fork-session
```

**5. Webview displays the truncated history**

File: `src/webview/hooks/useClaudeStream.ts:702-719`

The `forkInit` handler hydrates the store with `messagesBeforeFork` -- so the UI only shows messages up to the fork point.

**6. User sends a message, model responds**

The CLI's `message_start` event includes `inputTokens` reflecting the **full** original session context + the new message. The context bar reads this value and shows it hasn't decreased.

---

## The Problem (Visual Summary)

```
Original conversation: [msg1] [msg2] [msg3] [msg4] [msg5] [msg6] [msg7] [msg8] [msg9] [msg10]
                                              ^
                              User forks here (from msg4)

What the UI shows:     [msg1] [msg2] [msg3]  + input pre-filled with msg4 text
What the CLI has:      [msg1] [msg2] [msg3] [msg4] [msg5] [msg6] [msg7] [msg8] [msg9] [msg10]
What the API sees:     [msg1] [msg2] [msg3] [msg4] [msg5] [msg6] [msg7] [msg8] [msg9] [msg10] + new message

Context bar shows: ~100% (correct for what the API actually processes)
User expects:      ~40%  (only messages up to the fork point)
```

The `--fork-session` CLI flag creates a **complete copy** of the session. There is no `--fork-at-message N` concept. The `forkMessageIndex` parameter sent from the webview is used **only** for selecting which messages to display in the UI -- it never reaches the CLI.

---

## The Gap

The disconnect is between two layers:

| Layer | What it knows | What it does with the fork |
|-------|---------------|---------------------------|
| **Webview** | Knows the fork point (messageIndex) | Shows only messages before the fork point |
| **Extension** | Receives messageIndex but doesn't use it for CLI | Passes only `sessionId` + `fork: true` to CLI |
| **CLI** | Knows nothing about the fork point | Creates a full copy of the session |
| **API** | Gets the full context | Processes everything, reports high inputTokens |

---

## Investigation Results

### 1. CLI Input Protocol (stdin)

The CLI accepts exactly **two** message types via stdin:

| Type | Schema | Purpose |
|------|--------|---------|
| `UserInputMessage` | `{ type: 'user', message: { role: 'user', content: string \| ContentBlock[] } }` | Send a user message |
| `ControlRequest` | `{ type: 'control_request', request: { subtype: 'compact' \| 'cancel' } }` | Compact or cancel |

**There is no way to inject assistant messages via stdin.** The CLI only accepts `role: 'user'` messages. We cannot reconstruct conversation history through the stdin pipe.

### 2. Session File Format

Sessions are stored as JSONL files at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`.

**Path encoding**: workspace path with `:`, `\`, `/` replaced by `-` (e.g., `C:\projects\app` -> `c--projects-app`).

**Event types stored in JSONL** (only these five; notably `result` and `system` are NOT stored):

| Type | Content | Has `promptId`? | Has `uuid/parentUuid`? |
|------|---------|-----------------|------------------------|
| `queue-operation` | `{ operation: 'enqueue'\|'dequeue', timestamp, sessionId, content }` | No | No |
| `attachment` | `{ cwd, sessionId, version, gitBranch, ... }` | No | Yes |
| `user` | `{ message: { role: 'user', content: ... }, promptId, isMeta?, ... }` | Yes | Yes |
| `assistant` | `{ message: { id, role: 'assistant', content: ContentBlock[], model }, ... }` | No | Yes |
| `last-prompt` | Marker for most recently submitted prompt | No | No |

**Key structural properties:**
- Every entry (except `queue-operation` and `last-prompt`) has a `uuid` and `parentUuid`, forming a linked chain
- All events within a single user prompt (including intermediate tool_result user messages and assistant responses) share the same `promptId`
- Multiple `assistant` entries with the same `message.id` represent partial blocks of a single response (must be merged)
- `user` entries where `content` contains `tool_result` blocks are intermediate agentic-loop messages (not real user input)

**Example turn structure in JSONL:**
```
queue-operation (enqueue)
queue-operation (dequeue)
attachment (session metadata)
user (real user message, promptId=A)          ← UI message: user[0]
attachment (hook outputs)
last-prompt
assistant (msg_01xxx, block 1)                 ← UI message: assistant[0]
assistant (msg_01xxx, block 2)                     (merged with above)
assistant (msg_01xxx, block 3)                     (merged with above)
user (tool_result, promptId=A)                 ← invisible to UI
assistant (msg_02yyy, block 1)                 ← UI message: assistant[1]
user (tool_result, promptId=A)                 ← invisible to UI
assistant (msg_03zzz, block 1)                 ← UI message: assistant[2]
assistant (msg_03zzz, block 2)                     (merged with above)
queue-operation (enqueue)                      ← next user turn starts
queue-operation (dequeue)
user (real user message, promptId=B)          ← UI message: user[1]
...
```

### 3. CLI Resume Mechanism

`--resume <session-id>` tells the CLI to find `<session-id>.jsonl` in the project directory and reconstruct the conversation from its contents. The CLI reads the file, rebuilds the message array, and sends it to the API on the next user message.

`--fork-session` (combined with `--resume`) creates a **new session branched from the given session**. The CLI copies the full conversation and assigns a new session ID. There is no `--fork-at-turn` or truncation parameter.

### 4. Ruled-Out Approaches

| Approach | Why it fails |
|----------|-------------|
| **Inject history via stdin** | stdin only accepts `role: 'user'` messages; can't send assistant turns |
| **Compact after fork** | Summarizes rather than truncates; unpredictable; model may retain information from after the fork point in its summary |
| **System prompt injection** | `--append-system-prompt` is system-level context, not structured conversation; loses tool results, structured turns |
| **Handoff-style text prepend** | Squashes structured multi-turn conversation into a single text blob; loses tool_use/tool_result structure |

---

## Solution: Session File Truncation

### Core Idea

Instead of using `--fork-session` (which copies the full session), we **create a truncated JSONL file** containing only events up to the fork point, then resume it as a normal session.

```
Current Flow:
  CLI: --resume <original-session> --fork-session
  Result: full session copy, full context

New Flow:
  Extension: read original JSONL → truncate → write new JSONL
  CLI: --resume <new-truncated-session>  (no --fork-session needed)
  Result: CLI only sees messages up to fork point, reduced context
```

### Why This Works

1. The CLI's `--resume` loads sessions from JSONL files -- if the file only contains events up to message N-1, the CLI reconstructs only those messages
2. The JSONL format is simple (one JSON object per line) and we already have `ConversationReader` that parses it
3. The `parentUuid` chain is intact for all included entries (we only remove from the tail)
4. No CLI modifications required -- we use existing `--resume` behavior
5. The API context genuinely shrinks, so `inputTokens` drops and the context bar reflects reality

---

## Detailed Design

### New Component: `SessionTruncator`

**File**: `src/extension/session/SessionTruncator.ts`

A service that creates a truncated copy of a session JSONL file.

```typescript
interface TruncationResult {
  newSessionId: string;    // UUID of the truncated session
  jsonlPath: string;       // Path to the new JSONL file
  linesWritten: number;    // For diagnostics
  uiMessagesKept: number;  // Number of UI-visible messages in the truncated session
}

class SessionTruncator {
  /**
   * Create a truncated copy of a session JSONL file.
   * @param originalSessionId - The session to truncate
   * @param forkMessageIndex - UI message index to fork from (messages 0..index-1 are kept)
   * @param workspacePath - Workspace path for finding the JSONL file
   * @returns TruncationResult with the new session ID, or null on failure
   */
  truncateSession(
    originalSessionId: string,
    forkMessageIndex: number,
    workspacePath?: string
  ): TruncationResult | null;
}
```

### Turn Boundary Detection Algorithm

The critical challenge is mapping UI message indices (what the webview knows) to JSONL line ranges (what the file contains).

**Step 1: Parse JSONL and classify each line**

```
For each JSONL line, determine its role:
  - METADATA: queue-operation, attachment, last-prompt
  - REAL_USER: user entry with no tool_result blocks and isMeta !== true
  - TOOL_RESULT_USER: user entry with tool_result blocks
  - META_USER: user entry with isMeta === true
  - ASSISTANT: assistant entry (track message.id for merge grouping)
```

**Step 2: Map lines to UI message indices**

Using the same logic as `ConversationReader.parseMessages()`:

```
uiMessageIndex = 0
pendingAssistantIds = []  // ordered list of unique assistant message IDs

For each line:
  If REAL_USER or TOOL_RESULT_USER (flush trigger):
    For each unique assistant ID in pendingAssistantIds:
      → maps to UI message at uiMessageIndex (assistant)
      uiMessageIndex++
    Clear pendingAssistantIds

    If REAL_USER:
      → maps to UI message at uiMessageIndex (user)
      uiMessageIndex++
    // TOOL_RESULT_USER and META_USER: no UI message increment

  If ASSISTANT:
    If message.id not in pendingAssistantIds:
      pendingAssistantIds.append(message.id)

  If META_USER:
    Flush pending assistants (same as above)
    → maps to UI message at uiMessageIndex (synthetic assistant)
    uiMessageIndex++
```

**Step 3: Determine cut point**

Given `forkMessageIndex`, find the JSONL line number where `uiMessageIndex` first reaches `forkMessageIndex`. Include all lines BEFORE that point.

**Special handling for trailing assistant messages**: If the last included UI message is an assistant response in the middle of an agentic loop (i.e., followed by a `tool_result` user message), we must also include that `tool_result` message. The Anthropic API **requires** that every `tool_use` block in an assistant message is followed by a corresponding `tool_result` in the next user message. Truncating between a `tool_use` and its `tool_result` would cause an API error.

**Rule**: After determining the initial cut point, scan forward:
- If the last included assistant message contains `tool_use` blocks AND the next JSONL line is a `tool_result` user message referencing those tool IDs, include that line too
- Repeat until there's no dangling `tool_use` without a `tool_result`

### Writing the Truncated File

**Step 4: Generate new session**

```
1. Generate a new UUID (crypto.randomUUID())
2. Determine the output path: same directory as original, named <new-uuid>.jsonl
3. Write lines 0..cutPoint to the new file, with these modifications:
   a. In queue-operation entries: update sessionId to the new UUID
   b. In attachment entries: update sessionId to the new UUID
   c. In user/assistant entries that have sessionId: update to new UUID
   d. Remove the last `last-prompt` entry (or leave it -- the CLI writes a new one on resume)
4. Return TruncationResult
```

**Why update sessionId?** The CLI may use the `sessionId` field in the JSONL for internal consistency checks. Using the new UUID ensures the CLI treats this as a coherent session.

**Why same directory?** The CLI resolves session files relative to the project directory (`~/.claude/projects/<hash>/`). Placing the truncated file in the same directory ensures `--resume <new-id>` finds it.

### Modified Fork Flow

**File changes:**

#### 1. `src/extension/commands.ts` (lines 784-803)

```typescript
// BEFORE:
const tab = tabManager.createTabForProvider(sourceProvider);
tab.setForkInit({ promptText, messages: messages || [] });
await tab.startSession({ resume: sessionId, fork: true });

// AFTER:
const tab = tabManager.createTabForProvider(sourceProvider);
tab.setForkInit({ promptText, messages: messages || [] });

// Attempt truncated fork
const truncator = new SessionTruncator(log);
const result = truncator.truncateSession(sessionId, forkMessageIndex, workspacePath);

if (result) {
  // Resume the truncated session (no --fork-session needed)
  log(`Truncated fork: created ${result.newSessionId} with ${result.uiMessagesKept} messages`);
  await tab.startSession({ resume: result.newSessionId });
} else {
  // Fallback: use the old full-copy fork behavior
  log(`Truncation failed, falling back to full fork`);
  await tab.startSession({ resume: sessionId, fork: true });
}
```

#### 2. `src/extension/session/SessionTab.ts` (line 932-938)

No changes to `startSession` itself -- the truncated fork uses `resume` without `fork: true`, so existing code handles it:
- `processManager.start({ resume: newSessionId })` -- CLI loads the truncated file
- No `--fork-session` flag is added (because `fork` is not set)
- `--replay-user-messages` IS added (because `fork` is not set) -- but we override this for truncated forks

Wait -- this is a subtle point. For truncated forks, we do NOT want `--replay-user-messages` because the webview already has the message history (from `forkInit`). We need a way to pass `skipReplay: true`.

**Updated approach**: Add a `skipReplay` option to `startSession`:

```typescript
// In commands.ts:
await tab.startSession({ resume: result.newSessionId, skipReplay: true });

// In SessionTab.startSession: pass skipReplay through to processManager
await this.processManager.start({
  ...(options ?? {}),
  skipReplay: options?.skipReplay,
  ...
});
```

`ClaudeProcessManager.start` already supports `skipReplay` (line 95), so this just requires threading it through.

#### 3. `src/extension/process/ClaudeProcessManager.ts`

No changes needed -- `skipReplay` is already supported, and without `fork: true` the `--fork-session` flag is not added.

### Edge Cases

#### 1. Fork from a real user message (the common case)

User forks from their own message (e.g., "I want to rephrase this question"). Cut point is right before this user message. Clean boundary.

#### 2. Fork from an assistant message in the middle of an agentic loop

The assistant used a tool, and the user wants to fork from that response. The preceding JSONL structure might be:

```
assistant (tool_use: Read file)
user (tool_result: file contents)      ← this is invisible in UI
assistant (text: "I read the file...")  ← user forks from HERE
user (tool_result: next tool)          ← this would be cut
```

In this case, the cut point falls after the forked assistant message. Since the forked message is the last thing the model said, there's no dangling tool_use. Clean.

#### 3. Fork from an assistant message that ends with tool_use

Less common but possible if the UI shows an assistant message mid-tool-loop. The last content block is `tool_use`, and the next line is `tool_result`.

**Solution**: Include the `tool_result` user message as well (the "scan forward" rule from Step 3). This extends the cut slightly but maintains API validity.

#### 4. Very short session (1-2 messages)

If the fork is from message index 1 (first assistant response), the truncated file contains only the preamble + first user message + first assistant response. The CLI should handle this gracefully.

#### 5. Session file not found

If the JSONL file doesn't exist (e.g., Codex provider, or file was cleaned up), `truncateSession` returns `null` and we fall back to the old fork behavior.

#### 6. Permission/disk errors

If we can't read the source or write the truncated file, return `null` and fall back.

---

## Verification Plan

### Phase 1: Manual Validation

1. Pick a known multi-turn session with at least 5 user messages
2. Run the truncation algorithm manually (in a test script)
3. Write the truncated JSONL file
4. Run `claude -p --resume <truncated-session-id> --output-format stream-json` and verify:
   - The CLI accepts the file without errors
   - The CLI emits a `system` init event
   - Sending a user message produces a response
   - The `message_start` event shows reduced `inputTokens` compared to the full session

### Phase 2: Automated Tests

Create test fixtures with known JSONL content and verify:

| Test | Input | Expected |
|------|-------|----------|
| Simple 3-turn session, fork at msg 2 | 3 user messages, 3 assistant responses | Truncated file has 1 user + 1 assistant |
| Agentic session, fork at msg 4 | 1 user message + multi-tool loop | Correct cut with tool_result pairing |
| Fork at first message | Fork from msg 0 | Empty conversation (just metadata) |
| Fork from last message | Fork at end | Nearly full copy (minus the last message) |
| Session with isMeta messages | Synthetic user messages | Correctly counted as assistant in UI index |

### Phase 3: Integration Test

1. Open ClaUi, have a multi-turn conversation
2. Fork from an early message
3. Verify context bar drops to the expected percentage
4. Send a message and verify the model responds coherently to the truncated context
5. Verify the model does NOT reference information from after the fork point

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| CLI rejects hand-crafted JSONL | Low | High (fork fails) | Fallback to old `--fork-session` behavior; validate in Phase 1 |
| `sessionId` mismatch causes issues | Low | Medium | Update all `sessionId` fields in the truncated file |
| `parentUuid` chain break confuses CLI | Low | Medium | We only truncate from the tail, so the chain is intact for included entries |
| `last-prompt` marker causes issues | Low | Low | Remove `last-prompt` entries from truncated file; CLI writes its own |
| Disk space from orphaned truncated files | Low | Low | Consider cleanup policy (delete truncated files after session ends) |
| Concurrent writes to the same session | Very Low | Low | Use unique UUID; no conflict with original file |
| Future CLI JSONL format changes | Medium | Medium | `ConversationReader` already parses this format; if format changes, both break together |

---

## Cleanup: Orphaned Truncated Sessions

Truncated JSONL files are created in `~/.claude/projects/<hash>/` alongside regular sessions. They will accumulate over time. Options:

1. **Track truncated session IDs** in the extension's `SessionStore` and delete them when the tab closes
2. **Use a naming convention** (e.g., `fork-<uuid>.jsonl`) so a cleanup sweep can identify them
3. **Accept the overhead** -- JSONL files are small (typically under 1MB) and the CLI may clean old sessions itself

Recommendation: Option 1 (track and delete on tab close) for cleanliness.

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/extension/session/SessionTruncator.ts` | **CREATE** | Core truncation logic |
| `src/extension/commands.ts` | MODIFY | Use `SessionTruncator` in fork command, pass `forkMessageIndex` to truncation |
| `src/extension/session/SessionTab.ts` | MODIFY | Thread `skipReplay` through to `processManager.start` for truncated forks |
| `tests/SessionTruncator.test.ts` | **CREATE** | Unit tests with JSONL fixtures |

---

## Key Files Reference

| File | Lines | Role |
|------|-------|------|
| `src/webview/components/ChatView/MessageList.tsx` | 67-85 | Fork trigger, builds `messagesBeforeFork` |
| `src/extension/commands.ts` | 784-803 | `forkFromMessage` command, creates new tab |
| `src/extension/session/SessionTab.ts` | 520-523, 910-958 | `setForkInit`, `startSession` with fork |
| `src/extension/process/ClaudeProcessManager.ts` | 85-132, 262-277 | CLI args construction, stdin protocol |
| `src/extension/types/stream-json.ts` | 196-214 | `CliInputMessage` types (what can be sent via stdin) |
| `src/extension/session/ConversationReader.ts` | all | JSONL parsing logic (reusable for truncation) |
| `src/webview/hooks/useClaudeStream.ts` | 702-719 | `forkInit` handler in webview |
| `src/webview/state/store.ts` | 896-901, 1385-1414 | `initialCost`, `setSession` (doesn't reset cost) |
| `src/webview/components/InputArea/InputArea.tsx` | 1408-1473 | Context utilization bar rendering |
| `src/webview/utils/modelContextLimits.ts` | all | Model-to-max-tokens mapping |

---

## Desired End State

After forking from message N:

1. The CLI session contains **only** messages 0..N-1
2. The user's new message (the fork prompt) is appended as message N in the new session
3. The model processes only messages 0..N + its system prompt
4. `inputTokens` in `messageStart` reflects the reduced context
5. The context utilization bar drops to reflect the actual (smaller) context
6. Conversation coherence is maintained for messages 0..N-1 (including tool results)
