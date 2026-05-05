import React, { useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import { PortfolioProjectMap } from './PortfolioProjectMap';
import type { UserPortfolioState, ProjectSummaryEntry } from '../../../extension/types/workstreamTypes';

const pageEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

export const UserPortfolioView: React.FC = () => {
  const portfolioData = useAppStore(s => s.userPortfolioData);
  const currentWorkspacePath = useAppStore(s => s.portfolioCurrentWorkspacePath);
  const setZoom = useAppStore(s => s.setWorkstreamMapZoom);

  useEffect(() => {
    postToExtension({ type: 'workstreamPortfolioRequestData' });
  }, []);

  const hasCurrentWorkspaceProject = useMemo(() => {
    if (!portfolioData || !currentWorkspacePath) { return false; }
    return portfolioData.projects.some(project => isCurrentWorkspacePath(project.projectPath, currentWorkspacePath));
  }, [portfolioData, currentWorkspacePath]);

  const handleNavigateToCurrentProject = () => {
    useAppStore.getState().setCachedViewProject(null);
    setZoom('project');
    postToExtension({ type: 'workstreamMapRequestData' });
  };

  const handleResumeNavigate = (projectId: string) => {
    if (!portfolioData) { return; }
    const project = portfolioData.projects.find(p => p.projectId === projectId);
    if (!project) { return; }
    if (isCurrentWorkspacePath(project.projectPath, currentWorkspacePath)) {
      handleNavigateToCurrentProject();
    } else if (project.cachedMapState) {
      handleOpenCachedView(project);
    } else {
      postToExtension({ type: 'workstreamPortfolioOpenProject', projectPath: project.projectPath });
    }
  };

  const handleOpenCachedView = (project: ProjectSummaryEntry) => {
    useAppStore.getState().setCachedViewProject(project);
    setZoom('project');
  };

  if (!portfolioData) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 1,
          color: '#64748B',
          fontSize: 12,
          gap: 8,
          fontFamily: 'var(--vscode-font-family)',
        }}
      >
        <div style={{ fontSize: 13, color: '#94A3B8' }}>Loading portfolio...</div>
      </motion.div>
    );
  }

  if (portfolioData.projects.length === 0) {
    return <EmptyPortfolio />;
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      overflow: 'hidden',
      fontFamily: 'var(--vscode-font-family)',
    }}>
      {/* Portfolio Header */}
      <PortfolioHeader
        portfolio={portfolioData}
        showCurrentProjectAction={!!currentWorkspacePath && !hasCurrentWorkspaceProject}
        onCurrentProject={handleNavigateToCurrentProject}
      />

      {/* Resume recommendation banner */}
      {portfolioData.crossProjectResume && (
        <ResumeBanner recommendation={portfolioData.crossProjectResume} onNavigate={handleResumeNavigate} />
      )}

      {/* Full project maps */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '0 0 20px',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <AnimatePresence mode="popLayout">
          {portfolioData.projects
            .sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime())
            .map((project, index) => (
              <PortfolioProjectMap
                key={project.projectId}
                project={project}
                isCurrentWorkspace={isCurrentWorkspacePath(project.projectPath, currentWorkspacePath)}
                onNavigate={handleNavigateToCurrentProject}
                onOpenCachedView={handleOpenCachedView}
                index={index}
              />
            ))}
        </AnimatePresence>
      </div>
    </div>
  );
};

const PortfolioHeader: React.FC<{
  portfolio: UserPortfolioState;
  showCurrentProjectAction: boolean;
  onCurrentProject: () => void;
}> = ({ portfolio, showCurrentProjectAction, onCurrentProject }) => {
  const totalProjects = portfolio.projects.length;
  const totalWorkstreams = portfolio.projects.reduce((sum, project) => sum + project.totalWorkstreams, 0);
  const activeProjects = portfolio.projects.filter(p => p.activeWorkstreams > 0).length;
  const blockedProjects = portfolio.projects.filter(p => p.blockedWorkstreams > 0).length;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: 8,
      padding: '12px 20px',
      borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
      background: 'rgba(15, 23, 42, 0.6)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--vscode-foreground, #E2E8F0)' }}>
          All Workstreams
        </span>
        <HealthSummaryChip label={`${totalProjects} total`} color="#94A3B8" />
        <HealthSummaryChip label={`${totalWorkstreams} streams`} color="#94A3B8" />
        {activeProjects > 0 && <HealthSummaryChip label={`${activeProjects} active`} color="#4A9EFF" />}
        {blockedProjects > 0 && <HealthSummaryChip label={`${blockedProjects} blocked`} color="#F87171" />}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {showCurrentProjectAction && (
          <motion.button
            onClick={onCurrentProject}
            style={{
              background: 'rgba(74, 158, 255, 0.14)',
              color: '#9ecbff',
              border: '1px solid rgba(74, 158, 255, 0.28)',
              borderRadius: 5,
              padding: '3px 10px',
              cursor: 'pointer',
              fontSize: 10,
              fontFamily: 'inherit',
              fontWeight: 600,
            }}
            whileHover={{ scale: 1.05, color: '#cfe8ff' }}
            whileTap={{ scale: 0.95 }}
          >
            Current Project
          </motion.button>
        )}
        <motion.button
          onClick={() => postToExtension({ type: 'workstreamPortfolioRequestData' })}
          style={{
            background: 'rgba(51, 65, 85, 0.5)',
            color: '#94A3B8',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 5,
            padding: '3px 10px',
            cursor: 'pointer',
            fontSize: 10,
            fontFamily: 'inherit',
          }}
          whileHover={{ scale: 1.05, color: '#CBD5E1' }}
          whileTap={{ scale: 0.95 }}
        >
          Refresh
        </motion.button>
      </div>
    </div>
  );
};

