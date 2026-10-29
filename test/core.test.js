import { test } from 'node:test';
import assert from 'node:assert/strict';
import { affinity, computeDamage, preyOf, CYCLE } from '../shared/elements.js';
import { randomGenome, crossover, mutate, distance } from '../shared/genome.js';
import { Rng } from '../shared/rng.js';
import { createEcosystem, stepEcosystem, recordKill, aliveSpecies, AREAS } from '../shared/ecosystem.js';
import { generateSprite } from '../shared/sprite.js';
import { generateFloor } from '../shared/dungeon.js';
import { areaSnapshot } from '../shared/ecosystem.js';

test('属性相性：6属性の循環', () => {
  for (let i = 0; i < CYCLE.length; i++) {
    const a = CYCLE[i], b = CYCLE[(i + 1) % CYCLE.length];
    assert.equal(affinity(a, b), 1.5, `${a}→${b} は有利`);
    assert.equal(affinity(b, a), 0.75, `${b}→${a} は不利`);
  }
  assert.equal(affinity('water', 'fire'), 1.5);
  assert.equal(affinity('ice', 'wind'), 1.5);
});

test('属性相性：同じ属性・無属性・光と闇', () => {
  for (const e of CYCLE) assert.equal(affinity(e, e), 1.0);
  assert.equal(affinity('none', 'fire'), 1.0);
  assert.equal(affinity('light', 'dark'), 1.5);
  assert.equal(affinity('dark', 'light'), 1.5);
  assert.equal(affinity('light', 'fire'), 1.0);
  assert.deepEqual(preyOf('thunder'), ['water']);
});

test('ダメージ式：基礎 × 相性 × (1 − 耐性)', () => {
  assert.equal(computeDamage(100, 'water', 'fire', 0), 150);
  assert.equal(computeDamage(100, 'water', 'fire', 0.5), 75);
  assert.equal(computeDamage(100, 'fire', 'water', -0.5), 113); // 0.75 × 1.5 = 112.5
  assert.equal(computeDamage(100, 'thunder', 'earth', 0, { wet: true }), 94); // 0.75 × 1.25
});

test('遺伝子：交配と突然変異は範囲内に収まる', () => {
  const rng = new Rng('g');
  for (let i = 0; i < 200; i++) {
    const c = mutate(crossover(randomGenome(rng), randomGenome(rng), rng), rng, 3);
    for (const k of ['size', 'hp', 'power', 'speed', 'fecundity', 'poison']) assert.ok(c[k] >= 0 && c[k] <= 1, k);
    for (const v of Object.values(c.resist)) assert.ok(v >= -0.5 && v <= 0.75);
  }
  const g = randomGenome(rng);
  assert.equal(distance(g, g), 0);
});

test('生態系：同じシードなら同じ結果になる', () => {
  const a = createEcosystem('same'), b = createEcosystem('same');
  for (let i = 0; i < 5; i++) { stepEcosystem(a); stepEcosystem(b); }
  assert.equal(JSON.stringify(a.species), JSON.stringify(b.species));
});

test('生態系：火で狩り続けると火への耐性が上がる', () => {
  const eco = createEcosystem('pressure');
  const mean = () => {
    const pools = aliveSpecies(eco, 'moss').flatMap((s) => s.pool);
    return pools.reduce((t, g) => t + g.resist.fire, 0) / pools.length;
  };
  const before = mean();
  for (let gen = 0; gen < 25; gen++) {
    for (const s of aliveSpecies(eco, 'moss')) recordKill(eco, s.id, 'fire', 5);
    stepEcosystem(eco, { virtualHunters: false });
  }
  assert.ok(mean() > before + 0.05, `火耐性 ${before.toFixed(3)} → ${mean().toFixed(3)}`);
});

test('生態系：エリアから生き物がいなくならない', () => {
  const eco = createEcosystem('alive');
  for (let gen = 0; gen < 30; gen++) stepEcosystem(eco);
  for (const a of AREAS) assert.ok(aliveSpecies(eco, a.id).length > 0, a.name);
});

test('ドット絵：遺伝子から決まった大きさの絵ができる', () => {
  const rng = new Rng('s');
  for (let i = 0; i < 50; i++) {
    const s = generateSprite(randomGenome(rng));
    assert.equal(s.px.length, s.w * s.h);
    assert.ok([...s.px].some((v) => v === 3), '体の色がある');
  }
});

test('ダンジョン：入口から階段と脱出口まで歩いて行ける', () => {
  const eco = createEcosystem('floor');
  for (const area of AREAS) {
    for (let f = 1; f <= 4; f++) {
      const m = generateFloor({ seed: `t${f}`, area, floor: f, snapshot: areaSnapshot(eco, area.id) });
      const T = 16;
      const seen = new Set();
      const q = [[Math.floor(m.start.x / T), Math.floor(m.start.y / T)]];
      while (q.length) {
        const [x, y] = q.pop();
        const k = y * m.w + x;
        if (x < 0 || y < 0 || x >= m.w || y >= m.h || seen.has(k) || m.tiles[k] !== 1) continue;
        seen.add(k);
        q.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
      const reach = (pt) => seen.has(Math.floor(pt.y / T) * m.w + Math.floor(pt.x / T));
      assert.ok(reach(m.stairs), `${area.name} ${f}階 階段`);
      assert.ok(reach(m.portal), `${area.name} ${f}階 脱出口`);
      assert.ok(m.spawns.length > 0);
    }
  }
});
