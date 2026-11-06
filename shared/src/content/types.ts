import type {
  ArmorType, DamageType, Difficulty, Element, EquipSlot, ModKey, Mods, PersonalStat, PrimaryStat, Rarity,
  Scaled, Shape, SubType, WeaponType,
} from '../core';

// ───────── 戦闘の定義 ─────────

export interface ProjectileDef {
  count: number; spread: number; speed: number; range: number; radius: number;
  pierce: number; explodeRadius?: number; sprite: string;
  /** 近くの敵へ曲がる強さ（0〜1） */
  homing?: number;
}

export interface StatusApply {
  id: string;
  chance: Scaled;
  duration?: number;
  /** DoT の強さ（攻撃者の ATK/MATK に対する割合） */
  power?: number;
}

/** 攻撃1回ぶんの定義（通常攻撃・スキル・モンスターの技で共通） */
export interface AttackDef {
  delivery: 'strike' | 'projectile';
  power: Scaled;
  element?: Element | 'weapon';
  damageType?: DamageType;
  /** strike の発生位置。front は自分の前方 offset タイル */
  anchor?: 'self' | 'aim' | 'target' | 'front';
  aimDistance?: number;
  offset?: number;
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
  /** 届く距離の目安（タイル） */
  range?: number;
  breakPower?: number;
  status?: StatusApply[];
  knockback?: number;
  lifesteal?: number;
  /** 相手の HP がこの割合（%）以下なら威力が mul 倍 */
  execute?: { below: number; mul: number };
  tags?: string[];
}

export type WeaponMechanic =
  | { type: 'none' }
  | { type: 'charge'; levels: number[]; powerMul: number[]; breakMul: number[]; moveMul: number }
  | { type: 'ammo'; magazine: number; reload: number; backstabMul: number; backstabCrit: number }
  | { type: 'combo'; window: number; perStack: number; max: number }
  | { type: 'rhythm'; bpm: number; window: number; maxStacks: number; perStack: number; missLoss: number; perfectMul: number }
  | { type: 'spacing'; sweetFrom: number; bonus: number }
  | { type: 'drain'; pct: number; darkBonus: number }
  | { type: 'flurry'; dodgeCdMul: number; statusBonus: number }
  | { type: 'guard'; blockRate: number; blockReduce: number };

export interface WeaponDef {
  name: string;
  hands: 1 | 2;
  damageType: DamageType;
  /** ATK/MATK に効くステータスの係数 */
  scaling: { atk: Partial<Record<PrimaryStat, number>>; matk: Partial<Record<PrimaryStat, number>> };
  subs: SubType[];
  attack: AttackDef & { interval: number; mpGain: number };
  /** 連撃（手甲・双剣などの通常攻撃の段） */
  chain?: (AttackDef & { interval: number })[];
  mechanic: WeaponMechanic;
  dodge?: { costMul?: number; speedMul?: number; iframesMul?: number };
  /** 持っている間ずっと効く補正 */
  mods?: Mods;
  icon: string;
}

export interface BuffDef {
  status: string;
  duration: Scaled;
  mods: Partial<Record<ModKey, Scaled>>;
  /** 楽器のリズムで強くなる */
  rhythm?: boolean;
  target?: 'self' | 'allies';
}

export interface SkillDef {
  name: string;
  tree: string;
  tier: number;
  type: 'active' | 'passive';
  maxLevel: number;
  requires?: { skill: string; level: number }[];
  /** この武器を持っているときだけ使える（効く） */
  weapon?: WeaponType | null;
  icon?: string;
  mp?: Scaled;
  cooldown?: Scaled;
  lock?: number;
  attack?: AttackDef;
  attacks?: AttackDef[];
  buff?: BuffDef;
  heal?: { power: Scaled; base: 'matk' | 'maxHp' };
  dash?: { distance: number; speed: number; iframes?: number; toTarget?: boolean };
  cleanse?: boolean;
  consume?: { resource: 'combo' | 'rhythm'; powerPerStack: number };
  reload?: boolean;
  /** チャージ（両手剣）で威力が伸びる */
  chargeable?: boolean;
  /** パッシブの補正 */
  mods?: Partial<Record<ModKey, Scaled>>;
}

