import type {
  AttackDef, CombatStats, Content, DamageType, Element, Item, MonsterAttackDef, MonsterDef,
  Rarity, Shape, WeaponType,
} from './types';
import { CONTENT, MAPS } from './content';
import { Rng } from './rng';
import { buildMap, circleHitsMap, isSolid, lineOfSight, moveCircle, type GameMap } from './map';
import { computeDamage } from './damage';
import { derivePlayerStats, type Equipment } from './stats';
import { createItem, rollDrops } from './loot';

// ───────────── 入力 ─────────────

/** クライアントから届く1tickぶんの入力（サーバーにもこの形で送る予定） */
export interface PlayerInput {
  /** ワールド座標系の移動ベクトル（長さ0〜1） */
  move: { x: number; y: number };
  /** 狙う方向（ワールド座標系）。null なら近くの敵を自動で狙う */
  aim: { x: number; y: number } | null;
  /** 通常攻撃ボタンを押している */
  attack: boolean;
  /** このtickに押したスキル枠（0〜3）、なければ -1 */
  skill: number;
  /** このtickに回避を押した */
  dodge: boolean;
  commands: Command[];
}

export type Command = { type: 'equip'; uid: number } | { type: 'unequip'; slot: keyof Equipment };

export const emptyInput = (): PlayerInput => ({
  move: { x: 0, y: 0 }, aim: null, attack: false, skill: -1, dodge: false, commands: [],
});

// ───────────── エンティティ ─────────────

interface ActorBase {
  id: number;
  x: number; y: number; r: number;
  facing: number;
  hp: number;
  stats: CombatStats;
  team: 0 | 1;
  dead: boolean;
}

export interface Player extends ActorBase {
  kind: 'player';
  name: string;
  equipment: Equipment;
  inventory: Item[];
  mp: number; maxMp: number;
  st: number; maxSt: number;
  stDelay: number;
  attackCd: number;
  skillCd: number[];
  skillCdMax: number[];
  lock: number;
  dodgeTicks: number;
  dodgeDir: { x: number; y: number };
  iframes: number;
  respawnTicks: number;
  spawnX: number; spawnY: number;
  moving: boolean;
}

export type AiState = 'wander' | 'chase' | 'return';

export interface Monster extends ActorBase {
  kind: 'monster';
  defId: string;
  ai: AiState;
  targetId: number;
  homeX: number; homeY: number;
  wanderX: number; wanderY: number;
  timer: number;
  busy: number;
  globalCd: number;
  cds: Record<string, number>;
  pending: { attack: MonsterAttackDef; dir: number; ticks: number } | null;
  spawnIndex: number;
  enraged: boolean;
  moving: boolean;
}

export type Actor = Player | Monster;

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
  power: number;
  element: Element;
  damageType: DamageType;
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
  power: number;
  element: Element;
  damageType: DamageType;
  combo: number;
  hitCount: number;
  explodeRadius: number;
  sprite: string;
  mpGain: number;
}

export interface Drop {
  id: number;
  x: number; y: number;
  item: Item;
  ticksLeft: number;
}

export interface SpawnState {
  monster: string;
  x: number; y: number;
  monsterId: number;
  respawnAt: number;
}

// ───────────── イベント（描画・効果音用） ─────────────

export type GameEvent =
  | { type: 'damage'; src: number; tgt: number; amount: number; crit: boolean; weak: boolean; resist: boolean;
      element: Element; combo: number; cnt: number; x: number; y: number; toPlayer: boolean }
  | { type: 'evade'; tgt: number; x: number; y: number }
  | { type: 'attack'; src: number; dir: number; skill: string | null; weapon: WeaponType | null }
  | { type: 'impact'; src: number; x: number; y: number; dir: number; shape: Shape; element: Element; team: 0 | 1 }
  | { type: 'explode'; x: number; y: number; radius: number; element: Element }
  | { type: 'death'; id: number; x: number; y: number; boss: boolean; player: boolean }
  | { type: 'drop'; id: number; rarity: Rarity; x: number; y: number }
  | { type: 'pickup'; playerId: number; item: Item }
  | { type: 'dodge'; id: number }
  | { type: 'respawn'; id: number }
  | { type: 'spawn'; id: number; boss: boolean }
  | { type: 'enrage'; id: number }
  | { type: 'equip'; playerId: number };

