import { EQUIP_SLOTS, RARITIES, rarityRank, type EquipSlot, type Rarity, type WeaponType } from '../core';
import type { AccountData, CharacterData, Item, Player, World } from '../state';
import type { Content } from '../content/types';
import { recordCodex } from './quest';
import { applyStatus } from './status';
import { baseBonus, baseOf, type BaseHolder } from './base';
import { addCounter, setCounterMax } from './counters';
import { heal } from './combat';
import { sellPrice } from './loot';
import { nearRole } from './interact';
import { accountOf, notice } from './util';

/** 装備できるか。できないなら理由のキー */
export function canEquip(ch: CharacterData, it: Item, w: World): string | null {
  const c = w.content;
  if (ch.level < it.reqLevel) return 'err.levelLow';
  if (it.slot === 'weapon' && !c.weapons[it.kind as WeaponType]) return 'err.invalid';
  if (it.slot === 'sub') {
    const wt = (ch.equipment.weapon?.kind ?? 'oneHandSword') as WeaponType;
    const allowed = c.weapons[wt]?.subs ?? [];
    if (!allowed.includes(it.kind as never)) return 'err.subMismatch';
  }
  return null;
}

/** 持ち物から装備する。前の装備は持ち物に戻る */
export function equipItem(w: World, ch: CharacterData, uid: number): string | null {
  const idx = ch.inventory.findIndex((it) => it.uid === uid);
  if (idx < 0) return Object.values(ch.equipment).some((e) => e?.uid === uid) ? null : 'err.invalid';
  const it = ch.inventory[idx];
  const err = canEquip(ch, it, w);
  if (err) return err;
  const prev = ch.equipment[it.slot];
  ch.inventory.splice(idx, 1);
  if (prev) ch.inventory.splice(idx, 0, prev);
  ch.equipment[it.slot] = it;
  registerLook(ch, it);
  // 武器を替えて合わなくなったサブ武器は外す
  if (it.slot === 'weapon' && ch.equipment.sub && canEquip(ch, ch.equipment.sub, w)) {
    ch.inventory.push(ch.equipment.sub);
    ch.equipment.sub = null;
  }
  return null;
}

export function unequipItem(w: World, ch: CharacterData, slot: EquipSlot): string | null {
  if (!EQUIP_SLOTS.includes(slot)) return 'err.invalid';
  if (slot === 'weapon') return 'err.invalid';
  const it = ch.equipment[slot];
  if (!it) return null;
  if (ch.inventory.length >= w.content.balance.player.inventorySize) return 'err.full';
  ch.equipment[slot] = null;
  ch.inventory.push(it);
  return null;
}

export function addToBag(ch: CharacterData, id: string, n: number) {
  ch.bag[id] = (ch.bag[id] ?? 0) + n;
}

export function takeFromBag(ch: CharacterData, id: string, n: number): boolean {
  if ((ch.bag[id] ?? 0) < n) return false;
  ch.bag[id] -= n;
  if (ch.bag[id] <= 0) delete ch.bag[id];
  return true;
}

/** 消耗品を使う */
export function useItem(w: World, p: Player, id: string): string | null {
  const d = w.content.materials[id];
  if (!d?.use) return 'err.invalid';
  if (p.dead) return 'err.invalid';
  if ((p.char.bag[id] ?? 0) <= 0) return 'err.none';
  const u = d.use;
  if (u.capture) return 'err.invalid';
  if (u.food) {
    const k = 1 + baseBonus(baseOf(p), w.content, w.clock, 'foodDuration') / 100;
    applyStatus(w, p, p.id, 'food', u.food.duration * 60 * k, { mods: { ...u.food.mods } });
    p.statsDirty = true;
    takeFromBag(p.char, id, 1);
    return null;
  }
  if (u.healPct || u.heal) {
    if (p.hp >= p.stats.maxHp && !u.mpPct) return 'err.full';
    heal(w, p, (u.heal ?? 0) + (p.stats.maxHp * (u.healPct ?? 0)) / 100);
  }
  if (u.mpPct) p.mp = Math.min(p.stats.maxMp, p.mp + (p.stats.maxMp * u.mpPct) / 100);
  takeFromBag(p.char, id, 1);
  return null;
}

