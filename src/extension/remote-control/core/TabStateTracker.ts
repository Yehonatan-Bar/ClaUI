import { normalizeContent, type ContentBlockLike } from './contentFormat';

/**
 * Per-tab live state reconstructed from the chat-UI message stream (the same
 * messages the webview renders), so remote callers can read a tab's
 * transcript and status without touching the React app.
 *
 * Pure: fed by RemoteControlService from the tab tap; no vscode imports.
 */

export interface TranscriptEntry {
  /** Monotonic per tab; survives trimming so callers can page reliably. */
  index: number;
  role: 'user' | 'assistant';
  messageId?: string;
  content: ContentBlockLike[];
  model?: string;
  /** Epoch ms */
  time: number;
  source?: 'input' | 'auto-prompt';
  synthetic?: boolean;
}

export interface PendingApproval {
  toolName: string;
  kind: 'plan' | 'question' | 'permission';
  /** Serialized tool input (control-protocol path) when the extension provided it. */
  planText?: string;
  since: string;
}

export interface TabRuntimeState {
  tabId: string;
  busy: boolean;
  sessionId: string | null;
  model: string | null;
  permissionMode: string | null;
  claudeEffort: string | null;
  codexEffort: string | null;
  fastMode: boolean | null;
  pendingApproval: PendingApproval | null;
  cost: { lastTurnUsd: number; totalUsd: number; inputTokens: number; outputTokens: number } | null;
  lastTurn: Record<string, unknown> | null;
  turnCount: number;
  lastError: { message: string; time: string } | null;
  usageLimit: { active: boolean; resetAtMs?: number; resetDisplay?: string } | null;
  usageQueued: { queued: boolean; scheduledSendAtMs?: number } | null;
  scheduledMessage: { text?: string; scheduledAtMs?: number } | null;
  hibernated: boolean;
  sessionEnded: { reason: string; time: string } | null;
  webviewReady: boolean;
  lastActivityAt: string;
}

const MAX_TRANSCRIPT_ENTRIES = 1500;
const MAX_TOOL_RESULTS = 3000;

interface TabRecord {
  state: TabRuntimeState;
  transcript: TranscriptEntry[];
  nextIndex: number;
  toolResults: Map<string, { content: unknown; isError: boolean }>;
}

type AnyMessage = Record<string, unknown> & { type?: unknown };

