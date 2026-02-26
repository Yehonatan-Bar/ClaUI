import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import { detectRtl } from '../../hooks/useRtlDetection';

/**
 * Full-screen overlay panel for comprehensive bug reporting.
 * Two modes: Quick Report (text description) and AI-Assisted (chat).
 */
export const BugReportPanel: React.FC = () => {
  const {
    bugReportMode,
    bugReportPhase,
    bugReportDiagSummary,
    bugReportChatMessages,
    bugReportChatLoading,
    bugReportPreviewFiles,
    bugReportError,
    setBugReportPanelOpen,
    setBugReportMode,
    bugReportReset,
  } = useAppStore();

  const [description, setDescription] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  // Init: tell extension to start collecting diagnostics
  useEffect(() => {
    postToExtension({ type: 'bugReportInit' });
    return () => {
      postToExtension({ type: 'bugReportClose' });
    };
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [bugReportChatMessages, bugReportChatLoading]);

  const handleClose = () => {
    bugReportReset();
    setBugReportPanelOpen(false);
  };

  const handleSendChat = () => {
    const text = chatInput.trim();
    if (!text || bugReportChatLoading) return;
    useAppStore.setState((s) => ({
      bugReportChatMessages: [...s.bugReportChatMessages, { role: 'user' as const, content: text }],
      bugReportChatLoading: true,
    }));
    postToExtension({ type: 'bugReportChat', message: text });
    setChatInput('');
    chatInputRef.current?.focus();
  };

  const handleApproveScript = (command: string, index: number) => {
    postToExtension({ type: 'bugReportApproveScript', command, index });
  };

  const handleRejectScript = (_command: string, index: number) => {
    useAppStore.setState((s) => ({
      bugReportChatMessages: [
        ...s.bugReportChatMessages,
        { role: 'script' as const, content: `Script #${index + 1} rejected by user.` },
      ],
    }));
  };

  const handleRequestPreview = () => {
    postToExtension({ type: 'bugReportGetPreview' });
    setPreviewOpen(!previewOpen);
  };

  const handleSubmit = () => {
    if (bugReportMode === 'quick') {
      if (!description.trim()) return;
      postToExtension({ type: 'bugReportSubmit', mode: 'quick', description: description.trim() });
    } else {
      postToExtension({ type: 'bugReportSubmit', mode: 'ai' });
    }
  };

  const isSending = bugReportPhase === 'sending';
  const canSend =
    bugReportPhase === 'ready' &&
    ((bugReportMode === 'quick' && description.trim().length > 0) ||
      (bugReportMode === 'ai' && bugReportChatMessages.length > 0));

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="bugreport-overlay" onClick={handleClose}>
      <div className="bugreport-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="bugreport-header">
          <span className="bugreport-title">Bug Report</span>
          <button className="bugreport-close-btn" onClick={handleClose} title="Close">X</button>
        </div>
        <div className="bugreport-privacy-notice">
          Nothing will be sent until you click Send.
        </div>

        {/* Mode Tabs */}
        <div className="bugreport-tabs">
          <button
            className={`bugreport-tab ${bugReportMode === 'quick' ? 'active' : ''}`}
            onClick={() => setBugReportMode('quick')}
          >
            Quick Report
          </button>
          <button
            className={`bugreport-tab ${bugReportMode === 'ai' ? 'active' : ''}`}
            onClick={() => setBugReportMode('ai')}
          >
            AI-Assisted Report
          </button>
        </div>

        {/* Auto-collection status */}
        <div className="bugreport-status-bar">
          {bugReportPhase === 'idle' && <span>Initializing...</span>}
          {bugReportPhase === 'collecting' && <span className="bugreport-spinner">Collecting system info...</span>}
          {bugReportPhase === 'ready' && <span style={{ color: 'var(--vscode-terminal-ansiGreen)' }}>System info collected</span>}
          {bugReportPhase === 'sending' && <span className="bugreport-spinner">Sending report...</span>}
          {bugReportPhase === 'sent' && <span style={{ color: 'var(--vscode-terminal-ansiGreen)' }}>Report sent successfully!</span>}
          {bugReportPhase === 'error' && (
            <span style={{ color: 'var(--vscode-errorForeground)' }}>
              Error: {bugReportError || 'Unknown error'}
            </span>
          )}
          {bugReportDiagSummary && bugReportPhase === 'ready' && (
            <span className="bugreport-diag-badge">
              {bugReportDiagSummary.logFileCount} log file{bugReportDiagSummary.logFileCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Content Area */}
        <div className="bugreport-content">
          {bugReportMode === 'quick' ? (
            /* Quick Mode */
            <div className="bugreport-quick-mode">
              <label className="bugreport-label" htmlFor="bugreport-description">
                Describe the bug <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>
              </label>
              <textarea
                id="bugreport-description"
                className="bugreport-textarea"
                placeholder="What happened? What did you expect? Steps to reproduce..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                dir={detectRtl(description) ? 'rtl' : 'ltr'}
                rows={8}
                disabled={isSending || bugReportPhase === 'sent'}
              />
            </div>
          ) : (
            /* AI Mode */
            <div className="bugreport-ai-mode">
              <div className="bugreport-chat-area">
                {bugReportChatMessages.length === 0 && !bugReportChatLoading && (
                  <div className="bugreport-chat-empty">
                    Describe the bug you encountered. The AI will help diagnose the issue and guide you through a structured report.
                  </div>
                )}
                {bugReportChatMessages.map((msg, i) => {
                  const isRtl = detectRtl(msg.content);
                  return (
                    <div key={i} className={`bugreport-chat-msg bugreport-chat-${msg.role}`} dir={isRtl ? 'rtl' : 'ltr'}>
                      <div className="bugreport-chat-role">
                        {msg.role === 'user' ? 'You' : msg.role === 'assistant' ? 'AI' : 'Script'}
                      </div>
                      <div className="bugreport-chat-text">
                        {renderChatContent(msg.content, msg.scripts, i, handleApproveScript, handleRejectScript)}
                      </div>
                    </div>
                  );
                })}
                {bugReportChatLoading && (
                  <div className="bugreport-chat-msg bugreport-chat-assistant">
                    <div className="bugreport-chat-role">AI</div>
                    <div className="bugreport-chat-text bugreport-typing">Thinking...</div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <div className="bugreport-chat-input-row">
                <textarea
                  ref={chatInputRef}
                  className="bugreport-chat-input"
                  placeholder="Describe the bug or answer the AI's question..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  dir={detectRtl(chatInput) ? 'rtl' : 'ltr'}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendChat();
                    }
                  }}
                  rows={2}
                  disabled={bugReportChatLoading || isSending || bugReportPhase === 'sent'}
                />
                <button
                  className="bugreport-chat-send-btn"
                  onClick={handleSendChat}
                  disabled={!chatInput.trim() || bugReportChatLoading}
                >
                  Send
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Preview Section */}
        <div className="bugreport-preview-section">
          <button className="bugreport-preview-toggle" onClick={handleRequestPreview}>
            {previewOpen ? 'Hide' : 'What info will be sent to the developer?'}
          </button>
          {previewOpen && bugReportPreviewFiles.length > 0 && (
            <div className="bugreport-preview-list">
              {bugReportPreviewFiles.map((f, i) => (
                <div key={i} className="bugreport-preview-item">
                  <span className="bugreport-preview-name">{f.name}</span>
                  <span className="bugreport-preview-size">{formatBytes(f.sizeBytes)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="bugreport-submit-row">
          {bugReportPhase === 'sent' ? (
            <button className="bugreport-submit-btn bugreport-submit-done" onClick={handleClose}>
              Done - Close Panel
            </button>
          ) : (
            <button
              className="bugreport-submit-btn"
              disabled={!canSend || isSending}
              onClick={handleSubmit}
            >
              {isSending ? 'Sending...' : bugReportMode === 'ai' ? 'Done Talking - Send Full Report' : 'SEND BUG REPORT'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Renders chat message content, extracting code blocks and adding approve/reject buttons.
 */
function renderChatContent(
  text: string,
  scripts: Array<{ command: string; language: string }> | undefined,
  messageIndex: number,
  onApprove: (command: string, index: number) => void,
  onReject: (command: string, index: number) => void,
): React.ReactNode {
  if (!scripts || scripts.length === 0) {
    return <span style={{ whiteSpace: 'pre-wrap' }}>{text}</span>;
  }

  // Split text around code blocks and insert approve/reject buttons
  const parts: React.ReactNode[] = [];
  const regex = /```(?:bash|powershell|cmd|sh)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let scriptIdx = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={`t-${lastIndex}`} style={{ whiteSpace: 'pre-wrap' }}>{text.slice(lastIndex, match.index)}</span>);
    }
    const cmd = match[1].trim();
    const si = scriptIdx;
    parts.push(
      <div key={`s-${si}`} className="bugreport-script-block">
        <pre className="bugreport-script-code">{cmd}</pre>
        <div className="bugreport-script-actions">
          <button className="bugreport-script-approve" onClick={() => onApprove(cmd, si)}>Approve</button>
          <button className="bugreport-script-reject" onClick={() => onReject(cmd, si)}>Reject</button>
        </div>
      </div>,
    );
    scriptIdx++;
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(<span key={`t-${lastIndex}`} style={{ whiteSpace: 'pre-wrap' }}>{text.slice(lastIndex)}</span>);
  }

  return <>{parts}</>;
}
