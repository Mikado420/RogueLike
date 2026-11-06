/**
 * 経済の入出量：1時間あたりの稼ぎ（ゴールド・売却・素材）と、主なゴールドの出口の値段。
 * 出口は「何時間ぶんの稼ぎか」で並べる。
 */
import { CONTENT, magicStoneExpected, Rng, RARITIES, refineCost, respecCost, sellPrice, createItem, tierFor, facilityCost, storageExpandCost, newAccount, newCharacter } from '../shared/src';

const C = CONTENT;

function fieldFor(level: number): string {
  for (const [id, a] of Object.entries(C.areas)) if (a.type === 'field' && a.monsters && level >= a.level[0] && level <= a.level[1]) return id;
  return 'snow';
}

function incomePerHour(level: number) {
  const e = C.balance.economy;
  const mb = C.balance.monster;
  const area = C.areas[fieldFor(level)];
  const species = (area.monsters ?? []).map((m) => C.monsters[m.id]);
  const goldMul = species.reduce((s, d) => s + (d.gold ?? 1), 0) / Math.max(1, species.length);
  const goldPerKill = (mb.gold[0] + mb.gold[1] * Math.pow(level, mb.gold[2])) * goldMul;
  const t = C.drops.field;
  const totalW = Object.values(t.rarity).reduce((s, v) => s + (v ?? 0), 0);
  const avgSell = RARITIES.reduce((s, r) => s + ((t.rarity[r] ?? 0) / totalW) * (C.balance.sell.base + level * C.balance.sell.perLevel) * C.rarities.defs[r].sellMul, 0);
  const itemPerKill = t.chance * avgSell;
  let matPerKill = 0;
  for (const d of species) for (const m of d.mats ?? []) matPerKill += (m.chance * (C.materials[m.id]?.price ?? 0) * C.balance.sell.materialMul) / species.length;
  return {
    kills: Math.round(goldPerKill * e.killsPerHour),
    items: Math.round(itemPerKill * e.killsPerHour),
    mats: Math.round(matPerKill * e.killsPerHour),
  };
}

/**
 * 1時間あたりの魔石（refine_stone）。その Lv 帯のフィールドで狩り続けたとき（エリート込み）。
 * balance.magicStone があればその式、なければ各モンスターの mats の設定から数える（調整前の比較用）。
 */
export function stonesPerHour(level: number): number {
  const e = C.balance.economy;
  const area = C.areas[fieldFor(level)];
  const list = area.monsters ?? [];
  const wsum = list.reduce((s, m) => s + m.w, 0);
  const elite = C.balance.world.eliteChance;
  let perKill = 0;
  for (const m of list) {
    const d = C.monsters[m.id];
    const share = m.w / wsum;
    if (C.balance.magicStone) perKill += share * ((1 - elite) * magicStoneExpected(C, m.id, level, {}) + elite * magicStoneExpected(C, m.id, level, { elite: true }));
    else for (const x of d.mats ?? []) if (x.id === C.refine.stone) perKill += share * x.chance * (((x.min ?? 1) + (x.max ?? 1)) / 2);
  }
  return perKill * e.killsPerHour;
}

/** 精錬で +0 → +target にするまでに使う魔石の平均（失敗込み） */
function stonesTo(level: number, target: number): number {
  const rng = new Rng(level * 17);
  let total = 0;
  const N = 200;
  for (let n = 0; n < N; n++) {
    const it = createItem(1, 'w_oneHandSword', tierFor(level, C), level, 'rare', rng, C);
    let guard = 0;
    while (it.refine < target && guard++ < 5000) {
      const cost = refineCost(it, C)!;
      total += cost.stones;
      if (rng.next() * 100 < cost.rate) { it.refine++; it.refinePity = 0; }
      else { it.refine = Math.max(0, it.refine - C.refine.levels[it.refine].drop); it.refinePity += C.refine.pityPerFail; }
    }
  }
  return total / N;
}

/** 精錬で +0 → +target にするまでの平均費用（ゴールド＋魔石の購入費） */
function refineTo(level: number, target: number): number {
  const rng = new Rng(level * 31);
  const stonePrice = C.materials[C.refine.stone].price;
  let total = 0;
  const trials = 300;
  for (let n = 0; n < trials; n++) {
    const it = createItem(1, 'w_oneHandSword', tierFor(level, C), level, 'rare', rng, C);
    let guard = 0;
    while (it.refine < target && guard++ < 5000) {
      const cost = refineCost(it, C)!;
      total += cost.gold + cost.stones * stonePrice;
      if (rng.next() * 100 < cost.rate) { it.refine++; it.refinePity = 0; }
      else { it.refine = Math.max(0, it.refine - C.refine.levels[it.refine].drop); it.refinePity += C.refine.pityPerFail; }
    }
  }
  return Math.round(total / trials);
}

