import { useEffect } from 'react';
import { useAppStore } from '../state/store';
import type { ExtensionToWebviewMessage } from '../../extension/types/webview-messages';
import type { ContentBlock } from '../../extension/types/stream-json';

/** VS Code API handle - acquired once on webview load */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vscodeApi = (window as any).acquireVsCodeApi?.();

/**
 * Hook that listens for postMessage events from the extension host
 * and dispatches them to the Zustand store.
 */
export function useClaudeStream(): void {
  const {
    setSession,
    endSession,
    addUserMessage,
    addAssistantMessage,
    handleMessageStart,
    appendStreamingText,
    startToolUse,
    appendToolInput,
    updateAssistantSnapshot,
    finalizeStreamingMessage,
    clearStreaming,
    setBusy,
    setHandoffProgress,
    clearHandoffProgress,
    markActivity,
    updateCost,
    setError,
    setPendingFilePaths,
    setTextSettings,
    setTypingTheme,
    setProvider,
    setSelectedProvider,
    setProviderCapabilities,
    setSelectedModel,
    setSelectedCodexReasoningEffort,
    setCodexModelOptions,
    setResuming,
    setPendingApproval,
    setProjectPromptHistory,
    setGlobalPromptHistory,
    setToolActivity,
    setActivitySummary,
    setPermissionMode,
    setGitPushSettings,
    setGitPushResult,
    setGitPushRunning,
    setForkInit,
    setTranslation,
    setTranslating,
    setAchievementsSettings,
    setAchievementsSnapshot,
    addAchievementToast,
    setAchievementGoals,
    setSessionRecap,
    setUltrathinkLocked,
    setVitalsEnabled,
    rebuildTurnHistoryFromMessages,
    setAdventureEnabled,
    addTurnRecord,
    addAdventureBeat,
    applyTurnSemantics,
    setTurnAnalysisSettings,
    setSessionMetadata,
    setProjectSessions,
    setIsEnhancing,
    setPromptEnhancerSettings,
    setIsTranslatingPrompt,
    setPromptTranslatorSettings,
    addSessionSkill,
    setSkillGenSettings,
    setSkillGenStatus,
    setSkillGenProgress,
    setGithubSyncStatus,
    setCommunityFriends,
    setFriendActionPending,
    setApiKeySetting,
    setClaudeAuthStatus,
    setUsageWidgetEnabled,
    setUsageData,
    setTokenRatioData,
    setTeamState,
    setTeamActive,
    clearTeamState,
    setThinkingEffort,
    setDetailedDiffEnabled,
    addWriteOldContent,
    setSummaryModeEnabled,
    setMessageSummary,
    incrementSessionToolCount,
  } = useAppStore();

  useEffect(() => {
    function handleMessage(event: MessageEvent<ExtensionToWebviewMessage>) {
      const msg = event.data;

      // Log all non-streaming events
      if (msg.type !== 'streamingText' && msg.type !== 'toolUseInput') {
        console.log(`%c[STREAM] ${msg.type}`, 'color: cyan; font-weight: bold', JSON.parse(JSON.stringify(msg)));
      }

      const logState = (label: string) => {
        const s = useAppStore.getState();
        console.log(`%c[STATE] ${label}`, 'color: yellow', {
          isConnected: s.isConnected,
          messageCount: s.messages.length,
          messageIds: s.messages.map(m => `${m.role}:${m.id}`),
          streamingId: s.streamingMessageId,
          streamingBlockCount: s.streamingBlocks.length,
          streamingBlockTypes: s.streamingBlocks.map(b => `${b.type}[${b.blockIndex}]`),
          isBusy: s.isBusy,
        });
      };

      const isActivityEvent =
        msg.type === 'messageStart' ||
        msg.type === 'streamingText' ||
        msg.type === 'assistantMessage' ||
        msg.type === 'toolUseStart' ||
        msg.type === 'toolUseInput' ||
        msg.type === 'toolActivity' ||
        msg.type === 'messageStop' ||
        msg.type === 'processBusy' ||
        msg.type === 'costUpdate' ||
        msg.type === 'userMessage' ||
        msg.type === 'planApprovalRequired';

      if (isActivityEvent) {
        markActivity();
      }

      switch (msg.type) {
        case 'sessionStarted':
          setProvider(msg.provider ?? 'claude');
          setSession(msg.sessionId, msg.model);
          if (msg.isResume) {
            setResuming(true);
          }
          logState('after sessionStarted');
          break;

        case 'sessionEnded':
          endSession(msg.reason);
          logState('after sessionEnded');
          break;

        case 'messageStart': {
          logState('before messageStart');
          // Do NOT clear ExitPlanMode approval bars here. The CLI auto-approves
          // ExitPlanMode and messageStart arrives ~50ms later. Clearing here
          // (Bug 3) or auto-dismissing with a timer (Bug 12) both cause the
          // bar to disappear before the user can interact.
          //
          // The bar persists until user interaction: clicking a button,
          // typing a message, or a new planApprovalRequired replacing it.
          // If the model has already moved on when the user clicks approve,
          // scheduleExitPlanApproveResumeFallback handles it gracefully
          // (skips nudge if CLI already resumed, sends nudge only if idle).
          handleMessageStart(msg.messageId, msg.model);
          // Forward thinking effort from system init (if present on messageStart)
          if (msg.thinkingEffort) {
            setThinkingEffort(msg.thinkingEffort);
          }
          // Real-time context widget update during long agentic runs.
          // costUpdate only fires on turn completion (result event), so during a
          // multi-tool-call run the widget would stay frozen. Updating inputTokens
          // here on every message_start keeps the bar live throughout the run.
          if (msg.inputTokens && msg.inputTokens > 0) {
            updateCost({ ...useAppStore.getState().cost, inputTokens: msg.inputTokens });
          }
          logState('after messageStart');
          break;
        }

        case 'streamingText':
          appendStreamingText(msg.messageId, msg.blockIndex, msg.text);
          break;

        case 'assistantMessage': {
          console.log(`%c[STREAM] assistantMessage content`, 'color: cyan',
            'isArray:', Array.isArray(msg.content),
            'type:', typeof msg.content,
            'blocks:', Array.isArray(msg.content) ? msg.content.map((b: ContentBlock) => b.type) : msg.content
          );
          // Forward thinking effort for this message
          if (msg.thinkingEffort) {
            setThinkingEffort(msg.thinkingEffort);
          }
          const currentState = useAppStore.getState();
          const isCodexMode = currentState.provider === 'codex';
          if (!currentState.streamingMessageId) {
            // No active streaming message - this is a replayed/complete message
            // (e.g. during session resume). Add directly to the messages array.
            addAssistantMessage(msg.messageId, msg.content, msg.model, msg.thinkingEffort);
          } else if (isCodexMode) {
            // Codex emits complete agent messages (not incremental snapshots).
            // Upsert immediately so the reply survives any end-of-turn ordering race
            // between messageStop/costUpdate/processBusy messages.
            addAssistantMessage(msg.messageId, msg.content, msg.model, msg.thinkingEffort);
            updateAssistantSnapshot(msg.messageId, msg.content, msg.model);
          } else {
            // Mid-stream snapshot during live streaming - store for metadata only.
            updateAssistantSnapshot(msg.messageId, msg.content, msg.model);
          }
          logState('after assistantMessage');
          break;
        }

        case 'messageStop':
          logState('before messageStop/finalize');
          finalizeStreamingMessage();
          logState('after messageStop/finalize');
          break;

        case 'userMessage':
          console.log(`%c[STREAM] userMessage content`, 'color: orange; font-weight: bold',
            'isArray:', Array.isArray(msg.content),
            'type:', typeof msg.content,
            'value:', msg.content
          );
          addUserMessage(msg.content);
          logState('after addUserMessage');
          break;

        case 'toolUseStart':
          startToolUse(
            msg.messageId,
            msg.blockIndex,
            msg.toolName,
            msg.toolId
          );
          // Track Skill invocation - accumulate across session
          if (msg.toolName === 'Skill' || msg.toolName.endsWith('__Skill')) {
            pendingSkillExtraction = true;
          }
          break;

        case 'toolUseInput':
          appendToolInput(msg.messageId, msg.blockIndex, msg.partialJson);
          // Extract skill name from accumulated partial JSON (not just the delta chunk)
          if (pendingSkillExtraction) {
            const accumulated = useAppStore.getState().streamingBlocks
              .find((b) => b.blockIndex === msg.blockIndex)?.partialJson ?? '';
            const extracted = extractSkillNameFromPartial(accumulated);
            if (extracted) {
              addSessionSkill(extracted);
              pendingSkillExtraction = false;
            }
          }
          break;

        case 'costUpdate':
          logState('before costUpdate/clearStreaming');
          clearStreaming();
          // Do NOT clear pendingApproval here.
          // Newer CLI flows may emit a result/cost update before the user responds
          // to a plan/question approval pause, so clearing it here can hide
          // Approve/Reject/Feedback controls.
          updateCost({
            costUsd: msg.costUsd,
            totalCostUsd: msg.totalCostUsd,
            inputTokens: msg.inputTokens,
            outputTokens: msg.outputTokens,
          });
          logState('after costUpdate');
          break;

        case 'error':
          console.log(`%c[STREAM] ERROR: ${msg.message}`, 'color: red; font-weight: bold');
          setError(msg.message);
          break;

        case 'processBusy':
          setBusy(msg.busy);
          if (msg.busy) {
            // Process becomes busy (e.g. user sent a message) -
            // clear any pending approval bar and previous activity summary
            setPendingApproval(null);
            setActivitySummary(null);
          } else {
            // Process becomes idle (e.g. cancel or result) -
            // finalize any in-progress streaming so partial content is preserved
            clearStreaming();
          }
          break;

        case 'handoffProgress':
          setHandoffProgress({
            stage: msg.stage,
            targetProvider: msg.targetProvider,
            artifactPath: msg.artifactPath,
            manualPrompt: msg.manualPrompt,
            error: msg.error,
            detail: msg.detail,
          });
          if (msg.stage === 'completed') {
            window.setTimeout(() => {
              clearHandoffProgress();
            }, 6000);
          }
          break;

        case 'filePathsPicked':
          setPendingFilePaths(msg.paths);
          break;

        case 'textSettings':
          setTextSettings({
            fontSize: msg.fontSize,
            fontFamily: msg.fontFamily,
          });
          break;

        case 'modelSetting':
          setSelectedModel(msg.model);
          break;

        case 'providerSetting':
          setSelectedProvider(msg.provider);
          break;

        case 'providerCapabilities':
          setProviderCapabilities(msg.capabilities);
          break;

        case 'codexReasoningEffortSetting':
          setSelectedCodexReasoningEffort(msg.effort);
          break;

        case 'codexModelOptions':
          setCodexModelOptions(msg.options);
          break;

        case 'typingThemeSetting':
          setTypingTheme(msg.theme);
          break;

        case 'permissionModeSetting':
          setPermissionMode(msg.mode);
          break;

        case 'promptHistoryResponse':
          if (msg.scope === 'project') {
            setProjectPromptHistory(msg.prompts);
          } else {
            setGlobalPromptHistory(msg.prompts);
          }
          break;

        case 'toolActivity':
          setToolActivity(msg.detail || null);
          incrementSessionToolCount();
          break;

        case 'summaryModeSetting':
          setSummaryModeEnabled(msg.enabled);
          break;

        case 'vpmSetting':
          useAppStore.getState().setVpmEnabled(msg.enabled);
          break;

        case 'visualProgressCard':
          useAppStore.getState().addVisualProgressCard({
            ...msg.card,
            category: msg.card.category as import('../state/store').ToolCategory,
          });
          break;

        case 'visualProgressCardUpdate':
          useAppStore.getState().updateCardDescription(msg.cardId, msg.aiDescription);
          break;

        case 'messageSummary':
          setMessageSummary(msg.messageId, {
            shortLabel: msg.shortLabel,
            fullSummary: msg.fullSummary,
          });
          break;

        case 'activitySummary':
          setActivitySummary({
            shortLabel: msg.shortLabel,
            fullSummary: msg.fullSummary,
          });
          break;

        case 'planApprovalRequired': {
          // Extract plan text from streaming blocks before finalizing
          const currentState = useAppStore.getState();
          const planBlock = currentState.streamingBlocks.find(
            b => b.type === 'tool_use' && (b.toolName === 'ExitPlanMode' || b.toolName === 'AskUserQuestion')
          );
          const planText = planBlock?.partialJson || '';

          // Finalize the streaming message so it appears in chat history
          finalizeStreamingMessage();
          // CLI is paused waiting for input, not busy
          setBusy(false);
          // Show the approval bar
          setPendingApproval({ toolName: msg.toolName, planText });
          break;
        }

        case 'planApprovalDismissed':
          // Bug 16 fix: extension detected non-plan tool activity while ExitPlanMode
          // bar was visible. Auto-dismiss the bar since the model has moved on.
          setPendingApproval(null);
          break;

        case 'gitPushResult':
          setGitPushRunning(false);
          setGitPushResult({ success: msg.success, output: msg.output });
          break;

        case 'gitPushSettings':
          setGitPushSettings({
            enabled: msg.enabled,
            scriptPath: msg.scriptPath,
            commitMessageTemplate: msg.commitMessageTemplate,
          });
          break;

        case 'forkInit':
          // Populate the store with conversation history from the original tab
          if (msg.messages && msg.messages.length > 0) {
            const hydratedMessages = msg.messages.map((m: import('../../extension/types/webview-messages').SerializedChatMessage) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              model: m.model,
              timestamp: m.timestamp,
              thinkingEffort: m.thinkingEffort,
            }));
            useAppStore.setState({
              messages: hydratedMessages,
            });
            rebuildTurnHistoryFromMessages(hydratedMessages);
          }
          setForkInit({ promptText: msg.promptText });
          break;

        case 'conversationHistory':
          // Populate the store with conversation history read from Claude's session storage.
          // This is used when resuming a session - the CLI in pipe mode doesn't replay
          // messages until user sends input, so we read them from disk instead.
          if (msg.messages && msg.messages.length > 0) {
            console.log(`%c[STREAM] conversationHistory: ${msg.messages.length} messages`, 'color: lime; font-weight: bold');
            const hydratedMessages = msg.messages.map((m: import('../../extension/types/webview-messages').SerializedChatMessage) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              model: m.model,
              timestamp: m.timestamp,
              thinkingEffort: m.thinkingEffort,
            }));
            useAppStore.setState({
              messages: hydratedMessages,
              isResuming: false,
            });
            rebuildTurnHistoryFromMessages(hydratedMessages);
          }
          break;

        case 'translationResult':
          setTranslating(msg.messageId, false);
          if (msg.success && msg.translatedText) {
            setTranslation(msg.messageId, msg.translatedText);
          } else {
            useAppStore.getState().setTranslationError(
              msg.messageId,
              msg.error || 'Translation failed'
            );
          }
          break;

        case 'translationLanguageSetting':
          useAppStore.getState().setTranslationLanguage(msg.language);
          break;

        case 'fileSearchResults':
          window.dispatchEvent(
            new CustomEvent('file-search-results', { detail: msg })
          );
          break;

        case 'achievementsSettings':
          setAchievementsSettings({ enabled: msg.enabled, sound: msg.sound });
          break;

        case 'achievementsSnapshot':
          setAchievementsSnapshot({
            profile: msg.profile,
            goals: msg.goals,
          });
          break;

        case 'achievementAwarded':
          addAchievementToast(msg.achievement, msg.profile);
          break;

        case 'achievementProgress':
          setAchievementGoals(msg.goals);
          break;

        case 'sessionRecap':
          setSessionRecap(msg.recap);
          break;

        // --- GitHub Sync / Community ---
        case 'githubSyncStatus':
          setGithubSyncStatus({
            connected: msg.connected,
            username: msg.username,
            gistId: msg.gistId,
            gistUrl: msg.gistUrl,
            lastSyncedAt: msg.lastSyncedAt,
            syncEnabled: msg.syncEnabled,
          });
          break;

        case 'communityData':
          setCommunityFriends(msg.friends);
          break;

        case 'friendActionResult':
          setFriendActionPending(false);
          break;

        case 'shareCardCopied':
          // Handled by ShareCard component via event listener
          break;

        case 'turnComplete':
          addTurnRecord(msg.turn);
          break;

        case 'ultrathinkLockedSetting':
          setUltrathinkLocked(msg.locked);
          break;

        case 'vitalsSetting':
          setVitalsEnabled(msg.enabled);
          break;

        case 'detailedDiffViewSetting':
          setDetailedDiffEnabled(msg.enabled);
          break;

        case 'fileOldContent':
          addWriteOldContent(msg.toolUseId, msg.filePath, msg.oldContent);
          break;

        case 'adventureWidgetSetting':
          setAdventureEnabled(msg.enabled);
          break;

        case 'adventureBeat':
          addAdventureBeat(msg.beat as import('../components/Vitals/adventure/types').AdventureBeat);
          break;

        case 'turnSemantics':
          applyTurnSemantics(msg.messageId, msg.semantics);
          break;

        case 'turnAnalysisSettings':
          setTurnAnalysisSettings({ enabled: msg.enabled, analysisModel: msg.analysisModel });
          break;

        case 'sessionMetadata':
          setSessionMetadata({ tools: msg.tools, model: msg.model, cwd: msg.cwd, mcpServers: msg.mcpServers });
          break;

        case 'projectAnalyticsData':
          setProjectSessions(msg.sessions);
          break;

        case 'enhancePromptResult':
          setIsEnhancing(false);
          if (msg.success && msg.enhancedText) {
            window.dispatchEvent(
              new CustomEvent('prompt-enhanced', { detail: msg.enhancedText })
            );
          } else {
            window.dispatchEvent(
              new CustomEvent('prompt-enhance-failed', { detail: msg.error })
            );
          }
          break;

        case 'promptEnhancerSettings':
          setPromptEnhancerSettings({
            autoEnhance: msg.autoEnhance,
            enhancerModel: msg.enhancerModel,
          });
          break;

        // --- Prompt Translation ---
        case 'translatePromptResult':
          setIsTranslatingPrompt(false);
          if (msg.success && msg.translatedText) {
            window.dispatchEvent(
              new CustomEvent('prompt-translated', { detail: msg.translatedText })
            );
          } else {
            window.dispatchEvent(
              new CustomEvent('prompt-translate-failed', { detail: msg.error })
            );
          }
          break;

        case 'promptTranslatorSettings':
          setPromptTranslatorSettings({
            translateEnabled: msg.translateEnabled,
            autoTranslate: msg.autoTranslate,
          });
          break;

        // --- Babel Fish ---
        case 'babelFishSettings':
          useAppStore.getState().setBabelFishEnabled(msg.enabled);
          if (msg.language) {
            useAppStore.getState().setTranslationLanguage(msg.language);
          }
          break;

        case 'autoTranslateStarted':
          setTranslating(msg.messageId, true);
          break;

        // --- Skill Generation ---
        case 'skillGenSettings':
          setSkillGenSettings({ enabled: msg.enabled, threshold: msg.threshold });
          break;

        case 'skillGenStatus':
          setSkillGenStatus({
            pendingDocs: msg.pendingDocs,
            threshold: msg.threshold,
            runStatus: msg.runStatus,
            progress: msg.progress,
            progressLabel: msg.progressLabel,
            lastRun: msg.lastRun,
            history: msg.history,
          });
          break;

        case 'skillGenProgress':
          setSkillGenProgress({
            runStatus: msg.runStatus,
            progress: msg.progress,
            progressLabel: msg.progressLabel,
          });
          break;

        case 'skillGenComplete':
          // Progress is updated via skillGenProgress; also refresh status
          // The extension sends a skillGenStatus right after skillGenComplete
          break;

        case 'apiKeySetting':
          setApiKeySetting(msg.hasKey, msg.maskedKey);
          break;

        case 'claudeAuthStatus':
          setClaudeAuthStatus(msg.loggedIn, msg.email, msg.subscriptionType);
          break;

        case 'usageWidgetSetting':
          setUsageWidgetEnabled(msg.enabled);
          break;

        case 'usageData':
          setUsageData(msg.stats, msg.fetchedAt, msg.error);
          break;

        case 'tokenRatioData':
          setTokenRatioData(msg.samples, msg.summaries, msg.globalTurnCount, msg.cumulativeTokens, msg.cumulativeWeightedTokens);
          break;

        // ----- Agent Teams -----
        case 'teamStateUpdate':
          setTeamState({
            teamName: msg.teamName,
            config: msg.config,
            tasks: msg.tasks,
            agentStatuses: msg.agentStatuses,
            recentMessages: msg.recentMessages,
          });
          break;
        case 'teamDetected':
          setTeamActive(true, msg.teamName);
          break;
        case 'teamDismissed':
          clearTeamState();
          break;

        // ----- Bug Report -----
        case 'bugReportOpen':
          useAppStore.getState().setBugReportPanelOpen(true);
          break;
        case 'bugReportStatus':
          useAppStore.setState({
            bugReportPhase: msg.phase,
            ...(msg.summary ? { bugReportDiagSummary: msg.summary } : {}),
            ...(msg.error ? { bugReportError: msg.error } : {}),
          });
          break;
        case 'bugReportChatResponse':
          useAppStore.setState((s) => ({
            bugReportChatMessages: [
              ...s.bugReportChatMessages,
              { role: 'assistant' as const, content: msg.text, scripts: msg.scripts },
            ],
            bugReportChatLoading: false,
          }));
          break;
        case 'bugReportScriptResult':
          useAppStore.setState((s) => ({
            bugReportChatMessages: [
              ...s.bugReportChatMessages,
              { role: 'script' as const, content: `[Exit ${msg.exitCode}]\n${msg.output}` },
            ],
            bugReportChatLoading: true, // AI will auto-analyze the script output
          }));
          break;
        case 'bugReportPreview':
          useAppStore.setState({ bugReportPreviewFiles: msg.files });
          break;
        case 'bugReportSubmitResult':
          useAppStore.setState({
            bugReportPhase: msg.ok ? 'sent' : 'error',
            ...(msg.error ? { bugReportError: msg.error } : {}),
          });
          break;

        case 'thinkingEffortUpdate':
          setThinkingEffort(msg.effort);
          break;
      }
    }

    window.addEventListener('message', handleMessage);

    // Tell the extension we are ready
    vscodeApi?.postMessage({ type: 'ready' });

    return () => {
      window.removeEventListener('message', handleMessage);
      // cleanup (no active timers to clear)
    };
  }, [
    setSession,
    endSession,
    addUserMessage,
    addAssistantMessage,
    handleMessageStart,
    appendStreamingText,
    startToolUse,
    appendToolInput,
    updateAssistantSnapshot,
    finalizeStreamingMessage,
    clearStreaming,
    setBusy,
    markActivity,
    updateCost,
    setError,
    setPendingFilePaths,
    setTextSettings,
    setTypingTheme,
    setProvider,
    setSelectedProvider,
    setProviderCapabilities,
    setSelectedModel,
    setSelectedCodexReasoningEffort,
    setCodexModelOptions,
    setResuming,
    setPendingApproval,
    setProjectPromptHistory,
    setGlobalPromptHistory,
    setToolActivity,
    setActivitySummary,
    setPermissionMode,
    setGitPushSettings,
    setGitPushResult,
    setGitPushRunning,
    setForkInit,
    setTranslation,
    setTranslating,
    setAchievementsSettings,
    setAchievementsSnapshot,
    addAchievementToast,
    setAchievementGoals,
    setSessionRecap,
    setUltrathinkLocked,
    setVitalsEnabled,
    rebuildTurnHistoryFromMessages,
    setAdventureEnabled,
    addTurnRecord,
    addAdventureBeat,
    applyTurnSemantics,
    setTurnAnalysisSettings,
    setSessionMetadata,
    setProjectSessions,
    setIsEnhancing,
    setPromptEnhancerSettings,
    setIsTranslatingPrompt,
    setPromptTranslatorSettings,
    addSessionSkill,
    setSkillGenSettings,
    setSkillGenStatus,
    setSkillGenProgress,
    setApiKeySetting,
    setClaudeAuthStatus,
    setUsageWidgetEnabled,
    setUsageData,
    setTokenRatioData,
    setTeamState,
    setTeamActive,
    clearTeamState,
    setThinkingEffort,
    setDetailedDiffEnabled,
    addWriteOldContent,
  ]);
}

/** Post a message from the webview to the extension host */
export function postToExtension(
  message: import('../../extension/types/webview-messages').WebviewToExtensionMessage
): void {
  if (!vscodeApi) {
    console.warn('[WEBVIEW->EXT] VS Code API unavailable; message dropped', message);
    return;
  }
  if (
    message.type === 'setProvider' ||
    message.type === 'startSession' ||
    message.type === 'openProviderTab' ||
    message.type === 'planApprovalResponse'
  ) {
    console.log(`%c[WEBVIEW->EXT] ${message.type}`, 'color: #7ee787; font-weight: bold', JSON.parse(JSON.stringify(message)));
  }
  vscodeApi.postMessage(message);
}

/** Tracks whether a Skill tool_use block is waiting for its name from streaming input */
let pendingSkillExtraction = false;

/** Extract skill name from streaming partial JSON input of a Skill tool */
function extractSkillNameFromPartial(partialJson: string): string | null {
  try {
    const parsed = JSON.parse(partialJson);
    if (typeof parsed.skill === 'string') return parsed.skill;
  } catch {
    const match = partialJson.match(/"skill"\s*:\s*"([^"]+)"/);
    return match?.[1] ?? null;
  }
  return null;
}
