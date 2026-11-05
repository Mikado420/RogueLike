import type { Actor, HitSpec, World } from '../state';

/**
 * 装備の固有効果（レジェンド・ミシック）が割り込む場所。
 * M3 で中身を実装する。
 */
export function procOnHit(_w: World, _src: Actor, _tgt: Actor, _spec: HitSpec, _amount: number, _crit: boolean) {
  // 実装は M3
}
