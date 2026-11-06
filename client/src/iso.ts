/** アイソメ投影。ワールド1単位 = タイル1枚。 */
export const TILE_W = 64;
export const TILE_H = 32;
const HW = TILE_W / 2, HH = TILE_H / 2;

export function toScreen(x: number, y: number): { x: number; y: number } {
  return { x: (x - y) * HW, y: (x + y) * HH };
}

export function toWorld(sx: number, sy: number): { x: number; y: number } {
  const a = sx / HW, b = sy / HH;
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/** 画面上の向き（右が+x、下が+y）をワールドの向きに直す */
export function screenDirToWorld(dx: number, dy: number): { x: number; y: number } {
  const wx = dx / HW + dy / HH, wy = dy / HH - dx / HW;
  const l = Math.hypot(wx, wy);
  if (l < 1e-6) return { x: 0, y: 0 };
  const m = Math.min(1, Math.hypot(dx, dy));
  return { x: (wx / l) * m, y: (wy / l) * m };
}

/** ワールドの半径 r の円が画面上で作る楕円の半径 */
export function isoRadii(r: number): { rx: number; ry: number } {
  return { rx: r * HW * Math.SQRT2, ry: r * HH * Math.SQRT2 };
}

/** 奥行き（大きいほど手前） */
export const depth = (x: number, y: number) => x + y;

/** 今のエリアの地形の高さ（ピクセル）。マップの角ごとの高さから補間する */
let heightFn: (x: number, y: number) => number = () => 0;
export function setTerrain(heights: number[] | undefined, w: number, h: number) {
  if (!heights) { heightFn = () => 0; return; }
  const VW = w + 1;
  heightFn = (x, y) => {
    const cx = Math.max(0, Math.min(w, x)), cy = Math.max(0, Math.min(h, y));
    const i = Math.min(w - 1, Math.floor(cx)), j = Math.min(h - 1, Math.floor(cy));
    const u = cx - i, v = cy - j;
    const a = heights[j * VW + i], b = heights[j * VW + i + 1], c = heights[(j + 1) * VW + i], d = heights[(j + 1) * VW + i + 1];
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  };
}
export const terrainHeight = (x: number, y: number) => heightFn(x, y);
/** 地形の高さのぶん持ち上げた画面座標（立っているもの・浮かぶ文字に使う） */
export function toScreenH(x: number, y: number): { x: number; y: number } {
  const s = toScreen(x, y);
  s.y -= heightFn(x, y);
  return s;
}
