import { describe, expect, it } from 'vitest';
import { CONTENT } from '../src/content';
import { enterArea, flushSolo } from '../src/systems/world';
import { enterDungeon, enterRaid, enterTower, canStartTower, nextTowerFloor } from '../src/systems/instance';
import { generateDungeon, reachable } from '../src/mapgen';
import { invasionWindow } from '../src/systems/events';
import { claimMission, codexPct, dayIndex, ensureMissions, missionProgress } from '../src/systems/quest';
import { addCounter } from '../src/systems/counters';
import { addToBag } from '../src/systems/items';
import { buildFacility, facilityCost, payUpkeep } from '../src/systems/base';
import { derivePlayerStats } from '../src/systems/stats';
import { migrateAccount, newAccount, newCharacter, serializeAccount } from '../src/save';
import { makeWorld, tick } from './helpers';
import type { Player, World } from '../src/state';

const C = CONTENT;
const killAll = (w: World, p: Player) => { for (const m of w.area.monsters) { m.hp = 0; m.dead = true; } tick(w, p); };

describe('ランダムダンジョン', () => {
  it('入口からボスの部屋まで歩いて行ける（シードを変えても）', () => {
    for (let s = 1; s < 30; s++) {
      const g = generateDungeon('d', s * 977, 7);
      const seen = reachable(g.map, g.start.cx, g.start.cy);
      expect(seen[Math.floor(g.boss.cy) * g.map.width + Math.floor(g.boss.cx)]).toBe(1);
    }
  });

  it('フィールドの入口から入り、ボスを倒すとクリア・記録・出口。出口で元の場所へ戻る', () => {
    const { w, p } = makeWorld(1);
    enterArea(w, 'meadow', null);
    const gate = w.area.npcs.find((n) => n.npc === 'dungeon_gate')!;
    p.x = gate.x; p.y = gate.y + 1;
    tick(w, p, { commands: [{ type: 'enterDungeon', dungeon: gate.data!, difficulty: 'normal' }] });
    expect(w.area.instance?.kind).toBe('dungeon');
    const before = w.area.monsters.length;
    expect(before).toBeGreaterThan(3);
    w.clock += 1;
    killAll(w, p);
    tick(w, p);
    expect(w.area.instance!.cleared).toBe(true);
    expect(w.events.some((e) => e.type === 'instance') || p.account.records.timeAttack[`${gate.data}:normal`]?.length).toBeTruthy();
    expect(p.char.counters.dungeonClears).toBe(1);
    const exit = w.area.npcs.find((n) => n.npc === 'exit_portal')!;
    p.x = exit.x; p.y = exit.y + 0.5;
    tick(w, p, { interact: true });
    tick(w, p);
    expect(w.area.id).toBe('meadow');
    expect(Math.hypot(p.x - gate.x, p.y - gate.y)).toBeLessThan(2);
  });

  it('難易度が上がるとボスが硬く、強い技（minDifficulty）が使えるようになる', () => {
    const hp: Record<string, number> = {};
    for (const d of ['normal', 'hard', 'nightmare'] as const) {
      const { w, p } = makeWorld(2);
      enterDungeon(w, p, 'dg_meadow', d); flushSolo(w);
      const boss = w.area.monsters.find((m) => m.id === w.area.instance!.bossId)!;
      hp[d] = boss.stats.maxHp;
    }
    expect(hp.hard).toBeGreaterThan(hp.normal);
    expect(hp.nightmare).toBeGreaterThan(hp.hard);
    expect(C.monsters.slime_queen.attacks.some((a) => a.minDifficulty === 'hard')).toBe(true);
  });
});

