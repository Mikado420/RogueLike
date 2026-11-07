import { CONTENT } from './content';
import type { Content } from './content/types';
import { EQUIP_SLOTS, PRIMARY_STATS, RARITIES } from './core';
import type { AccountData, CharacterData, Item } from './state';
import { migrateAccount, normalizeCharacter } from './save';
import { expToNext, totalSkillPoints, totalStatPoints } from './systems/progression';
import { optionValue } from './systems/loot';

/**
 * オフライン版のセーブを、サーバーへ引き継ぐ前に確かめる。
 * 版の変換（MIGRATIONS）を通したあと全部の項目を見て、おかしいものは削る（キャラごとは拒否しない）。
 */

export interface Removed { char: string | null; what: string; reason: string }

export const LIMITS = { gold: 999_999_999, bagEach: 9999, maxIlvl: 330 };

const finite = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** 装備1つが data と合っているか。合わなければ理由 */
export function checkItem(it: Item, c: Content = CONTENT): string | null {
  if (!it || typeof it !== 'object') return 'unknown';
  const base = c.equipment.bases[it.base];
  if (!base) return 'unknown';
  if (it.slot !== base.slot || it.kind !== base.kind) return 'unknown';
  if (!RARITIES.includes(it.rarity)) return 'unknown';
  if (!finite(it.refine, 0, c.refine.max) || !Number.isInteger(it.refine)) return 'refine';
  if (!finite(it.ilvl, 1, LIMITS.maxIlvl)) return 'level';
  if (!finite(it.tier, 0, c.equipment.tiers.length - 1) || !Number.isInteger(it.tier)) return 'level';
  const rd = c.rarities.defs[it.rarity];
  // 基本の数値（段とレアリティの上限まで）
  const tier = c.equipment.tiers[it.tier];
  for (const [k, v] of Object.entries(it.stats ?? {})) {
    const b = (base.stats as Record<string, number>)[k];
    if (b === undefined) return 'stats';
    const max = c.equipment.flatStats.includes(k as never)
      ? Math.round(b * (1 + it.tier * c.equipment.flatTierGrowth)) + 1
      : Math.round(b * tier.mul * rd.statMul * 1.05) + 1;
    if (!finite(v, 0, max)) return 'stats';
  }
  // ランダムオプション（数・種類・幅）
  if (!Array.isArray(it.options) || it.options.length > rd.options) return 'options';
  const seen = new Set<string>();
  for (const o of it.options) {
    const od = c.options.pool.find((x) => x.key === o.key);
    if (!od || seen.has(o.key) || (od.slots && !od.slots.includes(base.slot))) return 'options';
    seen.add(o.key);
    const a = optionValue(od, it.ilvl, 0), b = optionValue(od, it.ilvl, 1);
    const eps = 1 / Math.pow(10, od.decimals ?? 0);
    if (!finite(o.value, Math.min(a, b) - eps, Math.max(a, b) + eps)) return 'options';
  }
  // 結晶の枠
  if (!Array.isArray(it.crystals) || it.crystals.length > rd.slots[1]) return 'crystal';
  for (const cr of it.crystals) if (cr !== null && !c.crystals[cr]) return 'crystal';
  if (it.unique && !c.uniques[it.unique]) return 'unknown';
  // 銘入り装備：レシピがあり、ベース・固定効果がレシピどおりであること
  if (it.crafted !== undefined) {
    const r = c.crafted.recipes.find((x) => x.id === it.crafted);
    if (!r || r.base !== it.base || it.unique !== `crafted.${r.id}`) return 'unknown';
  } else if (it.unique?.startsWith('crafted.')) return 'unknown';
  if (it.mythic && !c.mythics[it.mythic]) return 'unknown';
  if (it.set && !c.sets[it.set]) return 'unknown';
  if (!['free', 'once', 'none'].includes(it.trade)) return 'unknown';
  return null;
}

function fixBag(bag: Record<string, number>, c: Content, removed: Removed[], who: string | null) {
  for (const [id, n] of Object.entries(bag ?? {})) {
    if (!c.materials[id]) { delete bag[id]; removed.push({ char: who, what: id, reason: 'unknown' }); continue; }
    if (!finite(n, 0, LIMITS.bagEach) || !Number.isInteger(n)) {
      const k = Math.max(0, Math.min(LIMITS.bagEach, Math.floor(Number(n) || 0)));
      removed.push({ char: who, what: c.materials[id].name, reason: 'amount' });
      if (k > 0) bag[id] = k; else delete bag[id];
    }
  }
}

