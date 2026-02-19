import React from 'react';
import { useAppStore } from '../../state/store';
import { WeatherWidget } from './WeatherWidget';
import { AdventureWidget } from './AdventureWidget';

/**
 * Container for weather widget and adventure widget.
 * Returns null when vitals are disabled.
 * Note: SessionTimeline is rendered separately in the chat-area-wrapper.
 */
export const VitalsContainer: React.FC = () => {
  const vitalsEnabled = useAppStore((s) => s.vitalsEnabled);
  const adventureEnabled = useAppStore((s) => s.adventureEnabled);
  const weather = useAppStore((s) => s.weather);

  if (!vitalsEnabled) return null;

  return (
    <>
      <WeatherWidget weather={weather} />
      {adventureEnabled && <AdventureWidget />}
    </>
  );
};
