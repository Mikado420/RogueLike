import { addMods, type Mods } from '../core';
import type { AttackDef, MythicDef, UniqueDef } from '../content/types';
import type { Actor, CharacterData, HitSpec, Item, Monster, Player, World } from '../state';
import { applyHit, buildSpec, enemiesOf, heal, launchAttack } from './combat';
import { applyStatus } from './status';
import { isNight } from './time';
import { currentWeather, weatherDef } from './weather';
import { baseActive, baseOf } from './base';
import { sec } from './util';

/**
 * 装備の固有効果（レジェンド）と、スキルの挙動を変える効果（ミシック）。
 */

export function equippedItems(ch: CharacterData): Item[] {
  return Object.values(ch.equipment).filter(Boolean) as Item[];
}

export function uniquesOf(w: World, ch: CharacterData): UniqueDef[] {
  return equippedItems(ch).map((it) => (it.unique ? w.content.uniques[it.unique] : null)).filter(Boolean) as UniqueDef[];
}

export function mythicOf(w: World, ch: CharacterData, effect: MythicDef['effect']): MythicDef | null {
  for (const it of equippedItems(ch)) {
    const m = it.mythic ? w.content.mythics[it.mythic] : null;
    if (m && m.effect === effect) return m;
  }
  return null;
}

/** 条件つきの補正。key が変わったら能力値を計算し直す */
export function conditionalMods(w: World, p: Player): { key: string; mods: Mods } {
  const mods: Mods = {};
  const on: string[] = [];
  equippedItems(p.char).forEach((it) => {
    const u = it.unique ? w.content.uniques[it.unique] : null;
    if (!u?.when || !u.whenMods) return;
    const c = u.when;
    let ok = true;
    if (c.hpBelow !== undefined && (p.hp / p.stats.maxHp) * 100 > c.hpBelow) ok = false;
    if (c.afterDodge !== undefined && w.tick - p.lastDodgeTick > sec(w, c.afterDodge)) ok = false;
    if (c.night && !isNight(w)) ok = false;
    if (c.fullHp && p.hp < p.stats.maxHp) ok = false;
    if (ok) { addMods(mods, u.whenMods); on.push(it.unique!); }
  });
  // 天候による補正（雪で足が遅いなど）
  const wd = weatherDef(w);
  if (wd.moveSpeedPct) { addMods(mods, { moveSpeedPct: wd.moveSpeedPct }); on.push(`w:${currentWeather(w)}`); }
  on.push(`b:${baseActive(baseOf(p), w.content, w.clock)}`);
  const pet = p.char.pets.find((x) => x.uid === p.char.activePet);
  on.push(`p:${pet?.uid ?? 0}:${pet?.role ?? ''}:${pet?.skills.join('.') ?? ''}`);
  return { key: on.join(','), mods };
}

function procSpec(base: HitSpec, power: number, extra: Partial<HitSpec> = {}): HitSpec {
  return { ...base, power: base.power * power, tags: [...(base.tags ?? []), 'proc'], breakPower: base.breakPower * 0.3, status: undefined, ...extra };
}

