import { angleDiff, scaled, type DamageType, type Element, type Shape } from '../core';
import type { AttackDef } from '../content/types';
import type { Actor, HitSpec, Monster, Player, Projectile, Strike, World } from '../state';
import { computeDamage } from '../damage';
import { isSolid, moveCircle } from '../map';
import { addBreak, applyStatus, dmgTakenPct, missChance } from './status';
import { DT, findActor, isBoss, newId, sec } from './util';
import { onMonsterKilled, onPlayerKilled } from './rewards';
import { procOnHit, tryCheatDeath } from './effects';
import { weaponHitMods, weaponOnHit } from './weapons';
import { envElementMul } from './weather';

/** 攻撃定義と使い手から命中仕様を作る */
export function buildSpec(
  owner: Actor, def: AttackDef, kind: HitSpec['kind'], level: number, defaultType: DamageType, skillId: string | null = null,
): HitSpec {
  return {
    power: scaled(def.power, level),
    element: resolveElement(owner, def.element),
    damageType: def.damageType ?? defaultType,
    kind,
    breakPower: def.breakPower ?? 1,
    status: def.status,
    statusLevel: level,
    lifesteal: def.lifesteal,
    skillId,
    execute: def.execute,
    knockback: def.knockback,
    tags: def.tags,
  };
}

export function resolveElement(owner: Actor, el: AttackDef['element']): Element {
  if (!el || el === 'weapon') return owner.stats.element;
  return el;
}

export interface LaunchOpts {
  mpGain?: number;
  /** strike の発生までの tick（指定がなければ def.delay） */
  delay?: number;
  /** 射程の倍率 */
  rangeMul?: number;
  /** 照準点（aim の位置を直接指定） */
  point?: { x: number; y: number } | null;
}

/** 攻撃定義から strike / projectile を作る（プレイヤーとモンスターで共通） */
export function launchAttack(w: World, owner: Actor, def: AttackDef, dir: number, target: Actor | null, spec: HitSpec, opts: LaunchOpts = {}) {
  const combo = newId(w);
  const rangeMul = opts.rangeMul ?? 1;
  const area = w.area;
  if (def.delivery === 'strike') {
    if (def.shape && (def.shape.type === 'arc' || def.shape.type === 'line') && spec.reach === undefined) spec.reach = def.shape.range * rangeMul;
    const count = def.count ?? 1;
    const hits = def.hits ?? 1;
    const delay = opts.delay ?? sec(w, def.delay ?? 0);
    for (let n = 0; n < count; n++) {
      let x = owner.x, y = owner.y;
      if (def.anchor === 'aim') {
        if (opts.point) { x = opts.point.x; y = opts.point.y; }
        else if (target) { x = target.x; y = target.y; }
        else {
          const d = (def.aimDistance ?? 4) * rangeMul;
          x += Math.cos(dir) * d; y += Math.sin(dir) * d;
        }
      } else if (def.anchor === 'target' && target) {
        x = target.x; y = target.y;
      } else if (def.anchor === 'front') {
        x += Math.cos(dir) * (def.offset ?? 1); y += Math.sin(dir) * (def.offset ?? 1);
      }
      if (n > 0 && def.scatter) {
        const ang = w.rng.range(0, Math.PI * 2), rr = w.rng.range(def.scatter * 0.4, def.scatter);
        x += Math.cos(ang) * rr; y += Math.sin(ang) * rr;
      }
      area.strikes.push({
        id: newId(w), ownerId: owner.id, team: owner.team, x, y, dir,
        shape: scaleShape(def.shape ?? { type: 'circle', radius: 1 }, def.anchor === 'self' || def.anchor === 'front' ? rangeMul : 1),
        follow: !!def.follow,
        startTick: w.tick, nextTick: w.tick + delay, hitsLeft: hits, hitCount: hits * count,
        interval: Math.max(1, sec(w, def.interval ?? 0.1)), spec,
        telegraph: !!def.telegraph, combo, mpGain: opts.mpGain ?? 0,
      });
    }
  } else if (def.projectile) {
    const pd = def.projectile;
    const spreadRad = (pd.spread * Math.PI) / 180;
    const full = pd.spread >= 360;
    for (let n = 0; n < pd.count; n++) {
      const a = pd.count > 1
        ? (full ? dir + (Math.PI * 2 * n) / pd.count : dir - spreadRad / 2 + (spreadRad * n) / (pd.count - 1))
        : dir;
      const spd = pd.speed * DT(w);
      area.projectiles.push({
        id: newId(w), ownerId: owner.id, team: owner.team,
        x: owner.x + Math.cos(a) * owner.r, y: owner.y + Math.sin(a) * owner.r,
        vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, r: pd.radius,
        ticksLeft: Math.ceil((pd.range * rangeMul) / spd), pierce: pd.pierce, hitIds: [],
        spec, combo, hitCount: pd.count, explodeRadius: pd.explodeRadius ?? 0, sprite: pd.sprite,
        mpGain: opts.mpGain ?? 0, homing: pd.homing ?? 0,
      });
    }
  }
}

