import React from 'react';
import { useAppStore } from '../../state/store';
import type { UserEdit } from '../../../extension/types/workstreamTypes';
import { postToExtension } from '../../hooks/useClaudeStream';

function makeEditId(): string {
  return `edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const ResolveToolbar: React.FC = () => {
  const focusedWorkstreamId = useAppStore(s => s.focusedWorkstreamId);
  const selectedStationId = useAppStore(s => s.selectedStationId);
  const mapData = useAppStore(s => s.workstreamMapData);

  const sendEdit = (edit: Pick<UserEdit, 'type' | 'details'>) => {
    postToExtension({
      type: 'workstreamMapApplyEdit',
      edit: {
        id: makeEditId(),
        projectId: mapData?.projectId ?? '',
        timestamp: new Date().toISOString(),
        actor: 'user',
        protectedFromAiOverwrite: true,
        ...edit,
      },
    });
  };

  const handleMarkComplete = () => {
    if (!focusedWorkstreamId) { return; }
    sendEdit({
      type: 'mark_complete',
      details: { workstreamId: focusedWorkstreamId },
    });
  };

  const handleMarkAbandoned = () => {
    if (!focusedWorkstreamId) { return; }
    sendEdit({
      type: 'mark_abandoned',
      details: { workstreamId: focusedWorkstreamId },
    });
  };

  const handlePin = () => {
    if (!focusedWorkstreamId) { return; }
    const ws = mapData?.workstreams.find(w => w.id === focusedWorkstreamId);
    sendEdit({
      type: ws?.userPinned ? 'unpin_workstream' : 'pin_workstream',
      details: { workstreamId: focusedWorkstreamId },
    });
  };

  const handleHideStation = () => {
    if (!selectedStationId) { return; }
    sendEdit({
      type: 'hide_station',
      details: { stationId: selectedStationId },
    });
  };

  const handleRename = () => {
    if (!focusedWorkstreamId) { return; }
    const ws = mapData?.workstreams.find(w => w.id === focusedWorkstreamId);
    const newLabel = prompt('New workstream name:', ws?.label ?? '');
    if (newLabel) {
      sendEdit({
        type: 'rename_workstream',
        details: { workstreamId: focusedWorkstreamId, newLabel },
      });
    }
  };

  const hasWorkstream = !!focusedWorkstreamId;
  const hasStation = !!selectedStationId;
  const ws = hasWorkstream ? mapData?.workstreams.find(w => w.id === focusedWorkstreamId) : null;

  return (
    <div style={{
      display: 'flex',
      gap: 6,
      padding: '6px 12px',
      background: 'rgba(74, 158, 255, 0.08)',
      borderTop: '1px solid rgba(74, 158, 255, 0.2)',
      fontSize: 11,
      fontFamily: 'var(--vscode-font-family)',
      alignItems: 'center',
      flexWrap: 'wrap',
    }}>
      <span style={{ color: '#4A9EFF', fontWeight: 600, fontSize: 10, marginRight: 4 }}>
        RESOLVE MODE
      </span>

      {hasWorkstream && (
        <>
          <ResolveBtn label="Rename" tooltip="Rename this workstream" onClick={handleRename} />
          <ResolveBtn label="Mark Complete" tooltip="Mark workstream as complete" onClick={handleMarkComplete} />
          <ResolveBtn label="Mark Abandoned" tooltip="Mark workstream as abandoned" onClick={handleMarkAbandoned} />
          <ResolveBtn
            label={ws?.userPinned ? 'Unpin' : 'Pin'}
            tooltip={ws?.userPinned ? 'Unpin this workstream' : 'Pin this workstream'}
            onClick={handlePin}
          />
        </>
      )}

      {hasStation && (
        <ResolveBtn label="Hide Station" tooltip="Hide this station from the map" onClick={handleHideStation} />
      )}

      {!hasWorkstream && !hasStation && (
        <span style={{ color: '#64748B', fontSize: 10 }}>
          Select a workstream or station to edit
        </span>
      )}
    </div>
  );
};

const ResolveBtn: React.FC<{ label: string; tooltip: string; onClick: () => void }> = ({ label, tooltip, onClick }) => (
  <button
    onClick={onClick}
    data-tooltip={tooltip}
    style={{
      background: 'var(--vscode-button-secondaryBackground, #334155)',
      color: 'var(--vscode-button-secondaryForeground, #CBD5E1)',
      border: '1px solid rgba(74, 158, 255, 0.3)',
      borderRadius: 4,
      padding: '2px 8px',
      cursor: 'pointer',
      fontSize: 10,
      fontFamily: 'inherit',
    }}
  >
    {label}
  </button>
);
