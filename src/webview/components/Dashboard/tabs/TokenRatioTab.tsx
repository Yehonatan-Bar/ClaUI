import React, { useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useAppStore } from '../../../state/store';
import { postToExtension } from '../../../hooks/useClaudeStream';
import { DASH_COLORS, formatTokens } from '../dashboardUtils';
import type { TokenUsageRatioSample, TokenRatioBucketSummary } from '../../../../extension/types/webview-messages';

/** Preferred display order for time periods */
const PERIOD_ORDER = ['5 Hours', '24 Hours', '7 Days', '14 Days', '30 Days', '2 Months'];

const PERIOD_PREFIXES_UI: Array<{ key: string; label: string }> = [
  { key: 'sixty_day',    label: '2 Months' },
  { key: 'thirty_day',   label: '30 Days' },
  { key: 'fourteen_day', label: '14 Days' },
  { key: 'seven_day',    label: '7 Days' },
  { key: 'one_day',      label: '24 Hours' },
  { key: 'five_hour',    label: '5 Hours' },
];

const MODEL_SUFFIX_LABELS: Record<string, string> = {
  opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku',
  oauth_apps: 'OAuth Apps', cowork: 'CoWork',
};

/** Color assigned per model label (not per bucket key) */
const MODEL_COLORS: Record<string, string> = {
  'All Models':  DASH_COLORS.green,
  'Opus':        DASH_COLORS.purple,
  'Sonnet':      DASH_COLORS.amber,
  'Haiku':       DASH_COLORS.blue,
  'OAuth Apps':  DASH_COLORS.orange,
  'CoWork':      DASH_COLORS.teal,
};

