import React from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';

const LANGUAGE_OPTIONS = [
  'Hebrew', 'Arabic', 'Russian', 'Spanish', 'French',
  'German', 'Portuguese', 'Chinese', 'Japanese', 'Korean',
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
            <span>Vertical minimap on the right side. Each segment = one Claude turn. Colors: green (success), red (error), blue (discussion), purple (code), orange (research), cyan (commands).</span>
          </div>
        </div>

        <div className="vitals-info-item">
          <span className="vitals-info-icon">{'\u275A'}</span>
          <div className="vitals-info-text">
            <strong>Intensity Borders</strong>
            <span>Colored left border on each message. Color = category, thickness = number of tools used.</span>
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
        <button
          className={`vitals-info-toggle-btn ${adventureEnabled ? 'on' : 'off'}`}
          onClick={handleAdventureToggle}
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
