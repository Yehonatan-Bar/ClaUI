import React, { useMemo } from 'react';
import type { ProjectMapState, Workstream } from '../../../extension/types/workstreamTypes';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';

interface ConfidenceReviewPanelProps {
  state: ProjectMapState;
  onClose?: () => void;
}

export const ConfidenceReviewPanel: React.FC<ConfidenceReviewPanelProps> = ({ state, onClose }) => {
  const setFocusedWorkstreamId = useAppStore(s => s.setFocusedWorkstreamId);

  const lowConfidenceWorkstreams = useMemo(() =>
    state.workstreams
      .filter(ws => ws.confidence < 0.75)
      .sort((a, b) => a.confidence - b.confidence),
    [state.workstreams]
  );

  if (lowConfidenceWorkstreams.length === 0) {
    return null;
  }

  const handleReview = (workstream: Workstream) => {
    setFocusedWorkstreamId(workstream.id);
  };

  const handleReclassify = () => {
    postToExtension({ type: 'workstreamMapReclassify', force: true });
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        maxWidth: 400,
        background: 'var(--vscode-editor-background, #1E1E1E)',
        border: '1px solid var(--vscode-editorWarning-foreground, #CED1CF)',
        borderRadius: 8,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
        zIndex: 999,
        overflow: 'hidden',
        fontFamily: 'var(--vscode-font-family)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          background: 'var(--vscode-editorWarning-background, rgba(206, 209, 207, 0.1))',
          borderBottom: '1px solid var(--vscode-editorWarning-foreground, #CED1CF)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ fontWeight: 600, color: 'var(--vscode-editorWarning-foreground, #CED1CF)' }}>
          Low Confidence Items ({lowConfidenceWorkstreams.length})
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--vscode-foreground, #D4D4D4)',
            cursor: 'pointer',
            fontSize: 16,
            padding: 0,
            opacity: 0.6,
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}
        >
          ×
        </button>
      </div>

      {/* Content */}
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        {lowConfidenceWorkstreams.map(ws => (
          <div
            key={ws.id}
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--vscode-editor-lineHighlightBorder, rgba(255,255,255,0.05))',
              cursor: 'pointer',
            }}
            onClick={() => handleReview(ws)}
            onMouseEnter={e =>
              (e.currentTarget.style.background =
                'var(--vscode-list-hoverBackground, rgba(255,255,255,0.05))')
            }
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginBottom: 4,
              }}
            >
              <div
                style={{
                  fontWeight: 500,
                  color: 'var(--vscode-foreground, #D4D4D4)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                }}
              >
                {ws.label}
              </div>
              <div
                style={{
                  fontSize: 11,
                  background: 'var(--vscode-editorWarning-background, rgba(206, 209, 207, 0.2))',
                  color: 'var(--vscode-editorWarning-foreground, #CED1CF)',
                  padding: '2px 6px',
                  borderRadius: 3,
                  marginLeft: 8,
                  whiteSpace: 'nowrap',
                }}
              >
                {(ws.confidence * 100).toFixed(0)}%
              </div>
            </div>

            {ws.confidenceReasons.length > 0 && (
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--vscode-descriptionForeground, #94A3B8)',
                  marginTop: 4,
                }}
              >
                {ws.confidenceReasons[0]}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer with actions */}
      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--vscode-editor-lineHighlightBorder, rgba(255,255,255,0.05))',
          display: 'flex',
          gap: 8,
        }}
      >
        <button
          onClick={handleReclassify}
          style={{
            flex: 1,
            background: 'var(--vscode-button-background, #0E639C)',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            padding: '6px 12px',
            cursor: 'pointer',
            fontSize: 12,
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        >
          Re-Classify
        </button>
      </div>
    </div>
  );
};
