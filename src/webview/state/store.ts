import { create } from 'zustand';
import type { ContentBlock } from '../../extension/types/stream-json';

// --- Message types for the UI ---

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: ContentBlock[];
  model?: string;
  timestamp: number;
}

export interface StreamingBlock {
  blockIndex: number;
  type: 'text' | 'tool_use';
  text: string;
  toolName?: string;
  toolId?: string;
  partialJson?: string;
}

export interface CostInfo {
  costUsd: number;
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
}

/** Snapshot of the most recent assistant event for a given message */
interface AssistantSnapshot {
  messageId: string;
  content: ContentBlock[];
  model: string;
}

// --- Store state ---

export interface TextSettings {
  fontSize: number;    // px
  fontFamily: string;  // CSS font-family string, empty = use VS Code default
}

export interface AppState {
  // Session
  sessionId: string | null;
  model: string | null;
  selectedModel: string;  // model chosen by user for next session
  isConnected: boolean;
  isBusy: boolean;

  // Messages
  messages: ChatMessage[];
  streamingMessageId: string | null;
  streamingBlocks: StreamingBlock[];

  // Last assistant snapshot (authoritative content from the server)
  lastAssistantSnapshot: AssistantSnapshot | null;

  // Cost
  cost: CostInfo;

  // Errors
  lastError: string | null;

  // Text display settings
  textSettings: TextSettings;

  // File paths dropped/picked
  pendingFilePaths: string[] | null;

  // Prompt history (most recent last)
  promptHistory: string[];

  // Resume indicator
  isResuming: boolean;

  // Plan approval (CLI paused waiting for user approval of ExitPlanMode / AskUserQuestion)
  pendingApproval: { toolName: string; planText: string } | null;

  // Prompt history panel
  promptHistoryPanelOpen: boolean;
  projectPromptHistory: string[];
  globalPromptHistory: string[];

  // Activity summary (from Haiku)
  activitySummary: { shortLabel: string; fullSummary: string } | null;

  // Permission mode
  permissionMode: 'full-access' | 'supervised';

  // Actions
  setSession: (sessionId: string, model: string) => void;
  endSession: (reason: string) => void;
  addUserMessage: (content: string | ContentBlock[]) => void;
  addAssistantMessage: (messageId: string, content: ContentBlock[], model: string) => void;

  // Streaming lifecycle
  handleMessageStart: (messageId: string, model: string) => void;
  appendStreamingText: (
    messageId: string,
    blockIndex: number,
    text: string
  ) => void;
  startToolUse: (
    messageId: string,
    blockIndex: number,
    toolName: string,
    toolId: string
  ) => void;
  appendToolInput: (
    messageId: string,
    blockIndex: number,
    partialJson: string
  ) => void;
  updateAssistantSnapshot: (
    messageId: string,
    content: ContentBlock[],
    model: string
  ) => void;
  finalizeStreamingMessage: () => void;
  clearStreaming: () => void;

  setBusy: (busy: boolean) => void;
  updateCost: (cost: CostInfo) => void;
  setError: (message: string | null) => void;
  setPendingFilePaths: (paths: string[] | null) => void;
  addToPromptHistory: (prompt: string) => void;
  setTextSettings: (settings: Partial<TextSettings>) => void;
  setResuming: (resuming: boolean) => void;
  setSelectedModel: (model: string) => void;
  setPendingApproval: (approval: { toolName: string; planText: string } | null) => void;
  truncateFromMessage: (messageId: string) => void;
  setActivitySummary: (summary: { shortLabel: string; fullSummary: string } | null) => void;
  setPromptHistoryPanelOpen: (open: boolean) => void;
  setPermissionMode: (mode: 'full-access' | 'supervised') => void;
  setProjectPromptHistory: (history: string[]) => void;
  setGlobalPromptHistory: (history: string[]) => void;
  reset: () => void;
}

const defaultTextSettings: TextSettings = {
  fontSize: 14,
  fontFamily: '',
};

const initialCost: CostInfo = {
  costUsd: 0,
  totalCostUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
};

/**
 * Convert current streaming blocks into ContentBlock[] for a finalized message.
 * Falls back to building from streaming state if no server snapshot is available.
 */
