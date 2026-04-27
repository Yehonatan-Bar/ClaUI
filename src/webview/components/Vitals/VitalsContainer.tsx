import React from 'react';
import { useAppStore } from '../../state/store';
import { WeatherWidget } from './WeatherWidget';

/**
 * Renders the floating WeatherWidget when its independent toggle is on.
 * SessionTimeline and intensity borders are gated by vitalsEnabled in App.tsx.
 * AdventureWidget is rendered independently in App.tsx with its own flag.
 */
export const VitalsContainer: React.FC = () => {
  const weatherWidgetEnabled = useAppStore((s) => s.weatherWidgetEnabled);
  const weather = useAppStore((s) => s.weather);

  if (!weatherWidgetEnabled) return null;

  return <WeatherWidget weather={weather} />;
};
