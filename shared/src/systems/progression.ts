import { PRIMARY_STATS, WEAPON_TYPES, type EquipSlot, type PersonalStat, type PrimaryStat, type WeaponType } from '../core';
import type { Content, MonsterDef } from '../content/types';
import type { BuildSnapshot, CharacterData, Player, World } from '../state';
import { weaponTypeOf } from './stats';

// ───────── 経験値とレベル ─────────

/** 次のレベルまでに必要な経験値 = (a + b×Lv) × (c + d×Lv^p) */
export function expToNext(level: number, c: Content): number {
  const pr = c.balance.progression;
  const kills = pr.expKills[0] + pr.expKills[1] * level;
  const per = pr.expMonster[0] + pr.expMonster[1] * Math.pow(level, pr.expMonster[2]);
  return Math.round(kills * per);
}

/** モンスター1体の基本経験値 */
export function monsterExp(level: number, def: MonsterDef, c: Content, mul = 1): number {
  const pr = c.balance.progression;
  return Math.round((pr.expMonster[0] + pr.expMonster[1] * Math.pow(level, pr.expMonster[2])) * (def.exp ?? 1) * mul);
}

/** レベル差による倍率（格下は減り、格上は少し増える） */
export function levelDiffMul(playerLevel: number, monsterLevel: number, c: Content): number {
  const pr = c.balance.progression;
  const d = monsterLevel - playerLevel;
  if (d >= 0) return Math.min(pr.levelDiffMaxMul, 1 + d * pr.levelDiffBonus);
  const under = Math.max(0, -d - 5);
  return Math.max(pr.levelDiffMinMul, 1 - under * pr.levelDiffPenalty);
}

/** 経験値を足してレベルアップを処理する。上がったレベル数を返す */
export function gainExp(w: World, p: Player, amount: number): number {
  const c = w.content;
  const ch = p.char;
  const max = c.balance.progression.maxLevel;
  if (ch.level >= max) return 0;
  const mul = 1 + ((p.stats.m.expPct ?? 0) + ch.rebirths * c.balance.rebirth.expPct) / 100;
  const gained = Math.max(1, Math.round(amount * mul));
  ch.exp += gained;
  w.events.push({ type: 'exp', playerId: p.id, amount: gained, x: p.x, y: p.y });
  let ups = 0;
  while (ch.level < max && ch.exp >= expToNext(ch.level, c)) {
    ch.exp -= expToNext(ch.level, c);
    ch.level++;
    ups++;
  }
  if (ch.level >= max) ch.exp = 0;
  if (ups > 0) {
    p.statsDirty = true;
    w.events.push({ type: 'levelUp', playerId: p.id, level: ch.level });
    w.events.push({ type: 'charChanged', playerId: p.id });
  }
  return ups;
}

// ───────── ステータスポイント ─────────

export function totalStatPoints(ch: CharacterData, c: Content): number {
  const pr = c.balance.progression;
  return pr.startStatPoints + pr.statPointsPerLevel * (ch.level - 1) + ch.rebirths * c.balance.rebirth.statPoints;
}

export function spentStatPoints(ch: CharacterData): number {
  return PRIMARY_STATS.reduce((s, k) => s + ch.stats[k], 0) + ch.personal.value;
}

export const freeStatPoints = (ch: CharacterData, c: Content) => totalStatPoints(ch, c) - spentStatPoints(ch);

/** ステ振り。失敗したら理由のキーを返す */
export function allocateStat(ch: CharacterData, stat: PrimaryStat | 'personal', amount: number, c: Content): string | null {
  const n = Math.floor(amount);
  if (n <= 0) return 'err.invalid';
  const free = freeStatPoints(ch, c);
  if (free <= 0) return 'err.noPoints';
  const k = c.balance.stats;
  if (stat === 'personal') {
    if (!ch.personal.type) return 'err.noPersonal';
    const room = k.personalMax - ch.personal.value;
    const add = Math.min(n, free, room);
    if (add <= 0) return 'err.statMax';
    ch.personal.value += add;
    return null;
  }
  if (!PRIMARY_STATS.includes(stat)) return 'err.invalid';
  const room = k.statMax - (k.statBase + ch.stats[stat]);
  const add = Math.min(n, free, room);
  if (add <= 0) return 'err.statMax';
  ch.stats[stat] += add;
  return null;
}

/** 個性ステの種類を選ぶ（まだポイントを振っていないときだけ） */
export function choosePersonal(ch: CharacterData, type: PersonalStat, c: Content): string | null {
  if (!c.balance.personal[type]) return 'err.invalid';
  if (ch.personal.type && ch.personal.value > 0) return 'err.personalLocked';
  ch.personal.type = type;
  return null;
}

// ───────── スキル ─────────

export function totalSkillPoints(ch: CharacterData, c: Content): number {
  const pr = c.balance.progression;
  return pr.startSkillPoints + pr.skillPointsPerLevel * (ch.level - 1) + ch.rebirths * c.balance.rebirth.skillPoints;
}

export const spentSkillPoints = (ch: CharacterData) => Object.values(ch.skills).reduce((s, v) => s + v, 0);
export const freeSkillPoints = (ch: CharacterData, c: Content) => totalSkillPoints(ch, c) - spentSkillPoints(ch);

/** そのスキルを今1レベル上げられるか。できないなら理由のキー */
export function canLearnSkill(ch: CharacterData, id: string, c: Content): string | null {
  const d = c.skills[id];
  if (!d) return 'err.invalid';
  const cur = ch.skills[id] ?? 0;
  if (cur >= d.maxLevel) return 'err.skillMax';
  const need = c.balance.progression.tierLevels[d.tier - 1] ?? 1;
  if (ch.level < need) return 'err.levelLow';
  for (const r of d.requires ?? []) {
    if ((ch.skills[r.skill] ?? 0) < r.level) return 'err.requires';
  }
  if (freeSkillPoints(ch, c) <= 0) return 'err.noPoints';
  return null;
}

