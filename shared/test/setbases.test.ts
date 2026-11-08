import { describe, expect, it } from 'vitest';
import { CONTENT } from '../src/content';
import { Rng } from '../src/rng';
import { createItem, createSetPiece, repairSetItem } from '../src/systems/loot';
import { canEquip, equipItem } from '../src/systems/items';
import { migrateAccount, repairAccountSets, serializeAccount, SAVE_VERSION } from '../src/save';
import type { EquipSlot } from '../src/core';
import type { Item } from '../src/state';
import { makeWorld } from './helpers';

const C = CONTENT;
const SLOTS: EquipSlot[] = ['head', 'body', 'accessory', 'sub'];

/** 以前のバグで作られた形：名前はセットの部位なのに、中身が別の土台 */
function brokenPiece(uid: number, setId: string, slot: EquipSlot, wrongBase: string): Item {
  const it = createItem(uid, wrongBase, 3, 30, 'epic', new Rng(uid), C, { set: setId });
  it.name = C.sets[setId].pieces[slot]!;
  it.refine = 7;
  return it;
}

describe('セット装備の名前と中身', () => {
  it('どのセット・どの部位でも、作られた装備の土台は sets.json の bases と一致する', () => {
    const rng = new Rng(11);
    for (const [id, s] of Object.entries(C.sets)) {
      for (const slot of Object.keys(s.pieces) as EquipSlot[]) {
        for (let i = 0; i < 20; i++) {
          const it = createSetPiece(i, id, 30, 'rare', rng, C, slot)!;
          expect(it.base).toBe(s.bases[slot]);
          expect(it.kind).toBe(C.equipment.bases[s.bases[slot]!].kind);
          expect(it.name).toBe(s.pieces[slot]);
        }
      }
    }
  });

  it('護符のセット装備（翠風・白銀）は鎌に装備できる', () => {
    const { w, ch } = makeWorld(21);
    ch.level = 40;
    ch.equipment.weapon = createItem(900, 'w_scythe', 3, 30, 'rare', new Rng(1), C);
    for (const id of ['set_meadow', 'set_frost']) {
      for (let i = 0; i < 10; i++) {
        const it = createSetPiece(1000 + i, id, 30, 'rare', new Rng(i), C, 'sub')!;
        expect(it.kind).toBe('talisman');
        expect(canEquip(ch, it, w)).toBeNull();
      }
    }
  });

  it('中身がずれた既存のセット装備を直す（レアリティ・オプション・精錬・結晶はそのまま）', () => {
    const it = brokenPiece(5, 'set_meadow', 'sub', 's_shield');
    const before = { rarity: it.rarity, options: JSON.stringify(it.options), refine: it.refine, crystals: it.crystals.length, tier: it.tier, uid: it.uid };
    expect(repairSetItem(it, C)).toBe(true);
    expect(it.base).toBe('s_talisman');
    expect(it.kind).toBe('talisman');
    expect(it.look.startsWith(C.equipment.bases.s_talisman.look + ':')).toBe(true);
    expect(Object.keys(it.stats).sort()).toEqual(Object.keys(C.equipment.bases.s_talisman.stats).sort());
    expect({ rarity: it.rarity, options: JSON.stringify(it.options), refine: it.refine, crystals: it.crystals.length, tier: it.tier, uid: it.uid }).toEqual(before);
    // 2回目は何もしない
    expect(repairSetItem(it, C)).toBe(false);
    // セットでない装備・正しい装備は触らない
    expect(repairSetItem(createItem(6, 's_shield', 3, 30, 'rare', new Rng(1), C), C)).toBe(false);
    expect(repairSetItem(createSetPiece(7, 'set_ember', 30, 'rare', new Rng(1), C, 'sub'), C)).toBe(false);
  });

  it('版8への移行で、持ち物・装備・倉庫のセット装備が直る。合わなくなったサブ武器は外れる', () => {
    const { acc, ch } = makeWorld(22);
    ch.equipment.weapon = createItem(900, 'w_scythe', 3, 30, 'rare', new Rng(1), C);
    // 鎌に、中身が護符になっていた「灰燼の盾」を付けている（直すと盾になり、鎌には合わないので外れる）
    ch.equipment.sub = brokenPiece(10, 'set_ember', 'sub', 's_talisman');
    ch.equipment.body = brokenPiece(11, 'set_frost', 'body', 'a_cloth');
    ch.inventory.push(brokenPiece(12, 'set_meadow', 'sub', 's_quiver'));
    acc.storage.items.push(brokenPiece(13, 'set_twilight', 'sub', 's_magazine'));
    const raw = JSON.parse(serializeAccount(acc));
    raw.version = 7;
    const m = migrateAccount(raw);
    expect(m.version).toBe(SAVE_VERSION);
    const c2 = m.characters.find((x) => x.id === ch.id)!;
    expect(c2.equipment.body!.base).toBe('a_heavy');
    expect(c2.equipment.sub).toBeNull();
    const shield = c2.inventory.find((x) => x.uid === 10)!;
    expect(shield.kind).toBe('shield');
    expect(c2.inventory.find((x) => x.uid === 12)!.kind).toBe('talisman');
    expect(m.storage.items.find((x) => x.uid === 13)!.kind).toBe('dagger');
    // もう一度かけても変わらない
    expect(repairAccountSets(m)).toBe(0);
  });

  it('直したあとも装備できる組み合わせはそのまま装備しておける', () => {
    const { w, ch } = makeWorld(23);
    ch.level = 40;
    ch.equipment.weapon = createItem(900, 'w_scythe', 3, 30, 'rare', new Rng(1), C);
    const it = brokenPiece(30, 'set_frost', 'sub', 's_shield');
    repairSetItem(it, C);
    ch.inventory.push(it);
    expect(equipItem(w, ch, 30)).toBeNull();
    expect(ch.equipment.sub?.uid).toBe(30);
  });

  it('全部位の bases が部位と合っている', () => {
    for (const s of Object.values(C.sets)) {
      for (const slot of SLOTS) {
        if (!s.pieces[slot]) continue;
        expect(C.equipment.bases[s.bases[slot]!].slot).toBe(slot);
      }
    }
  });
});
