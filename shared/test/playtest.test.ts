import { describe, expect, it } from 'vitest';
import { CONTENT } from '../src/content';
import { isoSpeedMul } from '../src/systems/util';
import { smithExp, gainSubExp, subExpToNext } from '../src/systems/crafting';
import {
  canLearnSkill, effSkillLevel, freeSkillPoints, learnSkill, loadBuild, saveBuild, skillMaxLevel, skillNextCost, skillPointsFor, spentSkillPoints,
} from '../src/systems/progression';
import { passiveMods } from '../src/systems/stats';
import { createAreaWorld } from '../src/systems/world';
import { sanitizeAccount } from '../src/validate';
import { makeWorld, tick } from './helpers';

const C = CONTENT;
const HW = 32, HH = 16;
/** 画面の向き → ワールドの向き（client/src/iso.ts の screenDirToWorld と同じ） */
const screenToWorld = (sx: number, sy: number) => {
  const wx = sx / HW + sy / HH, wy = sy / HH - sx / HW;
  const l = Math.hypot(wx, wy);
  return { x: wx / l, y: wy / l };
};
const screenSpeed = (u: { x: number; y: number }) => Math.hypot((u.x - u.y) * HW, (u.x + u.y) * HH) * isoSpeedMul(u.x, u.y, C);

describe('移動の速さ（アイソメの補正）', () => {
  it('画面の上下・左右・斜めで、画面上の速さが同じ', () => {
    const right = screenSpeed(screenToWorld(1, 0));
    for (const [sx, sy] of [[0, -1], [0, 1], [-1, 0], [0.6, -0.8], [-0.8, 0.6]]) {
      expect(screenSpeed(screenToWorld(sx, sy))).toBeCloseTo(right, 5);
    }
  });

  it('プレイヤーが画面の上へ動くのと右へ動くので、画面上の移動量が同じ', () => {
    const run = (sx: number, sy: number) => {
      const { w, p } = makeWorld(31);
      const x0 = p.x, y0 = p.y;
      tick(w, p, { move: screenToWorld(sx, sy) }, 10);
      const dx = p.x - x0, dy = p.y - y0;
      return Math.hypot((dx - dy) * HW, (dx + dy) * HH);
    };
    const up = run(0, -1), right = run(1, 0);
    expect(up).toBeGreaterThan(0);
    expect(Math.abs(up - right) / right).toBeLessThan(0.05);
  });
});

describe('鍛冶の上がりやすさ', () => {
  it('1回の鍛冶の経験値が段で増え、Lv60 までがおよそ 100〜150 回で届く', () => {
    const { w, p } = makeWorld(32);
    expect(smithExp(w, 0)).toBe(C.subjobs.gain.smith);
    expect(smithExp(w, 5)).toBeGreaterThan(smithExp(w, 0) * 3);
    const tiers = C.recipes.smithing.tiers;
    let n = 0;
    while (p.char.sub.smith.level < C.subjobs.maxLevel && n < 1000) {
      const t = tiers.filter((x) => x.level <= p.char.sub.smith.level).at(-1)!;
      gainSubExp(w, p, 'smith', smithExp(w, t.tier));
      n++;
    }
    expect(p.char.sub.smith.level).toBe(C.subjobs.maxLevel);
    expect(n).toBeGreaterThan(80);
    expect(n).toBeLessThan(160);
    expect(subExpToNext(w, 1)).toBeGreaterThan(0);
  });
});

