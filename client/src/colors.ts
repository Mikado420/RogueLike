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

/** キャラクターの見た目の色（服・髪）。data/looks.json */
export const BODY_COLORS = CONTENT.looks.bodyColors.map(hex);
export const HAIR_COLORS = CONTENT.looks.hairColors.map(hex);
export const TIER_COLORS = CONTENT.looks.tierColors.map(hex);

/** 見た目 id（"heavy:3" など）→ 種類と色 */
export function lookInfo(look: string | null | undefined): { kind: string; color: number; name: string } | null {
  if (!look) return null;
  const [key, tier] = look.split(':');
  const t = Number(tier) || 0;
  const tierDef = CONTENT.equipment.tiers[t];
  return { kind: key, color: TIER_COLORS[t] ?? 0xffffff, name: `${tierDef?.prefix ?? ''}${CONTENT.looks.names[key] ?? key}` };
}
