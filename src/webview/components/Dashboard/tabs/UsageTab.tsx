import React from 'react';
import { useAppStore } from '../../../state/store';
import { postToExtension } from '../../../hooks/useClaudeStream';
import { DASH_COLORS } from '../dashboardUtils';
import type { UsageStat } from '../../../../extension/types/webview-messages';

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
            {stat.label}
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

  const prevFetchedAt = React.useRef(usageFetchedAt);
  React.useEffect(() => {
    if (usageFetchedAt !== prevFetchedAt.current) {
      prevFetchedAt.current = usageFetchedAt;
      setLoading(false);
    }
  }, [usageFetchedAt]);

  const handleRefresh = () => {
    setLoading(true);
    postToExtension({ type: 'requestUsage' });
  };

  const hasData = usageStats.length > 0;

  return (
    <div>
      {/* Header row */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: DASH_COLORS.text }}>
            API Usage
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

      {/* Content */}
      {hasData ? (
        usageStats.map((stat, i) => <UsageCard key={i} stat={stat} />)
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
          <div style={{ fontSize: 28, marginBottom: 10 }}>
            {'\u{1F4CA}'}
          </div>
          <div>Click <strong>Refresh</strong> to load your current API usage statistics.</div>
          <div style={{ fontSize: 11, marginTop: 6, opacity: 0.7 }}>
            Shows session and weekly usage limits from Claude Code.
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
