import React from 'react';
import {
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import type { SessionSummary, TurnCategory } from '../../../../extension/types/webview-messages';
import { DASH_COLORS, CATEGORY_COLORS } from '../dashboardUtils';

interface ProjectToolsTabProps {
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

/** Merge multiple Record<string, number> maps by summing values for the same key. */
function aggregateMaps(sessions: SessionSummary[], accessor: (s: SessionSummary) => Record<string, number>): Record<string, number> {
  const merged: Record<string, number> = {};
  sessions.forEach((sess) => {
    const map = accessor(sess);
    if (map) {
      Object.entries(map).forEach(([key, count]) => {
        merged[key] = (merged[key] ?? 0) + count;
      });
    }
  });
  return merged;
}

export const ProjectToolsTab: React.FC<ProjectToolsTabProps> = ({ sessions }) => {
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
        No tool data yet
      </div>
    );
  }

  // --- Aggregated tool frequency ---
  const toolFreq = aggregateMaps(sessions, (s) => s.toolFrequency);
  const toolData = Object.entries(toolFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name, count]) => ({ name, count }));

  // --- Aggregated category distribution ---
  const catDist = aggregateMaps(sessions, (s) => s.categoryDistribution);
  const categoryData = Object.entries(catDist).map(([name, value]) => ({ name, value }));

  // --- Aggregated task type distribution ---
  const taskTypeDist = aggregateMaps(sessions, (s) => s.taskTypeDistribution);
  const taskTypeData = Object.entries(taskTypeDist)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  return (
    <div>
      {/* Two-column grid: Tool Frequency + Category Distribution */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
        {/* Left: Tool Frequency */}
        <div style={chartCardStyle}>
          <div style={chartTitleStyle}>Tool Frequency (Top 15)</div>
          {toolData.length === 0 ? (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: 200, color: DASH_COLORS.textMuted, fontSize: '13px', fontStyle: 'italic',
            }}>
              No tool usage recorded
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(200, toolData.length * 28)}>
              <BarChart data={toolData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke={DASH_COLORS.border} />
                <XAxis type="number" stroke={DASH_COLORS.textMuted} tick={{ fontSize: 11 }} />
                <YAxis dataKey="name" type="category" width={120} stroke={DASH_COLORS.textMuted} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill={DASH_COLORS.purple} name="Uses" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Right: Category Distribution Donut */}
        <div style={chartCardStyle}>
          <div style={chartTitleStyle}>Turn Category Distribution</div>
          {categoryData.length === 0 ? (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: 200, color: DASH_COLORS.textMuted, fontSize: '13px', fontStyle: 'italic',
            }}>
              No category data recorded
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={categoryData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={90}
                  dataKey="value"
                  nameKey="name"
                  label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  labelLine={{ stroke: DASH_COLORS.textMuted }}
                >
                  {categoryData.map((entry) => (
                    <Cell key={entry.name} fill={CATEGORY_COLORS[entry.name as TurnCategory] || DASH_COLORS.textMuted} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Full-width: Task Type Distribution */}
      <div style={chartCardStyle}>
        <div style={chartTitleStyle}>Task Type Distribution</div>
        {taskTypeData.length === 0 ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: 200, color: DASH_COLORS.textMuted, fontSize: '13px', fontStyle: 'italic',
          }}>
            No task type data recorded
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(200, taskTypeData.length * 28)}>
            <BarChart data={taskTypeData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke={DASH_COLORS.border} />
              <XAxis type="number" stroke={DASH_COLORS.textMuted} tick={{ fontSize: 11 }} />
              <YAxis dataKey="name" type="category" width={120} stroke={DASH_COLORS.textMuted} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" name="Count">
                {taskTypeData.map((entry) => (
                  <Cell key={entry.name} fill={TASK_TYPE_COLORS[entry.name] || DASH_COLORS.textMuted} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};
