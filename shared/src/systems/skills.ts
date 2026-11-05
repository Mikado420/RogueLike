import { scaled } from '../core';
import type { SkillDef } from '../content/types';
import type { Actor, Player, World } from '../state';
import { buildSpec, heal, launchAttack } from './combat';
import { applyStatus, cleanse } from './status';
import { slotsFor } from './progression';
import { weaponTypeOf } from './stats';
import { sec } from './util';
import { skillHooks } from './weapons';

export function skillMpCost(p: Player, d: SkillDef, lv: number): number {
  return Math.max(0, Math.round(scaled(d.mp, lv) * (1 + (p.stats.m.mpCostPct ?? 0) / 100)));
}

export function skillCooldownTicks(w: World, p: Player, d: SkillDef, lv: number): number {
  const s = scaled(d.cooldown, lv, 1) * Math.max(0.2, 1 + (p.stats.m.cooldownPct ?? 0) / 100);
  return Math.max(1, sec(w, s));
}

/** スキル枠に入っているスキル（今の武器で使えないものは null） */
export function slotSkill(w: World, p: Player, slot: number): string | null {
  const wt = weaponTypeOf(p.char);
  const id = slotsFor(p.char, wt, w.content)[slot] ?? null;
  if (!id) return null;
  const d = w.content.skills[id];
  if (!d || d.type !== 'active' || !p.char.skills[id]) return null;
  if (d.weapon && d.weapon !== wt) return null;
  return id;
}

export type Aim = { dir: number; target: Actor | null };

/** スキルを使う。使えたら true */
export function castSkill(w: World, p: Player, id: string, aimFor: (range: number) => Aim): boolean {
  const c = w.content;
  const d = c.skills[id];
  const lv = p.char.skills[id] ?? 0;
  if (!d || lv <= 0) return false;
  if ((p.skillCd[id] ?? 0) > 0) return false;
  const mp = skillMpCost(p, d, lv);
  if (p.mp < mp) return false;
  const hook = skillHooks.before(w, p, d, lv);
  if (hook === false) return false;

  p.mp -= mp;
  const cd = skillCooldownTicks(w, p, d, lv);
  p.skillCd[id] = cd;
  p.skillCdMax[id] = cd;
  const range = (d.attack?.range ?? d.attacks?.[0]?.range ?? 3) * (1 + (p.stats.m.rangePct ?? 0) / 100);
  const a = aimFor(range);
  p.facing = a.dir;
  p.lock = Math.max(1, Math.round(sec(w, d.lock ?? 0.2) / p.stats.cspd));
  p.attackCd = Math.max(p.attackCd, p.lock);
  const wdef = c.weapons[weaponTypeOf(p.char)];
  const dmgType = d.weapon ? wdef.damageType : 'magic';

  if (d.dash) {
    const dir = d.dash.distance >= 0 ? a.dir : a.dir + Math.PI;
    let dist = Math.abs(d.dash.distance);
    if (d.dash.toTarget && a.target) dist = Math.min(dist, Math.max(0, Math.hypot(a.target.x - p.x, a.target.y - p.y) - a.target.r - p.r - 0.3));
    p.dodgeDir = { x: Math.cos(dir), y: Math.sin(dir) };
    p.dashSpeed = d.dash.speed;
    p.dodgeTicks = Math.max(1, Math.round(sec(w, dist / d.dash.speed)));
    if (d.dash.iframes) p.iframes = Math.max(p.iframes, sec(w, d.dash.iframes));
  }
  const mul = hook && typeof hook === 'object' ? hook : { power: 1, buff: 1 };
  if (d.buff) {
    const mods: Record<string, number> = {};
    for (const [k, v] of Object.entries(d.buff.mods)) mods[k] = scaled(v, lv) * mul.buff;
    applyStatus(w, p, p.id, d.buff.status, scaled(d.buff.duration, lv), { mods });
    p.statsDirty = true;
  }
  if (d.cleanse) cleanse(w, p);
  if (d.heal) {
    const base = d.heal.base === 'matk' ? p.stats.matk : p.stats.maxHp;
    heal(w, p, base * scaled(d.heal.power, lv) * mul.buff);
  }
  const attacks = d.attacks ?? (d.attack ? [d.attack] : []);
  for (const atk of attacks) {
    const spec = buildSpec(p, atk, 'skill', lv, dmgType, id);
    spec.power *= mul.power;
    launchAttack(w, p, atk, a.dir, a.target, spec, { rangeMul: 1 + (p.stats.m.rangePct ?? 0) / 100 });
  }
  skillHooks.after(w, p, d, lv);
  w.events.push({ type: 'attack', src: p.id, dir: a.dir, skill: id, weapon: weaponTypeOf(p.char) });
  return true;
}