export interface TreeDef {
  name: string;
  weapon?: WeaponType;
  kind: 'weapon' | 'general';
  order: number;
  icon: string;
}

export interface StatusDef {
  name: string;
  kind: 'buff' | 'debuff';
  /** 持続ダメージ（攻撃者の攻撃力 × power を tick ごと） */
  dot?: { interval: number; element: Element };
  maxStacks?: number;
  cannotAct?: boolean;
  mods?: Mods;
  /** 被ダメージ倍率の増分（%） */
  dmgTakenPct?: number;
  /** 一定間隔で短く止まる（感電） */
  jolt?: { interval: number; duration: number };
  missChance?: number;
  color: string;
  /** ボスにかかったときの持続時間倍率 */
  bossDurationMul?: number;
}

// ───────── モンスター ─────────

export interface MonsterAttackDef extends AttackDef {
  id: string;
  windup: number;
  cooldown: number;
  range: number;
  weight: number;
  minRange?: number;
  /** この難易度以上でだけ使う */
  minDifficulty?: Difficulty;
  /** このフェーズ以降でだけ使う */
  phase?: number;
}

export interface PhaseDef {
  /** HP 割合がこれ以下で移行 */
  hp: number;
  summon?: { monster: string; count: number; level?: number };
  shield?: boolean;
  /** 安全地帯の円を出してから全体攻撃 */
  safeZones?: { count: number; radius: number; delay: number; power: number };
  speedMul?: number;
}

export interface MonsterDef {
  name: string;
  sprite: string;
  element: Element;
  tags?: string[];
  boss?: boolean;
  fieldBoss?: boolean;
  raid?: boolean;
  scale?: number;
  /** 見た目の色（形はスプライト名） */
  colors?: [string, string];
  radius: number;
  speed: number;
  aggroRange: number;
  leashRange: number;
  attackInterval: number;
  keepDistance?: number;
  /** 各値はレベル曲線に掛ける倍率 */
  hp: number; atk: number; matk: number; def: number; mdef: number;
  crit?: number;
  poise: number;
  exp?: number;
  gold?: number;
  drops: string;
  mats?: { id: string; chance: number; min?: number; max?: number }[];
  crystal?: { id: string; chance: number };
  ccResist?: number;
  capturable?: boolean;
  petSkills?: string[];
  nightOnly?: boolean;
  ambush?: boolean;
  attacks: MonsterAttackDef[];
  phases?: PhaseDef[];
  enrageTime?: number;
  respawn?: number;
}

// ───────── 装備 ─────────

export interface EquipTier { level: number; prefix: string; mul: number }

export interface EquipBaseDef {
  name: string;
  slot: EquipSlot;
  look: string;
  stats: Partial<Record<ModKey, number>>;
  /** 部位ごとの種類（武器種・サブの種類・防具の重さ） */
  kind: WeaponType | SubType | ArmorType | 'head' | 'accessory';
}

export interface OptionDef {
  key: ModKey;
  label: string;
  unit: string;
  /** Lv1 時点の幅と、Lv100 時点の幅 */
  min: [number, number];
  max: [number, number];
  weight: number;
  slots?: EquipSlot[];
  decimals?: number;
}

export interface RarityDef {
  name: string; color: string; statMul: number; options: number; slots: [number, number];
  glow: boolean; pillar: boolean; sfx: boolean; optionRoll: [number, number]; sellMul: number;
}

export interface UniqueDef {
  name: string;
  slots: EquipSlot[];
  mods?: Mods;
  /** 条件つきの効果 */
  when?: { hpBelow?: number; afterDodge?: number; vsBoss?: boolean; night?: boolean; fullHp?: boolean };
  whenMods?: Mods;
  proc?: { on: 'hit' | 'kill' | 'dodge' | 'hurt'; chance: number; effect: 'extraHit' | 'heal' | 'mp' | 'status' | 'explode'; value: number; status?: string };
  cheatDeath?: number;
}

