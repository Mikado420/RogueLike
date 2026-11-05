import type { SkillDef, WeaponDef } from '../content/types';
import type { PlayerInput, Player, World } from '../state';
import { buildSpec, launchAttack } from './combat';
import { weaponTypeOf } from './stats';
import type { Aim } from './skills';
import { sec } from './util';

/**
 * 武器ごとの仕組み（通常攻撃・溜め・弾数・コンボ・リズムなど）。
 * スキルの前後に割り込む skillHooks もここに置く。
 */
export const skillHooks = {
  /** false を返すと使えない。倍率を返すと威力・バフに掛ける */
  before(_w: World, _p: Player, _d: SkillDef, _lv: number): false | { power: number; buff: number } | void {
    return undefined;
  },
  after(_w: World, _p: Player, _d: SkillDef, _lv: number): void {},
};

export function weaponDef(w: World, p: Player): WeaponDef {
  return w.content.weapons[weaponTypeOf(p.char)];
}

/** 通常攻撃（毎tick、行動できるときに呼ぶ） */
export function updateNormalAttack(w: World, p: Player, input: PlayerInput, aimFor: (range: number) => Aim) {
  const wdef = weaponDef(w, p);
  if (!wdef) return;
  if (!input.attack || p.attackCd > 0) return;
  let atk = wdef.attack;
  let interval = atk.interval;
  // 連撃（chain がある武器は段を進める）
  if (wdef.chain && wdef.chain.length > 0) {
    if (w.tick > p.chainUntil) p.chainIndex = 0;
    const step = p.chainIndex % (wdef.chain.length + 1);
    if (step > 0) { atk = { ...wdef.attack, ...wdef.chain[step - 1] }; interval = wdef.chain[step - 1].interval; }
    p.chainIndex = step + 1;
    p.chainUntil = w.tick + sec(w, interval * 2.5);
  }
  const rangeMul = 1 + (p.stats.m.rangePct ?? 0) / 100;
  const a = aimFor((atk.range ?? 2) * rangeMul);
  p.facing = a.dir;
  p.attackCd = Math.max(1, Math.round(sec(w, interval) / p.stats.aspd));
  p.lock = sec(w, atk.lock ?? 0);
  const spec = buildSpec(p, atk, 'normal', 1, wdef.damageType);
  launchAttack(w, p, atk, a.dir, a.target, spec, { mpGain: wdef.attack.mpGain, rangeMul });
  w.events.push({ type: 'attack', src: p.id, dir: a.dir, skill: null, weapon: weaponTypeOf(p.char) });
}
