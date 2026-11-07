import { describe, expect, it } from 'vitest';
import { CONTENT as C } from '../src/content';
import { canRebirth, expToNext, gainExp, rebirth, totalStatPoints } from '../src/systems/progression';
import { derivePlayerStats, effectiveStat, monsterStats, NO_SCALE } from '../src/systems/stats';
import { sanitizeAccount } from '../src/validate';
import { makeWorld } from './helpers';

/** Lv1000 拡張・第1段階（最大 Lv300・ステ上限撤廃・転生条件の切り離し・新フィールド） */

describe('ステータスの効き目（softCap）', () => {
  it('255 までは振っただけ効き、その先は 60%、600 より先は 35%', () => {
    expect(effectiveStat(100, C)).toBe(100);
    expect(effectiveStat(255, C)).toBe(255);
    expect(effectiveStat(600, C)).toBeCloseTo(255 + 345 * 0.6, 5);
    expect(effectiveStat(1000, C)).toBeCloseTo(255 + 345 * 0.6 + 400 * 0.35, 5);
  });

  it('回避は 40% で止まる。攻撃速度に効くのは AGI 255 までで、超えた分は回避に回る', () => {
    const { ch } = makeWorld(1);
    ch.level = 300;
    ch.stats.agi = 600;
    const a = derivePlayerStats(ch, [], C);
    ch.stats.agi = 254;
    const at255 = derivePlayerStats(ch, [], C).aspd;
    ch.stats.agi = 600;
    expect(a.aspd).toBe(at255);
    const plain = effectiveStat(C.balance.stats.statBase + 600, C) * C.balance.stats.evasionPerAgi;
    expect(a.evasion).toBeGreaterThan(plain);
    expect(derivePlayerStats(ch, [], C, { evasion: 50 }).evasion).toBe(C.balance.stats.evasionMax);
  });

  it('会心率 100% を超えた DEX は会心ダメージに回る', () => {
    const { ch } = makeWorld(2);
    ch.level = 300;
    ch.stats.dex = 800;
    const a = derivePlayerStats(ch, [], C, { critRate: 100 });
    ch.stats.dex = 1000;
    const b = derivePlayerStats(ch, [], C, { critRate: 100 });
    expect(a.critRate).toBe(1);
    expect(b.critDamage).toBeGreaterThan(a.critDamage);
  });
});

describe('レベルと転生', () => {
  it('Lv100 の前後で必要経験値が急に増えない', () => {
    const r = expToNext(101, C) / expToNext(100, C);
    expect(r).toBeGreaterThan(1);
    expect(r).toBeLessThan(1.1);
  });

  it('最大レベルは 300。そこで経験値は止まる', () => {
    const { w, p } = makeWorld(3);
    p.char.level = 299;
    gainExp(w, p, expToNext(299, C) * 5);
    expect(p.char.level).toBe(300);
    expect(p.char.exp).toBe(0);
  });

  it('転生は Lv100 からできる（最大レベルではなく）', () => {
    const { ch } = makeWorld(4);
    ch.level = 99;
    expect(canRebirth(ch, C)).toBe('err.levelLow');
    ch.level = 100;
    expect(rebirth(ch, C)).toBeNull();
    expect(ch.level).toBe(1);
  });

  it('上限 255 を超えて振ったセーブも、合計がポイント内なら消されない', () => {
    const made = makeWorld(5);
    const acc = JSON.parse(JSON.stringify(made.acc));
    const ch = acc.characters[0];
    ch.level = 200;
    ch.stats = { str: 500, int: 0, vit: 50, agi: 0, dex: 0 };
    const { account, removed } = sanitizeAccount(acc, C);
    expect(removed.filter((r) => r.what === 'stats')).toEqual([]);
    expect(account.characters[0].stats.str).toBe(500);
  });
});

describe('敵の強さ（Lv100 より上）', () => {
  it('HP は Lv100 の値から (Lv/100)^0.95 で伸びる', () => {
    const def = C.monsters.snow_wolf;
    const h100 = monsterStats(def, 100, C, NO_SCALE).maxHp;
    const h300 = monsterStats(def, 300, C, NO_SCALE).maxHp;
    expect(h300 / h100).toBeCloseTo(Math.pow(3, 0.95), 1);
  });
});

describe('新しいフィールド', () => {
  it('雪原から星降りの高原、虚ろの深淵へつながり、出る敵・素材・ドロップ表がそろっている', () => {
    expect(C.areas.snow.genExits!.some((e) => e.to === 'starfall')).toBe(true);
    expect(C.areas.starfall.genExits!.some((e) => e.to === 'abyss')).toBe(true);
    for (const id of ['starfall', 'abyss']) {
      const a = C.areas[id];
      const ids = [...a.monsters!, ...a.night!, ...a.ambush!].map((m) => m.id).concat(a.fieldBoss!.id);
      for (const m of ids) {
        expect(C.monsters[m]).toBeDefined();
        for (const x of C.monsters[m].mats ?? []) expect(C.materials[x.id]).toBeDefined();
        expect(C.drops[C.monsters[m].drops ?? 'field']).toBeDefined();
      }
      for (const list of Object.values(C.gathering.areas[id].tables)) for (const x of list as { id: string }[]) expect(C.materials[x.id]).toBeDefined();
    }
  });

  it('新しい段の鍛冶レシピの素材はすべて手に入る', () => {
    for (const t of C.recipes.smithing.tiers.filter((t) => t.tier >= 9)) {
      expect(C.equipment.tiers[t.tier]).toBeDefined();
      for (const [id] of [t.ore, t.wood, t.extra]) expect(C.materials[id]).toBeDefined();
      expect(t.level).toBeLessThanOrEqual(C.subjobs.maxLevel);
    }
  });
});
