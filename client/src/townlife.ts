import { Container, Graphics } from 'pixi.js';
import type { GameMap } from '../../shared/src';
import { depth, toScreen, toScreenH } from './iso';
import { makePlayerSprite } from './sprites';
import { BODY_COLORS, HAIR_COLORS } from './colors';

/**
 * 街のにぎわい（見た目だけ。サーバーとは関係なく、話しかけることもできない）。
 * - NPC が呼吸するように揺れ、近くの人の方を向く
 * - 煙突から煙
 * - 道や広場を歩く通行人
 */

/** 人の形をした NPC（看板・転送陣・泉・門などは動かさない） */
const PEOPLE = new Set(['npc_merchant', 'npc_smith', 'npc_keeper', 'npc_priest', 'npc_cook']);
const WALK_TILES = new Set(['road', 'plaza']);

interface Walker { root: Container; body: Container; x: number; y: number; path: { x: number; y: number }[]; wait: number; speed: number; phase: number }

export class TownLife {
  private smoke = new Graphics();
  private walkers: Walker[] = [];
  private walkable: { i: number; j: number }[] = [];
  private time = 0;

  constructor(private layer: Container, private map: GameMap, private chimneys: { x: number; y: number }[], town: boolean) {
    this.smoke.zIndex = 1e6 - 1;
    layer.addChild(this.smoke);
    if (!town) return;
    for (let j = 0; j < map.height; j++) for (let i = 0; i < map.width; i++) {
      const k = j * map.width + i;
      if (!map.solid[k] && WALK_TILES.has(map.tiles[k])) this.walkable.push({ i, j });
    }
    if (this.walkable.length < 20) return;
    const n = Math.min(7, Math.floor(this.walkable.length / 60) + 3);
    for (let k = 0; k < n; k++) this.addWalker(k);
  }

  private pick(): { i: number; j: number } { return this.walkable[Math.floor(Math.random() * this.walkable.length)]; }

  private addWalker(k: number) {
    const t = this.pick();
    const body = makePlayerSprite(BODY_COLORS[(k * 3 + 1) % BODY_COLORS.length], HAIR_COLORS[(k * 5 + 2) % HAIR_COLORS.length]);
    const root = new Container();
    root.addChild(body);
    this.layer.addChild(root);
    this.walkers.push({ root, body, x: t.i + 0.5, y: t.j + 0.5, path: [], wait: Math.random() * 3, speed: 1.1 + Math.random() * 0.6, phase: Math.random() * 10 });
  }

  /** 歩ける道の上で、マスをたどる道順（幅優先） */
  private route(from: { i: number; j: number }, to: { i: number; j: number }): { x: number; y: number }[] {
    const m = this.map;
    const ok = (i: number, j: number) => i >= 0 && j >= 0 && i < m.width && j < m.height && !m.solid[j * m.width + i] && WALK_TILES.has(m.tiles[j * m.width + i]);
    const prev = new Map<number, number>();
    const key = (i: number, j: number) => j * m.width + i;
    const q = [from];
    prev.set(key(from.i, from.j), -1);
    while (q.length) {
      const c = q.shift()!;
      if (c.i === to.i && c.j === to.j) break;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = c.i + di, nj = c.j + dj;
        if (!ok(ni, nj) || prev.has(key(ni, nj))) continue;
        prev.set(key(ni, nj), key(c.i, c.j));
        q.push({ i: ni, j: nj });
      }
    }
    if (!prev.has(key(to.i, to.j))) return [];
    const out: { x: number; y: number }[] = [];
    for (let k = key(to.i, to.j); k !== -1; k = prev.get(k)!) out.push({ x: (k % m.width) + 0.5, y: Math.floor(k / m.width) + 0.5 });
    return out.reverse();
  }

  update(dt: number, npcs: Map<number, Container>, npcPos: Map<number, { x: number; y: number; sprite: string }>, me: { x: number; y: number } | null) {
    this.time += dt;
    // NPC：呼吸と、近くの人の方を向く
    for (const [id, root] of npcs) {
      const info = npcPos.get(id);
      const body = root.children[0] as Container | undefined;
      if (!info || !body || !PEOPLE.has(info.sprite)) continue;
      body.scale.y = 1 + Math.sin(this.time * 2.2 + id) * 0.025;
      if (me && Math.hypot(me.x - info.x, me.y - info.y) < 5) {
        const dx = toScreen(me.x, me.y).x - toScreen(info.x, info.y).x;
        if (Math.abs(dx) > 6) body.scale.x = dx < 0 ? -1 : 1;
      }
    }
    // 煙
    const g = this.smoke;
    g.clear();
    for (const [n, c] of this.chimneys.entries()) {
      for (let k = 0; k < 4; k++) {
        const t = ((this.time * 0.35 + k / 4 + n * 0.13) % 1);
        g.circle(c.x + t * 14 + Math.sin(this.time + k) * 2, c.y - t * 46, 3.5 + t * 7).fill({ color: 0xe8e4e0, alpha: 0.34 * (1 - t) });
      }
    }
    // 通行人
    for (const w of this.walkers) {
      if (w.wait > 0) {
        w.wait -= dt;
        if (w.wait <= 0 && !w.path.length) {
          const path = this.route({ i: Math.floor(w.x), j: Math.floor(w.y) }, this.pick());
          w.path = path.slice(1, 40);
        }
      } else if (w.path.length) {
        const t = w.path[0];
        const dx = t.x - w.x, dy = t.y - w.y, d = Math.hypot(dx, dy);
        const step = w.speed * dt;
        if (d <= step) { w.x = t.x; w.y = t.y; w.path.shift(); if (!w.path.length) w.wait = 2 + Math.random() * 5; }
        else { w.x += (dx / d) * step; w.y += (dy / d) * step; }
        const sx = toScreen(dx, dy).x;
        if (Math.abs(sx) > 0.01) w.body.scale.x = sx < 0 ? -1 : 1;
        w.body.y = -Math.abs(Math.sin(this.time * 9 + w.phase)) * 2;
      } else w.wait = 1 + Math.random() * 3;
      const s = toScreenH(w.x, w.y);
      w.root.x = s.x; w.root.y = s.y;
      w.root.zIndex = depth(w.x, w.y);
    }
  }
}
