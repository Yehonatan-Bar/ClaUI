import React from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';

/** Production-safe UI logger: posts log messages to the extension output channel */
function logUI(event: string, data?: Record<string, unknown>): void {
  postToExtension({ type: 'skillGenUiLog', level: 'INFO', event, data });
}

/**
 * Full panel for skill generation: shows progress bar, controls, last run info, and history.
 * Opens as an overlay when the user clicks the skill gen indicator in the status bar.
 */
export const SkillGenPanel: React.FC = () => {
  const {
    skillGenEnabled,
    skillGenThreshold,
    skillGenPendingDocs,
    skillGenRunStatus,
    skillGenProgress,
    skillGenProgressLabel,
    skillGenLastRun,
    skillGenHistory,
    setSkillGenPanelOpen,
  } = useAppStore();

  const isRunning = skillGenRunStatus === 'running' || skillGenRunStatus === 'scanning'
    || skillGenRunStatus === 'preflight' || skillGenRunStatus === 'installing';

  const handleGenerate = () => {
    logUI('generateClicked', {
      pendingDocs: skillGenPendingDocs,
      threshold: skillGenThreshold,
      enabled: skillGenEnabled,
      runStatus: skillGenRunStatus,
    });
    postToExtension({ type: 'skillGenTrigger' });
  };

  const handleCancel = () => {
    logUI('cancelClicked', {
      runStatus: skillGenRunStatus,
      progress: skillGenProgress,
    });
    postToExtension({ type: 'skillGenCancel' });
  };

  const handleToggle = () => {
    const newState = !skillGenEnabled;
    logUI('toggleEnabled', { from: skillGenEnabled, to: newState, pendingDocs: skillGenPendingDocs });
    postToExtension({ type: 'setSkillGenEnabled', enabled: newState });
  };

  const handleClose = () => {
    logUI('panelClosed');
    setSkillGenPanelOpen(false);
  };

  const progressPercent = Math.min(100, Math.max(0, skillGenProgress));
  const progressWidth = `${progressPercent}%`;

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return iso;
    }
  };

  const formatDuration = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  return (
    <div className="skillgen-panel-overlay" onClick={handleClose}>
      <div className="skillgen-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="skillgen-panel-header">
          <span className="skillgen-panel-title">Skill Generation</span>
          <button className="skillgen-close-btn" onClick={handleClose} title="Close">
            x
          </button>
        </div>

        {/* Enable/Disable toggle */}
        <div className="skillgen-toggle-row">
          <label className="skillgen-toggle-label">
            <input
              type="checkbox"
              checked={skillGenEnabled}
              onChange={handleToggle}
            />
            <span>Enable auto skill generation</span>
          </label>
        </div>

        {/* Progress bar */}
        <div className="skillgen-progress-section">
          <div className="skillgen-progress-bar-container">
            <div
              className={`skillgen-progress-bar-fill ${isRunning ? 'skillgen-progress-animated' : ''}`}
              style={{ width: isRunning ? progressWidth : `${(skillGenPendingDocs / skillGenThreshold) * 100}%` }}
            />
          </div>
          <div className="skillgen-progress-label">
            {isRunning
              ? `${skillGenProgressLabel || 'Processing...'} (${progressPercent}%)`
              : `${skillGenPendingDocs} / ${skillGenThreshold} documents`
            }
          </div>
        </div>

        {/* Action buttons */}
        <div className="skillgen-actions">
          {isRunning ? (
            <button className="skillgen-btn skillgen-btn-cancel" onClick={handleCancel}>
              Cancel
            </button>
          ) : (
            <button
              className="skillgen-btn skillgen-btn-generate"
              onClick={handleGenerate}
              disabled={!skillGenEnabled || skillGenPendingDocs === 0}
              title={!skillGenEnabled ? 'Enable skill generation first' : skillGenPendingDocs === 0 ? 'No pending documents' : 'Generate skills now'}
            >
              Generate Now
            </button>
          )}
        </div>

        {/* Last Run */}
        {skillGenLastRun && (
          <div className="skillgen-last-run">
            <div className="skillgen-section-title">Last Run: {formatDate(skillGenLastRun.date)}</div>
            <div className="skillgen-last-run-details">
              <span className={`skillgen-status-badge skillgen-status-${skillGenLastRun.status}`}>
                {skillGenLastRun.status === 'succeeded' ? 'Success' : skillGenLastRun.status === 'failed' ? 'Failed' : 'Cancelled'}
              </span>
              <span className="skillgen-duration">({formatDuration(skillGenLastRun.durationMs)})</span>
            </div>
            {skillGenLastRun.status === 'succeeded' && (
              <div className="skillgen-last-run-stats">
                {skillGenLastRun.newSkills > 0 && <span>{skillGenLastRun.newSkills} new</span>}
                {skillGenLastRun.upgradedSkills > 0 && <span>{skillGenLastRun.upgradedSkills} upgraded</span>}
                {skillGenLastRun.skippedSkills > 0 && <span>{skillGenLastRun.skippedSkills} skipped</span>}
              </div>
            )}
          </div>
        )}

        {/* History table */}
        {skillGenHistory.length > 0 && (
          <div className="skillgen-history">
            <div className="skillgen-section-title">History</div>
            <table className="skillgen-history-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Docs</th>
                  <th>New</th>
                  <th>Upg</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {skillGenHistory.slice(0, 10).map((entry, i) => (
                  <tr key={i}>
                    <td>{formatDate(entry.date)}</td>
                    <td>{entry.docsProcessed}</td>
                    <td>{entry.newSkills}</td>
                    <td>{entry.upgradedSkills}</td>
                    <td>
                      <span className={`skillgen-status-badge skillgen-status-${entry.status}`}>
                        {entry.status === 'succeeded' ? 'OK' : entry.status === 'failed' ? 'Fail' : 'Cancel'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
