import type { BaseStats, CombatStats, Content, Item, OptionStat, PrimaryStat, WeaponType } from './types';
import { CONTENT } from './content';

export interface Equipment { weapon: Item | null; armor: Item | null; accessory: Item | null }

const PRIMARY: PrimaryStat[] = ['str', 'int', 'vit', 'agi', 'dex'];

/** 装備のオプションを合計する */
function sumOptions(eq: Equipment): Partial<Record<OptionStat, number>> {
  const out: Partial<Record<OptionStat, number>> = {};
  for (const it of [eq.weapon, eq.armor, eq.accessory]) {
    if (!it) continue;
    for (const o of it.options) out[o.stat] = (out[o.stat] ?? 0) + o.value;
  }
  return out;
}

/** 精錬込みの装備の数値 */
export function itemStat(it: Item, key: keyof Item['stats'], c: Content = CONTENT): number {
  const v = it.stats[key] ?? 0;
  return Math.round(v * (1 + it.refine * c.balance.stats.refineStatPerLevel));
}

/** ステータス・武器・装備からプレイヤーの戦闘値を出す */
export function derivePlayerStats(base: BaseStats, eq: Equipment, c: Content = CONTENT): CombatStats {
  const k = c.balance.stats;
  const opt = sumOptions(eq);
  const s: Record<PrimaryStat, number> = { str: 0, int: 0, vit: 0, agi: 0, dex: 0 };
  for (const p of PRIMARY) s[p] = base[p] + (opt[p] ?? 0);

  const weaponType: WeaponType = eq.weapon?.weaponType ?? 'oneHandSword';
  const wdef = c.weapons[weaponType];
  const scaling = wdef.scaling ?? { atk: {}, matk: {} };

  let atk = 0, matk = 0, def = 0, mdef = 0, hp = 0;
  for (const it of [eq.weapon, eq.armor, eq.accessory]) {
    if (!it) continue;
    atk += itemStat(it, 'atk', c);
    matk += itemStat(it, 'matk', c);
    def += itemStat(it, 'def', c);
    mdef += itemStat(it, 'mdef', c);
    hp += itemStat(it, 'maxHp', c);
  }
  for (const p of PRIMARY) {
    atk += (scaling.atk[p] ?? 0) * s[p];
    matk += (scaling.matk[p] ?? 0) * s[p];
  }
  atk *= 1 + (opt.atkPct ?? 0) / 100;
  matk *= 1 + (opt.matkPct ?? 0) / 100;

  const crt = base.personal.type === 'crt' ? base.personal.value : 0;
  return {
    atk: Math.round(atk),
    matk: Math.round(matk),
    def: Math.round(def + s.vit * k.defPerVit + (opt.def ?? 0)),
    mdef: Math.round(mdef + s.int * k.mdefPerInt + (opt.mdef ?? 0)),
    critRate: Math.min(1, k.critBase + s.dex * k.critPerDex + crt * k.critPerCrt + (opt.critRate ?? 0) / 100),
    critDamage: k.critDamage + (opt.critDamage ?? 0) / 100,
    maxHp: Math.round(k.hpBase + s.vit * k.hpPerVit + hp + (opt.maxHp ?? 0)),
    element: eq.weapon?.element ?? 'neutral',
    moveSpeed: k.moveSpeedBase * (1 + s.agi * k.moveSpeedPerAgi),
    attackSpeed: 1 + s.agi * k.attackSpeedPerAgi + (opt.aspdPct ?? 0) / 100,
  };
}