function parseBucketKey(bucket: string): { period: string; modelLabel: string } | null {
  for (const { key: prefix, label: periodLabel } of PERIOD_PREFIXES_UI) {
    if (bucket === prefix) return { period: periodLabel, modelLabel: 'All Models' };
    if (bucket.startsWith(prefix + '_')) {
      const suffix = bucket.slice(prefix.length + 1);
      return { period: periodLabel, modelLabel: MODEL_SUFFIX_LABELS[suffix] ?? suffix };
    }
  }
  return null;
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

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatShortTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatAxisTick(ts: number, periodLabel?: string | null): string {
  if (periodLabel === '5 Hours' || periodLabel === '24 Hours') {
    return formatShortTime(ts);
  }
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// --- Summary Card ---
const SummaryCard: React.FC<{ summary: TokenRatioBucketSummary }> = ({ summary }) => {
  const parsed = parseBucketKey(summary.bucket);
  const modelLabel = parsed?.modelLabel ?? summary.bucketLabel;
  const color = MODEL_COLORS[modelLabel] || DASH_COLORS.textMuted;
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
        {modelLabel}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: DASH_COLORS.text }}>
          {summary.latestTokensPerPercent !== null ? formatTokens(summary.latestTokensPerPercent) : 'N/A'}
        </span>
        <span style={{ fontSize: 12, color: DASH_COLORS.textMuted }}>weighted tok/1%</span>
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
// Builds chart data for a specific period's buckets, keyed by model label for clean legend display
function buildChartData(
  samples: TokenUsageRatioSample[],
  periodBuckets: Set<string>
): Array<Record<string, unknown>> {
  const byTime = new Map<number, Record<string, unknown>>();
  for (const s of samples) {
    if (!periodBuckets.has(s.bucket)) continue;
    if (s.tokensPerPercent === null) continue;
    const parsed = parseBucketKey(s.bucket);
    const modelKey = parsed?.modelLabel ?? s.bucket;
    const entry = byTime.get(s.timestamp) || { timestamp: s.timestamp };
    entry[modelKey] = s.tokensPerPercent;
    byTime.set(s.timestamp, entry);
  }
  return Array.from(byTime.values()).sort((a, b) => (a.timestamp as number) - (b.timestamp as number));
}

export const TokenRatioTab: React.FC = () => {
  const samples = useAppStore((s) => s.tokenRatioSamples);
  const summaries = useAppStore((s) => s.tokenRatioSummaries);
  const globalTurnCount = useAppStore((s) => s.tokenRatioGlobalTurnCount);
  const cumulativeTokens = useAppStore((s) => s.tokenRatioCumulativeTokens);
  const cumulativeWeightedTokens = useAppStore((s) => s.tokenRatioCumulativeWeightedTokens);
  const [selectedPeriod, setSelectedPeriod] = React.useState<string | null>(null);

  useEffect(() => {
    postToExtension({ type: 'getTokenRatioData' } as any);
  }, []);

  const handleClear = () => postToExtension({ type: 'clearTokenRatioData' } as any);
  const handleResample = () => postToExtension({ type: 'forceResampleTokenRatio' } as any);

  const hasValidRatio = samples.some(s => s.tokensPerPercent !== null);
  const totalTokens = cumulativeTokens
    ? cumulativeTokens.input + cumulativeTokens.output + cumulativeTokens.cacheCreation + cumulativeTokens.cacheRead
    : 0;

  // Build period → bucket[] map from summaries (which reflect what data we actually have)
  const periods = React.useMemo(() => {
    const periodMap = new Map<string, string[]>();
    for (const s of summaries) {
      const parsed = parseBucketKey(s.bucket);
      if (!parsed) continue;
      const arr = periodMap.get(parsed.period) || [];
      arr.push(s.bucket);
      periodMap.set(parsed.period, arr);
    }
    const known = PERIOD_ORDER.filter(p => periodMap.has(p));
    const unknown = [...periodMap.keys()].filter(p => !PERIOD_ORDER.includes(p));
    return [...known, ...unknown].map(p => ({ label: p, buckets: periodMap.get(p) ?? [] }));
  }, [summaries]);

  // Auto-select first available period
  useEffect(() => {
    if (periods.length > 0) {
      setSelectedPeriod(prev =>
        prev && periods.some(p => p.label === prev) ? prev : periods[0].label
      );
    }
  }, [periods]);

  const activePeriodEntry = periods.find(p => p.label === selectedPeriod) ?? periods[0] ?? null;
  const activeBuckets = new Set(activePeriodEntry?.buckets ?? []);
  const activeSummaries = summaries.filter(s => activeBuckets.has(s.bucket));
  const chartData = buildChartData(samples, activeBuckets);
  // Model labels in the active period (for Line components)
  const activeModelLabels = activeSummaries
    .map(s => parseBucketKey(s.bucket)?.modelLabel ?? s.bucket)
    .filter((v, i, a) => a.indexOf(v) === i);
  // Filter samples table to active period
  const recentSamples = samples
    .filter(s => activeBuckets.size === 0 || activeBuckets.has(s.bucket))
    .slice(-50).reverse();

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
        border: `1px solid rgba(88, 166, 255, 0.25)`,
        borderRadius: 8,
        padding: '10px 16px',
        fontSize: 11,
        color: DASH_COLORS.textMuted,
        lineHeight: 1.6,
      }}>
        <span style={{ fontWeight: 600, color: DASH_COLORS.blue }}>Cost-weighted calculation</span>
        {' -- Tokens are weighted by relative API cost: '}
        <span style={{ color: DASH_COLORS.text }}>Output=5x</span>
        {', '}
        <span style={{ color: DASH_COLORS.text }}>Cache Write=1.25x</span>
        {', '}
        <span style={{ color: DASH_COLORS.text }}>Input=1x</span>
        {', '}
        <span style={{ color: DASH_COLORS.text }}>Cache Read=0.1x</span>
        {'. This correlates more accurately with actual usage %.'}
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
            Baseline recorded. Click <strong>Resample Now</strong> to compute ratios from current usage data,
            or wait for automatic sampling (~5 turns).
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

      {/* Period selector tabs */}
      {periods.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {periods.map(({ label }) => {
            const isActive = label === activePeriodEntry?.label;
            return (
              <button
                key={label}
                onClick={() => setSelectedPeriod(label)}
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
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Summary Cards for active period */}
      {activeSummaries.length > 0 && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {activeSummaries.map((s) => <SummaryCard key={s.bucket} summary={s} />)}
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
          <span style={{ fontSize: 11, color: DASH_COLORS.textMuted }}>Raw Tokens (all-time)</span>
          <div style={{ fontSize: 20, fontWeight: 700, color: DASH_COLORS.text }}>{formatTokens(totalTokens)}</div>
        </div>
        <div>
          <span style={{ fontSize: 11, color: DASH_COLORS.textMuted }}>Weighted Tokens (all-time)</span>
          <div style={{ fontSize: 20, fontWeight: 700, color: DASH_COLORS.blue }}>
            {cumulativeWeightedTokens !== null ? formatTokens(Math.round(cumulativeWeightedTokens)) : 'N/A'}
          </div>
        </div>
        {cumulativeTokens && (
          <>
            <div>
              <span style={{ fontSize: 11, color: DASH_COLORS.textMuted }}>Input (1x)</span>
              <div style={{ fontSize: 14, color: DASH_COLORS.blue }}>{formatTokens(cumulativeTokens.input)}</div>
            </div>
            <div>
              <span style={{ fontSize: 11, color: DASH_COLORS.textMuted }}>Output (5x)</span>
              <div style={{ fontSize: 14, color: DASH_COLORS.green }}>{formatTokens(cumulativeTokens.output)}</div>
            </div>
            <div>
              <span style={{ fontSize: 11, color: DASH_COLORS.textMuted }}>Cache Write (1.25x)</span>
              <div style={{ fontSize: 14, color: DASH_COLORS.amber }}>{formatTokens(cumulativeTokens.cacheCreation)}</div>
            </div>
            <div>
              <span style={{ fontSize: 11, color: DASH_COLORS.textMuted }}>Cache Read (0.1x)</span>
              <div style={{ fontSize: 14, color: DASH_COLORS.teal }}>{formatTokens(cumulativeTokens.cacheRead)}</div>
            </div>
          </>
        )}
      </div>

      {/* Trend Line Chart - filtered to active period */}
      {chartData.length > 1 && (
        <div style={{
          background: DASH_COLORS.cardBg,
          border: `1px solid ${DASH_COLORS.border}`,
          borderRadius: 8,
          padding: '16px 12px',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: DASH_COLORS.text, marginBottom: 12, paddingLeft: 8 }}>
            Weighted Tokens per 1% Usage Over Time
            {activePeriodEntry && (
              <span style={{ fontWeight: 400, color: DASH_COLORS.textMuted, marginLeft: 8 }}>
                ({activePeriodEntry.label})
              </span>
            )}
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData}>
              <XAxis
                dataKey="timestamp"
                type="number"
                domain={['dataMin', 'dataMax']}
                tick={{ fontSize: 11, fill: DASH_COLORS.textMuted }}
                tickFormatter={(value: number) => formatAxisTick(value, activePeriodEntry?.label)}
              />
              <YAxis tick={{ fontSize: 11, fill: DASH_COLORS.textMuted }} tickFormatter={(v: number) => formatTokens(v)} />
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
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {activeModelLabels.map((modelLabel) => (
                <Line
                  key={modelLabel}
                  type="monotone"
                  dataKey={modelLabel}
                  stroke={MODEL_COLORS[modelLabel] || DASH_COLORS.textMuted}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Samples Table - filtered to active period */}
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
                {['Date', 'Model', 'Usage%', 'Raw Delta', 'Weighted Delta', 'Delta Usage%', 'Weighted Tok/1%'].map((h) => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: DASH_COLORS.textMuted, fontWeight: 500 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentSamples.map((s) => {
                const parsed = parseBucketKey(s.bucket);
                const modelLabel = parsed?.modelLabel ?? s.bucket;
                const rowColor = MODEL_COLORS[modelLabel] || DASH_COLORS.text;
                return (
                  <tr key={s.id} style={{ borderBottom: `1px solid rgba(48,54,61,0.5)` }}>
                    <td style={{ padding: '6px 10px', color: DASH_COLORS.textMuted }}>{formatDate(s.timestamp)}</td>
                    <td style={{ padding: '6px 10px' }}>
                      <span style={{ color: rowColor }}>{modelLabel}</span>
                    </td>
                    <td style={{ padding: '6px 10px', color: DASH_COLORS.text }}>{s.usagePercent}%</td>
                    <td style={{ padding: '6px 10px', color: DASH_COLORS.textMuted }}>{formatTokens(s.deltaTokens)}</td>
                    <td style={{ padding: '6px 10px', color: DASH_COLORS.text }}>
                      {formatTokens(Math.round(s.weightedDeltaTokens ?? s.deltaTokens))}
                    </td>
                    <td style={{ padding: '6px 10px', color: s.deltaUsagePercent < 0 ? DASH_COLORS.amber : DASH_COLORS.text }}>
                      {s.deltaUsagePercent >= 0 ? '+' : ''}{s.deltaUsagePercent.toFixed(1)}%
                    </td>
                    <td style={{ padding: '6px 10px', fontWeight: 600, color: s.tokensPerPercent !== null ? DASH_COLORS.text : DASH_COLORS.textMuted }}>
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
