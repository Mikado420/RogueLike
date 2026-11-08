import { addMods, type Mods } from '../core';
import type { Monster, PetData, Player, World } from '../state';
import { moveCircle } from '../map';
import { buildSpec, heal, launchAttack } from './combat';
import { applyStatus } from './status';
import { monsterStats } from './stats';
import { takeFromBag } from './items';
import { addCounter } from './counters';
import { recordCodex } from './quest';
import { DT, isoSpeedMul, newId, newUid, sec } from './util';
import { expToNext } from './progression';

/**
 * ペット：弱らせたモンスターを封晶石で仲間にする。
 * 「戦闘」は一緒に戦い、「採集」は採集量や拾い物を助ける。レベル・スキル・継承がある。
 */

/** ペットの必要経験値＝プレイヤーの曲線 × 係数 */
export function petExpToNext(w: World, level: number): number {
  return Math.max(1, Math.round(expToNext(level, w.content) * w.content.pets.expCurve[0]));
}

export function petSkillsFor(w: World, species: string): string[] {
  const c = w.content;
  const def = c.monsters[species];
  const first = def.petSkills?.[0] ?? c.pets.elementSkills[def.element] ?? 'war_cry';
  const out = [first];
  if (w.rng.chance(c.pets.secondSkillChance)) {
    const s = w.rng.pick(c.pets.randomSkills.filter((x) => x !== first));
    if (s) out.push(s);
  }
  return out;
}

export function captureChance(w: World, p: Player, m: Monster, item: string): number {
  const c = w.content.pets;
  const hpPct = (m.hp / m.stats.maxHp) * 100;
  const base = c.baseChance + (c.hpThreshold - hpPct) * c.hpBonus - Math.max(0, m.level - p.char.level) * c.levelPenalty;
  return Math.max(1, Math.min(95, base * (c.captureItems[item] ?? 1) * (m.elite ? c.eliteMul : 1)));
}

export function capture(w: World, p: Player, item: string): string | null {
  const c = w.content;
  if (!(item in c.pets.captureItems) || (p.char.bag[item] ?? 0) <= 0) return 'err.none';
  if (p.char.pets.length >= c.pets.maxPets) return 'err.petMax';
  let target: Monster | null = null, bd = c.pets.range;
  for (const m of w.area.monsters) {
    if (m.dead || m.hidden) continue;
    const d = Math.hypot(m.x - p.x, m.y - p.y) - m.r;
    if (d < bd) { bd = d; target = m; }
  }
  if (!target) return 'err.noTarget';
  const def = c.monsters[target.defId];
  if (!def.capturable || def.boss || target.summonedBy > 0) return 'err.cantCapture';
  if ((target.hp / target.stats.maxHp) * 100 > c.pets.hpThreshold) return 'err.notWeak';
  takeFromBag(p.char, item, 1);
  const ok = w.rng.next() * 100 < captureChance(w, p, target, item);
  w.events.push({ type: 'capture', playerId: p.id, success: ok, species: target.defId, x: target.x, y: target.y });
  if (!ok) { target.ai = 'chase'; target.targetId = p.id; return 'err.captureFail'; }
  target.dead = true;
  target.hp = 0;
  const pet: PetData = {
    uid: newUid(w), species: target.defId, name: def.name, level: Math.max(1, Math.min(target.level, p.char.level, c.pets.maxLevel)), exp: 0,
    skills: petSkillsFor(w, target.defId), role: 'battle', elite: target.elite,
  };
  p.char.pets.push(pet);
  if (p.char.activePet === null) p.char.activePet = pet.uid;
  addCounter(w, p, 'captures', 1);
  recordCodex(w, p, 'monsters', target.defId);
  w.events.push({ type: 'notice', playerId: p.id, key: 'notice.captured', args: [def.name] });
  return null;
}

export function activePetData(p: Player): PetData | null {
  return p.char.pets.find((x) => x.uid === p.char.activePet) ?? null;
}

/** 連れているペットが持ち主にくれる補正（パッシブスキル・採集の役割） */
export function petMods(w: World, p: Player): Mods {
  const m: Mods = {};
  const pet = activePetData(p);
  if (!pet) return m;
  for (const id of pet.skills) {
    const s = w.content.pets.skills[id];
    if (s?.kind === 'passive' && s.mods) addMods(m, s.mods);
  }
  if (pet.role === 'gather') addMods(m, { gatherPct: w.content.pets.gatherBonus });
  return m;
}

