import type { Difficulty } from '../core';
import type { Monster, Player, World } from '../state';
import { generateArena, generateDungeon } from '../mapgen';
import { enterArea, makeArea, spawnMonster } from './world';
import { createSetPiece, rollEquipDrops } from './loot';
import { placeDrop } from './rewards';
import { addCounter, setCounterMax } from './counters';
import { newId, newUid, sec } from './util';

/**
 * ダンジョン・無限の塔・レイド（一時的なエリア＝インスタンス）。
 * 入るたびにシードを変えて作る。クリアすると出口（塔は次の階段も）が出る。
 */

function returnPoint(w: World, p: Player) {
  const cur = w.area.instance?.returnTo;
  return cur ?? { area: w.area.id, spawn: null, x: p.x, y: p.y };
}

function spawnIn(w: World, monster: string, x: number, y: number, level: number, difficulty: Difficulty, boss = false, elite = false): Monster {
  const m = spawnMonster(w, { key: 'inst', monster, x, y, level: [level, level], monsterId: -1, respawnAt: 0 }, { level, difficulty, elite });
  if (boss) { m.ai = 'wander'; }
  return m;
}

export function enterDungeon(w: World, p: Player, dungeonId: string, difficulty: Difficulty): string | null {
  const c = w.content;
  const def = c.dungeons.dungeons[dungeonId];
  const dd = c.difficulties[difficulty];
  if (!def || !dd) return 'err.invalid';
  const level = def.level + dd.levelBonus;
  const seed = w.rng.int(1, 2 ** 30);
  const rng = w.rng;
  const gen = generateDungeon('dungeon', seed, rng.int(def.rooms[0], def.rooms[1]));
  const ret = returnPoint(w, p);
  const area = makeArea(w, 'dungeon', def.name, gen.map, { x: gen.start.cx, y: gen.start.cy }, [level, level]);
  area.instance = {
    kind: 'dungeon', id: dungeonId, difficulty, floor: 0, level, startTick: w.tick, endTick: 0, bossId: -1,
    cleared: false, failed: false, returnTo: ret, timeLimitTick: 0,
  };
  enterArea(w, 'instance', null, area);
  const [pmin, pmax] = c.dungeons.packs;
  for (const r of gen.rooms) {
    if (r === gen.start || r === gen.boss) continue;
    const n = rng.int(pmin, pmax);
    for (let i = 0; i < n; i++) {
      const x = r.x + 1.5 + rng.next() * (r.w - 3), y = r.y + 1.5 + rng.next() * (r.h - 3);
      if (w.area.map.solid[Math.floor(y) * w.area.map.width + Math.floor(x)]) continue;
      spawnIn(w, rng.pick(def.monsters), x, y, level + rng.int(-1, 1), difficulty, false, rng.chance(c.balance.world.eliteChance * 2));
    }
  }
  const boss = spawnIn(w, def.boss, gen.boss.cx, gen.boss.cy, level + 2, difficulty, true);
  area.instance.bossId = boss.id;
  return null;
}

/** 塔の階を作る */
function towerFloor(w: World, floor: number, ret: ReturnType<typeof returnPoint>) {
  const c = w.content;
  const t = c.tower;
  const level = Math.min(t.maxLevel, Math.round(t.baseLevel + floor * t.levelPerFloor));
  const size = w.rng.int(t.arena[0], t.arena[1]);
  const map = generateArena('tower', w.rng.int(1, 2 ** 30), size, ['tower', 'rune'], w.rng.int(2, 6));
  const center = { x: map.width / 2, y: map.height / 2 };
  const spawn = { x: center.x, y: center.y + size / 2 - 2.5 };
  const area = makeArea(w, 'tower', `${t.name} ${floor}F`, map, spawn, [level, level]);
  area.instance = {
    kind: 'tower', id: 'tower', difficulty: 'normal', floor, level, startTick: w.tick, endTick: 0, bossId: -1,
    cleared: false, failed: false, returnTo: ret, timeLimitTick: 0,
  };
  enterArea(w, 'instance', null, area);
  const bossFloor = floor % t.bossEvery === 0;
  if (bossFloor) {
    const boss = spawnIn(w, t.bosses[(floor / t.bossEvery - 1) % t.bosses.length], center.x, center.y - 2, level + 2, 'normal', true);
    area.instance.bossId = boss.id;
  } else {
    const n = Math.min(t.monstersMax, Math.round(t.monstersBase + floor * t.monstersPerFloor));
    for (let i = 0; i < n; i++) {
      const a = w.rng.range(0, Math.PI * 2), r = w.rng.range(1.5, size / 2 - 3);
      const x = center.x + Math.cos(a) * r, y = center.y - 2 + Math.sin(a) * r * 0.6;
      if (map.solid[Math.floor(y) * map.width + Math.floor(x)]) continue;
      const m = spawnIn(w, w.rng.pick(t.pool), x, y, level, 'normal');
      m.ai = 'chase';
      m.targetId = w.players[0]?.id ?? -1;
    }
  }
}

