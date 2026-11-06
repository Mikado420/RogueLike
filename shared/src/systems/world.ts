import type { Content } from '../content/types';
import { CONTENT } from '../content';
import { Rng } from '../rng';
import { buildMap, circleHitsMap, type GameMap } from '../map';
import type { AccountData, AreaInstance, CharacterData, GameEvent, InstanceSpec, Monster, Player, PlayerInput, SharedWorldState, SpawnState, Transition, World } from '../state';
import { emptyInput } from '../state';
import { derivePlayerStats, difficultyScale, monsterStats, type MonsterScale } from './stats';
import { updatePlayer } from './player';
import { separateActors, updateMonster } from './ai';
import { dealDot, updateProjectiles, updateStrikes } from './combat';
import { tickStatuses } from './status';
import { updateDrops } from './items';
import { newId, sec } from './util';
import type { Difficulty } from '../core';
import type { AreaDef } from '../content/types';
import { generateField, type GeneratedField } from '../mapgen';
import { spawnFieldMonster, updateField, updateFieldBoss, updateWeatherNotices } from './spawner';
import { buildInstance, updateInstance } from './instance';
import { ensureMissions } from './quest';
import { placeNodes, updateNodes } from './crafting';
import { updatePets } from './pets';
import { updateTutorial } from './tutorial';

export interface WorldOptions {
  account: AccountData;
  characterId: string;
  seed: number;
  now?: number;
  content?: Content;
}

export interface AreaWorldOptions {
  areaId: string;
  seed: number;
  now?: number;
  content?: Content;
  /** ダンジョン・塔・レイドのとき */
  instance?: InstanceSpec;
  /** ワールド全体で共有するもの（なければ新しく作る） */
  shared?: SharedWorldState;
}

export const newSharedState = (): SharedWorldState => ({ fieldBoss: {} });

/** 1つのエリアのワールドを作る（まだ誰もいない） */
export function createAreaWorld(opts: AreaWorldOptions): World {
  const content = opts.content ?? CONTENT;
  const w: World = {
    seed: opts.seed, tick: 0, clock: opts.now ?? 0, rng: new Rng(opts.seed), uidRng: new Rng((opts.seed ^ 0x5bd1e995) >>> 0), content,
    area: null as unknown as AreaInstance, players: [], pets: [], nextId: 1, events: [], lastWeatherSlot: -1,
    shared: opts.shared ?? newSharedState(),
  };
  if (opts.instance) {
    buildInstance(w, opts.instance);
  } else {
    w.area = buildArea(w, opts.areaId);
    for (const sp of w.area.spawns) spawnMonster(w, sp);
    const def = content.areas[opts.areaId];
    // フィールドは最初からある程度いる
    if (w.area.type === 'field' && def?.monsters) {
      for (let i = 0; i < (def.density ?? 0); i++) spawnFieldMonster(w);
      updateFieldBoss(w);
    }
  }
  w.events = [];
  return w;
}

/** キャラクターが最後にいた場所（一時的な場所なら最後の街） */
export function resolveLocation(char: CharacterData, content: Content): { area: string; pos: { x: number; y: number } | null } {
  let areaId = content.areas[char.location.area] ? char.location.area : content.balance.world.startArea;
  const t = content.areas[areaId]?.type;
  if (t === 'dungeon' || t === 'tower' || t === 'raid') areaId = char.visitedTowns.at(-1) ?? content.balance.world.startTown;
  return { area: areaId, pos: areaId === char.location.area ? { x: char.location.x, y: char.location.y } : null };
}

/**
 * プレイヤーをこのエリアに入れる。pos が歩ける場所ならそこ、spawn 名があればその出現位置、どちらもなければ入口。
 */
export function addPlayer(w: World, account: AccountData, characterId: string, at: { x: number; y: number } | string | null): Player {
  const char = account.characters.find((c) => c.id === characterId);
  if (!char) throw new Error('character not found');
  const p = makePlayer(w, char, account);
  placePlayer(w, p, at);
  return p;
}

