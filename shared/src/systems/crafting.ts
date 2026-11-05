import { rarityRank, type Rarity } from '../core';
import type { GatherEntry, SubJob } from '../content/types';
import type { GatherNode, Player, World } from '../state';
import type { GameMap } from '../map';
import { hash32, Rng } from '../rng';
import { addToBag, findOwnedItem, takeFromBag } from './items';
import { createItem, optionValue, rollRarity } from './loot';
import { addCounter } from './counters';
import { recordCodex } from './quest';
import { baseBonus } from './base';
import { currentWeather } from './weather';
import { isNight } from './time';
import { newId, newUid, sec } from './util';

/**
 * 採集・鍛冶・料理・錬成と、それぞれのサブ職のレベル。
 */

// ───────── サブ職 ─────────

export function subExpToNext(w: World, level: number): number {
  const s = w.content.subjobs;
  return s.expBase + s.expPerLevel * level;
}

export function gainSubExp(w: World, p: Player, job: SubJob, amount: number) {
  const s = w.content.subjobs;
  const st = p.char.sub[job];
  if (st.level >= s.maxLevel) return;
  st.exp += amount;
  while (st.level < s.maxLevel && st.exp >= subExpToNext(w, st.level)) {
    st.exp -= subExpToNext(w, st.level);
    st.level++;
    w.events.push({ type: 'subLevel', playerId: p.id, job, level: st.level });
  }
}

// ───────── 採集ポイント ─────────

const LIQUIDS = new Set(['water', 'swamp', 'lava', 'ice_water']);

/** 採集ポイントの位置（エリアごとに決まった場所） */
export function placeNodes(w: World, areaId: string, map: GameMap): GatherNode[] {
  const def = w.content.gathering.areas[areaId];
  if (!def) return [];
  const rng = new Rng(hash32('nodes', areaId));
  const out: GatherNode[] = [];
  const W = map.width, H = map.height;
  const walk = (i: number, j: number) => i > 1 && j > 1 && i < W - 2 && j < H - 2 && !map.solid[j * W + i];
  const nearLiquid = (i: number, j: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => LIQUIDS.has(map.tiles[(j + b) * W + (i + a)]));
  const nearProp = (i: number, j: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => map.sprites[(j + b) * W + (i + a)] !== null);
  for (const [type, count] of Object.entries(def.count)) {
    let placed = 0;
    for (let t = 0; t < 4000 && placed < count; t++) {
      const i = rng.int(2, W - 3), j = rng.int(2, H - 3);
      if (!walk(i, j)) continue;
      if (type === 'fish' ? !nearLiquid(i, j) : type !== 'herb' && !nearProp(i, j)) continue;
      if (out.some((n) => Math.hypot(n.x - i, n.y - j) < 5)) continue;
      out.push({ id: newId(w), type, x: i + 0.5, y: j + 0.5, charges: w.content.gathering.nodeTypes[type].charges, respawnAt: 0 });
      placed++;
    }
  }
  return out;
}

export function updateNodes(w: World) {
  if (w.tick % 20 !== 0) return;
  for (const n of w.area.nodes) {
    if (n.charges <= 0 && w.tick >= n.respawnAt) n.charges = w.content.gathering.nodeTypes[n.type].charges;
  }
}

function pickGather(w: World, p: Player, table: GatherEntry[]): string | null {
  const weather = currentWeather(w);
  const night = isNight(w);
  const lvl = p.char.sub.gather.level;
  const weights: Record<string, number> = {};
  for (const e of table) {
    if (e.weather && e.weather !== weather) continue;
    if (e.night && !night) continue;
    const special = !!(e.weather || e.night);
    weights[e.id] = (weights[e.id] ?? 0) + e.w * (special ? 1 + (w.content.subjobs.effects.gatherRarePct * lvl) / 100 : 1);
  }
  return Object.keys(weights).length ? w.rng.weighted(weights) : null;
}

export function gather(w: World, p: Player, node: GatherNode): string | null {
  const c = w.content;
  if (node.charges <= 0) return 'err.depleted';
  const table = c.gathering.areas[w.area.id]?.tables[node.type];
  if (!table) return 'err.invalid';
  const id = pickGather(w, p, table);
  if (!id) return 'err.invalid';
  const lvl = p.char.sub.gather.level;
  const mul = 1 + (c.subjobs.effects.gatherYieldPct * lvl + (p.stats.m.gatherPct ?? 0)) / 100;
  const raw = w.rng.int(c.gathering.yield[0], c.gathering.yield[1]) * mul;
  const n = Math.floor(raw) + (w.rng.next() < raw - Math.floor(raw) ? 1 : 0);
  addToBag(p.char, id, n);
  recordCodex(w, p, 'materials', id);
  node.charges--;
  if (node.charges <= 0) node.respawnAt = w.tick + sec(w, c.gathering.nodeTypes[node.type].respawn);
  p.lock = sec(w, c.gathering.lock);
  gainSubExp(w, p, 'gather', c.subjobs.gain.gather);
  addCounter(w, p, 'gathers', 1);
  w.events.push({ type: 'gather', playerId: p.id, node: node.id, id, n, x: node.x, y: node.y });
  return null;
}

// ───────── 鍛冶 ─────────

export function smithRecipe(w: World, tier: number) {
  return w.content.recipes.smithing.tiers.find((t) => t.tier === tier) ?? null;
}

