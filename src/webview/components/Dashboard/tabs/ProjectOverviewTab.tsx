import React from 'react';
import type { SessionSummary } from '../../../../extension/types/webview-messages';
import {
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { DASH_COLORS, CATEGORY_COLORS, formatCost, formatDuration } from '../dashboardUtils';

interface ProjectOverviewTabProps {
  sessions: SessionSummary[];
}

interface CardData {
  label: string;
  value: string;
  color: string;
}

const chartCardStyle = {
  background: DASH_COLORS.cardBg,
  border: `1px solid ${DASH_COLORS.border}`,
  borderRadius: '8px',
  padding: '16px',
};

const chartTitleStyle = {
  fontSize: '13px',
  fontWeight: 600 as const,
  color: DASH_COLORS.text,
  marginBottom: '12px',
};

const tooltipStyle = {
  backgroundColor: DASH_COLORS.cardBg,
  border: `1px solid ${DASH_COLORS.border}`,
  borderRadius: '6px',
  color: DASH_COLORS.text,
  fontSize: '12px',
};

function getSessionLabel(s: SessionSummary): string {
  if (s.sessionName) return s.sessionName;
  try {
    return new Date(s.startedAt).toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return s.sessionId.slice(0, 8);
  }
}

function findMostUsedModel(sessions: SessionSummary[]): string {
  const freq: Record<string, number> = {};
  for (const s of sessions) {
    const m = s.model || 'unknown';
    freq[m] = (freq[m] ?? 0) + 1;
  }
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  return sorted.length > 0 ? sorted[0][0] : '-';
}

function aggregateRecord(sessions: SessionSummary[], key: 'toolFrequency' | 'categoryDistribution'): Record<string, number> {
  const agg: Record<string, number> = {};
  for (const s of sessions) {
    const rec = s[key];
    if (rec) {
      for (const [k, v] of Object.entries(rec)) {
        agg[k] = (agg[k] ?? 0) + v;
      }
    }
  }
  return agg;
}

function buildModelUsageData(sessions: SessionSummary[]): { name: string; count: number }[] {
  const freq: Record<string, number> = {};
  for (const s of sessions) {
    const m = s.model || 'unknown';
    freq[m] = (freq[m] ?? 0) + 1;
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
}

export const ProjectOverviewTab: React.FC<ProjectOverviewTabProps> = ({ sessions }) => {
  if (sessions.length === 0) {
    return (
      <div style={{ color: DASH_COLORS.textMuted, textAlign: 'center', padding: '48px', fontSize: '14px' }}>
        No project data yet - complete a session to see analytics
      </div>
    );
  }

  // --- Computed metrics ---
  const totalSessions = sessions.length;
  const totalCost = sessions.reduce((s, x) => s + (x.totalCostUsd ?? 0), 0);
  const totalTurns = sessions.reduce((s, x) => s + (x.totalTurns ?? 0), 0);
  const totalToolUses = sessions.reduce((s, x) => s + (x.totalToolUses ?? 0), 0);
  const totalErrors = sessions.reduce((s, x) => s + (x.totalErrors ?? 0), 0);
  const avgSessionCost = totalSessions > 0 ? totalCost / totalSessions : 0;
  const overallErrorRate = totalTurns > 0 ? (totalErrors / totalTurns) * 100 : 0;
  const mostUsedModel = findMostUsedModel(sessions);
  const avgDurationMs = totalSessions > 0
    ? sessions.reduce((s, x) => s + (x.durationMs ?? 0), 0) / totalSessions
    : 0;

  const cards: CardData[] = [
    { label: 'Total Sessions', value: String(totalSessions), color: DASH_COLORS.blue },
    { label: 'Total Cost', value: formatCost(totalCost), color: DASH_COLORS.green },
    { label: 'Total Turns', value: String(totalTurns), color: DASH_COLORS.purple },
    { label: 'Total Tool Uses', value: String(totalToolUses), color: DASH_COLORS.teal },
    { label: 'Avg Session Cost', value: formatCost(avgSessionCost), color: DASH_COLORS.amber },
    {
      label: 'Overall Error Rate',
      value: `${overallErrorRate.toFixed(1)}%`,
      color: overallErrorRate > 20 ? DASH_COLORS.red : DASH_COLORS.textMuted,
    },
    { label: 'Most Used Model', value: mostUsedModel, color: DASH_COLORS.purple },
    { label: 'Avg Session Duration', value: formatDuration(avgDurationMs), color: DASH_COLORS.orange },
  ];

  // --- Chart data ---
  const costPerSession = sessions.map((s) => ({
    name: getSessionLabel(s),
    cost: s.totalCostUsd ?? 0,
  }));

  const turnsPerSession = sessions.map((s) => ({
    name: getSessionLabel(s),
    turns: s.totalTurns ?? 0,
  }));

  const aggToolFreq = aggregateRecord(sessions, 'toolFrequency');
  const toolFreqData = Object.entries(aggToolFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name, count]) => ({ name, count }));

  const aggCategoryDist = aggregateRecord(sessions, 'categoryDistribution');
  const categoryData = Object.entries(aggCategoryDist)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));

  const modelUsageData = buildModelUsageData(sessions);

  return (
    <div>
      {/* Metric cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '12px',
        marginBottom: '20px',
      }}>
        {cards.map((card) => (
          <div key={card.label} style={{
            background: DASH_COLORS.cardBg,
            border: `1px solid ${DASH_COLORS.border}`,
            borderRadius: '8px',
            padding: '14px 16px',
          }}>
            <div style={{ fontSize: '11px', color: DASH_COLORS.textMuted, marginBottom: '6px' }}>
              {card.label}
            </div>
            <div style={{ fontSize: '20px', fontWeight: 600, color: card.color }}>
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* Row 1: Cost per Session + Turns per Session */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
        <div style={chartCardStyle}>
          <div style={chartTitleStyle}>Cost per Session</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={costPerSession}>
              <CartesianGrid strokeDasharray="3 3" stroke={DASH_COLORS.border} />
              <XAxis
                dataKey="name"
                tick={{ fill: DASH_COLORS.textMuted, fontSize: 11 }}
                axisLine={{ stroke: DASH_COLORS.border }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: DASH_COLORS.textMuted, fontSize: 11 }}
                axisLine={{ stroke: DASH_COLORS.border }}
                tickLine={false}
                tickFormatter={(v: number) => `$${v.toFixed(2)}`}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number | undefined) => [formatCost(value ?? 0), 'Cost']}
                labelStyle={{ color: DASH_COLORS.textMuted }}
              />
              <Bar dataKey="cost" fill={DASH_COLORS.green} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={chartCardStyle}>
          <div style={chartTitleStyle}>Turns per Session</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={turnsPerSession}>
              <CartesianGrid strokeDasharray="3 3" stroke={DASH_COLORS.border} />
              <XAxis
                dataKey="name"
                tick={{ fill: DASH_COLORS.textMuted, fontSize: 11 }}
                axisLine={{ stroke: DASH_COLORS.border }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: DASH_COLORS.textMuted, fontSize: 11 }}
                axisLine={{ stroke: DASH_COLORS.border }}
                tickLine={false}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number | undefined) => [value ?? 0, 'Turns']}
                labelStyle={{ color: DASH_COLORS.textMuted }}
              />
              <Bar dataKey="turns" fill={DASH_COLORS.blue} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Row 2: Tool Frequency + Category Distribution */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
        <div style={chartCardStyle}>
          <div style={chartTitleStyle}>Tool Frequency (Aggregated, Top 15)</div>
          {toolFreqData.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(220, toolFreqData.length * 28)}>
              <BarChart data={toolFreqData} layout="vertical" margin={{ left: 80 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={DASH_COLORS.border} />
                <XAxis
                  type="number"
                  tick={{ fill: DASH_COLORS.textMuted, fontSize: 11 }}
                  axisLine={{ stroke: DASH_COLORS.border }}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: DASH_COLORS.textMuted, fontSize: 11 }}
                  axisLine={{ stroke: DASH_COLORS.border }}
                  tickLine={false}
                  width={80}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value: number | undefined) => [value ?? 0, 'Uses']}
                  labelStyle={{ color: DASH_COLORS.textMuted }}
                />
                <Bar dataKey="count" fill={DASH_COLORS.purple} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ color: DASH_COLORS.textMuted, fontSize: '12px', padding: '24px', textAlign: 'center' }}>
              No tool usage data
            </div>
          )}
        </div>

        <div style={chartCardStyle}>
          <div style={chartTitleStyle}>Category Distribution</div>
          {categoryData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={categoryData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={85}
                  paddingAngle={2}
                  label={({ name, percent }: { name?: string; percent?: number }) =>
                    `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`
                  }
                >
                  {categoryData.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={
                        CATEGORY_COLORS[entry.name as keyof typeof CATEGORY_COLORS] ?? DASH_COLORS.textMuted
                      }
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value: number | undefined) => [value ?? 0, 'Turns']}
                  labelStyle={{ color: DASH_COLORS.textMuted }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ color: DASH_COLORS.textMuted, fontSize: '12px', padding: '24px', textAlign: 'center' }}>
              No category data
            </div>
          )}
        </div>
      </div>

      {/* Row 3: Model Usage (full width) */}
      <div style={chartCardStyle}>
        <div style={chartTitleStyle}>Model Usage</div>
        {modelUsageData.length > 0 ? (
          <ResponsiveContainer width="100%" height={Math.max(120, modelUsageData.length * 36)}>
            <BarChart data={modelUsageData} layout="vertical" margin={{ left: 120 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={DASH_COLORS.border} />
              <XAxis
                type="number"
                tick={{ fill: DASH_COLORS.textMuted, fontSize: 11 }}
                axisLine={{ stroke: DASH_COLORS.border }}
                tickLine={false}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fill: DASH_COLORS.textMuted, fontSize: 11 }}
                axisLine={{ stroke: DASH_COLORS.border }}
                tickLine={false}
                width={120}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number | undefined) => [value ?? 0, 'Sessions']}
                labelStyle={{ color: DASH_COLORS.textMuted }}
              />
              <Bar dataKey="count" fill={DASH_COLORS.blue} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ color: DASH_COLORS.textMuted, fontSize: '12px', padding: '24px', textAlign: 'center' }}>
            No model data
          </div>
        )}
      </div>
    </div>
  );
};
