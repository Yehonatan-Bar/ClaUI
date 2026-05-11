import React, { useState, useCallback, useMemo } from 'react';
import { useAppStore } from '../../state/store';
import type { MPApprovalEvent } from './mpTypes';
import { getParticipantColor } from './mpColors';
import { postToExtension } from '../../hooks/useClaudeStream';

/**
 * Guard-stop notification for multi-participant sessions.
 *
 * Displayed when the guard stops the session. Shows:
 *  - Stop reason
 *  - Last message summaries from participants
 *  - Same 4 approval options as the ApprovalDialog (Deny, Allow N, Always Allow, Force)
 *
 * Reads from store's mpGuardStop field.
 */
export const GuardStopNotification: React.FC = () => {
  const guardStop = useAppStore((s) => s.mpGuardStop);
  const resolveMpGuardStop = useAppStore((s) => s.resolveMpGuardStop);
  const participants = useAppStore((s) => s.mpParticipants);
  const approvals = useAppStore((s) => s.mpApprovals);

  const [countValue, setCountValue] = useState(5);
  const [showCountInput, setShowCountInput] = useState(false);
  const [confirmForce, setConfirmForce] = useState(false);

  // Find the most recent pending approval (if any) to respond to
  const pendingApproval = useMemo(
    () => approvals.find((e: MPApprovalEvent) => e.decision === null),
    [approvals]
  );

  const getParticipantName = useCallback(
    (participantId: string) =>
      participants.find((p) => p.participantId === participantId)?.displayName ??
      participantId,
    [participants]
  );

  const sendDecision = useCallback(
    (decision: 'deny' | 'approve-count' | 'approve-always' | 'approve-force', count?: number) => {
      if (pendingApproval) {
        postToExtension({
          type: 'mpApprovalDecision',
          eventId: pendingApproval.eventId,
          decision: {
            type: decision,
            ...(count !== undefined ? { budgetCount: count } : {}),
          },
        });
      }
      resolveMpGuardStop();
    },
    [pendingApproval, resolveMpGuardStop]
  );

  const handleDeny = useCallback(() => {
    sendDecision('deny');
  }, [sendDecision]);

  const handleApproveCount = useCallback(() => {
    if (!showCountInput) {
      setShowCountInput(true);
      return;
    }
    sendDecision('approve-count', countValue);
    setShowCountInput(false);
  }, [sendDecision, countValue, showCountInput]);

  const handleAlwaysAllow = useCallback(() => {
    sendDecision('approve-always');
  }, [sendDecision]);

  const handleForce = useCallback(() => {
    if (!confirmForce) {
      setConfirmForce(true);
      return;
    }
    sendDecision('approve-force');
    setConfirmForce(false);
  }, [sendDecision, confirmForce]);

  const handleDismiss = useCallback(() => {
    resolveMpGuardStop();
  }, [resolveMpGuardStop]);

  if (!guardStop || guardStop.resolved) return null;

  return (
    <div
      style={{
        backgroundColor: 'rgba(248, 81, 73, 0.08)',
        border: '1px solid rgba(248, 81, 73, 0.3)',
        borderRadius: 6,
        padding: 16,
        margin: '8px 12px',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: '#f85149',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span style={{ fontSize: 16 }}>[!]</span>
          Guard Stop
        </div>
        <button
          onClick={handleDismiss}
          style={{
            background: 'none',
            border: 'none',
            color: '#8b949e',
            cursor: 'pointer',
            fontSize: 16,
            padding: '2px 6px',
          }}
          title="Dismiss"
        >
          x
        </button>
      </div>

      {/* Reason */}
      <div
        style={{
          fontSize: 13,
          color: 'var(--vscode-editor-foreground, #e6edf3)',
          marginBottom: 12,
          lineHeight: 1.5,
        }}
      >
        {guardStop.reason}
      </div>

      {/* Last messages */}
      {guardStop.lastMessages.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              fontSize: 11,
              color: '#8b949e',
              marginBottom: 6,
              fontWeight: 500,
            }}
          >
            Last messages:
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {guardStop.lastMessages.map((msg: { participantId: string; preview: string }, idx: number) => {
              const participantColor = getParticipantColor(msg.participantId);
              return (
                <div
                  key={idx}
                  style={{
                    fontSize: 12,
                    color: 'var(--vscode-editor-foreground, #e6edf3)',
                    padding: '4px 8px',
                    backgroundColor: 'rgba(48, 54, 61, 0.3)',
                    borderRadius: 4,
                    borderLeft: `2px solid ${participantColor}`,
                  }}
                >
                  <span
                    style={{
                      fontWeight: 600,
                      color: participantColor,
                      marginRight: 6,
                    }}
                  >
                    {getParticipantName(msg.participantId)}:
                  </span>
                  {msg.preview}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Count input */}
      {showCountInput && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 10,
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
            marginBottom: 10,
            padding: '6px 8px',
            backgroundColor: 'rgba(248, 81, 73, 0.1)',
            borderRadius: 4,
          }}
        >
          Force bypasses all safety checks. Click Force again to confirm.
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={handleDeny}
          style={{
            ...btnStyle,
            backgroundColor: 'rgba(248, 81, 73, 0.15)',
            color: '#f85149',
            border: '1px solid rgba(248, 81, 73, 0.3)',
          }}
        >
          Deny
        </button>

        <button
          onClick={handleApproveCount}
          style={{
            ...btnStyle,
            backgroundColor: 'rgba(88, 166, 255, 0.15)',
            color: '#58a6ff',
            border: '1px solid rgba(88, 166, 255, 0.3)',
          }}
        >
          {showCountInput ? `Allow ${countValue}` : 'Allow N'}
        </button>

        <button
          onClick={handleAlwaysAllow}
          style={{
            ...btnStyle,
            backgroundColor: 'rgba(63, 185, 80, 0.15)',
            color: '#3fb950',
            border: '1px solid rgba(63, 185, 80, 0.3)',
          }}
        >
          Always Allow
        </button>

        <button
          onClick={handleForce}
          style={{
            ...btnStyle,
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
  );
};

const btnStyle: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 12,
  fontWeight: 500,
  borderRadius: 4,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
