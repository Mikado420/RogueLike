// 町（ハブ）の地図。町の中の移動は各クライアントで行い、位置だけを共有する。
export const TOWN_TILE = 16;

// # 壁・建物 / . 地面 / , 石畳 / ~ 水 / T 木
const ROWS = [
  '##############################',
  '#TT..........,,,,..........TT#',
  '#T..######...,,,,...######..T#',
  '#...######...,,,,...######...#',
  '#...######...,,,,...######...#',
  '#............,,,,............#',
  '#..,,,,,,,,,,,,,,,,,,,,,,,,..#',
  '#..,....................~~,..#',
  '#..,..######......####..~~,..#',
  '#..,..######......####..~~,..#',
  '#..,..######.,,,,.####.....,.#',
  '#..,.........,,,,..........,.#',
  '#..,,,,,,,,,,,,,,,,,,,,,,,,,.#',
  '#T...........,,,,...........T#',
  '#TT..........,,,,..........TT#',
  '##############,,##############',
];
export const TOWN = {
  w: ROWS[0].length, h: ROWS.length,
  tiles: ROWS.join(''),
  spawn: { x: 15 * 16, y: 11 * 16 },
};

// 調べると開く場所（建物の入口）
export const SPOTS = [
  { id: 'craft',  label: '工房',     x: 7 * 16 + 8,  y: 5 * 16 + 8,  sign: '工' },
  { id: 'shop',   label: '道具屋',   x: 23 * 16 + 8, y: 5 * 16 + 8,  sign: '道' },
  { id: 'market', label: '取引所',   x: 9 * 16,      y: 11 * 16 + 8, sign: '取' },
  { id: 'codex',  label: '図鑑館',   x: 20 * 16 + 8, y: 11 * 16 + 8, sign: '図' },
  { id: 'board',  label: '掲示板',   x: 11 * 16 + 8, y: 7 * 16 + 8,  sign: '掲' },
  { id: 'party',  label: '酒場（パーティ）', x: 18 * 16 + 8, y: 7 * 16 + 8, sign: '酒' },
  { id: 'gate',   label: '迷宮の門', x: 15 * 16,     y: 14 * 16 + 8, sign: '門' },
  { id: 'raid',   label: 'レイドの石碑', x: 25 * 16 + 8, y: 10 * 16 + 8, sign: '碑', raidOnly: true },
  { id: 'equip',  label: '自宅（装備）', x: 4 * 16 + 8, y: 12 * 16 + 8, sign: '家' },
];

export function townWall(px, py) {
  const tx = Math.floor(px / TOWN_TILE), ty = Math.floor(py / TOWN_TILE);
  if (tx < 0 || ty < 0 || tx >= TOWN.w || ty >= TOWN.h) return true;
  const c = TOWN.tiles[ty * TOWN.w + tx];
  return c === '#' || c === '~' || c === 'T';
}

export function moveInTown(e, dx, dy, r = 5) {
  const ok = (x, y) => !townWall(x - r, y - r) && !townWall(x + r, y - r) && !townWall(x - r, y + r) && !townWall(x + r, y + r);
  if (dx && ok(e.x + dx, e.y)) e.x += dx;
  if (dy && ok(e.x, e.y + dy)) e.y += dy;
}
