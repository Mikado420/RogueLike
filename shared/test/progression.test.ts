import { describe, expect, it } from 'vitest';
import { CONTENT } from '../src/content';
import {
  allocateStat, canLearnSkill, choosePersonal, expToNext, freeSkillPoints, freeStatPoints, gainExp, learnSkill,
  levelDiffMul, loadBuild, rebirth, respec, respecCost, saveBuild, totalSkillPoints, totalStatPoints,
} from '../src/systems/progression';
import { derivePlayerStats } from '../src/systems/stats';
import { makeWorld } from './helpers';

const C = CONTENT;

describe('経験値とレベル', () => {
  it('必要経験値はレベルとともに増える', () => {
    let prev = 0;
    for (let lv = 1; lv < C.balance.progression.maxLevel; lv++) {
      const n = expToNext(lv, C);
      expect(n).toBeGreaterThan(prev);
      prev = n;
    }
  });

  it('経験値でレベルが上がり、ポイントが増える', () => {
    const { w, p, ch } = makeWorld(3);
    const sp0 = freeStatPoints(ch, C), sk0 = freeSkillPoints(ch, C);
    const ups = gainExp(w, p, expToNext(1, C) + expToNext(2, C));
    expect(ups).toBeGreaterThanOrEqual(2);
    expect(ch.level).toBeGreaterThanOrEqual(3);
    expect(freeStatPoints(ch, C)).toBe(sp0 + C.balance.progression.statPointsPerLevel * (ch.level - 1));
    expect(freeSkillPoints(ch, C)).toBe(sk0 + C.balance.progression.skillPointsPerLevel * (ch.level - 1));
    expect(w.events.some((e) => e.type === 'levelUp')).toBe(true);
  });

  it('上限レベルで止まる', () => {
    const { w, p, ch } = makeWorld(4);
    gainExp(w, p, 1e12);
    expect(ch.level).toBe(C.balance.progression.maxLevel);
    expect(ch.exp).toBe(0);
  });

  it('格下は経験値が減り、格上は増える（上限あり）', () => {
    expect(levelDiffMul(50, 50, C)).toBe(1);
    expect(levelDiffMul(50, 10, C)).toBeLessThan(1);
    expect(levelDiffMul(50, 10, C)).toBeGreaterThanOrEqual(C.balance.progression.levelDiffMinMul);
    expect(levelDiffMul(10, 50, C)).toBe(C.balance.progression.levelDiffMaxMul);
  });
});

describe('ステ振り', () => {
  it('持っているポイント以上は振れない', () => {
    const { ch } = makeWorld(5);
    const free = freeStatPoints(ch, C);
    expect(allocateStat(ch, 'str', free + 10, C)).toBeNull();
    expect(ch.stats.str).toBe(free);
    expect(freeStatPoints(ch, C)).toBe(0);
    expect(allocateStat(ch, 'dex', 1, C)).toBe('err.noPoints');
  });

  it('STR を振ると片手剣の ATK が上がる', () => {
    const { ch } = makeWorld(6);
    const before = derivePlayerStats(ch, [], C).atk;
    allocateStat(ch, 'str', 5, C);
    expect(derivePlayerStats(ch, [], C).atk).toBeGreaterThan(before);
  });

  it('上限（statMax）を超えない', () => {
    const { ch } = makeWorld(7);
    ch.level = 100;
    allocateStat(ch, 'agi', 999, C);
    expect(C.balance.stats.statBase + ch.stats.agi).toBe(C.balance.stats.statMax);
  });

  it('個性ステは種類を選んでから振る。振った後は変えられない', () => {
    const { ch } = makeWorld(8);
    expect(allocateStat(ch, 'personal', 1, C)).toBe('err.noPersonal');
    expect(choosePersonal(ch, 'luk', C)).toBeNull();
    expect(allocateStat(ch, 'personal', 2, C)).toBeNull();
    expect(ch.personal).toEqual({ type: 'luk', value: 2 });
    expect(choosePersonal(ch, 'crt', C)).toBe('err.personalLocked');
  });

  it('CRT はクリティカル率、LUK はドロップ率を上げる', () => {
    const { ch } = makeWorld(9);
    ch.level = 30;
    const base = derivePlayerStats(ch, [], C);
    choosePersonal(ch, 'crt', C);
    allocateStat(ch, 'personal', 20, C);
    const crt = derivePlayerStats(ch, [], C);
    expect(crt.critRate).toBeGreaterThan(base.critRate);
    ch.personal = { type: 'luk', value: 20 };
    const luk = derivePlayerStats(ch, [], C);
    expect(luk.m.dropRatePct ?? 0).toBeGreaterThan(0);
  });
});

