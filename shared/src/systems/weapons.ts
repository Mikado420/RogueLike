import { angleDiff, scaled } from '../core';
import type { AttackDef, SkillDef, WeaponDef, WeaponMechanic } from '../content/types';
import type { Actor, HitSpec, Player, PlayerInput, World } from '../state';
import { buildSpec, launchAttack } from './combat';
import { weaponTypeOf } from './stats';
import type { Aim } from './skills';
import { sec } from './util';

/**
 * 武器ごとの仕組み（溜め・弾数とリロード・コンボ・リズム・間合い・吸収）。
 * 通常攻撃と、スキルの前後に割り込む skillHooks をここに置く。
 */

export function weaponDef(w: World, p: Player): WeaponDef {
  return w.content.weapons[weaponTypeOf(p.char)];
}

export function mechanicOf(w: World, p: Player): WeaponMechanic {
  return weaponDef(w, p)?.mechanic ?? { type: 'none' };
}

// ───────── 銃：弾数とリロード ─────────

export function magazineSize(w: World, p: Player): number {
  const m = mechanicOf(w, p);
  if (m.type !== 'ammo') return 0;
  return Math.max(1, m.magazine + Math.floor(p.stats.m.magazine ?? 0));
}

function startReload(w: World, p: Player) {
  const m = mechanicOf(w, p);
  if (m.type !== 'ammo' || p.reloadTicks > 0) return;
  p.reloadTicks = Math.max(1, Math.round(sec(w, m.reload) * Math.max(0.2, 1 - (p.stats.m.reloadPct ?? 0) / 100)));
  w.events.push({ type: 'reload', playerId: p.id, done: false });
}

// ───────── 楽器：拍 ─────────

export function beatTicks(w: World, bpm: number): number {
  return Math.max(2, Math.round((w.content.balance.tickRate * 60) / bpm));
}

/** その tick が拍に合っているか（拍の前後 window tick まで） */
export function isOnBeat(w: World, m: Extract<WeaponMechanic, { type: 'rhythm' }>, tick: number): boolean {
  const b = beatTicks(w, m.bpm);
  const ph = tick % b;
  return ph <= m.window || ph >= b - m.window;
}

// ───────── 両手剣：溜め ─────────

export function chargeLevel(w: World, p: Player): number {
  const m = mechanicOf(w, p);
  if (m.type !== 'charge' || p.charge <= 0) return 0;
  const speed = 1 + (p.stats.m.chargePct ?? 0) / 100;
  let lvl = 0;
  m.levels.forEach((t, i) => { if (p.charge >= sec(w, t) / speed) lvl = i + 1; });
  return lvl;
}

/** 毎tick（硬直中でも）進める武器のタイマー */
export function updateWeaponTimers(w: World, p: Player) {
  const m = mechanicOf(w, p);
  if (m.type === 'ammo') {
    if (p.ammo < 0) p.ammo = magazineSize(w, p);
    if (p.reloadTicks > 0 && --p.reloadTicks === 0) {
      p.ammo = magazineSize(w, p);
      w.events.push({ type: 'reload', playerId: p.id, done: true });
    }
  } else {
    p.ammo = -1;
    p.reloadTicks = 0;
  }
  if (m.type !== 'charge') p.charge = 0;
  if (m.type === 'combo') {
    if (p.combo > 0 && w.tick > p.comboUntil) p.combo = 0;
  } else p.combo = 0;
  if (m.type !== 'rhythm') p.rhythm = 0;
}

export function comboMax(w: World, p: Player): number {
  const m = mechanicOf(w, p);
  return m.type === 'combo' ? m.max + Math.floor(p.stats.m.comboMax ?? 0) : 0;
}

export const skillHooks = {
  /** false を返すと使えない。倍率を返すと威力・バフに掛ける */
  before(w: World, p: Player, d: SkillDef, lv: number): false | { power: number; buff: number } {
    const m = mechanicOf(w, p);
    let power = 1, buff = 1;
    if (d.chargeable && m.type === 'charge' && p.charge > 0) {
      const lvl = chargeLevel(w, p);
      if (lvl > 0) power *= m.powerMul[lvl - 1];
      p.charge = 0;
    }
    if (d.consume) {
      const stacks = d.consume.resource === 'combo' ? p.combo : p.rhythm;
      const base = scaled((d.attack ?? d.attacks?.[0])?.power, lv, 1) || 1;
      power *= 1 + (d.consume.powerPerStack * stacks) / base;
      if (d.consume.resource === 'combo') p.combo = 0; else p.rhythm = 0;
    }
    if (d.buff?.rhythm && m.type === 'rhythm') {
      buff *= 1 + (p.rhythm * m.perStack / 100) * (1 + (p.stats.m.rhythmPct ?? 0) / 100);
    }
    return { power, buff };
  },
  after(w: World, p: Player, d: SkillDef, _lv: number): void {
    if (d.reload && mechanicOf(w, p).type === 'ammo') {
      p.ammo = magazineSize(w, p);
      p.reloadTicks = 0;
      w.events.push({ type: 'reload', playerId: p.id, done: true });
    }
  },
};