// ───────────── ワールド ─────────────

export interface World {
  tick: number;
  rng: Rng;
  map: GameMap;
  mapDef: (typeof MAPS)[string];
  players: Player[];
  monsters: Monster[];
  strikes: Strike[];
  projectiles: Projectile[];
  drops: Drop[];
  spawns: SpawnState[];
  nextId: number;
  events: GameEvent[];
  content: Content;
}

const DT_SEC = (c: Content) => 1 / c.balance.tickRate;
const sec = (w: World, s: number) => Math.round(s * w.content.balance.tickRate);
const newId = (w: World) => w.nextId++;

export function createWorld(seed: number, mapId = 'garden', content: Content = CONTENT): World {
  const mapDef = MAPS[mapId];
  const w: World = {
    tick: 0, rng: new Rng(seed), map: buildMap(mapId, mapDef), mapDef,
    players: [], monsters: [], strikes: [], projectiles: [], drops: [],
    spawns: mapDef.spawns.map((s) => ({ ...s, monsterId: -1, respawnAt: 0 })),
    nextId: 1, events: [], content,
  };
  w.spawns.forEach((_, i) => spawnMonster(w, i));
  return w;
}

export function addPlayer(w: World, name: string): Player {
  const c = w.content;
  const pb = c.balance.player;
  const sp = w.mapDef.playerSpawn;
  const sword = createItem(newId(w), 'sword_iron', 'common', w.rng, c);
  const bow = createItem(newId(w), 'bow_short', 'common', w.rng, c);
  const staff = createItem(newId(w), 'staff_oak', 'common', w.rng, c);
  const armor = createItem(newId(w), 'armor_leather', 'common', w.rng, c);
  const equipment: Equipment = { weapon: sword, armor, accessory: null };
  const stats = derivePlayerStats(pb.baseStats, equipment, c);
  const p: Player = {
    id: newId(w), kind: 'player', name, x: sp.x, y: sp.y, r: 0.32, facing: Math.PI / 4,
    hp: stats.maxHp, stats, team: 0, dead: false, equipment, inventory: [bow, staff],
    mp: 0, maxMp: pb.maxMp, st: pb.maxStamina, maxSt: pb.maxStamina, stDelay: 0,
    attackCd: 0, skillCd: Array(pb.skillSlots).fill(0), skillCdMax: Array(pb.skillSlots).fill(1),
    lock: 0, dodgeTicks: 0, dodgeDir: { x: 0, y: 0 }, iframes: 0, respawnTicks: 0,
    spawnX: sp.x, spawnY: sp.y, moving: false,
  };
  w.players.push(p);
  return p;
}

/** プレイヤーの今の武器で使えるスキル（枠順） */
export function playerSkills(w: World, p: Player): (string | null)[] {
  const wt = p.equipment.weapon?.weaponType ?? 'oneHandSword';
  const list = w.content.weapons[wt].skills ?? [];
  return Array.from({ length: w.content.balance.player.skillSlots }, (_, i) => list[i] ?? null);
}

function spawnMonster(w: World, index: number) {
  const s = w.spawns[index];
  const def = w.content.monsters[s.monster];
  const m: Monster = {
    id: newId(w), kind: 'monster', defId: s.monster, x: s.x, y: s.y, r: def.radius, facing: w.rng.range(0, Math.PI * 2),
    hp: def.hp, stats: monsterStats(def), team: 1, dead: false, ai: 'wander', targetId: -1,
    homeX: s.x, homeY: s.y, wanderX: s.x, wanderY: s.y, timer: w.rng.int(0, 40), busy: 0, globalCd: 0, cds: {},
    pending: null, spawnIndex: index, enraged: false, moving: false,
  };
  s.monsterId = m.id;
  w.monsters.push(m);
  w.events.push({ type: 'spawn', id: m.id, boss: !!def.boss });
}