describe('スキル', () => {
  it('前提スキルが足りないと覚えられない', () => {
    const { ch } = makeWorld(10);
    ch.level = 20;
    expect(canLearnSkill(ch, 'renga', C)).toBe('err.requires');
    for (let i = 0; i < 3; i++) expect(learnSkill(ch, 'slash', C)).toBeNull();
    expect(canLearnSkill(ch, 'renga', C)).toBeNull();
  });

  it('段（tier）に必要なレベルがある', () => {
    const { ch } = makeWorld(11);
    ch.level = 1;
    ch.skills = { slash: 3 };
    expect(canLearnSkill(ch, 'renga', C)).toBe('err.levelLow');
  });

  it('スキルポイントを使い切ると覚えられない。上限レベルもある', () => {
    const { ch } = makeWorld(12);
    ch.level = 40;
    const total = totalSkillPoints(ch, C);
    let learned = 0;
    for (let i = 0; i < 20; i++) if (!learnSkill(ch, 'power_up', C)) learned++;
    expect(learned).toBe(Math.min(10, total));
    expect(ch.skills.power_up).toBe(Math.min(10, total));
  });

  it('アクティブを覚えるとスキル枠に入る（武器スキルはその武器の枠）', () => {
    const { ch } = makeWorld(13);
    learnSkill(ch, 'slash', C);
    expect(ch.skillSlots.oneHandSword?.[0]).toBe('slash');
  });

  it('武器パッシブはその武器を持っているときだけ効く', () => {
    const { ch } = makeWorld(14);
    ch.level = 20;
    const base = derivePlayerStats(ch, [], C).atk;
    ch.skills.bow_mastery = 5;
    expect(derivePlayerStats(ch, [], C).atk).toBe(base);
    ch.skills.sword_mastery = 5;
    expect(derivePlayerStats(ch, [], C).atk).toBeGreaterThan(base);
  });
});

describe('振り直し・ビルド・転生', () => {
  it('振り直しはゴールドを払ってポイントが全部戻る', () => {
    const { ch } = makeWorld(15);
    ch.level = 10; ch.gold = 10000;
    allocateStat(ch, 'str', 10, C);
    learnSkill(ch, 'slash', C);
    const cost = respecCost(ch, C);
    expect(respec(ch, C)).toBeNull();
    expect(ch.gold).toBe(10000 - cost);
    expect(freeStatPoints(ch, C)).toBe(totalStatPoints(ch, C));
    expect(freeSkillPoints(ch, C)).toBe(totalSkillPoints(ch, C));
    ch.gold = 0;
    expect(respec(ch, C)).toBe('err.gold');
  });

  it('ビルドを保存して読み込むと振り分けが戻る', () => {
    const { ch } = makeWorld(16);
    ch.level = 10;
    allocateStat(ch, 'str', 8, C);
    learnSkill(ch, 'slash', C);
    saveBuild(ch, 0, C, 'A');
    ch.gold = 1e6;
    respec(ch, C);
    allocateStat(ch, 'int', 8, C);
    expect(loadBuild(ch, 0, C, () => {})).toBeNull();
    expect(ch.stats.str).toBe(8);
    expect(ch.stats.int).toBe(0);
    expect(ch.skills.slash).toBe(1);
    expect(loadBuild(ch, 2, C, () => {})).toBe('err.empty');
  });

  it('転生は上限レベルでだけ。レベル1に戻り、ボーナスポイントと称号が残る', () => {
    const { ch } = makeWorld(17);
    expect(rebirth(ch, C)).toBe('err.levelLow');
    ch.level = C.balance.progression.maxLevel;
    allocateStat(ch, 'str', 50, C);
    const before = totalStatPoints({ ...ch, level: 1 }, C);
    expect(rebirth(ch, C)).toBeNull();
    expect(ch.level).toBe(1);
    expect(ch.rebirths).toBe(1);
    expect(ch.stats.str).toBe(0);
    expect(totalStatPoints(ch, C)).toBe(before + C.balance.rebirth.statPoints);
    expect(totalSkillPoints(ch, C)).toBe(C.balance.progression.startSkillPoints + C.balance.rebirth.skillPoints);
    expect(ch.titles.unlocked).toContain(C.balance.rebirth.titles[0].title);
  });
});
