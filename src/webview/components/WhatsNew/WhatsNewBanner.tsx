import React from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';

/**
 * In-panel "What's New" banner.
 *
 * Renders the bundled release highlights pushed by the extension after an
 * update (or on the "ClaUi: What's New" command). Dismiss is optimistic: the
 * banner disappears immediately here, and the extension persists the dismissal
 * and re-broadcasts the empty state to every other tab.
 */
export const WhatsNewBanner: React.FC = () => {
  const items = useAppStore((s) => s.whatsNewItems);
  const version = useAppStore((s) => s.whatsNewVersion);
  const setWhatsNewState = useAppStore((s) => s.setWhatsNewState);

  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const handleDismiss = () => {
    setWhatsNewState([], version);
    postToExtension({ type: 'whatsNewDismiss' });
  };

  const handleOpenChangelog = () => {
    postToExtension({ type: 'whatsNewOpenChangelog' });
  };

  return (
    <div className="whats-new-banner" role="status" aria-live="polite">
      <div className="whats-new-content">
        <div className="whats-new-header">
          <div className="whats-new-eyebrow">
            {version ? `What's new in ClaUi ${version}` : "What's new in ClaUi"}
          </div>
          <button
            className="whats-new-close"
            onClick={handleDismiss}
            data-tooltip="Dismiss"
            aria-label="Dismiss"
          >
            x
          </button>
        </div>

        {items.map((item) => {
          const hebrewHighlights = Array.isArray(item.highlightsHe) ? item.highlightsHe : [];
          const hasHebrew = Boolean(item.titleHe) || hebrewHighlights.length > 0;
          return (
            <div key={item.id} className="whats-new-item">
              {/* English block first */}
              <div className="whats-new-title" dir="auto">{item.title}</div>
              {Array.isArray(item.highlights) && item.highlights.length > 0 && (
                <ul className="whats-new-highlights">
                  {item.highlights.map((highlight, index) => (
                    <li key={index} dir="auto">{highlight}</li>
                  ))}
                </ul>
              )}
              {/* Hebrew block below, right-to-left */}
              {hasHebrew && (
                <div className="whats-new-item-he" dir="rtl" lang="he">
                  {item.titleHe && <div className="whats-new-title">{item.titleHe}</div>}
                  {hebrewHighlights.length > 0 && (
                    <ul className="whats-new-highlights">
                      {hebrewHighlights.map((highlight, index) => (
                        <li key={index}>{highlight}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })}

        <div className="whats-new-actions">
          <button
            className="setup-notice-btn primary"
            onClick={handleOpenChangelog}
            data-tooltip="Open the full ClaUi changelog"
          >
            Full changelog
          </button>
          <button
            className="setup-notice-btn ghost"
            onClick={handleDismiss}
            data-tooltip="Hide this banner in all tabs"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};
