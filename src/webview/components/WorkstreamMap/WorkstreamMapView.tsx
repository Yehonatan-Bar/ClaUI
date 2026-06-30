import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../state/store';
import { MapHeader } from './MapHeader';
import { MapControls } from './MapControls';
import { MapLegend } from './MapLegend';
import { ProjectMapView } from './ProjectMapView';
import { WorkstreamDetailPanel } from './WorkstreamDetailPanel';
import { StationDetailView } from './StationDetailView';
import { ResolveToolbar } from './ResolveToolbar';
import { NLCommandBar } from './NLCommandBar';
import { ConfidenceReviewPanel } from './ConfidenceReviewPanel';
import { UserPortfolioView } from './UserPortfolioView';
import { postToExtension } from '../../hooks/useClaudeStream';
import type { ProjectSummaryEntry } from '../../../extension/types/workstreamTypes';

const pageEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

const pageTransition = {
  initial: { opacity: 0, scale: 0.97 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.98 },
  transition: { duration: 0.4, ease: pageEase },
};

const CloseButton: React.FC = () => (
  <motion.button
    onClick={() => useAppStore.getState().setWorkstreamMapOpen(false)}
    title="Close Workstream Map"
    style={{
      position: 'absolute',
      top: 8,
      right: 8,
      background: 'rgba(255, 255, 255, 0.06)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      color: 'var(--vscode-foreground, #CBD5E1)',
      cursor: 'pointer',
      fontSize: 14,
      lineHeight: 1,
      padding: '4px 8px',
      borderRadius: 6,
      opacity: 0.7,
      zIndex: 10,
      backdropFilter: 'blur(8px)',
    }}
    whileHover={{ opacity: 1, scale: 1.1 }}
    whileTap={{ scale: 0.9 }}
    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
  >
    X
  </motion.button>
);

const MapIcon: React.FC = () => (
  <svg width={48} height={48} viewBox="0 0 48 48" style={{ marginBottom: 12, opacity: 0.4 }}>
    <line x1={8} y1={16} x2={40} y2={16} stroke="#4A9EFF" strokeWidth={2} strokeLinecap="round" />
    <line x1={8} y1={24} x2={40} y2={24} stroke="#4ADE80" strokeWidth={2} strokeLinecap="round" />
    <line x1={8} y1={32} x2={40} y2={32} stroke="#FACC15" strokeWidth={2} strokeLinecap="round" />
    <circle cx={16} cy={16} r={3} fill="#4A9EFF" />
    <circle cx={30} cy={16} r={3} fill="#4A9EFF" />
    <circle cx={22} cy={24} r={3} fill="#4ADE80" />
    <circle cx={36} cy={24} r={3} fill="#4ADE80" />
    <circle cx={24} cy={32} r={3} fill="#FACC15" />
  </svg>
);

export const WorkstreamMapView: React.FC = () => {
  const mapData = useAppStore(s => s.workstreamMapData);
  const isClassifying = useAppStore(s => s.workstreamMapClassifying);
  const classifyProgress = useAppStore(s => s.workstreamMapClassifyProgress);
  const classifyPhase = useAppStore(s => s.workstreamMapClassifyPhase);
  const error = useAppStore(s => s.workstreamMapError);
  const focusedWorkstreamId = useAppStore(s => s.focusedWorkstreamId);
  const selectedStationId = useAppStore(s => s.selectedStationId);
  const resolveModeEnabled = useAppStore(s => s.resolveModeEnabled);
  const zoom = useAppStore(s => s.workstreamMapZoom);
  const cachedViewProject = useAppStore(s => s.cachedViewProject);
  const portfolioData = useAppStore(s => s.userPortfolioData);
  const [showConfidencePanel, setShowConfidencePanel] = useState(true);

  useEffect(() => {
    postToExtension({ type: 'workstreamMapRequestData' });
    postToExtension({ type: 'workstreamPortfolioRequestData' });
  }, []);

  const focusedWorkstream = mapData && focusedWorkstreamId
    ? mapData.workstreams.find(ws => ws.id === focusedWorkstreamId)
    : null;
  const selectedStation = mapData && selectedStationId
    ? mapData.stations.find(s => s.id === selectedStationId)
    : null;

  const overlayBase: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'var(--vscode-editor-background, rgba(13, 17, 23, 0.97))',
    fontFamily: 'var(--vscode-font-family)',
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: 'var(--vscode-editor-background, rgba(13, 17, 23, 0.97))',
    }}>
      <CloseButton />

      <AnimatePresence mode="wait">
        {/* Error state */}
        {error ? (
          <motion.div
            key="error"
            {...pageTransition}
            style={{ ...overlayBase, color: '#F87171', fontSize: 13, gap: 8 }}
          >
            <div style={{ fontSize: 14, fontWeight: 600 }}>Error loading workstream map</div>
            <div style={{ fontSize: 11, color: '#94A3B8', maxWidth: 400, textAlign: 'center' }}>{error}</div>
            <motion.button
              onClick={() => postToExtension({ type: 'workstreamMapReclassify', force: true })}
              data-tooltip="Retry building the workstream map"
              style={{
                marginTop: 12,
                background: 'linear-gradient(135deg, #F87171, #DC2626)',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '8px 20px',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
              whileHover={{ scale: 1.05, boxShadow: '0 0 20px rgba(248, 113, 113, 0.3)' }}
              whileTap={{ scale: 0.95 }}
            >
              Retry Classification
            </motion.button>
          </motion.div>

        /* Portfolio view (must be before empty/loading checks - portfolio doesn't need mapData) */
        ) : zoom === 'portfolio' ? (
          <motion.div
            key="portfolio"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
          >
            <UserPortfolioView />
          </motion.div>

        /* Cached map view (viewing another project's snapshot) */
        ) : cachedViewProject && cachedViewProject.cachedMapState ? (
          <motion.div
            key="cached-map"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
          >
            <CachedMapBanner project={cachedViewProject} />
            <MapHeader
              state={cachedViewProject.cachedMapState}
              isClassifying={false}
              classifyProgress={0}
              classifyPhase=""
            />

            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              <ProjectMapView state={cachedViewProject.cachedMapState} />
            </div>

            <MapLegend />
          </motion.div>

        /* Empty state */
        ) : !mapData && !isClassifying ? (
          <motion.div
            key="empty"
            {...pageTransition}
            style={{ ...overlayBase, color: '#94A3B8', fontSize: 13, gap: 12 }}
          >
            <MapIcon />
            <div style={{ fontWeight: 600, fontSize: 16, color: '#CBD5E1', letterSpacing: '0.02em' }}>
              Workstream Map
            </div>
            <div style={{ color: '#64748B', fontSize: 12 }}>
              No workstream data yet. Build a map to visualize your project.
            </div>
            <motion.button
              onClick={() => postToExtension({ type: 'workstreamMapReclassify', force: true })}
              data-tooltip="Build the workstream map from sessions"
              style={{
                marginTop: 8,
                background: 'linear-gradient(135deg, #4A9EFF, #7C3AED)',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '10px 24px',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: '0.02em',
              }}
              whileHover={{ scale: 1.05, boxShadow: '0 0 24px rgba(74, 158, 255, 0.4)' }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            >
              Build Workstream Map
            </motion.button>
            <motion.button
              onClick={() => postToExtension({ type: 'workstreamMapImportExternalFolder' })}
              data-tooltip="Import workstreams from an external folder"
              style={{
                background: 'rgba(51, 65, 85, 0.55)',
                color: '#CBD5E1',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 8,
                padding: '9px 20px',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.02em',
              }}
              whileHover={{ scale: 1.04, boxShadow: '0 0 18px rgba(148, 163, 184, 0.2)' }}
              whileTap={{ scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            >
              Import Folder
            </motion.button>
            {portfolioData && portfolioData.projects.length > 0 && (
              <motion.button
                onClick={() => {
                  useAppStore.getState().setWorkstreamMapZoom('portfolio');
                  postToExtension({ type: 'workstreamPortfolioRequestData' });
                }}
                data-tooltip="View all projects portfolio"
                style={{
                  background: 'rgba(74, 158, 255, 0.1)',
                  color: '#9ecbff',
                  border: '1px solid rgba(74, 158, 255, 0.22)',
                  borderRadius: 8,
                  padding: '8px 18px',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
                whileHover={{ scale: 1.04, boxShadow: '0 0 18px rgba(74, 158, 255, 0.22)' }}
                whileTap={{ scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              >
                All Projects
              </motion.button>
            )}
          </motion.div>

        /* Loading state */
        ) : isClassifying && !mapData ? (
          <motion.div
            key="loading"
            {...pageTransition}
            style={{ ...overlayBase, color: '#CBD5E1', gap: 16 }}
          >
            <div style={{ position: 'relative', width: 100, height: 100 }}>
              <svg width={100} height={100} viewBox="0 0 100 100">
                <defs>
                  <filter id="loading-glow">
                    <feGaussianBlur stdDeviation="3" />
                  </filter>
                </defs>
                {/* Background ring */}
                <circle cx={50} cy={50} r={38} fill="none" stroke="rgba(30, 41, 59, 0.8)" strokeWidth={3} />
                {/* Progress ring */}
                <motion.circle
                  cx={50} cy={50} r={38} fill="none" stroke="#4A9EFF" strokeWidth={3}
                  strokeLinecap="round"
                  pathLength={1}
                  style={{ rotate: -90, transformOrigin: 'center' }}
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: classifyProgress }}
                  transition={{ pathLength: { duration: 0.5, ease: 'easeOut' } }}
                />
                {/* Spinning glow dot */}
                <motion.circle
                  cx={50} cy={12} r={4} fill="#4A9EFF" opacity={0.3}
                  filter="url(#loading-glow)"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                  style={{ transformOrigin: '50px 50px' }}
                />
              </svg>
              <div style={{
                position: 'absolute', inset: 0, display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                fontSize: 18, fontWeight: 700, color: '#4A9EFF',
                fontFamily: 'var(--vscode-font-family)',
              }}>
                {Math.round(classifyProgress * 100)}%
              </div>
            </div>
            <div style={{ fontWeight: 600, fontSize: 16, letterSpacing: '0.02em' }}>
              Building Workstream Map
            </div>
            <div style={{ fontSize: 12, color: '#64748B' }}>{classifyPhase}</div>
          </motion.div>

        /* Map state */
        ) : mapData ? (
          <motion.div
            key="map"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
          >
            <MapHeader
              state={mapData}
              isClassifying={isClassifying}
              classifyProgress={classifyProgress}
              classifyPhase={classifyPhase}
            />
            <MapControls />

            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              <ProjectMapView state={mapData} />

              {zoom === 'station_detail' && selectedStation && (
                <StationDetailView station={selectedStation} state={mapData} />
              )}
              {zoom === 'workstream' && focusedWorkstream && !selectedStation && (
                <WorkstreamDetailPanel workstream={focusedWorkstream} state={mapData} />
              )}
            </div>

            {resolveModeEnabled && <ResolveToolbar />}
            {resolveModeEnabled && <NLCommandBar />}

            {showConfidencePanel && (
              <ConfidenceReviewPanel
                state={mapData}
                onClose={() => setShowConfidencePanel(false)}
              />
            )}

            <MapLegend />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
};

function formatCachedDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays < 1) { return 'today'; }
  if (diffDays === 1) { return 'yesterday'; }
  if (diffDays < 7) { return `${diffDays} days ago`; }
  return d.toLocaleDateString();
}

const CachedMapBanner: React.FC<{ project: ProjectSummaryEntry }> = ({ project }) => {
  const setCachedViewProject = useAppStore(s => s.setCachedViewProject);
  const setZoom = useAppStore(s => s.setWorkstreamMapZoom);

  const handleBack = () => {
    setCachedViewProject(null);
    setZoom('portfolio');
    postToExtension({ type: 'workstreamPortfolioRequestData' });
  };

  const handleOpenWorkspace = () => {
    setCachedViewProject(null);
    postToExtension({ type: 'workstreamPortfolioOpenProject', projectPath: project.projectPath });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 16px',
        background: 'linear-gradient(90deg, rgba(250, 204, 21, 0.1), rgba(250, 204, 21, 0.04))',
        borderBottom: '1px solid rgba(250, 204, 21, 0.2)',
        fontSize: 11,
        fontFamily: 'var(--vscode-font-family)',
        color: '#FACC15',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={handleBack}
          data-tooltip="Back to projects portfolio"
          style={{
            background: 'rgba(51, 65, 85, 0.5)',
            color: '#94A3B8',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 5,
            padding: '2px 8px',
            cursor: 'pointer',
            fontSize: 10,
            fontFamily: 'inherit',
          }}
        >
          Back
        </button>
        <span style={{ fontWeight: 600 }}>{project.projectName}</span>
        <span style={{ color: '#94A3B8' }}>
          Cached snapshot from {formatCachedDate(project.lastClassifiedAt)}
        </span>
      </div>
      <button
        onClick={handleOpenWorkspace}
        data-tooltip="Open this project's workspace"
        style={{
          background: 'linear-gradient(135deg, #4A9EFF, #7C3AED)',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          padding: '4px 14px',
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 600,
          fontFamily: 'inherit',
        }}
      >
        Open Workspace
      </button>
    </motion.div>
  );
};
