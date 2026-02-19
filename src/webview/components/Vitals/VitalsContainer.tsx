import React from 'react';
import { useAppStore } from '../../state/store';
import { WeatherWidget } from './WeatherWidget';
import { CostHeatBar } from './CostHeatBar';

/**
 * Container for weather widget and cost heat bar.
 * Returns null when vitals are disabled.
 * Note: SessionTimeline is rendered separately in the chat-area-wrapper.
 */
export const VitalsContainer: React.FC = () => {
  const vitalsEnabled = useAppStore((s) => s.vitalsEnabled);
  const weather = useAppStore((s) => s.weather);
  const totalCostUsd = useAppStore((s) => s.cost.totalCostUsd);

  if (!vitalsEnabled) return null;

  return (
    <>
      <WeatherWidget weather={weather} />
      <CostHeatBar totalCostUsd={totalCostUsd} />
    </>
  );
};
