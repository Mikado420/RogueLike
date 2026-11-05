import type { Actor, Monster, Player, World } from '../state';

/** 秒 → tick */
export const sec = (w: World, s: number) => Math.round(s * w.content.balance.tickRate);
export const DT = (w: World) => 1 / w.content.balance.tickRate;
export const newId = (w: World) => w.nextId++;
/** アカウント全体で一意なアイテム番号 */
export const newUid = (w: World) => w.account.nextUid++;

export function findActor(w: World, id: number): Actor | undefined {
  return w.players.find((p) => p.id === id) ?? w.area.monsters.find((m) => m.id === id);
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
