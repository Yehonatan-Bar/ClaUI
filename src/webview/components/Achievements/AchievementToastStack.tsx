import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../../state/store';

const RARITY_CLASS: Record<string, string> = {
  common: 'achievement-toast-common',
  rare: 'achievement-toast-rare',
  epic: 'achievement-toast-epic',
  legendary: 'achievement-toast-legendary',
};

function playToastSound(rarity: string): void {
  const freqMap: Record<string, number> = {
    common: 520,
    rare: 640,
    epic: 780,
    legendary: 920,
  };
  const freq = freqMap[rarity] || 520;
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = 'triangle';
    gain.gain.value = 0.03;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    setTimeout(() => {
      osc.stop();
      void ctx.close();
    }, 80);
  } catch {
    // Audio can be blocked in webviews; silently ignore.
  }
}

export const AchievementToastStack: React.FC = () => {
  const { achievementToasts, achievementsSound, dismissAchievementToast } = useAppStore();
  const scheduled = useRef(new Set<string>());
  const sounded = useRef(new Set<string>());

  useEffect(() => {
    for (const toast of achievementToasts) {
      if (!scheduled.current.has(toast.toastId)) {
        scheduled.current.add(toast.toastId);
        setTimeout(() => {
          dismissAchievementToast(toast.toastId);
          scheduled.current.delete(toast.toastId);
          sounded.current.delete(toast.toastId);
        }, 5000);
      }
      if (achievementsSound && !sounded.current.has(toast.toastId)) {
        playToastSound(toast.rarity);
        sounded.current.add(toast.toastId);
      }
    }
  }, [achievementToasts, achievementsSound, dismissAchievementToast]);

  if (achievementToasts.length === 0) {
    return null;
  }

  return (
    <div className="achievement-toast-stack">
      {achievementToasts.map((toast) => (
        <div key={toast.toastId} className={`achievement-toast ${RARITY_CLASS[toast.rarity] || ''}`}>
          <div className="achievement-toast-main">
            <strong>{toast.title}</strong>
            <span>{toast.description}</span>
          </div>
          <div className="achievement-toast-meta">+{toast.xp} XP</div>
          <button
            className="achievement-toast-dismiss"
            onClick={() => dismissAchievementToast(toast.toastId)}
            title="Dismiss"
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
};
