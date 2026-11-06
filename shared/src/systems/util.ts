import type { AccountData, Actor, CharacterData, Monster, Player, World } from '../state';

/** 秒 → tick */
export const sec = (w: World, s: number) => Math.round(s * w.content.balance.tickRate);
export const DT = (w: World) => 1 / w.content.balance.tickRate;
export const newId = (w: World) => w.nextId++;
/**
 * アイテム番号。どのワールドで作っても重ならないよう、ワールドごとの乱数で 52bit の数を作る
 * （サーバーではワールドごとにシードが違うので、取引でアカウントをまたいでも重ならない）
 */
export const newUid = (w: World) => w.uidRng.int(1, 0x3ffffff) * 0x4000000 + w.uidRng.int(0, 0x3ffffff);

/** そのキャラクターのアカウント（ワールドにいるプレイヤーから探す） */
export function accountOf(w: World, ch: CharacterData): AccountData {
  const p = w.players.find((x) => x.char === ch);
  if (!p) throw new Error('player not in world');
  return p.account;
}

export function findActor(w: World, id: number): Actor | undefined {
  return w.players.find((p) => p.id === id) ?? w.area.monsters.find((m) => m.id === id) ?? w.pets.find((m) => m.id === id);
}

export function findPlayer(w: World, id: number): Player | undefined {
  return w.players.find((p) => p.id === id);
}

export function nearestMonster(w: World, x: number, y: number, range: number, filter?: (m: Monster) => boolean): Monster | null {
  let best: Monster | null = null, bd = range;
  for (const m of w.area.monsters) {
    if (m.dead || (filter && !filter(m))) continue;
    const d = Math.hypot(m.x - x, m.y - y) - m.r;
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}

export function isBoss(w: World, a: Actor): boolean {
  return a.kind === 'monster' && !!w.content.monsters[a.defId]?.boss;
}

export function notice(w: World, playerId: number, key: string, ...args: (string | number)[]) {
  w.events.push({ type: 'notice', playerId, key, args });
}

/** フィールドの入口・出現位置のまわり（モンスターが出ず、追ってもこない） */
export function inSafeZone(w: World, x: number, y: number, extra = 0): boolean {
  const a = w.area;
  const base = a.type === 'field' ? a.safeRadius
    : a.type === 'town' && a.invasion && !a.invasion.finished ? w.content.invasion.sanctuary ?? 0 : 0;
  if (!(base > 0)) return false;
  const r = base + extra;
  if (Math.hypot(x - a.playerSpawn.x, y - a.playerSpawn.y) < r) return true;
  for (const s of Object.values(a.spawnPoints)) if (Math.hypot(x - s.x, y - s.y) < r) return true;
  return false;
}
