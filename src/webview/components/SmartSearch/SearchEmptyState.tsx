import React from 'react';

/**
 * Empty-state hero shown in a Smart Search tab before the first user query.
 * Lists example queries to nudge the user.
 */
export const SearchEmptyState: React.FC<{ onPickExample: (example: string) => void }> = ({ onPickExample }) => {
  const examples = [
    'sessions where I worked on auth',
    "yesterday's failed builds",
    'find when I asked about Hebrew RTL',
    'show me the session about IIS deployment',
  ];

  return (
    <div className="smart-search-empty-state">
      <div className="smart-search-empty-title">Smart Search</div>
      <div className="smart-search-empty-subtitle">
        Searching transcripts in <code>~/.claude</code> + <code>~/.codex</code>
      </div>
      <div className="smart-search-empty-tryline">Try one of these:</div>
      <ul className="smart-search-empty-list">
        {examples.map((ex) => (
          <li key={ex}>
            <button
              type="button"
              className="smart-search-example-btn"
              onClick={() => onPickExample(ex)}
              data-tooltip={`Use example: ${ex}`}
            >
              {ex}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
