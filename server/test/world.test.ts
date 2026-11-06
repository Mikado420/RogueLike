import { afterAll, describe, expect, it } from 'vitest';
import { makeEnv, flush } from './runtime';
import { TestClient, tickAll } from './client';
import { platform } from '../src/util/platform';
import { call } from '../src/util/http';
import { CONTENT, fieldBossSlot } from '../../shared/src';

const realNow = platform.now;
afterAll(() => { platform.now = realNow; });

const area = (env: any, key: string) => env.AREA.instances.get(key) ?? env.INSTANCE.instances.get(key);
const playerOf = (env: any, c: TestClient) => area(env, c.key).host.world.players.find((p: any) => p.id === c.you);
const world = (env: any) => env.WORLD.get(env.WORLD.idFromName('world'));

async function join(env: any, name: string, to?: string) {
  const c = await new TestClient(env).guest();
  await c.play(await c.createChar(name));
  if (to) { playerOf(env, c).transition = { to, spawn: '' }; await tickAll(env, 2); await flush(20); }
  return c;
}

describe('世界の共有', () => {
  it('ワールド通知は、別のエリアにいる人にも1回だけ届く', async () => {
    const env = makeEnv();
    const a = await join(env, 'A'), b = await join(env, 'B', 'lumina');
    expect(a.key).not.toBe(b.key);
    await call(world(env), 'announce', { key: 'notice.mythicDrop', args: ['A', '剣'], rare: true, dedupe: 'x1' });
    await call(world(env), 'announce', { key: 'notice.mythicDrop', args: ['A', '剣'], rare: true, dedupe: 'x1' });
    await flush(10);
    for (const c of [a, b]) expect(c.msgs.filter((m: any) => m.t === 'notice' && m.world && m.key === 'notice.mythicDrop').length).toBe(1);
  });

  it('フィールドボスはどこかのチャンネルで倒されると、ほかのチャンネルからも去る', async () => {
    const env = makeEnv({ CONFIG: JSON.stringify({ channelCap: 1 }) });
    const a = await join(env, 'A'), b = await join(env, 'B');
    expect(a.key).not.toBe(b.key);
    const wa = area(env, a.key).host.world, wb = area(env, b.key).host.world;
    const slot = fieldBossSlot(wa);
    const bossB = wb.area.monsters.find((m: any) => m.fieldBoss);
    expect(bossB).toBeTruthy();
    wa.shared.fieldBoss[wa.area.id] = slot;
    await area(env, a.key).sync();
    await area(env, b.key).sync();
    await tickAll(env, 2);
    expect(wb.area.monsters.some((m: any) => m.fieldBoss && !m.dead)).toBe(false);
  });

  it('タイムアタックの記録は D1 にまとめて書かれ、ランキングで見られる', async () => {
    const env = makeEnv();
    const a = await join(env, 'A');
    await call(world(env), 'taRecord', { course: 'dg_meadow:normal', time: 99.5, names: 'A', accounts: [a.accountId] });
    await call(world(env), 'taRecord', { course: 'dg_meadow:normal', time: 80.25, names: 'B・C', accounts: ['x', 'y'] });
    expect((await a.api('GET', '/api/ranking?course=dg_meadow:normal')).data.list.length).toBe(0);
    await call(world(env), 'worldTick', { now: Date.now() });
    const list = (await a.api('GET', '/api/ranking?course=dg_meadow:normal')).data.list;
    expect(list.map((r: any) => r.time)).toEqual([80.25, 99.5]);
  });

  it('ダンジョンをクリアすると記録が WorldDO に送られる', async () => {
    const env = makeEnv();
    const a = await join(env, 'A');
    const ar = area(env, a.key);
    const gate = ar.host.world.area.npcs.find((n: any) => n.npc === 'dungeon_gate');
    const p = playerOf(env, a); p.x = gate.x; p.y = gate.y + 1;
    a.input({ c: [{ type: 'enterDungeon', dungeon: gate.data, difficulty: 'normal' }] });
    await tickAll(env, 3); await flush(20);
    const inst = area(env, a.key);
    for (const m of inst.host.world.area.monsters) { m.hp = 0; m.dead = true; }
    await tickAll(env, 3); await flush(10);
    await call(world(env), 'worldTick', { now: Date.now() });
    const list = (await a.api('GET', `/api/ranking?course=${gate.data}:normal`)).data.list;
    expect(list.length).toBe(1);
    expect(list[0].names).toBe('A');
  });
});