/** 武器の仕組みによる命中時の倍率（間合い・背面・コンボ・処刑） */
export function weaponHitMods(w: World, src: Player, tgt: Actor, spec: HitSpec): { mul: number; critBonus: number; sweet: boolean; back: boolean } {
  const m = mechanicOf(w, src);
  const cb = w.content.balance.combat;
  let mul = 1, critBonus = 0, sweet = false, back = false;
  if (spec.kind === 'dot') return { mul, critBonus, sweet, back };
  if (m.type === 'combo') mul *= 1 + (src.combo * m.perStack) / 100;
  if (m.type === 'spacing' && spec.reach) {
    const d = Math.hypot(tgt.x - src.x, tgt.y - src.y) - tgt.r;
    if (d >= spec.reach * m.sweetFrom) { mul *= m.bonus; sweet = true; }
  }
  if (m.type === 'ammo') {
    const fromTgt = Math.atan2(src.y - tgt.y, src.x - tgt.x);
    if (Math.abs(angleDiff(fromTgt, tgt.facing)) * 180 / Math.PI >= cb.backAngle) {
      mul *= m.backstabMul;
      critBonus += m.backstabCrit;
      back = true;
    }
  }
  if (spec.tags?.includes('precise')) critBonus += cb.preciseCrit;
  if (spec.execute && tgt.hp / tgt.stats.maxHp * 100 <= spec.execute.below) mul *= spec.execute.mul;
  return { mul, critBonus, sweet, back };
}

/** 当たったあとの武器の処理（コンボを数える） */
export function weaponOnHit(w: World, src: Player, spec: HitSpec) {
  const m = mechanicOf(w, src);
  if (m.type === 'combo' && spec.kind !== 'dot') {
    src.combo = Math.min(comboMax(w, src), src.combo + 1);
    src.comboUntil = w.tick + sec(w, m.window);
  }
}

function fire(w: World, p: Player, atk: AttackDef & { interval: number }, aim: Aim, mul: { power?: number; breakMul?: number; rangeMul?: number } = {}) {
  const wdef = weaponDef(w, p);
  const rangeMul = (1 + (p.stats.m.rangePct ?? 0) / 100) * (mul.rangeMul ?? 1);
  p.facing = aim.dir;
  p.attackCd = Math.max(1, Math.round(sec(w, atk.interval) / p.stats.aspd));
  p.lock = sec(w, atk.lock ?? 0);
  const spec = buildSpec(p, atk, 'normal', 1, wdef.damageType);
  spec.power *= mul.power ?? 1;
  spec.breakPower *= mul.breakMul ?? 1;
  launchAttack(w, p, atk, aim.dir, aim.target, spec, { mpGain: wdef.attack.mpGain, rangeMul });
}

/** 通常攻撃（毎tick、行動できるときに呼ぶ） */
export function updateNormalAttack(w: World, p: Player, input: PlayerInput, aimFor: (range: number) => Aim) {
  const wdef = weaponDef(w, p);
  if (!wdef) return;
  const m = wdef.mechanic;
  const rangeMul = 1 + (p.stats.m.rangePct ?? 0) / 100;

  if (m.type === 'charge') {
    if (p.attackCd > 0) { if (!input.attack) p.charge = 0; return; }
    if (input.attack) { p.charge++; return; }
    if (p.prevAttack && p.charge > 0) {
      const lvl = chargeLevel(w, p);
      const aim = aimFor((wdef.attack.range ?? 2) * rangeMul);
      if (lvl === 0) fire(w, p, wdef.attack, aim);
      else {
        const big: AttackDef & { interval: number } = {
          ...wdef.attack,
          shape: { type: 'arc', range: (wdef.attack.range ?? 2.2) * (1 + 0.12 * lvl), arc: lvl >= 2 ? 200 : 170 },
          lock: (wdef.attack.lock ?? 0.2) + 0.1 * lvl,
        };
        fire(w, p, big, aim, { power: m.powerMul[lvl - 1], breakMul: m.breakMul[lvl - 1] });
      }
      w.events.push({ type: 'attack', src: p.id, dir: aim.dir, skill: null, weapon: weaponTypeOf(p.char), charge: lvl });
      p.charge = 0;
    }
    return;
  }

  if (m.type === 'rhythm') {
    const pressed = input.attack && !p.prevAttack;
    if (!pressed || p.attackCd > 0) return;
    const on = isOnBeat(w, m, w.tick);
    p.rhythm = on ? Math.min(m.maxStacks, p.rhythm + 1) : Math.max(0, p.rhythm - m.missLoss);
    w.events.push({ type: 'rhythm', playerId: p.id, onBeat: on, stacks: p.rhythm });
    const aim = aimFor((wdef.attack.range ?? 7) * rangeMul);
    fire(w, p, wdef.attack, aim, { power: on ? m.perfectMul : 1 });
    w.events.push({ type: 'attack', src: p.id, dir: aim.dir, skill: null, weapon: weaponTypeOf(p.char) });
    return;
  }

  if (!input.attack || p.attackCd > 0) return;
  if (m.type === 'ammo') {
    if (p.reloadTicks > 0) return;
    if (p.ammo <= 0) { startReload(w, p); return; }
  }

  let atk = wdef.attack;
  if (wdef.chain && wdef.chain.length > 0) {
    if (w.tick > p.chainUntil) p.chainIndex = 0;
    const step = p.chainIndex % (wdef.chain.length + 1);
    if (step > 0) atk = { ...wdef.attack, ...wdef.chain[step - 1] };
    p.chainIndex = step + 1;
    p.chainUntil = w.tick + sec(w, atk.interval * 2.5);
  }
  const aim = aimFor((atk.range ?? 2) * rangeMul);
  fire(w, p, atk, aim);
  if (m.type === 'ammo') {
    p.ammo--;
    if (p.ammo <= 0) startReload(w, p);
  }
  w.events.push({ type: 'attack', src: p.id, dir: aim.dir, skill: null, weapon: weaponTypeOf(p.char) });
}
