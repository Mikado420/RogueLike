import { describe, expect, it } from 'vitest';
import { CONTENT } from '../src/content';
import { enterArea } from '../src/systems/world';
import { alchemy, alchemyCost, gather, gainSubExp, subExpToNext } from '../src/systems/crafting';
import { addToBag } from '../src/systems/items';
import { createItem } from '../src/systems/loot';
import { weatherAt } from '../src/systems/weather';
import { migrateAccount, newAccount, newCharacter, serializeAccount } from '../src/save';
import { Rng } from '../src/rng';
import { makeWorld, tick } from './helpers';
import type { Player, World } from '../src/state';

const C = CONTENT;
const near = (w: World, p: Player, npc: string) => { const n = w.area.npcs.find((x) => x.npc === npc)!; p.x = n.x; p.y = n.y + 1; };

describe('採集', () => {
  it('フィールドに採集ポイントがあり、調べると素材が手に入り、回数を使い切ると時間で戻る', () => {
    const { w, p } = makeWorld(1);
    enterArea(w, 'meadow', null);
    expect(w.area.nodes.length).toBe(Object.values(C.gathering.areas.meadow.count).reduce((a, b) => a + b, 0));
    const node = w.area.nodes.find((n) => n.type === 'herb')!;
    p.x = node.x; p.y = node.y + 0.6;
    const before = Object.values(p.char.bag).reduce((a, b) => a + b, 0);
    for (let i = 0; i < 10; i++) { p.lock = 0; tick(w, p, { interact: true }); }
    expect(Object.values(p.char.bag).reduce((a, b) => a + b, 0)).toBeGreaterThan(before);
    expect(node.charges).toBe(0);
    expect(p.char.counters.gathers).toBe(C.gathering.nodeTypes.herb.charges);
    expect(p.char.sub.gather.exp + p.char.sub.gather.level).toBeGreaterThan(1);
    w.tick = node.respawnAt + 1;
    tick(w, p);
    tick(w, p, {}, 20);
    expect(node.charges).toBe(C.gathering.nodeTypes.herb.charges);
  });

  it('天候限定の素材はその天候のときだけ採れる', () => {
    const { w, p } = makeWorld(2);
    enterArea(w, 'meadow', null);
    const node = w.area.nodes.find((n) => n.type === 'fish')!;
    const slotMs = C.weather.slotMinutes * 60000;
    const find = (pred: (wt: string) => boolean) => { for (let s = 0; s < 1e5; s++) if (pred(weatherAt(C, 'meadow', s))) return s * slotMs + 1000; throw new Error(); };
    const got = new Set<string>();
    w.clock = find((wt) => wt === 'clear');
    for (let i = 0; i < 60; i++) { node.charges = 5; gather(w, p, node); }
    for (const k of Object.keys(p.char.bag)) got.add(k);
    expect(got.has('rain_trout')).toBe(false);
    w.clock = find((wt) => wt === 'rain');
    for (let i = 0; i < 60; i++) { node.charges = 5; gather(w, p, node); }
    expect(p.char.bag.rain_trout ?? 0).toBeGreaterThan(0);
  });
});

describe('鍛冶・料理・錬成', () => {
  it('鍛冶：素材とゴールドで装備を作る。サブ職のレベルが足りない段は作れない', () => {
    const { w, p } = makeWorld(3);
    near(w, p, 'smith');
    const r = C.recipes.smithing.tiers[0];
    p.char.gold = 1e6;
    for (const [m, n] of [r.ore, r.wood, r.extra]) addToBag(p.char, m, n * 2);
    const inv = p.char.inventory.length;
    tick(w, p, { commands: [{ type: 'craft', tier: 0, base: 'w_spear' }] });
    expect(p.char.inventory.length).toBe(inv + 1);
    expect(p.char.inventory.at(-1)!.kind).toBe('spear');
    expect(p.char.counters.crafts).toBe(1);
    tick(w, p, { commands: [{ type: 'craft', tier: 8, base: 'w_spear' }] });
    expect(w.events.some((e) => e.type === 'notice' && e.key === 'err.subLevel')).toBe(true);
  });

  it('料理：食べると一定時間バフ', () => {
    const { w, p } = makeWorld(4);
    near(w, p, 'cook');
    addToBag(p.char, 'river_fish', 2);
    p.char.gold = 100;
    tick(w, p, { commands: [{ type: 'cook', recipe: 'grilled_fish' }] });
    expect(p.char.bag.grilled_fish).toBeGreaterThanOrEqual(1);
    const atk = p.stats.atk;
    tick(w, p, { commands: [{ type: 'useItem', id: 'grilled_fish' }] }, 2);
    expect(p.statuses.some((s) => s.id === 'food')).toBe(true);
    expect(p.stats.atk).toBeGreaterThan(atk);
  });

  it('錬成：オプションを付け替え・振り直す（触媒とゴールドを使う）', () => {
    const { w, p } = makeWorld(5);
    const it = createItem(9001, 'w_oneHandSword', 3, 30, 'epic', new Rng(1), C);
    p.char.inventory.push(it);
    p.char.gold = 1e6;
    addToBag(p.char, C.recipes.alchemy.catalyst, 10);
    const keys0 = it.options.map((o) => o.key).join();
    const cost = alchemyCost(w, p, it.tier, 'one');
    expect(alchemy(w, p, 9001, 'one', 0)).toBeNull();
    expect(p.char.gold).toBe(1e6 - cost.gold);
    expect(it.options.map((o) => o.key).join()).not.toBe(keys0);
    const keys1 = it.options.map((o) => o.key).join();
    expect(alchemy(w, p, 9001, 'values', 0)).toBeNull();
    expect(it.options.map((o) => o.key).join()).toBe(keys1);
    p.char.bag[C.recipes.alchemy.catalyst] = 0;
    expect(alchemy(w, p, 9001, 'values', 0)).toBe('err.noMaterial');
  });

  it('サブ職は経験でレベルが上がる', () => {
    const { w, p } = makeWorld(6);
    gainSubExp(w, p, 'smith', subExpToNext(w, 1) + 1);
    expect(p.char.sub.smith.level).toBe(2);
  });
});

describe('セーブ版5', () => {
  it('版4のデータにサブ職が足される', () => {
    const acc = newAccount(1, 2);
    newCharacter(acc, 'A', { body: 0, hair: 0 }, 1);
    const raw = JSON.parse(serializeAccount(acc));
    raw.version = 4;
    for (const ch of raw.characters) delete ch.sub;
    expect(migrateAccount(raw).characters[0].sub.gather.level).toBe(1);
  });
});
