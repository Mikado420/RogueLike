import { EQUIP_SLOTS, type EquipSlot, type WeaponType } from '../core';
import type { CharacterData, Item, Player, World } from '../state';
import { heal } from './combat';
import { sellPrice } from './loot';
import { nearRole } from './interact';
import { notice } from './util';

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
        if (p.char.inventory.length >= max) { if (w.tick % 40 === 0) notice(w, p.id, 'err.full'); continue; }
        p.char.inventory.push(d.item);
      } else if (d.bag) {
        addToBag(p.char, d.bag.id, d.bag.n);
      }
      w.events.push({ type: 'pickup', playerId: p.id, item: d.item, bag: d.bag });
      return false;
    }
    return true;
  });
}
