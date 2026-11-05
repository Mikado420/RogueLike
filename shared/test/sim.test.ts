import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng';
import { addPlayer, createWorld, emptyInput, step, type PlayerInput } from '../src/sim';
import { createItem } from '../src/loot';
import { CONTENT } from '../src/content';

describe('乱数', () => {
  it('シードが同じなら同じ並び', () => {
    const a = new Rng(7), b = new Rng(7);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it('[0,1) に収まる', () => {
    const r = new Rng(3);
    for (let i = 0; i < 1000; i++) { const v = r.next(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
});

describe('アイテム生成', () => {
  it('レアリティごとのオプション数と結晶枠', () => {
    const rng = new Rng(1);
    for (const r of CONTENT.rarities.order) {
      const it = createItem(1, 'sword_iron', r, rng);
      const d = CONTENT.rarities.defs[r];
      expect(it.options.length).toBe(d.options);
      expect(it.crystals.length).toBeGreaterThanOrEqual(d.slots[0]);
      expect(it.crystals.length).toBeLessThanOrEqual(d.slots[1]);
    }
  });
});

describe('シミュレーション', () => {
  it('同じシード・同じ入力なら同じ結果になる', () => {
    const run = () => {
      const w = createWorld(123);
      const p = addPlayer(w, 'A');
      const input: PlayerInput = { ...emptyInput(), move: { x: 1, y: 0.4 }, attack: true };
      for (let i = 0; i < 400; i++) step(w, new Map([[p.id, input]]));
      return { x: p.x, y: p.y, hp: p.hp, mp: p.mp, mons: w.monsters.map((m) => [m.x, m.y, m.hp]) };
    };
    expect(run()).toEqual(run());
  });

  it('通常攻撃を当てるとMPが溜まり、倒すと消える', () => {
    const w = createWorld(5);
    const p = addPlayer(w, 'A');
    const m = w.monsters.find((x) => x.defId === 'slime')!;
    p.x = m.x - 1; p.y = m.y;
    m.homeX = m.x; m.homeY = m.y;
    const input: PlayerInput = { ...emptyInput(), attack: true };
    let gained = false;
    for (let i = 0; i < 600 && !m.dead; i++) {
      p.hp = p.stats.maxHp;
      step(w, new Map([[p.id, input]]));
      if (p.mp > 0) gained = true;
      p.x = m.x - 1; p.y = m.y;
    }
    expect(gained).toBe(true);
    expect(m.dead).toBe(true);
  });

  it('回避中は無敵でスタミナが減る', () => {
    const w = createWorld(9);
    const p = addPlayer(w, 'A');
    const st = p.st;
    step(w, new Map([[p.id, { ...emptyInput(), dodge: true, move: { x: 1, y: 0 } }]]));
    expect(p.st).toBeLessThan(st);
    expect(p.iframes).toBeGreaterThan(0);
  });
});

describe('モンスターAI', () => {
  it('近づいたプレイヤーを見つけて追いかけ、攻撃する', () => {
    const w = createWorld(11);
    const p = addPlayer(w, 'A');
    const boss = w.monsters.find((m) => m.defId === 'ignaros')!;
    p.x = boss.x - 3.5; p.y = boss.y - 1;
    let telegraphed = false, chased = false, hurt = false;
    for (let i = 0; i < 200; i++) {
      const hp = p.hp;
      step(w, new Map([[p.id, emptyInput()]]));
      if (boss.ai === 'chase') chased = true;
      if (p.hp < hp || p.dead) hurt = true;
      if (w.strikes.some((s) => s.telegraph && s.ownerId === boss.id)) telegraphed = true;
    }
    expect(chased).toBe(true);
    expect(telegraphed).toBe(true);
    expect(hurt).toBe(true);
  });

  it('ボスを倒すとドロップが出て、近づくと拾える', () => {
    const w = createWorld(12);
    const p = addPlayer(w, 'A');
    const boss = w.monsters.find((m) => m.defId === 'ignaros')!;
    boss.hp = 1;
    p.x = boss.x - 1.2; p.y = boss.y;
    for (let i = 0; i < 40 && !boss.dead; i++) step(w, new Map([[p.id, { ...emptyInput(), attack: true }]]));
    expect(boss.dead).toBe(true);
    expect(w.drops.length).toBeGreaterThan(0);
    const before = p.inventory.length;
    const d = w.drops[0];
    p.x = d.x; p.y = d.y; p.dead = false; p.hp = p.stats.maxHp;
    step(w, new Map([[p.id, emptyInput()]]));
    expect(p.inventory.length).toBeGreaterThan(before);
  });
});
