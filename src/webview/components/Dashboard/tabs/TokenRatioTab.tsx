import React, { useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useAppStore } from '../../../state/store';
import { postToExtension } from '../../../hooks/useClaudeStream';
import { DASH_COLORS, formatTokens } from '../dashboardUtils';
import type { TokenUsageRatioSample, TokenRatioBucketSummary } from '../../../../extension/types/webview-messages';

// ---- Constants ----

/** API quota windows we actually receive data for */
const QUOTA_WINDOWS = [
  { prefix: 'five_hour', label: '5-Hour Quota', color: DASH_COLORS.blue },
  { prefix: 'seven_day', label: '7-Day Quota', color: DASH_COLORS.green },
] as const;

/** Time ranges for the X-axis zoom (how far back to show history) */
interface TimeRange { label: string; ms: number }
const TIME_RANGES: TimeRange[] = [
  { label: '24 Hours', ms: 24 * 60 * 60 * 1000 },
  { label: '14 Days', ms: 14 * 24 * 60 * 60 * 1000 },
  { label: '30 Days', ms: 30 * 24 * 60 * 60 * 1000 },
  { label: '2 Months', ms: 60 * 24 * 60 * 60 * 1000 },
];

const MODEL_SUFFIX_LABELS: Record<string, string> = {
  opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku',
  oauth_apps: 'OAuth Apps', cowork: 'CoWork',
};

const MODEL_COLORS: Record<string, string> = {
  'All Models':  DASH_COLORS.green,
  'Opus':        DASH_COLORS.purple,
  'Sonnet':      DASH_COLORS.amber,
  'Haiku':       DASH_COLORS.blue,
  'OAuth Apps':  DASH_COLORS.orange,
  'CoWork':      DASH_COLORS.teal,
};

// ---- Helpers ----

