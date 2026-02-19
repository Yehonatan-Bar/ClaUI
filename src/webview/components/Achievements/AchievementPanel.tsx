import React, { useMemo } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';

export const AchievementPanel: React.FC = () => {
  const {
    achievementProfile,
    achievementGoals,
    setAchievementPanelOpen,
  } = useAppStore();

  const completedGoals = useMemo(
    () => achievementGoals.filter((goal) => goal.completed).length,
    [achievementGoals]
  );

  const handleDisable = () => {
    postToExtension({ type: 'setAchievementsEnabled', enabled: false });
    setAchievementPanelOpen(false);
  };

  return (
    <div className="achievement-panel">
      <div className="achievement-panel-header">
        <strong>Achievements</strong>
        <button className="achievement-panel-close" onClick={() => setAchievementPanelOpen(false)} title="Close">
          x
        </button>
      </div>

      <div className="achievement-panel-profile">
        <div>Level: <strong>{achievementProfile.level}</strong></div>
        <div>XP: <strong>{achievementProfile.totalXp}</strong></div>
        <div>Unlocked: <strong>{achievementProfile.totalAchievements}</strong></div>
      </div>

      <div className="achievement-panel-goals-title">
        Session Goals ({completedGoals}/{achievementGoals.length})
      </div>
      <div className="achievement-panel-goals">
        {achievementGoals.length === 0 ? (
          <div className="achievement-goal-empty">Start a session to generate goals.</div>
        ) : achievementGoals.map((goal) => (
          <div key={goal.id} className={`achievement-goal ${goal.completed ? 'done' : ''}`}>
            <span>{goal.title}</span>
            <span>{goal.current}/{goal.target}</span>
          </div>
        ))}
      </div>

      <button className="achievement-disable-btn" onClick={handleDisable}>
        Turn Off Achievements
      </button>
    </div>
  );
};
