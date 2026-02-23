import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface TooltipState {
  text: string;
  x: number;
  y: number;
  visible: boolean;
  placement: 'top' | 'bottom';
}

interface GlobalTooltipProps {
  delay?: number;
}

const TOOLTIP_GAP = 6;
const VIEWPORT_MARGIN = 8;

function calculatePosition(
  triggerRect: DOMRect
): { x: number; y: number; placement: 'top' | 'bottom' } {
  // Initial: center above trigger
  const x = triggerRect.left + triggerRect.width / 2;
  let placement: 'top' | 'bottom' = 'top';
  let y = triggerRect.top - TOOLTIP_GAP;

  // If not enough space above, flip to bottom
  if (y < 40) {
    placement = 'bottom';
    y = triggerRect.bottom + TOOLTIP_GAP;
  }

  return { x, y, placement };
}

export const GlobalTooltip: React.FC<GlobalTooltipProps> = ({ delay = 400 }) => {
  const [state, setState] = useState<TooltipState>({
    text: '', x: 0, y: 0, visible: false, placement: 'top'
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hideTooltip = useCallback(() => {
    clearTimer();
    if (triggerRef.current) {
      triggerRef.current.removeAttribute('aria-describedby');
      triggerRef.current = null;
    }
    setState(prev => ({ ...prev, visible: false }));
  }, [clearTimer]);

  useEffect(() => {
    // Skip on touch devices
    if ('ontouchstart' in window && navigator.maxTouchPoints > 0) return;

    const handleMouseOver = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest?.('[data-tooltip]') as HTMLElement | null;
      if (!target) return;

      const text = target.getAttribute('data-tooltip');
      if (!text) return;

      // Same trigger - do nothing
      if (triggerRef.current === target && state.visible) return;

      clearTimer();

      // Clean up previous trigger
      if (triggerRef.current && triggerRef.current !== target) {
        triggerRef.current.removeAttribute('aria-describedby');
      }

      triggerRef.current = target;

      timerRef.current = setTimeout(() => {
        const rect = target.getBoundingClientRect();
        const pos = calculatePosition(rect);
        setState({ text, ...pos, visible: true });
        target.setAttribute('aria-describedby', 'claui-global-tooltip');
      }, delay);
    };

    const handleMouseOut = (e: MouseEvent) => {
      const relatedTarget = e.relatedTarget as HTMLElement | null;

      // If moving to a child of the same tooltip trigger, ignore
      if (relatedTarget && triggerRef.current?.contains(relatedTarget)) return;

      hideTooltip();
    };

    const handleScroll = () => {
      hideTooltip();
    };

    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('mouseout', handleMouseOut, true);
    document.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('mouseover', handleMouseOver, true);
      document.removeEventListener('mouseout', handleMouseOut, true);
      document.removeEventListener('scroll', handleScroll, true);
      clearTimer();
    };
  }, [delay, clearTimer, hideTooltip]);

  // Post-render position adjustment
  useEffect(() => {
    if (!state.visible || !tooltipRef.current || !triggerRef.current) return;

    const tooltip = tooltipRef.current;
    const tooltipRect = tooltip.getBoundingClientRect();
    const triggerRect = triggerRef.current.getBoundingClientRect();

    let adjustedX = state.x - tooltipRect.width / 2;
    let adjustedY = state.y;
    let adjustedPlacement = state.placement;

    // Horizontal clamp
    if (adjustedX + tooltipRect.width > window.innerWidth - VIEWPORT_MARGIN) {
      adjustedX = window.innerWidth - tooltipRect.width - VIEWPORT_MARGIN;
    }
    if (adjustedX < VIEWPORT_MARGIN) adjustedX = VIEWPORT_MARGIN;

    // Vertical flip if needed
    if (state.placement === 'top') {
      adjustedY = triggerRect.top - tooltipRect.height - TOOLTIP_GAP;
      if (adjustedY < VIEWPORT_MARGIN) {
        adjustedPlacement = 'bottom';
        adjustedY = triggerRect.bottom + TOOLTIP_GAP;
      }
    } else {
      if (adjustedY + tooltipRect.height > window.innerHeight - VIEWPORT_MARGIN) {
        adjustedPlacement = 'top';
        adjustedY = triggerRect.top - tooltipRect.height - TOOLTIP_GAP;
      }
    }

    // Apply adjustment via direct style to avoid re-render loop
    tooltip.style.left = `${adjustedX}px`;
    tooltip.style.top = `${adjustedY}px`;
    if (adjustedPlacement !== state.placement) {
      tooltip.classList.remove(`placement-${state.placement}`);
      tooltip.classList.add(`placement-${adjustedPlacement}`);
    }
  }, [state.visible, state.text]);

  return createPortal(
    <div
      ref={tooltipRef}
      id="claui-global-tooltip"
      className={`global-tooltip ${state.visible ? 'visible' : ''} placement-${state.placement}`}
      role="tooltip"
      style={{
        left: `${state.x}px`,
        top: `${state.y}px`,
      }}
    >
      {state.text}
    </div>,
    document.body
  );
};
