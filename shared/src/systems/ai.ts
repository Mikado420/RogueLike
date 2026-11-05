import { DIFFICULTIES, type Difficulty } from '../core';
import type { MonsterAttackDef } from '../content/types';
import type { Actor, Monster, World } from '../state';
import { lineOfSight, moveCircle } from '../map';
import { buildSpec, launchAttack } from './combat';
import { cannotAct, regenPoise } from './status';
import { monsterStats } from './stats';
import { DT, findActor, isBoss, sec } from './util';
import { bossHooks } from './boss';

const diffRank = (d: Difficulty) => DIFFICULTIES.indexOf(d);

export function refreshMonsterStats(w: World, m: Monster) {
  const def = w.content.monsters[m.defId];
  const hpRatio = m.stats.maxHp > 0 ? m.hp / m.stats.maxHp : 1;
  const prevMax = m.stats.maxHp;
  m.stats = monsterStats(def, m.level, w.content, m.scale, m.statuses);
  if (prevMax !== m.stats.maxHp) m.hp = Math.round(m.stats.maxHp * hpRatio);
  m.statsDirty = false;
}

/** 狙う相手（プレイヤー。ほかに狙うものができたらここで選ぶ） */
function targetOf(w: World, m: Monster): Actor | null {
  const p = w.players.find((x) => x.id === m.targetId && !x.dead);
  return p ?? null;
}

export function updateMonster(w: World, m: Monster) {
  if (m.dead) return;
  const c = w.content;
  const def = c.monsters[m.defId];
  const mb = c.balance.monster;
  if (m.statsDirty) refreshMonsterStats(w, m);
  m.moving = false;
  for (const k in m.cds) if (m.cds[k] > 0) m.cds[k]--;
  if (m.globalCd > 0) m.globalCd--;
  regenPoise(w, m);
  if (m.stagger > 0) m.stagger--;

  if (def.boss && !m.enraged && m.hp / m.stats.maxHp < mb.enrageThreshold) {
    m.enraged = true;
    w.events.push({ type: 'enrage', id: m.id });
  }
  bossHooks.update(w, m);

  if (cannotAct(w, m)) return;

  if (m.pending) {
    if (--m.pending.ticks <= 0) {
      const pa = m.pending.attack;
      const tgt = findActor(w, m.targetId) ?? null;
      const dir = tgt && !tgt.dead ? Math.atan2(tgt.y - m.y, tgt.x - m.x) : m.pending.dir;
      launchAttack(w, m, pa, dir, tgt, buildSpec(m, pa, 'monster', 1, pa.damageType ?? 'physical'));
      m.pending = null;
    }
  }
  if (m.busy > 0) { m.busy--; return; }

  const distHome = Math.hypot(m.x - m.homeX, m.y - m.homeY);

  if (m.ai === 'wander') {
    for (const p of w.players) {
      if (p.dead) continue;
      if (Math.hypot(p.x - m.x, p.y - m.y) <= def.aggroRange && lineOfSight(w.area.map, m.x, m.y, p.x, p.y)) {
        m.ai = 'chase'; m.targetId = p.id; break;
      }
    }
    if (m.ai === 'wander') {
      if (--m.timer <= 0) {
        const ang = w.rng.range(0, Math.PI * 2), rr = w.rng.range(0, mb.wanderRadius);
        m.wanderX = m.homeX + Math.cos(ang) * rr; m.wanderY = m.homeY + Math.sin(ang) * rr;
        m.timer = sec(w, w.rng.range(2, 4.5));
      }
      moveToward(w, m, m.wanderX, m.wanderY, m.stats.moveSpeed * mb.wanderSpeedRatio, 0.2);
      return;
    }
  }

  if (m.ai === 'chase') {
    const target = targetOf(w, m);
    if (!target || distHome > def.leashRange) { m.ai = 'return'; m.targetId = -1; return; }
    const d = Math.hypot(target.x - m.x, target.y - m.y);
    const dir = Math.atan2(target.y - m.y, target.x - m.x);
    m.facing = dir;
    if (m.globalCd <= 0) {
      const usable = def.attacks.filter((a) => attackUsable(m, a) && d - target.r <= a.range && d >= (a.minRange ?? 0));
      if (usable.length > 0) {
        const weights: Record<string, number> = {};
        for (const a of usable) weights[a.id] = a.weight;
        const pick = w.rng.weighted(weights);
        const a = usable.find((x) => x.id === pick)!;
        startAttack(w, m, a, dir, target);
        return;
      }
    }
    const keep = def.keepDistance ?? 0;
    const speed = m.stats.moveSpeed * bossHooks.speedMul(w, m);
    if (keep > 0 && d < keep - 0.5) moveToward(w, m, m.x - Math.cos(dir), m.y - Math.sin(dir), speed * 0.7, 0);
    else if (d > Math.max(keep, m.r + target.r + 0.3)) moveToward(w, m, target.x, target.y, speed, 0);
    return;
  }

  if (m.ai === 'return') {
    m.hp = Math.min(m.stats.maxHp, m.hp + m.stats.maxHp * mb.hpRegenOnReturn * DT(w) * 4);
    if (distHome < 0.5) {
      m.ai = 'wander'; m.timer = 0; m.hp = m.stats.maxHp; m.enraged = false; m.damageBy = {};
      return;
    }
    moveToward(w, m, m.homeX, m.homeY, m.stats.moveSpeed * 1.3, 0.3);
  }
}

