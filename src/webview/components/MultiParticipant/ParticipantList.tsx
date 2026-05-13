import React, { useMemo, useCallback } from 'react';
import { useAppStore } from '../../state/store';
import { getParticipantColor, KIND_BADGE_COLORS } from './mpColors';
import { postToExtension } from '../../hooks/useClaudeStream';

/**
 * Participant list sidebar for multi-participant sessions.
 *
 * Shows:
 * - Status dots (online/offline/busy)
 * - Kind badges (human/agent/orchestrator)
 * - Provider icons
 * - Route key labels
 * - Pulsing approval indicator (G4) when a pending approval targets an agent
 * - Stop Agent-to-Agent button (G2) when A2A is active
 */
export const ParticipantList: React.FC = () => {
  const participants = useAppStore((s) => s.mpParticipants);
  const myHumanId = useAppStore((s) => s.mpMyHumanId);
  const approvals = useAppStore((s) => s.mpApprovals);
  const typingStates = useAppStore((s) => s.mpTypingStates);

  // Detect if A2A is active (any agent-to-agent traffic in non-idle state)
  const isA2AActive = useMemo(() => {
    // A2A is active when there are pending approvals or agents are communicating
    const agentIds = new Set(
      participants.filter((p) => p.kind === 'agent').map((p) => p.participantId)
    );
    // Check if any agent is in a non-idle activity state (mpTypingStates is an array)
    for (const ts of typingStates) {
      if (agentIds.has(ts.participantId) && ts.state !== 'idle') return true;
    }
    // Check for pending approvals
    return approvals.some((e) => e.decision === null);
  }, [participants, typingStates, approvals]);

  // Participants with pending approval indicator (G4)
  const pendingApprovalTargets = useMemo(() => {
    const targets = new Set<string>();
    for (const event of approvals) {
      if (event.decision === null) {
        targets.add(event.targetAgentId);
      }
    }
    return targets;
  }, [approvals]);

  // Stop A2A handler (G2)
  const handleStopA2A = useCallback(() => {
    postToExtension({ type: 'mpStopA2A' });
  }, []);

  if (participants.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '8px 0',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px 6px',
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--vscode-descriptionForeground, #8b949e)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          Participants ({participants.length})
        </span>
      </div>

      {/* Participant entries */}
      {participants.map((participant) => {
        const color = getParticipantColor(participant.participantId);
        const kindColor = KIND_BADGE_COLORS[participant.kind] ?? '#8b949e';
        const isMe = participant.participantId === myHumanId;
        const hasPendingApproval = pendingApprovalTargets.has(participant.participantId);

        return (
          <div
            key={participant.participantId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 12px',
              position: 'relative',
            }}
          >
            {/* Status dot */}
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: STATUS_DOT_COLORS[participant.status] ?? '#8b949e',
                flexShrink: 0,
              }}
            />

            {/* Pending approval pulsing indicator (G4) */}
            {hasPendingApproval && (
              <span
                style={{
                  position: 'absolute',
                  left: 8,
                  top: 1,
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  border: '2px solid #f0883e',
                  animation: 'mp-approval-pulse 1.5s ease-in-out infinite',
                }}
              />
            )}

            {/* Display name */}
            <span
              style={{
                fontSize: 13,
                fontWeight: isMe ? 600 : 400,
                color: color,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}
            >
              {participant.displayName}
              {isMe && (
                <span style={{ color: '#8b949e', fontWeight: 400 }}> (you)</span>
              )}
            </span>

            {/* Kind badge */}
            <span
              style={{
                fontSize: 10,
                padding: '1px 4px',
                borderRadius: 3,
                backgroundColor: `${kindColor}22`,
                color: kindColor,
                textTransform: 'capitalize',
                flexShrink: 0,
              }}
            >
              {participant.kind}
            </span>

            {/* Model / Provider */}
            {(participant.model || participant.provider) && (
              <span
                style={{
                  fontSize: 10,
                  color: '#6e7681',
                  flexShrink: 0,
                }}
              >
                {formatModelLabel(participant.model, participant.provider)}
              </span>
            )}

            {/* Route key */}
            {participant.routeKey && (
              <span
                style={{
                  fontSize: 10,
                  color: '#6e7681',
                  fontFamily: 'var(--vscode-editor-font-family, monospace)',
                  backgroundColor: 'rgba(110, 118, 129, 0.1)',
                  padding: '1px 4px',
                  borderRadius: 3,
                  flexShrink: 0,
                }}
              >
                @{participant.routeKey}
              </span>
            )}
          </div>
        );
      })}

      {/* Stop A2A button (G2) */}
      {isA2AActive && (
        <div style={{ padding: '8px 12px 0' }}>
          <button
            onClick={handleStopA2A}
            style={{
              width: '100%',
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              color: '#fff',
              backgroundColor: '#da3633',
              border: '1px solid #f85149',
              borderRadius: 4,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
            title="Stop all agent-to-agent communication"
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>[X]</span>
            Stop Agent-to-Agent
          </button>
        </div>
      )}
    </div>
  );
};

// --- Constants ---

const STATUS_DOT_COLORS: Record<string, string> = {
  online: '#3fb950',
  busy: '#e3b341',
  offline: '#6e7681',
};

function formatModelLabel(model: string | null | undefined, provider: string | null | undefined): string {
  if (model) {
    const match = model.match(/(?:claude-)?(\w+)-(\d+)-(\d+)/i);
    if (match) {
      const family = match[1].charAt(0).toUpperCase() + match[1].slice(1);
      return `${family} ${match[2]}.${match[3]}`;
    }
    return model;
  }
  return provider || '';
}
