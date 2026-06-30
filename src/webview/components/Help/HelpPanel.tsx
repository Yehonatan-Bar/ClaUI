import React, { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../state/store';
import { HELP_SECTIONS, HELP_ENTRIES, HelpLang } from './helpContent';

/** UI chrome strings for each language (the entry content itself comes from helpContent). */
const UI_TEXT: Record<HelpLang, {
  title: string;
  intro: string;
  search: string;
  results: (n: number) => string;
  empty: string;
  close: string;
  langLabel: string;
}> = {
  en: {
    title: 'ClaUi Help — Buttons & Commands',
    intro: 'Hover any button in ClaUi for a short tooltip. This is the full reference — search by name or keyword.',
    search: 'Search a button or command...',
    results: (n) => `${n} result${n === 1 ? '' : 's'}`,
    empty: 'No matching buttons or commands.',
    close: 'Close',
    langLabel: 'Language',
  },
  he: {
    title: 'עזרה ל-ClaUi — כפתורים ופקודות',
    intro: 'רחף מעל כל כפתור ב-ClaUi לקבלת tooltip קצר. זהו המדריך המלא — חפש לפי שם או מילת מפתח.',
    search: 'חיפוש כפתור או פקודה...',
    results: (n) => `${n} תוצאות`,
    empty: 'לא נמצאו כפתורים או פקודות תואמים.',
    close: 'סגור',
    langLabel: 'שפה',
  },
};

/**
 * In-app Help panel: a searchable, bilingual reference of every ClaUi button and
 * command. Opened from the "?" button in the Status Bar. Content is sourced from
 * helpContent.ts (generated from UI_BUTTONS_AND_COMMANDS.md). Search matches across
 * both languages; the language toggle only changes which detail text is shown.
 */
export const HelpPanel: React.FC = () => {
  const setHelpPanelOpen = useAppStore((s) => s.setHelpPanelOpen);
  const [lang, setLang] = useState<HelpLang>('he');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setHelpPanelOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setHelpPanelOpen]);

  const t = UI_TEXT[lang];
  const isRtl = lang === 'he';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return HELP_ENTRIES;
    return HELP_ENTRIES.filter((e) =>
      e.name.toLowerCase().includes(q) ||
      (e.tooltip ? e.tooltip.toLowerCase().includes(q) : false) ||
      e.detailEn.toLowerCase().includes(q) ||
      e.detailHe.toLowerCase().includes(q)
    );
  }, [query]);

  const grouped = useMemo(
    () =>
      HELP_SECTIONS
        .map((sec) => ({ sec, entries: filtered.filter((e) => e.section === sec.key) }))
        .filter((g) => g.entries.length > 0),
    [filtered]
  );

  return (
    <div className="help-panel-overlay" onMouseDown={() => setHelpPanelOpen(false)}>
      <div
        className="help-panel"
        dir={isRtl ? 'rtl' : 'ltr'}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="help-panel-header">
          <span className="help-panel-title">{t.title}</span>
          <div className="help-panel-header-actions">
            <div className="help-lang-toggle" role="group" aria-label={t.langLabel}>
              <button
                className={`help-lang-btn ${lang === 'he' ? 'active' : ''}`}
                onClick={() => setLang('he')}
                data-tooltip="הצג בעברית"
                aria-pressed={lang === 'he'}
              >
                עברית
              </button>
              <button
                className={`help-lang-btn ${lang === 'en' ? 'active' : ''}`}
                onClick={() => setLang('en')}
                data-tooltip="Show in English"
                aria-pressed={lang === 'en'}
              >
                EN
              </button>
            </div>
            <button
              className="help-panel-close"
              onClick={() => setHelpPanelOpen(false)}
              data-tooltip={t.close}
              aria-label={t.close}
            >
              {'✕'}
            </button>
          </div>
        </div>

        <div className="help-panel-intro">{t.intro}</div>

        <div className="help-search-row">
          <input
            className="help-search-input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.search}
            autoFocus
            dir="auto"
          />
          <span className="help-results-count">{t.results(filtered.length)}</span>
        </div>

        <div className="help-panel-body">
          {grouped.length === 0 ? (
            <div className="help-empty">{t.empty}</div>
          ) : (
            grouped.map(({ sec, entries }) => (
              <div key={sec.key} className="help-section">
                <div className="help-section-title">
                  {(isRtl ? sec.titleHe : sec.titleEn)} ({entries.length})
                </div>
                {entries.map((entry) => (
                  <div key={entry.id} className="help-entry">
                    <div className="help-entry-name" dir="ltr">{entry.name}</div>
                    {entry.tooltip && (
                      <div className="help-entry-tooltip" dir="ltr">{entry.tooltip}</div>
                    )}
                    <div className="help-entry-detail">
                      {isRtl ? entry.detailHe : entry.detailEn}
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
