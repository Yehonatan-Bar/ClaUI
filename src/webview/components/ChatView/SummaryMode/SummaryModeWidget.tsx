import React from 'react';
import { useAppStore } from '../../../state/store';
import { SummaryModeDisplay } from './SummaryModeDisplay';

/**
 * Full-height side panel for Summary Mode animation.
 * Rendered as a sibling of MessageList inside the chat-area-wrapper
 * when summary mode is enabled. Takes 50% width, full height.
 */
export const SummaryModeWidget: React.FC = () => {
  const animationIndex = useAppStore((s) => s.sessionAnimationIndex);
  const toolCount = useAppStore((s) => s.sessionToolCount);
  const isBusy = useAppStore((s) => s.isBusy);

  return (
    <div className="sm-side-panel">
      <SummaryModeDisplay
        animationIndex={animationIndex}
        toolCount={toolCount}
        isComplete={!isBusy}
      />
    </div>
  );
};
