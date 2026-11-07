/**
 * バランス確認：武器ごとの DPS（と M6 以降は経済の入出量）を表にする。
 *   npm run balance
 * 実際の shared の step() で訓練用の人形を殴り続けて測る。
 */
import check from '../data/balance_check.json';
import {
  CONTENT, PRIMARY_STATS, monsterStats, NO_SCALE, WEAPON_TYPES, createItem, createWorld, emptyInput, isOnBeat, chargeLevel, newAccount,
  newCharacter, Rng, slotSkill, spawnMonster, step, tierFor, type PlayerInput, type PrimaryStat, type WeaponType, type World,
} from '../shared/src';
import { economyReport } from './economy';

type Row = Record<string, string | number>;

function setupWorld(weapon: WeaponType, level: number, targets: number): World {
  const acc = newAccount(1, 7);
  const ch = newCharacter(acc, 'bal', { body: 0, hair: 0 }, 1);
  ch.tutorial.done = true;
  ch.level = level;
  ch.location = { area: 'training', x: 8.5, y: 13.5 };
  // ステ振り
  const preset = (check.weapons as Record<string, { stats: Partial<Record<PrimaryStat, number>>; range: string }>)[weapon];
  const total = CONTENT.balance.progression.startStatPoints + CONTENT.balance.progression.statPointsPerLevel * (level - 1);
  const max = Infinity; // 1つのステータスに上限はない（効き目は softCap で下がる）
  let left = total;
  for (const s of PRIMARY_STATS) ch.stats[s] = 0;
  const order = Object.entries(preset.stats).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  for (const [s, r] of order) {
    const n = Math.min(max, Math.floor(total * (r ?? 0)), left);
    ch.stats[s as PrimaryStat] = n; left -= n;
  }
  for (const [s] of order) { const add = Math.min(left, max - ch.stats[s as PrimaryStat]); ch.stats[s as PrimaryStat] += add; left -= add; }
  // 武器
  const base = Object.keys(CONTENT.equipment.bases).find((id) => CONTENT.equipment.bases[id].kind === weapon)!;
  const it = createItem(acc.nextUid++, base, tierFor(level, CONTENT), level, check.rarity as 'rare', new Rng(level), CONTENT);
  it.options = []; it.element = 'neutral';
  ch.equipment.weapon = it;
  // スキル（武器ツリーを全部同じレベルで）
  const lv = (check.skillLevel as Record<string, number>)[String(level)] ?? 5;
  const tree = Object.entries(CONTENT.skills).filter(([, d]) => d.tree === weapon);
  for (const [id] of tree) ch.skills[id] = lv;
  const actives = tree.filter(([, d]) => d.type === 'active').sort((a, b) => b[1].tier - a[1].tier).slice(0, 4).map(([id]) => id);
  ch.skillSlots[weapon] = [...actives, null, null, null, null].slice(0, 4);
  const w = createWorld({ account: acc, characterId: ch.id, seed: 99, now: 0 });
  const p = w.players[0];
  const dist = (check.distance as Record<string, number>)[preset.range];
  for (let i = 0; i < targets; i++) {
    const m = spawnMonster(w, { key: `d${i}`, monster: 'dummy', x: p.x + dist + (i > 0 ? 0.5 : 0), y: p.y + (i === 1 ? 1.0 : i === 2 ? -1.0 : 0), level: [level, level], monsterId: -1, respawnAt: 0 }, { level, scale: { hp: 1e6 } });
    m.facing = Math.PI; // プレイヤーの方を向く（背面撃ちなし）
  }
  return w;
}

