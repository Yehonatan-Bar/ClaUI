import React from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import { resetAdventureWidgetPosition } from './AdventureWidget';

const LANGUAGE_OPTIONS = [
  'Hebrew', 'Arabic', 'Russian', 'Spanish', 'French',
  'German', 'Portuguese', 'Chinese', 'Japanese', 'Korean',
];

const MODEL_OPTIONS = [
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku (fastest, cheapest)' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet (balanced)' },
  { value: 'claude-opus-4-6', label: 'Opus (most capable)' },
];

interface VitalsInfoPanelProps {
  onClose: () => void;
}

export const VitalsInfoPanel: React.FC<VitalsInfoPanelProps> = ({ onClose }) => {
  const vitalsEnabled = useAppStore((s) => s.vitalsEnabled);
  const setVitalsEnabled = useAppStore((s) => s.setVitalsEnabled);
  const adventureEnabled = useAppStore((s) => s.adventureEnabled);
  const setAdventureEnabled = useAppStore((s) => s.setAdventureEnabled);
  const translationLanguage = useAppStore((s) => s.translationLanguage);
  const setTranslationLanguage = useAppStore((s) => s.setTranslationLanguage);
  const turnAnalysisEnabled = useAppStore((s) => s.turnAnalysisEnabled);
  const analysisModel = useAppStore((s) => s.analysisModel);
  const skillGenEnabled = useAppStore((s) => s.skillGenEnabled);

  const handleToggle = () => {
    const next = !vitalsEnabled;
    setVitalsEnabled(next);
    postToExtension({ type: 'setVitalsEnabled', enabled: next });
  };

  const handleAdventureToggle = () => {
    const next = !adventureEnabled;
    setAdventureEnabled(next);
    postToExtension({ type: 'setAdventureWidgetEnabled', enabled: next });
  };

  const handleLanguageChange = (language: string) => {
    setTranslationLanguage(language);
    postToExtension({ type: 'setTranslationLanguage', language });
  };

  const handleTurnAnalysisToggle = () => {
    const next = !turnAnalysisEnabled;
    useAppStore.getState().setTurnAnalysisSettings({ enabled: next, analysisModel });
    postToExtension({ type: 'setTurnAnalysisEnabled', enabled: next });
  };

  const handleAnalysisModelChange = (model: string) => {
    useAppStore.getState().setTurnAnalysisSettings({ enabled: turnAnalysisEnabled, analysisModel: model });
    postToExtension({ type: 'setAnalysisModel', model });
  };

  const handleSkillGenToggle = () => {
    postToExtension({ type: 'setSkillGenEnabled', enabled: !skillGenEnabled });
  };

  return (
    <div className="vitals-info-panel">
      <div className="vitals-info-header">
        <span className="vitals-info-title">Session Vitals</span>
        <button className="vitals-info-close" onClick={onClose} title="Close">x</button>
      </div>

      <div className="vitals-info-items">
        <div className="vitals-info-item">
          <span className="vitals-info-icon">{'\u2600'}</span>
          <div className="vitals-info-text">
            <strong>Weather Icon</strong>
            <span>Shows session health based on recent error patterns. Clear sky = smooth, storms = many errors, rainbow = just recovered.</span>
          </div>
        </div>

        <div className="vitals-info-item">
          <span className="vitals-info-icon">{'\u2502'}</span>
          <div className="vitals-info-text">
            <strong>Timeline</strong>
            <span>
              Vertical minimap on the right side. Each segment = one completed Claude turn.
              <br />
              Green = success, Red = error/failure, Blue = discussion only (no tools).
              <br />
              Purple = code-write tools (Write/Edit/MultiEdit/NotebookEdit).
              <br />
              Orange = research tools (Read/Grep/Glob/WebSearch/WebFetch), Cyan = command tools (Bash/Terminal).
            </span>
          </div>
        </div>

        <div className="vitals-info-item">
          <span className="vitals-info-icon">{'\u275A'}</span>
          <div className="vitals-info-text">
            <strong>Intensity Borders</strong>
            <span>
              Left border on assistant messages uses the same category colors as the timeline.
              <br />
              Border width reflects tool activity in that turn:
              thin/light = 0 tools, medium = 1-3 tools, thick/strong = 4+ tools.
            </span>
          </div>
        </div>

        <div className="vitals-info-item">
          <span className="vitals-info-icon">{'\u2694'}</span>
          <div className="vitals-info-text">
            <strong>Adventure Widget</strong>
            <span>Pixel-art dungeon crawler. Each turn = a room: scrolls (read), anvils (edit), traps (errors), dragons (3+ errors), treasure (recovery).</span>
          </div>
        </div>
      </div>

      <div className="vitals-info-toggle-row" style={{ marginBottom: 6 }}>
        <span>Translate to</span>
        <select
          className="vitals-info-language-select"
          value={translationLanguage}
          onChange={(e) => handleLanguageChange(e.target.value)}
        >
          {LANGUAGE_OPTIONS.map((lang) => (
            <option key={lang} value={lang}>{lang}</option>
          ))}
        </select>
      </div>

      <div className="vitals-info-toggle-row" style={{ marginBottom: 6 }}>
        <span>Adventure Widget</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {adventureEnabled && (
            <button
              className="vitals-info-close"
              onClick={() => { resetAdventureWidgetPosition(); }}
              title="Reset widget position to default"
              style={{ fontSize: 10, padding: '0 4px', lineHeight: '16px' }}
            >
              Reset
            </button>
          )}
          <button
            className={`vitals-info-toggle-btn ${adventureEnabled ? 'on' : 'off'}`}
            onClick={handleAdventureToggle}
          >
            <span className="vitals-toggle-knob" />
          </button>
        </div>
      </div>

      <div className="vitals-info-toggle-row" style={{ marginBottom: 6 }}>
        <span>Semantic Analysis</span>
        <button
          className={`vitals-info-toggle-btn ${turnAnalysisEnabled ? 'on' : 'off'}`}
          onClick={handleTurnAnalysisToggle}
        >
          <span className="vitals-toggle-knob" />
        </button>
      </div>

      <div className="vitals-info-toggle-row" style={{ marginBottom: 6 }}>
        <span>Analysis Model</span>
        <select
          className="vitals-info-language-select"
          value={analysisModel}
          onChange={(e) => handleAnalysisModelChange(e.target.value)}
        >
          {MODEL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="vitals-info-toggle-row" style={{ marginBottom: 6 }}>
        <span>Skill Generation</span>
        <button
          className={`vitals-info-toggle-btn ${skillGenEnabled ? 'on' : 'off'}`}
          onClick={handleSkillGenToggle}
        >
          <span className="vitals-toggle-knob" />
        </button>
      </div>

      <div className="vitals-info-toggle-row">
        <span>Show Vitals</span>
        <button
          className={`vitals-info-toggle-btn ${vitalsEnabled ? 'on' : 'off'}`}
          onClick={handleToggle}
        >
          <span className="vitals-toggle-knob" />
        </button>
      </div>
    </div>
  );
};
