import { create } from 'zustand';
import type { ContentBlock } from '../../extension/types/stream-json';
import type { TypingTheme } from '../../extension/types/webview-messages';
import type {
  AchievementAwardPayload,
  AchievementGoalPayload,
  AchievementProfilePayload,
  SessionRecapPayload,
  TurnRecord,
} from '../../extension/types/webview-messages';
import type { AdventureBeat } from '../components/Vitals/adventure/types';

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

export interface AchievementToast extends AchievementAwardPayload {
  toastId: string;
  createdAt: number;
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
  typingTheme: TypingTheme;

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

  // Git push
  gitPushSettings: { enabled: boolean; scriptPath: string; commitMessageTemplate: string } | null;
  gitPushResult: { success: boolean; output: string } | null;
  gitPushConfigPanelOpen: boolean;
  gitPushRunning: boolean;

  // Fork state (set when a forked tab receives forkInit from extension)
  forkInit: { promptText: string } | null;

  // Translation state
  translationLanguage: string;
  translations: Record<string, string>;
  translatingMessageIds: Set<string>;
  showingTranslation: Set<string>;

  // Session Vitals
  vitalsEnabled: boolean;
  turnHistory: TurnRecord[];
  turnByMessageId: Record<string, TurnRecord>;
  weather: WeatherState;

  // Achievements
  achievementsEnabled: boolean;
  achievementsSound: boolean;
  achievementProfile: AchievementProfilePayload;
  achievementGoals: AchievementGoalPayload[];
  achievementToasts: AchievementToast[];
  achievementPanelOpen: boolean;
  sessionRecap: SessionRecapPayload | null;

  // Adventure Widget
  adventureEnabled: boolean;
  adventureBeats: AdventureBeat[];

