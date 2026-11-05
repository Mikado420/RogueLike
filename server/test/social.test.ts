import { afterEach, describe, expect, it } from 'vitest';
import { makeEnv, flush } from './runtime';
import { TestClient, tickAll } from './client';
import { platform } from '../src/util/platform';
import { call } from '../src/util/http';

const realNow = platform.now;
let clock = Date.now();
const advance = (ms: number) => { clock += ms; };
platform.now = () => clock;
afterEach(() => { advance(5000); });
void realNow;

const area = (env: any, key: string) => env.AREA.instances.get(key) ?? env.INSTANCE.instances.get(key);
const playerOf = (env: any, c: TestClient) => { const a = area(env, c.key); return a.host.world.players.find((p: any) => p.id === c.you); };

async function two(env: any, handles = ['alice', 'bob']) {
  const out: TestClient[] = [];
  for (const h of handles) {
    const c = await new TestClient(env).guest();
    await c.api('POST', '/api/profile', { handle: h, name: h });
    (c as any).charId = await c.createChar(h.toUpperCase());
    out.push(c);
  }
  return out;
}

describe('チャット', () => {
  it('全体チャットが届く。NG ワードは伏せ、連投は止める', async () => {
    const env = makeEnv();
    const [a, b] = await two(env);
    await a.connectSocial(); await b.connectSocial();
    a.social!.world.send(JSON.stringify({ t: 'say', ch: 'world', text: 'こんにちは死ね' }));
    await flush(10);
    const got = b.social!.msgs.find((m) => m.t === 'msg' && m.ch === 'world');
    expect(got.text).toBe('こんにちは＊＊');
    expect(got.from.handle).toBe('alice');
    a.social!.world.send(JSON.stringify({ t: 'say', ch: 'world', text: 'もう一回' }));
    await flush(10);
    expect(a.social!.msgs.some((m) => m.t === 'error' && m.code === 'chatRate')).toBe(true);
    advance(1000);
    a.social!.world.send(JSON.stringify({ t: 'say', ch: 'world', stamp: 'thanks' }));
    await flush(10);
    expect(b.social!.msgs.some((m) => m.stamp === 'thanks')).toBe(true);
  });

  it('個人あて。ブロックした人からは届かない。通報できる', async () => {
    const env = makeEnv();
    const [a, b] = await two(env);
    await a.connectSocial(); await b.connectSocial();
    a.social!.user.send(JSON.stringify({ t: 'say', ch: 'dm', to: 'bob', text: 'やあ' }));
    await flush(10);
    expect(b.social!.msgs.some((m) => m.ch === 'dm' && m.text === 'やあ')).toBe(true);
    b.social!.user.send(JSON.stringify({ t: 'block', id: a.accountId, on: true }));
    await flush(10);
    advance(2000);
    a.social!.user.send(JSON.stringify({ t: 'say', ch: 'dm', to: 'bob', text: 'まだ？' }));
    await flush(10);
    expect(b.social!.msgs.some((m) => m.text === 'まだ？')).toBe(false);
    expect((await b.api('POST', '/api/report', { target: a.accountId, reason: 'spam' })).status).toBe(200);
  });

  it('エリアの中の会話とエモートは、そのエリアの人に見える', async () => {
    const env = makeEnv();
    const [a, b] = await two(env);
    await a.play((a as any).charId); await b.play((b as any).charId);
    a.input({ c: [{ type: 'say', text: 'ここ' }, { type: 'emote', emote: 'wave' }] });
    await tickAll(env, 4);
    const ev = b.snaps().flatMap((s) => s.ev ?? []);
    expect(ev.some((e: any) => e.type === 'say' && e.text === 'ここ')).toBe(true);
    expect(ev.some((e: any) => e.type === 'emote' && e.emote === 'wave')).toBe(true);
  });
});

