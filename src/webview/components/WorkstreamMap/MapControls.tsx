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
  const isClassifying = useAppStore(s => s.workstreamMapClassifying);

  const portfolioData = useAppStore(s => s.userPortfolioData);
  const cachedViewProject = useAppStore(s => s.cachedViewProject);
  const setCachedViewProject = useAppStore(s => s.setCachedViewProject);
  const enteredFromPortfolio = portfolioData && portfolioData.projects.length > 1;

  const handleBack = () => {
    if (zoom === 'station_detail') {
      setSelected(null);
    } else if (zoom === 'workstream') {
      setFocused(null);
    } else if (zoom === 'project' && (enteredFromPortfolio || cachedViewProject)) {
      if (cachedViewProject) { setCachedViewProject(null); }
      setZoom('portfolio');
      postToExtension({ type: 'workstreamPortfolioRequestData' });
    }
  };

  const handleReclassify = () => {
    postToExtension({ type: 'workstreamMapReclassify', force: true });
  };

  const handleImportExternalFolder = () => {
    postToExtension({ type: 'workstreamMapImportExternalFolder' });
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
      {(zoom !== 'project' || enteredFromPortfolio || cachedViewProject) && zoom !== 'portfolio' && (
        <button onClick={handleBack} data-tooltip="Go back one level" style={btnStyle}>
          {zoom === 'project' && (enteredFromPortfolio || cachedViewProject) ? 'All Projects' : 'Back'}
        </button>
      )}

      <ToggleBtn
        label="Current State"
        tooltip="Toggle current state overlay"
        active={currentStateEnabled}
        onToggle={() => setCurrentState(!currentStateEnabled)}
      />
      <ToggleBtn
        label="Plan Overlay"
        tooltip="Toggle plan overlay"
        active={planOverlayEnabled}
        onToggle={() => setPlanOverlay(!planOverlayEnabled)}
      />
      <ToggleBtn
        label="Resolve"
        tooltip="Toggle resolve editing mode"
        active={resolveModeEnabled}
        onToggle={() => setResolveMode(!resolveModeEnabled)}
      />

      <span style={{ flex: 1 }} />

      <ToggleBtn
        label="Inactive"
        tooltip="Show inactive workstreams"
        active={filters.showInactive}
        onToggle={() => setFilters({ showInactive: !filters.showInactive })}
      />
      <ToggleBtn
        label="Low Confidence"
        tooltip="Show low confidence workstreams"
        active={filters.showLowConfidence}
        onToggle={() => setFilters({ showLowConfidence: !filters.showLowConfidence })}
      />

      <button onClick={handleImportExternalFolder} disabled={isClassifying} data-tooltip="Import workstreams from an external folder" style={isClassifying ? disabledBtnStyle : btnStyle}>
        Import Folder
      </button>

      <button onClick={handleReclassify} disabled={isClassifying} data-tooltip="Rebuild the workstream map" style={isClassifying ? disabledBtnStyle : btnStyle}>
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

const disabledBtnStyle: React.CSSProperties = {
  ...btnStyle,
  opacity: 0.45,
  cursor: 'not-allowed',
};

const ToggleBtn: React.FC<{ label: string; tooltip: string; active: boolean; onToggle: () => void }> = ({ label, tooltip, active, onToggle }) => (
  <button
    onClick={onToggle}
    data-tooltip={tooltip}
    style={{
      ...btnStyle,
      background: active ? 'var(--vscode-button-background, #4A9EFF)' : btnStyle.background,
      color: active ? 'var(--vscode-button-foreground, #fff)' : btnStyle.color,
    }}
  >
    {label}
  </button>
);
