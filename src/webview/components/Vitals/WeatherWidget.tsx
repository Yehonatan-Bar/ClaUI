import React from 'react';
import type { WeatherState, WeatherMood } from '../../state/store';

const WEATHER_LABELS: Record<WeatherMood, string> = {
  clear: 'Clear sky',
  'partly-sunny': 'Partly sunny',
  cloudy: 'Cloudy',
  rainy: 'Rainy',
  thunderstorm: 'Thunderstorm',
  rainbow: 'Rainbow',
  night: 'Idle',
  snowflake: 'Disconnected',
};

const WEATHER_SYMBOLS: Record<WeatherMood, string> = {
  clear: '\u2600',       // sun
  'partly-sunny': '\u26C5', // sun behind cloud
  cloudy: '\u2601',      // cloud
  rainy: '\uD83C\uDF27', // cloud with rain (using surrogate pair)
  thunderstorm: '\u26A1', // lightning
  rainbow: '\u2728',     // sparkles
  night: '\uD83C\uDF19', // crescent moon
  snowflake: '\u2744',   // snowflake
};

interface WeatherWidgetProps {
  weather: WeatherState;
}

export const WeatherWidget: React.FC<WeatherWidgetProps> = React.memo(
  ({ weather }) => {
    return (
      <div
        className="weather-widget"
        title={WEATHER_LABELS[weather.mood]}
      >
        <div className={`weather-icon weather-${weather.mood}`}>
          <span className="weather-symbol">{WEATHER_SYMBOLS[weather.mood]}</span>
          <div className={`weather-pulse weather-pulse-${weather.pulseRate}`} />
        </div>
      </div>
    );
  }
);