/** できているプレイヤー（別のエリアから来た）をこのエリアに置く */
export function placePlayer(w: World, p: Player, at: { x: number; y: number } | string | null) {
  p.id = newId(w);
  p.transition = null;
  p.dodgeTicks = 0;
  p.lock = 0;
  w.players.push(p);
  let pos = w.area.playerSpawn;
  if (typeof at === 'string' && w.area.spawnPoints[at]) pos = w.area.spawnPoints[at];
  else if (at && typeof at === 'object' && !circleHitsMap(w.area.map, at.x, at.y, p.r)) pos = at;
  p.x = pos.x; p.y = pos.y;
  p.char.location = { area: w.area.id, x: p.x, y: p.y };
  const def = w.content.areas[w.area.id];
  if (def?.type === 'town' && !p.char.visitedTowns.includes(w.area.id)) {
    p.char.visitedTowns.push(w.area.id);
    w.events.push({ type: 'notice', playerId: p.id, key: 'notice.townVisited', args: [def.name] });
  }
  // チュートリアル中は、入口の安全地帯に練習用のスライムを 1 体置く（安全地帯では襲ってこない）
  spawnPracticeTarget(w, p);
  // 塔の階は入った人を狙ってくる
  if (w.area.instance?.kind === 'tower') {
    for (const m of w.area.monsters) if (m.targetId === -1 && m.ai === 'chase') m.targetId = p.id;
    if (w.area.instance.floor > 1) w.events.push({ type: 'instance', playerId: p.id, what: 'floor', floor: w.area.instance.floor });
  }
  w.events.push({ type: 'areaChanged', playerId: p.id, area: w.area.id });
}

/** 保存の前に、実行中の状態を1人ぶんキャラクターデータへ書き戻す */
export function syncPlayer(w: World, p: Player) {
  p.char.location = { area: w.area.id, x: p.x, y: p.y };
  p.char.hp = p.dead ? 0 : Math.round(p.hp);
  p.char.mp = Math.round(p.mp);
}

/**
 * プレイヤーをこのエリアから取り出す（キャラデータを書き戻して返す）。
 * ペットも消え、魔物の狙いも外れる。
 */
export function removePlayer(w: World, playerId: number): { account: AccountData; char: CharacterData; transition: Transition | null; player: Player } | null {
  const p = w.players.find((x) => x.id === playerId);
  if (!p) return null;
  syncPlayer(w, p);
  w.players = w.players.filter((x) => x !== p);
  w.pets = w.pets.filter((x) => x.summonedBy !== p.id);
  for (const m of w.area.monsters) if (m.targetId === p.id) { m.targetId = -1; if (m.ai === 'chase') m.ai = 'return'; }
  return { account: p.account, char: p.char, transition: p.transition, player: p };
}

/** ひとりで遊ぶとき用：ワールドを作ってキャラを入れる */
export function createWorld(opts: WorldOptions): World {
  const content = opts.content ?? CONTENT;
  const char = opts.account.characters.find((c) => c.id === opts.characterId);
  if (!char) throw new Error('character not found');
  const loc = resolveLocation(char, content);
  const w = createAreaWorld({ areaId: loc.area, seed: opts.seed, now: opts.now, content });
  addPlayer(w, opts.account, char.id, loc.pos);
  w.events = [];
  return w;
}

/**
 * ひとり用：このワールドを丸ごと別のエリアに作り替えて、いたプレイヤーを入れ直す
 * （サーバーでは LocalServer / AreaDO がワールドをまたいで移す）
 */
export function moveSolo(w: World, t: Transition) {
  const out = [...w.players].map((p) => removePlayer(w, p.id)!);
  const keep = w.events;
  const next = createAreaWorld({ areaId: t.instance ? 'instance' : t.to, seed: w.rng.int(1, 2 ** 30), now: w.clock, content: w.content, instance: t.instance, shared: w.shared });
  next.tick = w.tick;
  if (next.area.instance) {
    const dt = w.tick - next.area.instance.startTick;
    next.area.instance.startTick += dt;
    if (next.area.instance.timeLimitTick) next.area.instance.timeLimitTick += dt;
  }
  Object.assign(w, next);
  w.events = keep;
  for (const o of out) placePlayer(w, o.player, t.pos ?? (t.spawn || null));
}

