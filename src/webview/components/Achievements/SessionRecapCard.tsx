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
        // Try to find a matching achievement ID for translation
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
      <div>{tr.newBadges} {badgeNames}</div>
      <div>{tr.xpGained} +{sessionRecap.xpEarned}</div>
      <div>{tr.currentLevel} {sessionRecap.level}</div>
    </div>
  );
};
