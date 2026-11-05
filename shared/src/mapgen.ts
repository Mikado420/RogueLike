import { Rng } from './rng';
import type { GameMap } from './map';

/**
 * マップの自動生成（シード固定なので、サーバーでもクライアントでも同じ地形になる）。
 * フィールド・ダンジョン・塔の階で使う。
 */

export interface Palette {
  ground: string[];
  path: string;
  border: { tile: string; sprite: string };
  liquid: { tile: string; solid: boolean };
  obstacles: { tile: string; sprite: string; w: number }[];
  density: number;
  ponds: [number, number, number];
}

export interface FieldGenDef {
  seed: number;
  width: number;
  height: number;
  palette: string;
}

export type Edge = 'north' | 'south' | 'east' | 'west';

export interface GenExit { edge: Edge; to: string; spawn: string }

export interface GeneratedField {
  map: GameMap;
  /** 出口の範囲（タイル座標）と行き先 */
  exits: { rect: [number, number, number, number]; to: string; spawn: string }[];
  /** 各辺から入ったときの出現位置 */
  spawnPoints: Record<string, { x: number; y: number }>;
  /** 開けた場所（ボス・入口・採集ポイント用） */
  spots: Record<string, { x: number; y: number }>;
  walkable: (x: number, y: number) => boolean;
}

function emptyMap(id: string, w: number, h: number, tile: string): GameMap {
  return {
    id, width: w, height: h,
    tiles: Array(w * h).fill(tile), solid: Array(w * h).fill(false), sprites: Array(w * h).fill(null),
  };
}

function setTile(m: GameMap, i: number, j: number, tile: string, solid: boolean, sprite: string | null) {
  if (i < 0 || j < 0 || i >= m.width || j >= m.height) return;
  const k = j * m.width + i;
  m.tiles[k] = tile; m.solid[k] = solid; m.sprites[k] = sprite;
}

const EXIT_HALF = 2;

function edgePoint(edge: Edge, w: number, h: number): { x: number; y: number } {
  switch (edge) {
    case 'north': return { x: Math.floor(w / 2), y: 0 };
    case 'south': return { x: Math.floor(w / 2), y: h - 1 };
    case 'west': return { x: 0, y: Math.floor(h / 2) };
    case 'east': return { x: w - 1, y: Math.floor(h / 2) };
  }
}

/**
 * フィールドを作る。
 * spotsWanted: { 名前: [fx, fy, 半径] } … 開けておく場所（ボスの広場・ダンジョン入口など）
 */
