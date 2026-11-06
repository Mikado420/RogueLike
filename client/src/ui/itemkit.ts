import {
  CONTENT, baseBonus, baseOf, bagInfo, itemMods, nearRole, refineCost, txt,
  type CharacterData, type Item, type ModKey, type Player, type World,
} from '../../../shared/src';
import { bagIconUrl, iconImg } from './icons';
import { h } from './dom';

/** アイテムまわりの共通の計算（強さの比べ方・入手先・使い道・精錬の目安など） */

// ───────── 強さの比べ方 ─────────

/** 割合の補正は、だいたいこのくらいの実数に効くとみなす（並べ替えと ▲▼ の目安） */
const PCT_WEIGHT = 4;
const FLAT_WEIGHT: Partial<Record<ModKey, number>> = { maxHp: 0.12, maxMp: 0.25, hpRegen: 0.5 };

/** 装備のおおよその強さ（▲▼ と「強さ順」に使う） */
export function itemPower(it: Item): number {
  const m = itemMods(it, CONTENT);
  let s = 0;
  for (const [k, v] of Object.entries(m) as [ModKey, number][]) {
    if (!v) continue;
    if (k.endsWith('Pct') || k === 'critRate' || k === 'critDamage' || k === 'evasion' || k === 'blockRate') s += v * PCT_WEIGHT;
    else s += v * (FLAT_WEIGHT[k] ?? 1);
  }
  if (it.unique || it.mythic) s *= 1.08;
  return s;
}

/** 今の装備より強いか（1: 強い、-1: 弱い、0: ほぼ同じ） */
export function upgradeSign(it: Item, ch: CharacterData): -1 | 0 | 1 {
  const cur = ch.equipment[it.slot];
  if (!cur) return 1;
  if (cur.uid === it.uid) return 0;
  const a = itemPower(it), b = itemPower(cur);
  if (a > b * 1.03) return 1;
  if (a < b * 0.97) return -1;
  return 0;
}

// ───────── 入手先・使い道 ─────────

let sourceIndex: Map<string, string[]> | null = null;

function buildSources(): Map<string, string[]> {
  const src = new Map<string, string[]>();
  const add = (id: string, s: string) => {
    const l = src.get(id) ?? [];
    if (!l.includes(s)) l.push(s);
    src.set(id, l);
  };
  // モンスターがどこに出るか
  const where = new Map<string, string>();
  for (const a of Object.values(CONTENT.areas)) {
    const lists = [...(a.monsters ?? []), ...(a.night ?? []), ...(a.ambush ?? [])] as { id: string }[];
    for (const m of lists) if (!where.has(m.id)) where.set(m.id, a.name);
    if (a.fieldBoss) where.set(a.fieldBoss.id, a.name);
  }
  for (const d of Object.values(CONTENT.dungeons.dungeons)) {
    for (const m of d.monsters) if (!where.has(m)) where.set(m, d.name);
    where.set(d.boss, d.name);
    if (d.crystal) add(d.crystal, txt('src.dungeon', d.name));
  }
  for (const [id, m] of Object.entries(CONTENT.monsters)) {
    const place = where.get(id);
    const label = place ? txt('src.monster', m.name, place) : m.name;
    for (const x of m.mats ?? []) add(x.id, label);
    if (m.crystal) add(m.crystal.id, label);
  }
  if (CONTENT.tower?.crystal) add(CONTENT.tower.crystal.id, txt('src.tower'));
  for (const r of Object.values(CONTENT.raids)) if (r.crystal) add(r.crystal.id, txt('src.raid', r.name));
  // 採集
  for (const [areaId, ga] of Object.entries(CONTENT.gathering.areas)) {
    const area = CONTENT.areas[areaId]?.name ?? areaId;
    for (const [type, list] of Object.entries(ga.tables)) {
      for (const x of list as { id: string; night?: boolean; weather?: string }[]) {
        const cond = [x.night ? txt('src.night') : '', x.weather ? CONTENT.weather.types[x.weather]?.name ?? x.weather : ''].filter(Boolean).join('・');
        add(x.id, txt(`src.gather.${type}`, area) + (cond ? `（${cond}）` : ''));
      }
    }
  }
  for (const s of Object.values(CONTENT.shops)) for (const id of s.items) add(id, txt('src.shop'));
  // 魔石はすべてのモンスターが落とす
  add(CONTENT.refine.stone, txt('src.allMonsters'));
  return src;
}

/** どこで手に入るか（短い文の一覧） */
export function sourcesOf(id: string): string[] {
  sourceIndex ??= buildSources();
  const l = sourceIndex.get(id) ?? [];
  // 魔石の入手先はモンスター名が並びすぎるので、まとめた1行と店だけにする
  if (id === CONTENT.refine.stone) return l.filter((s) => s === txt('src.allMonsters') || s === txt('src.shop'));
  return l;
}

