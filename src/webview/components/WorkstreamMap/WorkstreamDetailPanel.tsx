import React from 'react';
import type { ProjectMapState, Workstream } from '../../../extension/types/workstreamTypes';
import { postToExtension } from '../../hooks/useClaudeStream';

interface WorkstreamDetailPanelProps {
  workstream: Workstream;
  state: ProjectMapState;
}

export const WorkstreamDetailPanel: React.FC<WorkstreamDetailPanelProps> = ({ workstream, state }) => {
  const wsStations = state.stations
    .filter(s => s.workstreamId === workstream.id)
    .sort((a, b) => a.order - b.order);

  return (
    <div style={{
      width: 300,
      borderLeft: '1px solid var(--vscode-panel-border, #334155)',
      background: 'var(--vscode-sideBar-background, #0F172A)',
      padding: 12,
      overflowY: 'auto',
      fontFamily: 'var(--vscode-font-family)',
      fontSize: 12,
      color: 'var(--vscode-foreground, #CBD5E1)',
    }}>
      {/* Header */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{workstream.label}</div>
        <div style={{ color: '#94A3B8', fontSize: 11 }}>{workstream.goal}</div>
      </div>

      {/* Status & Meta */}
      <div style={sectionStyle}>
        <Row label="Status" value={workstream.status} />
        <Row label="Type" value={workstream.type} />
        <Row label="Phase" value={workstream.currentState.phase} />
        {workstream.source === 'external_folder' ? (
          <>
            <Row label="Source" value="External folder" />
            <Row label="Documents" value={String(workstream.sourceDocumentCount ?? workstream.sourceFilePaths?.length ?? 0)} />
          </>
        ) : (
          <Row label="Sessions" value={String(workstream.sessionIds.length)} />
        )}
        <Row label="Confidence" value={`${Math.round(workstream.confidence * 100)}%`} />
        {workstream.userPinned && <Row label="Pinned" value="Yes" />}
      </div>

      {/* Current State */}
      {workstream.currentState.summary && (
        <div style={sectionStyle}>
          <SectionTitle title="Current State" />
          <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>
            {workstream.currentState.summary}
          </div>
          {workstream.currentState.nextLikelyAction && (
            <div style={{ fontSize: 11, color: '#4A9EFF' }}>
              Next: {workstream.currentState.nextLikelyAction}
            </div>
          )}
        </div>
      )}

      {/* Blockers */}
      {workstream.currentState.blockers.filter(b => !b.resolvedAt).length > 0 && (
        <div style={sectionStyle}>
          <SectionTitle title="Blockers" />
          {workstream.currentState.blockers.filter(b => !b.resolvedAt).map(b => (
            <div key={b.id} style={{ padding: '4px 0', borderBottom: '1px solid #1E293B' }}>
              <div style={{ color: '#F87171', fontWeight: 500, fontSize: 11 }}>{b.label}</div>
              <div style={{ color: '#64748B', fontSize: 10 }}>{b.description}</div>
            </div>
          ))}
        </div>
      )}

      {/* Stations */}
      <div style={sectionStyle}>
        <SectionTitle title={`Stations (${wsStations.length})`} />
        {wsStations.map(station => (
          <div key={station.id} style={{
            padding: '4px 0',
            borderBottom: '1px solid #1E293B',
            cursor: 'pointer',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 10, color: '#64748B' }}>{station.type}</span>
              <span style={{ fontWeight: 500, fontSize: 11 }}>{station.label}</span>
            </div>
            <div style={{ fontSize: 10, color: '#64748B' }}>{station.status}</div>
          </div>
        ))}
      </div>

      {/* Sessions */}
      {workstream.sessionIds.length > 0 && (
        <div style={sectionStyle}>
          <SectionTitle title="Sessions" />
          {workstream.sessionIds.map(sid => (
            <div
              key={sid}
              style={{
                padding: '4px 0',
                borderBottom: '1px solid #1E293B',
                cursor: 'pointer',
                color: '#4A9EFF',
                fontSize: 11,
              }}
              onClick={() => postToExtension({ type: 'workstreamMapOpenSession', sessionId: sid })}
            >
              {sid.slice(0, 12)}...
            </div>
          ))}
        </div>
      )}

      {/* Files */}
      {workstream.source === 'external_folder' && workstream.sourceFilePaths && workstream.sourceFilePaths.length > 0 && (
        <div style={sectionStyle}>
          <SectionTitle title={`Source Documents (${workstream.sourceFilePaths.length})`} />
          {workstream.sourceFilePaths.slice(0, 12).map(f => (
            <div key={f} style={{ fontSize: 10, color: '#64748B', padding: '1px 0' }} title={f}>
              {shortFilePath(f)}
            </div>
          ))}
          {workstream.sourceFilePaths.length > 12 && (
            <div style={{ fontSize: 10, color: '#475569' }}>
              +{workstream.sourceFilePaths.length - 12} more
            </div>
          )}
        </div>
      )}

      {workstream.metrics.filesModified.length > 0 && (
        <div style={sectionStyle}>
          <SectionTitle title={`Files Modified (${workstream.metrics.filesModified.length})`} />
          {workstream.metrics.filesModified.slice(0, 10).map(f => (
            <div key={f} style={{ fontSize: 10, color: '#64748B', padding: '1px 0' }}>
              {f.split('/').slice(-2).join('/')}
            </div>
          ))}
          {workstream.metrics.filesModified.length > 10 && (
            <div style={{ fontSize: 10, color: '#475569' }}>
              +{workstream.metrics.filesModified.length - 10} more
            </div>
          )}
        </div>
      )}

      {/* Confidence Reasons */}
      {workstream.confidenceReasons.length > 0 && (
        <div style={sectionStyle}>
          <SectionTitle title="Classification Reasons" />
          {workstream.confidenceReasons.map((r, i) => (
            <div key={i} style={{ fontSize: 10, color: '#64748B', padding: '1px 0' }}>
              {r}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const sectionStyle: React.CSSProperties = {
  marginBottom: 12,
  paddingBottom: 8,
};

const SectionTitle: React.FC<{ title: string }> = ({ title }) => (
  <div style={{
    fontWeight: 600,
    fontSize: 11,
    color: '#94A3B8',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  }}>
    {title}
  </div>
);

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 11 }}>
    <span style={{ color: '#64748B' }}>{label}</span>
    <span>{value}</span>
  </div>
);

function shortFilePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').slice(-3).join('/');
}
