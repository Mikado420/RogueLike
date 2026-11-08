import {
  addMods, clamp, EQUIP_SLOTS, PRIMARY_STATS, scaled, type Difficulty, type ModKey, type Mods, type PrimaryStat,
  type WeaponType,
} from '../core';
import type { Content, MonsterDef } from '../content/types';
import type { CharacterData, CombatStats, Item, StatusInstance } from '../state';

/** スキルの効き目のレベル（限界突破で上限を超えた分は efficiency 倍。data/balance.json の progression.limitBreak） */
export function effSkillLevel(d: { maxLevel: number }, lv: number, c: Content): number {
  if (lv <= d.maxLevel) return lv;
  return d.maxLevel + (lv - d.maxLevel) * (c.balance.progression.limitBreak?.efficiency ?? 1);
}

/** 今の武器種（武器を持っていないときは片手剣扱い） */
export function weaponTypeOf(char: CharacterData): WeaponType {
  return (char.equipment.weapon?.kind as WeaponType | undefined) ?? 'oneHandSword';
}

/** 装備1つぶんの補正（精錬込みの基礎値＋オプション） */
export function itemMods(it: Item, c: Content): Mods {
  const m: Mods = {};
  const refineMul = 1 + it.refine * c.balance.stats.refineStatPerLevel;
  for (const k in it.stats) {
    const key = k as ModKey;
    m[key] = (m[key] ?? 0) + Math.round((it.stats[key] ?? 0) * refineMul);
  }
  for (const o of it.options) m[o.key] = (m[o.key] ?? 0) + o.value;
  for (const cr of it.crystals) if (cr && c.crystals[cr]) addMods(m, c.crystals[cr].mods);
  if (it.unique) addMods(m, c.uniques[it.unique]?.mods);
  if (it.mythic) addMods(m, c.mythics[it.mythic]?.mods);
  return m;
}

/** 装備中のセットの数と、そろった分のボーナス */
export function setCounts(char: CharacterData): Record<string, number> {
  const out: Record<string, number> = {};
  for (const slot of EQUIP_SLOTS) {
    const s = char.equipment[slot]?.set;
    if (s) out[s] = (out[s] ?? 0) + 1;
  }
  return out;
}

export function setMods(char: CharacterData, c: Content): Mods {
  const m: Mods = {};
  for (const [id, n] of Object.entries(setCounts(char))) {
    for (const b of c.sets[id]?.bonus ?? []) if (n >= b.count) addMods(m, b.mods);
  }
  return m;
}

/** 習得しているパッシブスキルの補正（武器指定のものはその武器のときだけ） */
export function passiveMods(char: CharacterData, weapon: WeaponType, c: Content): Mods {
  const m: Mods = {};
  for (const [id, lv] of Object.entries(char.skills)) {
    const d = c.skills[id];
    if (!d || d.type !== 'passive' || !d.mods || lv <= 0) continue;
    if (d.weapon && d.weapon !== weapon) continue;
    for (const k in d.mods) {
      const key = k as ModKey;
      m[key] = (m[key] ?? 0) + scaled(d.mods[key], effSkillLevel(d, lv, c));
    }
  }
  return m;
}

/** 状態（バフ・デバフ）の補正 */
export function statusMods(statuses: StatusInstance[], c: Content): Mods {
  const m: Mods = {};
  for (const s of statuses) {
    const d = c.statuses[s.id];
    if (d?.mods) addMods(m, d.mods, 1);
    if (s.mods) addMods(m, s.mods, 1);
  }
  return m;
}

/** 追加の補正源（称号・図鑑・拠点・ペットなど）。後のシステムがここに足す */
export type ExtraModSource = (char: CharacterData, c: Content) => Mods;
const extraSources: ExtraModSource[] = [];
export function registerModSource(fn: ExtraModSource) {
  extraSources.push(fn);
}