function makePetActor(w: World, owner: Player, data: PetData): Monster {
  const c = w.content;
  const def = c.monsters[data.species];
  const scale = { hp: 1, atk: c.pets.atkMul * (data.elite ? 1.3 : 1), def: 1, exp: 0, gold: 0 };
  const stats = monsterStats(def, data.level, c, scale);
  return {
    id: newId(w), kind: 'monster', defId: data.species, level: data.level, elite: data.elite, difficulty: 'normal',
    x: owner.x - 1, y: owner.y + 0.5, r: def.radius * 0.7, facing: 0, hp: stats.maxHp, stats, team: 0, dead: false, statuses: [],
    stagger: 0, moving: false, statsDirty: false, ai: 'wander', targetId: -1, homeX: owner.x, homeY: owner.y, wanderX: 0, wanderY: 0,
    timer: 0, busy: 0, globalCd: 0, cds: {}, pending: null, spawnKey: `pet:${data.uid}`, enraged: false, poise: 1, poiseMax: 1, breaks: 0,
    lastHitTick: 0, phase: 0, shielded: false, brokenUntil: 0, scale, damageBy: {}, hidden: false, fieldBoss: false,
    summonedBy: owner.id,
  };
}

/** 連れているペットを実体として用意する（エリアが変わっても持ち主のそばへ） */
export function syncPets(w: World) {
  for (const p of w.players) {
    const data = activePetData(p);
    const cur = w.pets.find((x) => x.summonedBy === p.id);
    if (!data || p.dead) { if (cur) w.pets = w.pets.filter((x) => x !== cur); continue; }
    if (!cur || cur.spawnKey !== `pet:${data.uid}` || cur.level !== data.level) {
      if (cur) w.pets = w.pets.filter((x) => x !== cur);
      w.pets.push(makePetActor(w, p, data));
    }
  }
}

export function petOwner(w: World, id: number): Player | undefined {
  const pet = w.pets.find((x) => x.id === id);
  return pet ? w.players.find((p) => p.id === pet.summonedBy) : undefined;
}

export function petGainExp(w: World, p: Player, amount: number) {
  const data = activePetData(p);
  if (!data || data.level >= w.content.pets.maxLevel) return;
  data.exp += Math.round(amount * w.content.pets.expShare);
  while (data.level < w.content.pets.maxLevel && data.exp >= petExpToNext(w, data.level)) {
    data.exp -= petExpToNext(w, data.level);
    data.level++;
    w.events.push({ type: 'petLevel', playerId: p.id, uid: data.uid, level: data.level });
  }
}