function parseBucketModelLabel(bucket: string, prefix: string): string {
  if (bucket === prefix) return 'All Models';
  if (bucket.startsWith(prefix + '_')) {
    const suffix = bucket.slice(prefix.length + 1);
    return MODEL_SUFFIX_LABELS[suffix] ?? suffix;
  }
  return bucket;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatShortTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatAxisTick(ts: number, rangeMs: number): string {
  // Short ranges: show time only. Longer ranges: show date.
  if (rangeMs <= 24 * 60 * 60 * 1000) return formatShortTime(ts);
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

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

// ---- Sub-components ----

/** Summary card for a single bucket (e.g. "7-Day: Sonnet") */
const SummaryCard: React.FC<{ summary: TokenRatioBucketSummary; quotaPrefix: string }> = ({ summary, quotaPrefix }) => {
  const modelLabel = parseBucketModelLabel(summary.bucket, quotaPrefix);
  const color = MODEL_COLORS[modelLabel] || DASH_COLORS.textMuted;
  return (
    <div style={{
      background: DASH_COLORS.cardBg,
      border: `1px solid ${DASH_COLORS.border}`,
      borderLeft: `4px solid ${color}`,
      borderRadius: 8,
      padding: '16px 18px',
      minWidth: 180,
      flex: '1 1 180px',
    }}>
      <div style={{ fontSize: 12, color: DASH_COLORS.textMuted, marginBottom: 6 }}>
        {modelLabel}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 26, fontWeight: 700, color: DASH_COLORS.text }}>
          {summary.latestTokensPerPercent !== null ? formatTokens(summary.latestTokensPerPercent) : 'N/A'}
        </span>
        <span style={{ fontSize: 11, color: DASH_COLORS.textMuted }}>tok/1%</span>
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

/** Build chart data for a quota window, filtered to a time range */
function buildChartData(
  samples: TokenUsageRatioSample[],
  quotaPrefix: string,
  rangeMs: number,
): { data: Array<Record<string, unknown>>; modelLabels: string[] } {
  const cutoff = Date.now() - rangeMs;
  const modelLabelsSet = new Set<string>();
  const byTime = new Map<number, Record<string, unknown>>();

  for (const s of samples) {
    if (s.timestamp < cutoff) continue;
    if (s.tokensPerPercent === null) continue;
    // Only include buckets matching this quota prefix
    if (s.bucket !== quotaPrefix && !s.bucket.startsWith(quotaPrefix + '_')) continue;

    const modelLabel = parseBucketModelLabel(s.bucket, quotaPrefix);
    modelLabelsSet.add(modelLabel);
    const entry = byTime.get(s.timestamp) || { timestamp: s.timestamp };
    entry[modelLabel] = s.tokensPerPercent;
    byTime.set(s.timestamp, entry);
  }

  const data = Array.from(byTime.values()).sort(
    (a, b) => (a.timestamp as number) - (b.timestamp as number)
  );
  return { data, modelLabels: Array.from(modelLabelsSet) };
}

/** Filter recent samples for the table */
function getRecentSamples(
  samples: TokenUsageRatioSample[],
  quotaPrefix: string,
  rangeMs: number,
  limit: number,
): TokenUsageRatioSample[] {
  const cutoff = Date.now() - rangeMs;
  return samples
    .filter(s =>
      s.timestamp >= cutoff &&
      (s.bucket === quotaPrefix || s.bucket.startsWith(quotaPrefix + '_'))
    )
    .slice(-limit)
    .reverse();
}

/** A complete panel for one quota window (chart + summaries + table) */
const QuotaPanel: React.FC<{
  quotaPrefix: string;
  quotaLabel: string;
  quotaColor: string;
  samples: TokenUsageRatioSample[];
  summaries: TokenRatioBucketSummary[];
  selectedRange: TimeRange;
}> = ({ quotaPrefix, quotaLabel, quotaColor, samples, summaries, selectedRange }) => {
  // Filter summaries to this quota window
  const windowSummaries = summaries.filter(
    s => s.bucket === quotaPrefix || s.bucket.startsWith(quotaPrefix + '_')
  );

  const { data: chartData, modelLabels } = buildChartData(samples, quotaPrefix, selectedRange.ms);
  const recentSamples = getRecentSamples(samples, quotaPrefix, selectedRange.ms, 30);

  const hasSamples = windowSummaries.length > 0;
  const hasChartData = chartData.length > 1;

  if (!hasSamples) {
    return (
      <div style={{
        background: DASH_COLORS.cardBg,
        border: `1px solid ${DASH_COLORS.border}`,
        borderLeft: `4px solid ${quotaColor}`,
        borderRadius: 8,
        padding: '20px',
        color: DASH_COLORS.textMuted,
        fontSize: 13,
      }}>
        No samples yet for <strong>{quotaLabel}</strong>. Data will appear after a few turns.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Section header */}
      <div style={{
        fontSize: 15,
        fontWeight: 700,
        color: quotaColor,
        borderBottom: `2px solid ${quotaColor}`,
        paddingBottom: 6,
      }}>
        {quotaLabel}
      </div>

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {windowSummaries.map(s => (
          <SummaryCard key={s.bucket} summary={s} quotaPrefix={quotaPrefix} />
        ))}
      </div>

      {/* Chart */}
      {hasChartData && (
        <div style={{
          background: DASH_COLORS.cardBg,
          border: `1px solid ${DASH_COLORS.border}`,
          borderRadius: 8,
          padding: '16px 12px',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: DASH_COLORS.text, marginBottom: 12, paddingLeft: 8 }}>
            Weighted Tokens per 1%
            <span style={{ fontWeight: 400, color: DASH_COLORS.textMuted, marginLeft: 8 }}>
              ({selectedRange.label})
            </span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <XAxis
                dataKey="timestamp"
                type="number"
                domain={['dataMin', 'dataMax']}
                tick={{ fontSize: 11, fill: DASH_COLORS.textMuted }}
                tickFormatter={(value: number) => formatAxisTick(value, selectedRange.ms)}
              />
              <YAxis
                tick={{ fontSize: 11, fill: DASH_COLORS.textMuted }}
                tickFormatter={(v: number) => formatTokens(v)}
              />
              <Tooltip
                contentStyle={{
                  background: DASH_COLORS.cardBg,
                  border: `1px solid ${DASH_COLORS.border}`,
                  borderRadius: 6,
                  fontSize: 12,
                  color: DASH_COLORS.text,
                }}
                labelFormatter={(label: React.ReactNode) => {
                  if (typeof label === 'number') return formatDate(label);
                  if (typeof label === 'string') return formatDate(Number(label));
                  return '';
                }}
                formatter={(value: number | undefined) => [formatTokens(value ?? 0), '']}
              />
              {modelLabels.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {modelLabels.map(ml => (
                <Line
                  key={ml}
                  type="monotone"
                  dataKey={ml}
                  stroke={MODEL_COLORS[ml] || quotaColor}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Samples table */}
      {recentSamples.length > 0 && (
        <div style={{
          background: DASH_COLORS.cardBg,
          border: `1px solid ${DASH_COLORS.border}`,
          borderRadius: 8,
          padding: '14px',
          overflow: 'auto',
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: DASH_COLORS.text, marginBottom: 10 }}>
            Recent Samples ({recentSamples.length})
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${DASH_COLORS.border}` }}>
                {['Date', 'Model', 'Usage%', 'Delta%', 'Weighted Delta', 'Tok/1%'].map(h => (
                  <th key={h} style={{ padding: '6px 8px', textAlign: 'left', color: DASH_COLORS.textMuted, fontWeight: 500 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentSamples.map(s => {
                const modelLabel = parseBucketModelLabel(s.bucket, quotaPrefix);
                const rowColor = MODEL_COLORS[modelLabel] || DASH_COLORS.text;
                return (
                  <tr key={s.id} style={{ borderBottom: `1px solid rgba(48,54,61,0.5)` }}>
                    <td style={{ padding: '5px 8px', color: DASH_COLORS.textMuted }}>{formatDate(s.timestamp)}</td>
                    <td style={{ padding: '5px 8px', color: rowColor }}>{modelLabel}</td>
                    <td style={{ padding: '5px 8px', color: DASH_COLORS.text }}>{s.usagePercent}%</td>
                    <td style={{ padding: '5px 8px', color: s.deltaUsagePercent < 0 ? DASH_COLORS.amber : DASH_COLORS.text }}>
                      {s.deltaUsagePercent >= 0 ? '+' : ''}{s.deltaUsagePercent.toFixed(1)}%
                    </td>
                    <td style={{ padding: '5px 8px', color: DASH_COLORS.text }}>
                      {formatTokens(Math.round(s.weightedDeltaTokens ?? s.deltaTokens))}
                    </td>
                    <td style={{ padding: '5px 8px', fontWeight: 600, color: s.tokensPerPercent !== null ? DASH_COLORS.text : DASH_COLORS.textMuted }}>
                      {s.tokensPerPercent !== null
                        ? formatTokens(s.tokensPerPercent)
                        : (s.deltaTokens > 0 ? 'Baseline' : 'N/A')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ---- Main Component ----

export const TokenRatioTab: React.FC = () => {
  const samples = useAppStore(s => s.tokenRatioSamples);
  const summaries = useAppStore(s => s.tokenRatioSummaries);
  const globalTurnCount = useAppStore(s => s.tokenRatioGlobalTurnCount);
  const cumulativeTokens = useAppStore(s => s.tokenRatioCumulativeTokens);
  const cumulativeWeightedTokens = useAppStore(s => s.tokenRatioCumulativeWeightedTokens);
  const [selectedRange, setSelectedRange] = React.useState(TIME_RANGES[0]); // default: 24 Hours

  useEffect(() => {
    postToExtension({ type: 'getTokenRatioData' } as any);
  }, []);

  const handleClear = () => postToExtension({ type: 'clearTokenRatioData' } as any);
  const handleResample = () => postToExtension({ type: 'forceResampleTokenRatio' } as any);

  const hasValidRatio = samples.some(s => s.tokensPerPercent !== null);
  const totalTokens = cumulativeTokens
    ? cumulativeTokens.input + cumulativeTokens.output + cumulativeTokens.cacheCreation + cumulativeTokens.cacheRead
    : 0;

  // Waiting for initial data
  if (samples.length === 0 && globalTurnCount < 2) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: DASH_COLORS.textMuted }}>
        <div style={{ fontSize: 24, marginBottom: 12 }}>Waiting for data...</div>
        <div style={{ fontSize: 14 }}>
          Token ratio tracking starts after {2 - globalTurnCount} more turn{2 - globalTurnCount !== 1 ? 's' : ''}.
        </div>
        <div style={{ fontSize: 12, marginTop: 8, opacity: 0.6 }}>
          First baseline sample is taken after 2 turns, then every 5 turns to build trend data.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Cost Weight Info */}
      <div style={{
        background: 'rgba(88, 166, 255, 0.08)',
        border: '1px solid rgba(88, 166, 255, 0.25)',
        borderRadius: 8,
        padding: '10px 16px',
        fontSize: 11,
        color: DASH_COLORS.textMuted,
        lineHeight: 1.6,
      }}>
        <span style={{ fontWeight: 600, color: DASH_COLORS.blue }}>Cost-weighted calculation</span>
        {' -- Tokens weighted by API cost: '}
        <span style={{ color: DASH_COLORS.text }}>Output=5x</span>
        {', '}
        <span style={{ color: DASH_COLORS.text }}>Cache Write=1.25x</span>
        {', '}
        <span style={{ color: DASH_COLORS.text }}>Input=1x</span>
        {', '}
        <span style={{ color: DASH_COLORS.text }}>Cache Read=0.1x</span>
      </div>

      {/* Baseline notice */}
      {samples.length > 0 && !hasValidRatio && (
        <div style={{
          background: 'rgba(210, 153, 34, 0.10)',
          border: '1px solid rgba(210, 153, 34, 0.30)',
          borderRadius: 8,
          padding: '10px 16px',
          fontSize: 12,
          color: DASH_COLORS.amber,
          lineHeight: 1.6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}>
          <span>
            Baseline recorded. Click <strong>Resample Now</strong> to compute ratios,
            or wait ~5 turns for automatic sampling.
          </span>
          <button
            onClick={handleResample}
            style={{
              background: DASH_COLORS.amber,
              color: '#000',
              border: 'none',
              borderRadius: 6,
              padding: '6px 16px',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            Resample Now
          </button>
        </div>
      )}

      {/* Time range selector */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: DASH_COLORS.textMuted, marginRight: 8 }}>History range:</span>
        {TIME_RANGES.map(range => {
          const isActive = range.label === selectedRange.label;
          return (
            <button
              key={range.label}
              onClick={() => setSelectedRange(range)}
              style={{
                background: isActive ? DASH_COLORS.blue : DASH_COLORS.cardBg,
                color: isActive ? '#fff' : DASH_COLORS.textMuted,
                border: `1px solid ${isActive ? DASH_COLORS.blue : DASH_COLORS.border}`,
                borderRadius: 6,
                padding: '5px 14px',
                fontSize: 12,
                fontWeight: isActive ? 700 : 400,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {range.label}
            </button>
          );
        })}
      </div>

      {/* Quota panels — one per API window */}
      {QUOTA_WINDOWS.map(qw => (
        <QuotaPanel
          key={qw.prefix}
          quotaPrefix={qw.prefix}
          quotaLabel={qw.label}
          quotaColor={qw.color}
          samples={samples}
          summaries={summaries}
          selectedRange={selectedRange}
        />
      ))}

      {/* Global Stats Bar */}
      <div style={{
        background: DASH_COLORS.cardBg,
        border: `1px solid ${DASH_COLORS.border}`,
        borderRadius: 8,
        padding: '12px 18px',
        display: 'flex',
        gap: 28,
        flexWrap: 'wrap',
      }}>
        <div>
          <span style={{ fontSize: 11, color: DASH_COLORS.textMuted }}>Total Turns</span>
          <div style={{ fontSize: 18, fontWeight: 700, color: DASH_COLORS.text }}>{globalTurnCount}</div>
        </div>
        <div>
          <span style={{ fontSize: 11, color: DASH_COLORS.textMuted }}>Raw Tokens</span>
          <div style={{ fontSize: 18, fontWeight: 700, color: DASH_COLORS.text }}>{formatTokens(totalTokens)}</div>
        </div>
        <div>
          <span style={{ fontSize: 11, color: DASH_COLORS.textMuted }}>Weighted Tokens</span>
          <div style={{ fontSize: 18, fontWeight: 700, color: DASH_COLORS.blue }}>
            {cumulativeWeightedTokens !== null ? formatTokens(Math.round(cumulativeWeightedTokens)) : 'N/A'}
          </div>
        </div>
        {cumulativeTokens && (
          <>
            <div>
              <span style={{ fontSize: 11, color: DASH_COLORS.textMuted }}>Input (1x)</span>
              <div style={{ fontSize: 13, color: DASH_COLORS.blue }}>{formatTokens(cumulativeTokens.input)}</div>
            </div>
            <div>
              <span style={{ fontSize: 11, color: DASH_COLORS.textMuted }}>Output (5x)</span>
              <div style={{ fontSize: 13, color: DASH_COLORS.green }}>{formatTokens(cumulativeTokens.output)}</div>
            </div>
            <div>
              <span style={{ fontSize: 11, color: DASH_COLORS.textMuted }}>Cache Write (1.25x)</span>
              <div style={{ fontSize: 13, color: DASH_COLORS.amber }}>{formatTokens(cumulativeTokens.cacheCreation)}</div>
            </div>
            <div>
              <span style={{ fontSize: 11, color: DASH_COLORS.textMuted }}>Cache Read (0.1x)</span>
              <div style={{ fontSize: 13, color: DASH_COLORS.teal }}>{formatTokens(cumulativeTokens.cacheRead)}</div>
            </div>
          </>
        )}
      </div>

      {/* Actions */}
      <div style={{ textAlign: 'center', paddingTop: 8, display: 'flex', justifyContent: 'center', gap: 12 }}>
        <button
          onClick={handleResample}
          style={{
            background: 'transparent',
            border: `1px solid ${DASH_COLORS.blue}`,
            color: DASH_COLORS.blue,
            borderRadius: 6,
            padding: '8px 20px',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          Resample Now
        </button>
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
          Clear All Data
        </button>
      </div>
    </div>
  );
};
