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
