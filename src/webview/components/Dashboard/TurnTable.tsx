import React, { useState, useMemo } from 'react';
import type { TurnRecord } from '../../../extension/types/webview-messages';
import { DASH_COLORS, CATEGORY_COLORS, MOOD_COLORS, formatCost, formatTokens, formatDuration, formatTime } from './dashboardUtils';

const PAGE_SIZE = 15;

type SortKey = 'turn' | 'time' | 'category' | 'taskType' | 'mood' | 'outcome' | 'tools' | 'duration' | 'cost' | 'tokensIn' | 'tokensOut' | 'cache';
type SortDir = 'asc' | 'desc';

interface TurnTableProps {
  turnHistory: TurnRecord[];
}

export const TurnTable: React.FC<TurnTableProps> = ({ turnHistory }) => {
  const [sortKey, setSortKey] = useState<SortKey>('turn');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(0);

  const hasSemantics = turnHistory.some((t) => t.semantics);

  const sorted = useMemo(() => {
    const copy = [...turnHistory].map((t, i) => ({ ...t, _idx: i }));
    copy.sort((a, b) => {
      let av: number | string = 0;
      let bv: number | string = 0;
      switch (sortKey) {
        case 'turn': av = a._idx; bv = b._idx; break;
        case 'time': av = a.timestamp; bv = b.timestamp; break;
        case 'category': av = a.category; bv = b.category; break;
        case 'taskType': av = a.semantics?.taskType ?? ''; bv = b.semantics?.taskType ?? ''; break;
        case 'mood': av = a.semantics?.userMood ?? ''; bv = b.semantics?.userMood ?? ''; break;
        case 'outcome': av = a.semantics?.taskOutcome ?? ''; bv = b.semantics?.taskOutcome ?? ''; break;
        case 'tools': av = a.toolCount; bv = b.toolCount; break;
        case 'duration': av = a.durationMs; bv = b.durationMs; break;
        case 'cost': av = a.costUsd; bv = b.costUsd; break;
        case 'tokensIn': av = a.inputTokens ?? 0; bv = b.inputTokens ?? 0; break;
        case 'tokensOut': av = a.outputTokens ?? 0; bv = b.outputTokens ?? 0; break;
        case 'cache': av = a.cacheReadTokens ?? 0; bv = b.cacheReadTokens ?? 0; break;
      }
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return copy;
  }, [turnHistory, sortKey, sortDir]);

  const pageCount = Math.ceil(sorted.length / PAGE_SIZE);
  const pageData = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(0);
  };

  if (turnHistory.length === 0) {
    return (
      <div style={{ color: DASH_COLORS.textMuted, textAlign: 'center', padding: '24px', fontSize: '13px' }}>
        No turns yet - start a session to see analytics
      </div>
    );
  }

  const thStyle: React.CSSProperties = {
    padding: '8px 10px',
    fontSize: '11px',
    fontWeight: 600,
    color: DASH_COLORS.textMuted,
    cursor: 'pointer',
    userSelect: 'none',
    textAlign: 'left',
    whiteSpace: 'nowrap',
    borderBottom: `1px solid ${DASH_COLORS.border}`,
  };

  const tdStyle: React.CSSProperties = {
    padding: '6px 10px',
    fontSize: '12px',
    color: DASH_COLORS.text,
    borderBottom: `1px solid ${DASH_COLORS.border}`,
    whiteSpace: 'nowrap',
  };

  const renderHeader = (label: string, key: SortKey) => (
    <th style={thStyle} onClick={() => handleSort(key)}>
      {label} {sortKey === key ? (sortDir === 'asc' ? '\u25B2' : '\u25BC') : ''}
    </th>
  );

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {renderHeader('#', 'turn')}
              {renderHeader('Time', 'time')}
              {renderHeader('Category', 'category')}
              {hasSemantics && renderHeader('Task Type', 'taskType')}
              {hasSemantics && renderHeader('Mood', 'mood')}
              {hasSemantics && renderHeader('Outcome', 'outcome')}
              {renderHeader('Tools', 'tools')}
              {renderHeader('Duration', 'duration')}
              {renderHeader('Cost', 'cost')}
              {renderHeader('Tokens In', 'tokensIn')}
              {renderHeader('Tokens Out', 'tokensOut')}
              {renderHeader('Cache', 'cache')}
            </tr>
          </thead>
          <tbody>
            {pageData.map((turn) => (
              <tr key={turn._idx} style={{ background: turn.isError ? 'rgba(248,81,73,0.08)' : undefined }}>
                <td style={tdStyle}>{turn._idx + 1}</td>
                <td style={tdStyle}>{formatTime(turn.timestamp)}</td>
                <td style={tdStyle}>
                  <span style={{
                    display: 'inline-block',
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: CATEGORY_COLORS[turn.category] || DASH_COLORS.textMuted,
                    marginRight: '6px',
                  }} />
                  {turn.category}
                </td>
                {hasSemantics && (
                  <td style={tdStyle}>{turn.semantics?.taskType ?? '-'}</td>
                )}
                {hasSemantics && (
                  <td style={tdStyle}>
                    {turn.semantics ? (
                      <span style={{ color: MOOD_COLORS[turn.semantics.userMood] || DASH_COLORS.textMuted }}>
                        {turn.semantics.userMood}
                      </span>
                    ) : '-'}
                  </td>
                )}
                {hasSemantics && (
                  <td style={tdStyle}>{turn.semantics?.taskOutcome ?? '-'}</td>
                )}
                <td style={tdStyle}>{turn.toolCount}</td>
                <td style={tdStyle}>{formatDuration(turn.durationMs)}</td>
                <td style={tdStyle}>{formatCost(turn.costUsd)}</td>
                <td style={tdStyle}>{formatTokens(turn.inputTokens ?? 0)}</td>
                <td style={tdStyle}>{formatTokens(turn.outputTokens ?? 0)}</td>
                <td style={tdStyle}>{formatTokens(turn.cacheReadTokens ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageCount > 1 && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '8px',
          marginTop: '12px',
          alignItems: 'center',
        }}>
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            style={paginationBtnStyle}
          >
            Prev
          </button>
          <span style={{ color: DASH_COLORS.textMuted, fontSize: '12px' }}>
            {page + 1} / {pageCount}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={page >= pageCount - 1}
            style={paginationBtnStyle}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};

const paginationBtnStyle: React.CSSProperties = {
  padding: '4px 12px',
  fontSize: '12px',
  background: DASH_COLORS.cardBg,
  color: DASH_COLORS.text,
  border: `1px solid ${DASH_COLORS.border}`,
  borderRadius: '4px',
  cursor: 'pointer',
};