function scaleShape(s: Shape, k: number): Shape {
  if (k === 1) return s;
  switch (s.type) {
    case 'circle': return { type: 'circle', radius: s.radius * k };
    case 'arc': return { ...s, range: s.range * k };
    case 'line': return { ...s, range: s.range * k };
    case 'ring': return s;
  }
}

export function inShape(sx: number, sy: number, dir: number, shape: Shape, t: { x: number; y: number; r: number }): boolean {
  const dx = t.x - sx, dy = t.y - sy;
  const d = Math.hypot(dx, dy);
  switch (shape.type) {
    case 'circle': return d <= shape.radius + t.r;
    case 'ring': return d >= shape.inner - t.r && d <= shape.outer + t.r;
    case 'line': {
      const along = dx * Math.cos(dir) + dy * Math.sin(dir);
      const perp = Math.abs(-dx * Math.sin(dir) + dy * Math.cos(dir));
      return along >= -t.r && along <= shape.range + t.r && perp <= shape.width / 2 + t.r;
    }
    case 'arc': {
      if (d > shape.range + t.r) return false;
      if (d < t.r + 0.25) return true;
      const half = (shape.arc * Math.PI) / 360 + Math.asin(Math.min(1, t.r / d));
      return Math.abs(angleDiff(Math.atan2(dy, dx), dir)) <= half;
    }
  }
}

export function enemiesOf(w: World, team: 0 | 1): Actor[] {
  return team === 0 ? w.area.monsters.filter((m) => !m.dead) : w.players.filter((p) => !p.dead);
}

function grantMp(owner: Actor, amount: number) {
  if (owner.kind !== 'player' || amount <= 0) return;
  owner.mp = Math.min(owner.stats.maxMp, owner.mp + amount + (owner.stats.m.mpOnHit ?? 0));
}

export function updateStrikes(w: World) {
  const keep: Strike[] = [];
  for (const s of w.area.strikes) {
    const owner = findActor(w, s.ownerId);
    if (s.follow && owner && !owner.dead) { s.x = owner.x; s.y = owner.y; }
    if (w.tick < s.nextTick) { keep.push(s); continue; }
    if (s.team === 1 && (!owner || owner.dead)) continue;
    w.events.push({ type: 'impact', src: s.ownerId, x: s.x, y: s.y, dir: s.dir, shape: s.shape, element: s.spec.element, team: s.team });
    let hitAny = false;
    if (owner) {
      for (const t of enemiesOf(w, s.team)) {
        if (!inShape(s.x, s.y, s.dir, s.shape, t)) continue;
        hitAny = applyHit(w, owner, t, s.spec, s.combo, s.hitCount) || hitAny;
      }
    }
    if (hitAny && s.mpGain > 0 && owner) { grantMp(owner, s.mpGain); s.mpGain = 0; }
    s.hitsLeft--;
    if (s.hitsLeft > 0) { s.nextTick = w.tick + s.interval; keep.push(s); }
  }
  w.area.strikes = keep;
}

function projectileBlocked(w: World, x: number, y: number): boolean {
  const m = w.area.map;
  const i = Math.floor(x), j = Math.floor(y);
  if (i < 0 || j < 0 || i >= m.width || j >= m.height) return true;
  return isSolid(m, i, j) && m.sprites[j * m.width + i] !== null;
}

export function updateProjectiles(w: World) {
  const keep: Projectile[] = [];
  for (const pr of w.area.projectiles) {
    if (pr.homing > 0) steer(w, pr);
    pr.x += pr.vx; pr.y += pr.vy; pr.ticksLeft--;
    let alive = pr.ticksLeft > 0;
    const owner = findActor(w, pr.ownerId);
    if (projectileBlocked(w, pr.x, pr.y)) {
      alive = false;
      if (pr.explodeRadius > 0 && owner) explode(w, owner, pr);
    } else {
      for (const t of enemiesOf(w, pr.team)) {
        if (pr.hitIds.includes(t.id)) continue;
        if (Math.hypot(t.x - pr.x, t.y - pr.y) > t.r + pr.r) continue;
        pr.hitIds.push(t.id);
        if (owner) {
          if (pr.explodeRadius > 0) { explode(w, owner, pr); alive = false; break; }
          const hit = applyHit(w, owner, t, pr.spec, pr.combo, pr.hitCount);
          if (hit && pr.mpGain > 0) { grantMp(owner, pr.mpGain); pr.mpGain = 0; }
        }
        if (--pr.pierce <= 0) { alive = false; break; }
      }
    }
    if (alive) keep.push(pr);
  }
  w.area.projectiles = keep;
}

