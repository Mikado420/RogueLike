import balance from '../../../data/balance.json';
import weapons from '../../../data/weapons.json';
import skills from '../../../data/skills.json';
import statuses from '../../../data/statuses.json';
import monsters from '../../../data/monsters.json';
import equipment from '../../../data/equipment.json';
import rarities from '../../../data/rarities.json';
import options from '../../../data/options.json';
import drops from '../../../data/drops.json';
import materials from '../../../data/materials.json';
import areas from '../../../data/areas.json';
import npcs from '../../../data/npcs.json';
import shops from '../../../data/shops.json';
import text from '../../../data/text.json';
import tiles from '../../../data/tiles.json';
import uniques from '../../../data/uniques.json';
import mythics from '../../../data/mythics.json';
import sets from '../../../data/sets.json';
import crystals from '../../../data/crystals.json';
import refine from '../../../data/refine.json';
import storage from '../../../data/storage.json';
import looks from '../../../data/looks.json';
import time from '../../../data/time.json';
import lumina from '../../../data/maps/lumina.json';
import ember from '../../../data/maps/ember.json';
import palettes from '../../../data/palettes.json';
import weather from '../../../data/weather.json';
import ambience from '../../../data/ambience.json';
import music from '../../../data/music.json';
import difficulties from '../../../data/difficulties.json';
import dungeons from '../../../data/dungeons.json';
import tower from '../../../data/tower.json';
import raid from '../../../data/raid.json';
import invasion from '../../../data/invasion.json';
import missions from '../../../data/missions.json';
import titles from '../../../data/titles.json';
import achievements from '../../../data/achievements.json';
import codex from '../../../data/codex.json';
import base from '../../../data/base.json';
import gathering from '../../../data/gathering.json';
import subjobs from '../../../data/subjobs.json';
import recipes from '../../../data/recipes.json';
import pets from '../../../data/pets.json';
import arena from '../../../data/maps/arena.json';
import type { Content } from './types';

export * from './types';

/** /data の JSON をまとめたもの。サーバーでもそのまま読み込める。 */
export const CONTENT = {
  balance, weapons, skills: skills.skills, trees: skills.trees, statuses, monsters, equipment, rarities, options,
  drops, materials, areas, npcs, shops, tiles, text, uniques, mythics, sets, crystals, refine, storage, looks, time,
  maps: { lumina, ember, arena },
  palettes, weather, ambience, music,
  difficulties, dungeons, tower, raids: raid.raids, invasion, missions, titles, achievements, codex, base, gathering, subjobs, recipes, pets,
} as unknown as Content;

/** 袋に入るもの（素材・消耗品・結晶）の名前と色 */
export function bagInfo(id: string): { name: string; color: string; kind: string; price: number } {
  const m = CONTENT.materials[id];
  if (m) return { name: m.name, color: m.color, kind: m.kind, price: m.price };
  const c = CONTENT.crystals[id];
  if (c) return { name: c.name, color: c.color, kind: 'crystal', price: Math.round(c.recover / 4) };
  return { name: id, color: '#ffffff', kind: 'material', price: 0 };
}

/** data/text.json の文言。{0} {1} を差し込める */
export function txt(key: string, ...args: (string | number)[]): string {
  let s = CONTENT.text[key] ?? key;
  args.forEach((a, i) => { s = s.replace(`{${i}}`, String(a)); });
  return s;
}
