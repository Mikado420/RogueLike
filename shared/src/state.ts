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
  /** アバター：登録した見た目と、選んでいる見た目 */
  appearance: { looks: string[]; selected: Partial<Record<'weapon' | 'body' | 'head', string>> };
  /** ルートフィルター：これより下のレア度は表示しない／自動で売る */
  lootFilter: { hideBelow: Rarity | null; sellBelow: Rarity | null };
  /** 訪れた街（ファストトラベル先） */
  visitedTowns: string[];
  /** 図鑑：倒した数・手に入れた装備の土台・素材 */
  codex: { monsters: Record<string, number>; items: Record<string, number>; materials: Record<string, number> };
  missions: { day: number; daily: MissionState[]; week: number; weekly: MissionState[] };
  achievements: Record<string, number>;
  tower: { best: number };
  /** サブ職（採集・鍛冶・料理・錬成） */
  sub: Record<'gather' | 'smith' | 'cook' | 'alchemy', { level: number; exp: number }>;
  pets: PetData[];
  activePet: number | null;
  tutorial: { step: number; count: number; done: boolean };
}

export interface PetData { uid: number; species: string; name: string; level: number; exp: number; skills: string[]; role: 'battle' | 'gather'; elite: boolean }

export interface MissionState { id: string; counter: string; n: number; base: number; claimed: boolean }

export interface StorageData { items: Item[]; bag: Record<string, number>; capacity: number }

export interface AccountData {
  version: number;
  id: string;
  createdAt: number;
  nextUid: number;
  characters: CharacterData[];
  lastCharacterId: string | null;
  /** 倉庫はアカウントで共有 */
  storage: StorageData;
  /** 世界の状態（オフライン用。オンライン化したらサーバー側に移す） */
  world: { fieldBoss: Record<string, number>; invasion: { slot: number; contribution: Record<string, number>; rewarded: string[] } };
  /** 拠点（段階3でギルド共有にする） */
  base: { levels: Record<string, number>; paidDay: number };
  /** タイムアタックの記録（段階3でサーバーのランキングに移す） */
  records: { timeAttack: Record<string, { time: number; char: string; at: number }[]> };
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
  | { type: 'lock'; uid: number; locked: boolean }
  | { type: 'refine'; uid: number }
  | { type: 'insertCrystal'; uid: number; socket: number; crystal: string }
  | { type: 'removeCrystal'; uid: number; socket: number; recover: boolean }
  | { type: 'deposit'; uid: number }
  | { type: 'withdraw'; uid: number }
  | { type: 'depositBag'; id: string; n: number }
  | { type: 'withdrawBag'; id: string; n: number }
  | { type: 'expandStorage' }
  | { type: 'sortInventory'; key: string }
  | { type: 'setAppearance'; slot: 'weapon' | 'body' | 'head'; look: string | null }
  | { type: 'setLootFilter'; hideBelow: Rarity | null; sellBelow: Rarity | null }
  | { type: 'fastTravel'; town: string }
  | { type: 'enterDungeon'; dungeon: string; difficulty: Difficulty }
  | { type: 'enterTower'; floor: number }
  | { type: 'enterRaid'; raid: string; difficulty: Difficulty }
  | { type: 'leaveInstance' }
  | { type: 'claimMission'; kind: 'daily' | 'weekly'; index: number }
  | { type: 'equipTitle'; title: string | null }
  | { type: 'buildFacility'; facility: string }
  | { type: 'payUpkeep' }
  | { type: 'craft'; tier: number; base: string }
  | { type: 'cook'; recipe: string }
  | { type: 'alchemy'; uid: number; mode: 'one' | 'values'; index: number }
  | { type: 'capture'; item: string }
  | { type: 'setActivePet'; uid: number | null }
  | { type: 'setPetRole'; uid: number; role: 'battle' | 'gather' }
  | { type: 'inheritPet'; base: number; material: number; skill: string; slot: number }
  | { type: 'releasePet'; uid: number }
  | { type: 'skipTutorial' };

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
  /** このプレイヤーのアカウント（倉庫・拠点・記録など） */
  account: AccountData;
  /** 別のエリアへ移りたい（ホストが step の後に処理する） */
  transition: Transition | null;
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
  /** 固有効果の条件（HP・回避直後など）の今の状態 */
  condKey: string;
  cheatDeathAt: number;
  tutPos: { x: number; y: number };
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
  /** 奇襲型：近づくまで見えない */
  hidden: boolean;
  fieldBoss: boolean;
  /** 呼び出したボス（シールドの判定用） */
  summonedBy: number;
  invader: boolean;
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

export interface NpcInstance { id: number; npc: string; x: number; y: number; data?: string }

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
  exits: { rect: [number, number, number, number]; to: string; spawn: string }[];
  spawnPoints: Record<string, { x: number; y: number }>;
  spots: Record<string, { x: number; y: number }>;
  /** フィールドの湧き */
  spawnTimer: number;
  fieldBossSlot: number;
  instance: InstanceState | null;
  /** レイドの安全地帯（この円の外にいると大ダメージ） */
  safeZones: { x: number; y: number; r: number }[];
  safeZoneAt: number;
  safeZonePower: number;
  safeZoneOwner: number;
  invasion: InvasionState | null;
  nodes: GatherNode[];
}

