import type { Mods } from '../core';
import type { Actor, Monster, World } from '../state';
import { isBoss, sec } from './util';

/**
 * 状態（バフ・デバフ）の付与。同じ状態は時間を延長し、DoT は重ねがけできる。
 * 成功したら true。
 */
export function applyStatus(
  w: World, tgt: Actor, sourceId: number, id: string, durationSec: number,
  opts: { dot?: number; mods?: Mods } = {},
): boolean {
  const def = w.content.statuses[id];
  if (!def || tgt.dead) return false;
  let dur = sec(w, durationSec);
  if (def.bossDurationMul !== undefined && isBoss(w, tgt)) dur = Math.round(dur * def.bossDurationMul);
  if (tgt.kind === 'monster' && def.cannotAct) {
    const md = w.content.monsters[tgt.defId];
    if (md?.ccResist) dur = Math.round(dur * (1 - md.ccResist));
  }
  if (dur <= 0) return false;
  const until = w.tick + dur;
  const ex = tgt.statuses.find((s) => s.id === id);
  if (ex) {
    ex.until = Math.max(ex.until, until);
    if (def.dot) ex.stacks = Math.min(def.maxStacks ?? 1, ex.stacks + 1);
    if (opts.dot !== undefined) ex.dot = Math.max(ex.dot, opts.dot);
    if (opts.mods) ex.mods = opts.mods;
  } else {
    tgt.statuses.push({
      id, until, stacks: 1, sourceId, dot: opts.dot ?? 0,
      nextTick: w.tick + (def.dot ? sec(w, def.dot.interval) : 0), mods: opts.mods,
    });
    w.events.push({ type: 'status', tgt: tgt.id, status: id, on: true });
  }
  if (def.mods || opts.mods) tgt.statsDirty = true;
  if (def.cannotAct && tgt.kind === 'monster') {
    tgt.pending = null;
    w.area.strikes = w.area.strikes.filter((s) => !(s.ownerId === tgt.id && s.telegraph && s.nextTick > w.tick));
  }
  return true;
}

export function removeStatus(w: World, tgt: Actor, id: string) {
  const i = tgt.statuses.findIndex((s) => s.id === id);
  if (i < 0) return;
  tgt.statuses.splice(i, 1);
  tgt.statsDirty = true;
  w.events.push({ type: 'status', tgt: tgt.id, status: id, on: false });
}

/** デバフをすべて消す */
export function cleanse(w: World, tgt: Actor) {
  for (const s of [...tgt.statuses]) {
    if (w.content.statuses[s.id]?.kind === 'debuff') removeStatus(w, tgt, s.id);
  }
}

export function cannotAct(w: World, a: Actor): boolean {
  if (a.stagger > 0) return true;
  for (const s of a.statuses) if (w.content.statuses[s.id]?.cannotAct) return true;
  return false;
}

export function missChance(w: World, a: Actor): number {
  let m = 0;
  for (const s of a.statuses) m = Math.max(m, w.content.statuses[s.id]?.missChance ?? 0);
  return m;
}

/** 状態による被ダメージ増加（%） */
export function dmgTakenPct(w: World, a: Actor): number {
  let p = 0;
  for (const s of a.statuses) p += w.content.statuses[s.id]?.dmgTakenPct ?? 0;
  if (a.kind === 'monster' && w.tick < a.brokenUntil) p += w.content.balance.damage.breakDmgTakenPct;
  return p;
}

/**
 * 毎tick：期限切れの解除、DoT、感電の痺れ。
 * DoT は onDot に (対象, 量, 状態) を渡して呼び出し側（combat）でダメージにする。
 */
export function tickStatuses(w: World, a: Actor, onDot: (a: Actor, amount: number, statusId: string, sourceId: number) => void) {
  if (a.statuses.length === 0) return;
  for (const s of [...a.statuses]) {
    if (w.tick >= s.until) { removeStatus(w, a, s.id); continue; }
    const def = w.content.statuses[s.id];
    if (!def) continue;
    if (def.dot && w.tick >= s.nextTick && s.dot > 0) {
      s.nextTick = w.tick + sec(w, def.dot.interval);
      onDot(a, Math.max(1, Math.round(s.dot * s.stacks)), s.id, s.sourceId);
      if (a.dead) return;
    }
    if (def.jolt) {
      const iv = sec(w, def.jolt.interval);
      if (iv > 0 && (s.until - w.tick) % iv === 0) a.stagger = Math.max(a.stagger, sec(w, def.jolt.duration));
    }
  }
}

/**
 * ブレイク（怯み）ゲージ。削り切るとしばらく行動不能になり、受けるダメージが増える。
 */
export function addBreak(w: World, m: Monster, amount: number) {
  if (amount <= 0 || m.dead) return;
  const mb = w.content.balance.monster;
  m.lastHitTick = w.tick;
  if (w.tick < m.brokenUntil) return;
  m.poise -= amount;
  if (m.poise > 0) return;
  m.breaks++;
  const boss = isBoss(w, m);
  const dur = sec(w, boss ? mb.bossBreakDuration : mb.breakDuration);
  m.stagger = Math.max(m.stagger, dur);
  m.brokenUntil = w.tick + dur;
  m.poiseMax = Math.round(m.poiseMax * mb.poiseGrowth);
  m.poise = m.poiseMax;
  m.pending = null;
  m.busy = 0;
  w.area.strikes = w.area.strikes.filter((s) => !(s.ownerId === m.id && s.telegraph && s.nextTick > w.tick));
  w.events.push({ type: 'break', id: m.id });
}

/** しばらく殴られていないとゲージが戻る */
export function regenPoise(w: World, m: Monster) {
  if (m.poise < m.poiseMax && w.tick - m.lastHitTick > sec(w, w.content.balance.monster.poiseRegenDelay)) {
    m.poise = m.poiseMax;
  }
}
