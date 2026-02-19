import React, { useCallback } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';

/**
 * Dedicated button to switch the active session to Sonnet 4.6 immediately.
 * Hidden when the active model is already Sonnet 4.6 or when no session is active.
 */
export const SwitchToSonnetButton: React.FC = () => {
  const { model, isConnected, isBusy } = useAppStore();

  const handleClick = useCallback(() => {
    postToExtension({ type: 'switchToSonnet' });
  }, []);

  // Hide when not connected or already on Sonnet 4.6
  if (!isConnected) return null;
  if (model && model.includes('sonnet-4-6')) return null;

  return (
    <button
      className="switch-to-sonnet-btn"
      onClick={handleClick}
      disabled={isBusy}
      title={isBusy
        ? 'Wait for current response to finish before switching'
        : 'Switch active session to Sonnet 4.6 now'}
    >
      S
    </button>
  );
};
