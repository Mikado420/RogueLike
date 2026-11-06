import { describe, expect, it } from 'vitest';
import { CONTENT as C } from '../src/content';
import { magicStoneExpected, onMonsterKilled } from '../src/systems/rewards';
import { makeWorld, spawnAt } from './helpers';

const E = (id: string, lv: number, elite = false) => magicStoneExpected(C, id, lv, { elite });

describe('魔石のドロップ', () => {
  it('レベルが上がるほど、硬い敵ほど多い', () => {
    expect(E('slime', 50)).toBeGreaterThan(E('slime', 5));
    expect(E('boar', 30)).toBeGreaterThan(E('hornet', 30));      // hp 1.2 > 0.75
  });

  it('低レベルの雑魚は数体に 1 個くらい', () => {
    expect(E('slime', 1)).toBeGreaterThan(0.1);
    expect(E('slime', 1)).toBeLessThan(0.5);
  });

  it('エリートは通常の 4 倍、ボスはさらに多く、レイドボスはいちばん多い', () => {
    expect(E('slime', 20, true) / E('slime', 20)).toBeCloseTo(C.balance.magicStone!.elite);
    expect(E('king_slime', 15)).toBeGreaterThan(E('slime', 15, true) * 3);
    expect(E('crystal_colossus', 80)).toBeGreaterThan(E('ice_lich', 80));
  });

  it('ゴーレム系は同じ帯の通常の敵のおよそ 5 倍', () => {
    for (const [g, others] of [['golem', ['slime', 'boar', 'shroom']], ['magma_golem', ['fire_lizard', 'salamander', 'hellhound']], ['ice_golem', ['snow_wolf', 'yeti', 'ice_wraith']]] as const) {
      const avg = others.reduce((s, o) => s + E(o, 40), 0) / others.length;
      const r = E(g, 40) / avg;
      expect(r).toBeGreaterThan(4);
      expect(r).toBeLessThan(6.5);
    }
  });

  it('訓練用の人形は落とさない', () => {
    expect(E('dummy', 50)).toBe(0);
  });

  it('倒すと魔石が足もとに落ちる。練習用のスライムと、呼び出された取り巻きは落とさない', () => {
    const { w, p } = makeWorld(3);
    const count = () => w.area.drops.filter((d) => d.bag?.id === 'refine_stone').reduce((s, d) => s + d.bag!.n, 0);
    // ボスは期待値が大きいので必ず落ちる
    const boss = spawnAt(w, 'king_slime', p.x + 1, p.y, 15);
    boss.damageBy[p.id] = 1;
    onMonsterKilled(w, boss, p);
    expect(count()).toBeGreaterThanOrEqual(Math.floor(E('king_slime', 15)));
    const before = count();
    for (let k = 0; k < 20; k++) {
      const m = spawnAt(w, 'golem', p.x + 1, p.y, 60);
      m.damageBy[p.id] = 1;
      m.spawnKey = 'practice:x';
      onMonsterKilled(w, m, p);
      const s = spawnAt(w, 'golem', p.x + 1, p.y, 60);
      s.damageBy[p.id] = 1;
      s.summonedBy = 999;
      onMonsterKilled(w, s, p);
    }
    expect(count()).toBe(before);
  });
});
