import { describe, expect, it } from 'vitest';
import { makeEnv, flush } from './runtime';
import { TestClient, tickAll } from './client';
import type { AccountData, Item } from '../../shared/src';
import { call } from '../src/util/http';

const area = (env: any, key: string) => env.AREA.instances.get(key) ?? env.INSTANCE.instances.get(key);
const dump = async (env: any, id: string) => (await call<{ account: AccountData }>(env.ACCOUNT.get(env.ACCOUNT.idFromName(id)), 'dump')).account;
function uids(acc: AccountData) {
  const out: number[] = [];
  for (const ch of acc.characters) {
    out.push(...ch.inventory.map((i) => i.uid), ...Object.values(ch.equipment).filter((x): x is Item => !!x).map((i) => i.uid));
  }
  out.push(...acc.storage.items.map((i) => i.uid));
  return out.sort();
}

describe('通信', () => {
  it('入力に連番をつけて送ると、スナップショットで処理済みの番号が返る。変わらないものは送り直さない', async () => {
    const env = makeEnv();
    const a = await new TestClient(env).guest();
    await a.play(await a.createChar('A'));
    a.input({ m: [1, 0] });
    a.input({ m: [1, 0] });
    await tickAll(env, 4);
    const s = a.snaps();
    expect(s.at(-1)!.ack).toBe(2);
    // NPC（動かない）は最初の1回だけ
    const npcSends = s.filter((m) => (m.np ?? []).length > 0).length;
    expect(npcSends).toBe(1);
    // 自分は動いているので毎回来る
    expect(s.slice(1).every((m) => (m.pl ?? []).some((p) => p.id === a.you))).toBe(true);
  });

  it('関心範囲の外のプレイヤーは送られない', async () => {
    const env = makeEnv({ CONFIG: JSON.stringify({ interestRadius: 6 }) });
    const a = await new TestClient(env).guest(), b = await new TestClient(env).guest();
    await a.play(await a.createChar('A'));
    await b.play(await b.createChar('B'));
    const ar = area(env, a.key);
    const pb = ar.host.player([...ar.host.sessions.keys()][1]);
    pb.x += 0; // 同じ場所
    await tickAll(env, 4);
    expect(a.seenPlayers().has(b.you)).toBe(true);
    // B を遠くへ
    const map = ar.host.world.area.map;
    for (let y = 2; y < map.height - 2; y++) for (let x = 2; x < map.width - 2; x++) {
      const pa = ar.host.player([...ar.host.sessions.keys()][0]);
      if (!map.solid[y * map.width + x] && Math.hypot(x - pa.x, y - pa.y) > 15) { pb.x = x + 0.5; pb.y = y + 0.5; y = 1e9; break; }
    }
    await tickAll(env, 4);
    expect(a.seenPlayers().has(b.you)).toBe(false);
  });

  it('出口でエリアを移る：保存→チケット→つなぎ直し。アイテムは増えも減りもしない', async () => {
    const env = makeEnv();
    const a = await new TestClient(env).guest();
    const id = await a.createChar('A');
    await a.play(id);
    const before = uids(await dump(env, a.accountId));
    const ar = area(env, a.key);
    const first = a.key;
    const ex = ar.host.world.area.exits[0];
    const p = ar.host.player([...ar.host.sessions.keys()][0]);
    p.x = (ex.rect[0] + ex.rect[2]) / 2; p.y = (ex.rect[1] + ex.rect[3]) / 2;
    await tickAll(env, 3);
    await flush(20);
    expect(a.key).not.toBe(first);
    expect(a.key.startsWith(`${ex.to}#`)).toBe(true);
    expect(area(env, first).host.population).toBe(0);
    const after = uids(await dump(env, a.accountId));
    expect(after).toEqual(before);
    expect(area(env, a.key).host.world.players.length).toBe(1);
  });

  it('移る途中で切れても、次にログインすると行き先から始まり、アイテムはそのまま', async () => {
    const env = makeEnv();
    const a = await new TestClient(env).guest();
    const id = await a.createChar('A');
    a.autoMove = false;
    await a.play(id);
    const before = uids(await dump(env, a.accountId));
    const ar = area(env, a.key);
    const ex = ar.host.world.area.exits[0];
    const p = ar.host.player([...ar.host.sessions.keys()][0]);
    p.x = (ex.rect[0] + ex.rect[2]) / 2; p.y = (ex.rect[1] + ex.rect[3]) / 2;
    await tickAll(env, 3);
    expect(a.last('move')).toBeTruthy();
    // move を受け取ったが、つながずに閉じた
    const b = new TestClient(env);
    b.token = a.token;
    await b.play(id);
    expect(b.key.startsWith(`${ex.to}#`)).toBe(true);
    expect(uids(await dump(env, a.accountId))).toEqual(before);
  });

  it('切れても猶予のあいだにつなぎ直せば、同じ場所に戻る', async () => {
    const env = makeEnv();
    const a = await new TestClient(env).guest();
    await a.play(await a.createChar('A'));
    a.input({ m: [1, 0] });
    await tickAll(env, 6);
    const ar = area(env, a.key);
    const p = ar.host.player([...ar.host.sessions.keys()][0]);
    const pos = { x: p.x, y: p.y };
    const resume = a.last('welcome')!.resume;
    a.ws!.close(1006);
    await flush(10);
    await tickAll(env, 2);
    expect(ar.host.population).toBe(1);
    await a.connect(resume);
    await tickAll(env, 2);
    const p2 = ar.host.player([...ar.host.sessions.keys()][0]);
    expect(p2).toBe(p);
    expect(Math.hypot(p2.x - pos.x, p2.y - pos.y)).toBeLessThan(1);
    expect(a.msgs.filter((m) => m.t === 'welcome').length).toBe(2);
  });

  it('猶予を過ぎると保存されてエリアから出る', async () => {
    const env = makeEnv({ CONFIG: JSON.stringify({ reconnectGraceSec: 0 }) });
    const a = await new TestClient(env).guest();
    await a.play(await a.createChar('A'));
    await tickAll(env, 2);
    const ar = area(env, a.key);
    a.ws!.close(1006);
    await flush(10);
    await tickAll(env, 2);
    expect(ar.host.population).toBe(0);
    const d = await call<{ meta: { session: unknown } }>((env as any).ACCOUNT.get((env as any).ACCOUNT.idFromName(a.accountId)), 'dump');
    expect(d.meta.session).toBeNull();
  });
});

describe('同じセッションが2つのエリアに入らない', () => {
  it('移ったあとに前のエリアの再接続チケットを使っても入れない', async () => {
    const env = makeEnv();
    const a = await new TestClient(env).guest();
    await a.play(await a.createChar('A'));
    const first = a.key;
    const resume = a.last('welcome')!.resume;
    const ar = area(env, first);
    const ex = ar.host.world.area.exits[0];
    const p = ar.host.player([...ar.host.sessions.keys()][0]);
    p.x = (ex.rect[0] + ex.rect[2]) / 2; p.y = (ex.rect[1] + ex.rect[3]) / 2;
    await tickAll(env, 3);
    await flush(20);
    expect(a.key).not.toBe(first);
    const ghost = new TestClient(env);
    await ghost.connect(resume);
    await tickAll(env, 2);
    expect(ghost.kicked).toBe('elsewhere');
    expect(area(env, first).host.population).toBe(0);
    expect(area(env, a.key).host.population).toBe(1);
  });
});
