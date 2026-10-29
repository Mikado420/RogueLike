import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../shared/world.js';
import { GameHost } from '../shared/host.js';
import { DungeonSim } from '../shared/sim.js';
import { areaSnapshot, AREAS, aliveSpecies, stepEcosystem } from '../shared/ecosystem.js';
import { playerStats } from '../shared/items.js';

function makeSim(world, area = AREAS[0]) {
  const sim = new DungeonSim({ seed: 'test', area, snapshotFn: () => areaSnapshot(world.eco, area.id) });
  return sim;
}

test('ダンジョン：倒すと全員に素材が落ち、脱出すると持ち帰れる', () => {
  const w = new World();
  const a = w.createPlayer('A').player, b = w.createPlayer('B').player;
  const sim = makeSim(w);
  sim.addPlayer({ id: a.id, name: 'A', stats: playerStats(a) });
  sim.addPlayer({ id: b.id, name: 'B', stats: playerStats(b) });
  sim.start();
  const pa = sim.players.get(a.id);
  for (const m of [...sim.monsters.values()].slice(0, 6)) sim.killMonster(m, pa, 'fire');
  const ra = sim.resultOf(a.id), rb = sim.resultOf(b.id);
  assert.ok(ra.materials.length > 0 && rb.materials.length > 0, '個別ドロップ');
  assert.equal(ra.kills.length, 6);
  // 脱出
  pa.x = sim.map.portal.x; pa.y = sim.map.portal.y;
  sim.setInput(a.id, { act: true });
  sim.step();
  assert.ok(pa.escaped);
  const out = w.finishRun(a.id, sim.resultOf(a.id));
  assert.equal(out.kept, ra.materials.length);
  assert.equal(w.state.players[a.id].materials.length, ra.materials.length);
});

test('ダンジョン：全滅すると素材を失う', () => {
  const w = new World();
  const a = w.createPlayer('A').player;
  const sim = makeSim(w);
  sim.addPlayer({ id: a.id, name: 'A', stats: playerStats(a) });
  sim.start();
  const p = sim.players.get(a.id);
  sim.killMonster([...sim.monsters.values()][0], p, 'none');
  sim.damagePlayer(p, 99999, 'none', { x: 0, y: 0 });
  for (let i = 0; i < 60; i++) sim.step();
  assert.ok(sim.finished && p.lost);
  const out = w.finishRun(a.id, sim.resultOf(a.id));
  assert.equal(out.kept, 0);
  assert.equal(w.state.players[a.id].materials.length, 0);
});

test('ダンジョン：仲間が近くにいるとダウンから起き上がれる', () => {
  const w = new World();
  const a = w.createPlayer('A').player, b = w.createPlayer('B').player;
  const sim = makeSim(w);
  sim.addPlayer({ id: a.id, name: 'A', stats: playerStats(a) });
  sim.addPlayer({ id: b.id, name: 'B', stats: playerStats(b) });
  sim.start();
  sim.monsters.clear();
  const pa = sim.players.get(a.id), pb = sim.players.get(b.id);
  sim.damagePlayer(pa, 99999, 'none', { x: 0, y: 0 });
  assert.ok(pa.down);
  pb.x = pa.x + 5; pb.y = pa.y;
  for (let i = 0; i < 60; i++) sim.step();
  assert.ok(!pa.down, '起き上がった');
});

test('ダンジョン：階段に全員がそろうと次の階へ', () => {
  const w = new World();
  const a = w.createPlayer('A').player;
  const sim = makeSim(w);
  sim.addPlayer({ id: a.id, name: 'A', stats: playerStats(a) });
  sim.start();
  sim.monsters.clear();
  const p = sim.players.get(a.id);
  p.x = sim.map.stairs.x; p.y = sim.map.stairs.y;
  sim.setInput(a.id, { act: true });
  sim.step();
  assert.equal(sim.floor, 2);
});

test('工房：牙2つで武器ができ、属性を受け継ぐ', () => {
  const w = new World();
  const a = w.createPlayer('A').player;
  const sim = makeSim(w, AREAS[2]);
  sim.addPlayer({ id: a.id, name: 'A', stats: playerStats(a) });
  sim.start();
  const p = sim.players.get(a.id);
  for (const m of [...sim.monsters.values()]) sim.killMonster(m, p, 'none');
  for (let i = 0; i < 10 && p.loot.materials.filter((m) => m.kind === 'fang').length < 2; i++) {
    sim.nextFloor();
    for (const m of [...sim.monsters.values()]) sim.killMonster(m, p, 'none');
  }
  w.finishRun(a.id, { ...sim.resultOf(a.id), escaped: true });
  const fangs = w.state.players[a.id].materials.filter((m) => m.kind === 'fang').slice(0, 2);
  assert.equal(fangs.length, 2);
  const r = w.craft(a.id, 'weapon', fangs.map((m) => m.id), 'spear');
  assert.ok(r.item, r.error);
  assert.equal(r.item.element, fangs[0].g.atk);
  assert.equal(r.item.type, 'spear');
  assert.ok(w.equip(a.id, r.item.id).ok);
  assert.equal(playerStats(w.state.players[a.id]).weaponType, 'spear');
});