function steer(w: World, pr: Projectile) {
  let best: Actor | null = null, bd = 6;
  for (const t of enemiesOf(w, pr.team)) {
    if (pr.hitIds.includes(t.id)) continue;
    const d = Math.hypot(t.x - pr.x, t.y - pr.y);
    if (d < bd) { bd = d; best = t; }
  }
  if (!best) return;
  const spd = Math.hypot(pr.vx, pr.vy);
  const cur = Math.atan2(pr.vy, pr.vx);
  const want = Math.atan2(best.y - pr.y, best.x - pr.x);
  const a = cur + angleDiff(want, cur) * pr.homing;
  pr.vx = Math.cos(a) * spd; pr.vy = Math.sin(a) * spd;
}

function explode(w: World, owner: Actor, pr: Projectile) {
  w.events.push({ type: 'explode', x: pr.x, y: pr.y, radius: pr.explodeRadius, element: pr.spec.element });
  let hitAny = false;
  for (const t of enemiesOf(w, pr.team)) {
    if (Math.hypot(t.x - pr.x, t.y - pr.y) <= pr.explodeRadius + t.r) hitAny = applyHit(w, owner, t, pr.spec, pr.combo, 1) || hitAny;
  }
  if (hitAny && pr.mpGain > 0) { grantMp(owner, pr.mpGain); pr.mpGain = 0; }
}

