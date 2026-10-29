// 決定的な乱数。同じシードなら同じ結果になる（サーバーとクライアントで共有するため）

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return next;
}

export class Rng {
  constructor(seed) {
    this.seed = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    this.next = mulberry32(this.seed);
  }
  float() { return this.next(); }
  range(min, max) { return min + (max - min) * this.next(); }
  int(min, max) { return Math.floor(this.range(min, max + 1)); } // 両端を含む
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  weighted(items, weightOf) {
    let total = 0;
    for (const it of items) total += Math.max(0, weightOf(it));
    if (total <= 0) return items[0];
    let r = this.next() * total;
    for (const it of items) {
      r -= Math.max(0, weightOf(it));
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }
  gauss() {
    // Box-Muller
    const u = Math.max(1e-9, this.next());
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const uid = (rng, prefix = '') => prefix + Math.floor(rng.float() * 2 ** 32).toString(36) + Math.floor(rng.float() * 2 ** 32).toString(36);