/** 状態以外のすべての補正（装備・パッシブ・個性ステ・その他） */
export function staticMods(char: CharacterData, c: Content): Mods {
  const m: Mods = {};
  if (char.personal.type && char.personal.value > 0) {
    addMods(m, c.balance.personal[char.personal.type].mods, char.personal.value);
  }
  for (const slot of EQUIP_SLOTS) {
    const it = char.equipment[slot];
    if (it) addMods(m, itemMods(it, c));
  }
  addMods(m, passiveMods(char, weaponTypeOf(char), c));
  addMods(m, c.weapons[weaponTypeOf(char)]?.mods);
  addMods(m, setMods(char, c));
  for (const src of extraSources) addMods(m, src(char, c));
  return m;
}

/** 基礎ステ（振った分＋基礎値＋装備などの加算） */
/** 振った値（＋装備）から実際に効く値へ。softCap の段ごとに効き目が下がる */
export function effectiveStat(raw: number, c: Content): number {
  let out = 0, prev = 0;
  for (const t of c.balance.stats.softCap) {
    const cap = t.upTo ?? Infinity;
    if (raw > prev) out += (Math.min(raw, cap) - prev) * t.rate;
    prev = cap;
  }
  return out;
}

/** 振った値＋装備の合計（効き目を下げる前） */
export function rawPrimaryStats(char: CharacterData, m: Mods, c: Content): Record<PrimaryStat, number> {
  const out = {} as Record<PrimaryStat, number>;
  for (const s of PRIMARY_STATS) out[s] = c.balance.stats.statBase + char.stats[s] + Math.round(m[s] ?? 0);
  return out;
}

/** 実際に効く主ステータス */
export function primaryStats(char: CharacterData, m: Mods, c: Content): Record<PrimaryStat, number> {
  const out = rawPrimaryStats(char, m, c);
  for (const s of PRIMARY_STATS) out[s] = effectiveStat(out[s], c);
  return out;
}

export function derivePlayerStats(char: CharacterData, statuses: StatusInstance[], c: Content, extra?: Mods): CombatStats {
  const m = staticMods(char, c);
  addMods(m, statusMods(statuses, c));
  if (extra) addMods(m, extra);
  const k = c.balance.stats;
  const P = primaryStats(char, m, c);
  const wt = weaponTypeOf(char);
  const wdef = c.weapons[wt];
  const lv = char.level;

  let atk = lv * k.atkPerLevel + (m.atk ?? 0);
  let matk = lv * k.matkPerLevel + (m.matk ?? 0);
  for (const s of PRIMARY_STATS) {
    atk += (wdef?.scaling.atk[s] ?? 0) * P[s];
    matk += (wdef?.scaling.matk[s] ?? 0) * P[s];
  }
  atk *= 1 + (m.atkPct ?? 0) / 100;
  matk *= 1 + (m.matkPct ?? 0) / 100;

  const maxHp = (k.hpBase + lv * k.hpPerLevel + P.vit * k.hpPerVit + (m.maxHp ?? 0)) * (1 + (m.maxHpPct ?? 0) / 100);
  const maxMp = (k.mpBase + P.int * k.mpPerInt + (m.maxMp ?? 0)) * (1 + (m.maxMpPct ?? 0) / 100);
  const def = (lv * k.defPerLevel + P.vit * k.defPerVit + (m.def ?? 0)) * (1 + (m.defPct ?? 0) / 100);
  const mdef = (lv * k.mdefPerLevel + P.int * k.mdefPerInt + (m.mdef ?? 0)) * (1 + (m.mdefPct ?? 0) / 100);

  // AGI が攻撃速度に効くのは statMax まで（上限撤廃で AGI 武器だけが速くなりすぎないように）。
  // それを超えた分と、攻撃速度の上限に当たった分は回避へ。会心率 100% を超えた DEX は会心ダメージへ
  const agiSpd = Math.min(P.agi, k.statMax);
  const aspdRaw = 1 + agiSpd * k.aspdPerAgi + (m.aspdPct ?? 0) / 100;
  const overAgi = (P.agi - agiSpd) + (aspdRaw > k.aspdMax ? Math.min(agiSpd, (aspdRaw - k.aspdMax) / k.aspdPerAgi) : 0);
  const critRaw = k.critBase + P.dex * k.critPerDex + (m.critRate ?? 0);
  const overDex = critRaw > 100 ? Math.min(P.dex, (critRaw - 100) / k.critPerDex) : 0;

  return {
    level: lv,
    atk: Math.max(1, Math.round(atk)),
    matk: Math.max(1, Math.round(matk)),
    def: Math.max(0, Math.round(def)),
    mdef: Math.max(0, Math.round(mdef)),
    maxHp: Math.max(1, Math.round(maxHp)),
    maxMp: Math.max(10, Math.round(maxMp)),
    maxSt: Math.round(c.balance.player.maxStaminaBase + (m.maxSt ?? 0)),
    critRate: clamp((k.critBase + P.dex * k.critPerDex + (m.critRate ?? 0)) / 100, 0, 1),
    critDamage: (k.critDamage + (P.str + overDex) * k.critDamagePerStr + (m.critDamage ?? 0)) / 100,
    aspd: clamp(aspdRaw, 0.3, k.aspdMax),
    cspd: clamp(1 + P.dex * k.cspdPerDex + (m.cspdPct ?? 0) / 100, 0.3, k.cspdMax),
    moveSpeed: clamp(k.moveSpeedBase * (1 + P.agi * k.moveSpeedPerAgi + (m.moveSpeedPct ?? 0) / 100), 0.5, k.moveSpeedMax),
    evasion: Math.min(k.evasionMax, (P.agi + overAgi) * k.evasionPerAgi + (m.evasion ?? 0)),
    element: char.equipment.weapon?.element ?? 'neutral',
    m,
  };
}