export function generateField(id: string, def: FieldGenDef, pal: Palette, exits: GenExit[], spotsWanted: Record<string, [number, number, number]>): GeneratedField {
  const rng = new Rng(def.seed);
  const W = def.width, H = def.height;
  const m = emptyMap(id, W, H, pal.ground[0]);
  const reserved = new Uint8Array(W * H);
  const res = (i: number, j: number) => i >= 0 && j >= 0 && i < W && j < H && reserved[j * W + i] === 1;
  const reserve = (i: number, j: number) => { if (i >= 0 && j >= 0 && i < W && j < H) reserved[j * W + i] = 1; };

  // 地面のまだら模様
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const n = Math.sin(i * 0.31 + def.seed) + Math.cos(j * 0.27 + def.seed * 0.7) + Math.sin((i + j) * 0.13);
    setTile(m, i, j, pal.ground[n > 0.6 && pal.ground[1] ? 1 : 0], false, null);
  }

  // 出口と道
  const center = { x: Math.floor(W / 2), y: Math.floor(H / 2) };
  const exitRects: GeneratedField['exits'] = [];
  const spawnPoints: GeneratedField['spawnPoints'] = {};
  const carvePath = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    let x = a.x, y = a.y;
    let guard = 0;
    while ((x !== b.x || y !== b.y) && guard++ < W * H) {
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        setTile(m, x + di, y + dj, pal.path, false, null);
        reserve(x + di, y + dj);
      }
      const dx = Math.sign(b.x - x), dy = Math.sign(b.y - y);
      if (dx !== 0 && (dy === 0 || rng.next() < 0.5)) x += dx; else if (dy !== 0) y += dy;
      if (rng.next() < 0.15) { const side = rng.int(-1, 1); if (dx !== 0) y = Math.max(2, Math.min(H - 3, y + side)); else x = Math.max(2, Math.min(W - 3, x + side)); }
    }
  };
  for (const ex of exits) {
    const p = edgePoint(ex.edge, W, H);
    const inner = { x: Math.min(W - 3, Math.max(2, p.x)), y: Math.min(H - 3, Math.max(2, p.y)) };
    carvePath(inner, center);
    let rect: [number, number, number, number];
    let sp: { x: number; y: number };
    if (ex.edge === 'north' || ex.edge === 'south') {
      rect = [p.x - EXIT_HALF, ex.edge === 'north' ? 0 : H - 1, p.x + EXIT_HALF + 1, ex.edge === 'north' ? 1 : H];
      sp = { x: p.x + 0.5, y: ex.edge === 'north' ? 3.5 : H - 3.5 };
    } else {
      rect = [ex.edge === 'west' ? 0 : W - 1, p.y - EXIT_HALF, ex.edge === 'west' ? 1 : W, p.y + EXIT_HALF + 1];
      sp = { x: ex.edge === 'west' ? 3.5 : W - 3.5, y: p.y + 0.5 };
    }
    exitRects.push({ rect, to: ex.to, spawn: ex.spawn });
    spawnPoints[ex.edge] = sp;
    for (let j = rect[1] - 3; j < rect[3] + 3; j++) for (let i = rect[0] - 3; i < rect[2] + 3; i++) reserve(i, j);
  }

  // 開けておく場所
  const spots: GeneratedField['spots'] = {};
  for (const [name, [fx, fy, r]] of Object.entries(spotsWanted)) {
    const cx = Math.floor(fx * W), cy = Math.floor(fy * H);
    spots[name] = { x: cx + 0.5, y: cy + 0.5 };
    for (let j = cy - r; j <= cy + r; j++) for (let i = cx - r; i <= cx + r; i++) {
      if ((i - cx) ** 2 + (j - cy) ** 2 <= r * r) reserve(i, j);
    }
    carvePath({ x: cx, y: cy }, center);
  }

  // 池（溶岩・水）
  const [count, rmin, rmax] = pal.ponds;
  for (let n = 0; n < count; n++) {
    const r = rng.int(rmin, rmax);
    const cx = rng.int(r + 3, W - r - 4), cy = rng.int(r + 3, H - r - 4);
    for (let j = cy - r; j <= cy + r; j++) for (let i = cx - r; i <= cx + r; i++) {
      const d = ((i - cx) / r) ** 2 + ((j - cy) / (r * 0.8)) ** 2;
      if (d <= 1 + rng.range(-0.15, 0.15) && !res(i, j)) setTile(m, i, j, pal.liquid.tile, pal.liquid.solid, null);
    }
  }

  // 障害物（木・岩など）
  const weights: Record<string, number> = {};
  pal.obstacles.forEach((o, i) => { weights[String(i)] = o.w; });
  for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
    if (res(i, j) || m.solid[j * W + i]) continue;
    const clump = 0.5 + 0.5 * Math.sin(i * 0.37 + def.seed) * Math.cos(j * 0.29 - def.seed);
    if (rng.next() < pal.density * (0.4 + clump * 1.4)) {
      const o = pal.obstacles[Number(rng.weighted(weights))];
      setTile(m, i, j, o.tile, true, o.sprite);
    }
  }

  // 外周
  for (let i = 0; i < W; i++) for (const j of [0, H - 1]) if (!inExit(exitRects, i, j)) setTile(m, i, j, pal.border.tile, true, pal.border.sprite);
  for (let j = 0; j < H; j++) for (const i of [0, W - 1]) if (!inExit(exitRects, i, j)) setTile(m, i, j, pal.border.tile, true, pal.border.sprite);

  const walkable = (x: number, y: number) => {
    const i = Math.floor(x), j = Math.floor(y);
    return i > 0 && j > 0 && i < W - 1 && j < H - 1 && !m.solid[j * W + i];
  };
  return { map: m, exits: exitRects, spawnPoints, spots, walkable };
}

function inExit(exits: GeneratedField['exits'], i: number, j: number): boolean {
  return exits.some((e) => i >= e.rect[0] && i < e.rect[2] && j >= e.rect[1] && j < e.rect[3]);
}

/** 歩けるタイルが start からつながっているか（テスト用） */
export function reachable(m: GameMap, sx: number, sy: number): Uint8Array {
  const seen = new Uint8Array(m.width * m.height);
  const q: number[] = [Math.floor(sy) * m.width + Math.floor(sx)];
  seen[q[0]] = 1;
  while (q.length) {
    const k = q.pop()!;
    const i = k % m.width, j = (k - i) / m.width;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= m.width || nj >= m.height) continue;
      const nk = nj * m.width + ni;
      if (seen[nk] || m.solid[nk]) continue;
      seen[nk] = 1;
      q.push(nk);
    }
  }
  return seen;
}
