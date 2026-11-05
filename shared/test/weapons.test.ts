import { describe, expect, it } from 'vitest';
import { emptyInput, type GameEvent } from '../src/state';
import { step } from '../src/systems/world';
import { applyStatus } from '../src/systems/status';
import { chargeLevel, isOnBeat, magazineSize } from '../src/systems/weapons';
import { CONTENT } from '../src/content';
import { makeTraining } from './helpers';
import type { World, Player } from '../src/state';

function run(w: World, p: Player, ticks: number, input: Partial<ReturnType<typeof emptyInput>> = {}): GameEvent[] {
  const all: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) all.push(...step(w, new Map([[p.id, { ...emptyInput(), aim: { x: 1, y: 0 }, ...input }]])));
  return all;
}
const dmg = (ev: GameEvent[], src: number) => ev.reduce((s, e) => s + (e.type === 'damage' && e.src === src ? e.amount : 0), 0);

describe('両手剣：溜め', () => {
  it('長く溜めて放すほど一撃が重い', () => {
    const a = makeTraining('twoHandSword');
    run(a.w, a.p, 2, { attack: true });
    const tap = dmg(run(a.w, a.p, 6), a.p.id);
    const b = makeTraining('twoHandSword');
    run(b.w, b.p, 40, { attack: true });
    expect(chargeLevel(b.w, b.p)).toBe(3);
    const full = dmg(run(b.w, b.p, 6), b.p.id);
    expect(full).toBeGreaterThan(tap * 2);
  });

  it('溜めている間は移動が遅い', () => {
    const { w, p } = makeTraining('twoHandSword', 30, 6);
    const x0 = p.x;
    run(w, p, 20, { attack: true, move: { x: 0, y: 1 } });
    const charged = Math.abs(p.y - 13.5);
    const b = makeTraining('twoHandSword', 30, 6);
    run(b.w, b.p, 20, { move: { x: 0, y: 1 } });
    expect(charged).toBeLessThan(Math.abs(b.p.y - 13.5));
    expect(p.x).toBeCloseTo(x0, 5);
  });
});

describe('銃：弾数とリロード', () => {
  it('弾を撃ち切るとリロードし、終わると弾が戻る', () => {
    const { w, p } = makeTraining('gun', 30, 5);
    const mag = magazineSize(w, p);
    let reloads = 0;
    for (let i = 0; i < 200 && reloads === 0; i++) {
      for (const e of run(w, p, 1, { attack: true })) if (e.type === 'reload' && !e.done) reloads++;
    }
    expect(reloads).toBe(1);
    expect(p.ammo).toBe(0);
    const ev = run(w, p, 60);
    expect(ev.some((e) => e.type === 'reload' && e.done)).toBe(true);
    expect(p.ammo).toBe(mag);
  });

  it('背面から撃つと倍率が上がる', () => {
    const front = makeTraining('gun', 30, 5);
    front.m.facing = Math.PI;
    const f = run(front.w, front.p, 5, { attack: true }).filter((e) => e.type === 'damage');
    const back = makeTraining('gun', 30, 5);
    back.m.facing = 0;
    const b = run(back.w, back.p, 5, { attack: true }).filter((e) => e.type === 'damage');
    expect(f.length).toBeGreaterThan(0);
    expect(f.every((e) => e.type === 'damage' && !e.back)).toBe(true);
    // 当たった相手はこちらを向くので、背面になるのは最初の一発
    expect(b[0].type === 'damage' && b[0].back).toBe(true);
  });
});

describe('手甲：コンボ', () => {
  it('当て続けるとコンボが増え、時間が空くと切れる', () => {
    const { w, p } = makeTraining('knuckles', 30, 0.9);
    run(w, p, 60, { attack: true });
    expect(p.combo).toBeGreaterThan(5);
    run(w, p, 60);
    expect(p.combo).toBe(0);
  });

  it('コンボが多いほど同じ攻撃のダメージが上がる', () => {
    const a = makeTraining('knuckles', 30, 0.9);
    const low = dmg(run(a.w, a.p, 40, { attack: true }), a.p.id);
    const later = dmg(run(a.w, a.p, 40, { attack: true }), a.p.id);
    expect(later).toBeGreaterThan(low);
  });
});

describe('楽器：リズム', () => {
  it('拍に合わせると溜まり、外すと減る', () => {
    const { w, p } = makeTraining('instrument', 30, 4);
    const mech = CONTENT.weapons.instrument.mechanic as Extract<typeof CONTENT.weapons.instrument.mechanic, { type: 'rhythm' }>;
    for (let i = 0; i < 200 && p.rhythm < 4; i++) {
      const on = isOnBeat(w, mech, w.tick + 1) && !p.prevAttack;
      run(w, p, 1, { attack: on });
    }
    expect(p.rhythm).toBeGreaterThanOrEqual(4);
    const before = p.rhythm;
    // 拍の真ん中で押す
    while (isOnBeat(w, mech, w.tick + 1) || p.attackCd > 0) run(w, p, 1);
    run(w, p, 1, { attack: true });
    expect(p.rhythm).toBeLessThan(before);
  });
});