test('取引所：出品して別の人が買うとお金が移る', () => {
  const w = new World();
  const a = w.createPlayer('A').player, b = w.createPlayer('B').player;
  const extra = { ...a.equipment[0], id: 'e-extra' };
  a.equipment.push(extra);
  const l = w.marketList(a.id, 'equipment', 'e-extra', 30);
  assert.ok(l.listing);
  b.gold = 100;
  const r = w.marketBuy(b.id, l.listing.id);
  assert.ok(r.ok);
  assert.equal(b.gold, 70);
  assert.equal(a.gold, 80);
  assert.ok(b.equipment.some((e) => e.id === 'e-extra'));
});

test('図鑑：最初に倒した人が未命名の種に名前を付けられる', () => {
  const w = new World();
  const a = w.createPlayer('A').player;
  const sp = aliveSpecies(w.eco)[0];
  sp.named = false;
  const { rights } = w.reportKills(a.id, [{ speciesId: sp.id, element: 'fire' }]);
  assert.deepEqual(rights, [sp.id]);
  assert.ok(w.nameSpecies(a.id, sp.id, 'アカツキ').ok);
  assert.equal(sp.name, 'アカツキ');
  assert.equal(sp.namedBy, 'A');
  assert.ok(w.nameSpecies(a.id, sp.id, 'ほかの名前').error);
});

test('進行役：パーティを組んで出発し、結果が届く', () => {
  const w = new World();
  const host = new GameHost(w, { ecoIntervalSec: 9999 });
  const inbox = { a: [], b: [] };
  host.connect('a', (m) => inbox.a.push(m));
  host.connect('b', (m) => inbox.b.push(m));
  host.handle('a', { type: 'hello', name: 'アリス' });
  host.handle('b', { type: 'hello', name: 'ボブ' });
  host.handle('a', { type: 'party:create' });
  const code = inbox.a.filter((m) => m.type === 'party').at(-1).party.code;
  host.handle('b', { type: 'party:join', code });
  host.handle('b', { type: 'dungeon:start', area: 'moss' });
  assert.ok(inbox.b.some((m) => m.type === 'error'), 'リーダー以外は出発できない');
  host.handle('a', { type: 'dungeon:start', area: 'moss' });
  host.tick();
  assert.ok(inbox.a.some((m) => m.type === 'dungeon:floor'));
  assert.ok(inbox.b.some((m) => m.type === 'dungeon:snap'));
  // アリスが脱出
  const inst = [...host.instances.values()][0];
  const pa = [...inst.sim.players.values()].find((p) => p.name === 'アリス');
  pa.x = inst.sim.map.portal.x; pa.y = inst.sim.map.portal.y;
  host.handle('a', { type: 'input', act: true });
  host.tick();
  const end = inbox.a.find((m) => m.type === 'dungeon:end');
  assert.ok(end && end.escaped);
  // ボブが切断すると、ダンジョンは閉じる
  host.disconnect('b');
  host.tick();
  assert.equal(host.instances.size, 0);
});

test('進行役：頂点捕食者が出るとレイドに入れる', () => {
  const w = new World();
  const host = new GameHost(w, { ecoIntervalSec: 9999 });
  const inbox = [];
  host.connect('a', (m) => inbox.push(m));
  host.handle('a', { type: 'hello', name: 'アリス' });
  host.handle('a', { type: 'raid:join' });
  assert.ok(inbox.some((m) => m.type === 'error'));
  const sp = aliveSpecies(w.eco)[0];
  sp.pop = 200;
  w.eco.lastApexGen = -99;
  stepEcosystem(w.eco);
  assert.ok(w.eco.apex, '頂点捕食者が誕生');
  host.handle('a', { type: 'raid:join' });
  host.tick();
  assert.ok(inbox.some((m) => m.type === 'dungeon:enter' && m.raid));
  const boss = [...host.raid.sim.monsters.values()].find((m) => m.boss);
  assert.ok(boss);
  const p = [...host.raid.sim.players.values()][0];
  host.raid.sim.damageMonster(boss, 999999, 'none', p);
  host.tick();
  assert.ok(w.eco.apex.defeated);
});
