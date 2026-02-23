import React, { useState, useMemo } from 'react';
import type { SessionSummary } from '../../../../extension/types/webview-messages';
import { DASH_COLORS, formatDuration, formatTokens } from '../dashboardUtils';

interface ProjectSessionsTabProps {
  sessions: SessionSummary[];
}

type SortKey = 'name' | 'date' | 'model' | 'turns' | 'errors' | 'duration' | 'topTool';

function getTopTool(toolFrequency: Record<string, number>): string {
  const entries = Object.entries(toolFrequency);
  if (entries.length === 0) return '-';
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

function getSortValue(session: SessionSummary, key: SortKey): string | number {
  switch (key) {
    case 'name':
      return (session.sessionName || 'Unnamed').toLowerCase();
    case 'date':
      return new Date(session.startedAt).getTime();
    case 'model':
      return (session.model || '').toLowerCase();
    case 'turns':
      return session.totalTurns;
    case 'errors':
      return session.totalErrors;
    case 'duration':
      return session.durationMs;
    case 'topTool':
      return getTopTool(session.toolFrequency).toLowerCase();
    default:
      return 0;
  }
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  borderBottom: `1px solid ${DASH_COLORS.border}`,
  color: DASH_COLORS.textMuted,
  fontSize: '11px',
  fontWeight: 600,
  cursor: 'pointer',
  userSelect: 'none',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: `1px solid ${DASH_COLORS.border}`,
  color: DASH_COLORS.text,
};

const columns: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'date', label: 'Date' },
  { key: 'model', label: 'Model' },
  { key: 'turns', label: 'Turns' },
  { key: 'errors', label: 'Errors' },
  { key: 'duration', label: 'Duration' },
  { key: 'topTool', label: 'Top Tool' },
];

