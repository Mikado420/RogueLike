import type { CombatStats, DamageConstants, DamageType, Element } from './types';
import { affinity } from './element';
import { CONTENT } from './content';
import type { Rng } from './rng';

export interface HitSpec {
  power: number;
  element: Element;
  damageType: DamageType;
}

export interface DamageResult {
  amount: number;
  crit: boolean;
  affinity: number;
  weak: boolean;
  resist: boolean;
}

/**
 * ダメージ式:
 *   基礎 = (物理なら ATK / 魔法なら MATK) × 威力
 *   軽減 = K / (K + 防御)        K = defenseConstant
 *   ばらつき = 1 ± variance
 *   最終 = max(minDamage, round(基礎 × 軽減 × 属性倍率 × ばらつき × (クリ時 critDamage)))
 * 乱数はクリティカル判定 → ばらつきの順に1回ずつ引く。
 */
export function computeDamage(
  att: Pick<CombatStats, 'atk' | 'matk' | 'critRate' | 'critDamage'>,
  def: Pick<CombatStats, 'def' | 'mdef' | 'element'>,
  spec: HitSpec,
  rng: Rng,
  k: DamageConstants = CONTENT.balance.damage,
): DamageResult {
  const physical = spec.damageType === 'physical';
  const base = (physical ? att.atk : att.matk) * spec.power;
  const defense = Math.max(0, physical ? def.def : def.mdef);
  const mitigation = k.defenseConstant / (k.defenseConstant + defense);
  const aff = affinity(spec.element, def.element);
  const crit = rng.next() < att.critRate;
  const variance = 1 - k.variance + rng.next() * 2 * k.variance;
  const raw = base * mitigation * aff * variance * (crit ? att.critDamage : 1);
  return {
    amount: Math.max(k.minDamage, Math.round(raw)),
    crit,
    affinity: aff,
    weak: aff > 1,
    resist: aff < 1,
  };
}
