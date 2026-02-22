import React, { useMemo, useState } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import { t, tGoalTitle, ACHIEVEMENT_LANG_OPTIONS } from './achievementI18n';
import type { AchievementLang } from './achievementI18n';

export const AchievementPanel: React.FC = () => {
  const {
    achievementProfile,
    achievementGoals,
    achievementLanguage,
    setAchievementLanguage,
    setAchievementPanelOpen,
    setCommunityPanelOpen,
  } = useAppStore();

  const [infoOpen, setInfoOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const lang = achievementLanguage;
  const tr = t(lang);
  const isRtl = lang === 'he';

  const completedGoals = useMemo(
    () => achievementGoals.filter((goal) => goal.completed).length,
    [achievementGoals]
  );

  const handleDisable = () => {
    postToExtension({ type: 'setAchievementsEnabled', enabled: false });
    setAchievementPanelOpen(false);
  };

  return (
    <div className="achievement-panel" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="achievement-panel-header">
        <div className="achievement-panel-header-left">
          <strong>{tr.achievements}</strong>
          <button
            className="achievement-info-btn"
            onClick={() => setInfoOpen(!infoOpen)}
            title={tr.aboutAchievements}
          >
            {'\u2139'}
          </button>
        </div>
        <div className="achievement-panel-header-right">
          <button
            className="achievement-community-btn"
            onClick={() => { setCommunityPanelOpen(true); setAchievementPanelOpen(false); }}
            title={tr.community}
          >
            {tr.community}
          </button>
          <button
            className="achievement-share-btn"
            onClick={() => {
              useAppStore.getState().setCommunityPanelOpen(false);
              window.dispatchEvent(new CustomEvent('open-share-card'));
            }}
            title={tr.share}
          >
            {tr.share}
          </button>
          <button
            className="achievement-settings-btn"
            onClick={() => setSettingsOpen(!settingsOpen)}
            title="Settings"
          >
            {'\u2699'}
          </button>
          <button className="achievement-panel-close" onClick={() => setAchievementPanelOpen(false)} title={tr.close}>
            x
          </button>
        </div>
      </div>

      {settingsOpen && (
        <div className="achievement-settings-row">
          <span>{tr.language}</span>
          <select
            className="achievement-lang-select"
            value={lang}
            onChange={(e) => setAchievementLanguage(e.target.value as AchievementLang)}
          >
            {ACHIEVEMENT_LANG_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      )}

      {infoOpen && (
        <div className="achievement-info-modal">
          <div className="achievement-info-modal-title">{tr.aboutAchievements}</div>

          <div className="achievement-info-section">
            <strong>{tr.infoWhatAre}</strong>
            <p>{tr.infoWhatAreDesc}</p>
          </div>

          <div className="achievement-info-section">
            <strong>{tr.infoHowEarn}</strong>
            <p>{tr.infoHowEarnDesc}</p>
          </div>

          <div className="achievement-info-section">
            <strong>{tr.infoRarities}</strong>
            <p>{tr.infoRaritiesDesc}</p>
          </div>

          <div className="achievement-info-section">
            <strong>{tr.infoGoals}</strong>
            <p>{tr.infoGoalsDesc}</p>
          </div>

          <div className="achievement-info-section">
            <strong>{tr.infoLevels}</strong>
            <p>{tr.infoLevelsDesc}</p>
          </div>

          <div className="achievement-info-section">
            <strong>{tr.infoAiInsight}</strong>
            <p>{tr.infoAiInsightDesc}</p>
          </div>

          <button className="achievement-info-dismiss-btn" onClick={() => setInfoOpen(false)}>
            {tr.gotIt}
          </button>
        </div>
      )}

      <div className="achievement-panel-profile">
        <div>{tr.level} <strong>{achievementProfile.level}</strong></div>
        <div>{tr.xp} <strong>{achievementProfile.totalXp}</strong></div>
        <div>{tr.unlocked} <strong>{achievementProfile.totalAchievements}</strong></div>
      </div>

      <div className="achievement-panel-goals-title">
        {tr.sessionGoals} ({completedGoals}/{achievementGoals.length})
      </div>
      <div className="achievement-panel-goals">
        {achievementGoals.length === 0 ? (
          <div className="achievement-goal-empty">{tr.startSessionToGenerate}</div>
        ) : achievementGoals.map((goal) => (
          <div key={goal.id} className={`achievement-goal ${goal.completed ? 'done' : ''}`}>
            <span>{tGoalTitle(lang, goal.id, goal.title)}</span>
            <span>{goal.current}/{goal.target}</span>
          </div>
        ))}
      </div>

      <button className="achievement-disable-btn" onClick={handleDisable}>
        {tr.turnOffAchievements}
      </button>
    </div>
  );
};
