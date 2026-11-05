/**
 * ゲーム全体で使う基本の型（列挙・ステータスの種類・形）。
 * DOM や PixiJS に依存しない。サーバーでもそのまま使う。
 */

export type Element = 'neutral' | 'fire' | 'water' | 'wind' | 'earth' | 'light' | 'dark';
export const ELEMENTS: readonly Element[] = ['neutral', 'fire', 'water', 'wind', 'earth', 'light', 'dark'];

export type Rarity = 'common' | 'rare' | 'epic' | 'legend' | 'mythic';
export const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic', 'legend', 'mythic'];
export const rarityRank = (r: Rarity) => RARITIES.indexOf(r);

export type WeaponType =
  | 'oneHandSword' | 'twoHandSword' | 'dualSwords' | 'spear' | 'bow'
  | 'staff' | 'knuckles' | 'gun' | 'scythe' | 'instrument';
export const WEAPON_TYPES: readonly WeaponType[] = [
  'oneHandSword', 'twoHandSword', 'dualSwords', 'spear', 'bow', 'staff', 'knuckles', 'gun', 'scythe', 'instrument',
];

export type SubType = 'shield' | 'quiver' | 'grimoire' | 'dagger' | 'magazine' | 'talisman';
export type ArmorType = 'light' | 'heavy' | 'cloth';

export type EquipSlot = 'weapon' | 'sub' | 'body' | 'head' | 'accessory';
export const EQUIP_SLOTS: readonly EquipSlot[] = ['weapon', 'sub', 'body', 'head', 'accessory'];

export type DamageType = 'physical' | 'magic';
export type PrimaryStat = 'str' | 'int' | 'vit' | 'agi' | 'dex';
export const PRIMARY_STATS: readonly PrimaryStat[] = ['str', 'int', 'vit', 'agi', 'dex'];
export type PersonalStat = 'crt' | 'tec' | 'luk' | 'mtl';
export const PERSONAL_STATS: readonly PersonalStat[] = ['crt', 'tec', 'luk', 'mtl'];

export type Difficulty = 'normal' | 'hard' | 'nightmare' | 'ultimate';
export const DIFFICULTIES: readonly Difficulty[] = ['normal', 'hard', 'nightmare', 'ultimate'];

/**
 * 装備・スキル・料理・称号などが足し合わせる補正の種類。
 * 「Pct」は % 単位（10 = +10%）。critRate も % 単位。
 */
export const MOD_KEYS = [
  'str', 'int', 'vit', 'agi', 'dex',
  'atk', 'matk', 'def', 'mdef', 'maxHp', 'maxMp', 'maxSt',
  'atkPct', 'matkPct', 'defPct', 'mdefPct', 'maxHpPct', 'maxMpPct',
  'critRate', 'critDamage',
  'aspdPct', 'cspdPct', 'moveSpeedPct',
  'physDmgPct', 'magDmgPct', 'normalDmgPct', 'skillDmgPct', 'bossDmgPct',
  'fireDmgPct', 'waterDmgPct', 'windDmgPct', 'earthDmgPct', 'lightDmgPct', 'darkDmgPct',
  'fireResPct', 'waterResPct', 'windResPct', 'earthResPct', 'lightResPct', 'darkResPct',
  'lifestealPct', 'mpOnHit', 'hpRegen', 'mpRegen', 'healPct',
  'cooldownPct', 'mpCostPct', 'dodgeCostPct', 'staRegenPct',
  'breakPct', 'statusChancePct', 'statusResistPct',
  'dropRatePct', 'rareRatePct', 'goldPct', 'expPct', 'gatherPct',
  'dmgReductionPct', 'evasion', 'blockRate',
  'rangePct', 'chargePct', 'comboMax', 'magazine', 'reloadPct', 'rhythmPct', 'drainPct',
] as const;
export type ModKey = (typeof MOD_KEYS)[number];
export type Mods = Partial<Record<ModKey, number>>;

export function addMods(target: Mods, src: Mods | undefined, scale = 1): Mods {
  if (!src) return target;
  for (const k in src) {
    const key = k as ModKey;
    target[key] = (target[key] ?? 0) + (src[key] ?? 0) * scale;
  }
  return target;
}

export const ELEMENT_DMG_KEY: Record<Element, ModKey | null> = {
  neutral: null, fire: 'fireDmgPct', water: 'waterDmgPct', wind: 'windDmgPct',
  earth: 'earthDmgPct', light: 'lightDmgPct', dark: 'darkDmgPct',
};
export const ELEMENT_RES_KEY: Record<Element, ModKey | null> = {
  neutral: null, fire: 'fireResPct', water: 'waterResPct', wind: 'windResPct',
  earth: 'earthResPct', light: 'lightResPct', dark: 'darkResPct',
};

/** 攻撃範囲の形（ワールド座標・タイル単位） */
export type Shape =
  | { type: 'circle'; radius: number }
  | { type: 'arc'; range: number; arc: number }
  | { type: 'line'; range: number; width: number }
  | { type: 'ring'; inner: number; outer: number };

/** [Lv1 の値, 1レベルごとの増分] */
export type Scaled = number | [number, number];
export const scaled = (v: Scaled | undefined, level: number, fallback = 0): number => {
  if (v === undefined) return fallback;
  if (typeof v === 'number') return v;
  return v[0] + v[1] * (level - 1);
};

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
export const angleDiff = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};
