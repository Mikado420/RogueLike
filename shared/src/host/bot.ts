import type { Command, Player, PlayerInput, World } from '../state';
import { Rng } from '../rng';

/**
 * 自動で歩いて戦うプレイヤー（負荷試験とテスト用）。
 * 近くに魔物がいれば近づいて殴り、たまにスキル・回避。いなければうろうろする。
 */
export class Bot {
  private rng: Rng;
  private wander = { x: 0, y: 0, until: 0 };
  /** 決まった場所へ向かう（出口など） */
  goal: { x: number; y: number } | null = null;
  constructor(seed: number) { this.rng = new Rng(seed); }

  think(w: World, p: Player): PlayerInput {
    const commands: Command[] = [];
    const input: PlayerInput = { move: { x: 0, y: 0 }, aim: null, attack: false, skill: -1, dodge: false, interact: false, commands };
    if (p.dead) return input;
    if (p.hp < p.stats.maxHp * 0.35 && (p.char.bag.potion_s ?? 0) > 0 && this.rng.chance(0.2)) commands.push({ type: 'useItem', id: 'potion_s' });
    if (this.goal) {
      const dx = this.goal.x - p.x, dy = this.goal.y - p.y, d = Math.hypot(dx, dy);
      if (d > 0.2) input.move = { x: dx / d, y: dy / d };
      return input;
    }
    let target: { x: number; y: number } | null = null;
    let best = 9;
    for (const m of w.area.monsters) {
      if (m.dead || m.hidden) continue;
      const d = Math.hypot(m.x - p.x, m.y - p.y);
      if (d < best) { best = d; target = m; }
    }
    if (target) {
      const dx = target.x - p.x, dy = target.y - p.y, d = Math.hypot(dx, dy) || 1;
      input.aim = { x: dx / d, y: dy / d };
      if (best > 1.6) input.move = { x: dx / d, y: dy / d };
      else input.attack = true;
      if (this.rng.chance(0.03)) input.skill = this.rng.int(0, 3);
      if (this.rng.chance(0.01)) input.dodge = true;
      return this.avoidExits(w, p, input);
    }
    if (w.tick >= this.wander.until) {
      const a = this.rng.range(0, Math.PI * 2);
      this.wander = { x: Math.cos(a), y: Math.sin(a), until: w.tick + this.rng.int(20, 60) };
    }
    input.move = { x: this.wander.x, y: this.wander.y };
    return this.avoidExits(w, p, input);
  }

  /** 出口に入らないように（出たいときは goal を使う） */
  private avoidExits(w: World, p: Player, input: PlayerInput): PlayerInput {
    const nx = p.x + input.move.x * 2, ny = p.y + input.move.y * 2;
    const near = w.area.exits.some((e) => nx >= e.rect[0] - 1 && nx < e.rect[2] + 1 && ny >= e.rect[1] - 1 && ny < e.rect[3] + 1);
    if (!near) return input;
    const cx = w.area.map.width / 2 - p.x, cy = w.area.map.height / 2 - p.y, d = Math.hypot(cx, cy) || 1;
    input.move = { x: cx / d, y: cy / d };
    this.wander = { x: cx / d, y: cy / d, until: w.tick + 40 };
    return input;
  }
}