describe('無限の塔', () => {
  it('全部倒すと階段が出て次の階へ。最高到達が記録される', () => {
    const { w, p } = makeWorld(3);
    expect(enterTower(w, p, 1)).toBeNull(); flushSolo(w);
    expect(w.area.instance!.floor).toBe(1);
    killAll(w, p);
    expect(w.area.instance!.cleared).toBe(true);
    expect(p.char.tower.best).toBe(1);
    const stairs = w.area.npcs.find((n) => n.npc === 'stairs')!;
    p.x = stairs.x; p.y = stairs.y + 0.5;
    tick(w, p, { interact: true });
    expect(w.area.instance!.floor).toBe(2);
  });

  it('10階ごとにボス。途中から始められるのは到達した区切りだけ', () => {
    const { w, p } = makeWorld(4);
    expect(canStartTower(w, p, 11)).toBe(false);
    p.char.tower.best = 10;
    expect(canStartTower(w, p, 11)).toBe(true);
    expect(canStartTower(w, p, 21)).toBe(false);
    enterTower(w, p, 1); flushSolo(w);
    w.area.instance!.floor = 9;
    w.area.instance!.cleared = true;
    expect(nextTowerFloor(w, p)).toBeNull(); flushSolo(w);
    expect(w.area.instance!.floor).toBe(10);
    expect(w.area.instance!.bossId).toBeGreaterThan(0);
  });
});

describe('レイド', () => {
  it('HPでフェーズが進み、手下を倒すまでシールドで無敵。安全地帯の外は大ダメージ', () => {
    const { w, p } = makeWorld(5);
    p.char.level = 90;
    expect(enterRaid(w, p, 'colossus', 'normal')).toBeNull(); flushSolo(w);
    const boss = w.area.monsters.find((m) => m.id === w.area.instance!.bossId)!;
    boss.hp = boss.stats.maxHp * 0.7;
    tick(w, p);
    expect(boss.phase).toBe(1);
    expect(boss.shielded).toBe(true);
    expect(w.area.monsters.filter((m) => m.summonedBy === boss.id).length).toBeGreaterThan(0);
    for (const m of w.area.monsters) if (m.summonedBy === boss.id) { m.dead = true; m.hp = 0; }
    tick(w, p);
    expect(boss.shielded).toBe(false);
    boss.hp = boss.stats.maxHp * 0.45;
    tick(w, p);
    expect(w.area.safeZones.length).toBeGreaterThan(0);
    p.x = w.area.safeZones[0].x + 8; p.y = w.area.safeZones[0].y;
    p.hp = p.stats.maxHp;
    const hp0 = p.hp;
    for (let i = 0; i < 120 && w.area.safeZones.length; i++) { p.iframes = 0; tick(w, p); }
    expect(p.hp < hp0 || p.dead).toBe(true);
  });

  it('制限時間を過ぎると失敗', () => {
    const { w, p } = makeWorld(6);
    p.char.level = 90;
    enterRaid(w, p, 'colossus', 'normal'); flushSolo(w);
    w.tick = w.area.instance!.timeLimitTick;
    tick(w, p);
    expect(w.area.instance!.failed).toBe(true);
  });
});

describe('侵攻イベント', () => {
  it('時間になると街に魔物が来て、倒した貢献度で報酬', () => {
    const { w, p } = makeWorld(7);
    const every = C.invasion.every * 60000;
    w.clock = every * 100 + 1000;
    expect(invasionWindow(w).active).toBe(true);
    tick(w, p, {}, 80);
    expect(w.area.invasion).not.toBeNull();
    const invaders = w.area.monsters.filter((m) => m.invader);
    expect(invaders.length).toBeGreaterThan(0);
    w.shared.invasion.contribution[p.char.id] = 1e6;
    const gold = p.char.gold;
    w.clock = every * 100 + C.invasion.duration * 60000 + 1;
    tick(w, p);
    expect(w.area.invasion!.finished).toBe(true);
    expect(p.char.gold).toBeGreaterThan(gold);
    expect(p.char.counters.invasions).toBe(1);
  });
});

