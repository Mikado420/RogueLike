import { describe, expect, it } from 'vitest';
import { makeEnv, flush } from './runtime';
import { TestClient, tickAll } from './client';
import { call } from '../src/util/http';
import type { AccountData, Item } from '../../shared/src';
import { createItem } from '../../shared/src/systems/loot';
import { newUid } from '../../shared/src/systems/util';

const area = (env: any, key: string) => env.AREA.instances.get(key) ?? env.INSTANCE.instances.get(key);
const playerOf = (env: any, c: TestClient) => area(env, c.key).host.world.players.find((p: any) => p.id === c.you);
const acc = (env: any, id: string) => env.ACCOUNT.get(env.ACCOUNT.idFromName(id));
const dump = async (env: any, id: string) => (await call<{ account: AccountData }>(acc(env, id), 'dump')).account;
const market = (env: any) => env.MARKET.get(env.MARKET.idFromName('market'));

/** 全員のアイテム（持ち物・装備・倉庫・郵便受け・出品中・露店）とゴールド */
async function census(env: any, ids: string[]) {
  const uids: number[] = [];
  let gold = 0;
  for (const id of ids) {
    const a = await dump(env, id);
    for (const ch of a.characters) {
      uids.push(...ch.inventory.map((i) => i.uid), ...Object.values(ch.equipment).filter((x): x is Item => !!x).map((i) => i.uid));
      gold += ch.gold;
    }
    uids.push(...a.storage.items.map((i) => i.uid));
    const m = await call<{ mail: any[]; stall: any[] | null }>(acc(env, id), 'mail');
    for (const x of m.mail) { if (x.item) uids.push(x.item.uid); gold += x.gold ?? 0; }
    for (const s of m.stall ?? []) uids.push(s.item.uid);
  }
  const open = (await call<{ list: { item: Item }[] }>(market(env), 'search', {})).list;
  uids.push(...open.map((l) => l.item.uid));
  return { uids: uids.sort(), gold };
}

async function setup(n = 2, area0 = 'lumina') {
  const env = makeEnv();
  const cs: TestClient[] = [];
  for (let i = 0; i < n; i++) {
    const c = await new TestClient(env).guest();
    const id = await c.createChar(`C${i}`);
    // 街から始める
    const a = acc(env, c.accountId);
    const d = await call<any>(a, 'dump');
    void d;
    await c.play(id);
    cs.push(c);
  }
  for (const c of cs) {
    const p = playerOf(env, c); p.char.gold = 10000; p.char.tutorial.done = true;
    // 売り買いに使う品（最初の持ち物は空なので、ここで持たせる）
    const w = area(env, c.key).host.world;
    for (const base of ['w_twoHandSword', 'w_bow']) p.char.inventory.push(createItem(newUid(w), base, 0, 1, 'common', w.rng, w.content));
  }
  // すぐ保存させる（数え始めの時点でアカウントに入っているように）
  for (const c of cs) for (const conn of area(env, c.key).conns.values()) conn.lastSave = -1e15;
  await tickAll(env, 2); await flush(10);
  void area0;
  return { env, cs };
}

const settle = async (env: any) => { for (let i = 0; i < 6; i++) { await tickAll(env, 2); await flush(10); } };

