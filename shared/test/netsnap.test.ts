import { describe, expect, it } from 'vitest';
import { newAccount, newCharacter } from '../src/save';
import { LocalServer } from '../src/host/local';
import { Bot } from '../src/host/bot';
import { Viewer, applySnapshot, buildFrame } from '../src/net/snapshot';
import { createMirrorWorld } from '../src/net/mirror';

describe('差分スナップショット', () => {
  it('差分だけを写しに入れ続けても、関心範囲の中はサーバーと同じになる', () => {
    const srv = new LocalServer({ seed: 3 });
    const sids: string[] = [];
    const bots: Bot[] = [];
    for (let i = 0; i < 3; i++) {
      const acc = newAccount(i + 1, i + 5);
      const ch = newCharacter(acc, `N${i}`, { body: 0, hair: 0 }, i);
      ch.tutorial.done = true; ch.level = 10;
      sids.push(srv.connect(acc, ch.id));
      bots.push(new Bot(i + 9));
    }
    const host = srv.host(sids[0])!;
    const mirror = createMirrorWorld(host.world.area.id);
    const viewer = new Viewer(12);
    let bytes = 0, full = 0;
    for (let t = 0; t < 300; t++) {
      sids.forEach((s, i) => srv.input(s, bots[i].think(host.world, host.player(s)!)));
      srv.tick();
      if (t % 2) continue;
      const me = host.player(sids[0])!;
      const frame = buildFrame(host.world);
      const msg = viewer.diff(frame, me, { tick: host.world.tick, clock: host.world.clock, ack: 0 }, []);
      const json = JSON.stringify(msg);
      bytes += json.length;
      full += frame.ents.reduce((s, e) => s + e.json.length, 0);
      applySnapshot(mirror, JSON.parse(json), me.id, me.char);
    }
    const me = host.player(sids[0])!;
    applySnapshot(mirror, JSON.parse(JSON.stringify(viewer.diff(buildFrame(host.world), me, { tick: host.world.tick, clock: host.world.clock, ack: 0 }, []))), me.id, me.char);
    const near = (o: { x: number; y: number }) => Math.hypot(o.x - me.x, o.y - me.y) <= 12;
    for (const m of host.world.area.monsters.filter((m) => !m.dead && near(m))) {
      const c = mirror.area.monsters.find((x) => x.id === m.id);
      expect(c, `monster ${m.id}`).toBeTruthy();
      expect(c!.x).toBeCloseTo(m.x, 1);
      expect(c!.hp).toBe(m.hp);
    }
    for (const p of host.world.players.filter(near)) {
      const c = mirror.players.find((x) => x.id === p.id)!;
      expect(c.x).toBeCloseTo(p.x, 1);
      expect(c.char.name).toBe(p.char.name);
    }
    // 毎回すべて送るより小さい
    expect(bytes).toBeLessThan(full * 0.8);
  });
});

describe('関心範囲の端', () => {
  it('一度見えたものは、範囲の少し外までは消さない（出たり消えたりしない）', async () => {
    const { Viewer, KEEP_MARGIN } = await import('../src/net/snapshot');
    const v = new Viewer(10);
    const frame = (x: number) => ({ tick: 0, areaJson: '{}', ents: [{ kind: 'mo' as const, id: 7, x, y: 0, json: `{"id":7,"x":${x}}`, fields: { id: '7', x: String(x) } }] });
    const me = { id: 1, x: 0, y: 0 };
    const base = { tick: 0, clock: 0 } as never;
    // 範囲の外から来たものは送らない
    expect(v.diff(frame(12), me, base, []).mo).toBeUndefined();
    // 中に入ったら送る
    expect(v.diff(frame(9.5), me, base, []).mo?.length).toBe(1);
    // 少し外に出ても消さない
    const m1 = v.diff(frame(10 + KEEP_MARGIN - 0.5), me, base, []);
    expect(m1.gone).toBeUndefined();
    // 十分に離れたら消す
    expect(v.diff(frame(10 + KEEP_MARGIN + 1), me, base, []).gone).toEqual([7]);
  });
});
