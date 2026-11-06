import { describe, expect, it } from 'vitest';
import { makeEnv, flush } from './runtime';
import { TestClient, tickAll } from './client';
import { CONTENT } from '../../shared/src';

const area = (env: any, key: string) => env.AREA.instances.get(key) ?? env.INSTANCE.instances.get(key);
const playerOf = (env: any, c: TestClient) => area(env, c.key).host.world.players.find((p: any) => p.id === c.you);

describe('銘入り装備（サーバー経由）', () => {
  it('材料・ゴールド・鍛冶 Lv・鍛冶屋のそばかをサーバーで確かめてから作る', async () => {
    const env = makeEnv();
    const c = await new TestClient(env).guest();
    await c.play(await c.createChar('かじや'));
    playerOf(env, c).transition = { to: 'lumina', spawn: '' };
    await tickAll(env, 2); await flush(20);
    const p = playerOf(env, c);
    expect(area(env, c.key).host.world.area.id).toBe('lumina');
    const r = CONTENT.crafted.recipes.find((x) => x.id === 'meadow_16')!;
    p.char.tutorial.done = true;
    p.char.sub.smith.level = r.smithLevel;
    p.char.gold = r.gold;
    for (const [m, n] of Object.entries(r.mats)) p.char.bag[m] = n;
    const n0 = p.char.inventory.length;

    // 鍛冶屋から離れていると作れない
    c.input({ c: [{ type: 'craftNamed', recipe: r.id }] });
    await tickAll(env, 3); await flush(10);
    expect(p.char.inventory.length).toBe(n0);

    // そばに行けば作れる
    const smith = CONTENT.areas.lumina.npcs!.find((x) => x.npc === 'smith')!;
    p.x = smith.x; p.y = smith.y + 0.8;
    c.input({ c: [{ type: 'craftNamed', recipe: r.id }] });
    await tickAll(env, 3); await flush(10);
    expect(p.char.inventory.length).toBe(n0 + 1);
    expect(p.char.inventory.at(-1).unique).toBe(`crafted.${r.id}`);

    // 材料はもうないので、もう一度送っても作れない
    c.input({ c: [{ type: 'craftNamed', recipe: r.id }] });
    await tickAll(env, 3); await flush(10);
    expect(p.char.inventory.length).toBe(n0 + 1);
  });
});
