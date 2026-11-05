import type { Content } from '../content/types';
import { CONTENT } from '../content';
import { Rng } from '../rng';
import { buildMap, circleHitsMap } from '../map';
import type { AccountData, AreaInstance, CharacterData, GameEvent, Monster, Player, PlayerInput, SpawnState, World } from '../state';
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

export interface WorldOptions {
  account: AccountData;
  characterId: string;
  seed: number;
  now?: number;
  content?: Content;
}

export function createWorld(opts: WorldOptions): World {
  const content = opts.content ?? CONTENT;
  const char = opts.account.characters.find((c) => c.id === opts.characterId);
  if (!char) throw new Error('character not found');
  const w: World = {
    seed: opts.seed, tick: 0, clock: opts.now ?? 0, rng: new Rng(opts.seed), content, account: opts.account,
    area: null as unknown as AreaInstance, players: [], nextId: 1, events: [], lastWeatherSlot: -1, pendingTransition: null,
  };
  const p = makePlayer(w, char);
  w.players.push(p);
  let areaId = content.areas[char.location.area] ? char.location.area : content.balance.world.startArea;
  // ダンジョンなどの一時的な場所にいたら最後の街に戻す
  const t = content.areas[areaId]?.type;
  if (t === 'dungeon' || t === 'tower' || t === 'raid') areaId = char.visitedTowns.at(-1) ?? content.balance.world.startTown;
  enterArea(w, areaId, areaId === char.location.area ? { x: char.location.x, y: char.location.y } : null);
  w.events = [];
  return w;
}

export function makePlayer(w: World, char: CharacterData): Player {
  const stats = derivePlayerStats(char, [], w.content);
  return {
    id: newId(w), kind: 'player', char, x: 0, y: 0, r: 0.32, facing: Math.PI / 4,
    hp: char.hp > 0 ? Math.min(char.hp, stats.maxHp) : stats.maxHp, stats, team: 0, dead: false, statuses: [],
    stagger: 0, moving: false, statsDirty: false,
    mp: Math.min(char.mp ?? 0, stats.maxMp), st: stats.maxSt, stDelay: 0, attackCd: 0, chainIndex: 0, chainUntil: 0,
    skillCd: {}, skillCdMax: {}, lock: 0, dodgeTicks: 0, dodgeDir: { x: 0, y: 0 }, dashSpeed: 0, iframes: 0,
    respawnTicks: 0, prevAttack: false, charge: 0, ammo: -1, reloadTicks: 0, combo: 0, comboUntil: 0, rhythm: 0,
    lastDodgeTick: -9999, lastCombatTick: -9999, regenAcc: 0, condKey: '', cheatDeathAt: -1e9,
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
    npcs: (def.npcs ?? []).map((n) => ({ id: newId(w), npc: n.npc, x: n.x, y: n.y })),
    spawns: (def.spawns ?? []).map((s, i): SpawnState => ({
      key: `${areaId}:${i}`, monster: s.monster, x: s.x, y: s.y, level: s.level, monsterId: -1, respawnAt: 0,
    })),
    playerSpawn: { ...playerSpawn },
    safeRadius: def.safeRadius ?? 0,
    exits: [...(gen?.exits ?? []), ...(def.exits ?? [])],
    spawnPoints,
    spots: { ...(gen?.spots ?? {}) },
    spawnTimer: 0,
    fieldBossSlot: -1,
  };
  return area;
}

/**
 * エリアに入る。pos が歩ける場所ならそこ、spawn 名があればその出現位置、どちらもなければ入口。
 */
export function enterArea(w: World, areaId: string, pos: { x: number; y: number } | string | null, area?: AreaInstance) {
  w.area = area ?? buildArea(w, areaId);
  for (const sp of w.area.spawns) spawnMonster(w, sp);
  const def = w.content.areas[areaId];
  for (const p of w.players) {
    let at = w.area.playerSpawn;
    if (typeof pos === 'string' && w.area.spawnPoints[pos]) at = w.area.spawnPoints[pos];
    else if (pos && typeof pos === 'object' && !circleHitsMap(w.area.map, pos.x, pos.y, p.r)) at = pos;
    p.x = at.x; p.y = at.y;
    p.dodgeTicks = 0;
    p.lock = 0;
    p.char.location = { area: w.area.id, x: p.x, y: p.y };
    if (def?.type === 'town' && !p.char.visitedTowns.includes(areaId)) {
      p.char.visitedTowns.push(areaId);
      w.events.push({ type: 'notice', playerId: p.id, key: 'notice.townVisited', args: [def.name] });
    }
    w.events.push({ type: 'areaChanged', playerId: p.id, area: w.area.id });
  }
  // フィールドは最初からある程度いる
  if (w.area.type === 'field' && def?.monsters) {
    for (let i = 0; i < (def.density ?? 0); i++) spawnFieldMonster(w);
    updateFieldBoss(w);
  }
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
    brokenUntil: 0, scale, damageBy: {}, hidden: false, fieldBoss: false,
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
  for (const p of w.players) updatePlayer(w, p, inputs.get(p.id) ?? emptyInput());
  if (w.pendingTransition) {
    const t = w.pendingTransition;
    w.pendingTransition = null;
    enterArea(w, t.to, t.spawn || null);
    return w.events;
  }
  for (const m of area.monsters) updateMonster(w, m);
  separateActors(w);
  updateStrikes(w);
  updateProjectiles(w);
  for (const a of [...w.players, ...area.monsters]) if (!a.dead) tickStatuses(w, a, (t, n, id, src) => dealDot(w, t, n, id, src));
  updateDrops(w);
  area.monsters = area.monsters.filter((m) => !m.dead);
  for (const sp of area.spawns) {
    if (sp.monsterId === -1 && w.tick >= sp.respawnAt) spawnMonster(w, sp);
  }
  updateField(w);
  for (const fn of areaUpdaters) fn(w);
  for (const p of w.players) p.char.playTime += 1 / w.content.balance.tickRate;
  return w.events;
}

/** 保存の前に、実行中の状態をキャラクターデータへ書き戻す */
export function syncCharacters(w: World) {
  for (const p of w.players) {
    p.char.location = { area: w.area.id, x: p.x, y: p.y };
    p.char.hp = p.dead ? 0 : Math.round(p.hp);
    p.char.mp = Math.round(p.mp);
  }
}

export const secTicks = sec;
