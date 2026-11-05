import { describe, expect, it } from 'vitest';
import { affinity } from '../src/element';
import { ELEMENTS, type Element } from '../src/core';

const ADV = 1.25, DIS = 0.75, N = 1.0;

describe('属性相性', () => {
  it('火→風→地→水→火 の4すくみ', () => {
    expect(affinity('fire', 'wind')).toBe(ADV);
    expect(affinity('wind', 'earth')).toBe(ADV);
    expect(affinity('earth', 'water')).toBe(ADV);
    expect(affinity('water', 'fire')).toBe(ADV);

    expect(affinity('wind', 'fire')).toBe(DIS);
    expect(affinity('earth', 'wind')).toBe(DIS);
    expect(affinity('water', 'earth')).toBe(DIS);
    expect(affinity('fire', 'water')).toBe(DIS);
  });

  it('光と闇は互いに1.25倍', () => {
    expect(affinity('light', 'dark')).toBe(ADV);
    expect(affinity('dark', 'light')).toBe(ADV);
  });

  it('向かい合う属性・同属性・無属性・光闇と4属性は1.0', () => {
    expect(affinity('fire', 'earth')).toBe(N);
    expect(affinity('earth', 'fire')).toBe(N);
    expect(affinity('wind', 'water')).toBe(N);
    expect(affinity('water', 'wind')).toBe(N);
    for (const e of ELEMENTS) {
      expect(affinity(e, e)).toBe(N);
      expect(affinity('neutral', e)).toBe(N);
      expect(affinity(e, 'neutral')).toBe(N);
    }
    for (const a of ['light', 'dark'] as Element[]) {
      for (const b of ['fire', 'water', 'wind', 'earth'] as Element[]) {
        expect(affinity(a, b)).toBe(N);
        expect(affinity(b, a)).toBe(N);
      }
    }
  });

  it('全組み合わせで値は 0.75 / 1.0 / 1.25 のどれか', () => {
    let adv = 0;
    for (const a of ELEMENTS) for (const b of ELEMENTS) {
      const v = affinity(a, b);
      expect([DIS, N, ADV]).toContain(v);
      if (v === ADV) adv++;
    }
    expect(adv).toBe(6);
  });
});
