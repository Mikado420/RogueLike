import type { Player, PlayerInput, World } from '../state';
import { moveCircle } from '../map';
import { derivePlayerStats } from './stats';
import { cannotAct } from './status';
import { castSkill, slotSkill, type Aim } from './skills';
import { updateNormalAttack, updateWeaponTimers, weaponDef } from './weapons';
import { applyCommand } from './commands';
import { heal } from './combat';
import { interact } from './interact';
import { exitAt } from './world';
import { conditionalMods, procOnDodge } from './effects';
import { baseMods } from './base';
import { petMods } from './pets';
import { addMods } from '../core';
import { DT, nearestMonster, sec } from './util';

export function refreshPlayerStats(w: World, p: Player) {
  const ratioHp = p.stats.maxHp > 0 ? p.hp / p.stats.maxHp : 1;
  const oldMax = p.stats.maxHp;
  const cond = conditionalMods(w, p);
  p.condKey = cond.key;
  const extra = { ...cond.mods };
  addMods(extra, baseMods(p.account, w.content, w.clock));
  addMods(extra, petMods(w, p));
  p.stats = derivePlayerStats(p.char, p.statuses, w.content, extra);
  if (p.stats.maxHp !== oldMax && oldMax > 0) p.hp = Math.min(p.stats.maxHp, Math.max(1, Math.round(p.stats.maxHp * ratioHp)));
  p.hp = Math.min(p.hp, p.stats.maxHp);
  p.mp = Math.min(p.mp, p.stats.maxMp);
  p.st = Math.min(p.st, p.stats.maxSt);
  p.statsDirty = false;
}

export function updatePlayer(w: World, p: Player, input: PlayerInput) {
  const c = w.content, pb = c.balance.player;
  for (const cmd of input.commands) applyCommand(w, p, cmd);
  if (!p.dead && conditionalMods(w, p).key !== p.condKey) p.statsDirty = true;
  if (p.statsDirty) refreshPlayerStats(w, p);

  if (p.dead) {
    if (--p.respawnTicks <= 0) respawnPlayer(w, p);
    return;
  }

  updateWeaponTimers(w, p);
  if (p.attackCd > 0) p.attackCd--;
  for (const k in p.skillCd) if (p.skillCd[k] > 0) p.skillCd[k]--;
  if (p.lock > 0) p.lock--;
  if (p.iframes > 0) p.iframes--;
  if (p.stagger > 0) p.stagger--;
  if (p.stDelay > 0) p.stDelay--;
  else p.st = Math.min(p.stats.maxSt, p.st + pb.staminaRegen * (1 + (p.stats.m.staRegenPct ?? 0) / 100) * DT(w));

  // 自然回復（戦闘から離れていると HP が戻る）
  const outOfCombat = w.tick - p.lastCombatTick > sec(w, pb.combatTimeout);
  let regen = (p.stats.m.hpRegen ?? 0) * DT(w);
  if (outOfCombat) regen += (p.stats.maxHp * pb.hpRegenOutOfCombat) / 100 * DT(w);
  if (regen > 0 && p.hp < p.stats.maxHp) {
    p.regenAcc += regen;
    if (p.regenAcc >= 1) { const n = Math.floor(p.regenAcc); p.regenAcc -= n; heal(w, p, n, true); }
  }
  const mpRegen = (p.stats.m.mpRegen ?? 0) + (outOfCombat ? pb.mpRegenOutOfCombat : 0);
  if (mpRegen > 0) p.mp = Math.min(p.stats.maxMp, p.mp + mpRegen * DT(w));

  let mx = input.move.x, my = input.move.y;
  const ml = Math.hypot(mx, my);
  if (ml > 1) { mx /= ml; my /= ml; }
  const stunned = cannotAct(w, p);

  // 回避
  if (input.dodge && !stunned && p.dodgeTicks <= 0) {
    const wd = weaponDef(w, p)?.dodge ?? {};
    const cost = pb.dodgeCost * (wd.costMul ?? 1) * Math.max(0.2, 1 + (p.stats.m.dodgeCostPct ?? 0) / 100);
    if (p.st >= cost) {
      p.st -= cost;
      p.stDelay = sec(w, pb.staminaRegenDelay);
      p.dodgeTicks = sec(w, pb.dodgeDuration);
      p.dashSpeed = pb.dodgeSpeed * (wd.speedMul ?? 1);
      p.iframes = Math.max(p.iframes, Math.round(sec(w, pb.dodgeIframes) * (wd.iframesMul ?? 1)));
      p.lock = 0;
      p.charge = 0;
      p.lastDodgeTick = w.tick;
      const l = Math.hypot(mx, my);
      const d = l > 0.1 ? { x: mx / l, y: my / l } : { x: Math.cos(p.facing), y: Math.sin(p.facing) };
      p.dodgeDir = d;
      p.facing = Math.atan2(d.y, d.x);
      w.events.push({ type: 'dodge', id: p.id });
      procOnDodge(w, p);
    }
  }

  if (p.dodgeTicks > 0) {
    p.dodgeTicks--;
    const v = p.dashSpeed * DT(w);
    moveCircle(w.area.map, p, p.r, p.dodgeDir.x * v, p.dodgeDir.y * v);
    p.moving = true;
    p.prevAttack = input.attack;
    return;
  }

  p.moving = false;
  if (!stunned) {
    const speed = p.lock > 0 ? 0 : p.stats.moveSpeed * (p.charge > sec(w, c.balance.combat.chargeMinMove) ? chargeMoveMul(w, p) : 1);
    if (ml > 0.05 && speed > 0) {
      const v = speed * DT(w);
      p.moving = moveCircle(w.area.map, p, p.r, mx * v, my * v);
      p.facing = Math.atan2(my, mx);
    }
  }

  // 出口に入ったらエリアを移る
  const ex = exitAt(w, p.x, p.y);
  if (ex && w.content.areas[ex.to] && !p.transition) p.transition = { to: ex.to, spawn: ex.spawn };

  if (input.interact && !stunned) interact(w, p);

  if (stunned || p.lock > 0) { p.prevAttack = input.attack; return; }

  const aimFor = (range: number): Aim => {
    if (input.aim && Math.hypot(input.aim.x, input.aim.y) > 0.01) return { dir: Math.atan2(input.aim.y, input.aim.x), target: null };
    const t = nearestMonster(w, p.x, p.y, Math.max(range + 1, pb.autoTargetRange), (m) => !m.hidden);
    if (t) return { dir: Math.atan2(t.y - p.y, t.x - p.x), target: t };
    return { dir: p.facing, target: null };
  };

  if (input.skill >= 0) {
    const id = slotSkill(w, p, input.skill);
    if (id && castSkill(w, p, id, aimFor)) { p.prevAttack = input.attack; return; }
  }
  updateNormalAttack(w, p, input, aimFor);
  p.prevAttack = input.attack;
}

function chargeMoveMul(w: World, p: Player): number {
  const m = weaponDef(w, p)?.mechanic;
  return m?.type === 'charge' ? m.moveMul : 1;
}

export function respawnPlayer(w: World, p: Player) {
  p.dead = false;
  p.statsDirty = true;
  refreshPlayerStats(w, p);
  p.hp = p.stats.maxHp;
  p.st = p.stats.maxSt;
  p.mp = 0;
  p.x = w.area.playerSpawn.x;
  p.y = w.area.playerSpawn.y;
  p.iframes = sec(w, 1.5);
  p.statuses = [];
  w.events.push({ type: 'respawn', id: p.id });
}
