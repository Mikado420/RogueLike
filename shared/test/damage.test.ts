import { describe, expect, it } from 'vitest';
import { computeDamage } from '../src/damage';
import { Rng } from '../src/rng';
import type { CombatStats } from '../src/types';

const att: CombatStats = {
  atk: 200, matk: 150, def: 0, mdef: 0, critRate: 0, critDamage: 1.5,
  maxHp: 100, element: 'neutral', moveSpeed: 4, attackSpeed: 1,
};
const tgt: CombatStats = { ...att, def: 100, mdef: 50, element: 'neutral' };
const noVar = { defenseConstant: 100, variance: 0, minDamage: 1 };

describe('ダメージ計算', () => {
  it('物理は ATK×威力×K/(K+DEF)', () => {
    const r = computeDamage(att, tgt, { power: 1, element: 'neutral', damageType: 'physical' }, new Rng(1), noVar);
    expect(r.amount).toBe(100); // 200 × 100/200
    expect(r.crit).toBe(false);
  });

  it('魔法は MATK と MDEF を使う', () => {
    const r = computeDamage(att, tgt, { power: 2, element: 'neutral', damageType: 'magic' }, new Rng(1), noVar);
    expect(r.amount).toBe(200); // 150×2 × 100/150
  });

  it('弱点属性で1.25倍・WEAK、不利で0.75倍', () => {
    const fireTgt = { ...tgt, element: 'fire' as const };
    const weak = computeDamage(att, fireTgt, { power: 1, element: 'water', damageType: 'physical' }, new Rng(1), noVar);
    expect(weak.amount).toBe(125);
    expect(weak.weak).toBe(true);
    const resist = computeDamage(att, fireTgt, { power: 1, element: 'earth', damageType: 'physical' }, new Rng(1), noVar);
    expect(resist.amount).toBe(100);
    expect(resist.weak).toBe(false);
    const res2 = computeDamage(att, { ...tgt, element: 'water' }, { power: 1, element: 'fire', damageType: 'physical' }, new Rng(1), noVar);
    expect(res2.amount).toBe(75);
    expect(res2.resist).toBe(true);
  });

  it('クリティカル率100%なら必ずクリティカルで critDamage 倍', () => {
    const r = computeDamage({ ...att, critRate: 1 }, tgt, { power: 1, element: 'neutral', damageType: 'physical' }, new Rng(5), noVar);
    expect(r.crit).toBe(true);
    expect(r.amount).toBe(150);
  });

  it('最低ダメージは minDamage', () => {
    const r = computeDamage({ ...att, atk: 0 }, tgt, { power: 1, element: 'neutral', damageType: 'physical' }, new Rng(1), noVar);
    expect(r.amount).toBe(1);
  });

  it('防御が高いほどダメージは減る', () => {
    let prev = Infinity;
    for (const def of [0, 10, 50, 100, 300, 1000]) {
      const r = computeDamage(att, { ...tgt, def }, { power: 1, element: 'neutral', damageType: 'physical' }, new Rng(1), noVar);
      expect(r.amount).toBeLessThanOrEqual(prev);
      prev = r.amount;
    }
  });

  it('ばらつきは ±variance の範囲に収まる', () => {
    const rng = new Rng(42);
    const k = { defenseConstant: 100, variance: 0.1, minDamage: 1 };
    for (let i = 0; i < 500; i++) {
      const r = computeDamage(att, tgt, { power: 1, element: 'neutral', damageType: 'physical' }, rng, k);
      expect(r.amount).toBeGreaterThanOrEqual(90);
      expect(r.amount).toBeLessThanOrEqual(110);
    }
  });

  it('同じシードなら同じ結果', () => {
    const a = computeDamage({ ...att, critRate: 0.5 }, tgt, { power: 1.3, element: 'fire', damageType: 'physical' }, new Rng(99));
    const b = computeDamage({ ...att, critRate: 0.5 }, tgt, { power: 1.3, element: 'fire', damageType: 'physical' }, new Rng(99));
    expect(a).toEqual(b);
  });
});