export interface MythicDef {
  name: string;
  slots: EquipSlot[];
  effect: 'fireballAttack' | 'dodgeClone' | 'chainLightning' | 'extraHits' | 'deathBurst' | 'timeSand' | 'echoSkill';
  value: number;
  mods?: Mods;
  attack?: AttackDef;
  power?: number;
  delay?: number;
}

export interface SetDef {
  name: string;
  /** 部位 → その部位の名前 */
  pieces: Partial<Record<EquipSlot, string>>;
  bonus: { count: number; mods: Mods }[];
}

export interface CrystalDef {
  name: string;
  slots: EquipSlot[] | 'any';
  mods: Mods;
  color: string;
  /** 外して回収するときのゴールド */
  recover: number;
}

export interface RefineDef {
  max: number;
  stone: string;
  goldTierMul: number;
  pityPerFail: number;
  levels: { rate: number; gold: number; stones: number; drop: number }[];
}

export interface DropTable {
  rolls: number;
  chance: number;
  rarity: Partial<Record<Rarity, number>>;
  /** 部位の重み */
  slots?: Partial<Record<EquipSlot, number>>;
  set?: string;
  setChance?: number;
}

// ───────── 素材・生産 ─────────

export interface MaterialDef {
  name: string;
  kind: 'material' | 'consumable' | 'food' | 'capture' | 'crystal' | 'key';
  icon: string;
  color: string;
  price: number;
  rarity?: Rarity;
  /** 使ったときの効果 */
  use?: { heal?: number; healPct?: number; mpPct?: number; buff?: string; capture?: number; food?: { mods: Mods; duration: number } };
  stack?: number;
}

// ───────── 世界 ─────────

export interface SpawnDef { monster: string; x: number; y: number; level: [number, number] }
export interface NpcPlacement { npc: string; x: number; y: number }

export interface NpcDef {
  name: string;
  sprite: string;
  role: string;
  shop?: string;
  color: string;
}

export interface AreaExitDef { rect: [number, number, number, number]; to: string; spawn: string }

export interface AreaDef {
  name: string;
  type: 'town' | 'field' | 'dungeon' | 'tower' | 'raid';
  /** 手作りのマップ（data/maps） */
  map?: string;
  /** 自動生成のマップ */
  gen?: { seed: number; width: number; height: number; palette: string };
  genExits?: { edge: 'north' | 'south' | 'east' | 'west'; to: string; spawn: string }[];
  level: [number, number];
  playerSpawn?: { x: number; y: number };
  spawnPoints?: Record<string, { x: number; y: number }>;
  exits?: AreaExitDef[];
  spawns?: SpawnDef[];
  npcs?: NpcPlacement[];
  safeRadius?: number;
  /** 湧くモンスター（重み） */
  density?: number;
  monsters?: { id: string; w: number }[];
  night?: { id: string; w: number }[];
  ambush?: { id: string; w: number }[];
  fieldBoss?: { id: string; spot: [number, number]; level: number };
  gate?: { spot: [number, number]; dungeon: string };
  weather?: Record<string, number>;
  travelCost?: number;
}

export interface WeatherDef {
  name: string;
  rare?: boolean;
  nightOnly?: boolean;
  elements?: Partial<Record<Element, number>>;
  rareRatePct?: number;
  eliteMul?: number;
  ambushMul?: number;
  moveSpeedPct?: number;
}

// ───────── 全体 ─────────

export interface PersonalDef { name: string; mods: Mods }