function measure(weapon: WeaponType, level: number, targets: number): number {
  const w = setupWorld(weapon, level, targets);
  const p = w.players[0];
  const home = w.area.monsters.map((m) => ({ m, x: m.x, y: m.y }));
  const ticks = check.duration * CONTENT.balance.tickRate;
  let dmg = 0;
  let hold = 0;
  for (let t = 0; t < ticks; t++) {
    const input: PlayerInput = { ...emptyInput(), aim: { x: 1, y: 0 } };
    // スキル：使えるものを枠の順に
    for (let i = 0; i < 4; i++) {
      const id = slotSkill(w, p, i);
      if (!id) continue;
      const d = CONTENT.skills[id];
      const lv = p.char.skills[id];
      const mp = Array.isArray(d.mp) ? d.mp[0] + d.mp[1] * (lv - 1) : d.mp ?? 0;
      if ((p.skillCd[id] ?? 0) <= 0 && p.mp >= mp && p.lock <= 0) { input.skill = i; break; }
    }
    const mech = CONTENT.weapons[weapon].mechanic;
    if (mech.type === 'charge') {
      // 最大まで溜めて放す
      if (chargeLevel(w, p) >= mech.levels.length) { input.attack = false; hold = 0; }
      else { input.attack = true; hold++; }
    } else if (mech.type === 'rhythm') {
      input.attack = isOnBeat(w, mech, w.tick + 1) && !p.prevAttack;
    } else input.attack = true;
    p.x = 8.5; p.y = 13.5;
    for (const h of home) { h.m.x = h.x; h.m.y = h.y; }
    const ev = step(w, new Map([[p.id, input]]));
    for (const e of ev) if (e.type === 'damage' && e.src === p.id) dmg += e.amount;
  }
  return dmg / check.duration;
}

function fmt(n: number) { return Math.round(n).toLocaleString('en-US'); }

function dpsReport() {
  const rows: Row[] = [];
  const results: Record<string, Record<string, number>> = {};
  for (const wt of WEAPON_TYPES) {
    const r: Record<string, number> = {};
    for (const lv of check.levels) r[`Lv${lv}`] = measure(wt, lv, 1);
    r[`Lv${check.levels.at(-1)}×${check.groupSize}`] = measure(wt, check.levels.at(-1)!, check.groupSize);
    results[wt] = r;
  }
  const cols = Object.keys(results[WEAPON_TYPES[0]]);
  const med: Record<string, number> = {};
  for (const c of cols) {
    const v = WEAPON_TYPES.map((w) => results[w][c]).sort((a, b) => a - b);
    med[c] = (v[4] + v[5]) / 2;
  }
  for (const wt of WEAPON_TYPES) {
    const row: Row = { 武器: CONTENT.weapons[wt].name };
    for (const c of cols) row[c] = `${fmt(results[wt][c])} (${Math.round((results[wt][c] / med[c]) * 100)}%)`;
    rows.push(row);
  }
  console.log('\n■ 武器ごとの DPS（中央値に対する割合）');
  console.table(rows);
  const bad = WEAPON_TYPES.filter((wt) => cols.slice(0, check.levels.length).some((c) => Math.abs(results[wt][c] / med[c] - 1) > check.tolerance));
  // 倒すまでの時間（同じ敵を各レベルにしたとき）。Lv100 を 1 とした比。企画では 0.9〜1.2 に収める
  const ref = CONTENT.monsters[check.ttkMonster];
  const ttk = (lv: number) => monsterStats(ref, lv, CONTENT, NO_SCALE).maxHp / med[`Lv${lv}`];
  if (med['Lv100']) {
    console.log(`\n■ 倒すまでの時間（${ref.name}・中央値の武器、Lv100 = 1）`);
    console.table(check.levels.map((lv) => ({ Lv: lv, 秒: ttk(lv).toFixed(2), 比: (ttk(lv) / ttk(100)).toFixed(2) })));
  }
  if (bad.length) console.log(`  ※ 中央値から ±${check.tolerance * 100}% を超える武器: ${bad.map((w) => CONTENT.weapons[w].name).join('、')}`);
  else console.log(`  すべての武器が中央値の ±${check.tolerance * 100}% 以内`);
}

dpsReport();
economyReport();
