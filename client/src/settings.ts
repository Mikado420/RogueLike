export type DamageDisplay = 'all' | 'mine' | 'total';

export interface Settings {
  damageDisplay: DamageDisplay;
  sound: boolean;
  shake: boolean;
}

const KEY = 'endless-garden.settings';
const DEFAULTS: Settings = { damageDisplay: 'all', sound: true, shake: true };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* 保存できない環境では既定値 */ }
  return { ...DEFAULTS };
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* noop */ }
}
