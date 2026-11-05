import { describe, expect, it } from 'vitest';
import { makeEnv } from './runtime';
import { TestClient, tickAll } from './client';

describe('ログイン', () => {
  it('ゲストを作り、キャラを作って一覧に出る。トークンがなければ断る', async () => {
    const env = makeEnv();
    const c = await new TestClient(env).guest();
    expect(c.token).toMatch(/^a_/);
    const id = await c.createChar('あいう');
    const me = await c.api('GET', '/api/me');
    expect(me.data.characters.map((x: { id: string }) => x.id)).toEqual([id]);
    const no = await c.api('GET', '/api/me', undefined, '');
    expect(no.status).toBe(401);
    const bad = await c.api('GET', '/api/me', undefined, `${c.accountId}.xxxxxxxxxxxxxxxxxxxxxxxx`);
    expect(bad.status).toBe(401);
  });

  it('名前と ID を登録できる。ID は重複できない', async () => {
    const env = makeEnv();
    const a = await new TestClient(env).guest(), b = await new TestClient(env).guest();
    expect((await a.api('POST', '/api/profile', { handle: 'alice', name: 'アリス' })).status).toBe(200);
    expect((await b.api('POST', '/api/profile', { handle: 'ALICE', name: 'ボブ' })).status).toBe(409);
    expect((await b.api('POST', '/api/profile', { handle: 'a!', name: 'ボブ' })).status).toBe(400);
    expect((await b.api('POST', '/api/profile', { handle: 'bob_1', name: 'ボブ' })).status).toBe(200);
    expect((await a.api('GET', '/api/me')).data.handle).toBe('alice');
  });

  it('引き継ぎコードで別の端末に移せる。前の端末のトークンは使えなくなり、コードは1回だけ', async () => {
    const env = makeEnv();
    const a = await new TestClient(env).guest();
    await a.createChar('A');
    const { data } = await a.api('POST', '/api/transfer/issue');
    expect(data.code).toMatch(/^[A-Z2-9]{10}$/);
    const b = new TestClient(env);
    const r = await b.api('POST', '/api/transfer/redeem', { code: data.code.toLowerCase() }, '');
    expect(r.status).toBe(200);
    b.token = r.data.token;
    expect((await b.api('GET', '/api/me')).data.characters.length).toBe(1);
    expect((await a.api('GET', '/api/me')).status).toBe(401);
    expect((await b.api('POST', '/api/transfer/redeem', { code: data.code }, '')).status).toBe(404);
  });
});

describe('エリアに入る', () => {
  it('2人が同じフィールドに入り、お互いが見える', async () => {
    const env = makeEnv();
    const a = await new TestClient(env).guest(), b = await new TestClient(env).guest();
    await a.play(await a.createChar('A'));
    await b.play(await b.createChar('B'));
    expect(a.key).toBe(b.key);
    await tickAll(env, 6);
    expect(a.seenPlayers().has(b.you)).toBe(true);
    expect(b.seenPlayers().has(a.you)).toBe(true);
    expect(a.char?.name).toBe('A');
  });

  it('同じアカウントで新しく入ると古い接続が切れる（保存してから）', async () => {
    const env = makeEnv();
    const a = await new TestClient(env).guest();
    const id = await a.createChar('A');
    await a.play(id);
    await tickAll(env, 4);
    const a2 = new TestClient(env);
    a2.token = a.token;
    await a2.play(id);
    await tickAll(env, 2);
    expect(a.kicked).toBe('duplicate');
    expect(a.ws?.closed).toBe(true);
    expect(a2.you).toBeGreaterThan(0);
    const area = (env.AREA as any).instances.get(a2.key);
    expect(area.host.world.players.length).toBe(1);
  });
});