function attackUsable(m: Monster, a: MonsterAttackDef): boolean {
  if ((m.cds[a.id] ?? 0) > 0) return false;
  if (a.minDifficulty && diffRank(m.difficulty) < diffRank(a.minDifficulty)) return false;
  if (a.phase !== undefined && m.phase < a.phase) return false;
  return true;
}

export function startAttack(w: World, m: Monster, a: MonsterAttackDef, dir: number, target: Actor) {
  const mb = w.content.balance.monster;
  const cdRatio = m.enraged ? mb.enrageCooldownRatio : 1;
  const def = w.content.monsters[m.defId];
  m.cds[a.id] = sec(w, a.cooldown * cdRatio);
  m.globalCd = sec(w, def.attackInterval * cdRatio);
  const windup = sec(w, a.windup * (m.enraged ? 0.85 : 1));
  if (a.delivery === 'strike') {
    launchAttack(w, m, a, dir, target, buildSpec(m, a, 'monster', 1, a.damageType ?? 'physical'), { delay: windup });
  } else {
    m.pending = { attack: a, dir, ticks: windup };
  }
  m.busy = windup + sec(w, mb.recovery);
  w.events.push({ type: 'attack', src: m.id, dir, skill: a.id, weapon: null });
}

export function moveToward(w: World, m: Monster, tx: number, ty: number, speed: number, stopDist: number) {
  const dx = tx - m.x, dy = ty - m.y;
  const d = Math.hypot(dx, dy);
  if (d <= stopDist || d < 1e-4) return;
  const v = Math.min(d, speed * DT(w));
  if (v <= 0) return;
  m.facing = Math.atan2(dy, dx);
  let moved = moveCircle(w.area.map, m, m.r, (dx / d) * v, (dy / d) * v);
  if (!moved) {
    const side = (m.id % 2 === 0 ? 1 : -1) * Math.PI / 2;
    const a = Math.atan2(dy, dx) + side;
    moved = moveCircle(w.area.map, m, m.r, Math.cos(a) * v, Math.sin(a) * v);
  }
  m.moving = moved;
}

/** 生きているキャラ同士が重ならないよう少し押し合う */
export function separateActors(w: World) {
  const all: Actor[] = [...w.players.filter((p) => !p.dead), ...w.area.monsters.filter((m) => !m.dead)];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy), min = a.r + b.r;
      if (d >= min || d < 1e-6) continue;
      const push = (min - d) / 2;
      const nx = dx / d, ny = dy / d;
      const aw = isBoss(w, a) ? 0 : 1;
      const bw = isBoss(w, b) ? 0 : 1;
      if (aw + bw === 0) continue;
      const ra = aw / (aw + bw), rb = bw / (aw + bw);
      moveCircle(w.area.map, a, a.r, -nx * push * 2 * ra, -ny * push * 2 * ra);
      moveCircle(w.area.map, b, b.r, nx * push * 2 * rb, ny * push * 2 * rb);
    }
  }
}
