import { describe, expect, it } from 'vitest';
import { newAccount, newCharacter, serializeAccount } from '../src/save';
import { sanitizeAccount, checkItem } from '../src/validate';
import { createItem } from '../src/systems/loot';
import { Rng } from '../src/rng';
import { CONTENT } from '../src/content';

const C = CONTENT;
function make() {
  const acc = newAccount(1, 2);
  const ch = newCharacter(acc, 'A', { body: 0, hair: 0 }, 1);
  ch.level = 30;
  return { acc, ch };
}

describe('引き継ぎの検証', () => {
  it('普通のセーブはそのまま通る', () => {
    const { acc, ch } = make();
    ch.stats.str = 20; ch.gold = 5000; ch.bag.potion_s = 10;
    ch.inventory.push(createItem(9999, 'w_bow', 3, 30, 'legend', new Rng(4), C));
    const raw = JSON.parse(serializeAccount(acc));
    const r = sanitizeAccount(raw);
    expect(r.removed).toEqual([]);
    expect(r.account.characters[0].inventory.length).toBe(ch.inventory.length);
    expect(r.account.characters[0].stats.str).toBe(20);
  });

  it('おかしいものは削り、何を削ったかを返す（キャラは残る）', () => {
    const { acc, ch } = make();
    const good = createItem(1001, 'w_oneHandSword', 3, 30, 'epic', new Rng(1), C);
    const refine = { ...createItem(1002, 'w_spear', 3, 30, 'rare', new Rng(2), C), refine: 20 };
    const opts = createItem(1003, 'w_staff', 3, 30, 'epic', new Rng(3), C);
    opts.options = opts.options.map((o) => ({ ...o, value: o.value * 50 }));
    const unknown = { ...good, uid: 1004, base: 'w_laser' };
    const dup = { ...good };
    ch.inventory.push(good, refine, opts, unknown, dup);
    ch.gold = 1e12;
    ch.bag.potion_s = 1e7;
    ch.bag.no_such = 3;
    ch.stats.str = 250;
    ch.skills.slash = 99;
    ch.level = 999;
    const raw = JSON.parse(serializeAccount(acc));
    const r = sanitizeAccount(raw);
    const c2 = r.account.characters[0];
    expect(r.account.characters.length).toBe(1);
    expect(c2.inventory.some((i) => i.uid === 1001)).toBe(true);
    expect(c2.inventory.some((i) => i.uid === 1002 || i.uid === 1003 || i.uid === 1004)).toBe(false);
    expect(c2.inventory.filter((i) => i.uid === 1001).length).toBe(1);
    expect(c2.level).toBe(C.balance.progression.maxLevel);
    expect(c2.gold).toBeLessThanOrEqual(999_999_999);
    expect(c2.bag.potion_s).toBeLessThanOrEqual(9999);
    expect(c2.bag.no_such).toBeUndefined();
    expect(c2.skills.slash).toBeUndefined();
    const reasons = new Set(r.removed.map((x) => x.reason));
    for (const k of ['refine', 'options', 'unknown', 'duplicate', 'gold', 'amount', 'points']) expect(reasons.has(k), k).toBe(true);
  });

  it('古い版のセーブも版の変換を通してから確かめる', () => {
    const { acc } = make();
    const raw = JSON.parse(serializeAccount(acc));
    raw.version = 1;
    for (const ch of raw.characters) { delete ch.pets; delete ch.tutorial; delete ch.sub; }
    const r = sanitizeAccount(raw);
    expect(r.account.characters[0].pets).toEqual([]);
    expect(r.account.characters[0].tutorial.done).toBe(true);
  });

  it('ちゃんと作った装備はどれも通る', () => {
    const rng = new Rng(7);
    for (const base of Object.keys(C.equipment.bases)) {
      for (const rarity of ['common', 'rare', 'epic', 'legend', 'mythic'] as const) {
        const it = createItem(1, base, rng.int(0, 8), rng.int(1, 100), rarity, rng, C);
        expect(checkItem(it), `${base} ${rarity}`).toBeNull();
      }
    }
  });
});
