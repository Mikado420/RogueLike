import type { Content, Element, Item, ItemOption, ItemStatKey, Rarity } from './types';
import type { Rng } from './rng';
import { CONTENT } from './content';

/** アイテムを1つ作る。uid は呼び出し側が渡す（ワールドの通し番号）。 */
export function createItem(uid: number, baseId: string, rarity: Rarity, rng: Rng, c: Content = CONTENT): Item {
  const base = c.items[baseId];
  if (!base) throw new Error(`unknown item ${baseId}`);
  const rd = c.rarities.defs[rarity];
  const stats: Item['stats'] = {};
  for (const [k, v] of Object.entries(base.stats) as [ItemStatKey, number][]) {
    stats[k] = Math.round(v * rd.statMul * rng.range(0.95, 1.05));
  }
  const options: ItemOption[] = [];
  const used = new Set<string>();
  for (let i = 0; i < rd.options; i++) {
    const pool = c.options.pool.filter((o) => !used.has(o.stat));
    if (pool.length === 0) break;
    const weights: Record<string, number> = {};
    for (const o of pool) weights[o.stat] = o.weight;
    const stat = rng.weighted(weights);
    const od = pool.find((o) => o.stat === stat)!;
    used.add(stat);
    options.push({ stat: od.stat, value: rng.int(od.min, od.max) });
  }
  let element: Element = 'neutral';
  if (base.slot === 'weapon' && rarity !== 'common' && rng.chance(c.options.weaponElementChance)) {
    element = rng.pick(c.options.weaponElements);
  }
  const slots = rng.int(rd.slots[0], rd.slots[1]);
  return {
    uid, base: baseId, name: base.name, slot: base.slot, weaponType: base.weaponType, sprite: base.sprite,
    rarity, refine: 0, stats, options, crystals: Array(slots).fill(null), element,
  };
}

/** ドロップテーブルを引く */
export function rollDrops(tableId: string, rng: Rng, nextUid: () => number, c: Content = CONTENT): Item[] {
  const t = c.drops[tableId];
  if (!t) return [];
  const out: Item[] = [];
  for (let i = 0; i < t.rolls; i++) {
    if (!rng.chance(t.chance)) continue;
    const rarity = rng.weighted(t.rarity) as Rarity;
    out.push(createItem(nextUid(), rng.pick(t.pool), rarity, rng, c));
  }
  return out;
}
