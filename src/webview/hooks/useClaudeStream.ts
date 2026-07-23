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
    setSessionWorktree,
    endSession,
    addUserMessage,
    addAssistantMessage,
    addInjectedAssistantContent,
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
    setMessageColorScheme,
    setProvider,
    setSelectedProvider,
    setProviderCapabilities,
    setSelectedModel,
    setLastResolvedDefaultModel,
    setSelectedClaudeEffort,
    setSelectedClaudeFastMode,
    setSelectedCodexReasoningEffort,
    setSelectedCodexServiceTier,
    setCodexModelOptions,
    setResuming,
    setPendingApproval,
    setProjectPromptHistory,
    setGlobalPromptHistory,
    setToolActivity,
    setActivitySummary,
    setActivitySummaryDismissed,
    setActivitySummaryEnabled,
    setPermissionMode,
    setCompactingSession,
    setCompactSessionNotice,
    setGitPushSettings,
    setGitPushResult,
    setGitPushRunning,
    setCustomSnippetText,
    setForkInit,
    setTranslation,
    setTranslating,
    setAchievementsSettings,
    setAchievementsSnapshot,
    addAchievementToast,
    setAchievementGoals,
    setSessionRecap,
    setUltrathinkMode,
    setVitalsEnabled,
    setTabLayout,
    setOpenTabs,
    setWeatherWidgetEnabled,
    rebuildTurnHistoryFromMessages,
    setAdventureEnabled,
    addTurnRecord,
    addAdventureBeat,
    applyTurnSemantics,
    setTurnAnalysisSettings,
    setSessionMetadata,
    setMcpPanelOpen,
    setMcpSelectedTab,
    setMcpInventory,
    setMcpPendingRestartCount,
    setMcpLoading,
    setMcpLastError,
    setMcpLastOperation,
    setMcpTemplates,
    setMcpDiffPreview,
    setWorktreePanelOpen,
    setWorktreeList,
    setWorktreeActionResult,
    setMergeBranches,
    setMergePreview,
    setMergeResult,
    setMergeDefaults,
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
    setRestoreSessionsEnabled,
    setUsageData,
    setUsageLimitState,
    setUsageQueuedPromptState,
    appendMemorySnapshot,
    setMemoryStreamError,
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
    applyReviewLoopEvent,
    setReviewLoopAutoStart,
    setReviewLoopMaxRoundsSetting,
    setReviewLoopSessionEnabled,
    initBtwSession,
    addBtwUserMessage,
    handleBtwMessageStart,
    handleBtwStreamingText,
    addBtwAssistantMessage,
    handleBtwMessageStop,
    handleBtwResult,
    clearBtwSession,
    handleMergeAssistantMessageStart,
    handleMergeAssistantStreamingText,
    addMergeAssistantToolUse,
    addMergeAssistantAssistantMessage,
    handleMergeAssistantResult,
    setMergeConflictFiles,
    markStreamingMessageInterrupted,
    recordDeferredMessage,
    clearDeferredMessage,
    failDeferredMessage,
    setSilentResumeActive,
    setWorkstreamMapData,
    setWorkstreamMapClassifying,
    setWorkstreamMapError,
    setWorkstreamResumeState,
    setWorkstreamMapOpen,
    setSecretProtectionStatus,
    setSecretProtectionAuditEvents,
    setSecretProtectionAuditError,
    setSecretProtectionComplianceReport,
    // Multi-Participant
    setMpConnectionStatus,
    setMpSession,
    addMpMessage,
    setMpParticipants,
    updateMpParticipant,
    removeMpParticipant,
    setMpDeliveryStatus,
    appendMpStreamingText,
    addMpApprovalEvent,
    resolveMpApproval,
    setMpFileConflict,
    setMpTypingState,
    setMpJoinError,
    setMpRenameError,
    updateMpReaction,
    clearMpState,
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
          setSession(msg.sessionId, msg.model, msg.tabKind ?? 'chat');
          // Must run AFTER setSession: a brand-new/pending->real transition resets
          // session state (clearing sessionWorktree), so set the indicator last.
          setSessionWorktree(
            msg.worktreePath && msg.worktreeName
              ? { path: msg.worktreePath, name: msg.worktreeName }
              : null,
          );
          if (msg.isResume) {
            setResuming(true);
          }
          logState('after sessionStarted');
          break;

        case 'sessionEnded':
          endSession(msg.reason);
          logState('after sessionEnded');
          break;

        case 'interruptedAssistantMessage':
          markStreamingMessageInterrupted(msg.messageId);
          break;

        case 'messageDeferred':
          recordDeferredMessage(msg.id, msg.text);
          break;

        case 'messageDeferredDelivered':
          clearDeferredMessage(msg.id);
          break;

        case 'messageDeferredFailed':
          failDeferredMessage(msg.id, msg.text, msg.reason);
          break;

        case 'silentResumeStatus':
          setSilentResumeActive(msg.active);
          break;

        case 'workstreamMapData':
          setWorkstreamMapData(msg.data);
          setWorkstreamMapOpen(true);
          setWorkstreamMapClassifying(false);
          setWorkstreamMapError(null);
          break;

        case 'workstreamMapClassifying':
          setWorkstreamMapClassifying(msg.progress < 1, msg.progress, msg.phase);
          break;

        case 'workstreamMapError':
          setWorkstreamMapError(msg.message);
          setWorkstreamMapClassifying(false);
          break;

        case 'workstreamMapResumeState':
          setWorkstreamResumeState(msg.resumeState);
          break;

        case 'toggleWorkstreamMap':
          setWorkstreamMapOpen(msg.open ?? !useAppStore.getState().workstreamMapOpen);
          break;

        case 'workstreamPortfolioData': {
          const store = useAppStore.getState();
          const normalizePath = (value: string) => value.replace(/\\/g, '/').toLowerCase();
          const currentWorkspacePath = msg.currentWorkspacePath ?? '';
          const currentWorkspaceInPortfolio = !!currentWorkspacePath && msg.data.projects.some(project =>
            normalizePath(project.projectPath) === normalizePath(currentWorkspacePath)
          );
          store.setUserPortfolioData(msg.data, msg.currentWorkspacePath);
          if (
            msg.data.projects.length > 1 &&
            store.workstreamMapZoom === 'project' &&
            !store.userPortfolioData &&
            (store.workstreamMapData || currentWorkspaceInPortfolio)
          ) {
            store.setWorkstreamMapZoom('portfolio');
          }
          break;
        }

        case 'workstreamPortfolioNavigateToProject':
          useAppStore.getState().setCachedViewProject(null);
          useAppStore.getState().setWorkstreamMapZoom('project');
          break;

        case 'toggleWorkstreamPortfolio':
          setWorkstreamMapOpen(true);
          useAppStore.getState().setWorkstreamMapZoom('portfolio');
          break;

        case 'particleAcceleratorStatus': {
          const lbMsg = msg as { type: string; status: NonNullable<ReturnType<typeof useAppStore.getState>['particleAcceleratorStatus']> };
          useAppStore.getState().setParticleAcceleratorStatus(lbMsg.status);
          break;
        }
        case 'particleAcceleratorAggregateUpdate': {
          const lbAgg = msg as { type: string; aggregate: NonNullable<ReturnType<typeof useAppStore.getState>['particleAcceleratorAggregate']> };
          useAppStore.getState().setParticleAcceleratorAggregate(lbAgg.aggregate);
          break;
        }
        case 'particleAcceleratorTraceUpdate': {
          const lbTrace = msg as unknown as { type: string; trace: ReturnType<typeof useAppStore.getState>['particleAcceleratorRecentTraces'][number] };
          useAppStore.getState().addParticleAcceleratorTrace(lbTrace.trace);
          break;
        }
        case 'particleAcceleratorRecentTraces': {
          const lbTraces = msg as unknown as { type: string; traces: ReturnType<typeof useAppStore.getState>['particleAcceleratorRecentTraces'] };
          useAppStore.getState().setParticleAcceleratorRecentTraces(lbTraces.traces);
          break;
        }
        case 'particleAcceleratorError': {
          const lbErr = msg as { type: string; error: string };
          useAppStore.getState().setParticleAcceleratorError(lbErr.error);
          break;
        }

        case 'secretProtectionStatus':
          setSecretProtectionStatus({
            enabled: msg.enabled,
            settings: msg.settings,
            auditCount: msg.auditCount,
            lastEvent: msg.lastEvent,
          });
          break;

        case 'secretProtectionAuditEvents':
          setSecretProtectionAuditEvents(msg.events);
          break;

        case 'secretProtectionComplianceReport':
          setSecretProtectionComplianceReport(msg.report);
          break;

        case 'secretProtectionError':
          setSecretProtectionAuditError(msg.error);
          break;

        case 'superParticleAcceleratorStatus': {
          const spaStatus = msg as { status: string; enabled: boolean; mode: 'block' | 'audit' };
          useAppStore.getState().setSuperParticleAcceleratorStatus(spaStatus.status, spaStatus.enabled, spaStatus.mode);
          break;
        }
        case 'superParticleAcceleratorAuditEvents': {
          const spaEvents = msg as { events: ReturnType<typeof useAppStore.getState>['superParticleAcceleratorAuditEvents'] };
          useAppStore.getState().setSuperParticleAcceleratorAuditEvents(spaEvents.events);
          break;
        }
        case 'superParticleAcceleratorLastEvent': {
          const spaLastEvent = msg as { event: { action: string } };
          useAppStore.getState().setSuperParticleAcceleratorLastEvent(spaLastEvent.event);
          break;
        }
        case 'superParticleAcceleratorError': {
          const spaErr = msg as { error: string };
          useAppStore.getState().setSuperParticleAcceleratorError(spaErr.error);
          break;
        }

        case 'workspaceAccessGuardStatus': {
          const wagStatus = msg as { status: { enabled: boolean; mode: 'block' | 'audit'; hookStatus: string } };
          useAppStore.getState().setWorkspaceAccessGuardStatus(wagStatus.status);
          break;
        }
        case 'workspaceAccessGuardAllowedRoots': {
          const wagRoots = msg as { roots: ReturnType<typeof useAppStore.getState>['workspaceAccessGuardAllowedRoots'] };
          useAppStore.getState().setWorkspaceAccessGuardAllowedRoots(wagRoots.roots);
          break;
        }
        case 'workspaceAccessGuardOrgPolicyStatus': {
          const wagPolicy = msg as { status: NonNullable<ReturnType<typeof useAppStore.getState>['workspaceAccessGuardOrgPolicyStatus']> };
          useAppStore.getState().setWorkspaceAccessGuardOrgPolicyStatus(wagPolicy.status);
          break;
        }
        case 'workspaceAccessGuardAuditEvents': {
          const wagEvents = msg as { events: ReturnType<typeof useAppStore.getState>['workspaceAccessGuardAuditEvents'] };
          useAppStore.getState().setWorkspaceAccessGuardAuditEvents(wagEvents.events);
          break;
        }
        case 'workspaceAccessGuardTestResult': {
          const wagResult = msg as { result: NonNullable<ReturnType<typeof useAppStore.getState>['workspaceAccessGuardTestResult']> };
          useAppStore.getState().setWorkspaceAccessGuardTestResult(wagResult.result);
          break;
        }
        case 'workspaceAccessGuardError': {
          const wagErr = msg as { error: string };
          useAppStore.getState().setWorkspaceAccessGuardError(wagErr.error);
          break;
        }

        case 'toggleMcpPanel':
          setMcpPanelOpen(msg.open ?? !useAppStore.getState().mcpPanelOpen);
          if (msg.tab) {
            setMcpSelectedTab(msg.tab);
          }
          break;

        case 'openWorktreePanel':
          setWorktreePanelOpen(true);
          break;

        case 'worktreeList':
          setWorktreeList(msg.worktrees, msg.isGitRepo);
          break;

        case 'worktreeActionResult':
          setWorktreeActionResult(msg);
          break;

        case 'branchList':
          setMergeBranches(msg.branches);
          break;

        case 'mergePreview':
          setMergePreview(msg.preview);
          setMergeDefaults({
            defaultStrategy: msg.defaultStrategy,
            removeAfterMerge: msg.removeAfterDefault,
            confirmIntoProtected: msg.confirmIntoProtected,
          });
          break;

        case 'mergeResult':
          setMergeResult(msg.result);
          break;

        case 'mcpInventory':
          setMcpInventory(msg.servers, msg.configPaths ?? null);
          setMcpPendingRestartCount(msg.pendingRestartCount);
          setMcpLoading(false);
          setMcpLastError(msg.lastError ?? null);
          break;

        case 'mcpCatalog':
          setMcpTemplates(msg.templates);
          break;

        case 'mcpDiffPreview':
          setMcpLoading(false);
          setMcpDiffPreview(msg.preview);
          break;

        case 'mcpOperationResult':
          setMcpLoading(false);
          setMcpLastOperation({
            op: msg.operation,
            name: msg.name,
            success: msg.success,
            restartNeeded: msg.restartNeeded,
            nextAction: msg.nextAction,
          });
          if (!msg.success) {
            setMcpLastError(msg.error || 'MCP operation failed');
          }
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
            addAssistantMessage(msg.messageId, msg.content, msg.model, msg.thinkingEffort, {
              secretsDetected: msg.secretsDetected,
              redactionApplied: msg.redactionApplied,
            });
          } else if (isCodexMode) {
            // Codex emits complete agent messages (not incremental snapshots).
            // Upsert immediately so the reply survives any end-of-turn ordering race
            // between messageStop/costUpdate/processBusy messages.
            addAssistantMessage(msg.messageId, msg.content, msg.model, msg.thinkingEffort, {
              secretsDetected: msg.secretsDetected,
              redactionApplied: msg.redactionApplied,
            });
            updateAssistantSnapshot(msg.messageId, msg.content, msg.model, {
              secretsDetected: msg.secretsDetected,
              redactionApplied: msg.redactionApplied,
            });
          } else {
            // Mid-stream snapshot during live streaming - store for metadata only.
            updateAssistantSnapshot(msg.messageId, msg.content, msg.model, {
              secretsDetected: msg.secretsDetected,
              redactionApplied: msg.redactionApplied,
            });
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
          addUserMessage(msg.content, msg.source ?? 'input', {
            secretsDetected: msg.secretsDetected,
            redactionApplied: msg.redactionApplied,
          });
          logState('after addUserMessage');
          break;

        case 'syntheticToolContent':
          // CLI-injected synthetic content (skill body, sub-agent dispatch
          // context, system reminder). Render as part of Claude's output
          // flow, never as a "YOU" message.
          console.log(`%c[STREAM] syntheticToolContent`, 'color: cyan; font-weight: bold',
            'sourceToolUseID:', msg.sourceToolUseID,
            'blocks:', Array.isArray(msg.content) ? msg.content.length : 0,
          );
          addInjectedAssistantContent(msg.content);
          logState('after addInjectedAssistantContent');
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
              postToExtension({ type: 'skillUsageReport', skillName: extracted });
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
            // clear any pending approval bar; keep activity summary visible
            // until a new one replaces it or the user dismisses it
            setPendingApproval(null);
            setActivitySummaryDismissed(false);
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

        case 'defaultModelHint':
          // Model the CLI last resolved "Default" to; shown on the selector before
          // this session's own system/init reports the live model.
          setLastResolvedDefaultModel(msg.model || null);
          break;

        case 'claudeEffortSetting':
          setSelectedClaudeEffort(msg.effort);
          break;

        case 'claudeFastModeSetting':
          setSelectedClaudeFastMode(msg.fastMode);
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

        case 'codexServiceTierSetting':
          setSelectedCodexServiceTier(msg.serviceTier);
          break;

        case 'codexModelOptions':
          setCodexModelOptions(msg.options);
          break;

        case 'typingThemeSetting':
          setTypingTheme(msg.theme);
          break;

        case 'messageColorSchemeSetting':
          setMessageColorScheme(msg.scheme);
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
          // Only accept summaries when the feature is enabled
          if (useAppStore.getState().activitySummaryEnabled) {
            setActivitySummary({
              shortLabel: msg.shortLabel,
              fullSummary: msg.fullSummary,
            });
          }
          break;

        case 'planApprovalRequired': {
          // Control-protocol path passes planText explicitly: its can_use_tool request
          // arrives after messageStop cleared streamingBlocks. Legacy path has no
          // planText, so fall back to extracting it from the streaming tool_use block.
          let planText = msg.planText ?? '';
          if (!planText) {
            const currentState = useAppStore.getState();
            const planBlock = currentState.streamingBlocks.find(
              b => b.type === 'tool_use' && (b.toolName === 'ExitPlanMode' || b.toolName === 'AskUserQuestion')
            );
            planText = planBlock?.partialJson || '';
          }

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

        case 'compactSessionResult': {
          setCompactingSession(false);
          if (msg.success) {
            const bits: string[] = ['Compact prompt ready.'];
            if (msg.openedNewTab) bits.push('Opened a new tab with it pre-filled.');
            if (msg.copiedToClipboard) bits.push('Copied to clipboard.');
            if (msg.source === 'heuristic') bits.push('(quick summary — AI unavailable)');
            setCompactSessionNotice({ success: true, text: bits.join(' ') });
          } else {
            setCompactSessionNotice({
              success: false,
              text: `Compact failed: ${msg.error || 'unknown error'}`,
            });
          }
          break;
        }

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

        case 'customSnippetSettings':
          setCustomSnippetText(msg.text);
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
              source: m.source,
              synthetic: m.synthetic,
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
              source: m.source,
              synthetic: m.synthetic,
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

        case 'ultrathinkModeSetting':
          setUltrathinkMode(msg.mode);
          break;

        case 'goalStateSetting':
          useAppStore.getState().setGoalActive(msg.active, msg.objective);
          break;

        case 'vitalsSetting':
          setVitalsEnabled(msg.enabled);
          break;

        case 'tabLayoutSetting':
          setTabLayout(msg.layout);
          break;

        case 'tabList':
          setOpenTabs(msg.tabs, msg.activeTabId);
          break;

        case 'detailedDiffViewSetting':
          setDetailedDiffEnabled(msg.enabled);
          break;

        case 'fileOldContent':
          addWriteOldContent(msg.toolUseId, msg.filePath, msg.oldContent);
          break;

        case 'checkpointState':
          useAppStore.getState().setCheckpointState(msg.state);
          break;

        case 'checkpointResult':
          useAppStore.getState().setCheckpointResult({
            success: msg.success,
            action: msg.action,
            targetTurnIndex: msg.targetTurnIndex,
            error: msg.error,
            conflicts: msg.conflicts,
          });
          break;

        case 'adventureWidgetSetting':
          setAdventureEnabled(msg.enabled);
          break;

        case 'weatherWidgetSetting':
          setWeatherWidgetEnabled(msg.enabled);
          break;

        case 'activitySummarySetting':
          setActivitySummaryEnabled(msg.enabled);
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
          setSkillGenSettings({ enabled: msg.enabled, threshold: msg.threshold, onboardingSeen: msg.onboardingSeen });
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

        case 'restoreSessionsSetting':
          setRestoreSessionsEnabled(msg.enabled);
          break;

        case 'usageData':
          setUsageData(msg.stats, msg.fetchedAt, msg.error);
          break;

        case 'memorySnapshot':
          appendMemorySnapshot(msg);
          break;

        case 'memoryStreamError':
          setMemoryStreamError(msg.error);
          break;

        case 'usageLimitDetected':
          setUsageLimitState({
            active: msg.active,
            resetAtMs: msg.resetAtMs ?? null,
            resetDisplay: msg.resetDisplay,
            rawMessage: msg.rawMessage || null,
          });
          break;

        case 'usageQueuedPromptState':
          setUsageQueuedPromptState({
            queued: msg.queued,
            scheduledSendAtMs: msg.scheduledSendAtMs ?? null,
            summary: msg.summary ?? null,
          });
          break;

        case 'scheduledMessageState':
          useAppStore.getState().setScheduledMessageState({
            scheduled: msg.scheduled,
            text: msg.text ?? null,
            scheduledAtMs: msg.scheduledAtMs ?? null,
            summary: msg.summary ?? null,
          });
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
          useAppStore.getState().setBugReportContext(null);
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

        case 'focusInput':
          window.dispatchEvent(new Event('claui-focus-input'));
          break;

        // --- BTW Background Session events ---
        case 'btwSessionStarted':
          initBtwSession();
          break;

        case 'btwUserMessage':
          // Skip CLI echo - user messages are added optimistically in BtwPopup/MessageList
          break;

        case 'btwMessageStart':
          handleBtwMessageStart(msg.messageId);
          break;

        case 'btwStreamingText':
          handleBtwStreamingText(msg.blockIndex, msg.text);
          break;

        case 'btwAssistantMessage':
          addBtwAssistantMessage(msg.messageId, msg.content, msg.model);
          break;

        case 'btwMessageStop':
          handleBtwMessageStop();
          break;

        case 'btwResult':
          handleBtwResult();
          break;

        case 'btwSessionEnded':
          // Don't clear session state immediately - user may want to read the conversation
          // Just mark it as not busy
          handleBtwResult();
          break;

        // --- Review Loop events ---
        case 'reviewLoopEvent':
          applyReviewLoopEvent(msg.event);
          break;

        case 'reviewLoopAutoStartSetting':
          setReviewLoopAutoStart(msg.enabled);
          break;

        case 'reviewLoopMaxRoundsSetting':
          setReviewLoopMaxRoundsSetting(msg.value);
          break;

        case 'reviewLoopSessionEnabledSetting':
          setReviewLoopSessionEnabled(msg.enabled);
          break;

        // --- Merge Conflict Assistant events ---
        case 'mergeAssistantUserMessage':
          // Skip CLI echo - user messages are added optimistically in MergeAssistantChat
          break;

        case 'mergeAssistantMessageStart':
          handleMergeAssistantMessageStart(msg.messageId);
          break;

        case 'mergeAssistantStreamingText':
          handleMergeAssistantStreamingText(msg.blockIndex, msg.text);
          break;

        case 'mergeAssistantToolUse':
          addMergeAssistantToolUse(msg.blockIndex, msg.toolName, msg.summary);
          break;

        case 'mergeAssistantAssistantMessage':
          addMergeAssistantAssistantMessage(msg.messageId, msg.content, msg.model);
          break;

        case 'mergeAssistantResult':
          handleMergeAssistantResult();
          break;

        case 'mergeAssistantSessionEnded':
          // Keep the conversation visible; just mark it not busy.
          handleMergeAssistantResult();
          break;

        case 'mergeConflictsRefreshed':
          setMergeConflictFiles(msg.targetPath, msg.conflictFiles);
          break;

        case 'chatSearchProjectResults':
          useAppStore.getState().setChatSearchProjectResults(msg.results, msg.requestId);
          break;

        // --- Multi-Participant ---
        case 'mpInitDialog':
          useAppStore.getState().setMpDialogDefaults({ mode: msg.mode, humanName: msg.defaultHumanName, agentName: msg.defaultAgentName, serverUrl: msg.serverUrl });
          break;

        case 'mpConnectionStatus':
          setMpConnectionStatus(msg.status, msg.message);
          break;

        case 'mpSessionState':
          setMpSession(
            msg.session,
            msg.participants,
            msg.transcript,
            msg.myHumanId,
            msg.myAgentId,
            msg.approvals,
            msg.typingStates,
            msg.fileConflicts,
            msg.reactions,
          );
          break;

        case 'mpNewMessage':
          addMpMessage(msg.message);
          break;

        case 'mpParticipants':
          setMpParticipants(msg.participants);
          break;

        case 'mpDeliveryStatus':
          setMpDeliveryStatus(
            msg.deliveryId,
            msg.agentParticipantId,
            msg.agentDisplayName,
            msg.status,
            msg.errorText,
            msg.interruptedByDeliveryId,
          );
          break;

        case 'mpAgentStreamingText':
          appendMpStreamingText(msg.deliveryId, msg.text, msg.accumulatedText);
          break;

        case 'mpParticipantActivity':
          setMpTypingState(msg.activity);
          break;

        case 'mpAgentToAgentApproval':
          addMpApprovalEvent(msg.approval);
          break;

        case 'mpA2aPendingApproval':
          addMpApprovalEvent(msg.approval);
          break;

        case 'mpApprovalResolved':
          resolveMpApproval(msg.approval.eventId, msg.decision.type, msg.decidedByParticipantId);
          break;

        case 'mpGuardStop':
          addMpApprovalEvent(msg.approval);
          break;

        case 'mpFileConflictWarning':
          setMpFileConflict(msg.warning);
          break;

        case 'mpParticipantRenamed':
          updateMpParticipant(msg.participant.participantId, msg.participant);
          break;

        case 'mpRenameRejected':
          setMpRenameError(msg.reason);
          break;

        case 'mpError':
          setMpJoinError(msg.message);
          break;

        case 'mpReactionUpdate':
          updateMpReaction(msg.messageId, msg.reactions);
          break;

        case 'mpJoinRejected':
          setMpJoinError(msg.reason);
          break;
      }
    }

    window.addEventListener('message', handleMessage);

    // Tell the extension we are ready
    vscodeApi?.postMessage({ type: 'ready' });
    vscodeApi?.postMessage({ type: 'requestTabList' });

    return () => {
      window.removeEventListener('message', handleMessage);
      // cleanup (no active timers to clear)
    };
  }, [
    setSession,
    endSession,
    addUserMessage,
    addAssistantMessage,
    addInjectedAssistantContent,
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
    setMessageColorScheme,
    setProvider,
    setSelectedProvider,
    setProviderCapabilities,
    setSelectedModel,
    setLastResolvedDefaultModel,
    setSelectedClaudeEffort,
    setSelectedClaudeFastMode,
    setSelectedCodexReasoningEffort,
    setSelectedCodexServiceTier,
    setCodexModelOptions,
    setResuming,
    setPendingApproval,
    setProjectPromptHistory,
    setGlobalPromptHistory,
    setToolActivity,
    setActivitySummary,
    setActivitySummaryDismissed,
    setActivitySummaryEnabled,
    setPermissionMode,
    setCompactingSession,
    setCompactSessionNotice,
    setGitPushSettings,
    setGitPushResult,
    setGitPushRunning,
    setCustomSnippetText,
    setForkInit,
    setTranslation,
    setTranslating,
    setAchievementsSettings,
    setAchievementsSnapshot,
    addAchievementToast,
    setAchievementGoals,
    setSessionRecap,
    setUltrathinkMode,
    setVitalsEnabled,
    setTabLayout,
    setOpenTabs,
    setWeatherWidgetEnabled,
    rebuildTurnHistoryFromMessages,
    setAdventureEnabled,
    addTurnRecord,
    addAdventureBeat,
    applyTurnSemantics,
    setTurnAnalysisSettings,
    setSessionMetadata,
    setMcpPanelOpen,
    setMcpSelectedTab,
    setMcpInventory,
    setMcpPendingRestartCount,
    setMcpLoading,
    setMcpLastError,
    setMcpLastOperation,
    setMcpTemplates,
    setMcpDiffPreview,
    setWorktreePanelOpen,
    setWorktreeList,
    setWorktreeActionResult,
    setMergeBranches,
    setMergePreview,
    setMergeResult,
    setMergeDefaults,
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
    setRestoreSessionsEnabled,
    setUsageData,
    setUsageLimitState,
    setUsageQueuedPromptState,
    appendMemorySnapshot,
    setMemoryStreamError,
    setTokenRatioData,
    setTeamState,
    setTeamActive,
    clearTeamState,
    setThinkingEffort,
    setDetailedDiffEnabled,
    addWriteOldContent,
    applyReviewLoopEvent,
    setReviewLoopAutoStart,
    setReviewLoopMaxRoundsSetting,
    setReviewLoopSessionEnabled,
    initBtwSession,
    addBtwUserMessage,
    handleBtwMessageStart,
    handleBtwStreamingText,
    addBtwAssistantMessage,
    handleBtwMessageStop,
    handleBtwResult,
    clearBtwSession,
    handleMergeAssistantMessageStart,
    handleMergeAssistantStreamingText,
    addMergeAssistantToolUse,
    addMergeAssistantAssistantMessage,
    handleMergeAssistantResult,
    setMergeConflictFiles,
    setWorkstreamMapData,
    setWorkstreamMapClassifying,
    setWorkstreamMapError,
    setWorkstreamResumeState,
    setWorkstreamMapOpen,
    setSecretProtectionStatus,
    setSecretProtectionAuditEvents,
    setSecretProtectionAuditError,
    setSecretProtectionComplianceReport,
    // Multi-Participant
    setMpConnectionStatus,
    setMpSession,
    addMpMessage,
    setMpParticipants,
    updateMpParticipant,
    removeMpParticipant,
    setMpDeliveryStatus,
    appendMpStreamingText,
    addMpApprovalEvent,
    resolveMpApproval,
    setMpFileConflict,
    setMpTypingState,
    setMpJoinError,
    setMpRenameError,
    updateMpReaction,
    clearMpState,
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
