import type { Item, Monster, Player, World, Drop, Actor } from '../state';
import { circleHitsMap } from '../map';
import { gainExp, levelDiffMul, monsterExp } from './progression';
import { rollEquipDrops } from './loot';
import { findPlayer, isBoss, newId, sec } from './util';
import { addCounter } from './counters';

/** モンスターを倒したときの報酬（経験値・ゴールド・装備・素材） */
export function onMonsterKilled(w: World, m: Monster, by: Actor | null) {
  const c = w.content;
  const def = c.monsters[m.defId];
  const sp = w.area.spawns.find((s) => s.key === m.spawnKey);
  if (sp) {
    sp.monsterId = -1;
    sp.respawnAt = w.tick + sec(w, def.respawn ?? (def.boss ? c.balance.monster.bossRespawn : c.balance.monster.respawn));
  }
  // 削った人（いなければ倒した人）に配る
  const ids = Object.keys(m.damageBy).map(Number);
  const killer = by && by.kind === 'player' ? by : null;
  const players = new Set<Player>();
  for (const id of ids) { const p = findPlayer(w, id); if (p && !p.dead) players.add(p); }
  if (killer) players.add(killer);
  if (players.size === 0) return;

  const eliteMul = m.elite ? c.balance.monster.eliteMul : 1;
  const mb = c.balance.monster;
  for (const p of players) {
    const exp = monsterExp(m.level, def, c, eliteMul * m.scale.exp) * levelDiffMul(p.char.level, m.level, c);
    gainExp(w, p, exp);
    const goldBase = (mb.gold[0] + mb.gold[1] * Math.pow(m.level, mb.gold[2])) * (def.gold ?? 1) * eliteMul * m.scale.gold;
    const gold = Math.max(1, Math.round(goldBase * (1 + (p.stats.m.goldPct ?? 0) / 100) * w.rng.range(0.8, 1.2)));
    p.char.gold += gold;
    w.events.push({ type: 'gold', playerId: p.id, amount: gold });
    addCounter(w, p, 'kills', 1);
    addCounter(w, p, `kill.${m.defId}`, 1);
    if (isBoss(w, m)) addCounter(w, p, 'bossKills', 1);
  }

  // ドロップは最も削った人のもの
  const owner = killer ?? [...players][0];
  const mods = owner.stats.m;
  const table = def.boss ? def.drops : m.elite ? 'elite' : def.drops;
  for (const item of rollEquipDrops(w, table, m.level, mods)) placeDrop(w, m, { item }, owner.id);
  for (const mat of def.mats ?? []) {
    const chance = Math.min(1, mat.chance * (1 + (mods.dropRatePct ?? 0) / 100));
    if (!w.rng.chance(chance)) continue;
    const n = w.rng.int(mat.min ?? 1, mat.max ?? 1);
    placeDrop(w, m, { bag: { id: mat.id, n } }, owner.id);
  }
}

export function placeDrop(w: World, at: { x: number; y: number }, what: { item?: Item; bag?: { id: string; n: number } }, ownerId: number) {
  const c = w.content;
  const sc = c.balance.drop.scatter;
  let x = at.x, y = at.y;
  for (let tries = 0; tries < 8; tries++) {
    const nx = at.x + w.rng.range(-sc, sc) * 1.6;
    const ny = at.y + w.rng.range(-sc, sc) * 1.6;
    if (!circleHitsMap(w.area.map, nx, ny, 0.2)) { x = nx; y = ny; break; }
  }
  const d: Drop = { id: newId(w), x, y, item: what.item ?? null, bag: what.bag, ticksLeft: sec(w, c.balance.drop.lifetime), ownerId };
  w.area.drops.push(d);
  w.events.push({ type: 'drop', id: d.id, rarity: what.item?.rarity ?? null, x, y });
}

export function onPlayerKilled(w: World, p: Player) {
  p.respawnTicks = sec(w, w.content.balance.player.respawnTime);
  p.dodgeTicks = 0;
  p.lock = 0;
  p.charge = 0;
  w.events.push({ type: 'death', id: p.id, x: p.x, y: p.y, boss: false, player: true });
  addCounter(w, p, 'deaths', 1);
}
