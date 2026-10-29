// 素材・装備・スキル。企画書「ハクスラ（装備と素材）」の実装。
// 装備は素材を落とした個体の遺伝子の特性を受け継ぐ。
import { ELEMENTS, ELEMENT_INFO } from './elements.js';
import { behaviorOf, isPoisonous } from './genome.js';
import { uid, clamp } from './rng.js';

export const MATERIAL_KINDS = { fang: '牙', scale: '鱗', core: '核' };
export const RARITY_JA = ['', '★', '★★'];

export const WEAPON_TYPES = {
  sword: { ja: '剣',   shape: 'arc',   reach: 26, arc: 1.8, cd: 0.42, mult: 1.0 },
  spear: { ja: '槍',   shape: 'line',  reach: 40, width: 10, cd: 0.58, mult: 1.15 },
  bow:   { ja: '弓',   shape: 'shot',  speed: 230, range: 170, cd: 0.52, mult: 0.85 },
  staff: { ja: '杖',   shape: 'orb',   speed: 160, range: 140, blast: 20, cd: 0.78, mult: 1.0 },
};

export const WEAPON_SKILLS = {
  water:   { id: 'tidal',    ja: '水流',       cd: 6 },
  fire:    { id: 'fireball', ja: '火炎弾',     cd: 6 },
  ice:     { id: 'icicle',   ja: '氷柱',       cd: 6 },
  wind:    { id: 'gale',     ja: '突風',       cd: 6 },
  earth:   { id: 'quake',    ja: '地割れ',     cd: 7 },
  thunder: { id: 'bolt',     ja: '雷撃',       cd: 5 },
  light:   { id: 'ray',      ja: '光線',       cd: 6 },
  dark:    { id: 'drain',    ja: '吸魂',       cd: 6 },
  none:    { id: 'spin',     ja: '回転斬り',   cd: 6 },
};
export const ARMOR_SKILLS = {
  light: { id: 'heal',  ja: '癒しの光',   cd: 14 },
  earth: { id: 'guard', ja: '岩の守り',   cd: 12 },
  wind:  { id: 'haste', ja: '疾風',       cd: 10 },
  water: { id: 'purify', ja: '清めの水',  cd: 12 },
  fire:  { id: 'ward',  ja: '属性の守り', cd: 12 },
  ice:   { id: 'ward',  ja: '属性の守り', cd: 12 },
  thunder: { id: 'ward', ja: '属性の守り', cd: 12 },
  dark:  { id: 'ward',  ja: '属性の守り', cd: 12 },
  none:  { id: 'ward',  ja: '属性の守り', cd: 12 },
};

export const SHOP = {
  potion: { ja: '回復薬', price: 40, desc: 'HPを50%回復' },
  charm:  { ja: '身代わりの護符', price: 150, desc: 'ダウンしたとき1回だけ自動で復帰' },
};

/** 撃破時の素材ドロップ（各プレイヤーに個別） */
export function rollMaterial(rng, monster, tier) {
  const kind = rng.weighted(['fang', 'scale', 'core'], (k) => (k === 'core' ? 0.2 : 0.4));
  const g = monster.genome;
  const rarity = g.apex ? 2 : (g.mutant || monster.endangered) ? 1 : 0;
  const topResist = Object.entries(g.resist).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return {
    id: uid(rng, 'm'), kind,
    speciesId: monster.speciesId, speciesName: monster.speciesName,
    tier, rarity,
    g: {
      body: g.body, atk: g.atk, power: +g.power.toFixed(3), behavior: behaviorOf(g),
      poison: isPoisonous(g), resist: Object.fromEntries(topResist.map(([e, v]) => [e, +v.toFixed(3)])),
    },
  };
}

export const materialLabel = (m) => `${RARITY_JA[m.rarity]}${m.speciesName}の${MATERIAL_KINDS[m.kind]}`;
export const materialPrice = (m) => Math.round((6 + m.tier * 4) * (1 + m.rarity * 1.5));

export function starterEquipment(rng) {
  return [
    { id: uid(rng, 'e'), slot: 'weapon', type: 'sword', name: '木の剣', element: 'none', atk: 8, rarity: 0, tier: 1, effects: {} },
    { id: uid(rng, 'e'), slot: 'armor', name: '布の服', element: 'none', hp: 20, resist: {}, rarity: 0, tier: 1, effects: {} },
  ];
}

/**
 * 装備を作る。
 * weapon: 牙2つ（属性は1つ目の牙の個体の攻撃属性）
 * armor : 鱗2つ（耐性は2つの鱗の平均）
 * acc   : 核1つ（効果は個体の行動パターン）
 */