function buildContentFromBlocks(blocks: StreamingBlock[]): ContentBlock[] {
  return blocks.map((b): ContentBlock => {
    if (b.type === 'tool_use') {
      let parsedInput: Record<string, unknown> = {};
      if (b.partialJson) {
        try {
          parsedInput = JSON.parse(b.partialJson);
        } catch {
          // Partial JSON that couldn't be parsed - store as raw string
          parsedInput = { _raw: b.partialJson };
        }
      }
      return {
        type: 'tool_use',
        id: b.toolId || '',
        name: b.toolName || '',
        input: parsedInput,
      };
    }
    return { type: 'text', text: b.text };
  });
}

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  sessionId: null,
  model: null,
  selectedModel: '',
  isConnected: false,
  isBusy: false,
  messages: [],
  streamingMessageId: null,
  streamingBlocks: [],
  lastAssistantSnapshot: null,
  cost: { ...initialCost },
  lastError: null,
  textSettings: { ...defaultTextSettings },
  pendingFilePaths: null,
  promptHistory: [],
  isResuming: false,
  pendingApproval: null,
  promptHistoryPanelOpen: false,
  projectPromptHistory: [],
  globalPromptHistory: [],
  activitySummary: null,
  permissionMode: 'full-access' as const,

  // Actions
  setSession: (sessionId, model) =>
    set({
      sessionId,
      model,
      isConnected: true,
      lastError: null,
    }),

  endSession: (_reason) =>
    set({
      isConnected: false,
      isBusy: false,
      streamingMessageId: null,
      streamingBlocks: [],
      lastAssistantSnapshot: null,
      pendingApproval: null,
      activitySummary: null,
    }),

  addUserMessage: (content) => {
    // Normalize content: CLI may send a plain string instead of ContentBlock[]
    const normalizedContent: ContentBlock[] = typeof content === 'string'
      ? [{ type: 'text', text: content }]
      : Array.isArray(content)
        ? content
        : [{ type: 'text', text: String(content) }];

    // Filter out tool_result blocks - these are API-internal messages
    // (tool results sent back to Claude as user-role), not actual user input.
    // They should not appear as "You" messages in the chat UI.
    const userVisibleContent = normalizedContent.filter(
      (block) => block.type !== 'tool_result'
    );

    // Skip entirely if no user-visible content remains
    if (userVisibleContent.length === 0) {
      return;
    }

    // Deduplicate: if the last message is a recent user message with the same
    // text, skip adding it (handles CLI echo after edit-and-resend which
    // already added the message directly). The 5-second window avoids
    // suppressing legitimate repeated messages (e.g., sending "yes" twice).
    const state = get();
    const lastMsg = state.messages[state.messages.length - 1];
    if (lastMsg?.role === 'user' && Date.now() - lastMsg.timestamp < 5000) {
      const newText = userVisibleContent
        .filter((b) => b.type === 'text')
        .map((b) => b.text || '')
        .join('');
      const lastText = lastMsg.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text || '')
        .join('');
      if (newText === lastText) {
        return;
      }
    }

    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: `user-${Date.now()}`,
          role: 'user' as const,
          content: userVisibleContent,
          timestamp: Date.now(),
        },
      ],
    }));
  },

  /**
   * Add a complete assistant message directly to the messages array.
   * Used for replayed messages during session resume (no streaming pipeline).
   */
  addAssistantMessage: (messageId, content, model) => {
    // Normalize content defensively
    const normalizedContent: ContentBlock[] = Array.isArray(content)
      ? content
      : [{ type: 'text', text: String(content) }];

    const newMessage: ChatMessage = {
      id: messageId,
      role: 'assistant',
      content: normalizedContent,
      model,
      timestamp: Date.now(),
    };

    set((state) => {
      // Upsert: replace if same ID exists, otherwise append
      const existingIndex = state.messages.findIndex((m) => m.id === messageId);
      if (existingIndex >= 0) {
        const updatedMessages = [...state.messages];
        updatedMessages[existingIndex] = newMessage;
        return { messages: updatedMessages };
      }
      return { messages: [...state.messages, newMessage] };
    });
  },

  /**
   * Called when a new assistant message starts streaming (messageStart event).
   * If there was a previous streaming message, finalize it first.
   */
  handleMessageStart: (messageId, _model) => {
    const state = get();

    // If we were streaming a different message, finalize it first
    if (state.streamingMessageId && state.streamingMessageId !== messageId && state.streamingBlocks.length > 0) {
      // Finalize previous message
      get().finalizeStreamingMessage();
    }

    // Start fresh for the new message
    set({
      streamingMessageId: messageId,
      streamingBlocks: [],
      lastAssistantSnapshot: null,
    });
  },

  appendStreamingText: (messageId, blockIndex, text) =>
    set((state) => {
      const existingBlock = state.streamingBlocks.find(
        (b) => b.blockIndex === blockIndex
      );

      let updatedBlocks: StreamingBlock[];
      if (existingBlock) {
        updatedBlocks = state.streamingBlocks.map((b) =>
          b.blockIndex === blockIndex
            ? { ...b, text: b.text + text }
            : b
        );
      } else {
        updatedBlocks = [
          ...state.streamingBlocks,
          { blockIndex, type: 'text', text },
        ];
      }

      return {
        streamingMessageId: messageId,
        streamingBlocks: updatedBlocks,
      };
    }),

  startToolUse: (messageId, blockIndex, toolName, toolId) =>
    set((state) => ({
      streamingMessageId: messageId,
      streamingBlocks: [
        ...state.streamingBlocks,
        {
          blockIndex,
          type: 'tool_use',
          text: '',
          toolName,
          toolId,
          partialJson: '',
        },
      ],
    })),

  appendToolInput: (_messageId, blockIndex, partialJson) =>
    set((state) => ({
      streamingBlocks: state.streamingBlocks.map((b) =>
        b.blockIndex === blockIndex
          ? { ...b, partialJson: (b.partialJson || '') + partialJson }
          : b
      ),
    })),

  /**
   * Store the latest assistant snapshot from the server.
   * This is NOT added to the messages array - it's used as the authoritative
   * content when the message is finalized (on messageStop or result).
   */
  updateAssistantSnapshot: (messageId, content, model) =>
    set({ lastAssistantSnapshot: { messageId, content, model } }),

  /**
   * Convert current streaming state into a finalized ChatMessage.
   * Always builds from accumulated streaming blocks (they are the complete picture).
   * The assistant snapshot is only used for metadata like model name - its content
   * is NOT used because --include-partial-messages sends incremental (not cumulative)
   * assistant events that may only contain the most recently completed block.
   */
  finalizeStreamingMessage: () => {
    const state = get();
    console.error('[FINALIZE] called', {
      streamingMessageId: state.streamingMessageId,
      streamingBlocksLength: state.streamingBlocks.length,
      streamingBlockTypes: state.streamingBlocks.map(b => `${b.type}[${b.blockIndex}]`),
      currentMessagesCount: state.messages.length,
    });

    if (!state.streamingMessageId || state.streamingBlocks.length === 0) {
      console.error('[FINALIZE] SKIPPED - nothing to finalize');
      return;
    }

    const snapshot = state.lastAssistantSnapshot;
    const content = buildContentFromBlocks(state.streamingBlocks);
    const model = snapshot?.messageId === state.streamingMessageId
      ? snapshot.model
      : undefined;

    console.error('[FINALIZE] built content', {
      contentLength: content.length,
      contentTypes: content.map(b => b.type),
      textPreview: content.filter(b => b.type === 'text').map(b => (b.text || '').slice(0, 50)),
    });

    const newMessage: ChatMessage = {
      id: state.streamingMessageId,
      role: 'assistant',
      content,
      model,
      timestamp: Date.now(),
    };

    // Upsert into messages (in case the same message ID was already finalized)
    const existingIndex = state.messages.findIndex(
      (m) => m.id === state.streamingMessageId
    );

    let updatedMessages: ChatMessage[];
    if (existingIndex >= 0) {
      updatedMessages = [...state.messages];
      updatedMessages[existingIndex] = newMessage;
    } else {
      updatedMessages = [...state.messages, newMessage];
    }

    console.error('[FINALIZE] setting messages', {
      newMessagesCount: updatedMessages.length,
      allIds: updatedMessages.map(m => `${m.role}:${m.id.slice(0,10)}`),
    });

    set({
      messages: updatedMessages,
      streamingMessageId: null,
      streamingBlocks: [],
      lastAssistantSnapshot: null,
    });
  },

  /**
   * Called when the turn is complete (result event).
   * Finalizes any remaining streaming message and clears streaming state.
   */
  clearStreaming: () => {
    // Finalize first if there's an in-progress message
    get().finalizeStreamingMessage();
    set({
      streamingMessageId: null,
      streamingBlocks: [],
      lastAssistantSnapshot: null,
      isResuming: false,
    });
  },

  setBusy: (busy) => set({ isBusy: busy }),

  updateCost: (cost) => set({ cost }),

  setError: (message) => set({ lastError: message }),

  setPendingFilePaths: (paths) => set({ pendingFilePaths: paths }),

  addToPromptHistory: (prompt) =>
    set((state) => {
      // Avoid consecutive duplicates
      if (state.promptHistory.length > 0 && state.promptHistory[state.promptHistory.length - 1] === prompt) {
        return state;
      }
      // Keep last 50 prompts
      const updated = [...state.promptHistory, prompt];
      if (updated.length > 50) updated.shift();
      return { promptHistory: updated };
    }),

  setTextSettings: (settings) =>
    set((state) => ({
      textSettings: { ...state.textSettings, ...settings },
    })),

  setResuming: (resuming) => set({ isResuming: resuming }),

  setSelectedModel: (model) => set({ selectedModel: model }),

  setPendingApproval: (approval) => set({ pendingApproval: approval }),

  truncateFromMessage: (messageId) =>
    set((state) => {
      const index = state.messages.findIndex((m) => m.id === messageId);
      if (index < 0) return state;
      // Keep messages before the target, discard target and everything after
      return { messages: state.messages.slice(0, index) };
    }),

  setActivitySummary: (summary) => set({ activitySummary: summary }),

  setPermissionMode: (mode) => set({ permissionMode: mode }),

  setPromptHistoryPanelOpen: (open) => set({ promptHistoryPanelOpen: open }),

  setProjectPromptHistory: (history) => set({ projectPromptHistory: history }),

  setGlobalPromptHistory: (history) => set({ globalPromptHistory: history }),

  reset: () =>
    set({
      sessionId: null,
      model: null,
      isConnected: false,
      isBusy: false,
      messages: [],
      streamingMessageId: null,
      streamingBlocks: [],
      lastAssistantSnapshot: null,
      cost: { ...initialCost },
      lastError: null,
      textSettings: { ...defaultTextSettings },
      pendingFilePaths: null,
      isResuming: false,
      pendingApproval: null,
      promptHistoryPanelOpen: false,
      projectPromptHistory: [],
      globalPromptHistory: [],
      activitySummary: null,
      permissionMode: 'full-access' as const,
    }),
}));
