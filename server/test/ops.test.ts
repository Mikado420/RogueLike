import { describe, expect, it } from 'vitest';
import { makeEnv, flush, worker } from './runtime';
import { TestClient, tickAll } from './client';

const area = (env: any, key: string) => env.AREA.instances.get(key);
const adminReq = (env: any, method: string, path: string, body?: unknown, token = 'admin-token-1234') =>
  worker.fetch(new Request(`https://test${path}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'x-admin-token': token, 'content-type': 'application/json' } }), env);

describe('管理と不正対策', () => {
  it('管理用 API は ADMIN_TOKEN がないと使えない。お知らせは全員に届く', async () => {
    const env = makeEnv({ ADMIN_TOKEN: 'admin-token-1234' });
    const a = await new TestClient(env).guest();
    await a.play(await a.createChar('A'));
    expect((await adminReq(env, 'POST', '/admin/notice', { text: 'メンテ' }, 'wrong')).status).toBe(403);
    const r = await adminReq(env, 'POST', '/admin/notice', { text: 'メンテのお知らせ' });
    expect(r.status).toBe(200);
    await flush(10);
    expect(a.msgs.some((m: any) => m.t === 'notice' && m.key === 'notice.admin' && m.args[0] === 'メンテのお知らせ')).toBe(true);
    const st = await (await adminReq(env, 'GET', '/admin/stats')).json() as any;
    expect(st.players).toBe(1);
  });

  it('停止すると遊んでいる接続が切れ、ログインもできない。解除すると戻る', async () => {
    const env = makeEnv({ ADMIN_TOKEN: 'admin-token-1234' });
    const a = await new TestClient(env).guest();
    await a.play(await a.createChar('A'));
    await tickAll(env, 2);
    expect((await adminReq(env, 'POST', '/admin/ban', { accountId: a.accountId, reason: 'test', hours: 1 })).status).toBe(200);
    await flush(10);
    expect(a.kicked).toBe('banned');
    expect((await a.api('GET', '/api/me')).status).toBe(403);
    await adminReq(env, 'POST', '/admin/unban', { accountId: a.accountId });
    expect((await a.api('GET', '/api/me')).status).toBe(200);
  });

  it('入力の連打は捨てて記録する。ログで見られる', async () => {
    const env = makeEnv({ ADMIN_TOKEN: 'admin-token-1234', CONFIG: JSON.stringify({ rate: { inputsPerSec: 5 } }) });
    const a = await new TestClient(env).guest();
    await a.play(await a.createChar('A'));
    for (let i = 0; i < 30; i++) a.input({ m: [1, 0] });
    await flush(20);
    await tickAll(env, 2);
    const logs = await (await adminReq(env, 'GET', '/admin/logs?kind=cheat')).json() as any;
    expect(logs.list.length).toBeGreaterThan(0);
    expect(JSON.parse(logs.list[0].detail).kind).toBe('inputRate');
    // 受け付けたのは上限の分だけ
    expect(a.snaps().at(-1)!.ack).toBeLessThanOrEqual(5);
  });

  it('おかしな入力（長すぎる移動ベクトル・知らないスキル枠）は丸める', async () => {
    const env = makeEnv();
    const a = await new TestClient(env).guest();
    await a.play(await a.createChar('A'));
    const p0 = area(env, a.key).host.world.players[0];
    const x0 = p0.x;
    a.send({ t: 'in', n: 1, m: [1000, 0], a: null, b: 0, k: 99 });
    await flush(5);
    await tickAll(env, 1);
    const d = p0.x - x0;
    expect(d).toBeLessThanOrEqual(p0.stats.moveSpeed / 20 + 1e-6);
  });

  it('誰もいなくなると tick を止めて眠り、人が来ると起きる（復活待ちは済んだことになる）', async () => {
    const env = makeEnv();
    const a = await new TestClient(env).guest();
    await a.play(await a.createChar('A'));
    const ar = area(env, a.key);
    const sp = ar.host.world.area.spawns[0];
    if (sp) { sp.monsterId = -1; sp.respawnAt = ar.host.world.tick + 99999; }
    a.send({ t: 'bye' });
    await flush(10);
    await tickAll(env, 1);
    expect(ar.host.population).toBe(0);
    expect((ar as any).sleepingSince).toBeGreaterThan(0);
    const b = new TestClient(env); b.token = a.token;
    await b.play((await b.api('GET', '/api/me')).data.characters[0].id);
    expect((ar as any).sleepingSince).toBe(0);
    if (sp) expect(sp.respawnAt).toBeLessThanOrEqual(ar.host.world.tick);
  });

  it('HTTP は同じ IP から1分あたりの上限を超えると断る', async () => {
    const env = makeEnv({ CONFIG: JSON.stringify({ rate: { httpPerMin: 3 } }) });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await worker.fetch(new Request('https://test/api/health', { headers: { 'cf-connecting-ip': '203.0.113.9' } }), env);
      codes.push(r.status);
    }
    expect(codes.slice(0, 3).every((c) => c === 200)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });
});