/** いちばん手軽な入手先を1つ（足りない素材の横に出す） */
export function firstSource(id: string): string {
  return sourcesOf(id)[0] ?? '';
}

/** 何に使うか（短い文の一覧） */
export function usesOf(id: string): string[] {
  const out: string[] = [];
  const m = CONTENT.materials[id];
  if (m?.use?.capture) out.push(txt('use.capture'));
  else if (m?.use) out.push(txt('use.use'));
  if (id === CONTENT.refine.stone) out.push(txt('use.refine'));
  if (id === CONTENT.recipes.alchemy.catalyst) out.push(txt('use.alchemy'));
  if (CONTENT.crystals[id]) out.push(txt('use.crystal'));
  for (const t of CONTENT.recipes.smithing.tiers) {
    if ([t.ore, t.wood, t.extra].some(([x]) => x === id)) out.push(txt('use.smith', CONTENT.equipment.tiers[t.tier]?.prefix ?? ''));
  }
  for (const [food, r] of Object.entries(CONTENT.recipes.cooking)) if (r.mats[id]) out.push(txt('use.cook', CONTENT.materials[food]?.name ?? food));
  const named = CONTENT.crafted.recipes.filter((r) => r.mats[id]);
  if (named.length) out.push(txt('use.named', named.length, named[0].name));
  for (const f of Object.values(CONTENT.base.facilities)) if (f.cost.mats[id]) out.push(txt('use.base', f.name));
  return out;
}

// ───────── 材料の表示 ─────────

/** 材料と金の小さな札（足りないものは赤）。足りない素材の入手先も返す */
export function costChips(ch: CharacterData, mats: [string, number][], gold: number): { el: HTMLElement; ok: boolean; missing: { id: string; lack: number }[] } {
  const el = h('div', 'cost-chips');
  const missing: { id: string; lack: number }[] = [];
  let ok = ch.gold >= gold;
  for (const [id, n] of mats) {
    const have = ch.bag[id] ?? 0;
    const chip = h('span', `cchip${have < n ? ' bad' : ''}`);
    chip.append(iconImg(bagIconUrl(id), 'cchip-ico'), h('span', '', `${bagInfo(id).name} ${have}/${n}`));
    chip.title = bagInfo(id).name;
    el.append(chip);
    if (have < n) { ok = false; missing.push({ id, lack: n - have }); }
  }
  if (gold > 0) el.append(h('span', `cchip gold${ch.gold < gold ? ' bad' : ''}`, `${gold.toLocaleString()} G`));
  return { el, ok, missing };
}

/** 足りない素材の一行（「蜂の針 ×3：ホーネット（翠風の草原）」） */
export function missingLine(missing: { id: string; lack: number }[]): HTMLElement | null {
  if (!missing.length) return null;
  const el = h('div', 'missing');
  for (const m of missing.slice(0, 3)) {
    const src = firstSource(m.id);
    el.append(h('div', '', `${txt('craft.lack')} ${bagInfo(m.id).name} ×${m.lack}${src ? `　${src}` : ''}`));
  }
  return el;
}

// ───────── 精錬の目安 ─────────

export interface RefineEstimate { stones: number; gold: number; tries: number }

/**
 * 今の精錬値から目標までの、魔石・金・回数の目安（何度も試して平均をとる）。
 * 失敗で下がる段と、失敗ごとに上がる天井も含める
 */
export function refineEstimate(w: World, p: Player, it: Item, target: number, runs = 400): RefineEstimate {
  const bonus = baseBonus(baseOf(p), CONTENT, w.clock, 'refineRate');
  let stones = 0, gold = 0, tries = 0;
  const probe: Item = { ...it };
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let r = 0; r < runs; r++) {
    probe.refine = it.refine;
    probe.refinePity = it.refinePity;
    let n = 0;
    while (probe.refine < target && n < 400) {
      const c = refineCost(probe, CONTENT, bonus);
      if (!c) break;
      stones += c.stones; gold += c.gold; n++;
      if (rnd() * 100 < c.rate) { probe.refine++; probe.refinePity = 0; }
      else { probe.refine = Math.max(0, probe.refine - CONTENT.refine.levels[probe.refine].drop); probe.refinePity += CONTENT.refine.pityPerFail; }
    }
    tries += n;
  }
  return { stones: stones / runs, gold: gold / runs, tries: tries / runs };
}

/** 丸めた目安の数（「約190」「約12万」） */
export function approx(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000) / 10}万`;
  if (n >= 100) return String(Math.round(n / 10) * 10);
  return String(Math.max(1, Math.round(n)));
}

// ───────── そばにいる NPC ─────────

export function near(w: World, p: Player, role: string): boolean {
  return nearRole(w, p, role);
}