describe('パーティ', () => {
  it('招待して入る。パーティのチャット。エリアで同じパーティになり、経験値を分ける', async () => {
    const env = makeEnv();
    const [a, b] = await two(env);
    await a.play((a as any).charId); await b.play((b as any).charId);
    await a.connectSocial(); await b.connectSocial();
    const created = await a.api('POST', '/api/party/create');
    const pid = created.data.party.id;
    expect((await a.api('POST', '/api/party/invite', { handle: 'bob' })).status).toBe(200);
    await flush(10);
    const inv = b.social!.msgs.find((m) => m.t === 'invite');
    expect(inv.id).toBe(pid);
    // 招待されていない人は入れない
    const [c] = await two(env, ['carol']);
    expect((await c.api('POST', '/api/party/join', { id: pid })).status).toBe(403);
    expect((await b.api('POST', '/api/party/join', { id: pid })).status).toBe(200);
    await flush(10);
    expect(a.social!.msgs.filter((m) => m.t === 'party').at(-1).party.members.length).toBe(2);
    a.social!.user.send(JSON.stringify({ t: 'say', ch: 'party', text: 'いくよ' }));
    await flush(15);
    expect(b.social!.msgs.some((m) => m.ch === 'party' && m.text === 'いくよ')).toBe(true);
    expect(playerOf(env, a).partyId).toBe(pid);
    expect(playerOf(env, b).partyId).toBe(pid);
    // 抜ける
    await b.api('POST', '/api/party/leave');
    await flush(5);
    expect(playerOf(env, b).partyId).toBeNull();
  });

  it('募集の掲示板に出すと、招待なしで入れる', async () => {
    const env = makeEnv();
    const [a, b] = await two(env);
    const pid = (await a.api('POST', '/api/party/create')).data.party.id;
    await a.api('POST', '/api/party/open', { open: true, goal: 'dg_meadow' });
    const list = (await b.api('GET', '/api/recruit')).data.list;
    expect(list.map((x: any) => x.id)).toContain(pid);
    expect(list[0].goal).toBe('dg_meadow');
    expect((await b.api('POST', '/api/party/join', { id: pid })).status).toBe(200);
  });

  it('パーティで入口からダンジョンに入ると、近くの仲間も同じインスタンスへ', async () => {
    const env = makeEnv();
    const [a, b] = await two(env);
    await a.play((a as any).charId); await b.play((b as any).charId);
    const pid = (await a.api('POST', '/api/party/create')).data.party.id;
    await a.api('POST', '/api/party/invite', { handle: 'bob' });
    await b.api('POST', '/api/party/join', { id: pid });
    const ar = area(env, a.key);
    const gate = ar.host.world.area.npcs.find((n: any) => n.npc === 'dungeon_gate');
    for (const c of [a, b]) { const p = playerOf(env, c); p.x = gate.x; p.y = gate.y + 1; }
    a.input({ c: [{ type: 'enterDungeon', dungeon: gate.data, difficulty: 'normal' }] });
    await tickAll(env, 3);
    await flush(20);
    expect(a.key.startsWith('inst:')).toBe(true);
    expect(b.key).toBe(a.key);
    expect(area(env, a.key).host.world.players.length).toBe(2);
  });
});

describe('自動マッチングと救援', () => {
  it('入口で並ぶと、待ち時間のあとそろった人で同じダンジョンへ', async () => {
    const env = makeEnv();
    const [a, b] = await two(env);
    await a.play((a as any).charId); await b.play((b as any).charId);
    const ar = area(env, a.key);
    const gate = ar.host.world.area.npcs.find((n: any) => n.npc === 'dungeon_gate');
    for (const c of [a, b]) { const p = playerOf(env, c); p.x = gate.x; p.y = gate.y + 1; c.input({ c: [{ type: 'matchDungeon', dungeon: gate.data, difficulty: 'normal' }] }); }
    await tickAll(env, 2);
    const w = (env as any).WORLD.get((env as any).WORLD.idFromName('world'));
    await call(w, 'matchTick', { now: clock + 60_000 });
    await tickAll(env, 3);
    await flush(20);
    expect(a.key.startsWith('inst:')).toBe(true);
    expect(b.key).toBe(a.key);
    expect(playerOf(env, a).partyId).toBe(playerOf(env, b).partyId);
  });

  it('ボス戦から救援を呼ぶと一覧に出て、ほかの人が入れる。クリアすると助けた人にも報酬', async () => {
    const env = makeEnv();
    const [a, b] = await two(env);
    await a.play((a as any).charId); await b.play((b as any).charId);
    const ar = area(env, a.key);
    const gate = ar.host.world.area.npcs.find((n: any) => n.npc === 'dungeon_gate');
    const pa = playerOf(env, a); pa.x = gate.x; pa.y = gate.y + 1;
    a.input({ c: [{ type: 'enterDungeon', dungeon: gate.data, difficulty: 'normal' }] });
    await tickAll(env, 3); await flush(20);
    const instKey = a.key;
    a.input({ c: [{ type: 'rescue' }] });
    await tickAll(env, 2);
    const list = (await b.api('GET', '/api/rescue')).data.list;
    expect(list.map((x: any) => x.id)).toContain(instKey);
    expect((await b.api('POST', '/api/rescue/join', { id: instKey })).status).toBe(200);
    await tickAll(env, 3); await flush(20);
    expect(b.key).toBe(instKey);
    const inst = area(env, instKey);
    expect(playerOf(env, b).rescuer).toBe(true);
    const goldBefore = playerOf(env, b).char.gold;
    for (const m of inst.host.world.area.monsters) { m.hp = 0; m.dead = true; }
    await tickAll(env, 3);
    expect(b.snaps().flatMap((s) => s.ev ?? []).some((e: any) => e.type === 'rescued')).toBe(true);
    expect(playerOf(env, b).char.gold).toBeGreaterThan(goldBefore);
    expect((await b.api('GET', '/api/rescue')).data.list.length).toBe(0);
  });
});

