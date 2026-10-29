// ダンジョン生成。地形はシードから、魔物は「いまの生態系」から決まる。
import { Rng } from './rng.js';
import { mutate } from './genome.js';

export const TILE = 16;
export const WALL = 0, FLOOR = 1;

function carveRoom(tiles, w, r) {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) tiles[y * w + x] = FLOOR;
}
function carveCorridor(tiles, w, a, b, rng) {
  const ax = Math.floor(a.x + a.w / 2), ay = Math.floor(a.y + a.h / 2);
  const bx = Math.floor(b.x + b.w / 2), by = Math.floor(b.y + b.h / 2);
  const hFirst = rng.chance(0.5);
  const dig = (x, y) => { for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) tiles[(y + dy) * w + (x + dx)] = FLOOR; };
  if (hFirst) {
    for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) dig(x, ay);
    for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) dig(bx, y);
  } else {
    for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) dig(ax, y);
    for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) dig(x, by);
  }
}

const center = (r) => ({ x: (r.x + r.w / 2) * TILE, y: (r.y + r.h / 2) * TILE });

/**
 * @param {object} o
 * @param {string} o.seed
 * @param {object} o.area      AREAS の1つ
 * @param {number} o.floor     1から
 * @param {Array}  o.snapshot  areaSnapshot() の結果
 * @param {object} [o.apex]    ワールドレイドの頂点捕食者
 */
export function generateFloor({ seed, area, floor, snapshot, apex = null, partySize = 1 }) {
  const rng = new Rng(`${seed}:${area.id}:${floor}`);
  const tier = 1 + (floor - 1) * 0.28;
  let w, h, rooms;

  if (apex) {
    w = 34; h = 26;
    rooms = [{ x: 3, y: 3, w: w - 6, h: h - 6 }];
  } else {
    w = 46; h = 34;
    rooms = [];
    const want = 7 + Math.min(3, Math.floor(floor / 2));
    for (let tries = 0; rooms.length < want && tries < 400; tries++) {
      const rw = rng.int(6, 11), rh = rng.int(5, 9);
      const r = { x: rng.int(1, w - rw - 2), y: rng.int(1, h - rh - 2), w: rw, h: rh };
      if (rooms.some((o) => r.x < o.x + o.w + 2 && r.x + r.w + 2 > o.x && r.y < o.y + o.h + 2 && r.y + r.h + 2 > o.y)) continue;
      rooms.push(r);
    }
    // 部屋を左上から順に並べて、通路で鎖状につなぐ
    rooms.sort((a, b) => (a.x + a.y * 0.6) - (b.x + b.y * 0.6));
  }

  const tiles = new Array(w * h).fill(WALL);
  rooms.forEach((r) => carveRoom(tiles, w, r));
  for (let i = 1; i < rooms.length; i++) carveCorridor(tiles, w, rooms[i - 1], rooms[i], rng);
  if (rooms.length > 3) carveCorridor(tiles, w, rooms[0], rooms[Math.floor(rooms.length / 2)], rng); // 近道

  const start = center(rooms[0]);
  const last = rooms[rooms.length - 1];
  const exitRoom = apex ? rooms[0] : last;
  const stairs = apex ? null : { x: (last.x + 2) * TILE, y: (last.y + last.h / 2) * TILE };
  const portal = apex
    ? { x: (exitRoom.x + 2) * TILE, y: (exitRoom.y + 2) * TILE }
    : { x: (last.x + last.w - 2) * TILE, y: (last.y + last.h / 2) * TILE };

  // 魔物の配置。個体数の多い種ほど出やすい
  const spawns = [];
  const alive = snapshot.filter((s) => s.pool.length);
  if (apex) {
    spawns.push({ boss: true, x: (w / 2) * TILE, y: (h / 2 - 2) * TILE, speciesId: apex.speciesId, speciesName: apex.name, genome: apex.genome, tier: 2.2 });
  } else if (alive.length) {
    const mutantChance = 0.04 + floor * 0.025;
    const per = 2 + Math.floor(floor / 2) + Math.floor((partySize - 1) * 0.8);
    rooms.slice(1).forEach((r) => {
      const count = rng.int(Math.max(1, per - 1), per + 1);
      const sp = rng.weighted(alive, (s) => Math.max(2, s.pop));
      for (let i = 0; i < count; i++) {
        const s = i === 0 || rng.chance(0.6) ? sp : rng.weighted(alive, (x) => Math.max(2, x.pop));
        let g = rng.pick(s.pool);
        if (rng.chance(mutantChance)) g = { ...mutate(g, rng, 4), mutant: true };
        spawns.push({
          x: (r.x + 1 + rng.float() * (r.w - 2)) * TILE,
          y: (r.y + 1 + rng.float() * (r.h - 2)) * TILE,
          speciesId: s.id, speciesName: s.name, endangered: s.endangered, genome: g, tier,
        });
      }
    });
  }

  return { w, h, tiles, rooms, start, stairs, portal, spawns, env: area.env, areaId: area.id, areaName: area.name, floor, tier, raid: !!apex };
}

export function isWall(map, px, py) {
  const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return true;
  return map.tiles[ty * map.w + tx] === WALL;
}

/** 円の当たり判定つきで移動 */
export function moveCircle(map, e, dx, dy, r) {
  const tryMove = (nx, ny) =>
    !isWall(map, nx - r, ny - r) && !isWall(map, nx + r, ny - r) && !isWall(map, nx - r, ny + r) && !isWall(map, nx + r, ny + r);
  if (dx && tryMove(e.x + dx, e.y)) e.x += dx;
  if (dy && tryMove(e.x, e.y + dy)) e.y += dy;
}
