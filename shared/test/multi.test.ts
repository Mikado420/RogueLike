import { describe, expect, it } from 'vitest';
import { newAccount, newCharacter } from '../src/save';
import { CONTENT } from '../src/content';
import { LocalServer } from '../src/host/local';
import { Bot } from '../src/host/bot';
import { eventAudience } from '../src/host/audience';
import type { AccountData, Item } from '../src/state';

const C = CONTENT;

function makeAccount(i: number, area = 'meadow', level = 12): { acc: AccountData; charId: string } {
  const acc = newAccount(1000 + i, 77 + i);
  const ch = newCharacter(acc, `B${i}`, { body: i % 4, hair: 0 }, 1000 + i);
  ch.tutorial.done = true;
  ch.level = level;
  ch.stats.str = 20; ch.stats.vit = 15;
  ch.bag.potion_s = 20;
  const sp = C.areas[area].playerSpawn ?? null;
  ch.location = { area, x: sp?.x ?? 0, y: sp?.y ?? 0 };
  return { acc, charId: ch.id };
}

function runBots(n: number, ticks: number, cap = 30) {
  const srv = new LocalServer({ channelCap: cap, seed: 9 });
  const bots: { sid: string; bot: Bot; acc: AccountData; charId: string }[] = [];
  for (let i = 0; i < n; i++) {
    const { acc, charId } = makeAccount(i);
    bots.push({ sid: srv.connect(acc, charId), bot: new Bot(100 + i), acc, charId });
  }
  for (let t = 0; t < ticks; t++) {
    for (const b of bots) {
      const h = srv.host(b.sid)!;
      const p = h.player(b.sid)!;
      srv.input(b.sid, b.bot.think(h.world, p));
    }
    srv.tick();
  }
  return { srv, bots };
}

/** アカウント全体のアイテム（持ち物・装備・倉庫）の uid 一覧 */
function allUids(acc: AccountData): number[] {
  const out: number[] = [];
  for (const ch of acc.characters) {
    out.push(...ch.inventory.map((i) => i.uid));
    out.push(...Object.values(ch.equipment).filter((x): x is Item => !!x).map((i) => i.uid));
  }
  out.push(...acc.storage.items.map((i) => i.uid));
  return out;
}

describe('複数人で同じエリア', () => {
  for (const n of [2, 5, 10]) {
    it(`${n}人のボットが同じフィールドで見え合い、戦える`, () => {
      const { srv, bots } = runBots(n, 600);
      const host = srv.host(bots[0].sid)!;
      // 全員が同じワールドにいて、お互いが見える
      for (const b of bots) expect(srv.host(b.sid)).toBe(host);
      expect(host.world.players.length).toBe(n);
      // 魔物を倒した記録がある
      const kills = bots.reduce((s, b) => s + (b.acc.characters[0].counters.kills ?? 0), 0);
      expect(kills).toBeGreaterThan(0);
      // 別々のアカウントなのでキャラの id は重ならない
      expect(new Set(bots.map((b) => b.charId)).size).toBe(n);
    });
  }

  it('2人で同じ魔物を削ると、2人とも経験値をもらえる', () => {
    const srv = new LocalServer({ seed: 4 });
    const a = makeAccount(1), b = makeAccount(2);
    const sa = srv.connect(a.acc, a.charId), sb = srv.connect(b.acc, b.charId);
    const h = srv.host(sa)!;
    for (const m of h.world.area.monsters) { m.dead = true; m.hp = 0; }
    srv.tick();
    const pa = h.player(sa)!, pb = h.player(sb)!;
    const m = (h.world.area.monsters.find((x) => !x.dead && !x.fieldBoss) ?? null);
    const target = m ?? h.world.area.monsters[0];
    expect(target).toBeTruthy();
    const ea = a.acc.characters[0].exp, eb = b.acc.characters[0].exp, la = a.acc.characters[0].level, lb = b.acc.characters[0].level;
    for (let t = 0; t < 400 && !target.dead; t++) {
      target.x = pa.x + 1; target.y = pa.y; target.ai = 'wander'; target.busy = 99;
      pb.x = pa.x + 2; pb.y = pa.y;
      const inp = (dx: number) => ({ move: { x: 0, y: 0 }, aim: { x: dx, y: 0 }, attack: true, skill: -1, dodge: false, interact: false, commands: [] });
      srv.input(sa, inp(1)); srv.input(sb, inp(-1));
      srv.tick();
    }
    expect(target.dead).toBe(true);
    const ga = a.acc.characters[0], gb = b.acc.characters[0];
    expect(ga.exp > ea || ga.level > la).toBe(true);
    expect(gb.exp > eb || gb.level > lb).toBe(true);
  });

  it('人数上限を超えると別のチャンネルができる', () => {
    const { srv, bots } = runBots(10, 5, 4);
    const keys = new Set(bots.map((b) => srv.host(b.sid)!.key));
    expect(keys.size).toBe(3);
    for (const h of srv.hosts.values()) expect(h.population).toBeLessThanOrEqual(4);
  });

  it('本人だけのイベントは本人にだけ届く', () => {
    const { srv, bots } = runBots(3, 1);
    for (let t = 0; t < 400; t++) {
      for (const b of bots) { const h = srv.host(b.sid)!; srv.input(b.sid, b.bot.think(h.world, h.player(b.sid)!)); }
      srv.tick();
      for (const b of bots) {
        const pid = srv.host(b.sid)!.sessions.get(b.sid)!;
        for (const e of srv.drain(b.sid)) {
          const a = eventAudience(e);
          if (a !== 'all' && e.type !== 'areaChanged') expect(a).toBe(pid);
        }
      }
    }
  });

  it('同じキャラで新しく入ると古い接続が切れる', () => {
    const srv = new LocalServer();
    const { acc, charId } = makeAccount(1);
    const a = srv.connect(acc, charId);
    const b = srv.connect(acc, charId);
    expect(srv.sessions.has(a)).toBe(false);
    expect(srv.player(b)).toBeTruthy();
    expect(srv.host(b)!.world.players.length).toBe(1);
  });
});