describe('ビルド閲覧とギルド', () => {
  it('カードを公開すると探せる。ギルドだけにすると同じギルドの人だけ', async () => {
    const env = makeEnv();
    const [a, b] = await two(env);
    expect((await a.api('POST', '/api/builds/publish', { charId: (a as any).charId, visibility: 'public' })).status).toBe(200);
    const list = (await b.api('GET', '/api/builds?q=ALI')).data.list;
    expect(list.length).toBe(1);
    const card = (await b.api('GET', `/api/builds/${encodeURIComponent((a as any).charId)}`)).data.card;
    expect(card.name).toBe('ALICE');
    expect(card.equipment.weapon).toBeTruthy();
    await a.api('POST', '/api/builds/publish', { charId: (a as any).charId, visibility: 'guild' });
    expect((await b.api('GET', `/api/builds/${encodeURIComponent((a as any).charId)}`)).status).toBe(404);
    await a.api('POST', '/api/guild/create', { name: '花の会' });
    await a.api('POST', '/api/guild/invite', { handle: 'bob' });
    const g = (await a.api('GET', '/api/guild')).data.guild;
    await b.api('POST', '/api/guild/join', { id: g.id });
    await a.api('POST', '/api/builds/publish', { charId: (a as any).charId, visibility: 'guild' });
    expect((await b.api('GET', `/api/builds/${encodeURIComponent((a as any).charId)}`)).status).toBe(200);
  });

  it('ギルド：作った人の拠点を引き継ぎ、仲間はその拠点の効果を受ける。名前は重複できない。役職と脱退', async () => {
    const env = makeEnv();
    const [a, b] = await two(env);
    // a は自分の拠点を少し建てていた
    const acc = (env as any).ACCOUNT.get((env as any).ACCOUNT.idFromName(a.accountId));
    const d = await call<any>(acc, 'dump');
    expect(d.account.base.levels).toEqual({});
    expect((await a.api('POST', '/api/guild/create', { name: '月の庭' })).status).toBe(200);
    expect((await b.api('POST', '/api/guild/create', { name: '月の庭' })).status).toBe(409);
    await a.api('POST', '/api/guild/invite', { handle: 'bob' });
    const gid = (await a.api('GET', '/api/guild')).data.guild.id;
    expect((await b.api('POST', '/api/guild/join', { id: gid })).status).toBe(200);
    await b.play((b as any).charId);
    // ギルドの拠点に施設が建つと、遊んでいる仲間にも効く
    const gs = (env as any).GUILD.get((env as any).GUILD.idFromName(gid));
    expect((await call<any>(gs, 'setFacility', { a: a.accountId, facility: 'training', level: 1 })).ok).toBe(true);
    expect((await call<any>(gs, 'setFacility', { a: a.accountId, facility: 'training', level: 1 })).ok).toBe(false);
    await flush(10);
    expect(playerOf(env, b).guildBase.levels.training).toBe(1);
    expect((await a.api('POST', '/api/guild/role', { a: b.accountId, role: 'officer' })).status).toBe(200);
    expect((await b.api('POST', '/api/guild/leave')).status).toBe(200);
    await flush(10);
    expect(playerOf(env, b).guildBase).toBeNull();
  });
});
