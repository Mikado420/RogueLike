import type {
  Difficulty, Element, EquipSlot, ModKey, Mods, PersonalStat, PrimaryStat, Rarity, Shape, WeaponType,
} from './core';
import type { AttackDef, Content, MonsterAttackDef } from './content/types';
import type { GameMap } from './map';
import type { Rng } from './rng';

// ═════════════ 保存されるデータ（アカウント → キャラクター） ═════════════

export type TradeFlag = 'free' | 'once' | 'none';

export interface Item {
  uid: number;
  base: string;
  name: string;
  slot: EquipSlot;
  kind: string;
  tier: number;
  ilvl: number;
  reqLevel: number;
  rarity: Rarity;
  refine: number;
  refinePity: number;
  stats: Partial<Record<ModKey, number>>;
  options: { key: ModKey; value: number }[];
  crystals: (string | null)[];
  element: Element;
  unique?: string;
  mythic?: string;
  set?: string;
  trade: TradeFlag;
  look: string;
  locked?: boolean;
}

export interface BuildSnapshot {
  name: string;
  stats: Record<PrimaryStat, number>;
  personal: { type: PersonalStat | null; value: number };
  skills: Record<string, number>;
  skillSlots: Partial<Record<WeaponType, (string | null)[]>>;
  equipment: Partial<Record<EquipSlot, number | null>>;
}

export interface CharacterData {
  id: string;
  name: string;
  createdAt: number;
  playTime: number;
  look: { body: number; hair: number };
  level: number;
  exp: number;
  rebirths: number;
  /** 振ったポイント（基礎値は含まない） */
  stats: Record<PrimaryStat, number>;
  personal: { type: PersonalStat | null; value: number };
  skills: Record<string, number>;
  /** 武器ごとのスキル枠 */
  skillSlots: Partial<Record<WeaponType, (string | null)[]>>;
  equipment: Record<EquipSlot, Item | null>;
  inventory: Item[];
  /** 重ねて持てるもの（素材・消耗品・結晶） */
  bag: Record<string, number>;
  gold: number;
  builds: (BuildSnapshot | null)[];
  titles: { unlocked: string[]; equipped: string | null };
  counters: Record<string, number>;
  location: { area: string; x: number; y: number };
  hp: number;
  mp: number;
}

export interface AccountData {
  version: number;
  id: string;
  createdAt: number;
  nextUid: number;
  characters: CharacterData[];
  lastCharacterId: string | null;
}

// ═════════════ 入力とコマンド ═════════════

export interface PlayerInput {
  /** ワールド座標系の移動ベクトル（長さ0〜1） */
  move: { x: number; y: number };
  /** 狙う方向（ワールド座標系）。null なら近くの敵を自動で狙う */
  aim: { x: number; y: number } | null;
  /** 通常攻撃ボタンを押している */
  attack: boolean;
  /** このtickに押したスキル枠（0〜3）、なければ -1 */
  skill: number;
  dodge: boolean;
  interact: boolean;
  commands: Command[];
}

export type Command =
  | { type: 'equip'; uid: number }
  | { type: 'unequip'; slot: EquipSlot }
  | { type: 'allocateStat'; stat: PrimaryStat | 'personal'; amount: number }
  | { type: 'choosePersonal'; personal: PersonalStat }
  | { type: 'learnSkill'; skill: string }
  | { type: 'setSkillSlot'; weapon: WeaponType; slot: number; skill: string | null }
  | { type: 'respec' }
  | { type: 'saveBuild'; slot: number; name?: string }
  | { type: 'loadBuild'; slot: number }
  | { type: 'rebirth' }
  | { type: 'useItem'; id: string }
  | { type: 'sell'; uid: number }
  | { type: 'sellBag'; id: string; n: number }
  | { type: 'buy'; shop: string; id: string; n: number }
  | { type: 'lock'; uid: number; locked: boolean };

export const emptyInput = (): PlayerInput => ({
  move: { x: 0, y: 0 }, aim: null, attack: false, skill: -1, dodge: false, interact: false, commands: [],
});

// ═════════════ 実行中の状態 ═════════════

export interface CombatStats {
  level: number;
  atk: number; matk: number; def: number; mdef: number;
  maxHp: number; maxMp: number; maxSt: number;
  critRate: number; critDamage: number;
  aspd: number; cspd: number; moveSpeed: number;
  evasion: number;
  element: Element;
  /** 残りの補正の合計 */
  m: Mods;
}

export interface StatusInstance {
  id: string;
  until: number;
  stacks: number;
  sourceId: number;
  /** DoT の1回あたりダメージ（付与時に決まる） */
  dot: number;
  nextTick: number;
  mods?: Mods;
}

interface ActorBase {
  id: number;
  x: number; y: number; r: number;
  facing: number;
  hp: number;
  stats: CombatStats;
  team: 0 | 1;
  dead: boolean;
  statuses: StatusInstance[];
  /** 行動できない残りtick（怯み・ブレイク） */
  stagger: number;
  moving: boolean;
  statsDirty: boolean;
}

export interface Player extends ActorBase {
  kind: 'player';
  char: CharacterData;
  mp: number;
  st: number;
  stDelay: number;
  attackCd: number;
  chainIndex: number;
  chainUntil: number;
  skillCd: Record<string, number>;
  skillCdMax: Record<string, number>;
  lock: number;
  dodgeTicks: number;
  dodgeDir: { x: number; y: number };
  dashSpeed: number;
  iframes: number;
  respawnTicks: number;
  prevAttack: boolean;
  /** 両手剣の溜め（tick） */
  charge: number;
  /** 銃の残弾・リロード */
  ammo: number;
  reloadTicks: number;
  /** 手甲のコンボ・楽器のリズム */
  combo: number;
  comboUntil: number;
  rhythm: number;
  lastDodgeTick: number;
  lastCombatTick: number;
  regenAcc: number;
}

