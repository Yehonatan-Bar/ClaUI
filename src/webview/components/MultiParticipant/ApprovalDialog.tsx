import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useAppStore } from '../../state/store';
import type { MPApprovalEvent } from './mpTypes';
import { getParticipantColor } from './mpColors';
import { postToExtension } from '../../hooks/useClaudeStream';

/**
 * Approval dialog for agent-to-agent messaging in multi-participant sessions.
 *
 * Triggered by pending mpApprovals (where decision is null).
 * Shows:
 *  - "Agent [source] wants to message Agent [target]"
 *  - 4 decision buttons: Deny, Allow N, Always Allow, Force
 *
 * Auto-closes when approval resolves (store updates).
 */
export const ApprovalDialog: React.FC = () => {
  const approvals = useAppStore((s) => s.mpApprovals);
  const participants = useAppStore((s) => s.mpParticipants);

  // Find the first pending (undecided) approval event
  const pendingEvent = useMemo(
    () => approvals.find((e: MPApprovalEvent) => e.decision === null),
    [approvals]
  );

  if (!pendingEvent) return null;

  return (
    <ApprovalDialogInner
      key={pendingEvent.eventId}
      event={pendingEvent}
      participants={participants}
    />
  );
};

// --- Inner dialog component (separate to reset state per event) ---

interface ApprovalDialogInnerProps {
  event: MPApprovalEvent;
  participants: Array<{
    participantId: string;
    displayName: string;
  }>;
}

const ApprovalDialogInner: React.FC<ApprovalDialogInnerProps> = ({
  event,
  participants,
}) => {
  const [countValue, setCountValue] = useState(5);
  const [showCountInput, setShowCountInput] = useState(false);
  const [confirmForce, setConfirmForce] = useState(false);

  const sourceName = useMemo(
    () =>
      participants.find((p) => p.participantId === event.sourceAgentId)
        ?.displayName ?? 'Unknown Agent',
    [participants, event.sourceAgentId]
  );

  const targetName = useMemo(
    () =>
      participants.find((p) => p.participantId === event.targetAgentId)
        ?.displayName ?? 'Unknown Agent',
    [participants, event.targetAgentId]
  );

  const sourceColor = getParticipantColor(event.sourceAgentId);
  const targetColor = getParticipantColor(event.targetAgentId);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowCountInput(false);
        setConfirmForce(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleDeny = useCallback(() => {
    postToExtension({
      type: 'mpApprovalDecision',
      eventId: event.eventId,
      decision: { type: 'deny' },
    });
  }, [event.eventId]);

  const handleApproveCount = useCallback(() => {
    if (!showCountInput) {
      setShowCountInput(true);
      return;
    }
    postToExtension({
      type: 'mpApprovalDecision',
      eventId: event.eventId,
      decision: { type: 'approve-count', budgetCount: countValue },
    });
    setShowCountInput(false);
  }, [event.eventId, countValue, showCountInput]);

  const handleAlwaysAllow = useCallback(() => {
    postToExtension({
      type: 'mpApprovalDecision',
      eventId: event.eventId,
      decision: { type: 'approve-always' },
    });
  }, [event.eventId]);

  const handleForce = useCallback(() => {
    if (!confirmForce) {
      setConfirmForce(true);
      return;
    }
    postToExtension({
      type: 'mpApprovalDecision',
      eventId: event.eventId,
      decision: { type: 'approve-force' },
    });
    setConfirmForce(false);
  }, [event.eventId, confirmForce]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 900,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 440,
          backgroundColor: 'var(--vscode-editor-background, #1e1e1e)',
          border: '1px solid var(--vscode-panel-border, #30363d)',
          borderRadius: 8,
          padding: 20,
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
        }}
      >
        {/* Title */}
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--vscode-editor-foreground, #e6edf3)',
            marginBottom: 12,
          }}
        >
          Agent-to-Agent Approval Required
        </div>

        {/* Description */}
        <div
          style={{
            fontSize: 13,
            color: 'var(--vscode-descriptionForeground, #8b949e)',
            marginBottom: 12,
            lineHeight: 1.5,
          }}
        >
          <span style={{ color: sourceColor, fontWeight: 600 }}>
            {sourceName}
          </span>
          {' wants to message '}
          <span style={{ color: targetColor, fontWeight: 600 }}>
            {targetName}
          </span>
        </div>

        {/* Count input (shown when "Allow N" is clicked) */}
        {showCountInput && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 12,
            }}
          >
            <label
              style={{
                fontSize: 12,
                color: 'var(--vscode-descriptionForeground, #8b949e)',
              }}
            >
              Allow how many messages?
            </label>
            <input
              type="number"
              min={1}
              max={100}
              value={countValue}
              onChange={(e) =>
                setCountValue(Math.max(1, parseInt(e.target.value) || 1))
              }
              style={{
                width: 60,
                padding: '3px 6px',
                fontSize: 12,
                backgroundColor: 'var(--vscode-input-background, #0d1117)',
                color: 'var(--vscode-input-foreground, #e6edf3)',
                border: '1px solid var(--vscode-input-border, #30363d)',
                borderRadius: 4,
                outline: 'none',
              }}
              autoFocus
            />
          </div>
        )}

        {/* Force confirmation */}
        {confirmForce && (
          <div
            style={{
              fontSize: 12,
              color: '#f85149',
              marginBottom: 12,
              padding: '6px 8px',
              backgroundColor: 'rgba(248, 81, 73, 0.1)',
              borderRadius: 4,
              border: '1px solid rgba(248, 81, 73, 0.3)',
            }}
          >
            Force bypasses all safety checks. Click Force again to confirm.
          </div>
        )}

        {/* Action buttons */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <button
            onClick={handleDeny}
            data-tooltip="Deny this request"
            style={{
              ...buttonBaseStyle,
              backgroundColor: 'rgba(248, 81, 73, 0.15)',
              color: '#f85149',
              border: '1px solid rgba(248, 81, 73, 0.3)',
            }}
          >
            Deny
          </button>

          <button
            onClick={handleApproveCount}
            data-tooltip="Allow a set number of messages"
            style={{
              ...buttonBaseStyle,
              backgroundColor: 'rgba(88, 166, 255, 0.15)',
              color: '#58a6ff',
              border: '1px solid rgba(88, 166, 255, 0.3)',
            }}
          >
            {showCountInput ? `Allow ${countValue}` : 'Allow N'}
          </button>

          <button
            onClick={handleAlwaysAllow}
            data-tooltip="Always allow this agent pair"
            style={{
              ...buttonBaseStyle,
              backgroundColor: 'rgba(63, 185, 80, 0.15)',
              color: '#3fb950',
              border: '1px solid rgba(63, 185, 80, 0.3)',
            }}
          >
            Always Allow
          </button>

          <button
            onClick={handleForce}
            data-tooltip="Force approve, bypassing safety checks"
            style={{
              ...buttonBaseStyle,
              backgroundColor: confirmForce
                ? 'rgba(240, 136, 62, 0.3)'
                : 'rgba(240, 136, 62, 0.1)',
              color: '#f0883e',
              border: `1px solid rgba(240, 136, 62, ${confirmForce ? '0.6' : '0.3'})`,
            }}
          >
            Force{confirmForce ? ' (confirm)' : ''}
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Styles ---

const buttonBaseStyle: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 12,
  fontWeight: 500,
  borderRadius: 4,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
