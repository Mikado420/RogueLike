import { rarityRank, type EquipSlot, type Rarity } from '../core';
import type { Content, OptionDef } from '../content/types';
import type { Item, World } from '../state';
import type { Rng } from '../rng';
import { newUid } from './util';

/** その装備レベルで使う段（tier）の番号 */
export function tierFor(ilvl: number, c: Content): number {
  let t = 0;
  c.equipment.tiers.forEach((tier, i) => { if (tier.level <= ilvl) t = i; });
  return t;
}

/** オプションの値。q は 0〜1（レアリティで幅が決まる） */
export function optionValue(od: OptionDef, ilvl: number, q: number): number {
  const t = Math.min(1, Math.max(0, (ilvl - 1) / 99));
  const lo = od.min[0] + (od.min[1] - od.min[0]) * t;
  const hi = od.max[0] + (od.max[1] - od.max[0]) * t;
  const v = lo + (hi - lo) * q;
  const p = Math.pow(10, od.decimals ?? 0);
  const r = Math.round(v * p) / p;
  return r === 0 ? (v < 0 ? -1 : 1) / p : r;
}

export function rollOptions(slot: EquipSlot, count: number, ilvl: number, rarity: Rarity, rng: Rng, c: Content, exclude: string[] = []): Item['options'] {
  const rd = c.rarities.defs[rarity];
  const out: Item['options'] = [];
  const used = new Set<string>(exclude);
  for (let i = 0; i < count; i++) {
    const pool = c.options.pool.filter((o) => !used.has(o.key) && (!o.slots || o.slots.includes(slot)));
    if (pool.length === 0) break;
    const weights: Record<string, number> = {};
    for (const o of pool) weights[o.key] = o.weight;
    const key = rng.weighted(weights);
    const od = pool.find((o) => o.key === key)!;
    used.add(key);
    out.push({ key: od.key, value: optionValue(od, ilvl, rng.range(rd.optionRoll[0], rd.optionRoll[1])) });
  }
  return out;
}

export interface CreateOpts { set?: string; trade?: Item['trade'] }

/** 装備を1つ作る */
export function createItem(uid: number, baseId: string, tierArg: number, ilvl: number, rarity: Rarity, rng: Rng, c: Content, opts: CreateOpts = {}): Item {
  const base = c.equipment.bases[baseId];
  if (!base) throw new Error(`unknown base ${baseId}`);
  const tier = c.equipment.tiers[Math.max(0, Math.min(c.equipment.tiers.length - 1, tierArg))];
  const rd = c.rarities.defs[rarity];
  const tierIndex = c.equipment.tiers.indexOf(tier);
  const stats: Item['stats'] = {};
  for (const [k, v] of Object.entries(base.stats)) {
    const key = k as keyof Item['stats'];
    if (c.equipment.flatStats.includes(key)) {
      stats[key] = Math.max(1, Math.round((v as number) * (1 + tierIndex * c.equipment.flatTierGrowth)));
    } else {
      stats[key] = Math.max(1, Math.round((v as number) * tier.mul * rd.statMul * rng.range(0.95, 1.05)));
    }
  }
  const options = rollOptions(base.slot, rd.options, ilvl, rarity, rng, c);
  let unique: string | undefined;
  let mythic: string | undefined;
  if (rarity === 'legend' || rarity === 'mythic') {
    const mys = Object.keys(c.mythics).filter((id) => c.mythics[id].slots.includes(base.slot));
    if (rarity === 'mythic' && mys.length) mythic = rng.pick(mys);
    else {
      // 銘入り装備の固定効果（crafted.）は、拾う装備には付けない
      const us = Object.keys(c.uniques).filter((id) => !id.startsWith('crafted.') && c.uniques[id].slots.includes(base.slot));
      if (us.length) unique = rng.pick(us);
    }
  }
  let element: Item['element'] = 'neutral';
  if (base.slot === 'weapon' && rarity !== 'common' && rng.chance(c.options.weaponElementChance)) {
    element = rng.pick(c.options.weaponElements);
  }
  const slots = rng.int(rd.slots[0], rd.slots[1]);
  return {
    uid, base: baseId, name: tier.prefix + base.name, slot: base.slot, kind: base.kind,
    tier: tierIndex, ilvl, reqLevel: tier.level, rarity, refine: 0, refinePity: 0,
    stats, options, crystals: Array(slots).fill(null), element, set: opts.set, unique, mythic,
    trade: opts.trade ?? 'free', look: `${base.look}:${tierIndex}`,
  };
}

