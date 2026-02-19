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
    updateCost,
    setError,
    setPendingFilePaths,
    setTextSettings,
    setSelectedModel,
    setResuming,
    setPendingApproval,
    setProjectPromptHistory,
    setGlobalPromptHistory,
    setActivitySummary,
    setPermissionMode,
    setGitPushSettings,
    setGitPushResult,
    setGitPushRunning,
    setForkInit,
    setTranslation,
    setTranslating,
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

      switch (msg.type) {
        case 'sessionStarted':
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

        case 'messageStart':
          logState('before messageStart');
          // NOTE: Do NOT clear pendingApproval here. After ExitPlanMode, the CLI
          // may emit additional empty message turns (message_start -> message_delta
          // -> message_stop -> result) before the user has a chance to interact
          // with the approval bar. Clearing here would hide Approve/Reject buttons.
          // The approval bar is already properly cleared by:
          //   - processBusy: true (sent when user sends a message or approval response)
          //   - PlanApprovalBar button handlers (setPendingApproval(null))
          //   - InputArea handler (when user types during pending approval)
          handleMessageStart(msg.messageId, msg.model);
          logState('after messageStart');
          break;

        case 'streamingText':
          appendStreamingText(msg.messageId, msg.blockIndex, msg.text);
          break;

        case 'assistantMessage': {
          console.log(`%c[STREAM] assistantMessage content`, 'color: cyan',
            'isArray:', Array.isArray(msg.content),
            'type:', typeof msg.content,
            'blocks:', Array.isArray(msg.content) ? msg.content.map((b: ContentBlock) => b.type) : msg.content
          );
          const currentState = useAppStore.getState();
          if (!currentState.streamingMessageId) {
            // No active streaming message - this is a replayed/complete message
            // (e.g. during session resume). Add directly to the messages array.
            addAssistantMessage(msg.messageId, msg.content, msg.model);
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
          break;

        case 'toolUseInput':
          appendToolInput(msg.messageId, msg.blockIndex, msg.partialJson);
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
            useAppStore.setState({
              messages: msg.messages.map((m: import('../../extension/types/webview-messages').SerializedChatMessage) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                model: m.model,
                timestamp: m.timestamp,
              })),
            });
          }
          setForkInit({ promptText: msg.promptText });
          break;

        case 'conversationHistory':
          // Populate the store with conversation history read from Claude's session storage.
          // This is used when resuming a session - the CLI in pipe mode doesn't replay
          // messages until user sends input, so we read them from disk instead.
          if (msg.messages && msg.messages.length > 0) {
            console.log(`%c[STREAM] conversationHistory: ${msg.messages.length} messages`, 'color: lime; font-weight: bold');
            useAppStore.setState({
              messages: msg.messages.map((m: import('../../extension/types/webview-messages').SerializedChatMessage) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                model: m.model,
                timestamp: m.timestamp,
              })),
              isResuming: false,
            });
          }
          break;

        case 'translationResult':
          setTranslating(msg.messageId, false);
          if (msg.success && msg.translatedText) {
            setTranslation(msg.messageId, msg.translatedText);
          }
          break;

        case 'fileSearchResults':
          window.dispatchEvent(
            new CustomEvent('file-search-results', { detail: msg })
          );
          break;
      }
    }

    window.addEventListener('message', handleMessage);

    // Tell the extension we are ready
    vscodeApi?.postMessage({ type: 'ready' });

    return () => {
      window.removeEventListener('message', handleMessage);
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
    updateCost,
    setError,
    setPendingFilePaths,
    setTextSettings,
    setSelectedModel,
    setResuming,
    setPendingApproval,
    setProjectPromptHistory,
    setGlobalPromptHistory,
    setActivitySummary,
    setPermissionMode,
    setGitPushSettings,
    setGitPushResult,
    setGitPushRunning,
    setForkInit,
    setTranslation,
    setTranslating,
  ]);
}

/** Post a message from the webview to the extension host */
export function postToExtension(
  message: import('../../extension/types/webview-messages').WebviewToExtensionMessage
): void {
  vscodeApi?.postMessage(message);
}