/** 命中したとき（攻撃側・受けた側の両方） */
export function procOnHit(w: World, src: Actor, tgt: Actor, spec: HitSpec, _amount: number, _crit: boolean) {
  if (spec.tags?.includes('proc') || spec.kind === 'dot') return;
  if (src.kind === 'player') {
    for (const u of uniquesOf(w, src.char)) {
      if (u.proc?.on !== 'hit' || w.rng.next() * 100 >= u.proc.chance) continue;
      if (u.proc.effect === 'extraHit') {
        applyHit(w, src, tgt, procSpec(spec, u.proc.value), -1, 1);
        w.events.push({ type: 'proc', playerId: src.id, name: u.name, x: tgt.x, y: tgt.y });
      } else if (u.proc.effect === 'status' && u.proc.status) {
        applyStatus(w, tgt, src.id, u.proc.status, u.proc.value);
      }
    }
    const chain = spec.kind === 'skill' ? mythicOf(w, src.char, 'chainLightning') : null;
    if (chain) {
      const others = enemiesOf(w, src.team)
        .filter((e) => e.id !== tgt.id && Math.hypot(e.x - tgt.x, e.y - tgt.y) <= 4)
        .sort((a, b) => Math.hypot(a.x - tgt.x, a.y - tgt.y) - Math.hypot(b.x - tgt.x, b.y - tgt.y))
        .slice(0, 2);
      for (const o of others) applyHit(w, src, o, procSpec(spec, chain.value, { element: 'wind' }), -1, 1);
      if (others.length) w.events.push({ type: 'proc', playerId: src.id, name: chain.name, x: tgt.x, y: tgt.y });
    }
  }
  if (tgt.kind === 'player' && !tgt.dead) {
    for (const u of uniquesOf(w, tgt.char)) {
      if (u.proc?.on !== 'hurt' || w.rng.next() * 100 >= u.proc.chance) continue;
      if (u.proc.effect === 'heal') heal(w, tgt, (tgt.stats.maxHp * u.proc.value) / 100);
    }
  }
}

/** 倒したとき */
export function procOnKill(w: World, killer: Player, m: Monster) {
  for (const u of uniquesOf(w, killer.char)) {
    if (u.proc?.on !== 'kill' || w.rng.next() * 100 >= u.proc.chance) continue;
    if (u.proc.effect === 'heal') heal(w, killer, (killer.stats.maxHp * u.proc.value) / 100);
  }
  const gate = mythicOf(w, killer.char, 'deathBurst');
  if (gate?.attack) {
    const def: AttackDef = { ...gate.attack, anchor: 'aim' };
    const spec = buildSpec(killer, def, 'skill', 1, 'physical');
    spec.tags = ['proc'];
    launchAttack(w, killer, def, 0, null, spec, { point: { x: m.x, y: m.y } });
  }
}

/** 回避したとき */
export function procOnDodge(w: World, p: Player) {
  const ph = mythicOf(w, p.char, 'dodgeClone');
  if (ph?.attack) {
    const def: AttackDef = { ...ph.attack, anchor: 'aim' };
    const spec = buildSpec(p, def, 'skill', 1, 'physical');
    spec.tags = ['proc'];
    launchAttack(w, p, def, 0, null, spec, { point: { x: p.x, y: p.y } });
    w.events.push({ type: 'proc', playerId: p.id, name: ph.name, x: p.x, y: p.y });
  }
}

/** 倒れるダメージを一度だけ耐える（不屈） */
export function tryCheatDeath(w: World, p: Player): boolean {
  for (const u of uniquesOf(w, p.char)) {
    if (!u.cheatDeath || w.tick < p.cheatDeathAt) continue;
    p.hp = 1;
    p.cheatDeathAt = w.tick + sec(w, u.cheatDeath);
    p.iframes = Math.max(p.iframes, sec(w, 1));
    w.events.push({ type: 'proc', playerId: p.id, name: u.name, x: p.x, y: p.y });
    return true;
  }
  return false;
}

/** 通常攻撃を別のものに変える（灼焔の理）。interval は攻撃間隔の倍率 */
export function normalAttackOverride(w: World, p: Player): { attack: AttackDef; interval: number } | null {
  const m = mythicOf(w, p.char, 'fireballAttack');
  return m?.attack ? { attack: m.attack, interval: m.value } : null;
}

export function extraHitsBonus(w: World, p: Player): number {
  return mythicOf(w, p.char, 'extraHits')?.value ?? 0;
}

/** 残響：スキルがもう一度出る確率（%）・威力・遅れ */
export function echoOf(w: World, p: Player): { chance: number; power: number; delay: number; name: string } | null {
  const m = mythicOf(w, p.char, 'echoSkill');
  return m ? { chance: m.value, power: m.power ?? 0.5, delay: m.delay ?? 0.4, name: m.name } : null;
}
