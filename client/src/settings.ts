import type { Action } from './input';

export type DamageDisplay = 'all' | 'mine' | 'total';

export interface Settings {
  damageDisplay: DamageDisplay;
  sound: boolean;
  shake: boolean;
  keys: Partial<Record<Action, string[]>>;
  volume: { master: number; sfx: number; bgm: number };
  quality: 'high' | 'low';
}

const KEY = 'endless-garden.settings';
const DEFAULTS: Settings = {
  damageDisplay: 'all', sound: true, shake: true, keys: {},
  volume: { master: 0.8, sfx: 0.8, bgm: 0.5 }, quality: 'high',
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return { ...DEFAULTS, ...s, volume: { ...DEFAULTS.volume, ...(s.volume ?? {}) }, keys: s.keys ?? {} };
    }
  } catch { /* 保存できない環境では既定値 */ }
  return { ...DEFAULTS, volume: { ...DEFAULTS.volume }, keys: {} };
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* noop */ }
}
