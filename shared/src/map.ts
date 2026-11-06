import { shapeTerrain, TERRAIN } from './terrain';

/**
 * 建物（何マスかを占める 1 軒）。床は通れない。扉は南（s：j が大きい側）か東（e：i が大きい側）の、画面で見える面に付く。
 * at は扉の位置（南なら x からのずれ、東なら y からのずれ）。
 */
export interface BuildingDef {
  x: number; y: number; w: number; h: number;
  kind: string;
  door?: { side: 's' | 'e'; at: number };
  roof?: string; wall?: string;
  /** 店の看板（smith・shop・cook・storage・chapel・guild・inn など） */
  sign?: string;
  /** 壁の高さ（ピクセル、既定 34） */
  height?: number;
  chimney?: boolean;
  /** 扉の上の日よけ（色） */
  awning?: string;
}

export interface MapDef { legend: Record<string, { tile: string; solid: boolean; sprite?: string }>; rows: string[]; buildings?: BuildingDef[]; terrain?: string }

/** タイルマップ。タイル (i, j) はワールド座標 [i, i+1) × [j, j+1) を占める。 */
export interface GameMap {
  id: string;
  width: number;
  height: number;
  /** 行優先。tiles[j * width + i] */
  tiles: string[];
  solid: boolean[];
  sprites: (string | null)[];
  buildings?: BuildingDef[];
  /** 地形の高さ（ピクセル）。マスの角ごと（(width+1)×(height+1)）。見た目だけで、歩くのには関係しない */
  heights?: number[];
}

export function buildMap(id: string, def: MapDef): GameMap {
  const height = def.rows.length;
  const width = Math.max(...def.rows.map((r) => r.length));
  const tiles: string[] = [];
  const solid: boolean[] = [];
  const sprites: (string | null)[] = [];
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const ch = def.rows[j][i] ?? '#';
      const lg = def.legend[ch] ?? { tile: 'wall', solid: true, sprite: 'wall' };
      tiles.push(lg.tile);
      solid.push(lg.solid);
      sprites.push(lg.sprite ?? null);
    }
  }
  const buildings = def.buildings ?? [];
  for (const b of buildings) {
    for (let j = b.y; j < b.y + b.h; j++) for (let i = b.x; i < b.x + b.w; i++) {
      if (i < 0 || j < 0 || i >= width || j >= height) continue;
      solid[j * width + i] = true;
      sprites[j * width + i] = null;
    }
  }
  const m: GameMap = { id, width, height, tiles, solid, sprites, buildings };
  const prof = def.terrain ? TERRAIN[def.terrain] : undefined;
  if (prof) { let seed = 7; for (const ch of id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0; shapeTerrain(m, seed, prof); }
  return m;
}

export function isSolid(m: GameMap, i: number, j: number): boolean {
  if (i < 0 || j < 0 || i >= m.width || j >= m.height) return true;
  return m.solid[j * m.width + i];
}

/** 円 (x, y, r) が固いタイルに重なるか */
export function circleHitsMap(m: GameMap, x: number, y: number, r: number): boolean {
  const i0 = Math.floor(x - r), i1 = Math.floor(x + r);
  const j0 = Math.floor(y - r), j1 = Math.floor(y + r);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      if (!isSolid(m, i, j)) continue;
      const nx = Math.max(i, Math.min(x, i + 1));
      const ny = Math.max(j, Math.min(y, j + 1));
      const dx = x - nx, dy = y - ny;
      if (dx * dx + dy * dy < r * r) return true;
    }
  }
  return false;
}

/** 軸ごとに動かして、壁に沿って滑るように移動する。動けたら true。 */
export function moveCircle(m: GameMap, p: { x: number; y: number }, r: number, dx: number, dy: number): boolean {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.2));
  const sx = dx / steps, sy = dy / steps;
  let moved = false;
  for (let s = 0; s < steps; s++) {
    if (sx !== 0 && !circleHitsMap(m, p.x + sx, p.y, r)) { p.x += sx; moved = true; }
    if (sy !== 0 && !circleHitsMap(m, p.x, p.y + sy, r)) { p.y += sy; moved = true; }
  }
  return moved;
}

/** 直線上に壁がないか（粗いサンプリング） */
export function lineOfSight(m: GameMap, x0: number, y0: number, x1: number, y1: number): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.ceil(d / 0.25);
  for (let s = 1; s < n; s++) {
    const t = s / n;
    const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
    const i = Math.floor(x), j = Math.floor(y);
    if (isSolid(m, i, j) && m.sprites[j * m.width + i] !== null) return false;
  }
  return true;
}
