import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng';
import { CONTENT } from '../src/content';
import { createItem, rollEquipDrops, tierFor } from '../src/systems/loot';
import { makeTraining, makeWorld, spawnAt, tick } from './helpers';

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

describe('アイテム生成とドロップ', () => {
  it('レアリティごとのオプション数と結晶枠', () => {
    const rng = new Rng(1);
    for (const r of CONTENT.rarities.order) {
      const it = createItem(1, 'w_oneHandSword', 0, 1, r, rng, CONTENT);
      const d = CONTENT.rarities.defs[r];
      expect(it.options.length).toBe(d.options);
      expect(it.crystals.length).toBeGreaterThanOrEqual(d.slots[0]);
      expect(it.crystals.length).toBeLessThanOrEqual(d.slots[1]);
    }
  });

  it('装備レベルが上がると段（tier）が上がり、数値も上がる', () => {
    const rng = new Rng(2);
    expect(tierFor(1, CONTENT)).toBe(0);
    expect(tierFor(100, CONTENT)).toBe(CONTENT.equipment.tiers.length - 1);
    const lo = createItem(1, 'w_oneHandSword', tierFor(1, CONTENT), 1, 'common', rng, CONTENT);
    const hi = createItem(2, 'w_oneHandSword', tierFor(60, CONTENT), 60, 'common', rng, CONTENT);
    expect(hi.stats.atk!).toBeGreaterThan(lo.stats.atk!);
    expect(hi.reqLevel).toBeGreaterThan(lo.reqLevel);
  });

  it('ボス表ではコモンが出ない。レア率が上がると上位が増える', () => {
    const { w } = makeWorld(31);
    const counts = { base: 0, boosted: 0 };
    for (let i = 0; i < 300; i++) {
      for (const it of rollEquipDrops(w, 'boss_volcano', 30)) {
        expect(it.rarity).not.toBe('common');
        if (it.rarity === 'legend' || it.rarity === 'mythic') counts.base++;
      }
      for (const it of rollEquipDrops(w, 'boss_volcano', 30, { rareRatePct: 100 })) {
        if (it.rarity === 'legend' || it.rarity === 'mythic') counts.boosted++;
      }
    }
    expect(counts.boosted).toBeGreaterThan(counts.base);
  });
});

describe('シミュレーション', () => {
  it('同じシード・同じ入力なら同じ結果になる', () => {
    const run = () => {
      const { w, p } = makeWorld(123);
      tick(w, p, { move: { x: 1, y: 0.4 }, attack: true }, 400);
      return { x: p.x, y: p.y, hp: p.hp, mp: p.mp, mons: w.area.monsters.map((m) => [m.x, m.y, m.hp]) };
    };
    expect(run()).toEqual(run());
  });

  it('通常攻撃を当てるとMPが溜まり、倒すと経験値とゴールドが入る', () => {
    const { w, p } = makeTraining('oneHandSword', 1, 8, 5);
    const m = spawnAt(w, 'slime', 14, 18, 1);
    m.homeX = m.x; m.homeY = m.y;
    let gained = false;
    const gold0 = p.char.gold;
    for (let i = 0; i < 600 && !m.dead; i++) {
      p.hp = p.stats.maxHp;
      p.x = m.x - 1; p.y = m.y;
      tick(w, p, { attack: true });
      if (p.mp > 0) gained = true;
    }
    expect(gained).toBe(true);
    expect(m.dead).toBe(true);
    expect(p.char.exp).toBeGreaterThan(0);
    expect(p.char.gold).toBeGreaterThan(gold0);
    expect(p.char.counters.kills).toBe(1);
  });

  it('回避中は無敵でスタミナが減る', () => {
    const { w, p } = makeWorld(9);
    const st = p.st;
    tick(w, p, { dodge: true, move: { x: 1, y: 0 } });
    expect(p.st).toBeLessThan(st);
    expect(p.iframes).toBeGreaterThan(0);
  });

  it('スキルは MP を使い、クールダウンが付く', () => {
    const { w, p, ch } = makeWorld(10);
    ch.skills.slash = 1;
    ch.skillSlots.oneHandSword = ['slash', null, null, null];
    p.mp = 100;
    tick(w, p, { skill: 0 });
    expect(p.mp).toBeLessThan(100);
    expect(p.skillCd.slash).toBeGreaterThan(0);
    const mp = p.mp;
    tick(w, p, { skill: 0 });
    expect(p.mp).toBe(mp);
  });

  it('バフスキルで ATK が上がり、時間で切れる', () => {
    const { w, p, ch } = makeWorld(11);
    ch.skills.brave_aura = 5;
    ch.skillSlots.oneHandSword = ['brave_aura', null, null, null];
    p.mp = 100;
    const atk = p.stats.atk;
    tick(w, p, { skill: 0 }, 2);
    expect(p.stats.atk).toBeGreaterThan(atk);
    tick(w, p, {}, 20 * 40);
    expect(p.statuses.find((s) => s.id === 'brave')).toBeUndefined();
    expect(p.stats.atk).toBe(atk);
  });
});

describe('モンスターAI', () => {
  it('近づいたプレイヤーを見つけて追いかけ、予兆つきで攻撃する', () => {
    const { w, p } = makeTraining('oneHandSword', 30, 8, 11);
    const boss = spawnAt(w, 'ignaros', 14, 18, 30);
    p.x = boss.x - 3.5; p.y = boss.y - 1;
    let telegraphed = false, chased = false, hurt = false;
    for (let i = 0; i < 200; i++) {
      const hp = p.hp;
      tick(w, p);
      if (boss.ai === 'chase') chased = true;
      if (p.hp < hp || p.dead) hurt = true;
      if (w.area.strikes.some((s) => s.telegraph && s.ownerId === boss.id)) telegraphed = true;
    }
    expect(chased).toBe(true);
    expect(telegraphed).toBe(true);
    expect(hurt).toBe(true);
  });

  it('ボスを倒すとドロップが出て、近づくと拾える', () => {
    const { w, p } = makeTraining('oneHandSword', 30, 8, 12);
    const boss = spawnAt(w, 'ignaros', 14, 18, 30);
    boss.hp = 1;
    p.x = boss.x - 1.2; p.y = boss.y;
    for (let i = 0; i < 40 && !boss.dead; i++) tick(w, p, { attack: true });
    expect(boss.dead).toBe(true);
    const d = w.area.drops.find((x) => x.item)!;
    expect(d).toBeDefined();
    const before = p.char.inventory.length;
    p.x = d.x; p.y = d.y; p.dead = false; p.hp = p.stats.maxHp;
    tick(w, p);
    expect(p.char.inventory.length).toBeGreaterThan(before);
  });
});
