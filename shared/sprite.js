// 魔物のドット絵を遺伝子から自動生成する（左右対称・正面向き）。
// 体の土台（系統）→ 頭・脚・尾・翼・模様・目 の順に重ね、最後に影と輪郭を付ける。
import { ELEMENT_INFO } from './elements.js';
import { FAMILIES } from './genome.js';

const HALF = 10, W = 20, H = 18;

// 左半分（8列）。'#' が体。右端の列が中心側。
const TEMPLATES = {
  slime: [
    '........', '........', '........', '........', '........', '.....###', '...#####', '..######',
    '.#######', '.#######', '########', '########', '########', '.#######', '..######', '........',
  ],
  beast: [
    '........', '........', '..#.....', '..##....', '..######', '.#######', '.#######', '..######',
    '...#####', '..######', '.#######', '.#######', '.#######', '.##..###', '.##..###', '........',
  ],
  bug: [
    '........', '...#....', '....#...', '.....###', '...#####', '..######', '.#######', '#.######',
    '.#######', '#.######', '.#######', '#.######', '..######', '...#####', '........', '........',
  ],
  lizard: [
    '........', '........', '....####', '...#####', '...#####', '....####', '..######', '.#######',
    '#.######', '..######', '..######', '.#######', '#..#####', '....####', '.....###', '........',
  ],
  golem: [
    '........', '........', '...#####', '...#####', '...#####', '########', '########', '##.#####',
    '##.#####', '##.#####', '...#####', '..######', '..##.###', '..##.###', '.###.###', '........',
  ],
};

const WINGS = [
  '..........', '#.........', '##........', '###.......', '####......', '#####.....', '.####.....', '..###.....', '...##.....',
];

export function generateSprite(g) {
  const fam = FAMILIES[g.parts.family] || 'slime';
  const tpl = TEMPLATES[fam];
  const body = new Uint8Array(W * H); // 1 = 体
  const set = (x, y, v = 1) => {
    if (x < 0 || y < 0 || y >= H || x >= HALF) return;
    body[y * W + x] = v;
    body[y * W + (W - 1 - x)] = v;
  };
  const get = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : body[y * W + x]);
  const yOff = 1;
  tpl.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') set(x + 2, y + yOff); }));

  let top = H;
  for (let y = 0; y < H; y++) for (let x = 0; x < HALF; x++) if (get(x, y)) top = Math.min(top, y);

  // 頭の飾り
  const hd = g.parts.head;
  if (hd === 1) { set(6, top - 1); set(5, top - 2); set(5, top - 1); }                 // 角
  if (hd === 2) { set(9, top - 1); set(9, top - 2); set(8, top - 1); }                 // とさか
  if (hd === 3) { set(7, top - 1); set(7, top - 2); set(6, top - 3); }                 // 触角

  // 脚
  const lg = g.parts.legs;
  if (lg === 1) for (const y of [11, 13]) set(1, y + yOff);
  if (lg === 3) { set(3, 16); set(4, 16); set(6, 16); set(7, 16); }
  if (lg === 2) for (let x = 0; x < HALF; x++) if (get(x, 15) && !get(x, 13)) set(x, 15, 0);

  // 尾（正面から見えるとげ・ふくらみ）
  const tl = g.parts.tail;
  if (tl === 1) for (let y = top + 3; y < 14; y += 2) { let x = 0; while (x < HALF && !get(x, y)) x++; set(x - 1, y); }
  if (tl === 3) { set(8, 16); set(9, 16); set(9, 17); }

  // 翼（風の種は空を飛ぶ）
  if (g.body === 'wind') WINGS.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#' && !get(x, y + 3)) set(x, y + 3, 2); }));

  // 色
  const info = ELEMENT_INFO[g.body] || ELEMENT_INFO.none;
  const accent = g.mutant ? '#fc74b4' : (ELEMENT_INFO[g.atk] || ELEMENT_INFO.none).color;
  // 0 透明, 1 輪郭, 2 影, 3 地, 4 明, 5 白目, 6 瞳, 7 模様, 8 翼
  const palette = [null, g.apex ? '#f8b800' : '#101018', info.dark, info.color, info.light, '#fcfcfc', '#101018', accent, info.light];
  const px = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = get(x, y);
    if (!v) continue;
    if (v === 2) { px[y * W + x] = 8; continue; }
    let c = 3;
    if (!get(x, y - 1)) c = 4;
    else if (!get(x, y + 1) || !get(x, y + 2)) c = 2;
    const pat = g.parts.pattern;
    if (pat === 1 && (x * 7 + y * 3) % 9 === 0 && c === 3) c = 7;
    if (pat === 2 && y % 4 === 0 && c === 3) c = 7;
    if (pat === 3 && Math.abs(x - (W - 1) / 2) < 2.6 && y > top + 4 && c === 3) c = 4;
    px[y * W + x] = c;
  }

  // 目
  let ey = fam === 'slime' ? 9 : top + 3;
  for (let y = ey; y < H - 4; y++) if (get(6, y) && get(7, y) && get(8, y) && get(6, y + 1)) { ey = y; break; }
  const eye = g.parts.eye;
  const putEye = (x, y, big) => {
    if (!get(x, y)) return;
    px[y * W + x] = 5;
    px[y * W + (W - 1 - x)] = 5;
    if (big && get(x, y + 1)) { px[(y + 1) * W + x] = 6; px[(y + 1) * W + (W - 1 - x)] = 6; }
    else { px[y * W + x + 1] = 6; px[y * W + (W - 2 - x)] = 6; }
  };
  if (eye === 2) {
    const cx = W / 2 - 1;
    if (get(cx, ey)) { px[ey * W + cx] = 5; px[ey * W + cx + 1] = 5; px[(ey + 1) * W + cx] = 6; px[(ey + 1) * W + cx + 1] = 6; }
  } else {
    putEye(7, ey, eye === 1);
  }

  // 輪郭
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (px[y * W + x]) continue;
    const n = (dx, dy) => { const xx = x + dx, yy = y + dy; return xx >= 0 && yy >= 0 && xx < W && yy < H && px[yy * W + xx] && px[yy * W + xx] !== 1; };
    if (n(1, 0) || n(-1, 0) || n(0, 1) || n(0, -1)) px[y * W + x] = 1;
  }
  return { w: W, h: H, px, palette };
}

/** 遺伝子の見た目に関わる部分だけでキャッシュキーを作る */
export function spriteKey(g) {
  const p = g.parts;
  return `${g.body}${g.atk}${p.family}${p.head}${p.legs}${p.tail}${p.pattern}${p.eye}${g.mutant ? 'm' : ''}${g.apex ? 'a' : ''}`;
}