  // Session activity timer (Claude active processing time only)
  sessionActivityStarted: boolean;
  sessionActivityElapsedMs: number;
  sessionActivityRunningSinceMs: number | null;

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
  setTypingTheme: (theme: TypingTheme) => void;
  setResuming: (resuming: boolean) => void;
  setSelectedModel: (model: string) => void;
  setPendingApproval: (approval: { toolName: string; planText: string } | null) => void;
  truncateFromMessage: (messageId: string) => void;
  setActivitySummary: (summary: { shortLabel: string; fullSummary: string } | null) => void;
  setPromptHistoryPanelOpen: (open: boolean) => void;
  setPermissionMode: (mode: 'full-access' | 'supervised') => void;
  setProjectPromptHistory: (history: string[]) => void;
  setGlobalPromptHistory: (history: string[]) => void;
  setGitPushSettings: (settings: { enabled: boolean; scriptPath: string; commitMessageTemplate: string }) => void;
  setGitPushResult: (result: { success: boolean; output: string } | null) => void;
  setGitPushConfigPanelOpen: (open: boolean) => void;
  setGitPushRunning: (running: boolean) => void;
  setForkInit: (init: { promptText: string } | null) => void;
  setTranslationLanguage: (language: string) => void;
  setTranslation: (messageId: string, translatedText: string) => void;
  setTranslating: (messageId: string, translating: boolean) => void;
  toggleTranslationView: (messageId: string) => void;
  setVitalsEnabled: (enabled: boolean) => void;
  addTurnRecord: (turn: TurnRecord) => void;
  setAchievementsSettings: (settings: { enabled: boolean; sound: boolean }) => void;
  setAchievementsSnapshot: (snapshot: { profile: AchievementProfilePayload; goals: AchievementGoalPayload[] }) => void;
  addAchievementToast: (toast: AchievementAwardPayload, profile: AchievementProfilePayload) => void;
  dismissAchievementToast: (toastId: string) => void;
  setAchievementPanelOpen: (open: boolean) => void;
  setSessionRecap: (recap: SessionRecapPayload | null) => void;
  setAchievementGoals: (goals: AchievementGoalPayload[]) => void;
  setAdventureEnabled: (enabled: boolean) => void;
  addAdventureBeat: (beat: AdventureBeat) => void;
  markSessionPromptSent: () => void;
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

// --- Session Vitals ---

export type WeatherMood = 'clear' | 'partly-sunny' | 'cloudy' | 'rainy' | 'thunderstorm' | 'rainbow' | 'night' | 'snowflake';
export type PulseRate = 'slow' | 'normal' | 'fast';

export interface WeatherState {
  mood: WeatherMood;
  pulseRate: PulseRate;
}

const initialWeather: WeatherState = { mood: 'night', pulseRate: 'slow' };

/**
 * Multi-dimensional weather: composite score from 4 signals.
 * Each dimension scores 0-1 (higher = worse).
 *   - Error pressure  (30%): errors in recent turns
 *   - Cost velocity   (25%): recent per-turn cost vs session average
 *   - Momentum        (25%): recent turn duration vs session average
 *   - Productivity    (20%): productive categories vs discussion/error
 */
function calculateWeather(turns: TurnRecord[]): WeatherState {
  if (turns.length === 0) return { mood: 'night', pulseRate: 'slow' };

  const recent = turns.slice(-5);
  const recentLen = recent.length;
  const lastTurn = turns[turns.length - 1];
  const secondLast = turns.length > 1 ? turns[turns.length - 2] : null;

  // Rainbow: recovery after error
  if (secondLast?.isError && !lastTurn.isError) {
    return { mood: 'rainbow', pulseRate: 'normal' };
  }

  // 1. Error pressure (0-1)
  const errorScore = recent.filter(t => t.isError).length / recentLen;

  // 2. Cost velocity (0-1): how much recent cost exceeds session average
  const avgCost = turns.reduce((s, t) => s + t.costUsd, 0) / turns.length;
  const recentAvgCost = recent.reduce((s, t) => s + t.costUsd, 0) / recentLen;
  const costRatio = avgCost > 0.0001 ? recentAvgCost / avgCost : 0;
  // 0 when at-or-below average, 1 when 3x average
  const costScore = Math.min(1, Math.max(0, (costRatio - 1) / 2));

  // 3. Momentum (0-1): rising turn duration = worse
  const avgDur = turns.reduce((s, t) => s + t.durationMs, 0) / turns.length;
  const recentAvgDur = recent.reduce((s, t) => s + t.durationMs, 0) / recentLen;
  const durRatio = avgDur > 100 ? recentAvgDur / avgDur : 0;
  const momentumScore = Math.min(1, Math.max(0, (durRatio - 1) / 2));

  // 4. Productivity flow (0-1): low ratio of productive turns = worse
  const productiveCategories = new Set(['code-write', 'research', 'command', 'success']);
  const productiveCount = recent.filter(t => productiveCategories.has(t.category)).length;
  const flowScore = 1 - (productiveCount / recentLen);

  // Weighted composite
  const composite = errorScore * 0.30 + costScore * 0.25 + momentumScore * 0.25 + flowScore * 0.20;

  // Map to mood
  let mood: WeatherMood;
  if (composite < 0.15) mood = 'clear';
  else if (composite < 0.30) mood = 'partly-sunny';
  else if (composite < 0.45) mood = 'cloudy';
  else if (composite < 0.60) mood = 'rainy';
  else mood = 'thunderstorm';

  const pulseRate: PulseRate = composite < 0.15 ? 'slow' : composite < 0.45 ? 'normal' : 'fast';

  return { mood, pulseRate };
}

const initialAchievementProfile: AchievementProfilePayload = {
  totalXp: 0,
  level: 1,
  totalAchievements: 0,
  unlockedIds: [],
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
  typingTheme: 'zen' as const,
  pendingFilePaths: null,
  promptHistory: [],
  isResuming: false,
  pendingApproval: null,
  promptHistoryPanelOpen: false,
  projectPromptHistory: [],
  globalPromptHistory: [],
  activitySummary: null,
  permissionMode: 'full-access' as const,
  gitPushSettings: null,
  gitPushResult: null,
  gitPushConfigPanelOpen: false,
  gitPushRunning: false,
  forkInit: null,
  translationLanguage: 'Hebrew',
  translations: {},
  translatingMessageIds: new Set(),
  showingTranslation: new Set(),
  vitalsEnabled: false,
  turnHistory: [],
  turnByMessageId: {},
  weather: { ...initialWeather },
  achievementsEnabled: true,
  achievementsSound: false,
  achievementProfile: { ...initialAchievementProfile },
  achievementGoals: [],
  achievementToasts: [],
  achievementPanelOpen: false,
  sessionRecap: null,
  adventureEnabled: false,
  adventureBeats: [],
  sessionActivityStarted: false,
  sessionActivityElapsedMs: 0,
  sessionActivityRunningSinceMs: null,

  // Actions
  setSession: (sessionId, model) =>
    set((state) => {
      const isPendingToRealTransition =
        state.sessionId === 'pending' &&
        sessionId !== 'pending' &&
        !!sessionId;
      const isBrandNewSession =
        !state.isConnected ||
        (!isPendingToRealTransition &&
          state.sessionId !== null &&
          state.sessionId !== sessionId);
      return {
        sessionId,
        model,
        isConnected: true,
        lastError: null,
        sessionRecap: null,
        // Session connected: show clear sky (not night/idle) even before first turn completes
        ...(isBrandNewSession
          ? {
            sessionActivityStarted: false,
            sessionActivityElapsedMs: 0,
            sessionActivityRunningSinceMs: null,
            weather: { mood: 'clear' as WeatherMood, pulseRate: 'slow' as PulseRate },
          }
          : {}),
      };
    }),

  endSession: (_reason) =>
    set((state) => {
      const now = Date.now();
      const finalElapsed = state.sessionActivityRunningSinceMs
        ? state.sessionActivityElapsedMs + (now - state.sessionActivityRunningSinceMs)
        : state.sessionActivityElapsedMs;
      return {
        isConnected: false,
        isBusy: false,
        streamingMessageId: null,
        streamingBlocks: [],
        lastAssistantSnapshot: null,
        pendingApproval: null,
        activitySummary: null,
        sessionActivityElapsedMs: finalElapsed,
        sessionActivityRunningSinceMs: null,
        weather: { mood: 'night' as WeatherMood, pulseRate: 'slow' as PulseRate },
      };
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

  setBusy: (busy) =>
    set((state) => {
      if (!state.sessionActivityStarted) {
        return { isBusy: busy };
      }

      const now = Date.now();
      if (busy && state.sessionActivityRunningSinceMs === null) {
        return {
          isBusy: true,
          sessionActivityRunningSinceMs: now,
        };
      }

      if (!busy && state.sessionActivityRunningSinceMs !== null) {
        return {
          isBusy: false,
          sessionActivityElapsedMs: state.sessionActivityElapsedMs + (now - state.sessionActivityRunningSinceMs),
          sessionActivityRunningSinceMs: null,
        };
      }

      return { isBusy: busy };
    }),

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

  setTypingTheme: (theme) => set({ typingTheme: theme }),

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

  setGitPushSettings: (settings) => set({ gitPushSettings: settings }),
  setGitPushResult: (result) => set({ gitPushResult: result }),
  setGitPushConfigPanelOpen: (open) => set({ gitPushConfigPanelOpen: open }),
  setGitPushRunning: (running) => set({ gitPushRunning: running }),
  setForkInit: (init) => set({ forkInit: init }),

  setTranslationLanguage: (language) =>
    set((state) => {
      if (state.translationLanguage === language) {
        return { translationLanguage: language };
      }
      return {
        translationLanguage: language,
        translations: {},
        translatingMessageIds: new Set(),
        showingTranslation: new Set(),
      };
    }),

  setTranslation: (messageId, translatedText) =>
    set((state) => ({
      translations: { ...state.translations, [messageId]: translatedText },
      showingTranslation: new Set([...state.showingTranslation, messageId]),
    })),

  setTranslating: (messageId, translating) =>
    set((state) => {
      const newSet = new Set(state.translatingMessageIds);
      if (translating) {
        newSet.add(messageId);
      } else {
        newSet.delete(messageId);
      }
      return { translatingMessageIds: newSet };
    }),

  toggleTranslationView: (messageId) =>
    set((state) => {
      const newSet = new Set(state.showingTranslation);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return { showingTranslation: newSet };
    }),

  setVitalsEnabled: (enabled) => set({ vitalsEnabled: enabled }),

  addTurnRecord: (turn) =>
    set((state) => {
      const updated = [...state.turnHistory, turn];
      const trimmed = updated.length > 200 ? updated.slice(-200) : updated;
      return {
        turnHistory: trimmed,
        turnByMessageId: { ...state.turnByMessageId, [turn.messageId]: turn },
        weather: calculateWeather(trimmed),
      };
    }),

  setAchievementsSettings: ({ enabled, sound }) =>
    set((state) => ({
      achievementsEnabled: enabled,
      achievementsSound: sound,
      achievementPanelOpen: enabled ? state.achievementPanelOpen : false,
      achievementToasts: enabled ? state.achievementToasts : [],
    })),

  setAchievementsSnapshot: ({ profile, goals }) =>
    set({
      achievementProfile: profile,
      achievementGoals: goals,
    }),

  addAchievementToast: (toast, profile) =>
    set((state) => ({
      achievementProfile: profile,
      achievementToasts: [
        ...state.achievementToasts,
        {
          ...toast,
          toastId: `${toast.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: Date.now(),
        },
      ],
    })),

  dismissAchievementToast: (toastId) =>
    set((state) => ({
      achievementToasts: state.achievementToasts.filter((toast) => toast.toastId !== toastId),
    })),

  setAchievementPanelOpen: (open) => set({ achievementPanelOpen: open }),
  setSessionRecap: (recap) => set({ sessionRecap: recap }),
  setAchievementGoals: (goals) => set({ achievementGoals: goals }),
  setAdventureEnabled: (enabled) => set({ adventureEnabled: enabled }),

  addAdventureBeat: (beat) =>
    set((state) => {
      const updated = [...state.adventureBeats, beat];
      const trimmed = updated.length > 100 ? updated.slice(-100) : updated;
      return { adventureBeats: trimmed };
    }),

  markSessionPromptSent: () =>
    set((state) => {
      if (state.sessionActivityStarted) {
        return {};
      }
      return {
        sessionActivityStarted: true,
        sessionActivityElapsedMs: 0,
        sessionActivityRunningSinceMs: null,
      };
    }),

  reset: () =>
    set((state) => ({
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
      typingTheme: 'zen' as const,
      pendingFilePaths: null,
      isResuming: false,
      pendingApproval: null,
      promptHistoryPanelOpen: false,
      projectPromptHistory: [],
      globalPromptHistory: [],
      activitySummary: null,
      permissionMode: 'full-access' as const,
      gitPushSettings: null,
      gitPushResult: null,
      gitPushConfigPanelOpen: false,
      gitPushRunning: false,
      forkInit: null,
      translations: {},
      translatingMessageIds: new Set(),
      showingTranslation: new Set(),
      vitalsEnabled: state.vitalsEnabled,
      adventureEnabled: state.adventureEnabled,
      adventureBeats: [],
      turnHistory: [],
      turnByMessageId: {},
      weather: { ...initialWeather },
      achievementsEnabled: state.achievementsEnabled,
      achievementsSound: state.achievementsSound,
      achievementProfile: state.achievementProfile,
      achievementGoals: [],
      achievementToasts: [],
      achievementPanelOpen: false,
      sessionRecap: null,
      sessionActivityStarted: false,
      sessionActivityElapsedMs: 0,
      sessionActivityRunningSinceMs: null,
    })),
}));
