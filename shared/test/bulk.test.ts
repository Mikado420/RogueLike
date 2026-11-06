import { describe, expect, it } from 'vitest';
import { CONTENT as C } from '../src/content';
import { applyCommand } from '../src/systems/commands';
import { createItem, sellPrice } from '../src/systems/loot';
import { MAX_REFINE_TRIES } from '../src/systems/items';
import { makeWorld } from './helpers';

/** その役割の NPC のそばに立たせる */
function standBy(w: ReturnType<typeof makeWorld>['w'], p: ReturnType<typeof makeWorld>['p'], role: string) {
  const n = w.area.npcs.find((x) => C.npcs[x.npc]?.role === role)!;
  p.x = n.x;
  p.y = n.y + 0.5;
}

describe('まとめて売る', () => {
  it('選んだ装備をまとめて売り、ロック中は残す', () => {
    const { w, p } = makeWorld(5);
    standBy(w, p, 'shop');
    const items = [0, 1, 2, 3].map((i) => createItem(500 + i, 'w_oneHandSword', 1, 10, 'common', w.rng, C));
    items[2].locked = true;
    p.char.inventory.push(...items);
    const gold = p.char.gold;
    applyCommand(w, p, { type: 'sellMany', uids: [500, 501, 502, 999] });
    expect(p.char.inventory.map((it) => it.uid)).toEqual(expect.arrayContaining([502, 503]));
    expect(p.char.inventory.some((it) => it.uid === 500 || it.uid === 501)).toBe(false);
    expect(p.char.gold).toBe(gold + sellPrice(items[0], C) + sellPrice(items[1], C));
  });

  it('道具屋から離れていると売れない。中身がおかしい指定は断る', () => {
    const { w, p } = makeWorld(5);
    const it = createItem(600, 'w_bow', 1, 10, 'rare', w.rng, C);
    p.char.inventory.push(it);
    p.x = -100; p.y = -100;
    applyCommand(w, p, { type: 'sellMany', uids: [600] });
    expect(p.char.inventory).toContain(it);
    standBy(w, p, 'shop');
    applyCommand(w, p, { type: 'sellMany', uids: 'x' as unknown as number[] });
    applyCommand(w, p, { type: 'sellMany', uids: ['600' as unknown as number] });
    expect(p.char.inventory).toContain(it);
  });
});

describe('目標まで続けて精錬する', () => {
  it('目標に届くか、魔石か金が尽きるまで続ける', () => {
    const { w, p } = makeWorld(7);
    standBy(w, p, 'smith');
    const it = createItem(700, 'w_spear', 2, 20, 'epic', w.rng, C);
    p.char.inventory.push(it);
    p.char.gold = 10_000_000;
    p.char.bag[C.refine.stone] = 10_000;
    applyCommand(w, p, { type: 'refineTo', uid: 700, target: 5 });
    // +5 までは失敗しても下がらないので、必ず届く
    expect(it.refine).toBe(5);
    const tries = w.events.filter((e) => e.type === 'refine').length;
    expect(tries).toBeGreaterThanOrEqual(5);
    expect(tries).toBeLessThanOrEqual(MAX_REFINE_TRIES);
  });

  it('魔石が尽きたら、そこで止まる', () => {
    const { w, p } = makeWorld(8);
    standBy(w, p, 'smith');
    const it = createItem(701, 'w_spear', 0, 20, 'epic', w.rng, C);
    p.char.inventory.push(it);
    p.char.gold = 10_000_000;
    const need = C.refine.levels[0].stones + C.refine.levels[1].stones;
    p.char.bag[C.refine.stone] = need;
    w.events.length = 0;
    applyCommand(w, p, { type: 'refineTo', uid: 701, target: 10 });
    // 2回分の魔石しかないので、2回で止まる（2回目は 95% なので結果は +1 か +2）
    expect(w.events.filter((e) => e.type === 'refine')).toHaveLength(2);
    expect(it.refine).toBeGreaterThanOrEqual(1);
    expect(p.char.bag[C.refine.stone] ?? 0).toBe(0);
  });

  it('1回目から足りなければ、その理由を知らせて何もしない', () => {
    const { w, p } = makeWorld(9);
    standBy(w, p, 'smith');
    const it = createItem(702, 'w_spear', 2, 20, 'epic', w.rng, C);
    p.char.inventory.push(it);
    p.char.gold = 10_000_000;
    p.char.bag[C.refine.stone] = 0;
    w.events.length = 0;
    applyCommand(w, p, { type: 'refineTo', uid: 702, target: 3 });
    expect(it.refine).toBe(0);
    expect(w.events.some((e) => e.type === 'notice' && e.key === 'err.noStone')).toBe(true);
  });
});
