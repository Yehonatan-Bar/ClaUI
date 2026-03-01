import React, { useState } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';

const LANGUAGE_OPTIONS = [
  'Hebrew', 'Arabic', 'Russian', 'Spanish', 'French',
  'German', 'Portuguese', 'Chinese', 'Japanese', 'Korean',
];

interface BabelFishPanelProps {
  onClose: () => void;
}

export const BabelFishPanel: React.FC<BabelFishPanelProps> = ({ onClose }) => {
  const babelFishEnabled = useAppStore((s) => s.babelFishEnabled);
  const translationLanguage = useAppStore((s) => s.translationLanguage);
  const [showInfo, setShowInfo] = useState(false);

  const handleToggle = () => {
    const next = !babelFishEnabled;
    postToExtension({ type: 'setBabelFishEnabled', enabled: next } as any);
  };

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    postToExtension({ type: 'setTranslationLanguage', language: e.target.value });
  };

  return (
    <div className="babel-fish-panel">
      <div className="babel-fish-header">
        <span className="babel-fish-title">Babel Fish</span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button
            className="babel-fish-info-btn"
            onClick={() => setShowInfo(!showInfo)}
            data-tooltip="What is Babel Fish?"
          >
            !
          </button>
          <button className="babel-fish-close" onClick={onClose}>
            {'\u00D7'}
          </button>
        </div>
      </div>

      {showInfo && (
        <div className="babel-fish-info-box">
          This feature adds a translation layer between you and Claude Code.
          Your prompts are translated to English before reaching Claude Code,
          and Claude Code's responses are translated back to your language.
        </div>
      )}

      <div className="babel-fish-toggle-row">
        <span>Enable Babel Fish</span>
        <button
          className={`vitals-info-toggle-btn ${babelFishEnabled ? 'on' : 'off'}`}
          onClick={handleToggle}
        >
          <span className="vitals-toggle-knob" />
        </button>
      </div>

      <div className="babel-fish-toggle-row">
        <span>Your Language</span>
        <select
          className="vitals-info-language-select"
          value={translationLanguage}
          onChange={handleLanguageChange}
        >
          {LANGUAGE_OPTIONS.map((lang) => (
            <option key={lang} value={lang}>{lang}</option>
          ))}
        </select>
      </div>

      <div className="babel-fish-status">
        <span className={`babel-fish-dot ${babelFishEnabled ? 'on' : 'off'}`} />
        {babelFishEnabled ? (
          <span>Active: Your prompts &#8594; English, Responses &#8594; {translationLanguage}</span>
        ) : (
          <span>Disabled</span>
        )}
      </div>
    </div>
  );
};