export const ProjectSessionsTab: React.FC<ProjectSessionsTabProps> = ({ sessions }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const filteredAndSorted = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    let result = sessions;
    if (query) {
      result = result.filter((s) => (s.sessionName || '').toLowerCase().includes(query));
    }
    result = [...result].sort((a, b) => {
      const aVal = getSortValue(a, sortKey);
      const bVal = getSortValue(b, sortKey);
      let cmp: number;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        cmp = aVal.localeCompare(bVal);
      } else {
        cmp = (aVal as number) - (bVal as number);
      }
      return sortAsc ? cmp : -cmp;
    });
    return result;
  }, [sessions, searchQuery, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(key === 'name' || key === 'model' || key === 'topTool');
    }
  };

  const toggleExpand = (sessionId: string) => {
    setExpandedId((prev) => (prev === sessionId ? null : sessionId));
  };

  if (sessions.length === 0) {
    return (
      <div style={{ color: DASH_COLORS.textMuted, textAlign: 'center', padding: '48px', fontSize: '14px' }}>
        No sessions recorded yet
      </div>
    );
  }

  return (
    <div>
      {/* Search filter */}
      <div style={{ marginBottom: '12px' }}>
        <input
          type="text"
          placeholder="Filter sessions by name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: '100%',
            padding: '8px 12px',
            fontSize: '13px',
            background: '#0d1117',
            border: `1px solid ${DASH_COLORS.border}`,
            borderRadius: '6px',
            color: DASH_COLORS.text,
            outline: 'none',
            boxSizing: 'border-box',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = DASH_COLORS.blue;
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = DASH_COLORS.border;
          }}
        />
      </div>

      {/* Table */}
      <div
        style={{
          background: DASH_COLORS.cardBg,
          border: `1px solid ${DASH_COLORS.border}`,
          borderRadius: '8px',
          overflow: 'hidden',
        }}
      >
        <table style={tableStyle}>
          <thead>
            <tr style={{ background: '#1c2128' }}>
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={thStyle}
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}
                  {sortKey === col.key && (
                    <span style={{ marginLeft: '4px', fontSize: '10px' }}>
                      {sortAsc ? '\u25B2' : '\u25BC'}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredAndSorted.map((session) => {
              const isExpanded = expandedId === session.sessionId;
              const isHovered = hoveredId === session.sessionId;
              return (
                <React.Fragment key={session.sessionId}>
                  <tr
                    style={{
                      cursor: 'pointer',
                      background: isExpanded
                        ? '#1c2128'
                        : isHovered
                          ? 'rgba(88, 166, 255, 0.06)'
                          : 'transparent',
                      transition: 'background 0.15s ease',
                    }}
                    onClick={() => toggleExpand(session.sessionId)}
                    onMouseEnter={() => setHoveredId(session.sessionId)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    <td style={tdStyle}>{session.sessionName || 'Unnamed'}</td>
                    <td style={tdStyle}>{new Date(session.startedAt).toLocaleDateString()}</td>
                    <td style={tdStyle}>{session.model}</td>
                    <td style={tdStyle}>{session.totalTurns}</td>
                    <td style={{ ...tdStyle, color: session.totalErrors > 0 ? DASH_COLORS.red : DASH_COLORS.text }}>
                      {session.totalErrors}
                    </td>
                    <td style={tdStyle}>{formatDuration(session.durationMs)}</td>
                    <td style={tdStyle}>{getTopTool(session.toolFrequency)}</td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={columns.length} style={{ padding: 0, borderBottom: `1px solid ${DASH_COLORS.border}` }}>
                        <ExpandedPanel session={session} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
        {filteredAndSorted.length === 0 && searchQuery && (
          <div style={{ color: DASH_COLORS.textMuted, textAlign: 'center', padding: '24px', fontSize: '13px' }}>
            No sessions match "{searchQuery}"
          </div>
        )}
      </div>
    </div>
  );
};

// --- Expanded detail panel ---

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  color: DASH_COLORS.textMuted,
  marginBottom: '8px',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const labelStyle: React.CSSProperties = {
  color: DASH_COLORS.textMuted,
  fontSize: '12px',
};

const valueStyle: React.CSSProperties = {
  color: DASH_COLORS.text,
  fontSize: '12px',
  fontWeight: 500,
};

const ExpandedPanel: React.FC<{ session: SessionSummary }> = ({ session }) => {
  const sortedTools = useMemo(() => {
    return Object.entries(session.toolFrequency).sort((a, b) => b[1] - a[1]);
  }, [session.toolFrequency]);

  const sortedCategories = useMemo(() => {
    return Object.entries(session.categoryDistribution).sort((a, b) => b[1] - a[1]);
  }, [session.categoryDistribution]);

  return (
    <div
      style={{
        background: '#0d1117',
        padding: '16px 24px',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: '24px',
      }}
    >
      {/* Token Breakdown */}
      <div>
        <div style={sectionTitleStyle}>Token Breakdown</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={labelStyle}>Input</span>
            <span style={valueStyle}>{formatTokens(session.totalInputTokens)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={labelStyle}>Output</span>
            <span style={valueStyle}>{formatTokens(session.totalOutputTokens)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={labelStyle}>Cache Creation</span>
            <span style={valueStyle}>{formatTokens(session.totalCacheCreationTokens)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={labelStyle}>Cache Read</span>
            <span style={valueStyle}>{formatTokens(session.totalCacheReadTokens)}</span>
          </div>
        </div>
      </div>

      {/* Tool Frequency */}
      <div>
        <div style={sectionTitleStyle}>Tool Frequency</div>
        {sortedTools.length === 0 ? (
          <div style={labelStyle}>No tools used</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '160px', overflowY: 'auto' }}>
            {sortedTools.map(([tool, count]) => (
              <div key={tool} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={labelStyle}>{tool}</span>
                <span style={valueStyle}>{count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Category Distribution */}
      <div>
        <div style={sectionTitleStyle}>Category Distribution</div>
        {sortedCategories.length === 0 ? (
          <div style={labelStyle}>No categories</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {sortedCategories.map(([category, count]) => (
              <div key={category} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={labelStyle}>{category}</span>
                <span style={valueStyle}>{count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
