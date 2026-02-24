import React, { useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useAppStore } from '../../../state/store';
import { postToExtension } from '../../../hooks/useClaudeStream';
import { DASH_COLORS, formatTokens } from '../dashboardUtils';
import type { TokenUsageRatioSample, TokenRatioBucketSummary } from '../../../../extension/types/webview-messages';

const BUCKET_COLORS: Record<string, string> = {
  five_hour: DASH_COLORS.blue,
  seven_day: DASH_COLORS.green,
  seven_day_opus: DASH_COLORS.purple,
  seven_day_sonnet: DASH_COLORS.amber,
  seven_day_oauth_apps: DASH_COLORS.orange,
  seven_day_cowork: DASH_COLORS.teal,
};

function getTrendArrow(trend: TokenRatioBucketSummary['trend']): string {
  switch (trend) {
    case 'increasing': return '^';
    case 'decreasing': return 'v';
    case 'stable': return '-';
    default: return '?';
  }
}

function getTrendColor(trend: TokenRatioBucketSummary['trend']): string {
  switch (trend) {
    case 'increasing': return DASH_COLORS.red;
    case 'decreasing': return DASH_COLORS.green;
    case 'stable': return DASH_COLORS.textMuted;
    default: return DASH_COLORS.textMuted;
  }
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatShortTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// --- Summary Card ---
const SummaryCard: React.FC<{ summary: TokenRatioBucketSummary }> = ({ summary }) => {
  const color = BUCKET_COLORS[summary.bucket] || DASH_COLORS.textMuted;
  return (
    <div style={{
      background: DASH_COLORS.cardBg,
      border: `1px solid ${DASH_COLORS.border}`,
      borderLeft: `4px solid ${color}`,
      borderRadius: 8,
      padding: '16px 18px',
      minWidth: 200,
      flex: '1 1 200px',
    }}>
      <div style={{ fontSize: 12, color: DASH_COLORS.textMuted, marginBottom: 6 }}>
        {summary.bucketLabel}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: DASH_COLORS.text }}>
          {summary.latestTokensPerPercent !== null ? formatTokens(summary.latestTokensPerPercent) : 'N/A'}
        </span>
        <span style={{ fontSize: 12, color: DASH_COLORS.textMuted }}>tokens/1%</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
        <span style={{ fontSize: 11, color: DASH_COLORS.textMuted }}>
          avg: {summary.avgTokensPerPercent !== null ? formatTokens(summary.avgTokensPerPercent) : 'N/A'}
        </span>
        <span style={{ fontSize: 11, color: getTrendColor(summary.trend), fontWeight: 600 }}>
          {getTrendArrow(summary.trend)} {summary.trend}
        </span>
      </div>
      <div style={{ fontSize: 11, color: DASH_COLORS.textMuted, marginTop: 4 }}>
        {summary.sampleCount} sample{summary.sampleCount !== 1 ? 's' : ''}
      </div>
    </div>
  );
};

// --- Chart data builder ---
function buildChartData(samples: TokenUsageRatioSample[]): Array<Record<string, unknown>> {
  // Group samples by timestamp (approximate - same batch)
  const byTime = new Map<number, Record<string, unknown>>();
  for (const s of samples) {
    if (s.tokensPerPercent === null) continue;
    const key = s.timestamp;
    const entry = byTime.get(key) || { timestamp: key, time: formatShortTime(key) };
    entry[s.bucket] = s.tokensPerPercent;
    byTime.set(key, entry);
  }
  return Array.from(byTime.values()).sort((a, b) => (a.timestamp as number) - (b.timestamp as number));
}

