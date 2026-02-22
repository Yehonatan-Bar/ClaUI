import React from 'react';
import {
  AreaChart, Area,
  BarChart, Bar,
  PieChart, Pie, Cell,
  ComposedChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import type { TurnRecord, TurnCategory } from '../../../../extension/types/webview-messages';
import { DASH_COLORS, CATEGORY_COLORS, TOKEN_COLORS, formatCost, formatDuration } from '../dashboardUtils';

// --- Shared tooltip style ---
const tooltipStyle = {
  backgroundColor: DASH_COLORS.cardBg,
  border: `1px solid ${DASH_COLORS.border}`,
  borderRadius: '6px',
  color: DASH_COLORS.text,
  fontSize: '12px',
};

// --- 1. CostAreaChart ---
interface CostAreaChartProps {
  turnHistory: TurnRecord[];
}

export const CostAreaChart: React.FC<CostAreaChartProps> = ({ turnHistory }) => {
  const data = turnHistory.map((t, i) => ({
    turn: i + 1,
    cost: t.costUsd,
    cumulative: turnHistory.slice(0, i + 1).reduce((s, x) => s + x.costUsd, 0),
  }));

  if (data.length === 0) return <EmptyChart label="No turns yet" />;

  return (
    <ResponsiveContainer width="100%" height={250}>
      <ComposedChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={DASH_COLORS.border} />
        <XAxis dataKey="turn" stroke={DASH_COLORS.textMuted} tick={{ fontSize: 11 }} />
        <YAxis stroke={DASH_COLORS.textMuted} tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v.toFixed(3)}`} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => formatCost(Number(v ?? 0))} />
        <Area type="monotone" dataKey="cumulative" fill={DASH_COLORS.blue} fillOpacity={0.15} stroke={DASH_COLORS.blue} name="Cumulative" />
        <Bar dataKey="cost" fill={DASH_COLORS.green} fillOpacity={0.7} name="Per Turn" />
      </ComposedChart>
    </ResponsiveContainer>
  );
};

// --- 2. TokenStackedBar ---
interface TokenStackedBarProps {
  turnHistory: TurnRecord[];
}

export const TokenStackedBar: React.FC<TokenStackedBarProps> = ({ turnHistory }) => {
  const data = turnHistory.map((t, i) => ({
    turn: i + 1,
    input: (t.inputTokens ?? 0) - (t.cacheReadTokens ?? 0),
    output: t.outputTokens ?? 0,
    cacheCreation: t.cacheCreationTokens ?? 0,
    cacheRead: t.cacheReadTokens ?? 0,
  }));

  if (data.length === 0) return <EmptyChart label="No token data yet" />;

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={DASH_COLORS.border} />
        <XAxis dataKey="turn" stroke={DASH_COLORS.textMuted} tick={{ fontSize: 11 }} />
        <YAxis stroke={DASH_COLORS.textMuted} tick={{ fontSize: 11 }} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend />
        <Bar dataKey="input" stackId="a" fill={TOKEN_COLORS.input} name="Input" />
        <Bar dataKey="output" stackId="a" fill={TOKEN_COLORS.output} name="Output" />
        <Bar dataKey="cacheCreation" stackId="a" fill={TOKEN_COLORS.cacheCreation} name="Cache Create" />
        <Bar dataKey="cacheRead" stackId="a" fill={TOKEN_COLORS.cacheRead} name="Cache Read" />
      </BarChart>
    </ResponsiveContainer>
  );
};

// --- 3. DurationBar ---
interface DurationBarProps {
  turnHistory: TurnRecord[];
}

export const DurationBar: React.FC<DurationBarProps> = ({ turnHistory }) => {
  const data = turnHistory.map((t, i) => ({
    turn: i + 1,
    duration: t.durationMs / 1000,
    category: t.category,
  }));

  if (data.length === 0) return <EmptyChart label="No duration data yet" />;

  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={DASH_COLORS.border} />
        <XAxis dataKey="turn" stroke={DASH_COLORS.textMuted} tick={{ fontSize: 11 }} />
        <YAxis stroke={DASH_COLORS.textMuted} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}s`} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => formatDuration(Number(v ?? 0) * 1000)} />
        <Bar dataKey="duration" name="Duration">
          {data.map((entry, idx) => (
            <Cell key={idx} fill={CATEGORY_COLORS[entry.category as TurnCategory] || DASH_COLORS.textMuted} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

// --- 4. ToolFrequencyBar ---
interface ToolFrequencyBarProps {
  turnHistory: TurnRecord[];
}

export const ToolFrequencyBar: React.FC<ToolFrequencyBarProps> = ({ turnHistory }) => {
  const toolFreq: Record<string, number> = {};
  turnHistory.forEach((t) => {
    t.toolNames.forEach((name) => {
      const base = name.includes('__') ? name.split('__').pop()! : name;
      toolFreq[base] = (toolFreq[base] ?? 0) + 1;
    });
  });
  const sorted = Object.entries(toolFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name, count]) => ({ name, count }));

  if (sorted.length === 0) return <EmptyChart label="No tool usage yet" />;

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, sorted.length * 28)}>
      <BarChart data={sorted} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" stroke={DASH_COLORS.border} />
        <XAxis type="number" stroke={DASH_COLORS.textMuted} tick={{ fontSize: 11 }} />
        <YAxis dataKey="name" type="category" width={120} stroke={DASH_COLORS.textMuted} tick={{ fontSize: 11 }} />
        <Tooltip contentStyle={tooltipStyle} />
        <Bar dataKey="count" fill={DASH_COLORS.purple} name="Uses" />
      </BarChart>
    </ResponsiveContainer>
  );
};