/** 道具屋で売る */
export function sellItem(w: World, p: Player, uid: number): string | null {
  if (!nearRole(w, p, 'shop')) return 'err.notNear';
  const ch = p.char;
  const idx = ch.inventory.findIndex((it) => it.uid === uid);
  if (idx < 0) return 'err.invalid';
  if (ch.inventory[idx].locked) return 'err.locked';
  const price = sellPrice(ch.inventory[idx], w.content);
  ch.inventory.splice(idx, 1);
  ch.gold += price;
  w.events.push({ type: 'gold', playerId: p.id, amount: price });
  return null;
}

export function sellBag(w: World, p: Player, id: string, n: number): string | null {
  if (!nearRole(w, p, 'shop')) return 'err.notNear';
  const d = w.content.materials[id];
  if (!d) return 'err.invalid';
  const k = Math.min(n, p.char.bag[id] ?? 0);
  if (k <= 0) return 'err.none';
  takeFromBag(p.char, id, k);
  const price = Math.round(d.price * k * w.content.balance.sell.materialMul);
  p.char.gold += price;
  w.events.push({ type: 'gold', playerId: p.id, amount: price });
  return null;
}

/** 道具屋で買う */
export function buy(w: World, p: Player, shop: string, id: string, n: number): string | null {
  if (!nearRole(w, p, 'shop')) return 'err.notNear';
  const s = w.content.shops[shop];
  if (!s || !s.items.includes(id)) return 'err.invalid';
  const d = w.content.materials[id];
  const k = Math.max(1, Math.floor(n));
  const cost = d.price * k;
  if (p.char.gold < cost) return 'err.gold';
  p.char.gold -= cost;
  addToBag(p.char, id, k);
  return null;
}

/** 地面のアイテムを拾う */
export function updateDrops(w: World) {
  const range = w.content.balance.player.pickupRange;
  const max = w.content.balance.player.inventorySize;
  w.area.drops = w.area.drops.filter((d) => {
    if (--d.ticksLeft <= 0) return false;
    for (const p of w.players) {
      if (p.dead) continue;
      if (Math.hypot(p.x - d.x, p.y - d.y) > range) continue;
      if (d.item) {
        const hide = p.char.lootFilter.hideBelow;
        if (hide && rarityRank(d.item.rarity) < rarityRank(hide) && d.ownerId === p.id) continue;
        if (p.char.inventory.length >= max) { if (w.tick % 40 === 0) notice(w, p.id, 'err.full'); continue; }
        p.char.inventory.push(d.item);
        registerLook(p.char, d.item);
        recordCodex(w, p, 'items', d.item.base);
      } else if (d.bag) {
        addToBag(p.char, d.bag.id, d.bag.n);
        if (w.content.materials[d.bag.id]) recordCodex(w, p, 'materials', d.bag.id);
      }
      w.events.push({ type: 'pickup', playerId: p.id, item: d.item, bag: d.bag });
      return false;
    }
    return true;
  });
}

// ───────── アバター ─────────

/** 手に入れた装備の見た目を登録する */
export function registerLook(ch: CharacterData, it: Item) {
  if (!ch.appearance.looks.includes(it.look)) ch.appearance.looks.push(it.look);
}

const LOOK_SLOT: Record<string, 'weapon' | 'body' | 'head'> = { weapon: 'weapon', body: 'body', head: 'head' };

export function lookSlotOf(look: string, c: Content): 'weapon' | 'body' | 'head' | null {
  const key = look.split(':')[0];
  const base = Object.values(c.equipment.bases).find((b) => b.look === key);
  return base ? LOOK_SLOT[base.slot] ?? null : null;
}

export function setAppearance(ch: CharacterData, slot: 'weapon' | 'body' | 'head', look: string | null, c: Content): string | null {
  if (look === null) { delete ch.appearance.selected[slot]; return null; }
  if (!ch.appearance.looks.includes(look)) return 'err.invalid';
  if (lookSlotOf(look, c) !== slot) return 'err.invalid';
  ch.appearance.selected[slot] = look;
  return null;
}

