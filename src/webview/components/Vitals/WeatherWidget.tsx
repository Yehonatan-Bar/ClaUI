import React, { useState, useCallback, useEffect, useRef } from 'react';
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

const WEATHER_DESCRIPTIONS: Record<WeatherMood, string> = {
  clear: 'Session flowing smoothly - efficient costs, steady pace, productive work.',
  'partly-sunny': 'Mostly good. Minor cost increase or slight slowdown detected.',
  cloudy: 'Some signals flagging - costs rising, pace slowing, or less productive turns.',
  rainy: 'Multiple concerns - cost spikes, slowing momentum, or errors appearing.',
  thunderstorm: 'Significant issues - high costs, stalling, errors, or circular work patterns.',
  rainbow: 'Recovery detected - session health improving after a rough patch.',
  night: 'Session is idle or no activity yet.',
  snowflake: 'Session is disconnected.',
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

const STORAGE_KEY = 'claui-weather-pos';

function loadPosition(): { top: number; left: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

function savePosition(top: number, left: number) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ top, left }));
  } catch { /* ignore */ }
}

export const WeatherWidget: React.FC<WeatherWidgetProps> = React.memo(
  ({ weather }) => {
    const [popoverOpen, setPopoverOpen] = useState(false);
    const widgetRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{
      startX: number; startY: number;
      startTop: number; startLeft: number;
      moved: boolean;
    } | null>(null);

    const saved = loadPosition();
    const [pos, setPos] = useState({ top: saved?.top ?? 28, left: saved?.left ?? 32 });

    const togglePopover = useCallback(() => {
      setPopoverOpen((prev) => !prev);
    }, []);

    // Close popover on outside click
    useEffect(() => {
      if (!popoverOpen) return;
      const handler = (e: MouseEvent) => {
        if (widgetRef.current && !widgetRef.current.contains(e.target as Node)) {
          setPopoverOpen(false);
        }
      };
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }, [popoverOpen]);

    // Drag handlers
    const onMouseDown = useCallback((e: React.MouseEvent) => {
      // Only left button
      if (e.button !== 0) return;
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startTop: pos.top,
        startLeft: pos.left,
        moved: false,
      };
      e.preventDefault();
    }, [pos]);

    useEffect(() => {
      const onMouseMove = (e: MouseEvent) => {
        const d = dragRef.current;
        if (!d) return;
        const dx = e.clientX - d.startX;
        const dy = e.clientY - d.startY;
        if (!d.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        d.moved = true;
        setPos({ top: d.startTop + dy, left: d.startLeft + dx });
      };
      const onMouseUp = () => {
        const d = dragRef.current;
        if (!d) return;
        if (d.moved) {
          setPos((cur) => { savePosition(cur.top, cur.left); return cur; });
        }
        dragRef.current = null;
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      return () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
    }, []);

    const handleClick = useCallback(() => {
      // Only toggle popover if we didn't just drag
      if (dragRef.current?.moved) return;
      togglePopover();
    }, [togglePopover]);

    return (
      <div
        className="weather-widget"
        ref={widgetRef}
        style={{ top: pos.top, left: pos.left }}
      >
        <div
          className={`weather-icon weather-${weather.mood}`}
          onMouseDown={onMouseDown}
          onClick={handleClick}
          title={WEATHER_LABELS[weather.mood]}
          style={{ cursor: dragRef.current?.moved ? 'grabbing' : 'grab' }}
        >
          <span className="weather-symbol">{WEATHER_SYMBOLS[weather.mood]}</span>
          <div className={`weather-pulse weather-pulse-${weather.pulseRate}`} />
        </div>
        {popoverOpen && (
          <div className="weather-popover">
            <div className="weather-popover-header">
              <span className="weather-popover-symbol">{WEATHER_SYMBOLS[weather.mood]}</span>
              <span className="weather-popover-title">{WEATHER_LABELS[weather.mood]}</span>
            </div>
            <div className="weather-popover-desc">
              {WEATHER_DESCRIPTIONS[weather.mood]}
            </div>
          </div>
        )}
      </div>
    );
  }
);