export function monsterStats(def: MonsterDef): CombatStats {
  return {
    atk: def.atk, matk: def.matk, def: def.def, mdef: def.mdef, critRate: def.critRate, critDamage: 1.5,
    maxHp: def.hp, element: def.element, moveSpeed: def.speed, attackSpeed: 1,
  };
}

export function findActor(w: World, id: number): Actor | undefined {
  return w.players.find((p) => p.id === id) ?? w.monsters.find((m) => m.id === id);
}

// ───────────── 1tick 進める ─────────────

export function step(w: World, inputs: Map<number, PlayerInput>): GameEvent[] {
  w.events = [];
  w.tick++;
  for (const p of w.players) updatePlayer(w, p, inputs.get(p.id) ?? emptyInput());
  for (const m of w.monsters) updateMonster(w, m);
  separateActors(w);
  updateStrikes(w);
  updateProjectiles(w);
  updateDrops(w);
  w.monsters = w.monsters.filter((m) => !m.dead);
  for (let i = 0; i < w.spawns.length; i++) {
    const s = w.spawns[i];
    if (s.monsterId === -1 && w.tick >= s.respawnAt) spawnMonster(w, i);
  }
  return w.events;
}

// ───────────── プレイヤー ─────────────

function len(x: number, y: number) { return Math.hypot(x, y); }

