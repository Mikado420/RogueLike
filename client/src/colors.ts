import type { Element, Rarity } from '../../shared/src/core';
import { CONTENT } from '../../shared/src/content';

export const hex = (s: string): number => parseInt(s.replace('#', ''), 16);

export const ELEMENT_COLOR: Record<Element, number> = {
  neutral: 0xffffff,
  fire: 0xff6a3d,
  water: 0x4ab3ff,
  wind: 0x6fe39a,
  earth: 0xd8a24a,
  light: 0xfff27a,
  dark: 0xb57dff,
};

export const rarityColor = (r: Rarity): string => CONTENT.rarities.defs[r].color;
export const rarityColorNum = (r: Rarity): number => hex(rarityColor(r));
export const statusColor = (id: string): number => hex(CONTENT.statuses[id]?.color ?? '#ffffff');

/** キャラクターの見た目の色（服・髪） */
export const BODY_COLORS = [0x3b6fd8, 0xd8453b, 0x3bb86a, 0x9a5ad8, 0xe0a02a, 0x4a4f5c];
export const HAIR_COLORS = [0x5a3a22, 0x1e1e24, 0xe8d27a, 0xc8462a, 0xe6e6ee, 0x6a8cff];
