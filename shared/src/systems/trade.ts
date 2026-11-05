import type { CharacterData, Item, MailItem, Player, World } from '../state';
import { addToBag } from './items';
import { LIMITS } from '../validate';

/**
 * 取引所・露店・郵便受け（エリアの中でできる分）。
 * ここでは「出す側」を手元で減らして trade イベントを出すだけ。受け取る側への受け渡しは
 * サーバー（AccountDO → MarketDO / 相手の AccountDO の郵便受け）が、同じ番号では1回だけ行う。
 */

const priceOk = (w: World, price: number) => Number.isInteger(price) && price >= w.content.market.minPrice && price <= w.content.market.maxPrice;

/** その装備を取引に出せるか */
export function canTrade(it: Item | undefined): string | null {
  if (!it) return 'err.invalid';
  if (it.locked) return 'err.locked';
  if (it.trade === 'none') return 'err.untradable';
  return null;
}

export function marketList(w: World, p: Player, uid: number, price: number): string | null {
  if (!w.online) return 'err.onlineOnly';
  if (!priceOk(w, price)) return 'err.price';
  const i = p.char.inventory.findIndex((x) => x.uid === uid);
  const err = canTrade(p.char.inventory[i]);
  if (err) return err;
  const item = p.char.inventory.splice(i, 1)[0];
  w.events.push({ type: 'trade', playerId: p.id, op: { kind: 'list', item, price } });
  w.events.push({ type: 'charChanged', playerId: p.id });
  return null;
}

export function marketBuy(w: World, p: Player, id: string, price: number): string | null {
  if (!w.online) return 'err.onlineOnly';
  if (!priceOk(w, price)) return 'err.price';
  if (p.char.gold < price) return 'err.gold';
  p.char.gold -= price;
  w.events.push({ type: 'gold', playerId: p.id, amount: -price });
  w.events.push({ type: 'trade', playerId: p.id, op: { kind: 'buy', id: String(id), price } });
  return null;
}

export function marketCancel(w: World, p: Player, id: string): string | null {
  if (!w.online) return 'err.onlineOnly';
  w.events.push({ type: 'trade', playerId: p.id, op: { kind: 'cancel', id: String(id) } });
  return null;
}

export function claimMail(w: World, p: Player): string | null {
  if (!w.online) return 'err.onlineOnly';
  w.events.push({ type: 'trade', playerId: p.id, op: { kind: 'claim' } });
  return null;
}

/** 露店を開く（街の中だけ。並べた品は預かりになる） */
export function stallOpen(w: World, p: Player, title: string, list: { uid: number; price: number }[]): string | null {
  if (!w.online) return 'err.onlineOnly';
  if (w.area.type !== 'town') return 'err.townOnly';
  if (p.stall) return 'err.stallOpen';
  const m = w.content.market;
  const uniq = [...new Map((list ?? []).map((x) => [x.uid, x])).values()].slice(0, m.stallMax);
  if (!uniq.length) return 'err.invalid';
  for (const x of uniq) {
    if (!priceOk(w, x.price)) return 'err.price';
    const err = canTrade(p.char.inventory.find((i) => i.uid === x.uid));
    if (err) return err;
  }
  const items = uniq.map((x) => {
    const i = p.char.inventory.findIndex((it) => it.uid === x.uid);
    return { uid: x.uid, item: p.char.inventory.splice(i, 1)[0], price: x.price };
  });
  p.stall = { title: String(title ?? '').slice(0, 16), items };
  w.events.push({ type: 'trade', playerId: p.id, op: { kind: 'stallOpen', items } });
  w.events.push({ type: 'charChanged', playerId: p.id });
  return null;
}

export function stallClose(w: World, p: Player): string | null {
  if (!p.stall) return 'err.invalid';
  p.stall = null;
  w.events.push({ type: 'trade', playerId: p.id, op: { kind: 'stallClose' } });
  return null;
}

/** 同じ街にいる人の露店で買う */
export function stallBuy(w: World, p: Player, sellerId: number, uid: number, price: number): string | null {
  if (!w.online) return 'err.onlineOnly';
  const s = w.players.find((x) => x.id === sellerId);
  if (!s || s === p || !s.stall) return 'err.invalid';
  if (Math.hypot(s.x - p.x, s.y - p.y) > 6) return 'err.notNear';
  const i = s.stall.items.findIndex((x) => x.uid === uid);
  if (i < 0 || s.stall.items[i].price !== price) return 'err.invalid';
  if (p.char.gold < price) return 'err.gold';
  const it = s.stall.items.splice(i, 1)[0];
  p.char.gold -= price;
  w.events.push({ type: 'gold', playerId: p.id, amount: -price });
  w.events.push({ type: 'trade', playerId: p.id, op: { kind: 'stallBuy', seller: s.account.id, sellerPlayer: s.id, uid, price, item: it.item } });
  if (!s.stall.items.length) { s.stall = null; w.events.push({ type: 'trade', playerId: s.id, op: { kind: 'stallClose' } }); }
  return null;
}

/**
 * 郵便受けの品を受け取る（入りきらない装備は残す）。受け取れた id を返す
 */
export function receiveMail(ch: CharacterData, mail: MailItem[], inventorySize: number): string[] {
  const took: string[] = [];
  for (const m of mail) {
    if (m.item && ch.inventory.length >= inventorySize) continue;
    if (m.item) ch.inventory.push(m.item);
    if (m.gold) ch.gold = Math.min(LIMITS.gold, ch.gold + m.gold);
    if (m.bag) addToBag(ch, m.bag.id, m.bag.n);
    took.push(m.id);
  }
  return took;
}
