import { describe, expect, it } from 'vitest';
import { CONTENT } from '../src/content';
import { Rng } from '../src/rng';
import { createItem, createSetPiece } from '../src/systems/loot';
import {
  addToBag, crystalFits, deposit, equipItem, expandStorage, insertCrystal, refineCost, removeCrystal, setAppearance,
  sortItems, storageExpandCost, withdraw,
} from '../src/systems/items';
import { derivePlayerStats, setMods } from '../src/systems/stats';
import { conditionalMods } from '../src/systems/effects';
import { dealDot } from '../src/systems/combat';
import { migrateAccount, newAccount, newCharacter, serializeAccount, SAVE_VERSION } from '../src/save';
import { makeTraining, makeWorld, spawnAt, tick } from './helpers';
import type { Item } from '../src/state';

const C = CONTENT;
// 鍛冶屋のそば（位置はデータから。街の作りを変えてもテストが壊れないように）
const nearSmith = (p: { x: number; y: number }) => {
  const n = CONTENT.areas.lumina.npcs!.find((x) => x.npc === 'smith')!;
  p.x = n.x; p.y = n.y + 0.8;
};

describe('装備の生成', () => {
  it('レジェンドは固有効果、ミシックはスキルを変える効果を持つ', () => {
    const rng = new Rng(4);
    for (let i = 0; i < 20; i++) {
      const l = createItem(i, 'w_oneHandSword', 3, 30, 'legend', rng, C);
      expect(l.unique && C.uniques[l.unique].slots.includes('weapon')).toBeTruthy();
      const m = createItem(i, 'w_oneHandSword', 3, 30, 'mythic', rng, C);
      expect(m.mythic && C.mythics[m.mythic].slots.includes('weapon')).toBeTruthy();
    }
  });

  it('5部位すべての装備が作れ、サブ武器は武器に合うものだけ付く', () => {
    const { w, ch } = makeWorld(2);
    const shield = createItem(900, 's_shield', 0, 1, 'common', new Rng(1), C);
    const quiver = createItem(901, 's_quiver', 0, 1, 'common', new Rng(1), C);
    ch.inventory.push(shield, quiver, createItem(902, 'w_bow', 0, 1, 'common', new Rng(1), C));
    expect(equipItem(w, ch, 901)).toBe('err.subMismatch');
    expect(equipItem(w, ch, 900)).toBeNull();
    expect(ch.equipment.sub?.uid).toBe(900);
    for (const b of ['h_helm', 'x_earring']) {
      const it = createItem(950 + b.length, b, 0, 1, 'common', new Rng(2), C);
      ch.inventory.push(it);
      expect(equipItem(w, ch, it.uid)).toBeNull();
    }
    expect(ch.equipment.head).not.toBeNull();
    // 弓に持ち替えると盾は外れる
    const bow = ch.inventory.find((x) => x.kind === 'bow')!;
    equipItem(w, ch, bow.uid);
    expect(ch.equipment.sub).toBeNull();
  });
});

describe('精錬', () => {
  it('段階が上がるほど費用が上がり、成功率が下がる', () => {
    const it = createItem(1, 'w_oneHandSword', 4, 45, 'rare', new Rng(1), C);
    const c0 = refineCost(it, C)!;
    it.refine = 10;
    const c10 = refineCost(it, C)!;
    expect(c10.gold).toBeGreaterThan(c0.gold);
    expect(c10.rate).toBeLessThan(c0.rate);
    it.refine = C.refine.max;
    expect(refineCost(it, C)).toBeNull();
  });

  it('失敗すると高段階では下がり、天井が積もり、成功で天井が戻る', () => {
    const { w, p, ch } = makeWorld(3);
    nearSmith(p);
    const it = ch.equipment.weapon!;
    it.refine = 9;
    ch.gold = 1e9;
    addToBag(ch, 'refine_stone', 9999);
    let sawFail = false, sawSuccessAfterFail = false;
    for (let i = 0; i < 300; i++) {
      const before = it.refine, pity = it.refinePity;
      tick(w, p, { commands: [{ type: 'refine', uid: it.uid }] });
      if (it.refine < before) { sawFail = true; expect(it.refinePity).toBe(pity + C.refine.pityPerFail); }
      if (it.refine > before) { if (pity > 0) sawSuccessAfterFail = true; expect(it.refinePity).toBe(0); }
      if (it.refine >= 13) it.refine = 9;
    }
    expect(sawFail).toBe(true);
    expect(sawSuccessAfterFail).toBe(true);
    expect(it.trade).toBe('once');
  });

  it('精錬すると装備の数値が上がる', () => {
    const { ch } = makeWorld(5);
    const a = derivePlayerStats(ch, [], C).atk;
    ch.equipment.weapon!.refine = 10;
    expect(derivePlayerStats(ch, [], C).atk).toBeGreaterThan(a);
  });

  it('鍛冶屋のそばでないとできない', () => {
    const { w, p, ch } = makeWorld(6);
    ch.gold = 1e6; addToBag(ch, 'refine_stone', 10);
    tick(w, p, { commands: [{ type: 'refine', uid: ch.equipment.weapon!.uid }] });
    expect(ch.equipment.weapon!.refine).toBe(0);
    expect(w.events.some((e) => e.type === 'notice' && e.key === 'err.notNear')).toBe(true);
  });
});

