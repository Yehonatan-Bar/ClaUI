import React from 'react';
import type { PlanReality } from '../../../extension/types/workstreamTypes';

interface PlanOverlayLineProps {
  plan: PlanReality;
  pathD: string;
  strokeWidth?: number;
  onHover?: (hovering: boolean) => void;
  onClick?: () => void;
}

export const PlanOverlayLine: React.FC<PlanOverlayLineProps> = ({
  plan,
  pathD,
  strokeWidth = 3,
  onHover,
  onClick,
}) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'on_track':
        return '#86EFAC'; // Green
      case 'deviated':
        return '#FBBF24'; // Amber
      case 'blocked':
        return '#F87171'; // Red
      case 'completed':
        return '#34D399'; // Emerald
      default:
        return '#94A3B8'; // Slate
    }
  };

  const statusColor = getStatusColor(plan.overallStatus);

  return (
    <g
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      onClick={onClick}
      style={{ cursor: 'pointer' }}
    >
      {/* Plan path - thin, muted line as background */}
      <path
        d={pathD}
        fill="none"
        stroke="var(--vscode-foreground, #D4D4D4)"
        strokeWidth={strokeWidth * 0.5}
        opacity={0.3}
        strokeDasharray="4,4"
      />

      {/* Status indicator bar */}
      <path
        d={pathD}
        fill="none"
        stroke={statusColor}
        strokeWidth={strokeWidth * 0.3}
        opacity={0.6}
        strokeDasharray="0"
      />

      {/* Step markers along the path - positioned at key points */}
      {plan.steps.map((step, index) => {
        const progress = index / (plan.steps.length - 1);
        // Approximate position along path (simplified - would need full path calculation in production)
        const pathLength = 500; // Placeholder
        const x = progress * pathLength;

        const stepColor =
          step.status === 'completed'
            ? '#34D399'
            : step.status === 'failed'
              ? '#F87171'
              : step.status === 'pending'
                ? '#FBBF24'
                : '#94A3B8';

        return (
          <g key={step.id}>
            {/* Step marker circle */}
            <circle
              cx={x}
              cy={0}
              r={3}
              fill={stepColor}
              opacity={0.8}
            />

            {/* Status glow */}
            <circle
              cx={x}
              cy={0}
              r={5}
              fill="none"
              stroke={stepColor}
              strokeWidth={0.5}
              opacity={0.3}
            />
          </g>
        );
      })}

      {/* Tooltip */}
      <title>
        Plan: {plan.planLabel} | Status: {plan.overallStatus}
        {plan.deviationSummary && ` | ${plan.deviationSummary}`}
      </title>
    </g>
  );
};
