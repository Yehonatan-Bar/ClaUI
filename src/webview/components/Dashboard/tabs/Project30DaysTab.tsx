import React from 'react';
import type { SessionSummary } from '../../../../extension/types/webview-messages';
import { DASH_COLORS } from '../dashboardUtils';
import { ProjectOverviewTab } from './ProjectOverviewTab';

interface Project30DaysTabProps {
  sessions: SessionSummary[];
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function parseTimeMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export const Project30DaysTab: React.FC<Project30DaysTabProps> = ({ sessions }) => {
  const nowMs = Date.now();
  const cutoffMs = nowMs - THIRTY_DAYS_MS;
  const cutoffDate = new Date(cutoffMs);

  const recentSessions = React.useMemo(
    () =>
      sessions.filter((session) => {
        const startedAtMs = parseTimeMs(session.startedAt);
        return startedAtMs !== null && startedAtMs >= cutoffMs;
      }),
    [sessions, cutoffMs]
  );

  if (recentSessions.length === 0) {
    return (
      <div
        style={{
          color: DASH_COLORS.textMuted,
          textAlign: 'center',
          padding: '48px',
          fontSize: '14px',
        }}
      >
        No sessions in the last 30 days
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        style={{
          background: 'rgba(88, 166, 255, 0.08)',
          border: '1px solid rgba(88, 166, 255, 0.25)',
          borderRadius: 8,
          padding: '10px 14px',
          color: DASH_COLORS.textMuted,
          fontSize: 12,
        }}
      >
        Showing {recentSessions.length} session{recentSessions.length !== 1 ? 's' : ''} since{' '}
        {cutoffDate.toLocaleDateString()}
      </div>
      <ProjectOverviewTab sessions={recentSessions} />
    </div>
  );
};
