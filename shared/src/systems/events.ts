import type { Monster, Player, World } from '../state';
import { spawnMonster } from './world';
import { gainExp, expToNext } from './progression';
import { addToBag } from './items';
import { createItem, pickBase, tierFor } from './loot';
import { addCounter } from './counters';
import { newUid, sec } from './util';

/**
 * 侵攻イベント：一定時間ごとに街へ魔物が攻めてくる。倒して貢献度を稼ぎ、終わったら報酬。
 */

export function invasionSlot(w: World): number {
  return Math.floor(w.clock / (w.content.invasion.every * 60000));
}

export function invasionWindow(w: World): { slot: number; start: number; end: number; active: boolean } {
  const inv = w.content.invasion;
  const slot = invasionSlot(w);
  const start = slot * inv.every * 60000;
  const end = start + inv.duration * 60000;
  return { slot, start, end, active: w.clock < end };
}

/** 次の侵攻の開始時刻 */
export function nextInvasionAt(w: World): number {
  const win = invasionWindow(w);
  return win.active ? win.start : win.start + w.content.invasion.every * 60000;
}

export function contribution(w: World, p: Player): number {
  const st = w.shared.invasion;
  return st.slot === invasionSlot(w) ? st.contribution[p.char.id] ?? 0 : 0;
}

export function addContribution(w: World, p: Player, n: number) {
  const st = w.shared.invasion;
  if (!w.area.invasion || w.area.invasion.finished || st.slot !== w.area.invasion.slot) return;
  st.contribution[p.char.id] = (st.contribution[p.char.id] ?? 0) + n;
}

function spawnWave(w: World) {
  const inv = w.content.invasion;
  const area = w.area;
  const alive = w.players.filter((x) => !x.dead);
  const lv = w.players.length ? Math.round(w.players.reduce((s, x) => s + x.char.level, 0) / w.players.length) : 1;
  const n = w.rng.int(inv.perWave[0], inv.perWave[1]);
  for (let i = 0; i < n; i++) {
    for (let t = 0; t < 20; t++) {
      const edge = w.rng.pick(inv.spawnEdges);
      const W = area.map.width, H = area.map.height;
      const x = edge === 'west' ? 2.5 : edge === 'east' ? W - 2.5 : w.rng.int(3, W - 4) + 0.5;
      const y = edge === 'north' ? 3.5 : edge === 'south' ? H - 2.5 : w.rng.int(3, H - 4) + 0.5;
      if (area.map.solid[Math.floor(y) * W + Math.floor(x)]) continue;
      const level = Math.max(1, lv + w.rng.int(inv.levelOffset[0], inv.levelOffset[1]));
      const m = spawnMonster(w, { key: 'invasion', monster: w.rng.pick(inv.pool), x, y, level: [level, level], monsterId: -1, respawnAt: 0 }, { level });
      m.invader = true;
      m.ai = 'chase';
      m.targetId = alive.length ? w.rng.pick(alive).id : -1;
      m.homeX = area.playerSpawn.x; m.homeY = area.playerSpawn.y;
      break;
    }
  }
}

function finish(w: World) {
  const inv = w.content.invasion;
  const area = w.area;
  const st = w.shared.invasion;
  area.invasion!.finished = true;
  for (const m of area.monsters) if (m.invader) { m.dead = true; m.hp = 0; }
  for (const p of w.players) {
    if (st.rewarded.includes(p.char.id)) continue;
    const pts = st.contribution[p.char.id] ?? 0;
    let tier = -1;
    inv.tiers.forEach((t, i) => { if (pts >= t.min) tier = i; });
    st.rewarded.push(p.char.id);
    w.events.push({ type: 'invasion', what: 'end', tier });
    if (tier < 0) continue;
    const t = inv.tiers[tier];
    p.char.gold += t.gold;
    w.events.push({ type: 'gold', playerId: p.id, amount: t.gold });
    gainExp(w, p, expToNext(p.char.level, w.content) * t.exp * 0.1);
    for (let i = 0; i < t.mats; i++) addToBag(p.char, w.rng.pick(inv.matPool), 1);
    if (w.rng.chance(t.epicChance)) {
      const it = createItem(newUid(w), pickBase(w.rng, { weapon: 2, sub: 1, body: 1, head: 1, accessory: 1 }, w.content), tierFor(p.char.level, w.content), p.char.level, 'epic', w.rng, w.content);
      p.char.inventory.push(it);
      w.events.push({ type: 'pickup', playerId: p.id, item: it });
    }
    addCounter(w, p, 'invasions', 1);
  }
}

export function updateInvasion(w: World) {
  const inv = w.content.invasion;
  const area = w.area;
  if (area.id !== inv.town) return;
  const win = invasionWindow(w);
  const st = w.shared.invasion;
  if (win.active && (!area.invasion || area.invasion.slot !== win.slot)) {
    if (st.slot !== win.slot) { st.slot = win.slot; st.contribution = {}; st.rewarded = []; }
    area.invasion = { slot: win.slot, wave: 0, nextWaveTick: w.tick + sec(w, 3), endClock: win.end, finished: false };
    w.events.push({ type: 'invasion', what: 'start' });
    w.events.push({ type: 'worldNotice', key: 'notice.invasion', args: [w.content.areas[inv.town].name], rare: true });
  }
  const iv = area.invasion;
  if (!iv || iv.finished) return;
  if (iv.wave < inv.waves && w.tick >= iv.nextWaveTick) {
    spawnWave(w);
    iv.wave++;
    iv.nextWaveTick = w.tick + sec(w, inv.waveEvery);
    w.events.push({ type: 'invasion', what: 'wave', wave: iv.wave });
  }
  const left = area.monsters.some((m: Monster) => m.invader && !m.dead);
  if (w.clock >= iv.endClock || (iv.wave >= inv.waves && !left)) finish(w);
}