describe('槍：間合い', () => {
  it('穂先の間合いで当てるとボーナス、近すぎるとなし', () => {
    const far = makeTraining('spear', 30, 2.6);
    expect(run(far.w, far.p, 8, { attack: true }).some((e) => e.type === 'damage' && e.sweet)).toBe(true);
    const near = makeTraining('spear', 30, 0.9);
    expect(run(near.w, near.p, 8, { attack: true }).some((e) => e.type === 'damage' && e.sweet)).toBe(false);
  });
});

describe('鎌：吸収', () => {
  it('当てると HP が回復する', () => {
    const { w, p } = makeTraining('scythe', 30, 1.0);
    p.hp = Math.round(p.stats.maxHp * 0.5);
    const hp0 = p.hp;
    run(w, p, 40, { attack: true });
    expect(p.hp).toBeGreaterThan(hp0);
  });
});

describe('状態異常とブレイク', () => {
  it('燃焼は時間でダメージが入る', () => {
    const { w, p, m } = makeTraining('oneHandSword', 30, 6);
    applyStatus(w, m, p.id, 'burn', 4, { dot: 50 });
    const ev = run(w, p, 60);
    expect(ev.filter((e) => e.type === 'damage' && e.dot).length).toBeGreaterThanOrEqual(3);
  });

  it('スタン中のモンスターは動かない・攻撃しない', () => {
    const { w, p } = makeTraining('oneHandSword', 1, 6);
    const slime = w.area.monsters[0];
    applyStatus(w, slime, p.id, 'stun', 3);
    const x = slime.x;
    slime.ai = 'chase'; slime.targetId = p.id;
    run(w, p, 20);
    expect(slime.x).toBe(x);
  });

  it('毒は重ねがけできる（上限あり）', () => {
    const { w, p, m } = makeTraining('oneHandSword');
    for (let i = 0; i < 10; i++) applyStatus(w, m, p.id, 'poison', 5, { dot: 10 });
    expect(m.statuses.find((s) => s.id === 'poison')!.stacks).toBe(CONTENT.statuses.poison.maxStacks);
  });

  it('感電で防御が下がる', () => {
    const { w, p, m } = makeTraining('oneHandSword');
    const def0 = m.stats.def;
    applyStatus(w, m, p.id, 'shock', 4);
    run(w, p, 1);
    expect(m.stats.def).toBeLessThan(def0);
  });

  it('ブレイク力の高い攻撃を当て続けるとブレイクし、しばらく受けるダメージが増える', () => {
    const { w, p, m } = makeTraining('twoHandSword', 30, 1.0);
    let broke = false;
    for (let i = 0; i < 400 && !broke; i++) {
      const ev = run(w, p, 1, { attack: i % 40 < 38 });
      if (ev.some((e) => e.type === 'break')) broke = true;
    }
    expect(broke).toBe(true);
    expect(w.tick < m.brokenUntil).toBe(true);
  });
});

describe('スキルの仕組み', () => {
  it('発勁はコンボを使い切って威力が上がる', () => {
    const a = makeTraining('knuckles', 40, 0.9);
    a.ch.skills.hakkei = 5;
    a.ch.skillSlots.knuckles = ['hakkei', null, null, null];
    a.p.mp = 100;
    a.p.combo = 30; a.p.comboUntil = 1e9;
    const big = dmg(run(a.w, a.p, 3, { skill: 0 }), a.p.id);
    expect(a.p.combo).toBeLessThanOrEqual(1);
    const b = makeTraining('knuckles', 40, 0.9);
    b.ch.skills.hakkei = 5;
    b.ch.skillSlots.knuckles = ['hakkei', null, null, null];
    b.p.mp = 100;
    const small = dmg(run(b.w, b.p, 3, { skill: 0 }), b.p.id);
    expect(big).toBeGreaterThan(small * 1.5);
  });

  it('跳躍突きは狙った相手のそばへ飛ぶ', () => {
    const { w, p, ch } = makeTraining('spear', 40, 4.5);
    ch.skills.leap_thrust = 1;
    ch.skillSlots.spear = ['leap_thrust', null, null, null];
    p.mp = 100;
    const x0 = p.x;
    run(w, p, 12, { skill: 0, aim: null });
    expect(p.x - x0).toBeGreaterThan(2.5);
  });

  it('楽器のバフはリズムが溜まっているほど強い', () => {
    const lo = makeTraining('instrument', 30, 4);
    lo.ch.skills.song_courage = 5;
    lo.ch.skillSlots.instrument = ['song_courage', null, null, null];
    lo.p.mp = 100;
    run(lo.w, lo.p, 2, { skill: 0 });
    const hi = makeTraining('instrument', 30, 4);
    hi.ch.skills.song_courage = 5;
    hi.ch.skillSlots.instrument = ['song_courage', null, null, null];
    hi.p.mp = 100; hi.p.rhythm = 10;
    run(hi.w, hi.p, 2, { skill: 0 });
    expect(hi.p.stats.atk).toBeGreaterThan(lo.p.stats.atk);
  });
});
