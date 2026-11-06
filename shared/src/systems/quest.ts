import { addMods, type Mods } from '../core';
import type { Content } from '../content/types';
import type { CharacterData, MissionState, Player, World } from '../state';
import { hash32, Rng } from '../rng';
import { onCounter, setCounterMax } from './counters';
import { registerModSource } from './stats';
import { addToBag } from './items';
import { expToNext, gainExp } from './progression';

/**
 * 日替わり・週替わりミッション、実績と称号、図鑑。
 * ミッションの進み具合は「記録（counters）の増えた分」で数える。
 */

export const dayIndex = (clock: number) => Math.floor(clock / 86400000);
export const weekIndex = (clock: number) => Math.floor((dayIndex(clock) + 3) / 7);

function makeMissions(c: Content, ch: CharacterData, kind: 'daily' | 'weekly', idx: number): MissionState[] {
  const list = kind === 'daily' ? c.missions.daily : c.missions.weekly;
  const count = kind === 'daily' ? c.missions.dailyCount : c.missions.weeklyCount;
  const rng = new Rng(hash32('missions', kind, idx));
  const pool = [...list];
  const out: MissionState[] = [];
  for (let i = 0; i < count && pool.length; i++) {
    const t = pool.splice(Math.floor(rng.next() * pool.length), 1)[0];
    out.push({ id: t.id, counter: t.counter, n: rng.int(t.n[0], t.n[1]), base: ch.counters[t.counter] ?? 0, claimed: false });
  }
  return out;
}

/** 日・週が変わっていたらミッションを入れ替える */
export function ensureMissions(w: World, p: Player) {
  const ch = p.char;
  const d = dayIndex(w.clock), wk = weekIndex(w.clock);
  if (ch.missions.day !== d) { ch.missions.day = d; ch.missions.daily = makeMissions(w.content, ch, 'daily', d); }
  if (ch.missions.week !== wk) { ch.missions.week = wk; ch.missions.weekly = makeMissions(w.content, ch, 'weekly', wk); }
  replaceRemoved(w.content, ch, 'daily');
  replaceRemoved(w.content, ch, 'weekly');
}

/** なくなったミッション（侵攻など）が残っていたら、まだ出ていない別のものに差し替える（ほかの進み具合はそのまま） */
function replaceRemoved(c: Content, ch: CharacterData, kind: 'daily' | 'weekly') {
  const cur = kind === 'daily' ? ch.missions.daily : ch.missions.weekly;
  if (cur.every((m) => missionTemplate(c, kind, m.id))) return;
  const list = kind === 'daily' ? c.missions.daily : c.missions.weekly;
  const rng = new Rng(hash32('missions-fix', kind, kind === 'daily' ? ch.missions.day : ch.missions.week));
  for (let i = 0; i < cur.length; i++) {
    if (missionTemplate(c, kind, cur[i].id)) continue;
    const pool = list.filter((t) => !cur.some((m) => m.id === t.id));
    if (!pool.length) { cur.splice(i--, 1); continue; }
    const t = pool[Math.floor(rng.next() * pool.length)];
    cur[i] = { id: t.id, counter: t.counter, n: rng.int(t.n[0], t.n[1]), base: ch.counters[t.counter] ?? 0, claimed: false };
  }
}

export function missionProgress(ch: CharacterData, m: MissionState): number {
  return Math.max(0, Math.min(m.n, (ch.counters[m.counter] ?? 0) - m.base));
}

export function missionTemplate(c: Content, kind: 'daily' | 'weekly', id: string) {
  return (kind === 'daily' ? c.missions.daily : c.missions.weekly).find((t) => t.id === id);
}

export function claimMission(w: World, p: Player, kind: 'daily' | 'weekly', index: number): string | null {
  ensureMissions(w, p);
  const ch = p.char;
  const m = (kind === 'daily' ? ch.missions.daily : ch.missions.weekly)[index];
  if (!m || m.claimed) return 'err.invalid';
  if (missionProgress(ch, m) < m.n) return 'err.notDone';
  const t = missionTemplate(w.content, kind, m.id);
  m.claimed = true;
  const r = t?.reward ?? {};
  if (r.gold) { ch.gold += r.gold; w.events.push({ type: 'gold', playerId: p.id, amount: r.gold }); }
  if (r.exp) gainExp(w, p, expToNext(ch.level, w.content) * r.exp);
  for (const [id, n] of Object.entries(r.items ?? {})) addToBag(ch, id, n);
  return null;
}

// ───────── 図鑑 ─────────

export function codexTotals(c: Content) {
  return {
    monsters: Object.entries(c.monsters).filter(([, d]) => !(d.tags ?? []).includes('dummy') && d.drops !== 'none').length,
    items: Object.keys(c.equipment.bases).length,
    materials: Object.keys(c.materials).length,
  };
}

export function codexPct(ch: CharacterData, c: Content): number {
  const t = codexTotals(c);
  const known = Object.keys(ch.codex.monsters).filter((id) => c.monsters[id] && c.monsters[id].drops !== 'none').length
    + Object.keys(ch.codex.items).length + Object.keys(ch.codex.materials).filter((id) => c.materials[id]).length;
  return Math.floor((known / (t.monsters + t.items + t.materials)) * 100);
}

export function codexMods(ch: CharacterData, c: Content): Mods {
  const pct = codexPct(ch, c);
  const m: Mods = {};
  for (const th of c.codex.thresholds) if (pct >= th.pct) addMods(m, th.mods);
  return m;
}

export function recordCodex(w: World, p: Player, kind: 'monsters' | 'items' | 'materials', id: string) {
  const book = p.char.codex[kind];
  const fresh = !book[id];
  book[id] = (book[id] ?? 0) + 1;
  if (fresh) {
    p.statsDirty = true;
    setCounterMax(w, p, 'codexPct', codexPct(p.char, w.content));
  }
}

// ───────── 実績と称号 ─────────

export function equipTitle(ch: CharacterData, title: string | null): string | null {
  if (title !== null && !ch.titles.unlocked.includes(title)) return 'err.invalid';
  ch.titles.equipped = title;
  return null;
}

export function titleMods(ch: CharacterData, c: Content): Mods {
  return ch.titles.equipped ? c.titles[ch.titles.equipped]?.mods ?? {} : {};
}

registerModSource((ch, c) => {
  const m: Mods = {};
  addMods(m, titleMods(ch, c));
  addMods(m, codexMods(ch, c));
  return m;
});

onCounter((w, p, key, total) => {
  for (const a of w.content.achievements) {
    if (a.counter !== key || total < a.n || p.char.achievements[a.id]) continue;
    p.char.achievements[a.id] = w.clock || 1;
    if (a.title && !p.char.titles.unlocked.includes(a.title)) p.char.titles.unlocked.push(a.title);
    w.events.push({ type: 'achievement', playerId: p.id, id: a.id });
  }
});
