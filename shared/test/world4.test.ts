import { describe, expect, it } from 'vitest';
import { CONTENT } from '../src/content';
import { fieldLayout, enterArea } from '../src/systems/world';
import { reachable } from '../src/mapgen';
import { currentWeather, envElementMul, forecast, weatherAt } from '../src/systems/weather';
import { isNightAt } from '../src/systems/time';
import { fieldBossSlot, spawnFieldMonster } from '../src/systems/spawner';
import { makeWorld, tick } from './helpers';

const C = CONTENT;
const fields = Object.entries(C.areas).filter(([, a]) => a.gen).map(([id]) => id);

/** 指定の条件に合う時刻（ミリ秒）を探す */
function findClock(pred: (clock: number) => boolean): number {
  for (let t = 0; t < 1e9; t += 60000) if (pred(t)) return t;
  throw new Error('not found');
}

describe('フィールドの自動生成', () => {
  it('どのフィールドも、入口から出口・ボスの広場・ダンジョン入口へ歩いて行ける', () => {
    for (const id of fields) {
      const g = fieldLayout(C, id)!;
      const sp = Object.values(g.spawnPoints)[0];
      const seen = reachable(g.map, sp.x, sp.y);
      const ok = (x: number, y: number) => seen[Math.floor(y) * g.map.width + Math.floor(x)] === 1;
      for (const e of g.exits) expect(ok((e.rect[0] + e.rect[2]) / 2, (e.rect[1] + e.rect[3]) / 2), `${id} exit ${e.to}`).toBe(true);
      for (const [name, s] of Object.entries(g.spots)) expect(ok(s.x, s.y), `${id} ${name}`).toBe(true);
    }
  });

  it('同じフィールドは毎回同じ地形', () => {
    const a = fieldLayout(C, 'meadow')!;
    const { w } = makeWorld(1);
    enterArea(w, 'meadow', null);
    expect(w.area.map.solid.join()).toBe(a.map.solid.join());
  });
});

describe('エリアの移動', () => {
  it('出口に入ると隣のエリアへ移り、対応する場所に出る。戻ることもできる', () => {
    const { w, p } = makeWorld(2);
    expect(w.area.id).toBe('lumina');
    const ex = w.area.exits[0];
    p.x = ex.rect[0] - 0.4; p.y = (ex.rect[1] + ex.rect[3]) / 2;
    tick(w, p, { move: { x: 1, y: 0 } }, 10);
    expect(w.area.id).toBe(ex.to);
    const back = w.area.exits.find((e) => e.to === 'lumina')!;
    p.x = back.rect[2] + 0.4; p.y = (back.rect[1] + back.rect[3]) / 2;
    tick(w, p, { move: { x: -1, y: 0 } }, 10);
    expect(w.area.id).toBe('lumina');
    expect(Math.hypot(p.x - C.areas.lumina.spawnPoints!.east.x, p.y - C.areas.lumina.spawnPoints!.east.y)).toBeLessThan(3);
  });

  it('訪れた街へ転送陣で移れる（ゴールドを使う）', () => {
    const { w, p, ch } = makeWorld(3);
    expect(ch.visitedTowns).toEqual(['lumina']);
    enterArea(w, 'ember', null);
    expect(ch.visitedTowns).toContain('ember');
    const portal = w.area.npcs.find((n) => n.npc === 'portal')!;
    p.x = portal.x; p.y = portal.y + 1;
    ch.gold = 0;
    tick(w, p, { commands: [{ type: 'fastTravel', town: 'lumina' }] }, 2);
    expect(w.area.id).toBe('ember');
    ch.gold = 1000;
    tick(w, p, { commands: [{ type: 'fastTravel', town: 'lumina' }] }, 2);
    expect(w.area.id).toBe('lumina');
    expect(ch.gold).toBe(1000 - C.areas.lumina.travelCost!);
  });
});

describe('昼夜と天候', () => {
  it('天候は時刻とエリアだけで決まり、予報と一致する', () => {
    const t = 12345678;
    const f = forecast(C, 'marsh', t, 6);
    expect(f.length).toBe(6);
    for (const s of f) expect(weatherAt(C, 'marsh', s.slot)).toBe(s.weather);
    const { w } = makeWorld(4);
    w.clock = f[2].start + 1000;
    expect(currentWeather(w, 'marsh')).toBe(f[2].weather);
  });

  it('雨の日は水属性が強く、火属性が弱い。夜は闇が強い', () => {
    const { w } = makeWorld(5);
    enterArea(w, 'marsh', null);
    w.clock = findClock((c) => weatherAt(C, 'marsh', Math.floor(c / (C.weather.slotMinutes * 60000))) === 'rain' && !isNightAt(C, c));
    expect(envElementMul(w, 'water')).toBeGreaterThan(1);
    expect(envElementMul(w, 'fire')).toBeLessThan(1);
    w.clock = findClock((c) => isNightAt(C, c) && weatherAt(C, 'marsh', Math.floor(c / (C.weather.slotMinutes * 60000))) === 'clear');
    expect(envElementMul(w, 'dark')).toBeGreaterThan(1);
  });

  it('夜だけ出るモンスターがいて、昼になるといなくなる', () => {
    const { w, p } = makeWorld(6);
    w.clock = findClock((c) => isNightAt(C, c));
    enterArea(w, 'meadow', null);
    for (let i = 0; i < 60; i++) spawnFieldMonster(w);
    expect(w.area.monsters.some((m) => C.monsters[m.defId].nightOnly)).toBe(true);
    w.clock = findClock((c) => !isNightAt(C, c));
    for (let i = 0; i < 40; i++) tick(w, p);
    expect(w.area.monsters.some((m) => C.monsters[m.defId].nightOnly && m.ai === 'wander')).toBe(false);
  });

  it('レア天候の区切りになると通知が出る', () => {
    const { w, p } = makeWorld(7);
    const slotMs = C.weather.slotMinutes * 60000;
    w.clock = findClock((c) => Object.keys(C.areas).some((id) => C.weather.types[weatherAt(C, id, Math.floor(c / slotMs))]?.rare));
    w.lastWeatherSlot = -1;
    tick(w, p);
    expect(w.events.some((e) => e.type === 'worldNotice' && e.rare)).toBe(true);
  });
});

describe('フィールドボス', () => {
  it('時間の区切りごとに1回現れ、倒すとその区切りの間は出ない', () => {
    const { w, p } = makeWorld(8);
    enterArea(w, 'meadow', null);
    const boss = w.area.monsters.find((m) => m.fieldBoss)!;
    expect(boss.defId).toBe('king_slime');
    boss.hp = 1;
    p.x = boss.x - boss.r - 0.8; p.y = boss.y;
    p.char.level = 30;
    for (let i = 0; i < 60 && !boss.dead; i++) tick(w, p, { attack: true });
    expect(boss.dead).toBe(true);
    expect(w.account.world.fieldBoss.meadow).toBe(fieldBossSlot(w));
    enterArea(w, 'lumina', null);
    enterArea(w, 'meadow', null);
    expect(w.area.monsters.some((m) => m.fieldBoss)).toBe(false);
    w.clock += C.balance.world.fieldBossInterval * 60000;
    tick(w, p);
    expect(w.area.monsters.some((m) => m.fieldBoss)).toBe(true);
  });
});
