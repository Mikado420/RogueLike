// 進化する生態系。企画書「コアシステム」の実装。
// プレイヤーの撃破記録が自然淘汰の圧力になり、世代ごとに繁殖・交配・突然変異・新種・絶滅が起きる。
import { ELEMENTS, ELEMENT_INFO, preyOf } from './elements.js';
import { Rng, clamp, uid } from './rng.js';
import { randomGenome, mutate, crossover, distance, meanGenome, cloneGenome } from './genome.js';
import { defaultSpeciesName, unnamedLabel } from './names.js';

export const AREAS = [
  { id: 'moss',    name: '苔むす森',     env: 'earth' },
  { id: 'lake',    name: '湖底洞窟',     env: 'water' },
  { id: 'volcano', name: '火山回廊',     env: 'fire' },
  { id: 'glacier', name: '氷河の裂け目', env: 'ice' },
  { id: 'spire',   name: '嵐の尖塔',     env: 'wind' },
  { id: 'mine',    name: '雷鳴の坑道',   env: 'thunder' },
  { id: 'chapel',  name: '光の聖堂跡',   env: 'light' },
  { id: 'abyss',   name: '深淵',         env: 'dark' },
];
export const areaById = (id) => AREAS.find((a) => a.id === id);

export const ECO = {
  poolSize: 16,
  areaCap: 240,
  speciationThreshold: 2.6,
  speciationMin: 5,
  maxSpeciesPerArea: 6,
  endangered: 12,
  apexCooldown: 8,     // 世代
  apexDuration: 3,     // 世代
  virtualKillsPerSpecies: 3, // 人が少ないときの仮想ハンター
};

function newSpecies(eco, rng, area, proto, opts = {}) {
  const id = uid(rng, 's');
  const pool = [];
  for (let i = 0; i < ECO.poolSize; i++) pool.push(mutate(proto, rng, 1.5));
  for (const g of pool) delete g.mutant;
  const sp = {
    id, area: area.id,
    name: opts.name || unnamedLabel(id),
    named: !!opts.name,
    namedBy: opts.namedBy || null,
    discoveredBy: null,
    parentId: opts.parentId || null,
    createdGen: eco.generation,
    extinctGen: null,
    pop: opts.pop ?? 60,
    proto: cloneGenome(proto),
    pool,
  };
  eco.species[id] = sp;
  return sp;
}

export function createEcosystem(seed = 'evolving-depths') {
  const rng = new Rng(seed);
  const eco = { generation: 0, seed: String(seed), species: {}, pending: {}, apex: null, lastApexGen: 0, history: [] };
  AREAS.forEach((area, ai) => {
    const bodies = [area.env, ...preyOf(area.env), rng.pick(ELEMENTS)];
    bodies.forEach((body, i) => {
      const g = randomGenome(rng, body);
      newSpecies(eco, rng, area, g, { name: defaultSpeciesName(g, ai + i), pop: 50 + rng.int(0, 30) });
    });
  });
  return eco;
}

export const speciesPool = (sp) => (sp.pool.length ? sp.pool : [sp.proto]);
export const aliveSpecies = (eco, areaId) =>
  Object.values(eco.species).filter((s) => s.extinctGen === null && (!areaId || s.area === areaId));

/** ダンジョンで倒された記録を貯める（次の世代計算で使う） */
export function recordKill(eco, speciesId, element = 'none', count = 1) {
  const k = (eco.pending[speciesId] ||= { total: 0, byEl: {} });
  k.total += count;
  k.byEl[element] = (k.byEl[element] || 0) + count;
}

function fitness(g, pressure, env) {
  // 狩りに使われた属性への耐性が高い個体ほど生き残りやすい
  let x = 0;
  for (const [el, share] of Object.entries(pressure)) {
    if (el === 'none' || g.resist[el] === undefined) continue;
    x += share * g.resist[el];
  }
  let f = Math.exp(7 * x);
  if (g.body === env) f *= 1.15;
  f *= 1 + (g.speed - 0.5) * 0.1;
  return Math.max(0.01, f);
}

