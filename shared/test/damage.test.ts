import { describe, expect, it } from 'vitest';
import { computeDamage, type Attacker, type Defender } from '../src/damage';
import { Rng } from '../src/rng';

const att: Attacker = { level: 1, atk: 200, matk: 150, critRate: 0, critDamage: 1.5 };
const tgt: Defender = { level: 1, def: 100, mdef: 50, element: 'neutral' };
const noVar = { defenseKBase: 100, defenseKPerLevel: 0, variance: 0, minDamage: 1, breakDmgTakenPct: 25 };
const phys = { power: 1, element: 'neutral' as const, damageType: 'physical' as const };

describe('ダメージ計算', () => {
  it('物理は ATK×威力×K/(K+DEF)', () => {
    const r = computeDamage(att, tgt, phys, new Rng(1), noVar);
    expect(r.amount).toBe(100); // 200 × 100/200
    expect(r.crit).toBe(false);
  });

  it('魔法は MATK と MDEF を使う', () => {
    const r = computeDamage(att, tgt, { ...phys, power: 2, damageType: 'magic' }, new Rng(1), noVar);
    expect(r.amount).toBe(200); // 150×2 × 100/150
  });

  it('K は攻撃側のレベルで大きくなる（同じ防御なら高レベルほど通る）', () => {
    const k = { ...noVar, defenseKBase: 40, defenseKPerLevel: 2.4 };
    const lo = computeDamage({ ...att, level: 1 }, tgt, phys, new Rng(1), k);
    const hi = computeDamage({ ...att, level: 100 }, tgt, phys, new Rng(1), k);
    expect(hi.amount).toBeGreaterThan(lo.amount);
  });

  it('弱点属性で1.25倍・WEAK、不利で0.75倍', () => {
    const fireTgt = { ...tgt, element: 'fire' as const };
    const weak = computeDamage(att, fireTgt, { ...phys, element: 'water' }, new Rng(1), noVar);
    expect(weak.amount).toBe(125);
    expect(weak.weak).toBe(true);
    const res = computeDamage(att, { ...tgt, element: 'water' }, { ...phys, element: 'fire' }, new Rng(1), noVar);
    expect(res.amount).toBe(75);
    expect(res.resist).toBe(true);
  });

  it('与ダメ%と耐性%が掛かる', () => {
    const r1 = computeDamage({ ...att, m: { physDmgPct: 20, fireDmgPct: 30 } }, tgt, { ...phys, element: 'fire' }, new Rng(1), noVar);
    expect(r1.amount).toBe(150); // 100 × 1.5
    const r2 = computeDamage(att, { ...tgt, m: { fireResPct: 20, dmgReductionPct: 10 } }, { ...phys, element: 'fire' }, new Rng(1), noVar);
    expect(r2.amount).toBe(70); // 100 × 0.7
    const r3 = computeDamage({ ...att, m: { skillDmgPct: 10, normalDmgPct: 50 } }, tgt, { ...phys, kind: 'skill' }, new Rng(1), noVar);
    expect(r3.amount).toBe(110);
  });

  it('クリティカル率100%なら必ずクリティカルで critDamage 倍', () => {
    const r = computeDamage({ ...att, critRate: 1 }, tgt, phys, new Rng(5), noVar);
    expect(r.crit).toBe(true);
    expect(r.amount).toBe(150);
    const n = computeDamage({ ...att, critRate: 1 }, tgt, { ...phys, canCrit: false }, new Rng(5), noVar);
    expect(n.crit).toBe(false);
  });

  it('追加倍率（ボス特効・ブレイクなど）が掛かる', () => {
    const r = computeDamage(att, tgt, { ...phys, bonusMul: 1.25 }, new Rng(1), noVar);
    expect(r.amount).toBe(125);
  });

  it('最低ダメージは minDamage', () => {
    const r = computeDamage({ ...att, atk: 0 }, tgt, phys, new Rng(1), noVar);
    expect(r.amount).toBe(1);
  });

  it('防御が高いほどダメージは減る', () => {
    let prev = Infinity;
    for (const def of [0, 10, 50, 100, 300, 1000]) {
      const r = computeDamage(att, { ...tgt, def }, phys, new Rng(1), noVar);
      expect(r.amount).toBeLessThanOrEqual(prev);
      prev = r.amount;
    }
  });

  it('ばらつきは ±variance の範囲に収まる', () => {
    const rng = new Rng(42);
    const k = { ...noVar, variance: 0.1 };
    for (let i = 0; i < 500; i++) {
      const r = computeDamage(att, tgt, phys, rng, k);
      expect(r.amount).toBeGreaterThanOrEqual(90);
      expect(r.amount).toBeLessThanOrEqual(110);
    }
  });

  it('同じシードなら同じ結果', () => {
    const a = computeDamage({ ...att, critRate: 0.5 }, tgt, { ...phys, power: 1.3, element: 'fire' }, new Rng(99));
    const b = computeDamage({ ...att, critRate: 0.5 }, tgt, { ...phys, power: 1.3, element: 'fire' }, new Rng(99));
    expect(a).toEqual(b);
  });
});
