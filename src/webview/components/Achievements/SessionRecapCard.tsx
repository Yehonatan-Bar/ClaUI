import React from 'react';
import { useAppStore } from '../../state/store';
import { t, tAchTitle } from './achievementI18n';

function formatDuration(durationMs: number): string {
  const totalSec = Math.max(0, Math.floor(durationMs / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h, m, s].map((n) => n.toString().padStart(2, '0')).join(':');
}

export const SessionRecapCard: React.FC = () => {
  const { sessionRecap, sessionActivityElapsedMs, sessionActivityRunningSinceMs, achievementLanguage } = useAppStore();
  if (!sessionRecap) {
    return null;
  }

  const lang = achievementLanguage;
  const tr = t(lang);
  const isRtl = lang === 'he';

  const activityMs = sessionActivityElapsedMs + (
    sessionActivityRunningSinceMs ? Math.max(0, Date.now() - sessionActivityRunningSinceMs) : 0
  );

  const badgeNames = sessionRecap.newAchievements.length > 0
    ? sessionRecap.newAchievements.map((name) => {
        const id = name.toLowerCase().replace(/\s+/g, '-');
        return tAchTitle(lang, id, name);
      }).join(', ')
    : tr.none;

  return (
    <div className="session-recap-card" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="session-recap-title">{tr.sessionRecap}</div>
      <div>{tr.activeClaudeTime} {formatDuration(activityMs)}</div>
      <div>{tr.totalSessionDuration} {formatDuration(sessionRecap.durationMs)}</div>
      <div>{tr.bugsFixed} {sessionRecap.bugsFixed}</div>
      <div>{tr.passingTests} {sessionRecap.passingTests}</div>
      {sessionRecap.filesTouched != null && sessionRecap.filesTouched > 0 && (
        <div>{tr.filesTouchedLabel} {sessionRecap.filesTouched}</div>
      )}
      {sessionRecap.languagesUsed && sessionRecap.languagesUsed.length > 0 && (
        <div>{tr.languagesUsedLabel} {sessionRecap.languagesUsed.join(', ')}</div>
      )}
      <div>{tr.newBadges} {badgeNames}</div>
      <div>{tr.xpGained} +{sessionRecap.xpEarned}</div>
      {sessionRecap.aiXpBonus != null && sessionRecap.aiXpBonus > 0 && (
        <div className="session-recap-ai-bonus">{tr.aiXpBonusLabel} +{sessionRecap.aiXpBonus}</div>
      )}
      <div>{tr.currentLevel} {sessionRecap.level}</div>

      {sessionRecap.aiInsight && (
        <div className="session-recap-insight">
          <div className="session-recap-insight-header">
            {tr.aiInsightLabel}
            {sessionRecap.sessionQuality && (
              <span className={`session-quality-badge quality-${sessionRecap.sessionQuality}`}>
                {sessionRecap.sessionQuality}
              </span>
            )}
          </div>
          <div className="session-recap-insight-text">{sessionRecap.aiInsight}</div>
          {sessionRecap.codingPattern && (
            <div className="session-recap-pattern">{tr.codingPatternLabel} {sessionRecap.codingPattern}</div>
          )}
        </div>
      )}
    </div>
  );
};
