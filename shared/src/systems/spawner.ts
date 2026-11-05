import type { Monster, World } from '../state';
import { circleHitsMap } from '../map';
import { isNight } from './time';
import { currentWeather, weatherDef } from './weather';
import { spawnMonster } from './world';
import { sec } from './util';

/**
 * フィールドの湧き（数を保つ・夜だけの魔物・霧の奇襲型・精鋭）と、フィールドボスの時間湧き。
 */

export function fieldBossSlot(w: World): number {
  return Math.floor(w.clock / (w.content.balance.world.fieldBossInterval * 60000));
}

/** 次にフィールドボスが出る時刻（ミリ秒）。今いれば null */
export function nextFieldBossAt(w: World, areaId: string): number | null {
  const slot = fieldBossSlot(w);
  const ms = w.content.balance.world.fieldBossInterval * 60000;
  if (w.shared.fieldBoss[areaId] !== slot) return null;
  return (slot + 1) * ms;
}

function pickSpecies(w: World): string | null {
  const def = w.content.areas[w.area.id];
  const weights: Record<string, number> = {};
  for (const m of def.monsters ?? []) weights[m.id] = (weights[m.id] ?? 0) + m.w;
  if (isNight(w)) for (const m of def.night ?? []) weights[m.id] = (weights[m.id] ?? 0) + m.w;
  const amb = weatherDef(w).ambushMul ?? 1;
  for (const m of def.ambush ?? []) weights[m.id] = (weights[m.id] ?? 0) + m.w * amb;
  return Object.keys(weights).length ? w.rng.weighted(weights) : null;
}

/** 入口から遠いほど強い */
function levelAt(w: World, x: number, y: number): number {
  const def = w.content.areas[w.area.id];
  const [lo, hi] = def.level;
  const entry = w.area.playerSpawn;
  const diag = Math.hypot(w.area.map.width, w.area.map.height) * 0.75;
  const t = Math.min(1, Math.hypot(x - entry.x, y - entry.y) / diag);
  const spread = w.content.balance.world.levelSpread;
  return Math.max(1, Math.round(lo + (hi - lo) * t + w.rng.int(-spread, spread)));
}

export function spawnFieldMonster(w: World): Monster | null {
  const area = w.area;
  const species = pickSpecies(w);
  if (!species) return null;
  const wb = w.content.balance.world;
  for (let tries = 0; tries < 30; tries++) {
    const x = w.rng.int(2, area.map.width - 3) + 0.5;
    const y = w.rng.int(2, area.map.height - 3) + 0.5;
    if (circleHitsMap(area.map, x, y, 0.6)) continue;
    if (w.players.some((p) => Math.hypot(p.x - x, p.y - y) < wb.spawnMinDist)) continue;
    if (area.exits.some((e) => x >= e.rect[0] - 4 && x <= e.rect[2] + 4 && y >= e.rect[1] - 4 && y <= e.rect[3] + 4)) continue;
    if (Object.values(area.spots).some((s) => Math.hypot(s.x - x, s.y - y) < 4)) continue;
    const level = levelAt(w, x, y);
    const elite = w.rng.chance(wb.eliteChance * (weatherDef(w).eliteMul ?? 1));
    const m = spawnMonster(w, { key: 'field', monster: species, x, y, level: [level, level], monsterId: -1, respawnAt: 0 }, { level, elite });
    m.hidden = !!w.content.monsters[species].ambush;
    return m;
  }
  return null;
}

/** フィールドの毎tick処理 */
export function updateField(w: World) {
  const area = w.area;
  if (area.type !== 'field') return;
  const def = w.content.areas[area.id];
  if (!def?.monsters) return;
  // 昼になったら夜の魔物は帰る（戦っていないもの）
  if (w.tick % 20 === 0 && !isNight(w)) {
    for (const m of area.monsters) {
      if (w.content.monsters[m.defId].nightOnly && m.ai === 'wander') { m.dead = true; m.hp = 0; }
    }
  }
  if (--area.spawnTimer <= 0) {
    area.spawnTimer = sec(w, w.content.balance.world.spawnInterval);
    const alive = area.monsters.filter((m) => !m.dead && !m.fieldBoss).length;
    if (alive < (def.density ?? 0)) spawnFieldMonster(w);
  }
  updateFieldBoss(w);
}

export function updateFieldBoss(w: World) {
  const area = w.area;
  const def = w.content.areas[area.id];
  const fb = def?.fieldBoss;
  if (!fb || !area.spots.boss) return;
  const slot = fieldBossSlot(w);
  if (w.shared.fieldBoss[area.id] === slot) return;
  if (area.monsters.some((m) => m.fieldBoss && !m.dead)) return;
  const sp = area.spots.boss;
  const m = spawnMonster(w, { key: 'fieldBoss', monster: fb.id, x: sp.x, y: sp.y, level: [fb.level, fb.level], monsterId: -1, respawnAt: 0 }, { level: fb.level });
  m.fieldBoss = true;
  area.fieldBossSlot = slot;
  w.events.push({ type: 'worldNotice', key: 'notice.fieldBoss', args: [w.content.monsters[fb.id].name, def.name] });
}

/** 天候の区切りが変わったら、レア天候を知らせる */
export function updateWeatherNotices(w: World) {
  const slot = Math.floor(w.clock / (w.content.weather.slotMinutes * 60000));
  if (slot === w.lastWeatherSlot) return;
  w.lastWeatherSlot = slot;
  for (const [id, a] of Object.entries(w.content.areas)) {
    if (!a.weather) continue;
    const wt = currentWeather(w, id);
    const d = w.content.weather.types[wt];
    if (d?.rare) w.events.push({ type: 'worldNotice', key: 'notice.rareWeather', args: [a.name, d.name], rare: true });
  }
}
