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
          handleMessageStart(msg.messageId, msg.model);
          logState('after messageStart');
          break;

        case 'streamingText':
          appendStreamingText(msg.messageId, msg.blockIndex, msg.text);
          break;

        case 'assistantMessage':
          console.log(`%c[STREAM] assistantMessage content`, 'color: cyan',
            'isArray:', Array.isArray(msg.content),
            'type:', typeof msg.content,
            'blocks:', Array.isArray(msg.content) ? msg.content.map((b: ContentBlock) => b.type) : msg.content
          );
          updateAssistantSnapshot(msg.messageId, msg.content, msg.model);
          break;

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
  ]);
}

/** Post a message from the webview to the extension host */
export function postToExtension(
  message: import('../../extension/types/webview-messages').WebviewToExtensionMessage
): void {
  vscodeApi?.postMessage(message);
}
