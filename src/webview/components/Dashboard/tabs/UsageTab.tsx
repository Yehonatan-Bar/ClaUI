import React from 'react';
import { useAppStore } from '../../../state/store';
import { postToExtension } from '../../../hooks/useClaudeStream';
import { DASH_COLORS } from '../dashboardUtils';
import type { UsageStat } from '../../../../extension/types/webview-messages';

/** Preferred display order for time periods */
const PERIOD_ORDER = ['5 Hours', '24 Hours', '7 Days', '14 Days', '30 Days', '2 Months'];

function getColor(pct: number): string {
  if (pct > 75) return DASH_COLORS.red;
  if (pct > 50) return DASH_COLORS.amber;
  return DASH_COLORS.green;
}

function formatTimeAgo(fetchedAt: number | null): string {
  if (!fetchedAt) return '';
  const diffMs = Date.now() - fetchedAt;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
  const h = Math.floor(diffMin / 60);
  return `${h} hour${h !== 1 ? 's' : ''} ago`;
}

interface UsageCardProps {
  stat: UsageStat;
}

const UsageCard: React.FC<UsageCardProps> = ({ stat }) => {
  const color = getColor(stat.percentage);
  return (
    <div style={{
      background: DASH_COLORS.cardBg,
      border: `1px solid ${DASH_COLORS.border}`,
      borderLeft: `4px solid ${color}`,
      borderRadius: 8,
      padding: '18px 20px',
      marginBottom: 14,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: DASH_COLORS.text, marginBottom: 2 }}>
            {stat.modelLabel}
          </div>
          {stat.resetsAt && (
            <div style={{ fontSize: 12, color: DASH_COLORS.textMuted }}>
              Resets: {stat.resetsAt}
            </div>
          )}
        </div>
        <div style={{ fontSize: 32, fontWeight: 700, color, lineHeight: 1 }}>
          {stat.percentage}%
        </div>
      </div>

      {/* Progress bar */}
      <div style={{
        background: 'rgba(255,255,255,0.08)',
        borderRadius: 6,
        height: 10,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${Math.min(stat.percentage, 100)}%`,
          height: '100%',
          background: color,
          borderRadius: 6,
          transition: 'width 0.5s ease',
        }} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
        <span style={{ fontSize: 11, color: DASH_COLORS.textMuted }}>0%</span>
        <span style={{ fontSize: 11, color: DASH_COLORS.textMuted }}>100%</span>
      </div>
    </div>
  );
};

export const UsageTab: React.FC = () => {
  const usageStats = useAppStore((s) => s.usageStats);
  const usageFetchedAt = useAppStore((s) => s.usageFetchedAt);
  const usageError = useAppStore((s) => s.usageError);
  const [loading, setLoading] = React.useState(false);
  const [selectedPeriod, setSelectedPeriod] = React.useState<string | null>(null);

  const prevFetchedAt = React.useRef(usageFetchedAt);
  React.useEffect(() => {
    if (usageFetchedAt !== prevFetchedAt.current) {
      prevFetchedAt.current = usageFetchedAt;
      setLoading(false);
    }
  }, [usageFetchedAt]);

  // Group stats by period
  const periodGroups = React.useMemo(() => {
    const groups: Record<string, UsageStat[]> = {};
    for (const stat of usageStats) {
      const p = stat.period ?? 'Unknown';
      if (!groups[p]) groups[p] = [];
      groups[p].push(stat);
    }
    return groups;
  }, [usageStats]);

  // Always show the standard periods, even if API didn't return data for some of them.
  const availablePeriods = React.useMemo(() => {
    const unknown = Object.keys(periodGroups).filter((p) => !PERIOD_ORDER.includes(p));
    return [...PERIOD_ORDER, ...unknown];
  }, [periodGroups]);

  // Auto-select a period with data when possible, otherwise keep/show first tab.
  React.useEffect(() => {
    if (availablePeriods.length > 0) {
      setSelectedPeriod((prev) =>
        prev && availablePeriods.includes(prev)
          ? prev
          : (availablePeriods.find((p) => (periodGroups[p]?.length ?? 0) > 0) ?? availablePeriods[0])
      );
    }
  }, [availablePeriods, periodGroups]);

  const handleRefresh = () => {
    setLoading(true);
    postToExtension({ type: 'requestUsage' });
  };

  const activePeriod = selectedPeriod && availablePeriods.includes(selectedPeriod) ? selectedPeriod : availablePeriods[0] ?? null;
  const activeStats = activePeriod ? (periodGroups[activePeriod] ?? []) : [];
  const activePeriodHasData = activeStats.length > 0;
  const hasData = usageStats.length > 0;

  return (
    <div>
      {/* Header row */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: DASH_COLORS.text }}>
            Usage Data
          </div>
          {usageFetchedAt && (
            <div style={{ fontSize: 12, color: DASH_COLORS.textMuted, marginTop: 2 }}>
              Last updated: {formatTimeAgo(usageFetchedAt)}
            </div>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          style={{
            background: DASH_COLORS.blue,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '7px 16px',
            fontSize: 12,
            fontWeight: 600,
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'Loading...' : `${'\u21BB'} Refresh`}
        </button>
      </div>

      {/* Period tabs */}
      {hasData && availablePeriods.length > 0 && (
        <div style={{
          display: 'flex',
          gap: 6,
          marginBottom: 18,
          flexWrap: 'wrap',
        }}>
          {availablePeriods.map((period) => {
            const isActive = period === activePeriod;
            const periodHasData = (periodGroups[period]?.length ?? 0) > 0;
            return (
              <button
                key={period}
                onClick={() => setSelectedPeriod(period)}
                style={{
                  background: isActive ? DASH_COLORS.blue : DASH_COLORS.cardBg,
                  color: isActive ? '#fff' : DASH_COLORS.textMuted,
                  border: `1px solid ${isActive ? DASH_COLORS.blue : DASH_COLORS.border}`,
                  borderRadius: 6,
                  padding: '5px 14px',
                  fontSize: 12,
                  fontWeight: isActive ? 700 : 400,
                  cursor: 'pointer',
                  opacity: !periodHasData && !isActive ? 0.65 : 1,
                  transition: 'all 0.15s ease',
                }}
              >
                {period}
              </button>
            );
          })}
        </div>
      )}

      {/* Content */}
      {hasData ? (
        activePeriodHasData ? (
          activeStats.map((stat, i) => <UsageCard key={i} stat={stat} />)
        ) : (
          <div style={{
            background: DASH_COLORS.cardBg,
            border: `1px solid ${DASH_COLORS.border}`,
            borderRadius: 8,
            padding: '20px',
            color: DASH_COLORS.textMuted,
            fontSize: 13,
            lineHeight: 1.5,
          }}>
            No usage data returned for <strong>{activePeriod}</strong> in the current API response.
          </div>
        )
      ) : usageError ? (
        <div style={{
          background: DASH_COLORS.cardBg,
          border: `1px solid ${DASH_COLORS.border}`,
          borderRadius: 8,
          padding: '20px',
          color: DASH_COLORS.red,
          fontSize: 13,
          lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Could not load usage data</div>
          <div style={{ color: DASH_COLORS.textMuted, fontSize: 12 }}>{usageError}</div>
        </div>
      ) : (
        <div style={{
          background: DASH_COLORS.cardBg,
          border: `1px solid ${DASH_COLORS.border}`,
          borderRadius: 8,
          padding: '32px 20px',
          textAlign: 'center',
          color: DASH_COLORS.textMuted,
          fontSize: 13,
        }}>
          <div>Click <strong>Refresh</strong> to load your current usage data.</div>
          <div style={{ fontSize: 11, marginTop: 6, opacity: 0.7 }}>
            Shows usage limits per time period and model from Claude Code.
          </div>
        </div>
      )}

      {/* Legend */}
      {hasData && (
        <div style={{
          display: 'flex',
          gap: 20,
          marginTop: 6,
          padding: '10px 0',
          borderTop: `1px solid ${DASH_COLORS.border}`,
        }}>
          {[
            { label: 'Low (\u226450%)', color: DASH_COLORS.green },
            { label: 'Moderate (51\u201375%)', color: DASH_COLORS.amber },
            { label: 'High (>75%)', color: DASH_COLORS.red },
          ].map((item) => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: DASH_COLORS.textMuted }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: item.color, flexShrink: 0 }} />
              {item.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
