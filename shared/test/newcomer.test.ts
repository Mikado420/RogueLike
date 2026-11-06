import { describe, expect, it } from 'vitest';
import { CONTENT } from '../src/content';
import { newAccount, newCharacter } from '../src/save';
import { addPlayer, createWorld } from '../src/systems/world';
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

describe('襲撃中の街', () => {
  const start = (seed: number) => {
    const { w, p } = makeWorld(seed);
    w.clock = CONTENT.invasion.every * 60000 * 100 + 1000;
    return { w, p };
  };

  it('起きる地点の聖域にいれば、襲撃の間ずっと狙われず、魔物も集まってこない', () => {
    const { w, p } = start(11);
    const sp = { ...w.area.playerSpawn };
    const hp = p.hp;
    for (let i = 0; i < 20 * 70; i++) { p.x = sp.x; p.y = sp.y; tick(w, p); }
    expect(w.area.monsters.some((m) => m.invader)).toBe(true);
    expect(p.hp).toBe(hp);
    expect(p.dead).toBe(false);
    const r = CONTENT.invasion.sanctuary!;
    for (const m of w.area.monsters.filter((x) => x.invader && !x.dead)) {
      expect(m.targetId === p.id && m.ai === 'chase').toBe(false);
      expect(Math.hypot(m.homeX - sp.x, m.homeY - sp.y)).toBeGreaterThan(r);
    }
  });

  it('魔物の強さは、狙われた人のレベルに合わせる', () => {
    const { w, p } = start(12);
    p.char.level = 3;
    // 同じ街に Lv60 の人がいても、Lv3 の人を狙う魔物は弱いまま（聖域で待つ Lv60 の人は狙われない）
    const acc2 = newAccount(2000, 99);
    const ch2 = newCharacter(acc2, 'つよい', { body: 0, hair: 0 }, 2000);
    ch2.level = 60; ch2.tutorial.done = true;
    const sp = w.area.playerSpawn;
    const p2 = addPlayer(w, acc2, ch2.id, { x: sp.x, y: sp.y });
    p.x = sp.x + CONTENT.invasion.sanctuary! + 4; p.y = sp.y;
    for (let i = 0; i < 80; i++) { p2.x = sp.x; p2.y = sp.y; tick(w, p); }
    const inv = w.area.monsters.filter((m) => m.invader);
    expect(inv.length).toBeGreaterThan(0);
    for (const m of inv) expect(m.level).toBeLessThanOrEqual(3 + CONTENT.invasion.levelOffset[1]);
  });
});