describe('ミッション・実績・図鑑', () => {
  it('日替わりは日ごとに同じ内容。記録が増えると進み、達成で受け取れる（1回だけ）', () => {
    const { w, p } = makeWorld(8);
    w.clock = 86400000 * 500 + 1000;
    ensureMissions(w, p);
    const a = JSON.stringify(p.char.missions.daily.map((m) => [m.id, m.n]));
    const { w: w2, p: p2 } = makeWorld(9);
    w2.clock = w.clock + 3600e3;
    ensureMissions(w2, p2);
    expect(JSON.stringify(p2.char.missions.daily.map((m) => [m.id, m.n]))).toBe(a);
    const m = p.char.missions.daily[0];
    expect(claimMission(w, p, 'daily', 0)).toBe('err.notDone');
    addCounter(w, p, m.counter, m.n);
    expect(missionProgress(p.char, m)).toBe(m.n);
    const gold = p.char.gold;
    expect(claimMission(w, p, 'daily', 0)).toBeNull();
    expect(p.char.gold).toBeGreaterThanOrEqual(gold);
    expect(claimMission(w, p, 'daily', 0)).toBe('err.invalid');
    expect(dayIndex(w.clock)).toBe(500);
  });

  it('実績で称号が手に入り、つけると補正が乗る', () => {
    const { w, p } = makeWorld(10);
    addCounter(w, p, 'kills', 100);
    expect(p.char.titles.unlocked).toContain('hunter1');
    const atk = derivePlayerStats(p.char, [], C).atk;
    tick(w, p, { commands: [{ type: 'equipTitle', title: 'hunter1' }] });
    expect(p.char.titles.equipped).toBe('hunter1');
    expect(derivePlayerStats(p.char, [], C).atk).toBeGreaterThan(atk);
  });

  it('図鑑：新しいモンスターを倒すと埋まり、一定の割合でボーナス', () => {
    const { p } = makeWorld(11);
    expect(codexPct(p.char, C)).toBe(0);
    for (const id of Object.keys(C.monsters)) p.char.codex.monsters[id] = 1;
    for (const id of Object.keys(C.equipment.bases)) p.char.codex.items[id] = 1;
    expect(codexPct(p.char, C)).toBeGreaterThanOrEqual(40);
    const s = derivePlayerStats(p.char, [], C);
    p.char.codex = { monsters: {}, items: {}, materials: {} };
    expect(derivePlayerStats(p.char, [], C).maxHp).toBeLessThan(s.maxHp);
  });
});

describe('拠点', () => {
  it('素材とゴールドで施設を建てると補正。維持費を払わないと止まる', () => {
    const { w, p } = makeWorld(12);
    const keeper = w.area.npcs.find((n) => n.npc === 'base_keeper')!;
    p.x = keeper.x; p.y = keeper.y + 1;
    const cost = facilityCost(C, 'training', 1)!;
    p.char.gold = cost.gold;
    for (const [m, n] of Object.entries(cost.mats)) addToBag(p.char, m, n);
    w.clock = 86400000 * 10;
    const pct = () => p.stats.m.atkPct ?? 0;
    tick(w, p, { commands: [{ type: 'buildFacility', facility: 'training' }] }, 2);
    expect(p.account.base.levels.training).toBe(1);
    expect(pct()).toBeGreaterThan(0);
    w.clock += 86400000;
    tick(w, p, {}, 2);
    expect(pct()).toBe(0);
    p.char.gold = 1e5;
    expect(payUpkeep(w, p)).toBeNull();
    p.statsDirty = true;
    tick(w, p, {}, 2);
    expect(pct()).toBeGreaterThan(0);
    expect(buildFacility(w, p, 'nope')).toBe('err.facilityMax');
  });
});

describe('セーブ版4', () => {
  it('版3のデータに図鑑・ミッション・拠点・記録が足される', () => {
    const acc = newAccount(1, 2);
    newCharacter(acc, 'A', { body: 0, hair: 0 }, 1);
    const raw = JSON.parse(serializeAccount(acc));
    raw.version = 3;
    delete raw.base; delete raw.records;
    for (const ch of raw.characters) { delete ch.codex; delete ch.missions; delete ch.tower; }
    const m = migrateAccount(raw);
    expect(m.base.levels).toEqual({});
    expect(m.records.timeAttack).toEqual({});
    expect(m.characters[0].tower.best).toBe(0);
  });
});
