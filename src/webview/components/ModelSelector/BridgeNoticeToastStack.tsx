import React, { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';

/** A notice stays up this long unless dismissed or acted on. */
const AUTO_DISMISS_MS = 12000;

/**
 * Toasts for Bridge Provider events, currently "a free model just appeared in
 * the Model picker". Rendered once per webview, top-right, above the chat.
 * "Use" switches this tab to the announced model through the normal setModel
 * path (same as picking it in the dropdown).
 */
export const BridgeNoticeToastStack: React.FC = () => {
  const { bridgeNotices, dismissBridgeNotice, setSelectedModel } = useAppStore();
  const scheduled = useRef(new Set<string>());

  useEffect(() => {
    for (const notice of bridgeNotices) {
      if (scheduled.current.has(notice.noticeId)) continue;
      scheduled.current.add(notice.noticeId);
      setTimeout(() => {
        dismissBridgeNotice(notice.noticeId);
        scheduled.current.delete(notice.noticeId);
      }, AUTO_DISMISS_MS);
    }
  }, [bridgeNotices, dismissBridgeNotice]);

  const useModel = useCallback((noticeId: string, modelValue: string) => {
    setSelectedModel(modelValue);
    postToExtension({ type: 'setModel', model: modelValue });
    dismissBridgeNotice(noticeId);
  }, [setSelectedModel, dismissBridgeNotice]);

  if (bridgeNotices.length === 0) {
    return null;
  }

  return (
    <div className="bridge-notice-stack" role="status" aria-live="polite">
      {bridgeNotices.map((notice) => (
        <div key={notice.noticeId} className="bridge-notice-toast">
          <div className="bridge-notice-main">
            <strong>{notice.title}</strong>
            <span title={notice.detail}>{notice.detail}</span>
          </div>
          {notice.modelValue ? (
            <button
              className="bridge-notice-use"
              onClick={() => useModel(notice.noticeId, notice.modelValue as string)}
              data-tooltip="Switch this tab to the new free model"
            >
              Use
            </button>
          ) : (
            <span />
          )}
          <button
            className="bridge-notice-dismiss"
            onClick={() => dismissBridgeNotice(notice.noticeId)}
            data-tooltip="Dismiss"
            aria-label="Dismiss"
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
};
