import { describe, expect, it } from 'vitest';
import { CONTENT } from '../src/content';
import { newAccount, newCharacter } from '../src/save';
import { createWorld } from '../src/systems/world';
import { applyCommand } from '../src/systems/commands';
import { onPlayerKilled } from '../src/systems/rewards';
import { makeWorld, spawnAt, tick } from './helpers';

/** チュートリアルを済ませていない、作ったばかりのキャラ */
function freshWorld(seed = 1) {
  const acc = newAccount(1000, seed);
  const ch = newCharacter(acc, 'しんじん', { body: 0, hair: 0 }, 1000);
  const w = createWorld({ account: acc, characterId: ch.id, seed, now: 0 });
  return { w, ch, p: w.players[0] };
}

describe('はじめての人にやさしく', () => {
  it('入口の安全地帯には魔物が出ず、練習用のスライムが 1 体だけいる。MP は満タン', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { w, p } = freshWorld(seed);
      expect(w.area.id).toBe(CONTENT.tutorial.area);
      expect(w.area.safeRadius).toBeGreaterThan(0);
      const sp = w.area.playerSpawn;
      const others = w.area.monsters.filter((m) => !m.dead && !m.spawnKey.startsWith('practice:'));
      for (const m of others) expect(Math.hypot(m.x - sp.x, m.y - sp.y)).toBeGreaterThanOrEqual(w.area.safeRadius);
      const practice = w.area.monsters.filter((m) => m.spawnKey === `practice:${p.char.id}`);
      expect(practice.length).toBe(1);
      expect(Math.hypot(practice[0].x - p.x, practice[0].y - p.y)).toBeLessThan(4);
      expect(p.mp).toBe(p.stats.maxMp);
    }
  });

  it('練習用のスライムは、持ち主が去ると消える（共有のフィールドにたまらない）', () => {
    const { w, p } = freshWorld(2);
    const key = `practice:${p.char.id}`;
    expect(w.area.monsters.some((m) => !m.dead && m.spawnKey === key)).toBe(true);
    p.char.tutorial.done = true;
    tick(w, p, {}, 40);
    expect(w.area.monsters.some((m) => !m.dead && m.spawnKey === key)).toBe(false);
  });

  it('安全地帯にいる間は、そばの魔物も襲ってこない', () => {
    const { w, p } = freshWorld(7);
    const hornet = spawnAt(w, 'hornet', p.x + 2, p.y, 5);
    const hp = p.hp;
    tick(w, p, {}, 200);
    expect(hornet.ai).not.toBe('chase');
    expect(p.hp).toBe(hp);
  });

  it('フィールドで倒れると、最後に寄った街で起きる', () => {
    const { w, p } = freshWorld(3);
    p.dead = true; p.hp = 0;
    onPlayerKilled(w, p);
    tick(w, p, {}, CONTENT.balance.tickRate * (CONTENT.balance.player.respawnTime + 1));
    expect(p.dead).toBe(false);
    expect(p.mp).toBe(p.stats.maxMp);
    // ひとり用のワールドでは、移動の予約がすぐ処理されて街に移っている
    expect(p.transition?.to ?? w.area.id).toBe(CONTENT.balance.world.startTown);
  });

  it('武器の師範からは、そばにいるときに 1 本だけもらえる', () => {
    const { w, p, ch } = makeWorld(4);
    const npc = w.area.npcs.find((n) => n.npc === 'weapon_master')!;
    expect(npc).toBeTruthy();
    expect(ch.inventory.length).toBe(0);
    p.x = npc.x + 10; p.y = npc.y;
    applyCommand(w, p, { type: 'starterWeapon', base: 'w_bow' });
    expect(ch.inventory.length).toBe(0);
    p.x = npc.x; p.y = npc.y + 1;
    applyCommand(w, p, { type: 'starterWeapon', base: 'w_not_a_weapon' });
    expect(ch.inventory.length).toBe(0);
    applyCommand(w, p, { type: 'starterWeapon', base: 'w_bow' });
    expect(ch.inventory.map((i) => i.base)).toEqual(['w_bow']);
    applyCommand(w, p, { type: 'starterWeapon', base: 'w_staff' });
    expect(ch.inventory.length).toBe(1);
    expect(ch.starterWeapon).toBe('w_bow');
  });
});

describe('なくなったミッション', () => {
  it('セーブに残っていた侵攻のミッションは、別のミッションに差し替わる', async () => {
    const { ensureMissions } = await import('../src/systems/quest');
    const { w, p } = makeWorld(5);
    ensureMissions(w, p);
    const keep = p.char.missions.weekly[1];
    p.char.missions.weekly[0] = { id: 'invasion', counter: 'invasions', n: 2, base: 0, claimed: false };
    ensureMissions(w, p);
    const ids = p.char.missions.weekly.map((m) => m.id);
    expect(ids).not.toContain('invasion');
    expect(new Set(ids).size).toBe(ids.length);
    if (keep) expect(p.char.missions.weekly[1]).toEqual(keep);
  });
});