export function canStartTower(w: World, p: Player, floor: number): boolean {
  const t = w.content.tower;
  if (floor === 1) return true;
  return (floor - 1) % t.checkpointEvery === 0 && floor <= p.char.tower.best + 1;
}

export function enterTower(w: World, p: Player, floor: number): string | null {
  if (!canStartTower(w, p, floor)) return 'err.invalid';
  towerFloor(w, floor, returnPoint(w, p));
  return null;
}

export function nextTowerFloor(w: World, p: Player): string | null {
  const inst = w.area.instance;
  if (!inst || inst.kind !== 'tower' || !inst.cleared) return 'err.invalid';
  towerFloor(w, inst.floor + 1, inst.returnTo);
  w.events.push({ type: 'instance', playerId: p.id, what: 'floor', floor: inst.floor + 1 });
  return null;
}

export function enterRaid(w: World, p: Player, raidId: string, difficulty: Difficulty): string | null {
  const c = w.content;
  const def = c.raids[raidId];
  const dd = c.difficulties[difficulty];
  if (!def || !dd) return 'err.invalid';
  if (p.char.level < def.minLevel) return 'err.levelLow';
  const level = def.level + dd.levelBonus;
  const map = generateArena('raid', w.rng.int(1, 2 ** 30), def.arena, ['rune', 'tower'], 4);
  const center = { x: map.width / 2, y: map.height / 2 };
  const area = makeArea(w, 'raid', def.name, map, { x: center.x, y: center.y + def.arena / 2 - 3 }, [level, level]);
  area.instance = {
    kind: 'raid', id: raidId, difficulty, floor: 0, level, startTick: w.tick, endTick: 0, bossId: -1,
    cleared: false, failed: false, returnTo: returnPoint(w, p), timeLimitTick: w.tick + sec(w, def.timeLimit),
  };
  enterArea(w, 'instance', null, area);
  // 段階4で人数に応じて HP を増やす（今はひとり）
  const players = Math.max(1, w.players.length);
  const boss = spawnMonster(w, { key: 'raid', monster: def.boss, x: center.x, y: center.y - 3, level: [level, level], monsterId: -1, respawnAt: 0 },
    { level, difficulty, scale: { hp: 1 + (players - 1) * def.party.hpPerPlayer, atk: 1 + (players - 1) * def.party.atkPerPlayer } });
  area.instance.bossId = boss.id;
  return null;
}

export function leaveInstance(w: World, p: Player): string | null {
  const inst = w.area.instance;
  if (!inst) return 'err.invalid';
  const r = inst.returnTo;
  w.pendingTransition = { to: r.area, spawn: r.spawn ?? '', pos: r.spawn ? undefined : { x: r.x, y: r.y } };
  void p;
  return null;
}

function addPortal(w: World, npc: string, x: number, y: number) {
  w.area.npcs.push({ id: newId(w), npc, x, y });
}