export interface Balance {
  tickRate: number;
  element: {
    advantage: number; disadvantage: number; neutral: number;
    cycle: Element[]; mutual: [Element, Element][];
  };
  damage: {
    defenseKBase: number; defenseKPerLevel: number; variance: number; minDamage: number;
    breakDmgTakenPct: number;
  };
  stats: {
    statBase: number; statMax: number; personalMax: number;
    hpBase: number; hpPerLevel: number; hpPerVit: number;
    mpBase: number; mpPerInt: number;
    stBase: number;
    atkPerLevel: number; matkPerLevel: number;
    defPerLevel: number; defPerVit: number; mdefPerLevel: number; mdefPerInt: number;
    critBase: number; critPerDex: number; critDamage: number; critDamagePerStr: number;
    moveSpeedBase: number; moveSpeedPerAgi: number; moveSpeedMax: number;
    aspdPerAgi: number; aspdMax: number; cspdPerDex: number; cspdMax: number;
    evasionPerAgi: number;
    refineStatPerLevel: number;
  };
  personal: Record<PersonalStat, PersonalDef>;
  progression: {
    maxLevel: number;
    startStatPoints: number; statPointsPerLevel: number;
    startSkillPoints: number; skillPointsPerLevel: number;
    expKills: [number, number];
    expMonster: [number, number, number];
    levelDiffPenalty: number; levelDiffBonus: number; levelDiffMinMul: number; levelDiffMaxMul: number;
    tierLevels: number[];
  };
  respec: { costBase: number; costPerLevel: number };
  rebirth: { statPoints: number; skillPoints: number; expPct: number; max: number; titles: { count: number; title: string }[] };
  builds: { slots: number };
  player: {
    maxStaminaBase: number; staminaRegen: number; staminaRegenDelay: number;
    dodgeCost: number; dodgeDuration: number; dodgeIframes: number; dodgeSpeed: number; respawnTime: number;
    autoTargetRange: number; pickupRange: number; inventorySize: number; skillSlots: number;
    interactRange: number; mpRegenOutOfCombat: number; hpRegenOutOfCombat: number; combatTimeout: number;
    blockReduce: number;
  };
  monster: {
    hp: [number, number, number]; atk: [number, number]; def: number; mdef: number;
    gold: [number, number, number];
    hpRegenOnReturn: number; wanderRadius: number; wanderSpeedRatio: number;
    enrageThreshold: number; enrageCooldownRatio: number; recovery: number;
    poiseBase: number; poisePerLevel: number; breakDuration: number; bossBreakDuration: number;
    poiseRegenDelay: number; poiseGrowth: number; flinchDuration: number;
    respawn: number; bossRespawn: number; eliteMul: number; eliteAtkMul: number; elitePoiseMul: number; eliteRadiusMul: number;
  };
  drop: { lifetime: number; scatter: number };
  sell: { base: number; perLevel: number; perRefine: number; materialMul: number };
  world: { startArea: string; startTown: string; fieldBossInterval: number; exitCooldown: number; spawnMinDist: number; spawnInterval: number; eliteChance: number; levelSpread: number };
  combat: { backAngle: number; preciseCrit: number; chargeMinMove: number; knockbackMaxRadius: number };
  economy: { killsPerHour: number; levels: number[]; refineTarget: number; craftsPerDay: number };
  start: { gold: number; bag: Record<string, number>; equipment: { base: string; slot: EquipSlot }[]; inventory: { base: string }[]; starterWeapons?: string[] };
}

