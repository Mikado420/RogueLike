import balance from '../../data/balance.json';
import weapons from '../../data/weapons.json';
import skills from '../../data/skills.json';
import monsters from '../../data/monsters.json';
import items from '../../data/items.json';
import drops from '../../data/drops.json';
import rarities from '../../data/rarities.json';
import options from '../../data/options.json';
import garden from '../../data/maps/garden.json';
import type { Content, MapDef } from './types';

/** /data の JSON をまとめたもの。サーバーでもそのまま読み込める。 */
export const CONTENT = {
  balance, weapons, skills, monsters, items, drops, rarities, options,
} as unknown as Content;

export const MAPS: Record<string, MapDef> = { garden: garden as MapDef };