export function craftItem(w: World, p: Player, tier: number, baseId: string): string | null {
  const c = w.content;
  const r = smithRecipe(w, tier);
  const base = c.equipment.bases[baseId];
  if (!r || !base) return 'err.invalid';
  const ch = p.char;
  if (ch.sub.smith.level < r.level) return 'err.subLevel';
  if (ch.inventory.length >= c.balance.player.inventorySize) return 'err.full';
  const need: [string, number][] = [r.ore, r.wood, r.extra];
  if (ch.gold < r.gold) return 'err.gold';
  for (const [m, n] of need) if ((ch.bag[m] ?? 0) < n) return 'err.noMaterial';
  ch.gold -= r.gold;
  for (const [m, n] of need) takeFromBag(ch, m, n);
  const rare = c.subjobs.effects.smithRarePct * ch.sub.smith.level + baseBonus(p.account, c, w.clock, 'craftBonus') * 5 + (p.stats.m.rareRatePct ?? 0);
  const rarity = rollRarity(w.rng, c.recipes.smithing.rarity, rare);
  const ilvl = c.equipment.tiers[tier]?.level ?? 1;
  const it = createItem(newUid(w), baseId, tier, ilvl, rarity, w.rng, c);
  ch.inventory.push(it);
  ch.appearance.looks.includes(it.look) || ch.appearance.looks.push(it.look);
  recordCodex(w, p, 'items', baseId);
  gainSubExp(w, p, 'smith', c.subjobs.gain.smith * (1 + tier * 0.3));
  addCounter(w, p, 'crafts', 1);
  w.events.push({ type: 'crafted', playerId: p.id, kind: 'smith', uid: it.uid });
  return null;
}

// ───────── 料理 ─────────

export function cook(w: World, p: Player, recipe: string): string | null {
  const c = w.content;
  const r = c.recipes.cooking[recipe];
  if (!r || !c.materials[recipe]) return 'err.invalid';
  const ch = p.char;
  if (ch.sub.cook.level < r.level) return 'err.subLevel';
  if (ch.gold < r.gold) return 'err.gold';
  for (const [m, n] of Object.entries(r.mats)) if ((ch.bag[m] ?? 0) < n) return 'err.noMaterial';
  ch.gold -= r.gold;
  for (const [m, n] of Object.entries(r.mats)) takeFromBag(ch, m, n);
  const extra = w.rng.next() * 100 < c.subjobs.effects.cookDoublePct * ch.sub.cook.level ? 1 : 0;
  addToBag(ch, recipe, 1 + extra);
  gainSubExp(w, p, 'cook', c.subjobs.gain.cook);
  addCounter(w, p, 'cooks', 1);
  addCounter(w, p, 'crafts', 1);
  w.events.push({ type: 'crafted', playerId: p.id, kind: 'cook', id: recipe });
  return null;
}

// ───────── 錬成（オプションの付け替え） ─────────

export function alchemyCost(w: World, p: Player, tier: number, mode: 'one' | 'values'): { gold: number; catalyst: number } {
  const a = w.content.recipes.alchemy;
  const d = mode === 'one' ? a.rerollOne : a.rerollValues;
  const k = 1 + (w.content.subjobs.effects.alchemyCostPct * p.char.sub.alchemy.level) / 100;
  return { gold: Math.round(d.gold[0] * (1 + tier * d.gold[1]) * k), catalyst: d.catalyst };
}

export function alchemy(w: World, p: Player, uid: number, mode: 'one' | 'values', index: number): string | null {
  const c = w.content;
  const ch = p.char;
  const it = findOwnedItem(ch, uid);
  if (!it || it.options.length === 0) return 'err.invalid';
  if (mode === 'one' && (index < 0 || index >= it.options.length)) return 'err.invalid';
  const cost = alchemyCost(w, p, it.tier, mode);
  if (ch.gold < cost.gold) return 'err.gold';
  if ((ch.bag[c.recipes.alchemy.catalyst] ?? 0) < cost.catalyst) return 'err.noMaterial';
  ch.gold -= cost.gold;
  takeFromBag(ch, c.recipes.alchemy.catalyst, cost.catalyst);
  const rd = c.rarities.defs[it.rarity as Rarity];
  const lo = Math.min(rd.optionRoll[1], rd.optionRoll[0] + c.subjobs.effects.alchemyRollMin * ch.sub.alchemy.level);
  const roll = () => w.rng.range(lo, rd.optionRoll[1]);
  if (mode === 'values') {
    it.options = it.options.map((o) => {
      const od = c.options.pool.find((x) => x.key === o.key);
      return od ? { key: o.key, value: optionValue(od, it.ilvl, roll()) } : o;
    });
  } else {
    const used = new Set(it.options.map((o) => o.key));
    const pool = c.options.pool.filter((o) => !used.has(o.key) && (!o.slots || o.slots.includes(it.slot)));
    if (pool.length) {
      const weights: Record<string, number> = {};
      for (const o of pool) weights[o.key] = o.weight;
      const key = w.rng.weighted(weights);
      const od = pool.find((o) => o.key === key)!;
      it.options[index] = { key: od.key, value: optionValue(od, it.ilvl, roll()) };
    }
  }
  gainSubExp(w, p, 'alchemy', c.subjobs.gain.alchemy * (1 + it.tier * 0.2));
  addCounter(w, p, 'crafts', 1);
  w.events.push({ type: 'crafted', playerId: p.id, kind: 'alchemy', uid });
  void rarityRank;
  return null;
}
