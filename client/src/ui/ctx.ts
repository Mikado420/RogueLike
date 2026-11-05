import { CONTENT, txt, type Command, type ModKey, type Player, type World } from '../../../shared/src';
import type { Settings } from '../settings';
import type { Sfx } from '../audio';
import type { Modal } from './modal';
import type { Hud } from '../hud';

/** UI から使う共通の窓口 */
export interface Ctx {
  world: World;
  myId: number;
  me(): Player;
  send(cmd: Command): void;
  settings: Settings;
  saveSettings(): void;
  sfx: Sfx;
  modal: Modal;
  hud: Hud;
}

const PCT_KEYS = new Set<string>(['critRate', 'critDamage', 'lifestealPct', 'evasion', 'blockRate']);

/** 補正の名前と単位（data/options.json と data/text.json から） */
export function modLabel(key: ModKey): { label: string; unit: string } {
  const od = CONTENT.options.pool.find((o) => o.key === key);
  const label = CONTENT.text[`mod.${key}`] ?? od?.label ?? key;
  const unit = od?.unit ?? (key.endsWith('Pct') || PCT_KEYS.has(key) ? '%' : '');
  return { label, unit };
}

export function modText(key: ModKey, v: number): string {
  const { label, unit } = modLabel(key);
  const n = Math.round(v * 10) / 10;
  return `${label} ${n > 0 ? '+' : ''}${n}${unit}`;
}

export const elName = (e: string) => txt(`el.${e}`);
