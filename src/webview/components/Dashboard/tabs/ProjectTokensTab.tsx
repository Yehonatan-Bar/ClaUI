import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { SessionSummary } from '../../../../extension/types/webview-messages';
import { DASH_COLORS, TOKEN_COLORS, formatTokens } from '../dashboardUtils';

interface ProjectTokensTabProps {
  sessions: SessionSummary[];
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

export const ProjectTokensTab: React.FC<ProjectTokensTabProps> = ({ sessions }) => {
  if (sessions.length === 0) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 200,
        color: DASH_COLORS.textMuted,
        fontSize: '13px',
        fontStyle: 'italic',
      }}>
        No token data yet
      </div>
    );
  }

  const totalInput = sessions.reduce((s, sess) => s + (sess.totalInputTokens ?? 0), 0);
  const totalOutput = sessions.reduce((s, sess) => s + (sess.totalOutputTokens ?? 0), 0);
  const totalCacheCreation = sessions.reduce((s, sess) => s + (sess.totalCacheCreationTokens ?? 0), 0);
  const totalCacheRead = sessions.reduce((s, sess) => s + (sess.totalCacheReadTokens ?? 0), 0);
  const cacheHitRate = totalInput > 0 ? (totalCacheRead / totalInput) * 100 : 0;

  const miniCards = [
    { label: 'Total Input Tokens', value: formatTokens(totalInput), color: DASH_COLORS.blue },
    { label: 'Total Output Tokens', value: formatTokens(totalOutput), color: DASH_COLORS.green },
    { label: 'Total Cache Created', value: formatTokens(totalCacheCreation), color: DASH_COLORS.amber },
    { label: 'Cache Read / Hit Rate', value: `${formatTokens(totalCacheRead)} (${cacheHitRate.toFixed(1)}%)`, color: DASH_COLORS.teal },
  ];

  const chartData = sessions.map((sess) => {
    const sessionLabel = sess.sessionName || new Date(sess.startedAt).toLocaleDateString();
    return {
      session: sessionLabel,
      input: (sess.totalInputTokens ?? 0) - (sess.totalCacheReadTokens ?? 0),
      output: sess.totalOutputTokens ?? 0,
      cacheCreation: sess.totalCacheCreationTokens ?? 0,
      cacheRead: sess.totalCacheReadTokens ?? 0,
    };
  });

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
        {miniCards.map((card) => (
          <div key={card.label} style={{
            background: DASH_COLORS.cardBg,
            border: `1px solid ${DASH_COLORS.border}`,
            borderRadius: '8px',
            padding: '12px 14px',
          }}>
            <div style={{ fontSize: '11px', color: DASH_COLORS.textMuted, marginBottom: '4px' }}>{card.label}</div>
            <div style={{ fontSize: '18px', fontWeight: 600, color: card.color }}>{card.value}</div>
          </div>
        ))}
      </div>

      <div style={chartCardStyle}>
        <div style={chartTitleStyle}>Token Breakdown per Session</div>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={DASH_COLORS.border} />
            <XAxis
              dataKey="session"
              stroke={DASH_COLORS.textMuted}
              tick={{ fontSize: 11 }}
              interval={0}
              angle={-30}
              textAnchor="end"
              height={60}
            />
            <YAxis stroke={DASH_COLORS.textMuted} tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => formatTokens(Number(v ?? 0))} />
            <Legend />
            <Bar dataKey="input" stackId="a" fill={TOKEN_COLORS.input} name="Input" />
            <Bar dataKey="output" stackId="a" fill={TOKEN_COLORS.output} name="Output" />
            <Bar dataKey="cacheCreation" stackId="a" fill={TOKEN_COLORS.cacheCreation} name="Cache Create" />
            <Bar dataKey="cacheRead" stackId="a" fill={TOKEN_COLORS.cacheRead} name="Cache Read" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
