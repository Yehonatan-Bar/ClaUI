import React from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';

export const MapControls: React.FC = () => {
  const currentStateEnabled = useAppStore(s => s.currentStateLayerEnabled);
  const setCurrentState = useAppStore(s => s.setCurrentStateLayerEnabled);
  const planOverlayEnabled = useAppStore(s => s.planOverlayEnabled);
  const setPlanOverlay = useAppStore(s => s.setPlanOverlayEnabled);
  const resolveModeEnabled = useAppStore(s => s.resolveModeEnabled);
  const setResolveMode = useAppStore(s => s.setResolveModeEnabled);
  const filters = useAppStore(s => s.workstreamMapFilters);
  const setFilters = useAppStore(s => s.setWorkstreamMapFilters);
  const zoom = useAppStore(s => s.workstreamMapZoom);
  const setZoom = useAppStore(s => s.setWorkstreamMapZoom);
  const setFocused = useAppStore(s => s.setFocusedWorkstreamId);
  const setSelected = useAppStore(s => s.setSelectedStationId);

  const handleBack = () => {
    if (zoom === 'station_detail') {
      setSelected(null);
    } else if (zoom === 'workstream') {
      setFocused(null);
    }
  };

  const handleReclassify = () => {
    postToExtension({ type: 'workstreamMapReclassify', force: true });
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '5px 16px',
      borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
      background: 'rgba(15, 23, 42, 0.5)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      fontSize: 11,
      fontFamily: 'var(--vscode-font-family)',
    }}>
      {zoom !== 'project' && (
        <button onClick={handleBack} style={btnStyle}>
          Back
        </button>
      )}

      <ToggleBtn
        label="Current State"
        active={currentStateEnabled}
        onToggle={() => setCurrentState(!currentStateEnabled)}
      />
      <ToggleBtn
        label="Plan Overlay"
        active={planOverlayEnabled}
        onToggle={() => setPlanOverlay(!planOverlayEnabled)}
      />
      <ToggleBtn
        label="Resolve"
        active={resolveModeEnabled}
        onToggle={() => setResolveMode(!resolveModeEnabled)}
      />

      <span style={{ flex: 1 }} />

      <ToggleBtn
        label="Inactive"
        active={filters.showInactive}
        onToggle={() => setFilters({ showInactive: !filters.showInactive })}
      />
      <ToggleBtn
        label="Low Confidence"
        active={filters.showLowConfidence}
        onToggle={() => setFilters({ showLowConfidence: !filters.showLowConfidence })}
      />

      <button onClick={handleReclassify} style={btnStyle}>
        Reclassify
      </button>
    </div>
  );
};

const btnStyle: React.CSSProperties = {
  background: 'rgba(51, 65, 85, 0.5)',
  color: 'var(--vscode-button-secondaryForeground, #CBD5E1)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: 5,
  padding: '3px 10px',
  cursor: 'pointer',
  fontSize: 10,
  fontFamily: 'inherit',
  transition: 'all 0.2s ease',
  letterSpacing: '0.01em',
};

const ToggleBtn: React.FC<{ label: string; active: boolean; onToggle: () => void }> = ({ label, active, onToggle }) => (
  <button
    onClick={onToggle}
    style={{
      ...btnStyle,
      background: active ? 'var(--vscode-button-background, #4A9EFF)' : btnStyle.background,
      color: active ? 'var(--vscode-button-foreground, #fff)' : btnStyle.color,
    }}
  >
    {label}
  </button>
);
