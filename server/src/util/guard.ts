import type { Player, World } from '../../../shared/src';

export interface Suspicion { kind: string; detail?: unknown }

/** 一定時間あたりの回数の上限 */
export class RateWindow {
  private start = 0;
  private count = 0;
  constructor(private windowMs: number, private max: number) {}
  hit(now: number, n = 1): boolean {
    if (now - this.start >= this.windowMs) { this.start = now; this.count = 0; }
    this.count += n;
    return this.count <= this.max;
  }
}

/**
 * 1tick の移動がありえる距離か（位置はサーバーが計算するので、ずれたらサーバー側の不具合か、ワープの不正）
 */
export function checkMovement(w: World, p: Player, before: { x: number; y: number }): Suspicion | null {
  const d = Math.hypot(p.x - before.x, p.y - before.y);
  const maxSpeed = Math.max(w.content.balance.stats.moveSpeedMax, w.content.balance.player.dodgeSpeed) * 1.6;
  const limit = maxSpeed / w.content.balance.tickRate + 0.5;
  // 復活・エリア内の移動（出口や転送）は除く
  if (d > limit && d < 6 && !p.dead) return { kind: 'speed', detail: { d: Math.round(d * 100) / 100, limit } };
  return null;
}