function nearestMonster(w: World, x: number, y: number, range: number): Monster | null {
  let best: Monster | null = null, bd = range;
  for (const m of w.monsters) {
    if (m.dead) continue;
    const d = len(m.x - x, m.y - y) - m.r;
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}

function recalcPlayer(w: World, p: Player) {
  const ratio = p.hp / p.stats.maxHp;
  p.stats = derivePlayerStats(w.content.balance.player.baseStats, p.equipment, w.content);
  p.hp = Math.max(1, Math.min(p.stats.maxHp, Math.round(p.stats.maxHp * ratio)));
}

function applyCommand(w: World, p: Player, cmd: Command) {
  if (cmd.type === 'equip') {
    const idx = p.inventory.findIndex((it) => it.uid === cmd.uid);
    if (idx < 0) return;
    const it = p.inventory[idx];
    const prev = p.equipment[it.slot];
    p.inventory.splice(idx, 1);
    if (prev) p.inventory.splice(idx, 0, prev);
    p.equipment[it.slot] = it;
    if (it.slot === 'weapon') { p.attackCd = 0; p.skillCd.fill(0); }
  } else if (cmd.type === 'unequip') {
    if (cmd.slot === 'weapon') return;
    const it = p.equipment[cmd.slot];
    if (!it || p.inventory.length >= w.content.balance.player.inventorySize) return;
    p.equipment[cmd.slot] = null;
    p.inventory.push(it);
  }
  recalcPlayer(w, p);
  w.events.push({ type: 'equip', playerId: p.id });
}

function updatePlayer(w: World, p: Player, input: PlayerInput) {
  const c = w.content, pb = c.balance.player;
  for (const cmd of input.commands) applyCommand(w, p, cmd);

  if (p.dead) {
    if (--p.respawnTicks <= 0) {
      p.dead = false; p.hp = p.stats.maxHp; p.st = p.maxSt; p.mp = 0;
      p.x = p.spawnX; p.y = p.spawnY; p.iframes = sec(w, 1.5);
      w.events.push({ type: 'respawn', id: p.id });
    }
    return;
  }

  if (p.attackCd > 0) p.attackCd--;
  for (let i = 0; i < p.skillCd.length; i++) if (p.skillCd[i] > 0) p.skillCd[i]--;
  if (p.lock > 0) p.lock--;
  if (p.iframes > 0) p.iframes--;
  if (p.stDelay > 0) p.stDelay--;
  else p.st = Math.min(p.maxSt, p.st + pb.staminaRegen * DT_SEC(c));

  // 移動入力
  let mx = input.move.x, my = input.move.y;
  const ml = len(mx, my);
  if (ml > 1) { mx /= ml; my /= ml; }

  // 回避
  if (input.dodge && p.dodgeTicks <= 0 && p.st >= pb.dodgeCost) {
    p.st -= pb.dodgeCost;
    p.stDelay = sec(w, pb.staminaRegenDelay);
    p.dodgeTicks = sec(w, pb.dodgeDuration);
    p.iframes = Math.max(p.iframes, sec(w, pb.dodgeIframes));
    p.lock = 0;
    const d = ml > 0.1 ? { x: mx / Math.max(ml, 1e-6), y: my / Math.max(ml, 1e-6) } : { x: Math.cos(p.facing), y: Math.sin(p.facing) };
    const dl = len(d.x, d.y) || 1;
    p.dodgeDir = { x: d.x / dl, y: d.y / dl };
    p.facing = Math.atan2(p.dodgeDir.y, p.dodgeDir.x);
    w.events.push({ type: 'dodge', id: p.id });
  }

  if (p.dodgeTicks > 0) {
    p.dodgeTicks--;
    const v = pb.dodgeSpeed * DT_SEC(c);
    moveCircle(w.map, p, p.r, p.dodgeDir.x * v, p.dodgeDir.y * v);
    p.moving = true;
    return;
  }

  const speed = p.lock > 0 ? 0 : p.stats.moveSpeed;
  p.moving = false;
  if (ml > 0.05 && speed > 0) {
    const v = speed * DT_SEC(c);
    p.moving = moveCircle(w.map, p, p.r, mx * v, my * v);
    p.facing = Math.atan2(my, mx);
  }

  if (p.lock > 0) return;

  const wt: WeaponType = p.equipment.weapon?.weaponType ?? 'oneHandSword';
  const wdef = c.weapons[wt];

  // 狙い
  const aimFor = (range: number): { dir: number; target: Monster | null } => {
    if (input.aim && len(input.aim.x, input.aim.y) > 0.01) return { dir: Math.atan2(input.aim.y, input.aim.x), target: null };
    const t = nearestMonster(w, p.x, p.y, Math.max(range + 1, pb.autoTargetRange));
    if (t) return { dir: Math.atan2(t.y - p.y, t.x - p.x), target: t };
    return { dir: p.facing, target: null };
  };

  // スキル
  if (input.skill >= 0) {
    const skillId = playerSkills(w, p)[input.skill];
    const sd = skillId ? c.skills[skillId] : null;
    if (sd && p.skillCd[input.skill] <= 0 && p.mp >= sd.mp) {
      p.mp -= sd.mp;
      const cd = sec(w, sd.cooldown);
      p.skillCd[input.skill] = cd;
      p.skillCdMax[input.skill] = cd;
      const a = aimFor(sd.range ?? 3);
      p.facing = a.dir;
      p.lock = sec(w, sd.lock ?? 0.2);
      p.attackCd = Math.max(p.attackCd, p.lock);
      launchAttack(w, p, sd, a.dir, a.target, wdef.damageType ?? 'physical', 0);
      w.events.push({ type: 'attack', src: p.id, dir: a.dir, skill: skillId, weapon: wt });
      return;
    }
  }

  // 通常攻撃
  if (input.attack && p.attackCd <= 0 && wdef.attack) {
    const atk = wdef.attack;
    const a = aimFor(atk.range ?? 2);
    p.facing = a.dir;
    p.attackCd = Math.max(1, Math.round(sec(w, atk.interval) / p.stats.attackSpeed));
    p.lock = sec(w, atk.lock ?? 0);
    launchAttack(w, p, atk, a.dir, a.target, wdef.damageType ?? 'physical', atk.mpGain);
    w.events.push({ type: 'attack', src: p.id, dir: a.dir, skill: null, weapon: wt });
  }
}

// ───────────── 攻撃の発生 ─────────────

function resolveElement(owner: Actor, el: AttackDef['element']): Element {
  if (!el || el === 'weapon') return owner.stats.element;
  return el;
}

/** 攻撃定義から strike / projectile を作る（プレイヤーとモンスターで共通） */
function launchAttack(
  w: World, owner: Actor, def: AttackDef, dir: number, target: Actor | null,
  defaultType: DamageType, mpGain: number, delayOverride?: number,
) {
  const combo = newId(w);
  const element = resolveElement(owner, def.element);
  const damageType = def.damageType ?? defaultType;
  if (def.delivery === 'strike') {
    const count = def.count ?? 1;
    const hits = def.hits ?? 1;
    const delay = delayOverride ?? sec(w, def.delay ?? 0);
    for (let n = 0; n < count; n++) {
      let x = owner.x, y = owner.y;
      if (def.anchor === 'aim') {
        if (target) { x = target.x; y = target.y; } else {
          const d = def.aimDistance ?? 4;
          x += Math.cos(dir) * d; y += Math.sin(dir) * d;
        }
      } else if (def.anchor === 'target' && target) {
        x = target.x; y = target.y;
        if (n > 0) {
          const s = def.scatter ?? 2;
          const ang = w.rng.range(0, Math.PI * 2), rr = w.rng.range(s * 0.4, s);
          x += Math.cos(ang) * rr; y += Math.sin(ang) * rr;
        }
      }
      w.strikes.push({
        id: newId(w), ownerId: owner.id, team: owner.team, x, y, dir,
        shape: def.shape ?? { type: 'circle', radius: 1 }, follow: !!def.follow,
        startTick: w.tick, nextTick: w.tick + delay, hitsLeft: hits, hitCount: hits * count,
        interval: Math.max(1, sec(w, def.interval ?? 0.1)), power: def.power, element, damageType,
        telegraph: !!def.telegraph, combo, mpGain,
      });
    }
  } else if (def.projectile) {
    const pd = def.projectile;
    const spreadRad = (pd.spread * Math.PI) / 180;
    for (let n = 0; n < pd.count; n++) {
      const a = pd.count > 1 ? dir - spreadRad / 2 + (spreadRad * n) / (pd.count - 1) : dir;
      const spd = pd.speed * DT_SEC(w.content);
      w.projectiles.push({
        id: newId(w), ownerId: owner.id, team: owner.team,
        x: owner.x + Math.cos(a) * owner.r, y: owner.y + Math.sin(a) * owner.r,
        vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, r: pd.radius,
        ticksLeft: Math.ceil(pd.range / spd), pierce: pd.pierce, hitIds: [],
        power: def.power, element, damageType, combo, hitCount: pd.count,
        explodeRadius: pd.explodeRadius ?? 0, sprite: pd.sprite, mpGain,
      });
    }
  }
}

function inShape(sx: number, sy: number, dir: number, shape: Shape, t: Actor): boolean {
  const dx = t.x - sx, dy = t.y - sy;
  const d = len(dx, dy);
  if (shape.type === 'circle') return d <= shape.radius + t.r;
  if (d > shape.range + t.r) return false;
  if (d < t.r + 0.25) return true;
  let diff = Math.atan2(dy, dx) - dir;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const half = (shape.arc * Math.PI) / 360 + Math.asin(Math.min(1, t.r / d));
  return Math.abs(diff) <= half;
}

function enemiesOf(w: World, team: 0 | 1): Actor[] {
  return team === 0 ? w.monsters.filter((m) => !m.dead) : w.players.filter((p) => !p.dead);
}

function updateStrikes(w: World) {
  const keep: Strike[] = [];
  for (const s of w.strikes) {
    const owner = findActor(w, s.ownerId);
    if (s.follow && owner && !owner.dead) { s.x = owner.x; s.y = owner.y; }
    if (w.tick < s.nextTick) { keep.push(s); continue; }
    // モンスターの予兆つき攻撃は、本人が倒れたら消える
    if (s.team === 1 && (!owner || owner.dead)) continue;
    w.events.push({ type: 'impact', src: s.ownerId, x: s.x, y: s.y, dir: s.dir, shape: s.shape, element: s.element, team: s.team });
    let hitAny = false;
    for (const t of enemiesOf(w, s.team)) {
      if (!inShape(s.x, s.y, s.dir, s.shape, t)) continue;
      if (owner) hitAny = applyHit(w, owner, t, s, s.combo, s.hitCount) || hitAny;
    }
    if (hitAny && s.mpGain > 0 && owner?.kind === 'player') {
      owner.mp = Math.min(owner.maxMp, owner.mp + s.mpGain);
      s.mpGain = 0;
    }
    s.hitsLeft--;
    if (s.hitsLeft > 0) { s.nextTick = w.tick + s.interval; keep.push(s); }
  }
  w.strikes = keep;
}

function projectileBlocked(m: GameMap, x: number, y: number): boolean {
  const i = Math.floor(x), j = Math.floor(y);
  return isSolid(m, i, j) && (m.sprites[j * m.width + i] !== null || i < 0 || j < 0 || i >= m.width || j >= m.height);
}

function updateProjectiles(w: World) {
  const keep: Projectile[] = [];
  for (const pr of w.projectiles) {
    pr.x += pr.vx; pr.y += pr.vy; pr.ticksLeft--;
    let alive = pr.ticksLeft > 0;
    const owner = findActor(w, pr.ownerId);
    if (projectileBlocked(w.map, pr.x, pr.y)) {
      alive = false;
      if (pr.explodeRadius > 0 && owner) explode(w, owner, pr);
    } else {
      for (const t of enemiesOf(w, pr.team)) {
        if (pr.hitIds.includes(t.id)) continue;
        if (len(t.x - pr.x, t.y - pr.y) > t.r + pr.r) continue;
        pr.hitIds.push(t.id);
        if (owner) {
          if (pr.explodeRadius > 0) { explode(w, owner, pr); alive = false; break; }
          const hit = applyHit(w, owner, t, pr, pr.combo, pr.hitCount);
          if (hit && pr.mpGain > 0 && owner.kind === 'player') {
            owner.mp = Math.min(owner.maxMp, owner.mp + pr.mpGain);
            pr.mpGain = 0;
          }
        }
        if (--pr.pierce <= 0) { alive = false; break; }
      }
    }
    if (alive) keep.push(pr);
  }
  w.projectiles = keep;
}

function explode(w: World, owner: Actor, pr: Projectile) {
  w.events.push({ type: 'explode', x: pr.x, y: pr.y, radius: pr.explodeRadius, element: pr.element });
  for (const t of enemiesOf(w, pr.team)) {
    if (len(t.x - pr.x, t.y - pr.y) <= pr.explodeRadius + t.r) applyHit(w, owner, t, pr, pr.combo, 1);
  }
}

/** 命中処理。当たったら true（回避されたら false） */
function applyHit(
  w: World, src: Actor, tgt: Actor,
  spec: { power: number; element: Element; damageType: DamageType }, combo: number, cnt: number,
): boolean {
  if (tgt.dead) return false;
  if (tgt.kind === 'player' && tgt.iframes > 0) {
    w.events.push({ type: 'evade', tgt: tgt.id, x: tgt.x, y: tgt.y });
    return false;
  }
  const r = computeDamage(src.stats, tgt.stats, spec, w.rng, w.content.balance.damage);
  tgt.hp -= r.amount;
  w.events.push({
    type: 'damage', src: src.id, tgt: tgt.id, amount: r.amount, crit: r.crit, weak: r.weak, resist: r.resist,
    element: spec.element, combo, cnt, x: tgt.x, y: tgt.y, toPlayer: tgt.kind === 'player',
  });
  if (tgt.kind === 'monster' && tgt.ai !== 'chase') { tgt.ai = 'chase'; tgt.targetId = src.id; }
  if (tgt.hp <= 0) kill(w, tgt, src);
  return true;
}

function kill(w: World, t: Actor, _by: Actor) {
  t.hp = 0;
  t.dead = true;
  if (t.kind === 'player') {
    t.respawnTicks = sec(w, w.content.balance.player.respawnTime);
    t.dodgeTicks = 0; t.lock = 0;
    w.events.push({ type: 'death', id: t.id, x: t.x, y: t.y, boss: false, player: true });
    return;
  }
  const def = w.content.monsters[t.defId];
  w.events.push({ type: 'death', id: t.id, x: t.x, y: t.y, boss: !!def.boss, player: false });
  w.strikes = w.strikes.filter((s) => s.ownerId !== t.id);
  const sp = w.spawns[t.spawnIndex];
  sp.monsterId = -1;
  sp.respawnAt = w.tick + sec(w, def.respawn);
  const items = rollDrops(def.drops, w.rng, () => newId(w), w.content);
  const sc = w.content.balance.drop.scatter;
  for (const item of items) {
    let x = t.x, y = t.y;
    for (let tries = 0; tries < 6; tries++) {
      const nx = t.x + w.rng.range(-sc, sc) * (items.length > 1 ? 2 : 1);
      const ny = t.y + w.rng.range(-sc, sc) * (items.length > 1 ? 2 : 1);
      if (!circleHitsMap(w.map, nx, ny, 0.2)) { x = nx; y = ny; break; }
    }
    const d: Drop = { id: newId(w), x, y, item, ticksLeft: sec(w, w.content.balance.drop.lifetime) };
    w.drops.push(d);
    w.events.push({ type: 'drop', id: d.id, rarity: item.rarity, x, y });
  }
}

function updateDrops(w: World) {
  const pr = w.content.balance.player.pickupRange;
  const max = w.content.balance.player.inventorySize;
  w.drops = w.drops.filter((d) => {
    if (--d.ticksLeft <= 0) return false;
    for (const p of w.players) {
      if (p.dead || p.inventory.length >= max) continue;
      if (len(p.x - d.x, p.y - d.y) <= pr) {
        p.inventory.push(d.item);
        w.events.push({ type: 'pickup', playerId: p.id, item: d.item });
        return false;
      }
    }
    return true;
  });
}

// ───────────── モンスターAI ─────────────

function updateMonster(w: World, m: Monster) {
  if (m.dead) return;
  const c = w.content;
  const def = c.monsters[m.defId];
  const mb = c.balance.monster;
  m.moving = false;
  for (const k in m.cds) if (m.cds[k] > 0) m.cds[k]--;
  if (m.globalCd > 0) m.globalCd--;

  if (def.boss && !m.enraged && m.hp / m.stats.maxHp < mb.enrageThreshold) {
    m.enraged = true;
    w.events.push({ type: 'enrage', id: m.id });
  }

  if (m.pending) {
    if (--m.pending.ticks <= 0) {
      const pa = m.pending.attack;
      const tgt = findActor(w, m.targetId) ?? null;
      const dir = tgt && !tgt.dead ? Math.atan2(tgt.y - m.y, tgt.x - m.x) : m.pending.dir;
      launchAttack(w, m, pa, dir, tgt, pa.damageType ?? 'physical', 0);
      m.pending = null;
    }
  }
  if (m.busy > 0) { m.busy--; return; }

  const distHome = len(m.x - m.homeX, m.y - m.homeY);

  if (m.ai === 'wander') {
    // 発見
    for (const p of w.players) {
      if (p.dead) continue;
      if (len(p.x - m.x, p.y - m.y) <= def.aggroRange && lineOfSight(w.map, m.x, m.y, p.x, p.y)) {
        m.ai = 'chase'; m.targetId = p.id; break;
      }
    }
    if (m.ai === 'wander') {
      if (--m.timer <= 0) {
        const ang = w.rng.range(0, Math.PI * 2), rr = w.rng.range(0, mb.wanderRadius);
        m.wanderX = m.homeX + Math.cos(ang) * rr; m.wanderY = m.homeY + Math.sin(ang) * rr;
        m.timer = sec(w, w.rng.range(2, 4.5));
      }
      moveToward(w, m, m.wanderX, m.wanderY, def.speed * mb.wanderSpeedRatio, 0.2);
      return;
    }
  }

  if (m.ai === 'chase') {
    const target = w.players.find((p) => p.id === m.targetId && !p.dead) ?? null;
    if (!target || distHome > def.leashRange) { m.ai = 'return'; m.targetId = -1; return; }
    const d = len(target.x - m.x, target.y - m.y);
    const dir = Math.atan2(target.y - m.y, target.x - m.x);
    m.facing = dir;
    // 攻撃を選ぶ
    if (m.globalCd <= 0) {
      const usable = def.attacks.filter((a) => (m.cds[a.id] ?? 0) <= 0 && d - target.r <= a.range);
      if (usable.length > 0) {
        const weights: Record<string, number> = {};
        for (const a of usable) weights[a.id] = a.weight;
        const a = usable.find((x) => x.id === w.rng.weighted(weights))!;
        const cdRatio = m.enraged ? mb.enrageCooldownRatio : 1;
        m.cds[a.id] = sec(w, a.cooldown * cdRatio);
        m.globalCd = sec(w, def.attackInterval * cdRatio);
        const windup = sec(w, a.windup * (m.enraged ? 0.85 : 1));
        if (a.delivery === 'strike') launchAttack(w, m, a, dir, target, a.damageType ?? 'physical', 0, windup);
        else m.pending = { attack: a, dir, ticks: windup };
        m.busy = windup + sec(w, mb.recovery);
        w.events.push({ type: 'attack', src: m.id, dir, skill: a.id, weapon: null });
        return;
      }
    }
    const keep = def.keepDistance ?? 0;
    if (keep > 0 && d < keep - 0.5) moveToward(w, m, m.x - Math.cos(dir), m.y - Math.sin(dir), def.speed * 0.7, 0);
    else if (d > Math.max(keep, m.r + target.r + 0.3)) moveToward(w, m, target.x, target.y, def.speed, 0);
    return;
  }

  if (m.ai === 'return') {
    m.hp = Math.min(m.stats.maxHp, m.hp + m.stats.maxHp * mb.hpRegenOnReturn * DT_SEC(c) * 4);
    if (distHome < 0.5) { m.ai = 'wander'; m.timer = 0; m.hp = m.stats.maxHp; m.enraged = false; return; }
    moveToward(w, m, m.homeX, m.homeY, def.speed * 1.3, 0.3);
  }
}

function moveToward(w: World, m: Monster, tx: number, ty: number, speed: number, stopDist: number) {
  const dx = tx - m.x, dy = ty - m.y;
  const d = len(dx, dy);
  if (d <= stopDist || d < 1e-4) return;
  const v = Math.min(d, speed * DT_SEC(w.content));
  m.facing = Math.atan2(dy, dx);
  let moved = moveCircle(w.map, m, m.r, (dx / d) * v, (dy / d) * v);
  if (!moved) {
    // 障害物に引っかかったら横に逃げる
    const side = (m.id % 2 === 0 ? 1 : -1) * Math.PI / 2;
    const a = Math.atan2(dy, dx) + side;
    moved = moveCircle(w.map, m, m.r, Math.cos(a) * v, Math.sin(a) * v);
  }
  m.moving = moved;
}

/** 生きているキャラ同士が重ならないよう少し押し合う */
function separateActors(w: World) {
  const all: Actor[] = [...w.players.filter((p) => !p.dead), ...w.monsters.filter((m) => !m.dead)];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = len(dx, dy), min = a.r + b.r;
      if (d >= min || d < 1e-6) continue;
      const push = (min - d) / 2;
      const nx = dx / d, ny = dy / d;
      const aw = a.kind === 'monster' && w.content.monsters[a.defId].boss ? 0 : 1;
      const bw = b.kind === 'monster' && w.content.monsters[b.defId].boss ? 0 : 1;
      if (aw + bw === 0) continue;
      const ra = aw / (aw + bw), rb = bw / (aw + bw);
      moveCircle(w.map, a, a.r, -nx * push * 2 * ra, -ny * push * 2 * ra);
      moveCircle(w.map, b, b.r, nx * push * 2 * rb, ny * push * 2 * rb);
    }
  }
}