/** 命中処理。当たったら true（回避・ミスなら false） */
export function applyHit(w: World, src: Actor, tgt: Actor, spec: HitSpec, combo: number, cnt: number): boolean {
  if (tgt.dead || src.team === tgt.team) return false;
  const c = w.content;
  if (tgt.kind === 'player') {
    if (tgt.iframes > 0) { w.events.push({ type: 'evade', tgt: tgt.id, x: tgt.x, y: tgt.y }); return false; }
    if (spec.kind !== 'dot' && tgt.stats.evasion > 0 && w.rng.next() * 100 < tgt.stats.evasion) {
      w.events.push({ type: 'evade', tgt: tgt.id, x: tgt.x, y: tgt.y });
      return false;
    }
  }
  if (tgt.kind === 'monster' && tgt.shielded) {
    w.events.push({ type: 'evade', tgt: tgt.id, x: tgt.x, y: tgt.y, block: true });
    return false;
  }
  const miss = missChance(w, src);
  if (spec.kind !== 'dot' && miss > 0 && w.rng.next() * 100 < miss) {
    w.events.push({ type: 'evade', tgt: tgt.id, x: tgt.x, y: tgt.y });
    return false;
  }
  let bonus = spec.bonusMul ?? 1;
  let critBonus = spec.critBonus ?? 0;
  let sweet = false, back = false;
  if (src.kind === 'player') {
    const wm = weaponHitMods(w, src, tgt, spec);
    bonus *= wm.mul; critBonus += wm.critBonus; sweet = wm.sweet; back = wm.back;
  }
  if (isBoss(w, tgt)) bonus *= 1 + (src.stats.m.bossDmgPct ?? 0) / 100;
  bonus *= envElementMul(w, spec.element);
  bonus *= 1 + dmgTakenPct(w, tgt) / 100;
  if (tgt.kind === 'player' && spec.kind === 'monster') {
    const br = tgt.stats.m.blockRate ?? 0;
    if (br > 0 && w.rng.next() * 100 < br) {
      bonus *= 1 - c.balance.player.blockReduce / 100;
      w.events.push({ type: 'evade', tgt: tgt.id, x: tgt.x, y: tgt.y, block: true });
    }
  }
  const r = computeDamage(src.stats, tgt.stats, {
    power: spec.power, element: spec.element, damageType: spec.damageType, kind: spec.kind,
    canCrit: spec.canCrit, bonusMul: bonus, critBonus,
  }, w.rng, c.balance.damage);
  tgt.hp -= r.amount;
  if (tgt.kind === 'monster') tgt.damageBy[src.id] = (tgt.damageBy[src.id] ?? 0) + r.amount;
  if (tgt.kind === 'player') tgt.lastCombatTick = w.tick;
  if (src.kind === 'player') src.lastCombatTick = w.tick;
  const wasBroken = tgt.kind === 'monster' ? tgt.breaks : 0;

  // 状態異常
  if (spec.status) {
    for (const st of spec.status) {
      let chance = scaled(st.chance, spec.statusLevel ?? 1);
      chance *= 1 + (src.stats.m.statusChancePct ?? 0) / 100;
      chance *= Math.max(0.2, 1 - (tgt.stats.m.statusResistPct ?? 0) / 100);
      if (w.rng.next() * 100 >= chance) continue;
      const base = spec.damageType === 'physical' ? src.stats.atk : src.stats.matk;
      applyStatus(w, tgt, src.id, st.id, st.duration ?? 4, { dot: st.power ? base * st.power : undefined });
    }
  }
  // ブレイク
  if (tgt.kind === 'monster') addBreak(w, tgt, spec.breakPower * (1 + (src.stats.m.breakPct ?? 0) / 100));

  w.events.push({
    type: 'damage', src: src.id, tgt: tgt.id, amount: r.amount, crit: r.crit, weak: r.weak, resist: r.resist,
    element: spec.element, combo, cnt, x: tgt.x, y: tgt.y, toPlayer: tgt.kind === 'player',
    broke: tgt.kind === 'monster' && tgt.breaks > wasBroken, sweet, back,
  });
  if (src.kind === 'player') weaponOnHit(w, src, spec);
  if (spec.knockback && tgt.kind === 'monster' && !isBoss(w, tgt) && tgt.r <= c.balance.combat.knockbackMaxRadius) {
    const a = Math.atan2(tgt.y - src.y, tgt.x - src.x);
    moveCircle(w.area.map, tgt, tgt.r, Math.cos(a) * spec.knockback, Math.sin(a) * spec.knockback);
  }

  // HP 吸収
  if (src.kind === 'player') {
    const ls = (spec.lifesteal ?? 0) + (src.stats.m.lifestealPct ?? 0);
    if (ls > 0) heal(w, src, (r.amount * ls) / 100, true);
  }
  if (tgt.kind === 'monster' && tgt.ai !== 'chase') { tgt.ai = 'chase'; tgt.targetId = src.id; tgt.hidden = false; }
  procOnHit(w, src, tgt, spec, r.amount, r.crit);
  if (tgt.hp <= 0 && !tgt.dead && !(tgt.kind === 'player' && tryCheatDeath(w, tgt))) kill(w, tgt, src);
  return true;
}

/** 状態異常の持続ダメージ */
export function dealDot(w: World, tgt: Actor, amount: number, statusId: string, sourceId: number) {
  if (tgt.dead) return;
  const def = w.content.statuses[statusId];
  tgt.hp -= amount;
  w.events.push({
    type: 'damage', src: sourceId, tgt: tgt.id, amount, crit: false, weak: false, resist: false,
    element: def?.dot?.element ?? 'neutral', combo: -1, cnt: 1, x: tgt.x, y: tgt.y, toPlayer: tgt.kind === 'player', dot: true,
  });
  if (tgt.kind === 'monster') tgt.damageBy[sourceId] = (tgt.damageBy[sourceId] ?? 0) + amount;
  if (tgt.hp <= 0 && !(tgt.kind === 'player' && tryCheatDeath(w, tgt))) kill(w, tgt, findActor(w, sourceId) ?? null);
}

export function heal(w: World, a: Actor, amount: number, quiet = false) {
  if (a.dead) return;
  const amt = Math.round(amount * (1 + (a.stats.m.healPct ?? 0) / 100));
  if (amt <= 0) return;
  const before = a.hp;
  a.hp = Math.min(a.stats.maxHp, a.hp + amt);
  if (!quiet && a.hp > before) w.events.push({ type: 'heal', tgt: a.id, amount: Math.round(a.hp - before), x: a.x, y: a.y });
}

export function kill(w: World, t: Actor, by: Actor | null) {
  t.hp = 0;
  t.dead = true;
  t.statuses = [];
  if (t.kind === 'player') {
    onPlayerKilled(w, t as Player);
    return;
  }
  const m = t as Monster;
  w.events.push({ type: 'death', id: m.id, x: m.x, y: m.y, boss: isBoss(w, m), player: false });
  w.area.strikes = w.area.strikes.filter((s) => s.ownerId !== m.id);
  onMonsterKilled(w, m, by);
}