function checkCharacter(ch: CharacterData, c: Content, removed: Removed[], uids: Set<number>) {
  const who = String(ch.name ?? '').slice(0, 12) || '冒険者';
  ch.name = who;
  const pr = c.balance.progression;
  // レベル・経験値・転生
  if (!finite(ch.rebirths, 0, c.balance.rebirth.max) || !Number.isInteger(ch.rebirths)) { removed.push({ char: who, what: 'rebirths', reason: 'level' }); ch.rebirths = 0; }
  if (!finite(ch.level, 1, pr.maxLevel) || !Number.isInteger(ch.level)) { removed.push({ char: who, what: 'level', reason: 'level' }); ch.level = Math.max(1, Math.min(pr.maxLevel, Math.floor(Number(ch.level) || 1))); }
  const need = ch.level >= pr.maxLevel ? 1 : expToNext(ch.level, c);
  if (!finite(ch.exp, 0, need)) { ch.exp = 0; }
  // ステ振り：合計が上限を超えたら振り直し
  const k = c.balance.stats;
  let bad = !PRIMARY_STATS.every((s) => finite(ch.stats?.[s], 0, totalStatPoints(ch, c)) && Number.isInteger(ch.stats[s]));
  if (!finite(ch.personal?.value, 0, k.personalMax)) bad = true;
  if (ch.personal?.type && !c.balance.personal[ch.personal.type]) bad = true;
  const spent = bad ? Infinity : PRIMARY_STATS.reduce((s, x) => s + ch.stats[x], 0) + ch.personal.value;
  if (bad || spent > totalStatPoints(ch, c)) {
    removed.push({ char: who, what: 'stats', reason: 'points' });
    ch.stats = Object.fromEntries(PRIMARY_STATS.map((s) => [s, 0])) as CharacterData['stats'];
    ch.personal = { type: null, value: 0 };
  }
  // スキル
  let skillBad = false;
  for (const [id, lv] of Object.entries(ch.skills ?? {})) {
    const d = c.skills[id];
    if (!d || !finite(lv, 1, d.maxLevel) || !Number.isInteger(lv)) { skillBad = true; break; }
    if (ch.level < (pr.tierLevels[d.tier - 1] ?? 1) && ch.rebirths === 0) { skillBad = true; break; }
  }
  const sp = Object.values(ch.skills ?? {}).reduce((s, v) => s + (Number(v) || 0), 0);
  if (skillBad || sp > totalSkillPoints(ch, c)) {
    removed.push({ char: who, what: 'skills', reason: 'points' });
    ch.skills = {};
    ch.skillSlots = {};
  }
  for (const [wt, slots] of Object.entries(ch.skillSlots ?? {})) {
    ch.skillSlots[wt as keyof typeof ch.skillSlots] = (slots ?? []).map((s) => (s && ch.skills[s] ? s : null));
  }
  ch.builds = (ch.builds ?? []).map(() => null);
  // 装備・持ち物
  const keep = (it: Item | null | undefined): boolean => {
    if (!it) return false;
    const why = checkItem(it, c);
    if (why) { removed.push({ char: who, what: it?.name ?? String(it?.base), reason: why }); return false; }
    if (uids.has(it.uid)) { removed.push({ char: who, what: it.name, reason: 'duplicate' }); return false; }
    uids.add(it.uid);
    return true;
  };
  for (const s of EQUIP_SLOTS) {
    const it = ch.equipment?.[s] ?? null;
    if (it && (it.slot !== s || !keep(it))) { if (it.slot !== s) removed.push({ char: who, what: it.name, reason: 'unknown' }); ch.equipment[s] = null; }
  }
  ch.inventory = (ch.inventory ?? []).filter(keep);
  const inv = c.balance.player.inventorySize;
  if (ch.inventory.length > inv) {
    for (const it of ch.inventory.slice(inv)) removed.push({ char: who, what: it.name, reason: 'count' });
    ch.inventory = ch.inventory.slice(0, inv);
  }
  // ゴールド・素材
  if (!finite(ch.gold, 0, LIMITS.gold)) { removed.push({ char: who, what: 'gold', reason: 'gold' }); ch.gold = Math.max(0, Math.min(LIMITS.gold, Math.floor(Number(ch.gold) || 0))); }
  ch.gold = Math.floor(ch.gold);
  fixBag(ch.bag, c, removed, who);
  // ペット
  const pc = c.pets;
  ch.pets = (ch.pets ?? []).filter((pt) => {
    const ok = pt && c.monsters[pt.species]?.capturable && finite(pt.level, 1, pc.maxLevel) && Array.isArray(pt.skills) && pt.skills.length <= pc.skillSlots && pt.skills.every((s) => pc.skills[s]);
    if (!ok) removed.push({ char: who, what: pt?.name ?? 'pet', reason: 'unknown' });
    return ok;
  });
  if (ch.pets.length > pc.maxPets) { removed.push({ char: who, what: 'pets', reason: 'count' }); ch.pets = ch.pets.slice(0, pc.maxPets); }
  if (ch.activePet !== null && !ch.pets.some((p) => p.uid === ch.activePet)) ch.activePet = null;
  // 称号・図鑑・実績・サブ職・塔
  ch.titles.unlocked = (ch.titles?.unlocked ?? []).filter((t) => c.titles[t]);
  if (ch.titles.equipped && !ch.titles.unlocked.includes(ch.titles.equipped)) ch.titles.equipped = null;
  const ach = new Set(c.achievements.map((a) => a.id));
  for (const id of Object.keys(ch.achievements ?? {})) if (!ach.has(id)) delete ch.achievements[id];
  for (const id of Object.keys(ch.codex?.monsters ?? {})) if (!c.monsters[id]) delete ch.codex.monsters[id];
  for (const id of Object.keys(ch.codex?.materials ?? {})) if (!c.materials[id]) delete ch.codex.materials[id];
  for (const id of Object.keys(ch.codex?.items ?? {})) if (!c.equipment.bases[id]) delete ch.codex.items[id];
  for (const job of Object.keys(ch.sub ?? {}) as (keyof CharacterData['sub'])[]) {
    if (!finite(ch.sub[job].level, 1, c.subjobs.maxLevel)) { removed.push({ char: who, what: job, reason: 'level' }); ch.sub[job] = { level: 1, exp: 0 }; }
  }
  if (!finite(ch.tower?.best, 0, 10000)) ch.tower = { best: 0 };
  for (const [k2, v] of Object.entries(ch.counters ?? {})) if (!finite(v, 0, 1e12)) delete ch.counters[k2];
  ch.appearance.looks = (ch.appearance?.looks ?? []).filter((x) => typeof x === 'string');
  // 場所：一時的な場所や知らない場所なら街
  const area = c.areas[ch.location?.area];
  if (!area || area.type === 'dungeon' || area.type === 'tower' || area.type === 'raid') ch.location = { area: c.balance.world.startTown, x: -1, y: -1 };
  ch.visitedTowns = (ch.visitedTowns ?? []).filter((t) => c.areas[t]?.type === 'town');
  ch.tutorial = { step: 0, count: 0, done: true };
}