// --- 5. CategoryDonut ---
interface CategoryDonutProps {
  turnHistory: TurnRecord[];
}

export const CategoryDonut: React.FC<CategoryDonutProps> = ({ turnHistory }) => {
  const catCount: Record<string, number> = {};
  turnHistory.forEach((t) => {
    catCount[t.category] = (catCount[t.category] ?? 0) + 1;
  });
  const data = Object.entries(catCount).map(([name, value]) => ({ name, value }));

  if (data.length === 0) return <EmptyChart label="No category data yet" />;

  return (
    <ResponsiveContainer width="100%" height={250}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={90}
          dataKey="value"
          nameKey="name"
          label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
          labelLine={{ stroke: DASH_COLORS.textMuted }}
        >
          {data.map((entry) => (
            <Cell key={entry.name} fill={CATEGORY_COLORS[entry.name as TurnCategory] || DASH_COLORS.textMuted} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} />
      </PieChart>
    </ResponsiveContainer>
  );
};

// --- 6. TaskTypeDonut ---
interface TaskTypeDonutProps {
  turnHistory: TurnRecord[];
}

const TASK_TYPE_COLORS: Record<string, string> = {
  'bug-fix': DASH_COLORS.red,
  'feature-small': DASH_COLORS.green,
  'feature-large': DASH_COLORS.blue,
  exploration: DASH_COLORS.amber,
  refactor: DASH_COLORS.purple,
  'new-app': DASH_COLORS.teal,
  planning: DASH_COLORS.orange,
  'code-review': '#a5d6ff',
  debugging: '#ffa198',
  testing: '#7ee787',
  documentation: '#d2a8ff',
  devops: '#56d4dd',
  question: '#e6edf3',
  configuration: '#8b949e',
  unknown: '#484f58',
};

export const TaskTypeDonut: React.FC<TaskTypeDonutProps> = ({ turnHistory }) => {
  const typeCount: Record<string, number> = {};
  turnHistory.forEach((t) => {
    if (t.semantics) {
      const tt = t.semantics.taskType;
      typeCount[tt] = (typeCount[tt] ?? 0) + 1;
    }
  });
  const data = Object.entries(typeCount).map(([name, value]) => ({ name, value }));

  if (data.length === 0) return <EmptyChart label="Semantic analysis pending" />;

  return (
    <ResponsiveContainer width="100%" height={250}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={90}
          dataKey="value"
          nameKey="name"
          label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
          labelLine={{ stroke: DASH_COLORS.textMuted }}
        >
          {data.map((entry) => (
            <Cell key={entry.name} fill={TASK_TYPE_COLORS[entry.name] || DASH_COLORS.textMuted} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} />
      </PieChart>
    </ResponsiveContainer>
  );
};

// --- 7. OutcomeBar ---
interface OutcomeBarProps {
  turnHistory: TurnRecord[];
}

const OUTCOME_COLORS: Record<string, string> = {
  success: DASH_COLORS.green,
  partial: DASH_COLORS.amber,
  failed: DASH_COLORS.red,
  'in-progress': DASH_COLORS.blue,
  unknown: DASH_COLORS.textMuted,
};

export const OutcomeBar: React.FC<OutcomeBarProps> = ({ turnHistory }) => {
  const semanticTurns = turnHistory.filter((t) => t.semantics);
  if (semanticTurns.length === 0) return <EmptyChart label="Semantic analysis pending" />;

  const data = semanticTurns.map((t, i) => ({
    turn: i + 1,
    outcome: t.semantics!.taskOutcome,
    value: 1,
  }));

  const outcomeCount: Record<string, number> = {};
  semanticTurns.forEach((t) => {
    const o = t.semantics!.taskOutcome;
    outcomeCount[o] = (outcomeCount[o] ?? 0) + 1;
  });
  const barData = Object.entries(outcomeCount).map(([name, value]) => ({ name, value }));

  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={barData}>
        <CartesianGrid strokeDasharray="3 3" stroke={DASH_COLORS.border} />
        <XAxis dataKey="name" stroke={DASH_COLORS.textMuted} tick={{ fontSize: 11 }} />
        <YAxis stroke={DASH_COLORS.textMuted} tick={{ fontSize: 11 }} />
        <Tooltip contentStyle={tooltipStyle} />
        <Bar dataKey="value" name="Count">
          {barData.map((entry) => (
            <Cell key={entry.name} fill={OUTCOME_COLORS[entry.name] || DASH_COLORS.textMuted} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

// --- Empty chart placeholder ---
const EmptyChart: React.FC<{ label: string }> = ({ label }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 200,
    color: DASH_COLORS.textMuted,
    fontSize: '13px',
    fontStyle: 'italic',
  }}>
    {label}
  </div>
);
