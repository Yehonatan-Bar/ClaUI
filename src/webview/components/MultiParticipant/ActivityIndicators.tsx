import React, { useMemo } from 'react';
import { useAppStore } from '../../state/store';
import type { MPParticipantActivityState } from './mpTypes';
import { getParticipantColor } from './mpColors';

/**
 * Activity indicators displayed below the message list, above the input area.
 *
 * Shows per-participant activity in the multi-participant session:
 *  - "Alice is typing..." (animated dots)
 *  - "Claude is thinking..." (spinner)
 *  - "Codex is streaming..." (pulsing)
 *
 * Reads from store's mpTypingStates (an array of MPTypingState), filters out 'idle' entries.
 */
export const ActivityIndicators: React.FC = () => {
  const typingStates = useAppStore((s) => s.mpTypingStates);
  const participants = useAppStore((s) => s.mpParticipants);

  // Build active entries (non-idle)
  const activeEntries = useMemo(() => {
    const entries: Array<{
      participantId: string;
      displayName: string;
      activity: MPParticipantActivityState;
    }> = [];

    for (const ts of typingStates) {
      if (ts.state === 'idle') continue;
      const participant = participants.find((p) => p.participantId === ts.participantId);
      if (!participant) continue;
      entries.push({
        participantId: ts.participantId,
        displayName: participant.displayName,
        activity: ts.state,
      });
    }

    return entries;
  }, [typingStates, participants]);

  if (activeEntries.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '6px 12px',
        borderTop: '1px solid var(--vscode-panel-border, #30363d)',
        backgroundColor: 'var(--vscode-editor-background, #1e1e1e)',
      }}
    >
      {activeEntries.map((entry) => (
        <ActivityRow
          key={entry.participantId}
          displayName={entry.displayName}
          participantId={entry.participantId}
          activity={entry.activity}
        />
      ))}
    </div>
  );
};

// --- Activity row for a single participant ---

interface ActivityRowProps {
  displayName: string;
  participantId: string;
  activity: MPParticipantActivityState;
}

const ActivityRow: React.FC<ActivityRowProps> = ({
  displayName,
  participantId,
  activity,
}) => {
  const color = getParticipantColor(participantId);
  const label = ACTIVITY_LABELS[activity] ?? 'active';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        color: 'var(--vscode-descriptionForeground, #8b949e)',
      }}
    >
      {/* Activity-specific animation */}
      <ActivityIcon activity={activity} color={color} />

      <span style={{ color, fontWeight: 500 }}>{displayName}</span>
      <span>{label}</span>
    </div>
  );
};

// --- Activity icon (animation per activity type) ---

interface ActivityIconProps {
  activity: MPParticipantActivityState;
  color: string;
}

const ActivityIcon: React.FC<ActivityIconProps> = ({ activity, color }) => {
  if (activity === 'typing') {
    // Animated dots
    return (
      <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
        <span style={{ ...dotStyle, color, animationDelay: '0s' }}>.</span>
        <span style={{ ...dotStyle, color, animationDelay: '0.2s' }}>.</span>
        <span style={{ ...dotStyle, color, animationDelay: '0.4s' }}>.</span>
      </span>
    );
  }

  if (activity === 'thinking') {
    // Spinner
    return (
      <span
        style={{
          display: 'inline-block',
          width: 12,
          height: 12,
          border: `2px solid ${color}33`,
          borderTopColor: color,
          borderRadius: '50%',
          animation: 'mp-spin 0.8s linear infinite',
        }}
      />
    );
  }

  if (activity === 'streaming') {
    // Pulsing dot
    return (
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: color,
          animation: 'mp-pulse 1.2s ease-in-out infinite',
        }}
      />
    );
  }

  return null;
};

// --- Constants ---

const ACTIVITY_LABELS: Record<string, string> = {
  typing: 'is typing...',
  thinking: 'is thinking...',
  streaming: 'is streaming...',
};

const dotStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  lineHeight: '8px',
  animation: 'mp-dot-bounce 1s ease-in-out infinite',
};
