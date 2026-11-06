import { Rng } from './rng';
import type { GameMap } from './map';

/**
 * 地形の高低差（見た目だけ。歩くのには関係しない）。マスの角ごとの高さ（ピクセル）を作る。
 * マップの性格（丘・山脈・火口・洞窟・すり鉢）は TerrainProfile で決める。
 */
export interface TerrainProfile {
  /** 丘の数（1000 マスあたり）・高さ・広がり（マス） */
  hills: number; amp: [number, number]; radius: [number, number];
  /** 外周（または壁ぎわ）のせり上がり（ピクセル）と幅（マス） */
  rim: number; rimWidth: number;
  /** 細かい起伏（ピクセル） */
  ripple: number;
  /** 壁（通れないマス）からの距離でせり上がる（洞窟・闘技場） */
  rimFromWalls?: boolean;
  /** 低く平らにしておくタイル（水・溶岩・道・広場など）と、そこからなじませる幅（マス） */
  pin?: string[]; pinFade?: number;
  /** 高さを付けるのはこのタイルだけ（街の草地など）。ほかは 0 */
  only?: string[];
}

export const TERRAIN: Record<string, TerrainProfile> = {
  meadow: { hills: 4, amp: [18, 46], radius: [4, 9], rim: 46, rimWidth: 5, ripple: 4 },
  marsh: { hills: 3, amp: [8, 20], radius: [2, 4], rim: 30, rimWidth: 4, ripple: 2 },
  volcano: { hills: 3.5, amp: [30, 70], radius: [4, 8], rim: 110, rimWidth: 9, ripple: 6 },
  forest: { hills: 6, amp: [20, 48], radius: [3, 7], rim: 60, rimWidth: 6, ripple: 6 },
  snow: { hills: 4, amp: [40, 95], radius: [4, 9], rim: 90, rimWidth: 8, ripple: 5 },
  town: { hills: 3, amp: [6, 16], radius: [3, 6], rim: 34, rimWidth: 5, ripple: 2, only: ['town_grass', 'grass', 'grass2'], pinFade: 3 },
  dungeon: { hills: 3, amp: [6, 16], radius: [2, 4], rim: 18, rimWidth: 3, ripple: 3, rimFromWalls: true },
  arena: { hills: 0, amp: [0, 0], radius: [1, 1], rim: 26, rimWidth: 4, ripple: 2, rimFromWalls: true },
};

const smooth = (t: number) => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u); };

export function shapeTerrain(m: GameMap, seed: number, p: TerrainProfile, liquid?: string): void {
  const W = m.width, H = m.height, VW = W + 1, VH = H + 1;
  const rng = new Rng((seed ^ 0x2f6b9d1) >>> 0);
  const h = new Array<number>(VW * VH).fill(0);

  // 角からの距離（外周・壁・平らにするタイル）を幅優先で数える
  const distFrom = (isSrc: (x: number, y: number) => boolean) => {
    const d = new Array<number>(VW * VH).fill(1e9);
    const q: number[] = [];
    for (let y = 0; y < VH; y++) for (let x = 0; x < VW; x++) if (isSrc(x, y)) { d[y * VW + x] = 0; q.push(y * VW + x); }
    for (let k = 0; k < q.length; k++) {
      const c = q[k], x = c % VW, y = (c - x) / VW;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= VW || ny >= VH) continue;
        const n = ny * VW + nx;
        if (d[n] > d[c] + 1) { d[n] = d[c] + 1; q.push(n); }
      }
    }
    return d;
  };
  // 角のまわり 4 マスのどれかが条件に合うか
  const cornerTouches = (x: number, y: number, f: (t: number) => boolean) => {
    for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      const i = x + dx, j = y + dy;
      if (i < 0 || j < 0 || i >= W || j >= H) continue;
      if (f(j * W + i)) return true;
    }
    return false;
  };

  // 外周・壁ぎわのせり上がり（山脈・洞窟の壁・闘技場の縁）
  if (p.rim > 0) {
    const d = p.rimFromWalls
      ? distFrom((x, y) => cornerTouches(x, y, (k) => m.solid[k] && !m.sprites[k]?.startsWith('pillar')) || x === 0 || y === 0 || x === W || y === H)
      : distFrom((x, y) => x === 0 || y === 0 || x === W || y === H);
    for (let k = 0; k < h.length; k++) h[k] += p.rim * smooth(1 - d[k] / p.rimWidth) * (0.75 + 0.25 * Math.sin(k * 0.37 + seed));
  }
  // 丘
  const n = Math.round((W * H * p.hills) / 1000);
  for (let c = 0; c < n; c++) {
    const cx = rng.range(2, W - 2), cy = rng.range(2, H - 2), r = rng.range(p.radius[0], p.radius[1]), a = rng.range(p.amp[0], p.amp[1]);
    const R = Math.ceil(r * 2.2);
    for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(H, Math.ceil(cy + R)); y++) {
      for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(W, Math.ceil(cx + R)); x++) {
        h[y * VW + x] += a * Math.exp(-(((x - cx) ** 2 + (y - cy) ** 2) / (r * r)));
      }
    }
  }
  // 細かい起伏
  if (p.ripple > 0) for (let y = 0; y < VH; y++) for (let x = 0; x < VW; x++) {
    h[y * VW + x] += p.ripple * (Math.sin(x * 0.9 + seed) * Math.cos(y * 0.8 - seed * 0.3) + 0.5 * Math.sin((x + y) * 1.7));
  }
  // 平らにする場所（水・溶岩・道など）からなじませる
  const pins = new Set([...(p.pin ?? []), ...(liquid ? [liquid] : [])]);
  const flat = (k: number) => pins.has(m.tiles[k]) || (!!p.only && !p.only.includes(m.tiles[k]));
  if (pins.size || p.only) {
    const d = distFrom((x, y) => cornerTouches(x, y, flat));
    const fade = p.pinFade ?? 6;
    for (let k = 0; k < h.length; k++) h[k] *= smooth(d[k] / fade);
  }
  // 建物の床は平らに
  for (const b of m.buildings ?? []) {
    for (let y = b.y - 1; y <= b.y + b.h + 1; y++) for (let x = b.x - 1; x <= b.x + b.w + 1; x++) if (x >= 0 && y >= 0 && x < VW && y < VH) h[y * VW + x] = 0;
  }
  // なじませる
  let cur = h;
  for (let pass = 0; pass < 2; pass++) {
    const nx = cur.slice();
    for (let y = 1; y < VH - 1; y++) for (let x = 1; x < VW - 1; x++) {
      const k = y * VW + x;
      if (cur[k] === 0 && (pins.size || p.only)) continue;
      nx[k] = (cur[k] * 2 + cur[k - 1] + cur[k + 1] + cur[k - VW] + cur[k + VW]) / 6;
    }
    cur = nx;
  }
  m.heights = cur.map((v) => Math.max(0, Math.round(v)));
}