export type AiState = 'wander' | 'chase' | 'return';

export interface Monster extends ActorBase {
  kind: 'monster';
  defId: string;
  level: number;
  elite: boolean;
  difficulty: Difficulty;
  ai: AiState;
  targetId: number;
  homeX: number; homeY: number;
  wanderX: number; wanderY: number;
  timer: number;
  busy: number;
  globalCd: number;
  cds: Record<string, number>;
  pending: { attack: MonsterAttackDef; dir: number; ticks: number } | null;
  spawnKey: string;
  enraged: boolean;
  poise: number;
  poiseMax: number;
  breaks: number;
  lastHitTick: number;
  phase: number;
  shielded: boolean;
  brokenUntil: number;
  scale: { hp: number; atk: number; def: number; exp: number; gold: number };
  /** 誰がどれだけ削ったか（経験値の分配用） */
  damageBy: Record<number, number>;
}

export type Actor = Player | Monster;

export interface HitSpec {
  power: number;
  element: Element;
  damageType: 'physical' | 'magic';
  kind: 'normal' | 'skill' | 'dot' | 'monster';
  breakPower: number;
  status?: AttackDef['status'];
  statusLevel?: number;
  lifesteal?: number;
  skillId?: string | null;
  canCrit?: boolean;
  /** 銃の背面撃ちなどで足す倍率 */
  bonusMul?: number;
  critBonus?: number;
  /** 槍の間合い判定に使う攻撃の届く距離 */
  reach?: number;
  execute?: { below: number; mul: number };
  knockback?: number;
  tags?: string[];
}

export interface Strike {
  id: number;
  ownerId: number;
  team: 0 | 1;
  x: number; y: number;
  dir: number;
  shape: Shape;
  follow: boolean;
  startTick: number;
  nextTick: number;
  hitsLeft: number;
  hitCount: number;
  interval: number;
  spec: HitSpec;
  telegraph: boolean;
  combo: number;
  mpGain: number;
}

export interface Projectile {
  id: number;
  ownerId: number;
  team: 0 | 1;
  x: number; y: number;
  vx: number; vy: number;
  r: number;
  ticksLeft: number;
  pierce: number;
  hitIds: number[];
  spec: HitSpec;
  combo: number;
  hitCount: number;
  explodeRadius: number;
  sprite: string;
  mpGain: number;
  homing: number;
}

export interface Drop {
  id: number;
  x: number; y: number;
  item: Item | null;
  /** 素材・ゴールドの場合 */
  bag?: { id: string; n: number };
  gold?: number;
  ticksLeft: number;
  ownerId: number;
}

export interface NpcInstance { id: number; npc: string; x: number; y: number }

export interface SpawnState {
  key: string;
  monster: string;
  x: number; y: number;
  level: [number, number];
  monsterId: number;
  respawnAt: number;
}

export interface AreaInstance {
  id: string;
  type: 'town' | 'field' | 'dungeon' | 'tower' | 'raid';
  name: string;
  map: GameMap;
  level: [number, number];
  monsters: Monster[];
  strikes: Strike[];
  projectiles: Projectile[];
  drops: Drop[];
  npcs: NpcInstance[];
  spawns: SpawnState[];
  playerSpawn: { x: number; y: number };
  safeRadius: number;
}

export interface World {
  seed: number;
  tick: number;
  clock: number;
  rng: Rng;
  content: Content;
  account: AccountData;
  area: AreaInstance;
  players: Player[];
  nextId: number;
  events: GameEvent[];
}

// ═════════════ イベント（描画・効果音・通知用） ═════════════

export type GameEvent =
  | { type: 'damage'; src: number; tgt: number; amount: number; crit: boolean; weak: boolean; resist: boolean;
      element: Element; combo: number; cnt: number; x: number; y: number; toPlayer: boolean; dot?: boolean; broke?: boolean;
      sweet?: boolean; back?: boolean }
  | { type: 'heal'; tgt: number; amount: number; x: number; y: number }
  | { type: 'evade'; tgt: number; x: number; y: number; block?: boolean }
  | { type: 'attack'; src: number; dir: number; skill: string | null; weapon: WeaponType | null; charge?: number }
  | { type: 'impact'; src: number; x: number; y: number; dir: number; shape: Shape; element: Element; team: 0 | 1 }
  | { type: 'explode'; x: number; y: number; radius: number; element: Element }
  | { type: 'death'; id: number; x: number; y: number; boss: boolean; player: boolean }
  | { type: 'drop'; id: number; rarity: Rarity | null; x: number; y: number }
  | { type: 'pickup'; playerId: number; item: Item | null; bag?: { id: string; n: number }; gold?: number }
  | { type: 'dodge'; id: number }
  | { type: 'respawn'; id: number }
  | { type: 'spawn'; id: number; boss: boolean }
  | { type: 'enrage'; id: number }
  | { type: 'equip'; playerId: number }
  | { type: 'exp'; playerId: number; amount: number; x: number; y: number }
  | { type: 'gold'; playerId: number; amount: number }
  | { type: 'levelUp'; playerId: number; level: number }
  | { type: 'status'; tgt: number; status: string; on: boolean }
  | { type: 'break'; id: number }
  | { type: 'charChanged'; playerId: number }
  | { type: 'notice'; playerId: number; key: string; args?: (string | number)[] }
  | { type: 'npc'; playerId: number; npc: string; npcId: number }
  | { type: 'rhythm'; playerId: number; onBeat: boolean; stacks: number }
  | { type: 'reload'; playerId: number; done: boolean }
  | { type: 'areaChanged'; playerId: number; area: string };