/** ひとり用：移動待ちがあれば移す */
export function flushSolo(w: World): boolean {
  const t = w.players.find((p) => p.transition)?.transition;
  if (!t) return false;
  moveSolo(w, t);
  return true;
}

/** 互換用：ひとりで遊ぶワールドを別のエリアへ（テストと開発用） */
export function enterArea(w: World, areaId: string, pos: { x: number; y: number } | string | null) {
  moveSolo(w, { to: areaId, spawn: typeof pos === 'string' ? pos : '', pos: pos && typeof pos === 'object' ? pos : undefined });
}

/** ひとり用の1tick：step のあと移動を処理する */
export function stepSolo(w: World, inputs: Map<number, PlayerInput>, now?: number): GameEvent[] {
  step(w, inputs, now);
  flushSolo(w);
  return w.events;
}

export function makePlayer(w: World, char: CharacterData, account: AccountData): Player {
  const stats = derivePlayerStats(char, [], w.content);
  return {
    id: newId(w), kind: 'player', char, account, transition: null, partyId: null, guildBase: null, rescuer: false, stall: null, x: 0, y: 0, r: 0.32, facing: Math.PI / 4,
    hp: char.hp > 0 ? Math.min(char.hp, stats.maxHp) : stats.maxHp, stats, team: 0, dead: false, statuses: [],
    stagger: 0, moving: false, statsDirty: false,
    mp: char.playTime > 0 ? Math.min(char.mp ?? 0, stats.maxMp) : stats.maxMp, st: stats.maxSt, stDelay: 0, attackCd: 0, chainIndex: 0, chainUntil: 0,
    skillCd: {}, skillCdMax: {}, lock: 0, dodgeTicks: 0, dodgeDir: { x: 0, y: 0 }, dashSpeed: 0, iframes: 0,
    respawnTicks: 0, prevAttack: false, charge: 0, ammo: -1, reloadTicks: 0, combo: 0, comboUntil: 0, rhythm: 0,
    lastDodgeTick: -9999, lastCombatTick: -9999, regenAcc: 0, condKey: '', cheatDeathAt: -1e9, tutPos: { x: 0, y: 0 },
  };
}

const genCache = new Map<string, GeneratedField>();

/** 自動生成のフィールド（同じ id なら同じ地形） */
export function fieldLayout(c: Content, areaId: string): GeneratedField | null {
  const def = c.areas[areaId];
  if (!def?.gen) return null;
  let g = genCache.get(areaId);
  if (!g) {
    const spots: Record<string, [number, number, number]> = {};
    if (def.fieldBoss) spots.boss = [def.fieldBoss.spot[0], def.fieldBoss.spot[1], 6];
    if (def.gate) spots.gate = [def.gate.spot[0], def.gate.spot[1], 2];
    for (const [k, v] of Object.entries(extraSpots(def))) spots[k] = v;
    g = generateField(areaId, def.gen, c.palettes[def.gen.palette], def.genExits ?? [], spots);
    genCache.set(areaId, g);
  }
  return g;
}

/** 採集ポイントなど、後から足す開けた場所 */
type SpotProvider = (def: AreaDef) => Record<string, [number, number, number]>;
const spotProviders: SpotProvider[] = [];
export function registerSpots(fn: SpotProvider) { spotProviders.push(fn); genCache.clear(); }
function extraSpots(def: AreaDef): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {};
  for (const f of spotProviders) Object.assign(out, f(def));
  return out;
}

