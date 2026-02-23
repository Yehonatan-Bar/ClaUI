import React, { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import { t as tAch } from './achievementI18n';
import { LEVEL_THRESHOLDS } from './levelThresholds';

export const ShareCard: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [copiedFormat, setCopiedFormat] = useState<string | null>(null);
  const { achievementProfile, achievementLanguage, githubSyncStatus } = useAppStore();

  const tr = tAch(achievementLanguage);
  const isRtl = achievementLanguage === 'he';

  // Listen for open event from AchievementPanel share button
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('open-share-card', handler);
    return () => window.removeEventListener('open-share-card', handler);
  }, []);

  // Listen for copy result
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === 'shareCardCopied' && msg.success) {
        setCopiedFormat(msg.format);
        setTimeout(() => setCopiedFormat(null), 2000);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const handleCopy = useCallback((format: 'markdown' | 'shields-badge') => {
    postToExtension({ type: 'copyShareCard', format });
  }, []);

  if (!open) return null;

  const connected = githubSyncStatus?.connected ?? false;
  const level = achievementProfile.level;
  const totalXp = achievementProfile.totalXp;
  const totalAchievements = achievementProfile.totalAchievements;

  // Calculate XP progress within current level
  const currentLevelThreshold = LEVEL_THRESHOLDS[level - 1] ?? 0;
  const nextLevelThreshold = LEVEL_THRESHOLDS[level] ?? currentLevelThreshold + 1000;
  const xpInLevel = totalXp - currentLevelThreshold;
  const xpNeeded = nextLevelThreshold - currentLevelThreshold;
  const xpProgress = xpNeeded > 0 ? Math.min(100, (xpInLevel / xpNeeded) * 100) : 100;

  return (
    <div className="share-card-overlay" dir={isRtl ? 'rtl' : 'ltr'} onClick={() => setOpen(false)}>
      <div className="share-card-modal" onClick={(e) => e.stopPropagation()}>
        <div className="share-card-modal-header">
          <strong>{tr.shareCardTitle}</strong>
          <button className="share-card-close" onClick={() => setOpen(false)}>x</button>
        </div>

        <p style={{ fontSize: 13, opacity: 0.7, marginBottom: 16 }}>{tr.shareCardDesc}</p>

        {/* Visual preview */}
        <div className="share-card-preview">
          <div className="share-card-preview-row">
            <span className="share-card-preview-label">{tr.level}</span>
            <span className="share-card-preview-value">{level}</span>
          </div>
          <div className="share-card-preview-row">
            <span className="share-card-preview-label">{tr.xp}</span>
            <span className="share-card-preview-value">{totalXp.toLocaleString()}</span>
          </div>
          <div className="share-card-xp-bar">
            <div className="share-card-xp-fill" style={{ width: `${xpProgress}%` }} />
          </div>
          <div className="share-card-preview-row">
            <span className="share-card-preview-label">{tr.achievementsLabel}</span>
            <span className="share-card-preview-value">{totalAchievements}/30</span>
          </div>
        </div>

        {/* Copy actions */}
        <div className="share-card-actions">
          <button
            className={`share-card-copy-btn ${copiedFormat === 'markdown' ? 'copied' : ''}`}
            onClick={() => handleCopy('markdown')}
            disabled={!connected}
            title={!connected ? 'Connect GitHub first' : ''}
          >
            {copiedFormat === 'markdown' ? tr.copied : tr.copyMarkdownCard}
          </button>
          <button
            className={`share-card-copy-btn ${copiedFormat === 'shields-badge' ? 'copied' : ''}`}
            onClick={() => handleCopy('shields-badge')}
            disabled={!connected}
            title={!connected ? 'Connect GitHub first' : ''}
          >
            {copiedFormat === 'shields-badge' ? tr.copied : tr.copyShieldsBadge}
          </button>
        </div>

        {!connected && (
          <p style={{ fontSize: 11, opacity: 0.5, marginTop: 10, textAlign: 'center' }}>
            Connect GitHub in the Community panel to enable sharing (no manual setup for most users).
          </p>
        )}
      </div>
    </div>
  );
};
