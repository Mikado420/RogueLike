export type Element = 'neutral' | 'fire' | 'water' | 'wind' | 'earth' | 'light' | 'dark';
export const ELEMENTS: readonly Element[] = ['neutral', 'fire', 'water', 'wind', 'earth', 'light', 'dark'];

export type Rarity = 'common' | 'rare' | 'epic' | 'legend' | 'mythic';
export type WeaponType =
  | 'oneHandSword' | 'twoHandSword' | 'dualSwords' | 'spear' | 'bow'
  | 'staff' | 'knuckles' | 'gun' | 'scythe' | 'instrument';
export type DamageType = 'physical' | 'magic';
export type PrimaryStat = 'str' | 'int' | 'vit' | 'agi' | 'dex';
export type PersonalStat = 'crt' | 'tec' | 'luk' | 'mtl';

export interface BaseStats {
  str: number; int: number; vit: number; agi: number; dex: number;
  personal: { type: PersonalStat; value: number };
}

/** 戦闘で使う最終的な数値 */
export interface CombatStats {
  atk: number; matk: number; def: number; mdef: number;
  critRate: number; critDamage: number;
  maxHp: number; element: Element;
  moveSpeed: number; attackSpeed: number;
}

export type Shape =
  | { type: 'circle'; radius: number }
  | { type: 'arc'; range: number; arc: number };

export interface ProjectileDef {
  count: number; spread: number; speed: number; range: number; radius: number;
  pierce: number; explodeRadius?: number; sprite: string;
}

/** 攻撃1回ぶんの定義（通常攻撃・スキル・モンスターの技で共通） */
export interface AttackDef {
  delivery: 'strike' | 'projectile';
  power: number;
  element?: Element | 'weapon';
  damageType?: DamageType;
  /** strike: 発生位置 */
  anchor?: 'self' | 'aim' | 'target';
  aimDistance?: number;
  follow?: boolean;
  shape?: Shape;
  delay?: number;
  hits?: number;
  interval?: number;
  count?: number;
  scatter?: number;
  telegraph?: boolean;
  projectile?: ProjectileDef;
  /** 硬直（秒） */
  lock?: number;
  /** 届く距離の目安（秒ではなくタイル） */
  range?: number;
}

export interface WeaponAttackDef extends AttackDef { interval: number; mpGain: number }

export interface WeaponTypeDef {
  name: string;
  implemented: boolean;
  damageType?: DamageType;
  scaling?: { atk: Partial<Record<PrimaryStat, number>>; matk: Partial<Record<PrimaryStat, number>> };
  attack?: WeaponAttackDef;
  skills?: string[];
}

export interface SkillDef extends AttackDef {
  name: string; weapon: WeaponType; mp: number; cooldown: number;
}

export interface MonsterAttackDef extends AttackDef {
  id: string; windup: number; cooldown: number; range: number; weight: number;
}

export interface MonsterDef {
  name: string; sprite: string; element: Element; boss?: boolean;
  hp: number; atk: number; matk: number; def: number; mdef: number; critRate: number;
  speed: number; radius: number; aggroRange: number; leashRange: number;
  respawn: number; drops: string; attackInterval: number; keepDistance?: number;
  attacks: MonsterAttackDef[];
}

export type ItemSlot = 'weapon' | 'armor' | 'accessory';
export type ItemStatKey = 'atk' | 'matk' | 'def' | 'mdef' | 'maxHp';

export interface ItemBaseDef {
  name: string; slot: ItemSlot; weaponType?: WeaponType; sprite: string;
  stats: Partial<Record<ItemStatKey, number>>;
}

export type OptionStat =
  | 'atkPct' | 'matkPct' | 'critRate' | 'critDamage' | 'maxHp' | 'def' | 'mdef'
  | PrimaryStat | 'aspdPct';

export interface OptionDef { stat: OptionStat; label: string; unit: string; min: number; max: number; weight: number }
export interface ItemOption { stat: OptionStat; value: number }

export interface Item {
  uid: number;
  base: string;
  name: string;
  slot: ItemSlot;
  weaponType?: WeaponType;
  sprite: string;
  rarity: Rarity;
  /** 精錬値 0〜15 */
  refine: number;
  stats: Partial<Record<ItemStatKey, number>>;
  options: ItemOption[];
  crystals: (string | null)[];
  element: Element;
}

export interface RarityDef {
  name: string; color: string; statMul: number; options: number; slots: [number, number];
  glow: boolean; pillar: boolean; sfx: boolean;
}

export interface DropTable {
  rolls: number; chance: number; rarity: Partial<Record<Rarity, number>>; pool: string[];
}

export interface ElementBalance {
  advantage: number; disadvantage: number; neutral: number;
  cycle: Element[]; mutual: [Element, Element][];
}

export interface DamageConstants { defenseConstant: number; variance: number; minDamage: number }

export interface StatBalance {
  hpBase: number; hpPerVit: number; defPerVit: number; mdefPerInt: number;
  critBase: number; critPerDex: number; critPerCrt: number; critDamage: number;
  moveSpeedBase: number; moveSpeedPerAgi: number; attackSpeedPerAgi: number;
  refineStatPerLevel: number;
}

export interface Balance {
  tickRate: number;
  element: ElementBalance;
  damage: DamageConstants;
  stats: StatBalance;
  player: {
    baseStats: BaseStats; maxMp: number; maxStamina: number; staminaRegen: number; staminaRegenDelay: number;
    dodgeCost: number; dodgeDuration: number; dodgeIframes: number; dodgeSpeed: number; respawnTime: number;
    autoTargetRange: number; pickupRange: number; inventorySize: number; skillSlots: number;
  };
  monster: {
    hpRegenOnReturn: number; wanderRadius: number; wanderSpeedRatio: number;
    enrageThreshold: number; enrageCooldownRatio: number; recovery: number;
  };
  drop: { lifetime: number; scatter: number };
}

export interface MapDef {
  name: string;
  legend: Record<string, { tile: string; solid: boolean; sprite?: string }>;
  playerSpawn: { x: number; y: number };
  spawns: { monster: string; x: number; y: number }[];
  rows: string[];
}

export interface Content {
  balance: Balance;
  weapons: Record<WeaponType, WeaponTypeDef>;
  skills: Record<string, SkillDef>;
  monsters: Record<string, MonsterDef>;
  items: Record<string, ItemBaseDef>;
  drops: Record<string, DropTable>;
  rarities: { order: Rarity[]; defs: Record<Rarity, RarityDef> };
  options: { pool: OptionDef[]; weaponElementChance: number; weaponElements: Element[] };
}