export function learnSkill(ch: CharacterData, id: string, c: Content): string | null {
  const err = canLearnSkill(ch, id, c);
  if (err) return err;
  const first = !ch.skills[id];
  ch.skills[id] = (ch.skills[id] ?? 0) + 1;
  const d = c.skills[id];
  if (first && d.type === 'active') autoSlot(ch, id, c);
  return null;
}

export function slotsFor(ch: CharacterData, weapon: WeaponType, c: Content): (string | null)[] {
  const n = c.balance.player.skillSlots;
  let s = ch.skillSlots[weapon];
  if (!s) { s = Array(n).fill(null); ch.skillSlots[weapon] = s; }
  while (s.length < n) s.push(null);
  return s;
}

/** 覚えたスキルを空いている枠に入れる（武器スキルはその武器、汎用は今の武器） */
function autoSlot(ch: CharacterData, id: string, c: Content) {
  const d = c.skills[id];
  const weapon = d.weapon ?? weaponTypeOf(ch);
  const slots = slotsFor(ch, weapon, c);
  if (slots.includes(id)) return;
  const i = slots.indexOf(null);
  if (i >= 0) slots[i] = id;
}

export function setSkillSlot(ch: CharacterData, weapon: WeaponType, slot: number, id: string | null, c: Content): string | null {
  if (!WEAPON_TYPES.includes(weapon)) return 'err.invalid';
  const slots = slotsFor(ch, weapon, c);
  if (slot < 0 || slot >= slots.length) return 'err.invalid';
  if (id !== null) {
    const d = c.skills[id];
    if (!d || d.type !== 'active' || !ch.skills[id]) return 'err.invalid';
    if (d.weapon && d.weapon !== weapon) return 'err.wrongWeapon';
    const prev = slots.indexOf(id);
    if (prev >= 0) slots[prev] = slots[slot];
  }
  slots[slot] = id;
  return null;
}

// ───────── 振り直し・ビルド・転生 ─────────

export function respecCost(ch: CharacterData, c: Content): number {
  return Math.round(c.balance.respec.costBase + c.balance.respec.costPerLevel * ch.level);
}

function clearAllocation(ch: CharacterData) {
  for (const s of PRIMARY_STATS) ch.stats[s] = 0;
  ch.personal = { type: null, value: 0 };
  ch.skills = {};
  ch.skillSlots = {};
}

export function respec(ch: CharacterData, c: Content): string | null {
  const cost = respecCost(ch, c);
  if (ch.gold < cost) return 'err.gold';
  ch.gold -= cost;
  clearAllocation(ch);
  return null;
}

export function saveBuild(ch: CharacterData, slot: number, c: Content, name?: string): string | null {
  if (slot < 0 || slot >= c.balance.builds.slots) return 'err.invalid';
  while (ch.builds.length < c.balance.builds.slots) ch.builds.push(null);
  const equipment: BuildSnapshot['equipment'] = {};
  for (const [k, it] of Object.entries(ch.equipment)) equipment[k as EquipSlot] = it ? it.uid : null;
  ch.builds[slot] = {
    name: name ?? ch.builds[slot]?.name ?? `${slot + 1}`,
    stats: { ...ch.stats },
    personal: { ...ch.personal },
    skills: { ...ch.skills },
    skillSlots: JSON.parse(JSON.stringify(ch.skillSlots)),
    equipment,
  };
  return null;
}

/**
 * ビルドを読み込む。振ったポイントが今の合計を超えるなら失敗。
 * 装備は持ち物か装備中にあるものだけ付け替える。
 */
export function loadBuild(ch: CharacterData, slot: number, c: Content, equip: (uid: number) => void): string | null {
  const b = ch.builds[slot];
  if (!b) return 'err.empty';
  const statSum = PRIMARY_STATS.reduce((s, k) => s + (b.stats[k] ?? 0), 0) + b.personal.value;
  if (statSum > totalStatPoints(ch, c)) return 'err.noPoints';
  const skillSum = Object.values(b.skills).reduce((s, v) => s + v, 0);
  if (skillSum > totalSkillPoints(ch, c)) return 'err.noPoints';
  for (const s of PRIMARY_STATS) ch.stats[s] = b.stats[s] ?? 0;
  ch.personal = { ...b.personal };
  ch.skills = { ...b.skills };
  ch.skillSlots = JSON.parse(JSON.stringify(b.skillSlots));
  for (const uid of Object.values(b.equipment)) if (uid !== null && uid !== undefined) equip(uid);
  return null;
}

export function canRebirth(ch: CharacterData, c: Content): string | null {
  if (ch.level < c.balance.progression.maxLevel) return 'err.levelLow';
  if (ch.rebirths >= c.balance.rebirth.max) return 'err.rebirthMax';
  return null;
}

/** 転生：レベル1に戻り、振り分けも戻る。転生ボーナスのポイントと称号は残る */
export function rebirth(ch: CharacterData, c: Content): string | null {
  const err = canRebirth(ch, c);
  if (err) return err;
  ch.rebirths++;
  ch.level = 1;
  ch.exp = 0;
  clearAllocation(ch);
  for (const t of c.balance.rebirth.titles) {
    if (ch.rebirths >= t.count && !ch.titles.unlocked.includes(t.title)) ch.titles.unlocked.push(t.title);
  }
  return null;
}