/** セット装備を1つ作る（部位はセットにあるものから選ぶ） */
export function createSetPiece(uid: number, setId: string, ilvl: number, rarity: Rarity, rng: Rng, c: Content, slot?: EquipSlot): Item | null {
  const set = c.sets[setId];
  if (!set) return null;
  const slots = Object.keys(set.pieces) as EquipSlot[];
  const s = slot ?? rng.pick(slots);
  const name = set.pieces[s];
  const baseId = setPieceBase(setId, s, c);
  if (!name || !baseId) return null;
  const it = createItem(uid, baseId, tierFor(ilvl, c), ilvl, rarity === 'common' ? 'rare' : rarity, rng, c, { set: setId });
  it.name = name;
  return it;
}

/** セットのその部位の土台（data/sets.json の bases） */
export function setPieceBase(setId: string, slot: EquipSlot, c: Content): string | null {
  const id = c.sets[setId]?.bases?.[slot];
  return id && c.equipment.bases[id]?.slot === slot ? id : null;
}

/**
 * 以前のバグで「名前はセットの部位なのに、中身（土台）が別の種類」になったセット装備を直す。
 * 土台・種類・見た目・基本の数値を正しい土台で作り直し、レアリティ・オプション・精錬・結晶・段・属性・固有効果はそのまま。
 * 直したら true（何度呼んでも同じ結果になる）
 */
export function repairSetItem(it: Item | null | undefined, c: Content): boolean {
  if (!it?.set) return false;
  const baseId = setPieceBase(it.set, it.slot, c);
  if (!baseId || it.base === baseId) return false;
  const base = c.equipment.bases[baseId];
  const tierIndex = Math.max(0, Math.min(c.equipment.tiers.length - 1, it.tier));
  const tier = c.equipment.tiers[tierIndex];
  const rd = c.rarities.defs[it.rarity] ?? c.rarities.defs.rare;
  const stats: Item['stats'] = {};
  for (const [k, v] of Object.entries(base.stats)) {
    const key = k as keyof Item['stats'];
    stats[key] = c.equipment.flatStats.includes(key)
      ? Math.max(1, Math.round((v as number) * (1 + tierIndex * c.equipment.flatTierGrowth)))
      : Math.max(1, Math.round((v as number) * tier.mul * rd.statMul));
  }
  it.base = baseId;
  it.kind = base.kind;
  it.stats = stats;
  it.look = `${base.look}:${tierIndex}`;
  const name = c.sets[it.set].pieces[it.slot];
  if (name) it.name = name;
  return true;
}

/** 部位の重みから装備の土台を選ぶ */
export function pickBase(rng: Rng, slotWeights: Partial<Record<EquipSlot, number>>, c: Content): string {
  const slot = rng.weighted(slotWeights);
  const ids = Object.keys(c.equipment.bases).filter((id) => c.equipment.bases[id].slot === slot);
  return rng.pick(ids.length ? ids : Object.keys(c.equipment.bases));
}

/** レア度の抽選（rareRatePct が高いほど上のレア度が出やすい） */
export function rollRarity(rng: Rng, weights: Partial<Record<Rarity, number>>, rareRatePct: number): Rarity {
  const adj: Partial<Record<Rarity, number>> = {};
  for (const [r, wgt] of Object.entries(weights) as [Rarity, number][]) {
    adj[r] = wgt * Math.pow(1 + rareRatePct / 100, rarityRank(r));
  }
  return rng.weighted(adj);
}

/** ドロップ表を引いて装備を作る */
export function rollEquipDrops(w: World, tableId: string, level: number, mods: { dropRatePct?: number; rareRatePct?: number } = {}): Item[] {
  const c = w.content;
  const t = c.drops[tableId];
  if (!t) return [];
  const out: Item[] = [];
  const chance = Math.min(1, t.chance * (1 + (mods.dropRatePct ?? 0) / 100));
  for (let i = 0; i < t.rolls; i++) {
    if (!w.rng.chance(chance)) continue;
    const rarity = rollRarity(w.rng, t.rarity, mods.rareRatePct ?? 0);
    if (t.set && w.rng.chance(t.setChance ?? 0)) {
      const sp = createSetPiece(newUid(w), t.set, level, rarity, w.rng, c);
      if (sp) { out.push(sp); continue; }
    }
    const base = pickBase(w.rng, t.slots ?? { weapon: 1, body: 1, accessory: 1 }, c);
    out.push(createItem(newUid(w), base, tierFor(level, c), level, rarity, w.rng, c));
  }
  return out;
}

export function sellPrice(it: Item, c: Content): number {
  const s = c.balance.sell;
  return Math.round((s.base + it.ilvl * s.perLevel) * c.rarities.defs[it.rarity].sellMul * (1 + it.refine * s.perRefine));
}