export const TokenRatioTab: React.FC = () => {
  const samples = useAppStore((s) => s.tokenRatioSamples);
  const summaries = useAppStore((s) => s.tokenRatioSummaries);
  const globalTurnCount = useAppStore((s) => s.tokenRatioGlobalTurnCount);
  const cumulativeTokens = useAppStore((s) => s.tokenRatioCumulativeTokens);

  // Request data on mount
  useEffect(() => {
    postToExtension({ type: 'getTokenRatioData' } as any);
  }, []);

  const chartData = buildChartData(samples);
  const bucketKeys = [...new Set(samples.filter(s => s.tokensPerPercent !== null).map(s => s.bucket))];
  const recentSamples = samples.slice(-50).reverse();
  const totalTokens = cumulativeTokens
    ? cumulativeTokens.input + cumulativeTokens.output + cumulativeTokens.cacheCreation + cumulativeTokens.cacheRead
    : 0;

  const handleClear = () => {
    postToExtension({ type: 'clearTokenRatioData' } as any);
  };

  if (samples.length === 0 && globalTurnCount < 5) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: DASH_COLORS.textMuted }}>
        <div style={{ fontSize: 24, marginBottom: 12 }}>Waiting for data...</div>
        <div style={{ fontSize: 14 }}>
          Token ratio tracking starts after {5 - globalTurnCount} more turn{5 - globalTurnCount !== 1 ? 's' : ''}.
        </div>
        <div style={{ fontSize: 12, marginTop: 8, opacity: 0.6 }}>
          Samples are taken every 5 turns by fetching usage % from the API.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Summary Cards */}
      {summaries.length > 0 && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {summaries.map((s) => <SummaryCard key={s.bucket} summary={s} />)}
        </div>
      )}

      {/* Global Stats Bar */}
      <div style={{
        background: DASH_COLORS.cardBg,
        border: `1px solid ${DASH_COLORS.border}`,
        borderRadius: 8,
        padding: '12px 18px',
        display: 'flex',
        gap: 32,
        flexWrap: 'wrap',
      }}>
        <div>
          <span style={{ fontSize: 11, color: DASH_COLORS.textMuted }}>Total Turns Tracked</span>
          <div style={{ fontSize: 20, fontWeight: 700, color: DASH_COLORS.text }}>{globalTurnCount}</div>
        </div>
        <div>
          <span style={{ fontSize: 11, color: DASH_COLORS.textMuted }}>Cumulative Tokens (all-time)</span>
          <div style={{ fontSize: 20, fontWeight: 700, color: DASH_COLORS.text }}>{formatTokens(totalTokens)}</div>
        </div>
        {cumulativeTokens && (
          <>
            <div>
              <span style={{ fontSize: 11, color: DASH_COLORS.textMuted }}>Input</span>
              <div style={{ fontSize: 14, color: DASH_COLORS.blue }}>{formatTokens(cumulativeTokens.input)}</div>
            </div>
            <div>
              <span style={{ fontSize: 11, color: DASH_COLORS.textMuted }}>Output</span>
              <div style={{ fontSize: 14, color: DASH_COLORS.green }}>{formatTokens(cumulativeTokens.output)}</div>
            </div>
            <div>
              <span style={{ fontSize: 11, color: DASH_COLORS.textMuted }}>Cache Write</span>
              <div style={{ fontSize: 14, color: DASH_COLORS.amber }}>{formatTokens(cumulativeTokens.cacheCreation)}</div>
            </div>
            <div>
              <span style={{ fontSize: 11, color: DASH_COLORS.textMuted }}>Cache Read</span>
              <div style={{ fontSize: 14, color: DASH_COLORS.teal }}>{formatTokens(cumulativeTokens.cacheRead)}</div>
            </div>
          </>
        )}
      </div>

      {/* Trend Line Chart */}
      {chartData.length > 1 && (
        <div style={{
          background: DASH_COLORS.cardBg,
          border: `1px solid ${DASH_COLORS.border}`,
          borderRadius: 8,
          padding: '16px 12px',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: DASH_COLORS.text, marginBottom: 12, paddingLeft: 8 }}>
            Tokens per 1% Usage Over Time
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData}>
              <XAxis dataKey="time" tick={{ fontSize: 11, fill: DASH_COLORS.textMuted }} />
              <YAxis tick={{ fontSize: 11, fill: DASH_COLORS.textMuted }} tickFormatter={(v: number) => formatTokens(v)} />
              <Tooltip
                contentStyle={{
                  background: DASH_COLORS.cardBg,
                  border: `1px solid ${DASH_COLORS.border}`,
                  borderRadius: 6,
                  fontSize: 12,
                  color: DASH_COLORS.text,
                }}
                formatter={(value: number | undefined) => [formatTokens(value ?? 0), '']}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {bucketKeys.map((bucket) => (
                <Line
                  key={bucket}
                  type="monotone"
                  dataKey={bucket}
                  stroke={BUCKET_COLORS[bucket] || DASH_COLORS.textMuted}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Samples Table */}
      {recentSamples.length > 0 && (
        <div style={{
          background: DASH_COLORS.cardBg,
          border: `1px solid ${DASH_COLORS.border}`,
          borderRadius: 8,
          padding: '16px',
          overflow: 'auto',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: DASH_COLORS.text, marginBottom: 12 }}>
            Recent Samples ({Math.min(recentSamples.length, 50)})
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${DASH_COLORS.border}` }}>
                {['Date', 'Bucket', 'Usage%', 'Delta Tokens', 'Delta Usage%', 'Tokens/1%'].map((h) => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: DASH_COLORS.textMuted, fontWeight: 500 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentSamples.map((s) => (
                <tr key={s.id} style={{ borderBottom: `1px solid rgba(48,54,61,0.5)` }}>
                  <td style={{ padding: '6px 10px', color: DASH_COLORS.textMuted }}>{formatDate(s.timestamp)}</td>
                  <td style={{ padding: '6px 10px' }}>
                    <span style={{ color: BUCKET_COLORS[s.bucket] || DASH_COLORS.text }}>
                      {s.bucketLabel}
                    </span>
                  </td>
                  <td style={{ padding: '6px 10px', color: DASH_COLORS.text }}>{s.usagePercent}%</td>
                  <td style={{ padding: '6px 10px', color: DASH_COLORS.text }}>{formatTokens(s.deltaTokens)}</td>
                  <td style={{ padding: '6px 10px', color: s.deltaUsagePercent < 0 ? DASH_COLORS.amber : DASH_COLORS.text }}>
                    {s.deltaUsagePercent >= 0 ? '+' : ''}{s.deltaUsagePercent.toFixed(1)}%
                  </td>
                  <td style={{ padding: '6px 10px', fontWeight: 600, color: s.tokensPerPercent !== null ? DASH_COLORS.text : DASH_COLORS.textMuted }}>
                    {s.tokensPerPercent !== null ? formatTokens(s.tokensPerPercent) : 'N/A'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Clear Data */}
      <div style={{ textAlign: 'center', paddingTop: 8 }}>
        <button
          onClick={handleClear}
          style={{
            background: 'transparent',
            border: `1px solid ${DASH_COLORS.border}`,
            color: DASH_COLORS.red,
            borderRadius: 6,
            padding: '8px 20px',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          Clear All Token Ratio Data
        </button>
      </div>
    </div>
  );
};
