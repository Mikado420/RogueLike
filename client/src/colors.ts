import type { Element, Rarity } from '../../shared/src/types';
import { CONTENT } from '../../shared/src/content';

export const ELEMENT_COLOR: Record<Element, number> = {
  neutral: 0xffffff,
  fire: 0xff6a3d,
  water: 0x4ab3ff,
  wind: 0x6fe39a,
  earth: 0xd8a24a,
  light: 0xfff27a,
  dark: 0xb57dff,
};

export const ELEMENT_NAME: Record<Element, string> = {
  neutral: '無', fire: '火', water: '水', wind: '風', earth: '地', light: '光', dark: '闇',
};

export const rarityColor = (r: Rarity): string => CONTENT.rarities.defs[r].color;
export const rarityColorNum = (r: Rarity): number => parseInt(rarityColor(r).slice(1), 16);
