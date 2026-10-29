// 魔物の遺伝子。数値は0〜1に正規化し、耐性だけ −0.5〜0.75。
import { ELEMENTS } from './elements.js';
import { clamp } from './rng.js';

export const BEHAVIORS = ['charge', 'ranged', 'swarm', 'flee', 'caller'];
export const BEHAVIOR_JA = { charge: '突進', ranged: '射撃', swarm: '群れ', flee: '逃走', caller: '仲間呼び' };
export const FAMILIES = ['slime', 'beast', 'bug', 'lizard', 'golem'];
export const NUMERIC = ['size', 'hp', 'power', 'speed', 'fecundity', 'poison'];

export function randomGenome(rng, body = rng.pick(ELEMENTS)) {
  const g = {
    body,
    atk: rng.chance(0.75) ? body : rng.pick([...ELEMENTS, 'none']),
    size: rng.float(), hp: rng.float(), power: rng.float(), speed: rng.float(),
    fecundity: rng.range(0.3, 0.8), poison: rng.range(0, 0.6),
    behavior: {}, resist: {},
    parts: {
      family: rng.int(0, FAMILIES.length - 1),
      head: rng.int(0, 3), legs: rng.int(0, 3), tail: rng.int(0, 3), pattern: rng.int(0, 3), eye: rng.int(0, 2),
    },
  };
  for (const b of BEHAVIORS) g.behavior[b] = rng.float() * 0.6;
  g.behavior[rng.pick(BEHAVIORS)] += 0.6;
  for (const e of ELEMENTS) g.resist[e] = clamp(rng.gauss() * 0.12, -0.5, 0.75);
  g.resist[body] = clamp(g.resist[body] + 0.3, -0.5, 0.75);
  return g;
}

export function cloneGenome(g) {
  return JSON.parse(JSON.stringify(g));
}

export function behaviorOf(g) {
  let best = BEHAVIORS[0];
  for (const b of BEHAVIORS) if (g.behavior[b] > g.behavior[best]) best = b;
  return best;
}

export const isFlying = (g) => g.body === 'wind';
export const isPoisonous = (g) => g.poison > 0.7;

/** 両親から子を作る。数値は混ぜ、カテゴリはどちらかを継ぐ */
export function crossover(a, b, rng) {
  const c = cloneGenome(a);
  for (const k of NUMERIC) {
    const t = rng.float();
    c[k] = a[k] * t + b[k] * (1 - t);
  }
  c.body = rng.chance(0.5) ? a.body : b.body;
  c.atk = rng.chance(0.5) ? a.atk : b.atk;
  for (const bh of BEHAVIORS) c.behavior[bh] = rng.chance(0.5) ? a.behavior[bh] : b.behavior[bh];
  for (const e of ELEMENTS) {
    const t = rng.float();
    c.resist[e] = a.resist[e] * t + b.resist[e] * (1 - t);
  }
  for (const p of Object.keys(a.parts)) c.parts[p] = rng.chance(0.5) ? a.parts[p] : b.parts[p];
  return c;
}

/** 突然変異。rate が大きいほど大きく変わる */
export function mutate(g, rng, rate = 1) {
  const m = cloneGenome(g);
  let big = false;
  for (const k of NUMERIC) m[k] = clamp(m[k] + rng.gauss() * 0.05 * rate, 0, 1);
  for (const b of BEHAVIORS) m.behavior[b] = clamp(m.behavior[b] + rng.gauss() * 0.05 * rate, 0, 1.2);
  for (const e of ELEMENTS) m.resist[e] = clamp(m.resist[e] + rng.gauss() * 0.03 * rate, -0.5, 0.75);
  if (rng.chance(0.02 * rate)) { m.atk = rng.pick([...ELEMENTS, 'none']); big = true; }
  if (rng.chance(0.004 * rate)) { m.body = rng.pick(ELEMENTS); big = true; }
  if (rng.chance(0.03 * rate)) {
    const p = rng.pick(Object.keys(m.parts));
    const max = p === 'family' ? FAMILIES.length - 1 : p === 'eye' ? 2 : 3;
    m.parts[p] = rng.int(0, max);
    big = true;
  }
  m.mutant = big || undefined;
  return m;
}

/** 2つの遺伝子の違いの大きさ。新種判定に使う */
export function distance(a, b) {
  let d = 0;
  for (const k of NUMERIC) d += Math.abs(a[k] - b[k]);
  for (const e of ELEMENTS) d += Math.abs(a.resist[e] - b.resist[e]) * 0.8;
  for (const bh of BEHAVIORS) d += Math.abs(a.behavior[bh] - b.behavior[bh]) * 0.5;
  if (a.body !== b.body) d += 2.5;
  if (a.atk !== b.atk) d += 1.2;
  for (const p of Object.keys(a.parts)) if (a.parts[p] !== b.parts[p]) d += p === 'family' ? 1.2 : 0.3;
  return d;
}

/** 個体群の平均的な遺伝子（数値は平均、カテゴリは最頻値） */
export function meanGenome(pool) {
  const m = cloneGenome(pool[0]);
  const n = pool.length;
  for (const k of NUMERIC) m[k] = pool.reduce((s, g) => s + g[k], 0) / n;
  for (const b of BEHAVIORS) m.behavior[b] = pool.reduce((s, g) => s + g.behavior[b], 0) / n;
  for (const e of ELEMENTS) m.resist[e] = pool.reduce((s, g) => s + g.resist[e], 0) / n;
  const mode = (get) => {
    const counts = new Map();
    for (const g of pool) counts.set(get(g), (counts.get(get(g)) || 0) + 1);
    return [...counts.entries()].sort((x, y) => y[1] - x[1])[0][0];
  };
  m.body = mode((g) => g.body);
  m.atk = mode((g) => g.atk);
  for (const p of Object.keys(m.parts)) m.parts[p] = mode((g) => g.parts[p]);
  delete m.mutant;
  return m;
}

/** ダンジョンで使う個体の能力値。tier は階層の深さによる倍率 */
export function monsterStats(g, tier = 1) {
  const sizeMul = 0.8 + g.size * 0.6;
  return {
    maxHp: Math.round((20 + g.hp * 40) * sizeMul * tier),
    power: Math.round((3 + g.power * 7) * tier),
    speed: Math.round((34 + g.speed * 46) * (1.15 - g.size * 0.3)),
    radius: Math.round(6 + g.size * 5),
  };
}
