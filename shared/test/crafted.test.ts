import { describe, expect, it } from 'vitest';
import { CONTENT as C } from '../src/content';
import { applyCommand } from '../src/systems/commands';
import { equipItem } from '../src/systems/items';
import { conditionalMods } from '../src/systems/effects';
import { checkItem } from '../src/validate';
import { makeWorld, tick } from './helpers';

const smith = C.areas.lumina.npcs!.find((n) => n.npc === 'smith')!;
const recipe = (id: string) => C.crafted.recipes.find((r) => r.id === id)!;

/** 鍛冶屋のそばで、材料・ゴールド・鍛冶 Lv をそろえる */
function ready(id: string, opts: { short?: string; lv?: number } = {}) {
  const { w, p, ch } = makeWorld(5);
  p.x = smith.x; p.y = smith.y + 0.8;
  const r = recipe(id);
  ch.sub.smith.level = opts.lv ?? r.smithLevel;
  ch.gold = r.gold;
  for (const [m, n] of Object.entries(r.mats)) ch.bag[m] = m === opts.short ? n - 1 : n;
  return { w, p, ch, r };
}

describe('銘入り装備', () => {
  it('80 品あり、各地域に 10 武器種がそろう。魔石は使わない', () => {
    expect(C.crafted.recipes.length).toBe(80);
    for (const reg of C.crafted.regions) {
      const kinds = new Set(C.crafted.recipes.filter((r) => r.region === reg.id && C.equipment.bases[r.base].slot === 'weapon').map((r) => C.equipment.bases[r.base].kind));
      expect(kinds.size).toBe(10);
    }
    for (const r of C.crafted.recipes) expect(r.mats.refine_stone).toBeUndefined();
  });

  it('作ると、名前・固定効果・属性・結晶スロットがレシピどおりで、オプションはレジェンドと同じ数', () => {
    const { w, p, ch, r } = ready('volcano_13');
    applyCommand(w, p, { type: 'craftNamed', recipe: r.id });
    const it = ch.inventory.at(-1)!;
    expect(it.name).toBe(r.name);
    expect(it.unique).toBe(`crafted.${r.id}`);
    expect(it.crafted).toBe(r.id);
    expect(it.rarity).toBe('legend');
    expect(it.options.length).toBe(C.rarities.defs.legend.options);
    expect(it.crystals.length).toBe(r.crystals);
    expect(it.element).toBe(r.element);
    expect(it.trade).toBe('free');
    expect(ch.gold).toBe(0);
    for (const m of Object.keys(r.mats)) expect(ch.bag[m] ?? 0).toBe(0);
    expect(checkItem(it)).toBeNull();
  });

  it('材料が 1 つでも足りない・鍛冶 Lv が足りない・知らないレシピなら作れず、何も減らない', () => {
    for (const [id, o] of [['marsh_16', { short: 'hydra_fang' }], ['snow_16', { lv: 1 }]] as const) {
      const { w, p, ch, r } = ready(id, o);
      const n = ch.inventory.length, gold = ch.gold;
      applyCommand(w, p, { type: 'craftNamed', recipe: r.id });
      expect(ch.inventory.length).toBe(n);
      expect(ch.gold).toBe(gold);
    }
    const { w, p, ch } = ready('meadow_01');
    applyCommand(w, p, { type: 'craftNamed', recipe: 'no_such_recipe' });
    expect(ch.inventory.length).toBe(0);
  });

  it('固定効果が能力値に効く（ボスへのダメージ）', () => {
    const r = C.crafted.recipes.find((x) => x.family === 'hunter' && C.equipment.bases[x.base].slot === 'accessory') ?? C.crafted.recipes.find((x) => x.family === 'hunter')!;
    const { w, p, ch } = ready(r.id);
    applyCommand(w, p, { type: 'craftNamed', recipe: r.id });
    const it = ch.inventory.at(-1)!;
    ch.level = 100;
    expect(equipItem(w, ch, it.uid)).toBeNull();
    p.statsDirty = true;
    tick(w, p);
    expect(p.stats.m.bossDmgPct ?? 0).toBeGreaterThanOrEqual(r.effect.mods!.bossDmgPct!);
  });

  it('武器の仕組みの条件：再装填のあと・防いだあと・コンボ・リズム', () => {
    const { w, p, ch } = ready('meadow_01');
    const fake = (cond: object) => {
      C.uniques['test.cond'] = { name: 't', slots: ['weapon'], when: cond, whenMods: { atkPct: 10 } };
      ch.equipment.weapon!.unique = 'test.cond';
      return conditionalMods(w, p).mods.atkPct ?? 0;
    };
    p.lastReloadTick = w.tick; expect(fake({ afterReload: 3 })).toBe(10);
    p.lastReloadTick = -9999; expect(fake({ afterReload: 3 })).toBe(0);
    p.lastBlockTick = w.tick; expect(fake({ afterBlock: 2 })).toBe(10);
    p.combo = 5; expect(fake({ comboAtLeast: 5 })).toBe(10); expect(fake({ comboAtLeast: 6 })).toBe(0);
    p.rhythm = 3; expect(fake({ rhythmAtLeast: 3 })).toBe(10);
    delete C.uniques['test.cond'];
    ch.equipment.weapon!.unique = undefined;
  });

  it('書き換えた銘入り装備は検証で弾かれる', () => {
    const { w, p, ch, r } = ready('forest_16');
    applyCommand(w, p, { type: 'craftNamed', recipe: r.id });
    const it = ch.inventory.at(-1)!;
    expect(checkItem({ ...it, unique: 'crafted.meadow_01' })).not.toBeNull();
    expect(checkItem({ ...it, crafted: 'nope' })).not.toBeNull();
    expect(checkItem({ ...it, crafted: undefined })).not.toBeNull();
  });
});
