import React from 'react';
import type { TurnRecord } from '../../../../extension/types/webview-messages';
import { DASH_COLORS, MOOD_COLORS, MOOD_LABELS } from '../dashboardUtils';

// --- MoodTimeline ---
interface MoodTimelineProps {
  turnHistory: TurnRecord[];
}

export const MoodTimeline: React.FC<MoodTimelineProps> = ({ turnHistory }) => {
  if (turnHistory.length === 0) return null;

  return (
    <div style={{ marginTop: '12px' }}>
      <div style={{ fontSize: '12px', color: DASH_COLORS.textMuted, marginBottom: '8px' }}>
        Mood Timeline
      </div>
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
        {turnHistory.map((turn, idx) => {
          const sem = turn.semantics;
          if (!sem) {
            return (
              <span
                key={idx}
                data-tooltip={`Turn ${idx + 1} - no analysis`}
                style={{
                  display: 'inline-block',
                  width: '16px',
                  height: '16px',
                  borderRadius: '50%',
                  border: `1px solid ${DASH_COLORS.textMuted}`,
                  backgroundColor: 'transparent',
                }}
              />
            );
          }

          const color = MOOD_COLORS[sem.userMood] || DASH_COLORS.textMuted;
          const label = MOOD_LABELS[sem.userMood] || '-';

          return (
            <span
              key={idx}
              data-tooltip={`Turn ${idx + 1} | ${sem.taskType} | ${sem.taskOutcome} | confidence: ${(sem.confidence * 100).toFixed(0)}%`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                backgroundColor: color,
                color: '#fff',
                fontSize: '9px',
                fontWeight: 700,
                cursor: 'default',
              }}
            >
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
};

// --- FrustrationAlert ---
interface FrustrationAlertProps {
  turnHistory: TurnRecord[];
}

export const FrustrationAlert: React.FC<FrustrationAlertProps> = ({ turnHistory }) => {
  // Find any 3 consecutive frustrated turns
  const frustratedRuns: number[][] = [];
  let currentRun: number[] = [];

  turnHistory.forEach((turn, idx) => {
    if (turn.semantics?.userMood === 'frustrated') {
      currentRun.push(idx + 1);
    } else {
      if (currentRun.length >= 3) {
        frustratedRuns.push([...currentRun]);
      }
      currentRun = [];
    }
  });
  if (currentRun.length >= 3) {
    frustratedRuns.push(currentRun);
  }

  if (frustratedRuns.length === 0) return null;

  return (
    <div style={{
      border: `1px solid ${DASH_COLORS.red}`,
      backgroundColor: 'rgba(248, 81, 73, 0.1)',
      borderRadius: '8px',
      padding: '14px 16px',
      marginTop: '16px',
    }}>
      <div style={{ fontWeight: 600, color: DASH_COLORS.red, marginBottom: '6px' }}>
        [!] Frustration pattern detected
      </div>
      {frustratedRuns.map((run, i) => (
        <div key={i} style={{ color: DASH_COLORS.text, fontSize: '13px' }}>
          Turns {run.join(', ')} all indicate frustrated user mood.
        </div>
      ))}
      <div style={{ color: DASH_COLORS.textMuted, fontSize: '12px', marginTop: '4px' }}>
        Consider checking: same bug repeated? blocking issue?
      </div>
    </div>
  );
};

// --- BugRepeatTracker ---
interface BugRepeatTrackerProps {
  turnHistory: TurnRecord[];
}

export const BugRepeatTracker: React.FC<BugRepeatTrackerProps> = ({ turnHistory }) => {
  const bugEvents = turnHistory
    .map((t, idx) => ({ idx: idx + 1, repeat: t.semantics?.bugRepeat }))
    .filter((e) => e.repeat && e.repeat !== 'none');

  if (bugEvents.length === 0) return null;

  return (
    <div style={{
      background: DASH_COLORS.cardBg,
      border: `1px solid ${DASH_COLORS.border}`,
      borderRadius: '8px',
      padding: '14px 16px',
    }}>
      <div style={{ fontWeight: 600, color: DASH_COLORS.text, marginBottom: '10px', fontSize: '13px' }}>
        Bug Repeat Events
      </div>
      {bugEvents.map((event) => {
        const color = event.repeat === 'third-plus' ? DASH_COLORS.red
          : event.repeat === 'second' ? DASH_COLORS.amber
          : DASH_COLORS.textMuted;
        const label = event.repeat === 'first' ? 'First report'
          : event.repeat === 'second' ? 'Second mention'
          : 'Third+ mention - still unresolved';
        return (
          <div key={event.idx} style={{
            display: 'flex',
            gap: '8px',
            alignItems: 'center',
            padding: '4px 0',
            fontSize: '12px',
          }}>
            <span style={{ color: DASH_COLORS.textMuted }}>Turn {event.idx}</span>
            <span style={{ color }}>{label}</span>
          </div>
        );
      })}
    </div>
  );
};
