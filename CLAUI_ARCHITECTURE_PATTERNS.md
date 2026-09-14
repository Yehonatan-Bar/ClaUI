# ClaUi - Architecture & Design Patterns

Based on comprehensive scanning of the ClaUi codebase, this document captures the key architectural patterns and design decisions that make the system work.

---

## 1. Multi-Process Architecture

**The Core Insight:** Each tab runs a completely independent Node.js process running the Claude or Codex CLI. This is not a simulation—it's a real process with its own stdin/stdout, its own state, its own lifetime.

**Why This Matters:**
- No process can interfere with others
- Failed tabs don't crash the extension
- Scaling is natural (just spawn more processes)
- Resource isolation is built-in

**The Three-Layer Communication Pattern:**

```
Extension Host (Node.js)          Webview (React/Browser)
├── ClaudeProcessManager          ├── Zustand Store
│   └── Spawns CLI                │   └── In-memory turn history
│                                 │
├── StreamDemux                   ├── useClaudeStream Hook
│   └── Parses JSON lines         │   └── Listens to postMessage
│
├── ControlProtocol               └── postToExtension()
│   └── Sends commands to CLI         └── Sends postMessage
│
├── MessageHandler
│   └── Converts CLI events to UI messages
```

Each tab (`SessionTab` or `CodexSessionTab`) bundles all three layers together and manages their lifecycle.

---

## 2. Event Stream Processing

**The Problem:** Claude CLI outputs a stream of JSON lines. Each line is an independent event (start, stop, text, tool_use, tool_result, etc.). They must be:
- Parsed correctly (line-by-line, not buffered)
- Demultiplexed to the right handlers
- Converted to UI updates
- Preserved for analytics and history

**The Solution:** A three-stage pipeline:

**Stage 1: StreamDemux**
- Reads CLI stdout line-by-line
- Validates JSON on each line
- Routes to event handlers via EventEmitter
- Handles backpressure (CLI produces data faster than we can process)

**Stage 2: MessageHandler**
- Listens to demux events
- Accumulates turn state (messages, tokens, tools)
- Triggers asynchronous handlers (TurnAnalyzer, SessionSummarizer)
- Sends aggregated updates to webview via postMessage

**Stage 3: Zustand Store (Webview)**
- Receives postMessage events
- Merges into `turnHistory[]`
- React components subscribe and re-render

**Why This Design Works:**
- Separation of concerns (parse ≠ analyze ≠ render)
- Each stage can fail independently
- Asynchronous handlers don't block the UI
- Easy to add new handlers (TurnAnalyzer, ActivitySummarizer, etc.)

---

## 3. Three-Phase Turn Lifecycle

**Every "Claude thinks and acts" cycle** follows this pattern:

```
1. TURN START
   ├── user sends prompt
   └── CLI receives input

2. TURN ACTIVE
   ├── text streaming (messageStart → messageDeltas)
   ├── tool_use blocks (toolUse, toolInput)
   ├── tool_result blocks (toolResult, toolResultDelta)
   └── multiple round-trips possible

3. TURN COMPLETE
   ├── blockStop event (final state)
   ├── TurnAnalyzer spawns (async, fire-and-forget)
   ├── SessionSummarizer spawns (async, on session end)
   ├── Zustand store emits turnComplete
   └── Analytics and achievements updated
```

Each turn produces a `TurnRecord` that persists in `turnHistory[]`. On session end, all `TurnRecord[]` are flushed to `ProjectAnalyticsStore` in `workspaceState` for cross-session aggregation.

---

## 4. Fail-Closed, Not Fail-Safe

**Philosophy:** When a security or data-integrity decision is unclear, the system defaults to DENY (fail-closed), not ALLOW (fail-safe).

**Examples:**

**Secret Protection:**
- Unknown secret type? Redact it.
- Entropy unclear? Flag it.
- Policy parse error? Use strict defaults.
- Timeout on scanning? Deny by default.

**Super Particle Accelerator (SPA):**
- Timeout on PreToolUse hook? Deny the write.
- Path classification unknown? Default to deny.
- Baseline mismatch? Generate new baseline, don't leak unknowns.

**Command Eligibility:**
- Unknown command? Deny output redirections and substitutions.
- Deny ssh, sudo, vim, npm run dev, docker run (deny-list).
- Default: allow with GenericFilter (safe fallback).

**Why This Matters:**
- Users may not notice when a secret is accidentally leaked
- But users WILL notice when a legitimate command is blocked (and they can then add an exception)
- Asymmetric visibility favors false positives over false negatives

---

## 5. Snapshot & Diff Pattern

