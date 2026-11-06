import { Container, Graphics } from 'pixi.js';
import type { BuildingDef } from '../../shared/src';
import { toScreen } from './iso';

/**
 * 建物を描く。重なり順を正しくするため 1 マスずつの部品に分けるが、
 * 屋根は建物全体で 1 つの寄棟屋根（高さが連続する）にして、1 軒の建物に見せる。
 * 壁・窓・扉・看板は、画面で見える南（j が大きい側）と東（i が大きい側）の面にだけ描く。
 */

const hex = (s: string | undefined, d: number) => (s ? parseInt(s.slice(1), 16) : d);

/** 色を明るく（k>1）・暗く（k<1）する */
export function shade(c: number, k: number): number {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 255) * k)));
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 255) * k)));
  const b = Math.min(255, Math.max(0, Math.round((c & 255) * k)));
  return (r << 16) | (g << 8) | b;
}

const OVER = 0.24;   // 屋根のひさし（マス）
const SLOPE = 30;    // 屋根の傾き（ピクセル / マス）
const SUB = 4;       // 屋根を描くときの 1 マスの分割数

export interface BuildingPiece { root: Container; smoke?: { x: number; y: number } }

export function buildingTile(b: BuildingDef, i: number, j: number): BuildingPiece {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const o = toScreen(i + 0.5, j + 0.5);
  const P = (x: number, y: number, z: number) => { const s = toScreen(x, y); return [s.x - o.x, s.y - o.y - z]; };
  const wallH = b.height ?? 44;
  const wall = hex(b.wall, 0xe8dcc0);
  const roof = hex(b.roof, 0x4a6a9a);
  const x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
  const south = j === y1 - 1, east = i === x1 - 1;
  const timber = b.kind === 'storage' || b.kind === 'inn' || b.kind === 'smith';

  // ───── 壁（南・東の面） ─────
  const door = b.door;
  const doorHere = (side: 's' | 'e') => !!door && door.side === side && (side === 's' ? i === x0 + door.at && south : j === y0 + door.at && east);
  const wallFace = (side: 's' | 'e') => {
    const k = side === 's' ? 0.97 : 0.8;
    const a = side === 's' ? [i, y1] : [x1, j];
    const c = side === 's' ? [i + 1, y1] : [x1, j + 1];
    const quad = (z0: number, z1: number, col: number, alpha = 1) => {
      g.poly([...P(a[0], a[1], z0), ...P(c[0], c[1], z0), ...P(c[0], c[1], z1), ...P(a[0], a[1], z1)]).fill({ color: col, alpha });
    };
    quad(0, wallH, shade(wall, k));
    quad(0, 6, shade(0x7a7468, k));                       // 石の土台
    if (timber) {                                         // 木組み
      g.poly([...P(a[0], a[1], 0), ...P(a[0], a[1], wallH)]).stroke({ width: 3, color: shade(0x5a3a22, k) });
      quad(wallH - 4, wallH, shade(0x5a3a22, k));
    }
    // 面の中の位置（0〜1）→ 画面の点
    const at = (t: number, z: number) => P(a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, z);
    const rect = (t0: number, t1: number, z0: number, z1: number, col: number) =>
      g.poly([...at(t0, z0), ...at(t1, z0), ...at(t1, z1), ...at(t0, z1)]).fill(col);
    if (doorHere(side)) {
      rect(0.22, 0.78, 6, 27, shade(0x3a2616, k));        // 枠
      rect(0.28, 0.72, 6, 24, shade(0x7a4a2a, k));        // 扉
      g.circle(...(at(0.64, 15) as [number, number]), 1.4).fill(0xe8c86a);
      if (b.awning) {                                     // 日よけ（しま模様）
        const aw = hex(b.awning, 0xd8574a);
        const out = side === 's' ? [0, 0.42] : [0.42, 0];
        // 壁ぞいの点と、そこから外へ張り出した点
        const outer = (t: number) => P(a[0] + (c[0] - a[0]) * t + out[0], a[1] + (c[1] - a[1]) * t + out[1], wallH - 16);
        for (let s = 0; s < 4; s++) {
          const t0 = -0.1 + s * 0.3, t1 = t0 + 0.3;
          g.poly([...at(t0, wallH - 6), ...at(t1, wallH - 6), ...outer(t1), ...outer(t0)]).fill(s % 2 ? 0xf4ece0 : aw);
        }
      }
    } else {
      // 窓（格子つき）
      rect(0.3, 0.7, 13, 27, shade(0x4a3a2a, k));
      rect(0.34, 0.66, 15, 25, shade(0x8fb8d8, k));
      g.poly([...at(0.5, 15), ...at(0.5, 25)]).stroke({ width: 1.2, color: shade(0x4a3a2a, k) });
      g.poly([...at(0.34, 20), ...at(0.66, 20)]).stroke({ width: 1.2, color: shade(0x4a3a2a, k) });
      if (side === 's' && (i + j) % 3 === 0) rect(0.3, 0.7, 11, 13, 0x6a9a4a);   // 植木鉢
    }
    return at;
  };
  if (south) wallFace('s');
  if (east) wallFace('e');

  // ───── 屋根（寄棟。建物全体で高さが連続する） ─────
  const ex0 = x0 - OVER, ey0 = y0 - OVER, ex1 = x1 + OVER, ey1 = y1 + OVER;
  const eave = wallH - 5;
  const zAt = (x: number, y: number) => eave + SLOPE * Math.min(x - ex0, ex1 - x, y - ey0, ey1 - y);
  const rx0 = i === x0 ? ex0 : i, rx1 = i === x1 - 1 ? ex1 : i + 1;
  const ry0 = j === y0 ? ey0 : j, ry1 = j === y1 - 1 ? ey1 : j + 1;
  const tri = (a: number[], c: number[], d: number[]) => {
    // 面の向きで明るさを変える（南向き＝左下が明るく、東向き＝右下がやや暗い）
    const za = zAt(a[0], a[1]), zc = zAt(c[0], c[1]), zd = zAt(d[0], d[1]);
    const ux = c[0] - a[0], uy = c[1] - a[1], uz = zc - za, vx = d[0] - a[0], vy = d[1] - a[1], vz = zd - za;
    // 面の傾き（どちらへ下っているか）。光は左上から：西と南の面は明るく、東と北の面は暗く
    const det = ux * vy - uy * vx;
    const gx = det ? (uz * vy - vz * uy) / det : 0, gy = det ? (ux * vz - vx * uz) / det : 0;
    let k = 1;
    if (Math.abs(gx) > Math.abs(gy)) k = gx < 0 ? 0.74 : 1.12;   // 東へ下る面（右下）は暗く
    else if (Math.abs(gy) > 0) k = gy < 0 ? 1.0 : 0.86;          // 南へ下る面（左下）はそのまま
    g.poly([...P(a[0], a[1], za), ...P(c[0], c[1], zc), ...P(d[0], d[1], zd)]).fill(shade(roof, k));
  };
  for (let sy = 0; sy < SUB; sy++) {
    for (let sx = 0; sx < SUB; sx++) {
      const ax = rx0 + ((rx1 - rx0) * sx) / SUB, bx = rx0 + ((rx1 - rx0) * (sx + 1)) / SUB;
      const ay = ry0 + ((ry1 - ry0) * sy) / SUB, by = ry0 + ((ry1 - ry0) * (sy + 1)) / SUB;
      // 稜線（角から 45° にのびる折れ目）に合わせて、四角を割る対角線の向きを選ぶ
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const nearLeft = mx - ex0 < ex1 - mx, nearTop = my - ey0 < ey1 - my;
      if (nearLeft === nearTop) { tri([ax, ay], [bx, ay], [bx, by]); tri([ax, ay], [bx, by], [ax, by]); }
      else { tri([bx, ay], [bx, by], [ax, by]); tri([bx, ay], [ax, by], [ax, ay]); }
    }
  }
  // 瓦の段（高さの等しい線）
  for (let d = 0.4; d < Math.min(b.w, b.h) / 2 + OVER; d += 0.4) {
    const lx0 = ex0 + d, ly0 = ey0 + d, lx1 = ex1 - d, ly1 = ey1 - d;
    if (lx0 >= lx1 || ly0 >= ly1) break;
    const z = eave + SLOPE * d;
    const seg = (ax: number, ay: number, bx: number, by: number) => {
      const cx0 = Math.max(Math.min(ax, bx), rx0), cx1 = Math.min(Math.max(ax, bx), rx1);
      const cy0 = Math.max(Math.min(ay, by), ry0), cy1 = Math.min(Math.max(ay, by), ry1);
      if (cx0 > cx1 || cy0 > cy1) return;
      g.moveTo(...(P(cx0, cy0, z) as [number, number])).lineTo(...(P(cx1, cy1, z) as [number, number]));
    };
    seg(lx0, ly1, lx1, ly1); seg(lx1, ly0, lx1, ly1);   // 手前の 2 辺だけ（奥は見えにくい）
  }
  g.stroke({ width: 1, color: shade(roof, 0.72), alpha: 0.55 });
  // 軒先の縁
  if (south) g.moveTo(...(P(rx0, ey1, eave) as [number, number])).lineTo(...(P(rx1, ey1, eave) as [number, number])).stroke({ width: 2, color: shade(roof, 0.6) });
  if (east) g.moveTo(...(P(ex1, ry0, eave) as [number, number])).lineTo(...(P(ex1, ry1, eave) as [number, number])).stroke({ width: 2, color: shade(roof, 0.55) });

  // ───── 煙突 ─────
  let smoke: BuildingPiece['smoke'];
  if (b.chimney && i === x1 - 2 && j === y0 + 1) {
    const cx = i + 0.5, cy = j + 0.3, z0 = zAt(cx, cy) - 4, z1 = Math.max(zAt(cx, cy) + 16, eave + SLOPE * Math.min(b.w, b.h) / 2 + 10);
    const s = 0.16;
    const col = 0x8a6a5a;
    g.poly([...P(cx - s, cy + s, z0), ...P(cx + s, cy + s, z0), ...P(cx + s, cy + s, z1), ...P(cx - s, cy + s, z1)]).fill(shade(col, 0.95));
    g.poly([...P(cx + s, cy - s, z0), ...P(cx + s, cy + s, z0), ...P(cx + s, cy + s, z1), ...P(cx + s, cy - s, z1)]).fill(shade(col, 0.78));
    g.poly([...P(cx - s, cy - s, z1), ...P(cx + s, cy - s, z1), ...P(cx + s, cy + s, z1), ...P(cx - s, cy + s, z1)]).fill(0x2a2020);
    const top = P(cx, cy, z1 + 2);
    smoke = { x: o.x + top[0], y: o.y + top[1] };
  }

  // ───── 看板（扉の横に吊るす） ─────
  if (b.sign && door) {
    const side = door.side;
    const here = side === 's' ? south && i === x0 + Math.min(b.w - 1, door.at + 1) : east && j === y0 + Math.min(b.h - 1, door.at + 1);
    if (here) {
      const base = side === 's' ? P(i + 0.5, y1, wallH - 8) : P(x1, j + 0.5, wallH - 8);
      const tip = side === 's' ? P(i + 0.5, y1 + 0.42, wallH - 8) : P(x1 + 0.42, j + 0.5, wallH - 8);
      g.moveTo(base[0], base[1]).lineTo(tip[0], tip[1]).stroke({ width: 2, color: 0x2a2018 });
      const sg = new Graphics();
      sg.roundRect(-11, 0, 22, 17, 3).fill(0x6a4428).stroke({ width: 1.5, color: 0x2a1a10 });
      signIcon(sg, b.sign);
      sg.x = tip[0]; sg.y = tip[1] + 2;
      root.addChild(sg);
    }
  }
  return { root, smoke };
}

