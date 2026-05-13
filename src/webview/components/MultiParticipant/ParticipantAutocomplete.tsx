import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useAppStore } from '../../state/store';
import { getParticipantColor, KIND_BADGE_COLORS } from './mpColors';

interface ParticipantAutocompleteProps {
  /** Current input text value */
  inputValue: string;
  /** Callback to replace text when user accepts a suggestion */
  onAccept: (newValue: string) => void;
  /** Position anchor: the input element ref for positioning */
  anchorRef: React.RefObject<HTMLElement | null>;
}

/**
 * Participant autocomplete dropdown for multi-participant sessions.
 *
 * When the user types a character matching a participant's routeKey,
 * shows a dropdown suggestion above the input. Tab/Enter accepts the
 * suggestion and replaces with "ParticipantName: ".
 *
 * Reads from store's mpParticipants.
 */
export const ParticipantAutocomplete: React.FC<ParticipantAutocompleteProps> = ({
  inputValue,
  onAccept,
  anchorRef,
}) => {
  const participants = useAppStore((s) => s.mpParticipants);
  const myHumanId = useAppStore((s) => s.mpMyHumanId);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Compute suggestions: match routeKey prefix against what user typed
  // Only trigger when input starts with a character that matches a routeKey
  const suggestions = useMemo(() => {
    if (!inputValue || inputValue.length === 0) return [];

    // Don't show suggestions if text already has accepted format "Name: ..."
    const acceptedPattern = /^[^\s:]+:\s/;
    if (acceptedPattern.test(inputValue)) return [];

    // Find the "prefix" - everything before the first space or colon
    const prefixMatch = inputValue.match(/^([^\s:]+)/);
    if (!prefixMatch) return [];
    const prefix = prefixMatch[1].toLowerCase();

    // Match against participants (exclude self)
    return participants
      .filter((p) => {
        if (p.participantId === myHumanId) return false;
        const routeKey = (p.routeKey ?? '').toLowerCase();
        const displayName = p.displayName.toLowerCase();
        return (
          (routeKey && routeKey.startsWith(prefix)) ||
          displayName.startsWith(prefix)
        );
      })
      .slice(0, 8); // Max 8 suggestions
  }, [inputValue, participants, myHumanId]);

  // Reset selection when suggestions change
  useEffect(() => {
    setSelectedIndex(0);
  }, [suggestions.length]);

  // Accept a suggestion
  const acceptSuggestion = useCallback(
    (index: number) => {
      const participant = suggestions[index];
      if (!participant) return;

      // Replace the prefix with "DisplayName: "
      const prefixMatch = inputValue.match(/^([^\s:]+)/);
      const prefixLen = prefixMatch ? prefixMatch[1].length : 0;
      const rest = inputValue.slice(prefixLen);
      const newValue = `${participant.displayName}: ${rest.replace(/^[\s:]*/, '')}`;
      onAccept(newValue);
    },
    [suggestions, inputValue, onAccept]
  );

  // Handle keyboard events (Tab, Enter, ArrowUp, ArrowDown, Escape)
  useEffect(() => {
    if (suggestions.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab' || e.key === 'Enter') {
        if (suggestions.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          acceptSuggestion(selectedIndex);
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev <= 0 ? suggestions.length - 1 : prev - 1
        );
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev >= suggestions.length - 1 ? 0 : prev + 1
        );
      } else if (e.key === 'Escape') {
        // The parent will handle clearing if needed
      }
    };

    const anchor = anchorRef.current;
    if (anchor) {
      anchor.addEventListener('keydown', handleKeyDown, true);
      return () => anchor.removeEventListener('keydown', handleKeyDown, true);
    }
  }, [suggestions, selectedIndex, acceptSuggestion, anchorRef]);

  if (suggestions.length === 0) return null;

  return (
    <div
      ref={listRef}
      style={{
        position: 'absolute',
        bottom: '100%',
        left: 0,
        right: 0,
        marginBottom: 4,
        backgroundColor: 'var(--vscode-dropdown-background, #1e1e1e)',
        border: '1px solid var(--vscode-dropdown-border, #30363d)',
        borderRadius: 6,
        overflow: 'hidden',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        zIndex: 100,
      }}
      role="listbox"
    >
      {suggestions.map((participant, index) => {
        const color = getParticipantColor(participant.participantId);
        const kindColor = KIND_BADGE_COLORS[participant.kind] ?? '#8b949e';
        const isSelected = index === selectedIndex;

        return (
          <div
            key={participant.participantId}
            role="option"
            aria-selected={isSelected}
            onClick={() => acceptSuggestion(index)}
            onMouseEnter={() => setSelectedIndex(index)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              cursor: 'pointer',
              backgroundColor: isSelected
                ? 'var(--vscode-list-activeSelectionBackground, rgba(88, 166, 255, 0.1))'
                : 'transparent',
            }}
          >
            {/* Color dot */}
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: color,
                flexShrink: 0,
              }}
            />

            {/* Display name */}
            <span
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--vscode-editor-foreground, #e6edf3)',
              }}
            >
              {participant.displayName}
            </span>

            {/* Route key */}
            {participant.routeKey && (
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--vscode-descriptionForeground, #8b949e)',
                  fontFamily: 'var(--vscode-editor-font-family, monospace)',
                }}
              >
                @{participant.routeKey}
              </span>
            )}

            {/* Kind badge */}
            <span
              style={{
                fontSize: 10,
                padding: '1px 4px',
                borderRadius: 3,
                backgroundColor: `${kindColor}22`,
                color: kindColor,
                marginInlineStart: 'auto',
                textTransform: 'capitalize',
              }}
            >
              {participant.kind}
            </span>
          </div>
        );
      })}

      {/* Hint */}
      <div
        style={{
          padding: '4px 10px',
          fontSize: 10,
          color: 'var(--vscode-descriptionForeground, #6e7681)',
          borderTop: '1px solid var(--vscode-dropdown-border, #30363d)',
        }}
      >
        Tab or Enter to accept
      </div>
    </div>
  );
};
