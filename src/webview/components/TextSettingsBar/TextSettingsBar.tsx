import React, { useState, useCallback } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import type { TypingTheme, MessageColorScheme } from '../../../extension/types/webview-messages';

/** Font presets that work well for both Hebrew and English */
const FONT_PRESETS = [
  { label: 'Default (VS Code)', value: '' },
  { label: 'Segoe UI', value: "'Segoe UI', sans-serif" },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'David', value: "David, 'David Libre', serif" },
  { label: 'Tahoma', value: 'Tahoma, sans-serif' },
  { label: 'Consolas', value: "Consolas, 'Courier New', monospace" },
  { label: 'Calibri', value: 'Calibri, sans-serif' },
];

const THEME_PRESETS: Array<{ label: string; value: TypingTheme }> = [
  { label: 'Terminal Hacker', value: 'terminal-hacker' },
  { label: 'Retro', value: 'retro' },
  { label: 'Zen', value: 'zen' },
  { label: 'Neo Zen', value: 'neo-zen' },
  { label: 'Clarity', value: 'clarity' },
];

const MESSAGE_COLOR_PRESETS: Array<{ label: string; value: MessageColorScheme }> = [
  { label: 'Blue / Violet (default)', value: 'default' },
  { label: 'Ocean (Teal / Indigo)', value: 'ocean' },
  { label: 'Sunset (Amber / Rose)', value: 'sunset' },
  { label: 'Mono (subtle)', value: 'mono' },
  { label: 'Off (no colors)', value: 'off' },
];

/**
 * Compact settings bar for adjusting chat text font size, family, and theme.
 * Appears as a toggleable panel in the status bar area.
 */
export const TextSettingsBar: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { textSettings, typingTheme, messageColorScheme, setTextSettings, setTypingTheme, setMessageColorScheme } = useAppStore();

  const changeFontSize = useCallback((delta: number) => {
    const newSize = Math.max(10, Math.min(32, textSettings.fontSize + delta));
    setTextSettings({ fontSize: newSize });
  }, [textSettings.fontSize, setTextSettings]);

  const changeFontFamily = useCallback((value: string) => {
    setTextSettings({ fontFamily: value });
  }, [setTextSettings]);

  const changeTheme = useCallback((theme: TypingTheme) => {
    setTypingTheme(theme);
    postToExtension({ type: 'setTypingTheme', theme });
  }, [setTypingTheme]);

  const changeMessageColorScheme = useCallback((scheme: MessageColorScheme) => {
    setMessageColorScheme(scheme);
    postToExtension({ type: 'setMessageColorScheme', scheme });
  }, [setMessageColorScheme]);

  if (!isOpen) {
    return (
      <button
        className="text-settings-toggle"
        onClick={() => setIsOpen(true)}
        data-tooltip="Text display settings"
      >
        Aa
      </button>
    );
  }

  return (
    <div className="text-settings-panel">
      <div className="text-settings-row">
        <span className="text-settings-label">Size</span>
        <button
          className="text-settings-btn"
          onClick={() => changeFontSize(-1)}
          disabled={textSettings.fontSize <= 10}
          data-tooltip="Decrease font size"
        >
          -
        </button>
        <span className="text-settings-value">{textSettings.fontSize}px</span>
        <button
          className="text-settings-btn"
          onClick={() => changeFontSize(1)}
          disabled={textSettings.fontSize >= 32}
          data-tooltip="Increase font size"
        >
          +
        </button>
      </div>
      <div className="text-settings-row">
        <span className="text-settings-label">Font</span>
        <select
          className="text-settings-select"
          value={textSettings.fontFamily}
          onChange={(e) => changeFontFamily(e.target.value)}
        >
          {FONT_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>
      </div>
      <div className="text-settings-row">
        <span className="text-settings-label">Theme</span>
        <select
          className="text-settings-select"
          value={typingTheme}
          onChange={(e) => changeTheme(e.target.value as TypingTheme)}
        >
          {THEME_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>
      </div>
      <div className="text-settings-row">
        <span className="text-settings-label" data-tooltip="Background colors for chat messages (your prompt vs the system's reply/thinking). Choose a palette or turn it off.">Message colors</span>
        <select
          className="text-settings-select"
          value={messageColorScheme}
          onChange={(e) => changeMessageColorScheme(e.target.value as MessageColorScheme)}
        >
          {MESSAGE_COLOR_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>
      </div>
      <button
        className="text-settings-btn text-settings-close"
        onClick={() => setIsOpen(false)}
        data-tooltip="Close settings"
      >
        x
      </button>
    </div>
  );
};