/** 表示に使う見た目（選んでいなければ装備中のもの） */
export function shownLook(ch: CharacterData, slot: 'weapon' | 'body' | 'head'): string | null {
  return ch.appearance.selected[slot] ?? ch.equipment[slot]?.look ?? null;
}

// ───────── ルートフィルター・並べ替え ─────────

export function setLootFilter(ch: CharacterData, hideBelow: Rarity | null, sellBelow: Rarity | null): string | null {
  if (hideBelow !== null && !RARITIES.includes(hideBelow)) return 'err.invalid';
  if (sellBelow !== null && !RARITIES.includes(sellBelow)) return 'err.invalid';
  ch.lootFilter = { hideBelow, sellBelow };
  return null;
}

const SLOT_ORDER: EquipSlot[] = ['weapon', 'sub', 'body', 'head', 'accessory'];

export function sortItems(items: Item[], key: string): Item[] {
  const by: Record<string, (a: Item, b: Item) => number> = {
    rarity: (a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || b.ilvl - a.ilvl,
    slot: (a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot) || a.kind.localeCompare(b.kind) || rarityRank(b.rarity) - rarityRank(a.rarity),
    level: (a, b) => b.ilvl - a.ilvl || rarityRank(b.rarity) - rarityRank(a.rarity),
    new: (a, b) => b.uid - a.uid,
  };
  const f = by[key] ?? by.rarity;
  return [...items].sort(f);
}

// ───────── 精錬 ─────────

export function refineCost(it: Item, c: Content, bonus = 0): { gold: number; stones: number; rate: number } | null {
  const r = c.refine;
  if (it.refine >= r.max) return null;
  const lv = r.levels[it.refine];
  return {
    gold: Math.round(lv.gold * (1 + it.tier * r.goldTierMul)),
    // 高いティアほど魔石も多く（魔石はレベルとともに多く落ちるので、どの帯でも同じくらいの手間に）
    stones: Math.round(lv.stones * (1 + it.tier * (r.stoneTierMul ?? 0))),
    rate: Math.min(100, lv.rate + it.refinePity + bonus),
  };
}

/**
 * 精錬。成功で +1。失敗すると段階が下がることがある（drop）。
 * 失敗するたびに次の成功率が上がる（天井）。成功したら天井は戻る。
 */
export function refineItem(w: World, p: Player, uid: number): string | null {
  const c = w.content;
  const ch = p.char;
  const it = findOwnedItem(ch, uid);
  if (!it) return 'err.invalid';
  const cost = refineCost(it, c, baseBonus(baseOf(p), c, w.clock, 'refineRate'));
  if (!cost) return 'err.refineMax';
  if (ch.gold < cost.gold) return 'err.gold';
  if ((ch.bag[c.refine.stone] ?? 0) < cost.stones) return 'err.noStone';
  ch.gold -= cost.gold;
  takeFromBag(ch, c.refine.stone, cost.stones);
  const ok = w.rng.next() * 100 < cost.rate;
  if (ok) {
    it.refine++;
    it.refinePity = 0;
    addCounter(w, p, 'refineSuccess', 1);
    setCounterMax(w, p, 'refineMax', it.refine);
  } else {
    it.refine = Math.max(0, it.refine - c.refine.levels[it.refine].drop);
    it.refinePity += c.refine.pityPerFail;
  }
  if (it.trade === 'free') it.trade = 'once';
  w.events.push({ type: 'refine', playerId: p.id, uid, success: ok, level: it.refine });
  return null;
}

export function findOwnedItem(ch: CharacterData, uid: number): Item | undefined {
  return ch.inventory.find((x) => x.uid === uid) ?? (Object.values(ch.equipment).find((x) => x?.uid === uid) ?? undefined);
}

// ───────── 結晶 ─────────

export function crystalFits(it: Item, crystal: string, c: Content): boolean {
  const d = c.crystals[crystal];
  if (!d) return false;
  return d.slots === 'any' || d.slots.includes(it.slot);
}

export function insertCrystal(ch: CharacterData, uid: number, socket: number, crystal: string, c: Content): string | null {
  const it = findOwnedItem(ch, uid);
  if (!it || socket < 0 || socket >= it.crystals.length) return 'err.invalid';
  if (it.crystals[socket]) return 'err.socketUsed';
  if (!crystalFits(it, crystal, c)) return 'err.crystalSlot';
  if (it.crystals.includes(crystal)) return 'err.crystalDup';
  if (!takeFromBag(ch, crystal, 1)) return 'err.none';
  it.crystals[socket] = crystal;
  return null;
}

/** 結晶を外す。recover ならゴールドを払って取り戻す。そうでなければ壊れる */
export function removeCrystal(ch: CharacterData, uid: number, socket: number, recover: boolean, c: Content): string | null {
  const it = findOwnedItem(ch, uid);
  if (!it || socket < 0 || socket >= it.crystals.length) return 'err.invalid';
  const cr = it.crystals[socket];
  if (!cr) return 'err.invalid';
  if (recover) {
    const cost = c.crystals[cr]?.recover ?? 0;
    if (ch.gold < cost) return 'err.gold';
    ch.gold -= cost;
    addToBag(ch, cr, 1);
  }
  it.crystals[socket] = null;
  return null;
}

// ───────── 倉庫（アカウントで共有） ─────────

/** 倉庫の容量（拠点の金庫で増える） */
export function storageCap(w: World, acc: AccountData, holder: BaseHolder = acc): number {
  return acc.storage.capacity + baseBonus(holder, w.content, w.clock, 'storage');
}

export function storageExpandCost(acc: AccountData, c: Content): number | null {
  const s = c.storage;
  if (acc.storage.capacity >= s.max) return null;
  const n = Math.round((acc.storage.capacity - s.base) / s.step);
  return Math.round(s.costBase * Math.pow(s.costGrowth, n));
}

export function deposit(w: World, ch: CharacterData, uid: number): string | null {
  const st = accountOf(w, ch).storage;
  const i = ch.inventory.findIndex((x) => x.uid === uid);
  if (i < 0) return 'err.invalid';
  const pl = w.players.find((x) => x.char === ch)!;
  if (st.items.length >= storageCap(w, pl.account, baseOf(pl))) return 'err.storageFull';
  st.items.push(ch.inventory.splice(i, 1)[0]);
  return null;
}

export function withdraw(w: World, ch: CharacterData, uid: number): string | null {
  const st = accountOf(w, ch).storage;
  const i = st.items.findIndex((x) => x.uid === uid);
  if (i < 0) return 'err.invalid';
  if (ch.inventory.length >= w.content.balance.player.inventorySize) return 'err.full';
  const it = st.items.splice(i, 1)[0];
  ch.inventory.push(it);
  registerLook(ch, it);
  return null;
}

export function depositBag(w: World, ch: CharacterData, id: string, n: number): string | null {
  const k = Math.min(Math.floor(n), ch.bag[id] ?? 0);
  if (k <= 0) return 'err.none';
  takeFromBag(ch, id, k);
  const sb = accountOf(w, ch).storage.bag;
  sb[id] = (sb[id] ?? 0) + k;
  return null;
}

export function withdrawBag(w: World, ch: CharacterData, id: string, n: number): string | null {
  const st = accountOf(w, ch).storage.bag;
  const k = Math.min(Math.floor(n), st[id] ?? 0);
  if (k <= 0) return 'err.none';
  st[id] -= k;
  if (st[id] <= 0) delete st[id];
  addToBag(ch, id, k);
  return null;
}

export function expandStorage(w: World, ch: CharacterData): string | null {
  const acc = accountOf(w, ch);
  const cost = storageExpandCost(acc, w.content);
  if (cost === null) return 'err.storageMax';
  if (ch.gold < cost) return 'err.gold';
  ch.gold -= cost;
  acc.storage.capacity = Math.min(w.content.storage.max, acc.storage.capacity + w.content.storage.step);
  return null;
}