describe('取引所', () => {
  it('出品→購入：品は買い手へ、代金（手数料を引く）は売り手へ。全体のアイテムは増えも減りもしない', async () => {
    const { env, cs: [s, b] } = await setup();
    const ps = playerOf(env, s);
    const item = ps.char.inventory[0];
    const before = await census(env, [s.accountId, b.accountId]);
    s.input({ c: [{ type: 'marketList', uid: item.uid, price: 1000 }] });
    await settle(env);
    const list = (await b.api('GET', '/api/market')).data.list;
    expect(list.map((l: any) => l.item.uid)).toContain(item.uid);
    expect(playerOf(env, s).char.inventory.some((i: Item) => i.uid === item.uid)).toBe(false);
    const mid = await census(env, [s.accountId, b.accountId]);
    expect(mid.uids).toEqual(before.uids);
    b.input({ c: [{ type: 'marketBuy', id: list[0].id, price: 1000 }] });
    await settle(env);
    expect(playerOf(env, b).char.inventory.some((i: Item) => i.uid === item.uid)).toBe(true);
    expect(playerOf(env, s).char.gold).toBe(10000 + 1000 - 50);
    expect(playerOf(env, b).char.gold).toBe(9000);
    const after = await census(env, [s.accountId, b.accountId]);
    expect(after.uids).toEqual(before.uids);
    expect(new Set(after.uids).size).toBe(after.uids.length);
  });

  it('同じ品を2人が同時に買っても、手に入るのは1人。もう1人には代金が戻る', async () => {
    const { env, cs: [s, b, c] } = await setup(3);
    const item = playerOf(env, s).char.inventory[0];
    s.input({ c: [{ type: 'marketList', uid: item.uid, price: 500 }] });
    await settle(env);
    const id = (await b.api('GET', '/api/market')).data.list[0].id;
    b.input({ c: [{ type: 'marketBuy', id, price: 500 }] });
    c.input({ c: [{ type: 'marketBuy', id, price: 500 }] });
    await settle(env);
    const got = [b, c].filter((x) => playerOf(env, x).char.inventory.some((i: Item) => i.uid === item.uid));
    expect(got.length).toBe(1);
    const gold = [b, c].map((x) => playerOf(env, x).char.gold).sort((x, y) => x - y);
    expect(gold).toEqual([9500, 10000]);
    const all = await census(env, [s.accountId, b.accountId, c.accountId]);
    expect(all.uids.filter((u) => u === item.uid).length).toBe(1);
  });

  it('取引できない品は出せない。一度だけの品は売れたら取引できなくなる', async () => {
    const { env, cs: [s, b] } = await setup();
    const ps = playerOf(env, s);
    ps.char.inventory[0].trade = 'none';
    ps.char.inventory[1].trade = 'once';
    s.input({ c: [{ type: 'marketList', uid: ps.char.inventory[0].uid, price: 100 }] });
    await settle(env);
    expect(s.snaps().flatMap((x) => x.ev ?? []).some((e: any) => e.type === 'notice' && e.key === 'err.untradable')).toBe(true);
    const once = ps.char.inventory[1];
    s.input({ c: [{ type: 'marketList', uid: once.uid, price: 100 }] });
    await settle(env);
    const id = (await b.api('GET', '/api/market')).data.list[0].id;
    b.input({ c: [{ type: 'marketBuy', id, price: 100 }] });
    await settle(env);
    expect(playerOf(env, b).char.inventory.find((i: Item) => i.uid === once.uid).trade).toBe('none');
  });

  it('取引所が一時的に落ちていても、出品は残っていて、あとで届く（増えも消えもしない）', async () => {
    const { env, cs: [s, b] } = await setup();
    const before = await census(env, [s.accountId, b.accountId]);
    const m = (env as any).MARKET.instance('market');
    const orig = m.fetch.bind(m);
    m.fetch = async () => { throw new Error('down'); };
    const item = playerOf(env, s).char.inventory[0];
    s.input({ c: [{ type: 'marketList', uid: item.uid, price: 300 }] });
    await settle(env);
    // 出品は待ちのまま（品はどこにも消えていない）
    const d = await call<any>(acc(env, s.accountId), 'dump');
    void d;
    m.fetch = orig;
    // アラームで送り直す
    await (env as any).ACCOUNT.instance(s.accountId).alarm();
    await settle(env);
    const list = (await b.api('GET', '/api/market')).data.list;
    expect(list.map((l: any) => l.item.uid)).toContain(item.uid);
    const after = await census(env, [s.accountId, b.accountId]);
    expect(after.uids).toEqual(before.uids);
  });

  it('取り下げると郵便受けに戻り、受け取れる。同じ送り状を2回届けても1回分', async () => {
    const { env, cs: [s] } = await setup(1);
    const item = playerOf(env, s).char.inventory[0];
    s.input({ c: [{ type: 'marketList', uid: item.uid, price: 300 }] });
    await settle(env);
    const id = (await s.api('GET', '/api/market?mine=1')).data.list[0].id;
    s.input({ c: [{ type: 'marketCancel', id }] });
    await settle(env);
    expect(playerOf(env, s).char.inventory.filter((i: Item) => i.uid === item.uid).length).toBe(1);
    await call(acc(env, s.accountId), 'mailAdd', { mail: { id: `${id}:cancel`, from: 'x', item, at: 1 } });
    await settle(env);
    expect(playerOf(env, s).char.inventory.filter((i: Item) => i.uid === item.uid).length).toBe(1);
  });

  it('出品した直後に切れても、品は出品中として残る', async () => {
    const { env, cs: [s, b] } = await setup();
    const before = await census(env, [s.accountId, b.accountId]);
    const item = playerOf(env, s).char.inventory[0];
    s.input({ c: [{ type: 'marketList', uid: item.uid, price: 300 }] });
    await tickAll(env, 1);
    s.ws!.close(1006);
    await settle(env);
    const after = await census(env, [s.accountId, b.accountId]);
    expect(after.uids).toEqual(before.uids);
  });
});

describe('露店', () => {
  it('街で開くと同じ街の人が買える。売上は郵便受けへ。閉じると残りが戻る', async () => {
    const { env, cs: [s, b] } = await setup();
    const hs = area(env, s.key);
    // 2人とも街へ
    for (const c of [s, b]) { const p = playerOf(env, c); p.transition = { to: 'lumina', spawn: '' }; }
    await settle(env);
    expect(area(env, s.key).host.world.area.type).toBe('town');
    void hs;
    const before = await census(env, [s.accountId, b.accountId]);
    const ps = playerOf(env, s), pb = playerOf(env, b);
    const [i1, i2] = ps.char.inventory;
    s.input({ c: [{ type: 'stallOpen', title: 'みせ', items: [{ uid: i1.uid, price: 200 }, { uid: i2.uid, price: 300 }] }] });
    await settle(env);
    expect(playerOf(env, s).stall.items.length).toBe(2);
    pb.x = ps.x + 1; pb.y = ps.y;
    b.input({ c: [{ type: 'stallBuy', seller: s.you, uid: i1.uid, price: 200 }] });
    await settle(env);
    expect(playerOf(env, b).char.inventory.some((i: Item) => i.uid === i1.uid)).toBe(true);
    expect(playerOf(env, s).char.gold).toBe(10000 + 200 - 4);
    s.input({ c: [{ type: 'stallClose' }] });
    await settle(env);
    expect(playerOf(env, s).char.inventory.some((i: Item) => i.uid === i2.uid)).toBe(true);
    const after = await census(env, [s.accountId, b.accountId]);
    expect(after.uids).toEqual(before.uids);
  });
});
