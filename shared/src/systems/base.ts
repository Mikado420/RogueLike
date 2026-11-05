import { addMods, type Mods } from '../core';
import type { Content } from '../content/types';
import type { AccountData, Player, World } from '../state';

/** 拠点を持つもの（アカウントか、ギルドの拠点） */
export type BaseHolder = { base: AccountData['base'] };

/** そのプレイヤーが使う拠点（ギルドに入っていればギルドの拠点） */
export const baseOf = (p: Player): BaseHolder => (p.guildBase ? { base: p.guildBase } : p.account);
import { takeFromBag } from './items';
import { dayIndex } from './quest';

/**
 * 拠点（ひとり用。段階3でギルド共有に広げる）。素材とゴールドで施設を建てると、バフや倉庫が増える。
 * 維持費を毎日払っていないと効果は止まる。
 */

export function facilityLevel(acc: BaseHolder, id: string): number {
  return acc.base.levels[id] ?? 0;
}

export function facilityCost(c: Content, id: string, nextLevel: number): { gold: number; mats: Record<string, number> } | null {
  const f = c.base.facilities[id];
  if (!f || nextLevel > f.max) return null;
  const k = nextLevel - 1;
  const mats: Record<string, number> = {};
  for (const [m, [n, g]] of Object.entries(f.cost.mats)) mats[m] = Math.ceil(n * Math.pow(g, k));
  return { gold: Math.round(f.cost.gold[0] * Math.pow(f.cost.gold[1], k)), mats };
}

export function upkeepCost(acc: BaseHolder, c: Content): number {
  return Object.values(acc.base.levels).reduce((s, v) => s + v, 0) * c.base.upkeepPerLevel;
}

export function baseActive(acc: BaseHolder, c: Content, clock: number): boolean {
  return upkeepCost(acc, c) === 0 || acc.base.paidDay >= dayIndex(clock);
}

export function baseMods(acc: BaseHolder, c: Content, clock: number): Mods {
  const m: Mods = {};
  if (!baseActive(acc, c, clock)) return m;
  for (const [id, lv] of Object.entries(acc.base.levels)) {
    const f = c.base.facilities[id];
    if (f?.mods && lv > 0) addMods(m, f.mods, lv);
  }
  return m;
}

/** 施設の効果（倉庫の増分・精錬率・生産・料理） */
export function baseBonus(acc: BaseHolder, c: Content, clock: number, key: 'storage' | 'refineRate' | 'craftBonus' | 'foodDuration'): number {
  if (!baseActive(acc, c, clock)) return 0;
  let v = 0;
  for (const [id, lv] of Object.entries(acc.base.levels)) v += (c.base.facilities[id]?.[key] ?? 0) * lv;
  return v;
}

export function buildFacility(w: World, p: Player, id: string): string | null {
  const acc = baseOf(p);
  const next = facilityLevel(acc, id) + 1;
  const cost = facilityCost(w.content, id, next);
  if (!cost) return 'err.facilityMax';
  const ch = p.char;
  if (ch.gold < cost.gold) return 'err.gold';
  for (const [m, n] of Object.entries(cost.mats)) if ((ch.bag[m] ?? 0) < n) return 'err.noMaterial';
  ch.gold -= cost.gold;
  for (const [m, n] of Object.entries(cost.mats)) takeFromBag(ch, m, n);
  acc.base.levels[id] = next;
  if (acc.base.paidDay < dayIndex(w.clock)) acc.base.paidDay = dayIndex(w.clock);
  w.events.push({ type: 'facility', playerId: p.id, facility: id, level: next, guild: !!p.guildBase });
  return null;
}

export function payUpkeep(w: World, p: Player): string | null {
  const acc = baseOf(p);
  const cost = upkeepCost(acc, w.content);
  const today = dayIndex(w.clock);
  if (acc.base.paidDay >= today) return 'err.paid';
  if (p.char.gold < cost) return 'err.gold';
  p.char.gold -= cost;
  acc.base.paidDay = today;
  w.events.push({ type: 'upkeep', playerId: p.id, day: today, guild: !!p.guildBase });
  return null;
}