const HealthSummaryChip: React.FC<{ label: string; color: string }> = ({ label, color }) => (
  <span style={{
    fontSize: 10,
    color,
    padding: '1px 7px',
    borderRadius: 8,
    background: `${color}12`,
    border: `1px solid ${color}25`,
    fontWeight: 500,
  }}>
    {label}
  </span>
);

const ResumeBanner: React.FC<{
  recommendation: NonNullable<UserPortfolioState['crossProjectResume']>;
  onNavigate: (projectId: string) => void;
}> = ({ recommendation, onNavigate }) => (
  <motion.div
    initial={{ opacity: 0, height: 0 }}
    animate={{ opacity: 1, height: 'auto' }}
    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
    onClick={() => onNavigate(recommendation.projectId)}
    style={{
      padding: '8px 20px',
      background: 'linear-gradient(90deg, rgba(74, 158, 255, 0.08), rgba(74, 158, 255, 0.03))',
      borderBottom: '1px solid rgba(74, 158, 255, 0.15)',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      fontSize: 11,
      color: '#94A3B8',
      fontFamily: 'var(--vscode-font-family)',
      cursor: 'pointer',
      transition: 'background 0.15s ease',
    }}
    whileHover={{ background: 'linear-gradient(90deg, rgba(74, 158, 255, 0.14), rgba(74, 158, 255, 0.06))' }}
  >
    <span style={{
      color: '#4A9EFF',
      fontSize: 12,
      marginRight: 2,
    }}>
      &#x25B6;
    </span>
    <span style={{ fontWeight: 500, color: '#CBD5E1' }}>Resume:</span>
    <span style={{ color: '#4A9EFF' }}>{recommendation.projectName}</span>
    <span style={{ color: '#64748B' }}>&gt;</span>
    <span>{recommendation.workstreamLabel || 'Continue work'}</span>
    <span style={{ color: '#475569', marginLeft: 4 }}>
      ({recommendation.reason})
    </span>
  </motion.div>
);

const EmptyPortfolio: React.FC = () => (
  <motion.div
    initial={{ opacity: 0, scale: 0.97 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      flex: 1,
      gap: 12,
      fontFamily: 'var(--vscode-font-family)',
    }}
  >
    <svg width={48} height={48} viewBox="0 0 48 48" style={{ opacity: 0.3 }}>
      <rect x={4} y={8} width={18} height={14} rx={3} stroke="#4A9EFF" strokeWidth={1.5} fill="none" />
      <rect x={26} y={8} width={18} height={14} rx={3} stroke="#4ADE80" strokeWidth={1.5} fill="none" />
      <rect x={15} y={26} width={18} height={14} rx={3} stroke="#FACC15" strokeWidth={1.5} fill="none" />
      <line x1={13} y1={14} x2={22} y2={14} stroke="#4A9EFF" strokeWidth={1} strokeLinecap="round" opacity={0.5} />
      <line x1={35} y1={14} x2={44} y2={14} stroke="#4ADE80" strokeWidth={1} strokeLinecap="round" opacity={0.5} />
      <line x1={24} y1={32} x2={33} y2={32} stroke="#FACC15" strokeWidth={1} strokeLinecap="round" opacity={0.5} />
    </svg>
    <div style={{ fontSize: 14, fontWeight: 600, color: '#CBD5E1', letterSpacing: '0.02em' }}>
      No Projects Yet
    </div>
    <div style={{ fontSize: 11, color: '#64748B', textAlign: 'center', maxWidth: 280 }}>
      Classify workstreams in your projects to see them here. Open a project and build its Workstream Map first.
    </div>
    <motion.button
      onClick={() => useAppStore.getState().setWorkstreamMapZoom('project')}
      style={{
        marginTop: 4,
        background: 'linear-gradient(135deg, #4A9EFF, #7C3AED)',
        color: '#fff',
        border: 'none',
        borderRadius: 8,
        padding: '8px 20px',
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 600,
      }}
      whileHover={{ scale: 1.05, boxShadow: '0 0 24px rgba(74, 158, 255, 0.3)' }}
      whileTap={{ scale: 0.95 }}
    >
      Go to Project Map
    </motion.button>
  </motion.div>
);

function isCurrentWorkspacePath(projectPath: string, currentWorkspacePath: string): boolean {
  if (!currentWorkspacePath) { return false; }
  return projectPath.replace(/\\/g, '/').toLowerCase() === currentWorkspacePath.replace(/\\/g, '/').toLowerCase();
}