export interface DifficultyDef { name: string; hp: number; atk: number; def: number; exp: number; gold: number; rareRatePct: number; extraRolls: number; levelBonus: number }
export interface DungeonDef { name: string; field: string; level: number; rooms: [number, number]; tint: string; monsters: string[]; boss: string; set: string; crystal: string }
export interface TowerDef {
  name: string; baseLevel: number; levelPerFloor: number; maxLevel: number; monstersBase: number; monstersPerFloor: number; monstersMax: number;
  bossEvery: number; checkpointEvery: number; rareRatePerFloor: number; arena: [number, number]; pool: string[]; bosses: string[]; bossDrops: string;
  untradableFrom: number; crystal: { id: string; chance: number };
}
export interface RaidDef { name: string; boss: string; level: number; arena: number; timeLimit: number; minLevel: number; party: { hpPerPlayer: number; atkPerPlayer: number; maxPlayers: number }; drops: string; crystal: { id: string; chance: number } }
export interface InvasionDef {
  /** 襲撃中、街で起きる地点と入口のまわりの聖域（マス）。魔物はここにいる人を狙わない */
  sanctuary?: number;
  town: string; every: number; duration: number; waves: number; waveEvery: number; perWave: [number, number]; levelOffset: [number, number];
  spawnEdges: string[]; pool: string[]; contribution: { damage: number; kill: number };
  tiers: { min: number; gold: number; exp: number; mats: number; epicChance: number }[]; matPool: string[];
}
export interface MissionTemplate { id: string; counter: string; n: [number, number]; reward: { gold?: number; exp?: number; items?: Record<string, number> } }
export interface AchievementDef { id: string; name: string; counter: string; n: number; title?: string }
export interface FacilityDef { name: string; max: number; mods?: Mods; storage?: number; refineRate?: number; craftBonus?: number; foodDuration?: number; cost: { gold: [number, number]; mats: Record<string, [number, number]> } }

export type SubJob = 'gather' | 'smith' | 'cook' | 'alchemy';
export interface GatherEntry { id: string; w: number; weather?: string; night?: boolean }
export interface GatheringDef {
  nodeTypes: Record<string, { name: string; sprite: string; charges: number; respawn: number }>;
  lock: number; yield: [number, number];
  areas: Record<string, { count: Record<string, number>; tables: Record<string, GatherEntry[]> }>;
}
export interface SubJobsDef {
  jobs: Record<SubJob, { name: string }>; maxLevel: number; expBase: number; expPerLevel: number; gain: Record<SubJob, number>;
  effects: { gatherYieldPct: number; gatherRarePct: number; smithRarePct: number; cookDoublePct: number; alchemyCostPct: number; alchemyRollMin: number };
}
export interface RecipesDef {
  smithing: { tiers: { tier: number; level: number; gold: number; ore: [string, number]; wood: [string, number]; extra: [string, number] }[]; rarity: Partial<Record<Rarity, number>> };
  cooking: Record<string, { level: number; mats: Record<string, number>; gold: number }>;
  alchemy: { rerollOne: { gold: [number, number]; catalyst: number }; rerollValues: { gold: [number, number]; catalyst: number }; catalyst: string };
}

export interface PetSkillDef {
  name: string; kind: 'attack' | 'heal' | 'buff' | 'passive' | 'loot';
  cd?: number; attack?: AttackDef; value?: number; duration?: number; mods?: Mods; range?: number;
}
export interface PetsDef {
  captureItems: Record<string, number>; hpThreshold: number; baseChance: number; hpBonus: number; levelPenalty: number; eliteMul: number; range: number;
  maxPets: number; maxLevel: number; expShare: number; expCurve: [number, number]; atkMul: number; attackInterval: number;
  followDist: number; leash: number; aggroRange: number; skillSlots: number; secondSkillChance: number; gatherBonus: number;
  inheritCost: [number, number]; elementSkills: Record<string, string>; randomSkills: string[]; skills: Record<string, PetSkillDef>;
}