export interface GatherNode { id: number; type: string; x: number; y: number; charges: number; respawnAt: number }

export interface InstanceState {
  kind: 'dungeon' | 'tower' | 'raid';
  id: string;
  difficulty: Difficulty;
  floor: number;
  level: number;
  startTick: number;
  endTick: number;
  bossId: number;
  cleared: boolean;
  failed: boolean;
  returnTo: { area: string; spawn: string | null; x: number; y: number };
  timeLimitTick: number;
}

export interface InvasionState { slot: number; wave: number; nextWaveTick: number; endClock: number; finished: boolean }

/** ダンジョン・塔・レイドを作るための指定（行き先のワールドが自分で作る） */
export interface InstanceSpec {
  kind: 'dungeon' | 'tower' | 'raid';
  id: string;
  difficulty: Difficulty;
  floor: number;
  seed: number;
  returnTo: { area: string; spawn: string | null; x: number; y: number };
  /** 入る人数（レイドの係数に使う） */
  players: number;
  /** 同じインスタンスに入る仲間（キャラ id） */
  party?: string[];
}

/** エリア移動の行き先 */
export interface Transition {
  to: string;
  spawn: string;
  pos?: { x: number; y: number };
  instance?: InstanceSpec;
}

/** ワールド全体で共有するもの（フィールドボスを倒した区切り・侵攻の貢献度）。サーバーでは WorldDO が持つ */
export interface SharedWorldState {
  fieldBoss: Record<string, number>;
  invasion: { slot: number; contribution: Record<string, number>; rewarded: string[] };
}

/** 1つのエリア（街・フィールド・インスタンス）のワールド。中に何人でも入れる */
export interface World {
  seed: number;
  tick: number;
  clock: number;
  rng: Rng;
  /** アイテムの uid 用（ゲームの乱数とは別） */
  uidRng: Rng;
  content: Content;
  area: AreaInstance;
  players: Player[];
  nextId: number;
  events: GameEvent[];
  /** プレイヤーが連れているペット（summonedBy が持ち主） */
  pets: Monster[];
  /** 区切り（天候の切り替わり）を見張る */
  lastWeatherSlot: number;
  shared: SharedWorldState;
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
  | { type: 'refine'; playerId: number; uid: number; success: boolean; level: number }
  | { type: 'proc'; playerId: number; name: string; x: number; y: number }
  | { type: 'autoSell'; playerId: number; gold: number; rarity: Rarity }
  | { type: 'areaChanged'; playerId: number; area: string }
  | { type: 'worldNotice'; key: string; args: (string | number)[]; rare?: boolean }
  | { type: 'instance'; playerId: number; what: 'cleared' | 'failed' | 'floor'; time?: number; best?: boolean; floor?: number }
  | { type: 'achievement'; playerId: number; id: string }
  | { type: 'invasion'; what: 'start' | 'wave' | 'end'; wave?: number; tier?: number }
  | { type: 'gather'; playerId: number; node: number; id: string; n: number; x: number; y: number }
  | { type: 'crafted'; playerId: number; kind: 'smith' | 'cook' | 'alchemy'; uid?: number; id?: string }
  | { type: 'subLevel'; playerId: number; job: string; level: number }
  | { type: 'capture'; playerId: number; success: boolean; species: string; x: number; y: number }
  | { type: 'petLevel'; playerId: number; uid: number; level: number }
  | { type: 'tutorial'; playerId: number; step: number; done: boolean };
