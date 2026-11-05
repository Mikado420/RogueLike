/** シード付き乱数（mulberry32）。状態は number 1つなので保存・送信しやすい。 */
export class Rng {
  state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  /** [0, 1) の一様乱数 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
  /** min 以上 max 以下の整数 */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  /** 重み付き抽選。重み 0 の項目は選ばれない。 */
  weighted<K extends string>(weights: Partial<Record<K, number>>): K {
    const entries = Object.entries(weights) as [K, number][];
    const total = entries.reduce((s, [, w]) => s + Math.max(0, w), 0);
    let roll = this.next() * total;
    for (const [k, w] of entries) {
      if (w <= 0) continue;
      roll -= w;
      if (roll < 0) return k;
    }
    return entries.filter(([, w]) => w > 0).at(-1)![0];
  }
}

/** 文字列や数値から決まった 32bit の値を作る（天気・日替わりなどの決定的な抽選用） */
export function hash32(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
