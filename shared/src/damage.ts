import { ELEMENT_DMG_KEY, ELEMENT_RES_KEY, type DamageType, type Element, type Mods } from './core';
import type { Balance } from './content/types';
import { affinity } from './element';
import { CONTENT } from './content';
import type { Rng } from './rng';

export interface Attacker {
  level: number;
  atk: number; matk: number;
  critRate: number; critDamage: number;
  m?: Mods;
}

export interface Defender {
  level: number;
  def: number; mdef: number;
  element: Element;
  m?: Mods;
}

export interface DamageSpec {
  power: number;
  element: Element;
  damageType: DamageType;
  kind?: 'normal' | 'skill' | 'dot' | 'monster';
  canCrit?: boolean;
  /** 呼び出し側が決める追加倍率（ボス特効・ブレイク中・背面など） */
  bonusMul?: number;
  /** クリティカル率の加算（0〜1） */
  critBonus?: number;
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
 *   基礎   = (物理なら ATK / 魔法なら MATK) × 威力
 *   防御   = K / (K + 防御)    K = defenseKBase + defenseKPerLevel × 攻撃側Lv
 *   属性   = 相性表（0.75 / 1.0 / 1.25）
 *   与ダメ = 1 + (物理/魔法% + 通常/スキル% + 属性%) / 100
 *   被ダメ = 1 - (属性耐性% + 被ダメ軽減%) / 100（下限 0.1）
 *   最終   = max(minDamage, round(基礎 × 防御 × 属性 × 与ダメ × 被ダメ × ばらつき × クリ × 追加倍率))
 * 乱数はクリティカル判定 → ばらつきの順に1回ずつ引く。
 */
export function computeDamage(
  att: Attacker,
  tgt: Defender,
  spec: DamageSpec,
  rng: Rng,
  k: Balance['damage'] = CONTENT.balance.damage,
): DamageResult {
  const physical = spec.damageType === 'physical';
  const base = (physical ? att.atk : att.matk) * spec.power;
  const defense = Math.max(0, physical ? tgt.def : tgt.mdef);
  const K = k.defenseKBase + k.defenseKPerLevel * att.level;
  const mitigation = K / (K + defense);
  const aff = affinity(spec.element, tgt.element);

  const am = att.m ?? {};
  const tm = tgt.m ?? {};
  let dmgPct = (physical ? am.physDmgPct : am.magDmgPct) ?? 0;
  if (spec.kind === 'normal') dmgPct += am.normalDmgPct ?? 0;
  if (spec.kind === 'skill') dmgPct += am.skillDmgPct ?? 0;
  const ek = ELEMENT_DMG_KEY[spec.element];
  if (ek) dmgPct += am[ek] ?? 0;
  const rk = ELEMENT_RES_KEY[spec.element];
  const resPct = (rk ? tm[rk] ?? 0 : 0) + (tm.dmgReductionPct ?? 0);
  const mult = Math.max(0, 1 + dmgPct / 100) * Math.max(0.1, 1 - resPct / 100);

  const canCrit = spec.canCrit !== false;
  const crit = canCrit && rng.next() < att.critRate + (spec.critBonus ?? 0);
  const variance = 1 - k.variance + rng.next() * 2 * k.variance;
  const raw = base * mitigation * aff * mult * variance * (crit ? att.critDamage : 1) * (spec.bonusMul ?? 1);
  return {
    amount: Math.max(k.minDamage, Math.round(raw)),
    crit,
    affinity: aff,
    weak: aff > 1,
    resist: aff < 1,
  };
}
