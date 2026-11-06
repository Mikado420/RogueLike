import { describe, expect, it } from 'vitest';
import { makeEnv, flush } from './runtime';
import { TestClient, tickAll } from './client';

const area = (env: any, key: string) => env.AREA.instances.get(key) ?? env.INSTANCE.instances.get(key);
const playerOf = (env: any, c: TestClient) => area(env, c.key).host.world.players.find((p: any) => p.id === c.you);

describe('ダンジョンの入口で「入る」を 2 回押す', () => {
  it('移動の途中（保存・チケットの待ち）に 2 回目が届いても、ダンジョンへは 1 回だけ移り、ちゃんと入れる', async () => {
    const env = makeEnv();
    const c = await new TestClient(env).guest();
    await c.play(await c.createChar('ふたつ'));
    const p = playerOf(env, c);
    p.char.tutorial.done = true;
    const ar = area(env, c.key);
    const gate = ar.host.world.area.npcs.find((n: any) => n.npc === 'dungeon_gate');
    p.x = gate.x; p.y = gate.y + 1;
    const cmd = { type: 'enterDungeon', dungeon: gate.data, difficulty: 'normal' };
    c.input({ c: [cmd] });
    // 1 回目の tick（移動の処理を待っている途中）に 2 回目を送る
    const running = ar.tick(50);
    c.input({ c: [cmd] });
    await running;
    await tickAll(env, 3); await flush(20);
    c.input({ c: [cmd] });   // ダンジョンに着いたあとに届いても、入口のそばではないので何も起きない
    await tickAll(env, 3); await flush(20);
    expect(c.key.startsWith('inst:')).toBe(true);
    expect(env.INSTANCE.instances.size).toBe(1);
    expect(area(env, c.key).host.world.players.some((x: any) => x.id === c.you)).toBe(true);
    expect(c.kicked).toBeNull();
  });
});