function spawnPracticeTarget(w: World, p: Player) {
  const c = w.content;
  const t = p.char.tutorial;
  const attackStep = c.tutorial.steps.findIndex((s) => s.type === 'hit');
  if (t.done || w.area.id !== c.tutorial.area || w.area.type !== 'field' || attackStep < 0 || t.step > attackStep || !c.monsters.slime) return;
  const key = `practice:${p.char.id}`;
  if (w.area.monsters.some((m) => !m.dead && m.spawnKey === key)) return;
  const cx = w.area.map.width / 2, cy = w.area.map.height / 2;
  const base = Math.atan2(cy - p.y, cx - p.x);
  for (const off of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, Math.PI]) {
    const x = p.x + Math.cos(base + off) * 3, y = p.y + Math.sin(base + off) * 3;
    if (circleHitsMap(w.area.map, x, y, 0.6)) continue;
    spawnMonster(w, { key, monster: 'slime', x, y, level: [1, 1], monsterId: -1, respawnAt: 0 }, { level: 1 });
    return;
  }
}

/** エリアを作る（マップ・NPC・モンスター） */
export function buildArea(w: World, areaId: string): AreaInstance {
  const c = w.content;
  const def = c.areas[areaId];
  const gen = fieldLayout(c, areaId);
  const map = gen ? { ...gen.map, tiles: [...gen.map.tiles], solid: [...gen.map.solid], sprites: [...gen.map.sprites] } : buildMap(areaId, c.maps[def.map!]);
  const spawnPoints = { ...(gen?.spawnPoints ?? {}), ...(def.spawnPoints ?? {}) };
  const firstExit = def.genExits?.[0]?.edge;
  const playerSpawn = def.playerSpawn ?? (firstExit ? spawnPoints[firstExit] : null) ?? { x: map.width / 2, y: map.height / 2 };
  const area: AreaInstance = {
    id: areaId, type: def.type, name: def.name, map, level: def.level,
    monsters: [], strikes: [], projectiles: [], drops: [],
    npcs: [
      ...(def.npcs ?? []).map((n) => ({ id: newId(w), npc: n.npc, x: n.x, y: n.y })),
      ...(def.gate && gen?.spots.gate ? [{ id: newId(w), npc: 'dungeon_gate', x: gen.spots.gate.x, y: gen.spots.gate.y, data: def.gate.dungeon }] : []),
    ],
    spawns: (def.spawns ?? []).map((s, i): SpawnState => ({
      key: `${areaId}:${i}`, monster: s.monster, x: s.x, y: s.y, level: s.level, monsterId: -1, respawnAt: 0,
    })),
    playerSpawn: { ...playerSpawn },
    safeRadius: def.safeRadius ?? (def.type === 'field' ? 8 : 0),
    exits: [...(gen?.exits ?? []), ...(def.exits ?? [])],
    spawnPoints,
    spots: { ...(gen?.spots ?? {}) },
    spawnTimer: 0,
    fieldBossSlot: -1,
    instance: null,
    safeZones: [],
    safeZoneAt: 0,
    safeZonePower: 0,
    safeZoneOwner: -1,
    nodes: placeNodes(w, areaId, map),
  };
  return area;
}

/** ダンジョン・塔・レイド用の空のエリアを作る */
export function makeArea(w: World, type: AreaInstance['type'], name: string, map: GameMap, spawn: { x: number; y: number }, level: [number, number]): AreaInstance {
  return {
    id: 'instance', type, name, map, level, monsters: [], strikes: [], projectiles: [], drops: [], npcs: [], spawns: [],
    playerSpawn: { ...spawn }, safeRadius: 0, exits: [], spawnPoints: {}, spots: {}, spawnTimer: 0, fieldBossSlot: -1,
    instance: null, safeZones: [], safeZoneAt: 0, safeZonePower: 0, safeZoneOwner: -1, nodes: [],
  };
}

/** 出口に入ったか */
export function exitAt(w: World, x: number, y: number) {
  return w.area.exits.find((e) => x >= e.rect[0] && x < e.rect[2] && y >= e.rect[1] && y < e.rect[3]) ?? null;
}

export interface SpawnOpts { level?: number; elite?: boolean; difficulty?: Difficulty; scale?: Partial<MonsterScale> }

