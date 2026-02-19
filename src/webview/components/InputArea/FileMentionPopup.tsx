import React, { useRef, useEffect } from 'react';

export interface FileSearchResult {
  relativePath: string;
  fileName: string;
}

interface FileMentionPopupProps {
  results: FileSearchResult[];
  selectedIndex: number;
  onSelect: (path: string) => void;
  isLoading: boolean;
}

export const FileMentionPopup: React.FC<FileMentionPopupProps> = ({
  results,
  selectedIndex,
  onSelect,
  isLoading,
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll selected item into view
  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (isLoading && results.length === 0) {
    return (
      <div className="file-mention-popup">
        <div className="file-mention-loading">Searching...</div>
      </div>
    );
  }

  if (!isLoading && results.length === 0) {
    return (
      <div className="file-mention-popup">
        <div className="file-mention-empty">No files found</div>
      </div>
    );
  }

  return (
    <div className="file-mention-popup" ref={listRef}>
      {results.map((result, index) => (
        <button
          key={result.relativePath}
          ref={index === selectedIndex ? selectedRef : undefined}
          className={`file-mention-item${index === selectedIndex ? ' selected' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault(); // Prevent textarea blur
            onSelect(result.relativePath);
          }}
        >
          <span className="file-mention-item-name">{result.fileName}</span>
          <span className="file-mention-item-path">{result.relativePath}</span>
        </button>
      ))}
    </div>
  );
};