export function approvalKind(toolName: string): PendingApproval['kind'] {
  const norm = toolName.trim().toLowerCase();
  if (norm === 'exitplanmode' || norm.endsWith('.exitplanmode')) {
    return 'plan';
  }
  if (norm === 'askuserquestion' || norm.endsWith('.askuserquestion')) {
    return 'question';
  }
  return 'permission';
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export class TabStateTracker {
  private readonly tabs = new Map<string, TabRecord>();

  private record(tabId: string): TabRecord {
    let rec = this.tabs.get(tabId);
    if (!rec) {
      rec = {
        state: {
          tabId,
          busy: false,
          sessionId: null,
          model: null,
          permissionMode: null,
          claudeEffort: null,
          codexEffort: null,
          fastMode: null,
          pendingApproval: null,
          cost: null,
          lastTurn: null,
          turnCount: 0,
          lastError: null,
          usageLimit: null,
          usageQueued: null,
          scheduledMessage: null,
          hibernated: false,
          sessionEnded: null,
          webviewReady: false,
          lastActivityAt: new Date().toISOString(),
        },
        transcript: [],
        nextIndex: 0,
        toolResults: new Map(),
      };
      this.tabs.set(tabId, rec);
    }
    return rec;
  }

  has(tabId: string): boolean {
    return this.tabs.has(tabId);
  }

  getState(tabId: string): TabRuntimeState {
    return this.record(tabId).state;
  }

  getTranscript(tabId: string): TranscriptEntry[] {
    return this.record(tabId).transcript;
  }

  getToolResults(tabId: string): Map<string, { content: unknown; isError: boolean }> {
    return this.record(tabId).toolResults;
  }

  /** Index the next transcript entry will get (baseline for "messages since"). */
  nextTranscriptIndex(tabId: string): number {
    return this.record(tabId).nextIndex;
  }

  remove(tabId: string): void {
    this.tabs.delete(tabId);
  }

  private push(rec: TabRecord, entry: Omit<TranscriptEntry, 'index'>): void {
    rec.transcript.push({ ...entry, index: rec.nextIndex++ });
    if (rec.transcript.length > MAX_TRANSCRIPT_ENTRIES) {
      rec.transcript.splice(0, rec.transcript.length - MAX_TRANSCRIPT_ENTRIES);
    }
  }

  private replaceTranscript(rec: TabRecord, messages: unknown): void {
    rec.transcript = [];
    rec.toolResults.clear();
    if (!Array.isArray(messages)) {
      return;
    }
    for (const raw of messages) {
      const m = raw as AnyMessage;
      if (m?.role !== 'user' && m?.role !== 'assistant') {
        continue;
      }
      const content = normalizeContent(m.content);
      // History replays carry tool results as user-role tool_result blocks; index them too.
      for (const block of content) {
        if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
          rec.toolResults.set(block.tool_use_id, { content: block.content, isError: !!block.is_error });
        }
      }
      this.push(rec, {
        role: m.role,
        messageId: typeof m.id === 'string' ? m.id : undefined,
        content,
        model: typeof m.model === 'string' ? m.model : undefined,
        time: typeof m.timestamp === 'number' ? m.timestamp : Date.now(),
        source: m.source === 'auto-prompt' ? 'auto-prompt' : m.role === 'user' ? 'input' : undefined,
        synthetic: m.synthetic === true ? true : undefined,
      });
    }
  }

  /** Extension -> chat UI message. */
  ingestOutbound(tabId: string, raw: unknown): void {
    const msg = (raw && typeof raw === 'object' ? raw : {}) as AnyMessage;
    const rec = this.record(tabId);
    const state = rec.state;
    state.lastActivityAt = new Date().toISOString();

    switch (msg.type) {
      case 'sessionStarted': {
        const sid = typeof msg.sessionId === 'string' ? msg.sessionId : null;
        if (sid && sid !== 'pending' && sid !== 'active') {
          state.sessionId = sid;
        }
        if (typeof msg.model === 'string' && msg.model && msg.model !== 'unknown' && msg.model !== 'connected') {
          state.model = msg.model;
        }
        state.sessionEnded = null;
        state.hibernated = false;
        break;
      }
      case 'sessionEnded':
        state.busy = false;
        state.pendingApproval = null;
        state.sessionEnded = { reason: String(msg.reason ?? 'unknown'), time: new Date().toISOString() };
        break;
      case 'processBusy':
        state.busy = msg.busy === true;
        break;
      case 'userMessage':
        this.push(rec, {
          role: 'user',
          content: normalizeContent(msg.content),
          time: Date.now(),
          source: msg.source === 'auto-prompt' ? 'auto-prompt' : 'input',
        });
        break;
      case 'assistantMessage': {
        const messageId = typeof msg.messageId === 'string' ? msg.messageId : undefined;
        const content = normalizeContent(msg.content);
        const model = typeof msg.model === 'string' ? msg.model : undefined;
        // The same message id can be posted several times (partial then final);
        // keep the most complete version in place.
        const existing = messageId
          ? [...rec.transcript].reverse().slice(0, 60).find((e) => e.role === 'assistant' && e.messageId === messageId)
          : undefined;
        if (existing) {
          if (content.length >= existing.content.length) {
            existing.content = content;
            existing.model = model ?? existing.model;
          }
        } else {
          this.push(rec, { role: 'assistant', messageId, content, model, time: Date.now() });
        }
        if (model) {
          state.model = model;
        }
        break;
      }
      case 'toolResult':
        if (typeof msg.toolId === 'string') {
          rec.toolResults.set(msg.toolId, { content: msg.content, isError: msg.isError === true });
          if (rec.toolResults.size > MAX_TOOL_RESULTS) {
            const oldest = rec.toolResults.keys().next().value;
            if (oldest !== undefined) {
              rec.toolResults.delete(oldest);
            }
          }
        }
        break;
      case 'conversationHistory':
        this.replaceTranscript(rec, msg.messages);
        break;
      case 'forkInit':
        this.replaceTranscript(rec, msg.messages);
        break;
      case 'conversationReset':
        rec.transcript = [];
        rec.toolResults.clear();
        state.pendingApproval = null;
        state.cost = null;
        state.lastTurn = null;
        state.turnCount = 0;
        break;
      case 'costUpdate':
        state.cost = {
          lastTurnUsd: num(msg.costUsd),
          totalUsd: num(msg.totalCostUsd),
          inputTokens: num(msg.inputTokens),
          outputTokens: num(msg.outputTokens),
        };
        break;
      case 'turnComplete':
        if (msg.turn && typeof msg.turn === 'object') {
          state.lastTurn = msg.turn as Record<string, unknown>;
          state.turnCount += 1;
        }
        break;
      case 'error':
        state.lastError = { message: String(msg.message ?? ''), time: new Date().toISOString() };
        break;
      case 'planApprovalRequired': {
        const toolName = String(msg.toolName ?? 'unknown');
        state.pendingApproval = {
          toolName,
          kind: approvalKind(toolName),
          planText: typeof msg.planText === 'string' ? msg.planText : undefined,
          since: new Date().toISOString(),
        };
        break;
      }
      case 'planApprovalDismissed':
        state.pendingApproval = null;
        break;
      case 'modelSetting':
        if (typeof msg.model === 'string') {
          state.model = msg.model || null;
        }
        break;
      case 'permissionModeSetting':
        state.permissionMode = typeof msg.mode === 'string' ? msg.mode : null;
        break;
      case 'claudeEffortSetting':
        state.claudeEffort = typeof msg.effort === 'string' ? msg.effort : null;
        break;
      case 'codexReasoningEffortSetting':
        state.codexEffort = typeof msg.effort === 'string' ? msg.effort : null;
        break;
      case 'claudeFastModeSetting':
        state.fastMode = msg.fastMode === true;
        break;
      case 'usageLimitDetected':
        state.usageLimit = {
          active: msg.active === true,
          resetAtMs: typeof msg.resetAtMs === 'number' ? msg.resetAtMs : undefined,
          resetDisplay: typeof msg.resetDisplay === 'string' ? msg.resetDisplay : undefined,
        };
        break;
      case 'usageQueuedPromptState':
        state.usageQueued = msg.queued === true
          ? { queued: true, scheduledSendAtMs: typeof msg.scheduledSendAtMs === 'number' ? msg.scheduledSendAtMs : undefined }
          : null;
        break;
      case 'scheduledMessageState':
        state.scheduledMessage = msg.scheduled === true
          ? { text: typeof msg.text === 'string' ? msg.text : undefined, scheduledAtMs: typeof msg.scheduledAtMs === 'number' ? msg.scheduledAtMs : undefined }
          : null;
        break;
      case 'hibernationState':
        state.hibernated = msg.hibernated === true;
        break;
      default:
        break;
    }
  }

  /** Chat UI -> extension action (real user, or a remote dispatch). */
  ingestInbound(tabId: string, raw: unknown): void {
    const msg = (raw && typeof raw === 'object' ? raw : {}) as AnyMessage;
    const state = this.record(tabId).state;
    switch (msg.type) {
      case 'ready':
        state.webviewReady = true;
        break;
      // Any of these answers (or abandons) a pending approval / question.
      case 'planApprovalResponse':
      case 'sendMessage':
      case 'sendMessageWithImages':
      case 'cancelRequest':
      case 'stopSession':
      case 'clearSession':
      case 'startSession':
      case 'resumeSession':
      case 'forkSession':
        state.pendingApproval = null;
        break;
      default:
        break;
    }
    state.lastActivityAt = new Date().toISOString();
  }

  /** The newest assistant entry that has visible text. */
  lastAssistantEntry(tabId: string): TranscriptEntry | undefined {
    const transcript = this.record(tabId).transcript;
    for (let i = transcript.length - 1; i >= 0; i--) {
      const entry = transcript[i];
      if (entry.role === 'assistant' && !entry.synthetic && entry.content.some((b) => b.type === 'text' && typeof b.text === 'string' && b.text.trim())) {
        return entry;
      }
    }
    return undefined;
  }

  /** Assistant/user entries with index >= fromIndex. */
  entriesSince(tabId: string, fromIndex: number): TranscriptEntry[] {
    return this.record(tabId).transcript.filter((e) => e.index >= fromIndex);
  }

  /**
   * Structured details of a pending approval: plan text, or AskUserQuestion
   * questions/options (from the control-protocol payload or the transcript).
   */
  describePendingApproval(tabId: string): (PendingApproval & { plan?: string; questions?: unknown[]; toolInput?: unknown }) | null {
    const rec = this.record(tabId);
    const pending = rec.state.pendingApproval;
    if (!pending) {
      return null;
    }
    let toolInput: unknown;
    if (pending.planText) {
      try {
        toolInput = JSON.parse(pending.planText);
      } catch {
        toolInput = pending.planText;
      }
    }
    if (toolInput === undefined) {
      const target = pending.toolName.trim().toLowerCase();
      for (let i = rec.transcript.length - 1; i >= 0 && toolInput === undefined; i--) {
        const entry = rec.transcript[i];
        if (entry.role !== 'assistant') continue;
        for (let j = entry.content.length - 1; j >= 0; j--) {
          const block = entry.content[j];
          if (block.type === 'tool_use' && String(block.name ?? '').trim().toLowerCase() === target) {
            toolInput = block.input;
            break;
          }
        }
      }
    }
    const input = (toolInput && typeof toolInput === 'object' ? toolInput : {}) as Record<string, unknown>;
    return {
      ...pending,
      plan: typeof input.plan === 'string' ? input.plan : typeof toolInput === 'string' ? toolInput : undefined,
      questions: Array.isArray(input.questions) ? input.questions : undefined,
      toolInput: pending.kind === 'permission' ? toolInput : undefined,
    };
  }
}
