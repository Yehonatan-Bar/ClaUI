import React, { useState, useEffect } from 'react';
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
    skillGenShowInfo,
    setSkillGenPanelOpen,
    setSkillGenShowInfo,
  } = useAppStore();

  const [infoOpen, setInfoOpen] = useState(false);
  const [editingThreshold, setEditingThreshold] = useState(false);
  const [thresholdDraft, setThresholdDraft] = useState(String(skillGenThreshold));

  // Auto-expand info section when opened via the StatusBar info button
  useEffect(() => {
    if (skillGenShowInfo) {
      setInfoOpen(true);
      setSkillGenShowInfo(false);
    }
  }, [skillGenShowInfo, setSkillGenShowInfo]);

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

  const handleThresholdSave = () => {
    const parsed = parseInt(thresholdDraft, 10);
    if (!isNaN(parsed) && parsed >= 5 && parsed <= 100) {
      logUI('thresholdChanged', { from: skillGenThreshold, to: parsed });
      postToExtension({ type: 'setSkillGenThreshold', threshold: parsed });
    } else {
      setThresholdDraft(String(skillGenThreshold));
    }
    setEditingThreshold(false);
  };

  const handleClose = () => {
    logUI('panelClosed');
    setSkillGenPanelOpen(false);
  };

  const handleOpenGuide = () => {
    logUI('infoGuideOpened');
    postToExtension({ type: 'openSkillGenGuide' } as any);
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
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              className="skillgen-info-btn"
              onClick={() => { setInfoOpen(!infoOpen); logUI('infoToggled', { open: !infoOpen }); }}
              data-tooltip="How does this work?"
            >
              !
            </button>
            <button className="skillgen-close-btn" onClick={handleClose} data-tooltip="Close">
              x
            </button>
          </div>
        </div>

        {/* Collapsible info section */}
        {infoOpen && (
          <div className="skillgen-info-section">
            <div className="skillgen-info-title">How Documentation Becomes Skills</div>
            <p>Every completed task produces a structured <strong>SR-PTD</strong> document. These are not regular reports -- each section maps directly to a reusable Skill component.</p>
            <p>After <strong>3-5 similar documents</strong> accumulate, they are automatically clustered and merged into a formal <strong>Skill</strong> -- a knowledge package that handles similar tasks automatically in the future.</p>
            <p>Every task solved today becomes organizational knowledge that accelerates future work.</p>
            <button className="skillgen-info-link" onClick={handleOpenGuide}>
              Open full visual guide
            </button>
          </div>
        )}

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
              : editingThreshold
                ? (
                  <span className="skillgen-threshold-edit">
                    {skillGenPendingDocs} /
                    <input
                      type="number"
                      className="skillgen-threshold-input"
                      value={thresholdDraft}
                      min={5}
                      max={100}
                      autoFocus
                      onChange={(e) => setThresholdDraft(e.target.value)}
                      onBlur={handleThresholdSave}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleThresholdSave();
                        if (e.key === 'Escape') { setThresholdDraft(String(skillGenThreshold)); setEditingThreshold(false); }
                      }}
                    />
                    documents
                  </span>
                )
                : (
                  <span
                    className="skillgen-threshold-display"
                    onClick={() => { setThresholdDraft(String(skillGenThreshold)); setEditingThreshold(true); }}
                    data-tooltip="Click to change threshold"
                  >
                    {skillGenPendingDocs} / {skillGenThreshold} documents
                  </span>
                )
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
              data-tooltip={!skillGenEnabled ? 'Enable skill generation first' : skillGenPendingDocs === 0 ? 'No pending documents' : 'Generate skills now'}
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