/** 引き継ぐ前の検証。結果のアカウントと、削ったものの一覧 */
export function sanitizeAccount(raw: unknown, c: Content = CONTENT): { account: AccountData; removed: Removed[] } {
  const removed: Removed[] = [];
  const acc = migrateAccount(raw, c);
  const uids = new Set<number>();
  acc.characters = (acc.characters ?? []).filter((ch) => ch && typeof ch === 'object');
  for (const ch of acc.characters) { normalizeCharacter(ch, c); checkCharacter(ch, c, removed, uids); }
  // 倉庫
  const st = acc.storage;
  if (!finite(st.capacity, c.storage.base, c.storage.max)) st.capacity = c.storage.base;
  st.items = (st.items ?? []).filter((it) => {
    const why = checkItem(it, c) ?? (uids.has(it.uid) ? 'duplicate' : null);
    if (why) { removed.push({ char: null, what: it?.name ?? 'item', reason: why }); return false; }
    uids.add(it.uid);
    return true;
  });
  if (st.items.length > c.storage.max) { removed.push({ char: null, what: 'storage', reason: 'count' }); st.items = st.items.slice(0, c.storage.max); }
  fixBag(st.bag, c, removed, null);
  // 拠点
  for (const [id, lv] of Object.entries(acc.base?.levels ?? {})) {
    const f = c.base.facilities[id];
    if (!f || !finite(lv, 0, f.max)) { delete acc.base.levels[id]; removed.push({ char: null, what: id, reason: 'level' }); }
  }
  return { account: acc, removed };
}
