import { newAccount, newCharacter } from '../src/save';
import { createWorld } from '../src/systems/world';
import { emptyInput, type Player, type PlayerInput, type World } from '../src/state';
import { step } from '../src/systems/world';

export function makeWorld(seed = 1) {
  const acc = newAccount(1000, seed);
  const ch = newCharacter(acc, 'テスト', { body: 0, hair: 0 }, 1000);
  const w = createWorld({ account: acc, characterId: ch.id, seed, now: 0 });
  return { w, acc, ch, p: w.players[0] };
}

export function tick(w: World, p: Player, input: Partial<PlayerInput> = {}, n = 1) {
  for (let i = 0; i < n; i++) step(w, new Map([[p.id, { ...emptyInput(), ...input }]]));
}

import { CONTENT } from '../src/content';
import { createItem, tierFor } from '../src/systems/loot';
import { spawnMonster } from '../src/systems/world';
import { Rng } from '../src/rng';
import type { WeaponType } from '../src/core';

/** 訓練場で、指定の武器を持ったキャラと人形を用意する */
export function makeTraining(weapon: WeaponType, level = 30, dist = 1.0, seed = 3) {
  const acc = newAccount(1000, seed);
  const ch = newCharacter(acc, 'T', { body: 0, hair: 0 }, 1000);
  ch.level = level;
  ch.location = { area: 'training', x: 8.5, y: 13.5 };
  const base = Object.keys(CONTENT.equipment.bases).find((id) => CONTENT.equipment.bases[id].kind === weapon)!;
  const it = createItem(acc.nextUid++, base, tierFor(level, CONTENT), level, 'common', new Rng(1), CONTENT);
  it.options = [];
  ch.equipment.weapon = it;
  const w = createWorld({ account: acc, characterId: ch.id, seed, now: 0 });
  const p = w.players[0];
  const m = spawnMonster(w, { key: 'd', monster: 'dummy', x: p.x + dist, y: p.y, level: [level, level], monsterId: -1, respawnAt: 0 }, { level, scale: { hp: 1e6 } });
  m.facing = Math.PI;
  return { w, p, m, ch };
}

export function dmgOf(w: World, events: { type: string; src?: number; amount?: number }[], src: number): number {
  return events.filter((e) => e.type === 'damage' && e.src === src).reduce((s, e) => s + (e.amount ?? 0), 0);
}
