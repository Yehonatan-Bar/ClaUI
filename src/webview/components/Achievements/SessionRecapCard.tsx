import React from 'react';
import { useAppStore } from '../../state/store';

function formatDuration(durationMs: number): string {
  const totalSec = Math.max(0, Math.floor(durationMs / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h, m, s].map((n) => n.toString().padStart(2, '0')).join(':');
}

export const SessionRecapCard: React.FC = () => {
  const { sessionRecap } = useAppStore();
  if (!sessionRecap) {
    return null;
  }

  return (
    <div className="session-recap-card">
      <div className="session-recap-title">Session Recap</div>
      <div>Duration: {formatDuration(sessionRecap.durationMs)}</div>
      <div>Bugs fixed: {sessionRecap.bugsFixed}</div>
      <div>Passing tests: {sessionRecap.passingTests}</div>
      <div>New badges: {sessionRecap.newAchievements.length > 0 ? sessionRecap.newAchievements.join(', ') : 'None'}</div>
      <div>XP gained: +{sessionRecap.xpEarned}</div>
      <div>Current level: {sessionRecap.level}</div>
    </div>
  );
};