function baseAll(): { build: number; upkeep: number } {
  let gold = 0, levels = 0;
  for (const [id, f] of Object.entries(C.base.facilities)) {
    for (let lv = 1; lv <= f.max; lv++) {
      const cost = facilityCost(C, id, lv)!;
      gold += cost.gold;
      for (const [m, n] of Object.entries(cost.mats)) gold += n * (C.materials[m]?.price ?? 0);
      levels++;
    }
  }
  return { build: gold, upkeep: levels * C.base.upkeepPerLevel };
}

function storageAll(): number {
  const acc = newAccount(1, 1);
  let sum = 0;
  for (;;) {
    const c = storageExpandCost(acc, C);
    if (c === null) break;
    sum += c;
    acc.storage.capacity += C.storage.step;
  }
  return sum;
}

export function economyReport() {
  const e = C.balance.economy;
  const rows: Record<string, string | number>[] = [];
  const sinkRows: Record<string, string | number>[] = [];
  const acc = newAccount(1, 2);
  const ch = newCharacter(acc, 'eco', { body: 0, hair: 0 }, 1);
  const base = baseAll();
  const storage = storageAll();
  for (const lv of e.levels) {
    const inc = incomePerHour(lv);
    const total = inc.kills + inc.items + inc.mats;
    rows.push({ Lv: lv, 'フィールド': C.areas[fieldFor(lv)].name, '討伐G/時': inc.kills, '装備売却G/時': inc.items, '素材売却G/時': inc.mats, '合計G/時': total });
    ch.level = lv;
    const smith = C.recipes.smithing.tiers[tierFor(lv, C)];
    let smithCost = smith.gold;
    for (const [m, n] of [smith.ore, smith.wood, smith.extra]) smithCost += n * (C.materials[m]?.price ?? 0);
    const sinks: [string, number][] = [
      [`精錬+${e.refineTarget}`, refineTo(lv, e.refineTarget)],
      ['振り直し', respecCost(ch, C)],
      ['転送', C.areas.ember.travelCost ?? 0],
      ['鍛冶1回', smithCost],
      ['拠点の維持/日', base.upkeep],
    ];
    const r: Record<string, string | number> = { Lv: lv };
    for (const [k, g] of sinks) r[k] = `${g.toLocaleString()}G (${(g / total).toFixed(1)}h)`;
    sinkRows.push(r);
  }
  console.log('\n■ 1時間あたりの稼ぎ（同じレベル帯で狩り続けた目安）');
  console.table(rows);
  console.log('\n■ ゴールドの出口（かっこ内はその Lv の稼ぎで何時間ぶんか）');
  console.table(sinkRows);
  const last = rows.at(-1)!['合計G/時'] as number;
  console.log('\n■ 魔石（1時間あたりの入手と、+' + e.refineTarget + ' までに使う数）');
  console.table(e.levels.map((lv) => {
    const per = stonesPerHour(lv), need = stonesTo(lv, e.refineTarget);
    return { Lv: lv, 'フィールド': C.areas[fieldFor(lv)].name, '魔石/時': Math.round(per * 10) / 10, [`+${e.refineTarget}までの魔石`]: Math.round(need), '狩りの時間(h)': per > 0 ? Math.round((need / per) * 10) / 10 : '∞' };
  }));
  console.log(`  拠点を全部最大まで：${base.build.toLocaleString()}G (${(base.build / last).toFixed(1)}h @Lv${e.levels.at(-1)})`);
  console.log(`  倉庫を最大まで：${storage.toLocaleString()}G (${(storage / last).toFixed(1)}h @Lv${e.levels.at(-1)})`);
  const m = C.missions;
  const avg = (list: typeof m.daily) => list.reduce((s, t) => s + (t.reward.gold ?? 0), 0) / list.length;
  console.log(`  ミッション：日替わり ${Math.round(avg(m.daily) * m.dailyCount).toLocaleString()}G/日、週替わり ${Math.round(avg(m.weekly) * m.weeklyCount).toLocaleString()}G/週`);
  void sellPrice;
}