describe('エリア移動（取り出して入れる）', () => {
  it('出口で隣のエリアのワールドへ移り、アイテムが増えも減りもしない', () => {
    const srv = new LocalServer({ serializeTransfers: true });
    const { acc, charId } = makeAccount(3, 'lumina', 5);
    const sid = srv.connect(acc, charId);
    const before = allUids(srv.sessions.get(sid)!.account).sort();
    const h = srv.host(sid)!;
    const ex = h.world.area.exits[0];
    const p = h.player(sid)!;
    p.x = (ex.rect[0] + ex.rect[2]) / 2; p.y = (ex.rect[1] + ex.rect[3]) / 2;
    srv.tick();
    srv.tick();
    const h2 = srv.host(sid)!;
    expect(h2).not.toBe(h);
    expect(h2.world.area.id).toBe(ex.to);
    expect(h.population).toBe(0);
    const acc2 = srv.sessions.get(sid)!.account;
    expect(allUids(acc2).sort()).toEqual(before);
    expect(new Set(allUids(acc2)).size).toBe(before.length);
    expect(srv.drain(sid).some((e) => e.type === 'areaChanged')).toBe(true);
  });

  it('同じ塔の階にいる2人は、階段で一緒に次の階へ移る。誰もいなくなったインスタンスは消える', () => {
    const srv = new LocalServer();
    const a = makeAccount(1, 'lumina', 30), b = makeAccount(2, 'lumina', 30);
    const sa = srv.connect(a.acc, a.charId), sb = srv.connect(b.acc, b.charId);
    const town = srv.host(sa)!;
    // 2人とも同じ塔の1階へ（パーティの代わりに同じ指定を渡す）
    const pa = town.player(sa)!, pb = town.player(sb)!;
    const spec = { kind: 'tower' as const, id: 'tower', difficulty: 'normal' as const, floor: 1, seed: 1234, returnTo: { area: 'lumina', spawn: null, x: pa.x, y: pa.y }, players: 2, party: [a.charId, b.charId] };
    pa.transition = { to: 'instance', spawn: '', instance: spec };
    pb.transition = { to: 'instance', spawn: '', instance: spec };
    srv.tick();
    const inst = srv.host(sa)!;
    expect(inst).toBe(srv.host(sb));
    expect(inst.world.area.instance?.floor).toBe(1);
    for (const m of inst.world.area.monsters) { m.hp = 0; m.dead = true; }
    srv.tick();
    expect(inst.world.area.instance?.cleared).toBe(true);
    const stairs = inst.world.area.npcs.find((n) => n.npc === 'stairs')!;
    const pa2 = inst.player(sa)!;
    pa2.x = stairs.x; pa2.y = stairs.y + 0.8;
    srv.input(sa, { move: { x: 0, y: 0 }, aim: null, attack: false, skill: -1, dodge: false, interact: true, commands: [] });
    srv.tick();
    srv.tick();
    const next = srv.host(sa)!;
    expect(next).toBe(srv.host(sb));
    expect(next).not.toBe(inst);
    expect(next.world.area.instance?.floor).toBe(2);
    expect(srv.hosts.has(inst.key)).toBe(false);
  });
});