**Used Throughout:** Session snapshots, workstream snapshots, checkpoint manager, resume state builder, plan reality analyzer.

**The Pattern:**

```typescript
// On state change
const newSnapshot = captureSnapshot(currentState);
const hasChanged = diffSnapshots(oldSnapshot, newSnapshot);

if (hasChanged) {
  // Trigger downstream logic
  resumeRecommendation.update();
  workstreamMap.highlight();
}
```

**Why This Works:**
- Efficient change detection (don't re-analyze if nothing changed)
- Resumable pipelines (last snapshot + current state = "where are we now?")
- Audit trail (snapshot history = project history)
- User edits preserved (workstream edits protected by comparison to previous snapshots)

---

## 6. Deferred/Async Analysis Pattern

**Many features spawn background analysis:** TurnAnalyzer, ActivitySummarizer, AchievementInsightAnalyzer, SessionSummarizer

**The Pattern:**

```typescript
// Stage 1: Trigger (during turn)
turnComplete → analyzer.analyze(turn)
// Returns immediately, fire-and-forget

// Stage 2: Process (background)
Claude CLI spawned (one-shot)
Result parsed and validated

// Stage 3: Callback
analyzer.onComplete(result)
→ Zustand store updated
→ UI re-renders

// Safeguards
- Queue (max 20 pending)
- Per-session cap (default 30)
- Timeout (default 30s)
- Enable/disable toggle
```

**Why This Pattern:**
- Doesn't block the chat UI
- UI updates are eventually consistent
- Easy to disable if CPU-bound
- Easy to add cost controls (queue, cap, timeout)

---

## 7. CLI as a Service (Lightweight One-Shot Pattern)

**For lightweight, one-off AI work**, ClaUi spawns the Claude CLI as a separate process instead of using the active session:

**Examples:**
- TurnAnalyzer (semantic analysis)
- SessionSummarizer (end-of-session recap)
- AchievementInsightAnalyzer (daily quality assessment)
- PromptEnhancer (auto-enhance prompts)
- MessageTranslator (translate to other languages)
- Workstream classification/extraction/synthesis (Sonnet AI analysis)

**Pattern:**

```typescript
const args = ['-p', '--output-format', 'json'];
const proc = spawn('claude', args, {
  cwd: workspacePath,
  shell: true,
  stdio: ['pipe', 'pipe', 'pipe'],
});
proc.stdin.write(prompt);
proc.stdin.end();
// Wait for exit, parse JSON, callback
```

**Why This Works:**
- Tiny API surface (just pass a prompt, get back JSON)
- No session state pollution
- Natural timeout behavior (process hangs = kill it)
- Easy to disable (one try/catch)
- Cost control via timeouts and queues

---

## 8. Hook Injection Pattern

**ClaUi installs hooks into the Claude and Codex CLI configs** to intercept and modify behavior at runtime.

**Three Hook Systems:**

**1. Particle Accelerator (PA) - Command Output Filtering**
```
Claude: .claude/settings.json → "hooks": {"preToolUse": "..."}
Codex: .codex/hooks.json → "pre-tool-use": "..."
```
Intercepts Bash commands, rewrites eligible ones to `claui-run`, filters output.

**2. Super Particle Accelerator (SPA) - Secret Write Blocking**
```
Claude: .claude/settings.json → "hooks": {"preToolUse": "..."}
Codex: .codex/hooks.json → "pre-tool-use": "..."
                           "permission-request": "..."
                           "post-tool-use": "..."
                           "stop": "..."
```
Blocks writes that contain secrets, audits violations.

**3. Workspace Access Guard (WAG) - Path Access Control**
```
Claude: .claude/settings.json → "hooks": {"preToolUse": "..."}
Codex: .codex/hooks.json → "pre-tool-use": "..."
                           "permission-request": "..."
```
Enforces which directories agents can access.

**Hook Install Order:** WAG → SPA → PA (most restrictive first, so all gates run before filtering).

**Why Hooks:**
- No CLI source changes needed (works with any CLI version)
- User can manually inspect/edit hook scripts
- Hooks run in agent's environment, see exact secrets the agent sees
- Can be disabled by removing hook config

---

## 9. Boundary & Destination Pattern (DLP)

**Secret Protection Broker classifies secrets by WHERE they're going:**

```
Boundary                 Destination              Policy
────────────────────────────────────────────────────────
prompt.submit     →      remote_model_provider    (scan, redact, block)
context.attach    →      remote_model_provider    (scan, redact, block)
command.output    →      terminal_stdout_to_agent (redact, audit)
git.publish       →      git_remote               (scan, audit, ask approval)
mcp.request       →      mcp_server               (scan based on server type)
persistence.write →      local_disk               (scan, SPA guards writes)
```

**Why This Design:**
- Different secrets are risky at different boundaries
- API key leaking to GitHub is catastrophic; leaking to Claude is recoverable
- Env var logging is OK in local logs; not OK in remote telemetry
- Policy can be destination-specific (only block secrets to untrusted MCP servers)

---

## 10. Settings Layering (VS Code + Project + Runtime)

**Settings live at three levels:**

**Layer 1: VS Code `settings.json` (User or Workspace)**
```json
{
  "claudeMirror.turnAnalysis.enabled": true,
  "claudeMirror.secretProtection.mode": "balanced",
  "claudeMirror.particleAccelerator.enabled": true
}
```

**Layer 2: Project `.claude/settings.json`**
```json
{
  "hooks": { ... },
  "goals": [ ... ]
}
```

**Layer 3: Runtime Context Files**
```
~/.claui/contexts/<tabRuntimeId>.json
```

**Why Layers:**
- Global defaults (user's baseline preferences)
- Workspace overrides (one project needs strict DLP)
- Runtime updates (session-specific context)
- Audit trail (what was enabled when?)

---

## 11. Provider-Agnostic Abstraction

**Claude and Codex are different enough to need separate classes, but similar enough to share interfaces:**

```
Extension Architecture:
├── SessionTab                    # Claude-specific
│   ├── ClaudeProcessManager
│   ├── StreamDemux (Claude format)
│   ├── ControlProtocol (Claude commands)
│   └── MessageHandler.ts (Claude events)
│
├── CodexSessionTab              # Codex-specific
│   ├── CodexExecProcessManager
│   ├── Codex JSON parsing
│   ├── Codex thread IDs
│   └── CodexMessageHandler.ts (Codex events)
│
├── TabManager (shared)          # Coordinates both
│   ├── createTab(provider)       # Dispatch on provider
│   ├── getOpenTabSessionIds()   # Works for both
│   └── enumerateCliProcesses()  # Works for both
```

**Why This Abstraction:**
- Shared features (achievements, workstream map, MCP) work with both providers
- Provider-specific UI (Codex fast mode) gated at UI layer
- New provider can be added by implementing `SessionTab` interface
- Tests can mock either provider

---

## 12. Context Compaction (Truncation for Forked Sessions)

**Problem:** After 100 turns, context grows to 100k+ tokens. Forking from turn 50 shouldn't carry unused turns 51-100.

**Solution: SessionTruncator**
```typescript
// On fork, rebuild JSONL with only turns 1..N
// Filter: only used system messages, keep all user/assistant up to N
// Result: smaller context for forked session
// Persisted: new session starts with compact history
```

**Why Important:**
- Fork is common (user branches from a decision point)
- Unused turns can be 50k+ tokens
- Compaction can save 20-30% on follow-up turns
- User doesn't need to understand—just works

---

## 13. Per-Tab Resource Management

**Each tab owns its resources.** On tab close or session end, cleanup happens:

```typescript
SessionTab.dispose() {
  // 1. Process cleanup
  process.kill(SIGTERM) // Falls back to taskkill on Windows

  // 2. Webview cleanup
  panel.dispose()

  // 3. State persistence
  sessionStore.save(metadata)
  projectAnalyticsStore.save(summary)

  // 4. Achievement cleanup
  achievementService.finalizeSession()

  // 5. Workstream notification
  workstreamManager.notifySessionEnded()

  // 6. Cleanup async handlers
  turnAnalyzer.cancel()
}
```

**Why This Pattern:**
- Prevents resource leaks (processes, event listeners, memory)
- Multi-session robustness (one tab failure ≠ extension crash)
- Clean shutdown (no orphan processes on VS Code close)

---

## 14. Memento vs GlobalState Layering

**VS Code's Memento API provides two scopes:**

**Workspace State (workspaceState):**
- Per-workspace (project)
- Examples: `ProjectAnalyticsStore`, `WorkstreamStore`, `TabGroupStore`, `CheckpointManager`
- Persisted: yes, survives VS Code restart
- Use: project-local aggregates, session summaries, workstream maps

**Global State (globalState):**
- Cross-workspace (user)
- Examples: `SessionStore`, `TokenUsageRatioTracker`, `UserPortfolioStore`, `AchievementStore`
- Persisted: yes, survives VS Code restart
- Use: cross-project data (achievements, portfolio, user ratios)

**Why Split:**
- Analytics are per-workspace (new project ≠ new user stats)
- Achievements are cross-workspace (one user, many projects)
- Portfolio is cross-workspace (which projects to work on today?)
- Privacy: workspace state never leaves that workspace

---

## 15. Cost Controls Pattern

**Every feature that spawns background work has cost controls:**

```typescript
// TurnAnalyzer
- Per-session cap: 30 analyses max
- Queue: max 20 pending
- Timeout: 30s per analysis
- Enable toggle

// ActivitySummarizer
- Threshold: trigger after N tool uses (default 3)
- Debounce: prevent rapid-fire Haiku calls

// AchievementInsightAnalyzer
- Frequency: once per day max
- 15-minute friend cache (GitHub API)

// WorkstreamClassifier
- Debounce: 5 minutes minimum between full runs
- Timeout: 90s for classification
- Session scope: only 4-day window + open tabs
```

**Why Necessary:**
- Free tier users can't spend unlimited on analyses
- Paid users might hit quota limits
- Concurrent analyses can spike CPU/memory
- Timeouts prevent hangs

---

## 16. Idempotence & Resumability

**Features are designed to be safe to re-run:**

**ParticleAcceleratorDailyReportGenerator:**
```typescript
generateIfMissing(date) {
  // If report for date already exists, skip
  // If date is today, regenerate (in case traces arrived late)
  // Safe to call multiple times
}
```

**WorkstreamManager classification:**
```typescript
classifyProject(force: boolean) {
  // If force=true, re-classify from scratch
  // If force=false, only if 5+ min since last run (debounce)
  // Protected user edits preserved
  // Safe to re-run anytime
}
```

**SessionTruncator:**
```typescript
truncate(sessionId, upToTurnIndex) {
  // If already truncated, return cached version
  // If truncating again, re-generate from original
  // Safe to re-run, always produces same result
}
```

**Why This Matters:**
- Resume feature relies on this (re-start analysis from scratch)
- Crash recovery (re-run in-flight work that was incomplete)
- User can refresh/retry without data corruption
- Easy testing (deterministic re-runs)

---

## 17. Silent Abandonment Pattern

**When users edit-and-resend, the old turn history is abandoned:**

```typescript
editAndResend(editedPrompt) {
  // 1. Save analytics NOW (before clearing)
  await messageHandler.saveProjectAnalyticsNow()

  // 2. Clear session state
  messageHandler.clearSession()

  // 3. Silent achievement abandon
  achievementService.silentAbandonSession()
  // Doesn't end session, just restarts fresh

  // 4. Fresh input
  messageHandler.sendMessage(editedPrompt)
  // New session ID, new turn history
}
```

**Why This Approach:**
- User edits prompt → they explicitly choose a different path
- Old path's achievements/analytics are saved (not lost)
- But new path doesn't carry over old achievements (fresh start)
- No awkward "session ended" notification during edit

---

## 18. Lazy Loading & Code Splitting

**Not all features are initialized on startup.**

**Lazy-loaded modules:**
- TurnAnalyzer (spawned only if turned on)
- AchievementService (loaded only if feature enabled)
- WorkstreamManager (loaded only if opened)
- UsageFetcher (dynamic import only when Usage tab opened)
- Recharts (imported only in dashboard panel)

**Why:**
- Extension startup time is <1s
- 200+ feature code doesn't block activation
- Users who don't use a feature pay zero cost

---

## 19. Elastic Buffer Sizing

**Output filters adapt to available budget:**

```typescript
// Three budget profiles
balanced:  8k char budget,  16k hard cap
strict:    4k char budget,   8k hard cap
verbose:   32k char budget, 32k hard cap

// Filter algorithm
filteredLength = min(budget, original)
if (filteredLength > softBudget) {
  // Compress by heading grouping, deduplication, truncation
}
if (filteredLength > hardCap) {
  // Last resort: truncate to hardCap + "... truncated"
}
```

**Why Elastic:**
- Docker build logs might need verbose (30k+)
- Quick git status fits in strict (2k)
- Budget scales with machine capability
- Never OOM from huge command output

---

## Summary: Design Philosophy

**ClaUi's architecture reflects three core values:**

1. **Isolation** - Each tab is independent; failures don't cascade
2. **Observability** - Every decision is audited; analytics pervasive
3. **Safety** - Fail-closed on security; fallback gracefully on errors

These patterns repeat throughout the codebase:
- Multi-process isolation
- Event stream processing
- Snapshot & diff
- Hook injection
- Boundary-aware policy
- Cost controls
- Idempotent re-runs

The result is a system where 200+ features coexist without interference, can be disabled independently, and scale from hobbyist single-session work to enterprise multi-session deployments.
