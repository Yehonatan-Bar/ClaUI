import React from 'react';
import type { Station, ProjectMapState } from '../../../extension/types/workstreamTypes';
import { postToExtension } from '../../hooks/useClaudeStream';

interface StationDetailViewProps {
  station: Station;
  state: ProjectMapState;
}

export const StationDetailView: React.FC<StationDetailViewProps> = ({ station, state }) => {
  const workstream = state.workstreams.find(ws => ws.id === station.workstreamId);

  return (
    <div style={{
      width: 320,
      borderLeft: '1px solid var(--vscode-panel-border, #334155)',
      background: 'var(--vscode-sideBar-background, #0F172A)',
      padding: 12,
      overflowY: 'auto',
      fontFamily: 'var(--vscode-font-family)',
      fontSize: 12,
      color: 'var(--vscode-foreground, #CBD5E1)',
    }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase', marginBottom: 2 }}>
          {station.type}
        </div>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{station.label}</div>
        {workstream && (
          <div style={{ fontSize: 11, color: workstream.visual.colorToken }}>
            {workstream.label}
          </div>
        )}
      </div>

      {/* Description */}
      <Section title="Description">
        <div style={{ color: '#94A3B8' }}>{station.description}</div>
      </Section>

      {/* Why it matters */}
      {station.whyItMatters && (
        <Section title="Why It Matters">
          <div style={{ color: '#94A3B8', fontStyle: 'italic' }}>{station.whyItMatters}</div>
        </Section>
      )}

      {/* Status & Meta */}
      <Section title="Details">
        <DetailRow label="Status" value={station.status} />
        <DetailRow label="Timestamp" value={new Date(station.timestamp).toLocaleString()} />
        <DetailRow label="Importance" value={`${Math.round(station.importanceScore * 100)}%`} />
        <DetailRow label="Confidence" value={`${Math.round(station.confidence * 100)}%`} />
      </Section>

      {/* Source Files */}
      {station.sourceFilePaths && station.sourceFilePaths.length > 0 && (
        <Section title="Relevant Files">
          {station.sourceFilePaths.map(f => (
            <div key={f} style={{ fontSize: 10, color: '#4A9EFF', padding: '1px 0', cursor: 'pointer' }}>
              {f}
            </div>
          ))}
        </Section>
      )}

      {/* Evidence */}
      {station.evidence.length > 0 && (
        <Section title="Evidence">
          {station.evidence.map((ev, i) => (
            <div key={i} style={{
              padding: '4px 0',
              borderBottom: '1px solid #1E293B',
              fontSize: 10,
            }}>
              <span style={{ color: '#64748B' }}>{ev.kind}</span>
              {ev.text && <div style={{ color: '#94A3B8', marginTop: 2 }}>{ev.text}</div>}
            </div>
          ))}
        </Section>
      )}

      {/* Source Session */}
      {station.sessionId && (
        <Section title="Source Session">
          <div
            style={{ color: '#4A9EFF', cursor: 'pointer', fontSize: 11 }}
            onClick={() => postToExtension({ type: 'workstreamMapOpenSession', sessionId: station.sessionId! })}
          >
            Open session {station.sessionId.slice(0, 12)}...
          </div>
        </Section>
      )}
    </div>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{ marginBottom: 12 }}>
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
    {children}
  </div>
);

const DetailRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 11 }}>
    <span style={{ color: '#64748B' }}>{label}</span>
    <span>{value}</span>
  </div>
);
