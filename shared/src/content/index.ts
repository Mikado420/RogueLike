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
import garden from '../../../data/maps/garden.json';
import arena from '../../../data/maps/arena.json';
import type { Content } from './types';

export * from './types';

/** /data の JSON をまとめたもの。サーバーでもそのまま読み込める。 */
export const CONTENT = {
  balance, weapons, skills: skills.skills, trees: skills.trees, statuses, monsters, equipment, rarities, options,
  drops, materials, areas, npcs, shops, tiles, text,
  maps: { garden, arena },
} as unknown as Content;

/** data/text.json の文言。{0} {1} を差し込める */
export function txt(key: string, ...args: (string | number)[]): string {
  let s = CONTENT.text[key] ?? key;
  args.forEach((a, i) => { s = s.replace(`{${i}}`, String(a)); });
  return s;
}