export function craft(rng, recipe, mats, weaponType = 'sword') {
  const tier = Math.max(...mats.map((m) => m.tier));
  const rarity = Math.max(...mats.map((m) => m.rarity));
  const src = mats[0];
  const rmul = 1 + rarity * 0.25;
  if (recipe === 'weapon') {
    if (mats.length !== 2 || mats.some((m) => m.kind !== 'fang')) return { error: '武器には牙が2つ必要です' };
    if (!WEAPON_TYPES[weaponType]) return { error: '武器の種類が正しくありません' };
    const power = (mats[0].g.power + mats[1].g.power) / 2;
    const element = src.g.atk || 'none';
    const effects = {};
    if (mats.some((m) => m.g.poison)) effects.poison = true;
    return {
      item: {
        id: uid(rng, 'e'), slot: 'weapon', type: weaponType,
        name: `${RARITY_JA[rarity]}${src.speciesName}の${ELEMENT_INFO[element].ja}${WEAPON_TYPES[weaponType].ja}`,
        element, atk: Math.round((9 + power * 10) * (1 + 0.18 * (tier - 1)) * rmul),
        rarity, tier, from: src.speciesId, effects,
      },
    };
  }
  if (recipe === 'armor') {
    if (mats.length !== 2 || mats.some((m) => m.kind !== 'scale')) return { error: '防具には鱗が2つ必要です' };
    const resist = {};
    for (const m of mats) for (const [e, v] of Object.entries(m.g.resist)) resist[e] = (resist[e] || 0) + v / 2;
    for (const e of Object.keys(resist)) {
      resist[e] = +clamp(resist[e] * 0.8 * rmul, -0.2, 0.45).toFixed(3);
      if (Math.abs(resist[e]) < 0.02) delete resist[e];
    }
    return {
      item: {
        id: uid(rng, 'e'), slot: 'armor', name: `${RARITY_JA[rarity]}${src.speciesName}の鎧`,
        element: src.g.body, hp: Math.round((30 + tier * 12) * rmul), resist, rarity, tier, from: src.speciesId, effects: {},
      },
    };
  }
  if (recipe === 'acc') {
    if (mats.length !== 1 || mats[0].kind !== 'core') return { error: '装飾品には核が1つ必要です' };
    const b = src.g.behavior;
    const v = (0.06 + tier * 0.015) * rmul;
    const effects = {
      charge: { crit: +v.toFixed(3) },
      ranged: { range: +(v * 2).toFixed(3) },
      swarm:  { aura: src.g.body, auraValue: +(v * 1.5).toFixed(3) },
      flee:   { speed: +(v * 1.6).toFixed(3) },
      caller: { lifesteal: +(v * 0.5).toFixed(3) },
    }[b];
    if (src.g.poison) effects.poison = true;
    const ja = { charge: '闘志', ranged: '鷹目', swarm: '群れ', flee: '逃げ足', caller: '吸命' }[b];
    return {
      item: {
        id: uid(rng, 'e'), slot: 'acc', name: `${RARITY_JA[rarity]}${src.speciesName}の${ja}の護符`,
        element: src.g.body, rarity, tier, from: src.speciesId, effects,
      },
    };
  }
  return { error: '作り方が正しくありません' };
}

export function itemSummary(it) {
  const parts = [];
  if (it.slot === 'weapon') parts.push(`${WEAPON_TYPES[it.type].ja}・${ELEMENT_INFO[it.element].ja}属性・攻撃${it.atk}`, `技:${WEAPON_SKILLS[it.element].ja}`);
  if (it.slot === 'armor') {
    parts.push(`HP+${it.hp}`, `技:${ARMOR_SKILLS[it.element].ja}`);
    const r = Object.entries(it.resist || {}).map(([e, v]) => `${ELEMENT_INFO[e].ja}${v > 0 ? '+' : ''}${Math.round(v * 100)}%`);
    if (r.length) parts.push(`耐性 ${r.join(' ')}`);
  }
  const ef = it.effects || {};
  if (ef.crit) parts.push(`会心+${Math.round(ef.crit * 100)}%`);
  if (ef.range) parts.push(`射程+${Math.round(ef.range * 100)}%`);
  if (ef.aura) parts.push(`味方の${ELEMENT_INFO[ef.aura].ja}耐性+${Math.round(ef.auraValue * 100)}%`);
  if (ef.speed) parts.push(`移動+${Math.round(ef.speed * 100)}%`);
  if (ef.lifesteal) parts.push(`吸収${Math.round(ef.lifesteal * 100)}%`);
  if (ef.poison) parts.push('毒付与');
  return parts.join(' / ');
}

export const expToNext = (lv) => 20 + lv * 15;

/** プロフィールと装備から、戦闘で使う能力値を計算 */
export function playerStats(profile) {
  const eq = (slot) => profile.equipment.find((e) => e.id === profile.equipped[slot]);
  const weapon = eq('weapon') || { type: 'sword', element: 'none', atk: 6, effects: {} };
  const armor = eq('armor') || { element: 'none', hp: 0, resist: {}, effects: {} };
  const accs = [eq('acc1'), eq('acc2')].filter(Boolean);
  const resist = Object.fromEntries(ELEMENTS.map((e) => [e, 0]));
  for (const [e, v] of Object.entries(armor.resist || {})) resist[e] += v;
  const effects = { crit: 0.05, range: 0, speed: 0, lifesteal: 0, poison: !!weapon.effects?.poison, aura: [] };
  for (const a of accs) {
    const ef = a.effects || {};
    effects.crit += ef.crit || 0;
    effects.range += ef.range || 0;
    effects.speed += ef.speed || 0;
    effects.lifesteal += ef.lifesteal || 0;
    if (ef.poison) effects.poison = true;
    if (ef.aura) effects.aura.push({ element: ef.aura, value: ef.auraValue });
  }
  return {
    maxHp: 100 + profile.level * 6 + (armor.hp || 0),
    atk: weapon.atk + profile.level,
    element: weapon.element,
    weaponType: weapon.type,
    bodyElement: armor.element || 'none',
    resist, effects,
    skill1: WEAPON_SKILLS[weapon.element] || WEAPON_SKILLS.none,
    skill2: ARMOR_SKILLS[armor.element || 'none'],
    speed: 78 * (1 + effects.speed),
  };
}