describe('スキルの限界突破', () => {
  const lv = (ch: { level: number }, n: number) => { ch.level = n; };

  it('Lv100 で 15、Lv200 で 20 まで上げられる。上限を超えた分は 2〜3 ポイント', () => {
    const { ch } = makeWorld(33);
    const d = C.skills.slash;
    lv(ch, 99); expect(skillMaxLevel(ch, d, C)).toBe(10);
    lv(ch, 100); expect(skillMaxLevel(ch, d, C)).toBe(15);
    lv(ch, 200); expect(skillMaxLevel(ch, d, C)).toBe(20);
    expect(skillPointsFor(d, 10, C)).toBe(10);
    expect(skillPointsFor(d, 15, C)).toBe(20);
    expect(skillPointsFor(d, 20, C)).toBe(35);
    expect(skillNextCost(d, 10, C)).toBe(2);
    expect(skillNextCost(d, 15, C)).toBe(3);
  });

  it('上げるとポイントがそのぶん減り、足りなければ上げられない', () => {
    const { ch } = makeWorld(34);
    lv(ch, 300);
    ch.equipment.weapon = null;
    for (let i = 0; i < 20; i++) expect(learnSkill(ch, 'slash', C)).toBeNull();
    expect(ch.skills.slash).toBe(20);
    expect(spentSkillPoints(ch, C)).toBe(35);
    expect(canLearnSkill(ch, 'slash', C)).toBe('err.skillMax');
    // ポイントを使い切ったあと、上限を超えた分（2ポイント）は1ポイントでは上げられない
    const { ch: ch2 } = makeWorld(35);
    lv(ch2, 100);
    for (let i = 0; i < 10; i++) learnSkill(ch2, 'slash', C);
    const free = freeSkillPoints(ch2, C);
    ch2.skills.power_up = 1;
    for (let i = 0; i < free - 2; i++) ch2.skills[`x${i}`] = 1; // 残り1ポイントにする（存在しないスキルは1ポイント扱い）
    expect(freeSkillPoints(ch2, C)).toBe(1);
    expect(canLearnSkill(ch2, 'slash', C)).toBe('err.noPoints');
  });

  it('効き目は上限を超えた分の半分（Lv20 で Lv15 相当）', () => {
    const d = C.skills.slash;
    expect(effSkillLevel(d, 10, C)).toBe(10);
    expect(effSkillLevel(d, 20, C)).toBe(15);
    const [pid, pd] = Object.entries(C.skills).find(([, x]) => x.type === 'passive' && !x.weapon && x.mods)!;
    const { ch } = makeWorld(36);
    ch.skills = { [pid]: 20 };
    const at20 = passiveMods(ch, 'oneHandSword', C);
    for (const [k, v] of Object.entries(pd.mods!)) {
      const want = Array.isArray(v) ? v[0] + v[1] * (15 - 1) : v;
      expect(at20[k as keyof typeof at20]).toBeCloseTo(want as number, 6);
    }
  });

  it('引き継ぎの検証で、限界突破のスキルを消さない（上限やポイントを超えたら消す）', () => {
    const { acc, ch } = makeWorld(37);
    lv(ch, 200);
    ch.skills = { slash: 20 };
    const r = sanitizeAccount(JSON.parse(JSON.stringify(acc)), C);
    expect(r.account.characters.find((x) => x.id === ch.id)!.skills.slash).toBe(20);
    lv(ch, 150);
    const r2 = sanitizeAccount(JSON.parse(JSON.stringify(acc)), C);
    expect(r2.account.characters.find((x) => x.id === ch.id)!.skills.slash).toBeUndefined();
  });

  it('ビルドの読み込みも、今の上限とポイントで確かめる', () => {
    const { ch } = makeWorld(38);
    lv(ch, 200);
    ch.skills = { slash: 18 };
    expect(saveBuild(ch, 0, C)).toBeNull();
    lv(ch, 150);
    expect(loadBuild(ch, 0, C, () => {})).toBe('err.skillMax');
  });
});

describe('新しいマップのダンジョン', () => {
  it('星降りの高原と虚ろの深淵に入口があり、ボス・セット・結晶がそろっている', () => {
    for (const [area, id] of [['starfall', 'dg_starfall'], ['abyss', 'dg_abyss']] as const) {
      const w = createAreaWorld({ areaId: area, seed: 3, now: 0 });
      const gate = w.area.npcs.find((n) => n.npc === 'dungeon_gate');
      expect(gate?.data).toBe(id);
      const def = C.dungeons.dungeons[id];
      expect(C.monsters[def.boss]?.boss).toBe(true);
      expect(C.sets[def.set]).toBeTruthy();
      expect(C.crystals[def.crystal]).toBeTruthy();
      for (const m of def.monsters) expect(C.monsters[m]).toBeTruthy();
    }
  });
});