describe('結晶', () => {
  it('枠に差し込むと効果が乗り、外すと壊れる（ゴールドで回収もできる）', () => {
    const { ch } = makeWorld(7);
    ch.level = 30;
    const it = createItem(77, 'w_oneHandSword', 2, 20, 'epic', new Rng(3), C);
    it.crystals = [null, null];
    ch.inventory.push(it);
    addToBag(ch, 'cr_ember', 2);
    expect(crystalFits(it, 'cr_bedrock', C)).toBe(false);
    expect(insertCrystal(ch, 77, 0, 'cr_bedrock', C)).toBe('err.crystalSlot');
    expect(insertCrystal(ch, 77, 0, 'cr_ember', C)).toBeNull();
    expect(insertCrystal(ch, 77, 1, 'cr_ember', C)).toBe('err.crystalDup');
    expect(ch.bag.cr_ember).toBe(1);
    equipItem({ content: C } as never, ch, 77);
    expect(derivePlayerStats(ch, [], C).m.fireDmgPct).toBeGreaterThanOrEqual(C.crystals.cr_ember.mods.fireDmgPct!);
    // 壊す
    expect(removeCrystal(ch, 77, 0, false, C)).toBeNull();
    expect(ch.bag.cr_ember).toBe(1);
    // 回収
    insertCrystal(ch, 77, 0, 'cr_ember', C);
    ch.gold = 0;
    expect(removeCrystal(ch, 77, 0, true, C)).toBe('err.gold');
    ch.gold = 1e5;
    expect(removeCrystal(ch, 77, 0, true, C)).toBeNull();
    expect(ch.bag.cr_ember).toBe(1);
    expect(ch.gold).toBe(1e5 - C.crystals.cr_ember.recover);
  });
});

describe('セット装備', () => {
  it('2部位・4部位そろえるとボーナス', () => {
    const { ch } = makeWorld(8);
    const rng = new Rng(9);
    const pieces = (['head', 'body', 'accessory', 'sub'] as const).map((s, i) => createSetPiece(500 + i, 'set_ember', 30, 'rare', rng, C, s)!);
    expect(pieces.every((x) => x.set === 'set_ember')).toBe(true);
    ch.equipment.head = pieces[0];
    expect(setMods(ch, C).maxHpPct ?? 0).toBe(0);
    ch.equipment.body = pieces[1];
    expect(setMods(ch, C).maxHpPct).toBe(8);
    expect(setMods(ch, C).fireDmgPct ?? 0).toBe(0);
    ch.equipment.accessory = pieces[2];
    ch.equipment.sub = pieces[3];
    expect(setMods(ch, C).fireDmgPct).toBe(15);
  });
});

describe('固有効果とミシック', () => {
  const withUnique = (id: string, slot: Item['slot'] = 'weapon') => {
    const t = makeTraining('oneHandSword', 30, 1.0);
    const base = slot === 'weapon' ? 'w_oneHandSword' : slot === 'body' ? 'a_heavy' : 'x_ring';
    const it = createItem(4000, base, 2, 30, 'legend', new Rng(1), C);
    it.unique = id; it.mythic = undefined;
    t.ch.equipment[slot] = it;
    t.p.statsDirty = true;
    tick(t.w, t.p);
    return t;
  };

  it('狂戦士：HP が半分以下で攻撃力が上がる', () => {
    const t = withUnique('berserker');
    const atk = t.p.stats.atk;
    t.p.hp = Math.round(t.p.stats.maxHp * 0.3);
    expect(conditionalMods(t.w, t.p).key).toContain('berserker');
    tick(t.w, t.p);
    expect(t.p.stats.atk).toBeGreaterThan(atk);
  });

  it('不屈：倒れるダメージを一度だけ耐える', () => {
    const t = withUnique('undying', 'body');
    const src = t.w.area.monsters[0];
    t.w.events = [];
    dealDot(t.w, t.p, 1e7, 'burn', src.id);
    expect(t.p.dead).toBe(false);
    expect(t.p.hp).toBe(1);
    expect(t.w.events.some((e) => e.type === 'proc')).toBe(true);
    t.p.iframes = 0;
    dealDot(t.w, t.p, 1e7, 'burn', src.id);
    expect(t.p.dead).toBe(true);
  });

  it('灼焔の理：通常攻撃が火の弾になる', () => {
    const t = makeTraining('oneHandSword', 30, 3.0);
    const it = createItem(4001, 'w_oneHandSword', 2, 30, 'mythic', new Rng(1), C);
    it.mythic = 'flame_law';
    t.ch.equipment.weapon = it;
    t.p.statsDirty = true;
    tick(t.w, t.p, { attack: true, aim: { x: 1, y: 0 } }, 2);
    expect(t.w.area.projectiles.some((pr) => pr.ownerId === t.p.id && pr.spec.element === 'fire')).toBe(true);
  });

  it('千手：多段スキルの回数が増える', () => {
    const t = makeTraining('oneHandSword', 30, 1.0);
    const it = createItem(4002, 'w_oneHandSword', 2, 30, 'mythic', new Rng(1), C);
    it.mythic = 'thousand_arms';
    t.ch.equipment.weapon = it;
    t.ch.skills.slash = 3; t.ch.skills.renga = 1;
    t.ch.skillSlots.oneHandSword = ['renga', null, null, null];
    t.p.mp = 100; t.p.statsDirty = true;
    tick(t.w, t.p, { skill: 0 });
    const s = t.w.area.strikes.find((x) => x.ownerId === t.p.id)!;
    expect(s.hitCount).toBe(4 + C.mythics.thousand_arms.value);
  });
});