/** 看板の絵（店の種類がひと目でわかるように） */
function signIcon(g: Graphics, kind: string) {
  const y = 8.5;
  switch (kind) {
    case 'smith':   // 金床
      g.poly([-6, y - 2, 6, y - 2, 4, y + 1, 2, y + 1, 2, y + 4, -2, y + 4, -2, y + 1, -6, y + 1]).fill(0xd0d4dc);
      break;
    case 'shop':    // 薬瓶
      g.circle(0, y + 1.5, 4).fill(0xe0506a); g.rect(-1.5, y - 5, 3, 3.5).fill(0xe0e8f0);
      break;
    case 'cook':    // 湯気の立つ器
      g.poly([-6, y, 6, y, 4, y + 5, -4, y + 5]).fill(0xf0e0c0);
      g.moveTo(-2, y - 1).quadraticCurveTo(-4, y - 4, -2, y - 6).moveTo(2, y - 1).quadraticCurveTo(0, y - 4, 2, y - 6).stroke({ width: 1.2, color: 0xffffff });
      break;
    case 'storage': // 木箱
      g.rect(-5, y - 4, 10, 9).fill(0xc89a5a).stroke({ width: 1, color: 0x3a2410 });
      g.moveTo(-5, y - 4).lineTo(5, y + 5).stroke({ width: 1, color: 0x3a2410 });
      break;
    case 'chapel':  // 光
      g.rect(-1.2, y - 6, 2.4, 12).fill(0xffe28a); g.rect(-4.5, y - 2.5, 9, 2.4).fill(0xffe28a);
      break;
    case 'guild':   // 旗
      g.rect(-4, y - 6, 1.6, 12).fill(0xe0d0b0); g.poly([-2.4, y - 6, 6, y - 3.5, -2.4, y - 1]).fill(0xd84a4a);
      break;
    default:
      g.circle(0, y, 4).fill(0xffe28a);
  }
}
