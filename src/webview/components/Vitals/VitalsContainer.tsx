import React from 'react';
import { useAppStore } from '../../state/store';
import { WeatherWidget } from './WeatherWidget';

/**
 * Container for weather widget.
 * Returns null when vitals are disabled.
 * Note: SessionTimeline is rendered separately in the chat-area-wrapper.
 * Note: AdventureWidget is rendered independently in App.tsx (not gated by vitalsEnabled).
 */
export const VitalsContainer: React.FC = () => {
  const vitalsEnabled = useAppStore((s) => s.vitalsEnabled);
  const weather = useAppStore((s) => s.weather);

  if (!vitalsEnabled) return null;

  return <WeatherWidget weather={weather} />;
};