export function updatePets(w: World) {
  syncPets(w);
  const c = w.content.pets;
  for (const pet of w.pets) {
    const owner = w.players.find((p) => p.id === pet.summonedBy);
    const data = owner ? activePetData(owner) : null;
    if (!owner || !data) continue;
    for (const k in pet.cds) if (pet.cds[k] > 0) pet.cds[k]--;
    if (pet.globalCd > 0) pet.globalCd--;
    pet.moving = false;
    const dOwner = Math.hypot(owner.x - pet.x, owner.y - pet.y);
    if (dOwner > c.leash) { pet.x = owner.x - 0.8; pet.y = owner.y + 0.6; }
    const step = (tx: number, ty: number, speed: number) => {
      const dx = tx - pet.x, dy = ty - pet.y, d = Math.hypot(dx, dy);
      if (d < 0.05) return;
      const v = Math.min(d, speed * DT(w) * isoSpeedMul(dx, dy, w.content));
      pet.facing = Math.atan2(dy, dx);
      pet.moving = moveCircle(w.area.map, pet, pet.r, (dx / d) * v, (dy / d) * v);
    };
    // 回復・バフ（持ち主に）
    for (const id of data.skills) {
      const s = w.content.pets.skills[id];
      if (!s || (pet.cds[id] ?? 0) > 0) continue;
      if (s.kind === 'heal' && owner.hp < owner.stats.maxHp * 0.6 && !owner.dead) {
        heal(w, owner, (owner.stats.maxHp * (s.value ?? 5)) / 100);
        pet.cds[id] = sec(w, s.cd ?? 10);
      } else if (s.kind === 'buff' && w.tick - owner.lastCombatTick < sec(w, 3)) {
        applyStatus(w, owner, pet.id, 'pet_buff', s.duration ?? 10, { mods: { ...(s.mods ?? {}) } });
        owner.statsDirty = true;
        pet.cds[id] = sec(w, s.cd ?? 30);
      } else if (s.kind === 'loot') {
        for (const d of w.area.drops) if (Math.hypot(d.x - pet.x, d.y - pet.y) <= (s.range ?? 5)) { d.x = owner.x; d.y = owner.y; }
      }
    }
    // 戦闘
    let target: Monster | null = null;
    if (data.role === 'battle') {
      let bd = c.aggroRange;
      for (const m of w.area.monsters) {
        if (m.dead || m.hidden) continue;
        const d = Math.hypot(m.x - owner.x, m.y - owner.y);
        if (d < bd) { bd = d; target = m; }
      }
    }
    if (target) {
      const def = w.content.monsters[pet.defId];
      const base = def.attacks[0];
      const reach = (base?.range ?? 1.2) + target.r + pet.r;
      const d = Math.hypot(target.x - pet.x, target.y - pet.y);
      const dir = Math.atan2(target.y - pet.y, target.x - pet.x);
      // スキル攻撃
      const sk = data.skills.map((id) => ({ id, s: w.content.pets.skills[id] })).find((x) => x.s?.kind === 'attack' && (pet.cds[x.id] ?? 0) <= 0);
      if (sk && sk.s.attack && d <= (sk.s.attack.range ?? 2) + target.r) {
        launchAttack(w, pet, sk.s.attack, dir, target, buildSpec(pet, sk.s.attack, 'skill', 1, sk.s.attack.damageType ?? 'magic'));
        pet.cds[sk.id] = sec(w, sk.s.cd ?? 6);
        pet.globalCd = sec(w, 0.6);
        pet.facing = dir;
      } else if (d > reach * 0.9) step(target.x, target.y, owner.stats.moveSpeed * 1.05);
      else if (pet.globalCd <= 0 && base) {
        pet.facing = dir;
        launchAttack(w, pet, base, dir, target, buildSpec(pet, base, 'normal', 1, base.damageType ?? 'physical'), { delay: sec(w, 0.2) });
        pet.globalCd = sec(w, c.attackInterval);
      }
    } else if (dOwner > c.followDist) {
      const a = Math.atan2(pet.y - owner.y, pet.x - owner.x);
      step(owner.x + Math.cos(a) * c.followDist * 0.8, owner.y + Math.sin(a) * c.followDist * 0.8, owner.stats.moveSpeed * 1.1);
    }
  }
}

export function setActivePet(p: Player, uid: number | null): string | null {
  if (uid !== null && !p.char.pets.some((x) => x.uid === uid)) return 'err.invalid';
  p.char.activePet = uid;
  return null;
}

export function setPetRole(p: Player, uid: number, role: 'battle' | 'gather'): string | null {
  const pet = p.char.pets.find((x) => x.uid === uid);
  if (!pet || (role !== 'battle' && role !== 'gather')) return 'err.invalid';
  pet.role = role;
  return null;
}

export function inheritCost(w: World, base: PetData): number {
  const [a, b] = w.content.pets.inheritCost;
  return a + b * base.level;
}

/** 継承：素材のペットのスキルを1つ受け継ぐ（素材は消える） */
export function inheritPet(w: World, p: Player, baseUid: number, matUid: number, skill: string, slot: number): string | null {
  const ch = p.char;
  const base = ch.pets.find((x) => x.uid === baseUid);
  const mat = ch.pets.find((x) => x.uid === matUid);
  if (!base || !mat || base === mat || !mat.skills.includes(skill)) return 'err.invalid';
  if (base.skills.includes(skill)) return 'err.hasSkill';
  const max = w.content.pets.skillSlots;
  if (slot < 0 || slot >= max) return 'err.invalid';
  const cost = inheritCost(w, base);
  if (ch.gold < cost) return 'err.gold';
  ch.gold -= cost;
  if (slot < base.skills.length) base.skills[slot] = skill; else base.skills.push(skill);
  ch.pets = ch.pets.filter((x) => x !== mat);
  if (ch.activePet === mat.uid) ch.activePet = base.uid;
  return null;
}

export function releasePet(p: Player, uid: number): string | null {
  if (!p.char.pets.some((x) => x.uid === uid)) return 'err.invalid';
  p.char.pets = p.char.pets.filter((x) => x.uid !== uid);
  if (p.char.activePet === uid) p.char.activePet = null;
  return null;
}