/** クリア判定と報酬 */
export function updateInstance(w: World) {
  const inst = w.area.instance;
  if (!inst || inst.cleared || inst.failed) return;
  const c = w.content;
  const p = w.players[0];
  if (!p) return;
  if (inst.kind === 'raid' && w.tick >= inst.timeLimitTick) {
    inst.failed = true;
    inst.endTick = w.tick;
    w.events.push({ type: 'instance', playerId: p.id, what: 'failed' });
    for (const m of w.area.monsters) { m.dead = true; m.hp = 0; }
    addPortal(w, 'exit_portal', w.area.playerSpawn.x, w.area.playerSpawn.y - 1);
    return;
  }
  const bossAlive = inst.bossId >= 0 && w.area.monsters.some((m) => m.id === inst.bossId && !m.dead);
  const done = inst.kind === 'tower' && inst.bossId < 0 ? w.area.monsters.every((m) => m.dead) : inst.bossId >= 0 && !bossAlive;
  if (!done) return;
  inst.cleared = true;
  inst.endTick = w.tick;
  const time = (inst.endTick - inst.startTick) / c.balance.tickRate;
  const dd = c.difficulties[inst.difficulty];
  const mods = { ...p.stats.m, rareRatePct: (p.stats.m.rareRatePct ?? 0) + dd.rareRatePct };
  if (inst.kind === 'dungeon') {
    const def = c.dungeons.dungeons[inst.id];
    for (let i = 0; i < c.dungeons.chestRolls + dd.extraRolls; i++) for (const it of rollEquipDrops(w, 'chest', inst.level, mods)) placeDrop(w, p, { item: it }, p.id);
    if (w.rng.chance(0.5)) {
      const sp = createSetPiece(newUid(w), def.set, inst.level, 'rare', w.rng, c);
      if (sp) placeDrop(w, p, { item: sp }, p.id);
    }
    if (w.rng.chance(0.3 + 0.1 * dd.extraRolls)) placeDrop(w, p, { bag: { id: def.crystal, n: 1 } }, p.id);
    addCounter(w, p, 'dungeonClears', 1);
    addCounter(w, p, `dungeonClears.${inst.difficulty}`, 1);
    const key = `${inst.id}:${inst.difficulty}`;
    const list = w.account.records.timeAttack[key] ?? [];
    const best = list.length === 0 || time < list[0].time;
    list.push({ time, char: p.char.name, at: w.clock });
    list.sort((a, b) => a.time - b.time);
    w.account.records.timeAttack[key] = list.slice(0, c.dungeons.timeAttackTop);
    w.events.push({ type: 'instance', playerId: p.id, what: 'cleared', time, best });
    addPortal(w, 'exit_portal', p.x, p.y + 1.5);
  } else if (inst.kind === 'tower') {
    const t = c.tower;
    p.char.tower.best = Math.max(p.char.tower.best, inst.floor);
    setCounterMax(w, p, 'towerBest', p.char.tower.best);
    addCounter(w, p, 'towerFloors', 1);
    if (inst.bossId >= 0) {
      const tm = { ...mods, rareRatePct: (mods.rareRatePct ?? 0) + inst.floor * t.rareRatePerFloor };
      for (const it of rollEquipDrops(w, t.bossDrops, inst.level, tm)) {
        if (inst.floor >= t.untradableFrom) it.trade = 'none';
        placeDrop(w, p, { item: it }, p.id);
      }
      if (w.rng.chance(t.crystal.chance)) placeDrop(w, p, { bag: { id: t.crystal.id, n: 1 } }, p.id);
    }
    w.events.push({ type: 'instance', playerId: p.id, what: 'cleared', time, floor: inst.floor });
    const cx = w.area.map.width / 2;
    addPortal(w, 'stairs', cx + 1.5, w.area.map.height / 2 - 2);
    addPortal(w, 'exit_portal', cx - 1.5, w.area.map.height / 2 - 2);
  } else {
    const def = c.raids[inst.id];
    for (let i = 0; i <= dd.extraRolls; i++) for (const it of rollEquipDrops(w, def.drops, inst.level, mods)) { it.trade = 'none'; placeDrop(w, p, { item: it }, p.id); }
    if (w.rng.chance(def.crystal.chance)) placeDrop(w, p, { bag: { id: def.crystal.id, n: 1 } }, p.id);
    addCounter(w, p, 'raidClears', 1);
    w.events.push({ type: 'instance', playerId: p.id, what: 'cleared', time });
    addPortal(w, 'exit_portal', w.area.map.width / 2, w.area.map.height / 2);
  }
}
