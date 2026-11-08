import type { AccountData, Actor, CharacterData, Monster, Player, World } from '../state';

/** 秒 → tick */
export const sec = (w: World, s: number) => Math.round(s * w.content.balance.tickRate);
export const DT = (w: World) => 1 / w.content.balance.tickRate;
export const newId = (w: World) => w.nextId++;

/**
 * 見下ろしアイソメでの移動の速さの補正。タイルは横長（縦は横の半分）に描くので、
 * ワールドで同じ速さだと画面では上下が左右の半分の速さに見える。
 * 画面の上でどの向きにも同じ速さで動くよう、向きごとに倍率をかける（左右 ×0.71、上下 ×1.41。平均はほぼ 1）。
 * data/balance.json の player.isoMoveAspect（タイルの縦÷横）で決める。0 か未設定なら補正しない
 */
export function isoSpeedMul(dx: number, dy: number, c: { balance: { player: { isoMoveAspect?: number } } }): number {
  const a = c.balance.player.isoMoveAspect ?? 0;
  if (!(a > 0)) return 1;
  const l = Math.hypot(dx, dy);
  if (l < 1e-6) return 1;
  const ux = dx / l, uy = dy / l;
  const screen = Math.hypot(ux - uy, a * (ux + uy));
  return Math.sqrt(2 * a) / screen;
}
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
  const base = a.type === 'field' ? a.safeRadius : 0;
  if (!(base > 0)) return false;
  const r = base + extra;
  if (Math.hypot(x - a.playerSpawn.x, y - a.playerSpawn.y) < r) return true;
  for (const s of Object.values(a.spawnPoints)) if (Math.hypot(x - s.x, y - s.y) < r) return true;
  return false;
}