export function spawnMonster(w: World, sp: SpawnState, opts: SpawnOpts = {}): Monster {
  const c = w.content;
  const def = c.monsters[sp.monster];
  const mb = c.balance.monster;
  const level = opts.level ?? w.rng.int(sp.level[0], sp.level[1]);
  const difficulty = opts.difficulty ?? 'normal';
  const base = difficultyScale(c, difficulty);
  const eliteMul = opts.elite ? mb.eliteMul : 1;
  const scale: MonsterScale = {
    hp: base.hp * eliteMul * (opts.scale?.hp ?? 1),
    atk: base.atk * (opts.elite ? mb.eliteAtkMul : 1) * (opts.scale?.atk ?? 1),
    def: base.def * (opts.scale?.def ?? 1),
    exp: base.exp * (opts.scale?.exp ?? 1),
    gold: base.gold * (opts.scale?.gold ?? 1),
  };
  const stats = monsterStats(def, level, c, scale);
  const poiseMax = Math.max(1, Math.round(mb.poiseBase * (1 + mb.poisePerLevel * level) * def.poise * (opts.elite ? mb.elitePoiseMul : 1)));
  const m: Monster = {
    id: newId(w), kind: 'monster', defId: sp.monster, level, elite: !!opts.elite, difficulty,
    x: sp.x, y: sp.y, r: def.radius * (opts.elite ? mb.eliteRadiusMul : 1), facing: w.rng.range(0, Math.PI * 2),
    hp: stats.maxHp, stats, team: 1, dead: false, statuses: [], stagger: 0, moving: false, statsDirty: false,
    ai: 'wander', targetId: -1, homeX: sp.x, homeY: sp.y, wanderX: sp.x, wanderY: sp.y,
    timer: w.rng.int(0, 40), busy: 0, globalCd: 0, cds: {}, pending: null, spawnKey: sp.key,
    enraged: false, poise: poiseMax, poiseMax, breaks: 0, lastHitTick: 0, phase: 0, shielded: false,
    brokenUntil: 0, scale, damageBy: {}, hidden: false, fieldBoss: false, summonedBy: -1,
  };
  sp.monsterId = m.id;
  w.area.monsters.push(m);
  w.events.push({ type: 'spawn', id: m.id, boss: !!def.boss });
  return m;
}

/** エリアごとの追加の更新（フィールドの湧き・ダンジョンの進行など）。後のシステムがここに足す */
type AreaUpdater = (w: World) => void;
const areaUpdaters: AreaUpdater[] = [];
export function registerAreaUpdater(fn: AreaUpdater) { areaUpdaters.push(fn); }

/**
 * 1tick 進める。now を渡すとその時刻（ミリ秒）に合わせる（昼夜・天候の基準）。
 */
export function step(w: World, inputs: Map<number, PlayerInput>, now?: number): GameEvent[] {
  w.events = [];
  w.tick++;
  w.clock = now ?? w.clock + 1000 / w.content.balance.tickRate;
  const area = w.area;
  updateWeatherNotices(w);
  // 移動待ちのプレイヤーは動かさない（ホストが取り出す）
  for (const p of w.players) if (!p.transition) updatePlayer(w, p, inputs.get(p.id) ?? emptyInput());
  for (const m of area.monsters) updateMonster(w, m);
  separateActors(w);
  updatePets(w);
  updateStrikes(w);
  updateProjectiles(w);
  for (const a of [...w.players, ...area.monsters]) if (!a.dead) tickStatuses(w, a, (t, n, id, src) => dealDot(w, t, n, id, src));
  updateDrops(w);
  area.monsters = area.monsters.filter((m) => !m.dead);
  for (const sp of area.spawns) {
    if (sp.monsterId === -1 && w.tick >= sp.respawnAt) spawnMonster(w, sp);
  }
  if (w.tick % 20 === 0) for (const p of w.players) ensureMissions(w, p);
  updateField(w);
  updateInstance(w);
  updateNodes(w);
  for (const fn of areaUpdaters) fn(w);
  for (const p of w.players) { p.char.playTime += 1 / w.content.balance.tickRate; updateTutorial(w, p); }
  return w.events;
}

/** 保存の前に、実行中の状態をキャラクターデータへ書き戻す */
export function syncCharacters(w: World) {
  for (const p of w.players) syncPlayer(w, p);
}

export const secTicks = sec;
