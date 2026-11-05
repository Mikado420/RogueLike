import { describe, expect, it } from 'vitest';
import { newAccount, newCharacter, migrateAccount, serializeAccount } from '../src/save';
import { createWorld } from '../src/systems/world';
import { CONTENT } from '../src/content';
import { tick } from './helpers';
import { OfflineServices } from '../src/online';

const C = CONTENT;
function fresh() {
  const acc = newAccount(1000, 5);
  const ch = newCharacter(acc, 'N', { body: 0, hair: 0 }, 1000);
  const w = createWorld({ account: acc, characterId: ch.id, seed: 5, now: 0 });
  return { acc, ch, w, p: w.players[0] };
}

describe('チュートリアル', () => {
  it('新しいキャラは最初のフィールドから始まり、移動→攻撃→回避の順に進む', () => {
    const { w, p, ch } = fresh();
    expect(w.area.id).toBe(C.tutorial.area);
    expect(ch.tutorial).toEqual({ step: 0, count: 0, done: false });
    for (const m of w.area.monsters) { m.dead = true; m.hp = 0; }
    w.area.monsters = [];
    tick(w, p, { move: { x: 1, y: 0 } }, 60);
    tick(w, p, { move: { x: -1, y: 0 } }, 60);
    expect(ch.tutorial.step).toBe(1);
    // 攻撃：人形を叩く
    const steps = C.tutorial.steps;
    expect(steps[ch.tutorial.step].type).toBe('hit');
  });

  it('全段を終えると報酬。スキップもできる', () => {
    const { w, p, ch } = fresh();
    const gold = ch.gold;
    ch.tutorial.step = C.tutorial.steps.length - 1;
    // 最後は「街へ」：街に入れば終わり
    const town = C.balance.world.startArea;
    w.area.type = 'town';
    tick(w, p, {}, 1);
    expect(ch.tutorial.done).toBe(true);
    expect(ch.gold).toBeGreaterThanOrEqual(gold + C.tutorial.reward.gold);
    expect(town).toBeTruthy();

    const b = fresh();
    tick(b.w, b.p, { commands: [{ type: 'skipTutorial' }] }, 1);
    expect(b.ch.tutorial.done).toBe(true);
  });

  it('装備の段に来ると練習用の装備がもらえる', () => {
    const { w, p, ch } = fresh();
    const i = C.tutorial.steps.findIndex((s) => s.gift);
    ch.tutorial.step = i - 1;
    ch.tutorial.count = 0;
    const prev = C.tutorial.steps[i - 1];
    expect(prev.type).toBe('stats');
    ch.stats.str = 1;
    const n = ch.inventory.length;
    tick(w, p, {}, 1);
    expect(ch.tutorial.step).toBe(i);
    expect(ch.inventory.length).toBe(n + 1);
  });

  it('古いセーブのキャラはチュートリアル済み扱い', () => {
    const acc = newAccount(1, 1);
    newCharacter(acc, 'A', { body: 0, hair: 0 }, 1);
    const raw = JSON.parse(serializeAccount(acc));
    raw.version = 6;
    delete raw.characters[0].tutorial;
    const m = migrateAccount(raw);
    expect(m.characters[0].tutorial.done).toBe(true);
  });
});

describe('オンライン用の窓口', () => {
  it('オフラインではどれも使えない', async () => {
    expect(OfflineServices.status().online).toBe(false);
    const r = await OfflineServices.market.search('剣');
    expect(r.ok).toBe(false);
    const c = await OfflineServices.chat.send('world', 'hi');
    expect(c).toEqual({ ok: false, reason: 'offline' });
  });
});
