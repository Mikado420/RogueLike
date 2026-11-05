import { describe, expect, it } from 'vitest';
import { makeEnv } from './runtime';
import { TestClient } from './client';
import { newAccount, newCharacter, serializeAccount, createItem, Rng, CONTENT, type AccountData } from '../../shared/src';
import { call } from '../src/util/http';

function oldSave() {
  const acc = newAccount(5, 6);
  const a = newCharacter(acc, '旧A', { body: 1, hair: 1 }, 1);
  newCharacter(acc, '旧B', { body: 2, hair: 2 }, 2);
  a.level = 40; a.gold = 12345;
  a.inventory.push(createItem(77, 'w_gun', 4, 40, 'epic', new Rng(3), CONTENT));
  a.inventory.push({ ...createItem(78, 'w_gun', 4, 40, 'epic', new Rng(4), CONTENT), refine: 99 });
  acc.storage.items.push(createItem(79, 'a_light', 2, 20, 'rare', new Rng(5), CONTENT));
  return JSON.parse(serializeAccount(acc));
}

describe('オフライン版のセーブの引き継ぎ', () => {
  it('検証して取り込み、削ったものを返す。2回目はできない', async () => {
    const env = makeEnv();
    const c = await new TestClient(env).guest();
    await c.createChar('新');
    const r = await c.api('POST', '/api/migrate', { account: oldSave() });
    expect(r.status).toBe(200);
    expect(r.data.characters).toBe(2);
    expect(r.data.removed.some((x: { reason: string }) => x.reason === 'refine')).toBe(true);
    const me = await c.api('GET', '/api/me');
    expect(me.data.characters.map((x: { name: string }) => x.name)).toEqual(['新', '旧A', '旧B']);
    expect(me.data.migrated).toBe(true);
    const d = await call<{ account: AccountData }>((env as any).ACCOUNT.get((env as any).ACCOUNT.idFromName(c.accountId)), 'dump');
    const a = d.account.characters.find((x) => x.name === '旧A')!;
    expect(a.id.startsWith(c.accountId)).toBe(true);
    expect(a.gold).toBe(12345);
    expect(a.inventory.some((i) => i.uid === 77)).toBe(false);
    const all = d.account.characters.flatMap((x) => x.inventory.map((i) => i.uid)).concat(d.account.storage.items.map((i) => i.uid));
    expect(new Set(all).size).toBe(all.length);
    expect(d.account.storage.items.length).toBe(1);
    const again = await c.api('POST', '/api/migrate', { account: oldSave() });
    expect(again.status).toBe(409);
    expect(again.data.error).toBe('migrated');
  });

  it('壊れたファイルは断る（アカウントはそのまま）', async () => {
    const env = makeEnv();
    const c = await new TestClient(env).guest();
    const r = await c.api('POST', '/api/migrate', { account: 'garbage' });
    expect(r.status).toBe(400);
    expect((await c.api('GET', '/api/me')).data.migrated).toBe(false);
  });

  it('遊んでいる間は引き継げない', async () => {
    const env = makeEnv();
    const c = await new TestClient(env).guest();
    await c.play(await c.createChar('X'));
    const r = await c.api('POST', '/api/migrate', { account: oldSave() });
    expect(r.status).toBe(409);
  });
});