export interface MonsterScale { hp: number; atk: number; def: number; exp: number; gold: number }
export const NO_SCALE: MonsterScale = { hp: 1, atk: 1, def: 1, exp: 1, gold: 1 };

/** 難易度（ボス）による倍率。data に難易度表があればそれを使う */
export function difficultyScale(c: Content, d: Difficulty): MonsterScale {
  const table = (c as unknown as { difficulties?: Record<Difficulty, Partial<MonsterScale>> }).difficulties;
  return { ...NO_SCALE, ...(table?.[d] ?? {}) };
}

/** レベル曲線からモンスターの戦闘値を出す */
export function monsterStats(def: MonsterDef, level: number, c: Content, scale: MonsterScale, statuses: StatusInstance[] = []): CombatStats {
  const mb = c.balance.monster;
  const dk = c.balance.damage;
  const hpAt = (l: number) => mb.hp[0] + mb.hp[1] * Math.pow(l, mb.hp[2]);
  const hi = mb.hpHigh;
  const hpCurve = hi && level > hi.from ? hpAt(hi.from) * Math.pow(level / hi.from, hi.pow) : hpAt(level);
  const atkCurve = mb.atk[0] + mb.atk[1] * level;
  const K = dk.defenseKBase + dk.defenseKPerLevel * level;
  const m = statusMods(statuses, c);
  const pct = (k: ModKey) => 1 + (m[k] ?? 0) / 100;
  return {
    level,
    atk: Math.round(atkCurve * def.atk * scale.atk * pct('atkPct')),
    matk: Math.round(atkCurve * def.matk * scale.atk * pct('matkPct')),
    def: Math.round(mb.def * K * def.def * scale.def * pct('defPct')),
    mdef: Math.round(mb.mdef * K * def.mdef * scale.def * pct('mdefPct')),
    maxHp: Math.round(hpCurve * def.hp * scale.hp),
    maxMp: 0,
    maxSt: 0,
    critRate: (def.crit ?? 3) / 100,
    critDamage: 1.5,
    aspd: Math.max(0.3, pct('aspdPct')),
    cspd: 1,
    moveSpeed: def.speed * Math.max(0.1, pct('moveSpeedPct')),
    evasion: 0,
    element: def.element,
    m,
  };
}
