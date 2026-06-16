import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';

const PHASE_LABEL: Record<string, string> = {
  'idle': 'Idle',
  'awaiting-handover': 'Writing handover...',
  'reviewing': 'Codex reviewing the code...',
  'classifying': 'Classifying verdict...',
  'awaiting-fix': 'Developer addressing feedback...',
  'approved': 'Approved',
  'stopped': 'Stopped',
  'max-rounds': 'Round limit reached',
  'error': 'Error',
};

export const ReviewLoopPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const {
    reviewLoopRunning,
    reviewLoopPhase,
    reviewLoopRound,
    reviewLoopMaxRounds,
    reviewLoopTranscript,
  } = useAppStore();
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [reviewLoopTranscript.length]);

  const handleStop = () => postToExtension({ type: 'reviewLoopStop' });

  return (
    <div className="review-loop-panel">
      <div className="review-loop-header">
        <span className="review-loop-title">Review Loop (Claude + Codex)</span>
        <div className="review-loop-header-actions">
          {reviewLoopRunning && (
            <button className="review-loop-stop-btn" onClick={handleStop} data-tooltip="Stop the review loop">
              Stop
            </button>
          )}
          <button className="review-loop-close" onClick={onClose} data-tooltip="Close">
            x
          </button>
        </div>
      </div>

      <div className="review-loop-status">
        <span className={`review-loop-phase phase-${reviewLoopPhase}`}>
          {reviewLoopRunning && <span className="review-loop-spinner" />}
          {PHASE_LABEL[reviewLoopPhase] ?? reviewLoopPhase}
        </span>
        {reviewLoopMaxRounds > 0 && (
          <span className="review-loop-round">
            Round {reviewLoopRound} / {reviewLoopMaxRounds}
          </span>
        )}
      </div>

      <div className="review-loop-body" ref={bodyRef}>
        {reviewLoopTranscript.length === 0 && (
          <div className="review-loop-empty">Starting the review loop...</div>
        )}
        {reviewLoopTranscript.map((event, idx) => {
          if (event.kind === 'status') {
            if (!event.detail) {
              return null;
            }
            return (
              <div key={idx} className={`review-loop-entry status phase-${event.phase}`}>
                {event.detail}
              </div>
            );
          }
          if (event.kind === 'handover') {
            return (
              <div key={idx} className="review-loop-entry handover">
                <div className="review-loop-entry-label">Message to reviewer - round {event.round}</div>
                <pre className="review-loop-text">{event.text}</pre>
              </div>
            );
          }
          if (event.kind === 'review') {
            return (
              <div key={idx} className="review-loop-entry review">
                <div className="review-loop-entry-label">Reviewer - round {event.round}</div>
                <pre className="review-loop-text">{event.text}</pre>
              </div>
            );
          }
          if (event.kind === 'verdict') {
            return (
              <div
                key={idx}
                className={`review-loop-entry verdict ${event.approved ? 'approved' : 'changes'}`}
              >
                <div className="review-loop-entry-label">
                  Verdict - round {event.round}: {event.approved ? 'Approved' : 'Changes requested'}
                </div>
                <div className="review-loop-verdict-reason">{event.reason}</div>
              </div>
            );
          }
          if (event.kind === 'error') {
            return (
              <div key={idx} className="review-loop-entry error">
                {event.text}
              </div>
            );
          }
          return (
            <div key={idx} className="review-loop-entry info">
              {event.text}
            </div>
          );
        })}
      </div>
    </div>
  );
};