/** 生態系を1世代進める。news を返す */
export function stepEcosystem(eco, opts = {}) {
  const rng = new Rng(`${eco.seed}:gen:${eco.generation}`);
  eco.generation++;
  const news = [];
  const gen = eco.generation;
  const say = (kind, text, extra = {}) => news.push({ gen, kind, text, ...extra });

  const realKills = Object.values(eco.pending).reduce((s, k) => s + k.total, 0);
  const useVirtual = (opts.virtualHunters ?? true) && realKills < 40;

  for (const area of AREAS) {
    const list = aliveSpecies(eco, area.id);
    const totalPop = list.reduce((s, sp) => s + sp.pop, 0);

    for (const sp of list) {
      const kills = eco.pending[sp.id] || { total: 0, byEl: {} };
      const byEl = { ...kills.byEl };
      let total = kills.total;
      if (useVirtual) {
        const el = rng.pick([...ELEMENTS, 'none']);
        byEl[el] = (byEl[el] || 0) + ECO.virtualKillsPerSpecies;
        total += ECO.virtualKillsPerSpecies;
      }
      const pressure = {};
      const strength = Math.min(1, total / 10);
      for (const [el, c] of Object.entries(byEl)) pressure[el] = (c / Math.max(1, total)) * strength;

      // 個体数の増減
      const mean = meanGenome(sp.pool);
      const r = 0.22 + 0.3 * mean.fecundity + (mean.body === area.env ? 0.08 : 0);
      // 種ごとの上限（同じ種が増えすぎると餌や住処が足りなくなる）と、エリア全体の混雑
      const kSelf = ECO.areaCap * 0.4;
      let growth = r * sp.pop * (1 - sp.pop / kSelf);
      if (totalPop > ECO.areaCap) growth -= (totalPop - ECO.areaCap) * (sp.pop / totalPop) * 0.5;
      let predation = 0;
      for (const q of list) {
        if (q === sp || q.extinctGen !== null) continue;
        const qBody = meanGenome(speciesPool(q)).body;
        if (preyOf(qBody).includes(mean.body)) predation += sp.pop * Math.min(0.12, 0.001 * q.pop);
      }
      const before = sp.pop;
      const huntLoss = total / (1 + total / 40); // 大量に狩られても一度に消えすぎない
      sp.pop = Math.max(0, sp.pop + growth - sp.pop * 0.04 - huntLoss - predation);

      // 自然淘汰と繁殖
      const n = ECO.poolSize;
      const survivors = [];
      const keep = Math.max(2, Math.round(n * 0.55));
      for (let i = 0; i < keep; i++) survivors.push(rng.weighted(sp.pool, (g) => fitness(g, pressure, area.env)));
      const rate = 1 + (sp.pop < 20 ? 1 : 0) + (opts.mutationBoost || 0);
      const next = survivors.map((g) => { const c = cloneGenome(g); delete c.mutant; return c; });
      while (next.length < n) {
        const a = rng.pick(survivors), b = rng.pick(survivors);
        next.push(mutate(crossover(a, b, rng), rng, rate));
      }
      sp.pool = next;

      if (sp.pop < 1) {
        sp.pop = 0;
        sp.extinctGen = gen;
        sp.pool = []; // 絶滅種は標本（proto）だけ残す
        say('extinct', `${area.name}の「${sp.name}」が絶滅した`, { speciesId: sp.id, area: area.id });
        continue;
      }
      if (sp.pop < ECO.endangered && before >= ECO.endangered) {
        say('endangered', `${area.name}の「${sp.name}」が絶滅の危機にある（残り約${Math.ceil(sp.pop)}体）`, { speciesId: sp.id, area: area.id });
      }
      if (sp.pop > before * 1.35 && sp.pop > 80) {
        say('boom', `${area.name}で「${sp.name}」が大繁殖している`, { speciesId: sp.id, area: area.id });
      }
      // 耐性の変化を知らせる
      for (const el of ELEMENTS) {
        const d = meanGenome(sp.pool).resist[el] - mean.resist[el];
        if (d > 0.06 && pressure[el] > 0.3) {
          say('adapt', `「${sp.name}」が${ELEMENT_INFO[el].ja}属性に強くなりつつある`, { speciesId: sp.id, area: area.id, element: el });
        }
      }

      // 新種の誕生
      const drifted = sp.pool.filter((g) => distance(g, sp.proto) > ECO.speciationThreshold);
      if (drifted.length >= ECO.speciationMin && sp.pop > 16 && aliveSpecies(eco, area.id).length < ECO.maxSpeciesPerArea) {
        const share = drifted.length / sp.pool.length;
        const child = newSpecies(eco, rng, area, meanGenome(drifted), { parentId: sp.id, pop: Math.round(sp.pop * share) });
        child.pool = drifted.map(cloneGenome);
        while (child.pool.length < n) child.pool.push(mutate(rng.pick(drifted), rng, 1));
        sp.pop -= child.pop;
        sp.pool = sp.pool.filter((g) => !drifted.includes(g));
        while (sp.pool.length < n) sp.pool.push(mutate(sp.proto, rng, 1));
        say('newSpecies', `${area.name}で「${sp.name}」から新種が分かれた。まだ誰も名付けていない`, { speciesId: child.id, area: area.id });
      }
    }

    // 空きができたら移入、または新しい生命が湧く
    const alive = aliveSpecies(eco, area.id);
    if (alive.length === 0) {
      const g = randomGenome(rng, area.env);
      const sp = newSpecies(eco, rng, area, g, { pop: 20 });
      say('arrival', `誰もいなくなった${area.name}に、未知の魔物が棲みついた`, { speciesId: sp.id, area: area.id });
    } else if (alive.length < 4 && rng.chance(0.15)) {
      const ai = AREAS.indexOf(area);
      const nb = AREAS[(ai + (rng.chance(0.5) ? 1 : AREAS.length - 1)) % AREAS.length];
      const cand = aliveSpecies(eco, nb.id).filter((s) => s.pop > 30);
      if (cand.length) {
        const src = rng.pick(cand);
        const sp = newSpecies(eco, rng, area, meanGenome(src.pool), { parentId: src.id, pop: 12, name: src.named ? src.name : undefined, namedBy: src.namedBy });
        sp.pool = src.pool.map((g) => mutate(g, rng, 1));
        src.pop -= 6;
        say('arrival', `${nb.name}から「${src.name}」の一群が${area.name}へ移り住んだ`, { speciesId: sp.id, area: area.id });
      }
    }
  }

  // 頂点捕食者
  if (eco.apex && !eco.apex.defeated && gen > eco.apex.endGen) {
    const sp = eco.species[eco.apex.speciesId];
    if (sp && sp.extinctGen === null) {
      sp.pop = Math.min(ECO.areaCap, sp.pop * 1.5);
      say('apexWin', `頂点捕食者「${eco.apex.name}」が${areaById(eco.apex.area).name}を支配した`, { speciesId: sp.id, area: eco.apex.area });
    }
    eco.apex = null;
  } else if (eco.apex && eco.apex.defeated) {
    eco.apex = null;
  }
  if (!eco.apex && gen - eco.lastApexGen >= ECO.apexCooldown) {
    const cand = aliveSpecies(eco).filter((s) => s.pop > ECO.areaCap * 0.27).sort((a, b) => b.pop - a.pop)[0];
    if (cand) {
      const g = meanGenome(cand.pool);
      g.size = 1; g.hp = 1; g.power = Math.max(g.power, 0.8);
      for (const el of ELEMENTS) g.resist[el] = clamp(g.resist[el] + 0.1, -0.5, 0.75);
      g.apex = true;
      eco.apex = {
        id: uid(rng, 'apex'), speciesId: cand.id, area: cand.area, genome: g,
        name: `${cand.name}の王`, startGen: gen, endGen: gen + ECO.apexDuration,
        maxHp: 6000, hp: 6000, defeated: false, contributors: {},
      };
      eco.lastApexGen = gen;
      say('apex', `${areaById(cand.area).name}に頂点捕食者「${eco.apex.name}」が誕生した。ワールドレイド開始`, { speciesId: cand.id, area: cand.area });
    }
  }

  eco.pending = {};
  eco.history.push({ gen, pops: Object.fromEntries(aliveSpecies(eco).map((s) => [s.id, Math.round(s.pop)])) });
  if (eco.history.length > 24) eco.history.shift();
  return news;
}

/** 頂点捕食者が倒されたときの処理 */
export function defeatApex(eco) {
  if (!eco.apex) return null;
  eco.apex.defeated = true;
  const sp = eco.species[eco.apex.speciesId];
  if (sp) sp.pop = Math.max(1, sp.pop * 0.5);
  return { gen: eco.generation, kind: 'apexDown', text: `頂点捕食者「${eco.apex.name}」が討伐された。系統は勢いを失った`, speciesId: eco.apex.speciesId };
}

/** ダンジョン生成用の、エリアの生態系の写し */
export function areaSnapshot(eco, areaId) {
  return aliveSpecies(eco, areaId).map((s) => ({
    id: s.id, name: s.name, named: s.named, pop: Math.round(s.pop),
    endangered: s.pop < ECO.endangered, pool: s.pool,
  }));
}