describe('倉庫・並べ替え・ルートフィルター・アバター', () => {
  it('倉庫はアカウントで共有し、広げるとゴールドを使う', () => {
    const { w, ch, acc } = makeWorld(10);
    ch.inventory.push(createItem(903, 'w_spear', 0, 1, 'common', new Rng(1), C));
    const it = ch.inventory[0];
    expect(deposit(w, ch, it.uid)).toBeNull();
    expect(acc.storage.items[0].uid).toBe(it.uid);
    expect(withdraw(w, ch, it.uid)).toBeNull();
    const cost = storageExpandCost(acc, C)!;
    ch.gold = cost;
    expect(expandStorage(w, ch)).toBeNull();
    expect(acc.storage.capacity).toBe(C.storage.base + C.storage.step);
    expect(storageExpandCost(acc, C)!).toBeGreaterThan(cost);
  });

  it('並べ替え', () => {
    const rng = new Rng(1);
    const items = (['common', 'mythic', 'rare'] as const).map((r, i) => createItem(i, 'w_oneHandSword', 0, 1, r, rng, C));
    expect(sortItems(items, 'rarity').map((x) => x.rarity)).toEqual(['mythic', 'rare', 'common']);
    expect(sortItems(items, 'new').map((x) => x.uid)).toEqual([2, 1, 0]);
  });

  it('自動売却：設定より下のレア度は拾わずにゴールドになる', () => {
    const { w, p, ch } = makeTraining('oneHandSword', 30, 6, 12);
    ch.lootFilter = { hideBelow: null, sellBelow: 'mythic' };
    const boss = spawnAt(w, 'ignaros', 12, 18, 30);
    boss.hp = 1;
    p.x = boss.x - 1.2; p.y = boss.y;
    let sold = 0;
    for (let i = 0; i < 40 && !boss.dead; i++) {
      tick(w, p, { attack: true });
      for (const e of w.events) if (e.type === 'autoSell') sold++;
    }
    expect(sold).toBeGreaterThan(0);
    expect(w.area.drops.filter((d) => d.item && d.item.rarity !== 'mythic').length).toBe(0);
  });

  it('見た目は手に入れたものだけ選べる', () => {
    const { ch } = makeWorld(13);
    const look = ch.equipment.body!.look;
    expect(ch.appearance.looks).toContain(look);
    expect(setAppearance(ch, 'body', look, C)).toBeNull();
    expect(setAppearance(ch, 'body', 'heavy:8', C)).toBe('err.invalid');
    expect(setAppearance(ch, 'head', look, C)).toBe('err.invalid');
  });
});

describe('セーブの版上げ', () => {
  it('版1のデータを読み込むと、倉庫・アバター・フィルターが足される', () => {
    const acc = newAccount(1, 2);
    newCharacter(acc, 'A', { body: 0, hair: 0 }, 1);
    const raw = JSON.parse(serializeAccount(acc));
    raw.version = 1;
    delete raw.storage;
    for (const ch of raw.characters) { delete ch.appearance; delete ch.lootFilter; }
    const m = migrateAccount(raw);
    expect(m.version).toBe(SAVE_VERSION);
    expect(m.storage.capacity).toBe(C.storage.base);
    expect(m.characters[0].appearance.looks.length).toBeGreaterThan(0);
    expect(m.characters[0].lootFilter).toEqual({ hideBelow: null, sellBelow: null });
  });
});