export interface Content {
  balance: Balance;
  weapons: Record<WeaponType, WeaponDef>;
  skills: Record<string, SkillDef>;
  trees: Record<string, TreeDef>;
  statuses: Record<string, StatusDef>;
  monsters: Record<string, MonsterDef>;
  equipment: {
    tiers: EquipTier[];
    bases: Record<string, EquipBaseDef>;
    subRules: Record<string, SubType[]>;
    /** 段（tier）で大きく増やさない値（ブロック率など） */
    flatStats: ModKey[];
    flatTierGrowth: number;
  };
  uniques: Record<string, UniqueDef>;
  mythics: Record<string, MythicDef>;
  sets: Record<string, SetDef>;
  crystals: Record<string, CrystalDef>;
  refine: RefineDef;
  storage: { base: number; step: number; max: number; costBase: number; costGrowth: number; sortKeys: string[] };
  looks: { bodyColors: string[]; hairColors: string[]; tierColors: string[]; names: Record<string, string> };
  palettes: Record<string, import('../mapgen').Palette>;
  weather: { slotMinutes: number; seed: number; forecastSlots: number; types: Record<string, WeatherDef> };
  ambience: {
    phases: Record<string, { color: string; alpha: number }>;
    weather: Record<string, { color: string; alpha: number; particles?: string; count?: number; flash?: boolean }>;
    vision: { night: number; fog: number; nightFog: number; dungeon: number; darkness: number };
    areaTint: Record<string, { color: string; alpha: number }>;
  };
  music: {
    tracks: Record<string, { bpm: number; root: number; scale: number[]; wave: string; bass: string; density: number; seed: number }>;
    rules: { boss?: boolean; rareWeather?: boolean; areaType?: string; area?: string; phase?: string; weather?: string; track: string }[];
  };
  time: {
    dayLength: number; hourOffset: number;
    phases: { id: string; from: number; to: number }[];
    night: { from: number; to: number; darkDmgPct: number; lightDmgPct: number; aggroMul: number };
  };
  rarities: { order: Rarity[]; defs: Record<Rarity, RarityDef> };
  options: { pool: OptionDef[]; weaponElementChance: number; weaponElements: Element[] };
  drops: Record<string, DropTable>;
  materials: Record<string, MaterialDef>;
  areas: Record<string, AreaDef>;
  maps: Record<string, { legend: Record<string, { tile: string; solid: boolean; sprite?: string }>; rows: string[] }>;
  npcs: Record<string, NpcDef>;
  shops: Record<string, { items: string[] }>;
  difficulties: Record<Difficulty, DifficultyDef>;
  dungeons: { dungeons: Record<string, DungeonDef>; packs: [number, number]; bossRoomRadius: number; chestRolls: number; timeAttackTop: number };
  tower: TowerDef;
  raids: Record<string, RaidDef>;
  invasion: InvasionDef;
  missions: { dailyCount: number; weeklyCount: number; daily: MissionTemplate[]; weekly: MissionTemplate[] };
  titles: Record<string, { name: string; mods: Mods }>;
  achievements: AchievementDef[];
  codex: { thresholds: { pct: number; mods: Mods }[] };
  base: { upkeepPerLevel: number; facilities: Record<string, FacilityDef> };
  gathering: GatheringDef;
  subjobs: SubJobsDef;
  recipes: RecipesDef;
  pets: PetsDef;
  social: SocialDef;
  market: { feePct: number; stallFeePct: number; maxListings: number; minPrice: number; maxPrice: number; durationHours: number; stallMax: number; mailMax: number; searchLimit: number };
  tutorial: { area: string; steps: { id: string; type: string; n: number; text: string; hint?: string; touch?: string; keys: string[]; tab?: string; dir?: string; gift?: { base: string; rarity: Rarity } }[]; reward: { gold: number; items: Record<string, number> } };
  tiles: Record<string, { colors: [string, string]; shine?: string }>;
  text: Record<string, string>;
}

export interface SocialDef {
  party: { max: number; expBonusPerMember: number; shareRange: number; gatherRange: number };
  chat: { maxLen: number; minIntervalMs: number; perMin: number; history: number; ngWords: string[]; stamps: { id: string; text: string }[]; emotes: { id: string; text: string }[] };
  rescue: { maxAgeMin: number; reward: { gold: number; goldPerLevel: number; expPct: number }; listMax: number };
  guild: { max: number; nameMax: number; createCost: number };
  recruit: { maxAgeMin: number; listMax: number };
  match: { size: number; waitSec: number; minSize: number };
}
