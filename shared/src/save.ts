import { EQUIP_SLOTS, PRIMARY_STATS } from './core';
import type { Content } from './content/types';
import { CONTENT } from './content';
import type { AccountData, CharacterData } from './state';
import { Rng, hash32 } from './rng';
import { createItem } from './systems/loot';

/**
 * セーブデータの形。構造を変えたら SAVE_VERSION を上げ、MIGRATIONS に変換を足す。
 * 保存先（IndexedDB・サーバーのDB）は client 側の SaveStore が決める。
 */
export const SAVE_VERSION = 7;

type Raw = Record<string, unknown>;

/** version n のデータを n+1 に変換する関数 */
export const MIGRATIONS: Record<number, (d: Raw) => Raw> = {
  /** 1 → 2：アバター・ルートフィルター・倉庫を追加 */
  1: (d) => {
    const chars = (d.characters as Raw[] | undefined) ?? [];
    for (const ch of chars) {
      const looks: string[] = [];
      const items = [...((ch.inventory as { look?: string }[]) ?? []), ...Object.values((ch.equipment as Record<string, { look?: string } | null>) ?? {})];
      for (const it of items) if (it?.look && !looks.includes(it.look)) looks.push(it.look);
      ch.appearance = { looks, selected: {} };
      ch.lootFilter = { hideBelow: null, sellBelow: null };
    }
    d.storage = { items: [], bag: {}, capacity: CONTENT.storage.base };
    return d;
  },
  /** 2 → 3：世界の状態（フィールドボス）と訪れた街を追加 */
  2: (d) => {
    for (const ch of (d.characters as Raw[] | undefined) ?? []) ch.visitedTowns = [CONTENT.balance.world.startTown];
    d.world = { fieldBoss: {} };
    return d;
  },
  /** 3 → 4：図鑑・ミッション・実績・塔の記録・拠点・タイムアタック・侵攻 */
  3: (d) => {
    for (const ch of (d.characters as Raw[] | undefined) ?? []) {
      ch.codex = { monsters: {}, items: {}, materials: {} };
      ch.missions = { day: -1, daily: [], week: -1, weekly: [] };
      ch.achievements = {};
      ch.tower = { best: 0 };
    }
    const world = (d.world as Raw | undefined) ?? { fieldBoss: {} };
    world.invasion = { slot: -1, contribution: {}, rewarded: [] };
    d.world = world;
    d.base = { levels: {}, paidDay: -1 };
    d.records = { timeAttack: {} };
    return d;
  },
  /** 4 → 5：サブ職 */
  4: (d) => {
    for (const ch of (d.characters as Raw[] | undefined) ?? []) ch.sub = newSub();
    return d;
  },
  /** 5 → 6：ペット */
  5: (d) => {
    for (const ch of (d.characters as Raw[] | undefined) ?? []) { ch.pets = []; ch.activePet = null; }
    return d;
  },
  /** 6 → 7：チュートリアル（もう遊んでいるキャラは済み扱い） */
  6: (d) => {
    for (const ch of (d.characters as Raw[] | undefined) ?? []) ch.tutorial = { step: 0, count: 0, done: true };
    return d;
  },
};

export function newSub() {
  return { gather: { level: 1, exp: 0 }, smith: { level: 1, exp: 0 }, cook: { level: 1, exp: 0 }, alchemy: { level: 1, exp: 0 } };
}

/** 保存先のインターフェース。後でサーバーの DB に置き換える */
export interface SaveStore {
  load(): Promise<AccountData | null>;
  save(account: AccountData): Promise<void>;
  clear(): Promise<void>;
}

export function newAccount(now: number, seed: number): AccountData {
  return {
    version: SAVE_VERSION,
    id: `acc_${now.toString(36)}_${(seed >>> 0).toString(36)}`,
    createdAt: now,
    nextUid: 1,
    characters: [],
    lastCharacterId: null,
    storage: { items: [], bag: {}, capacity: CONTENT.storage.base },
    world: { fieldBoss: {}, invasion: { slot: -1, contribution: {}, rewarded: [] } },
    base: { levels: {}, paidDay: -1 },
    records: { timeAttack: {} },
  };
}

export function newCharacter(acc: AccountData, name: string, look: { body: number; hair: number }, now: number, c: Content = CONTENT): CharacterData {
  const rng = new Rng((now ^ acc.nextUid * 2654435761 ^ hash32(acc.id)) >>> 0);
  const uidRng = new Rng((now * 31 ^ hash32(acc.id) ^ acc.nextUid) >>> 0);
  const uid = () => { acc.nextUid++; return uidRng.int(1, 0x3ffffff) * 0x4000000 + uidRng.int(0, 0x3ffffff); };
  const st = c.balance.start;
  const equipment = Object.fromEntries(EQUIP_SLOTS.map((s) => [s, null])) as CharacterData['equipment'];
  for (const e of st.equipment) equipment[e.slot] = createItem(uid(), e.base, 0, 1, 'common', rng, c);
  const inventory = st.inventory.map((e) => createItem(uid(), e.base, 0, 1, 'common', rng, c));
  const area = c.tutorial.area || c.balance.world.startArea;
  const sp = c.areas[area]?.playerSpawn ?? { x: 0, y: 0 };
  const ch: CharacterData = {
    id: `${acc.id}.c${acc.nextUid++}`,
    name: name.trim().slice(0, 12) || '冒険者',
    createdAt: now,
    playTime: 0,
    look,
    level: 1,
    exp: 0,
    rebirths: 0,
    stats: Object.fromEntries(PRIMARY_STATS.map((s) => [s, 0])) as CharacterData['stats'],
    personal: { type: null, value: 0 },
    skills: {},
    skillSlots: {},
    equipment,
    inventory,
    bag: { ...st.bag },
    gold: st.gold,
    builds: Array(c.balance.builds.slots).fill(null),
    titles: { unlocked: [], equipped: null },
    counters: {},
    location: { area, x: sp.x, y: sp.y },
    hp: 0,
    mp: 0,
    appearance: { looks: [], selected: {} },
    lootFilter: { hideBelow: null, sellBelow: null },
    visitedTowns: [c.balance.world.startTown],
    codex: { monsters: {}, items: {}, materials: {} },
    missions: { day: -1, daily: [], week: -1, weekly: [] },
    achievements: {},
    tower: { best: 0 },
    sub: newSub(),
    pets: [],
    activePet: null,
    tutorial: { step: 0, count: 0, done: false },
  };
  for (const it of [...inventory, ...Object.values(equipment)]) if (it && !ch.appearance.looks.includes(it.look)) ch.appearance.looks.push(it.look);
  acc.characters.push(ch);
  acc.lastCharacterId = ch.id;
  return ch;
}

/** 足りない項目を既定値で埋める（古いデータや壊れたデータに強くする） */
export function normalizeCharacter(ch: CharacterData, c: Content = CONTENT): CharacterData {
  ch.stats ??= Object.fromEntries(PRIMARY_STATS.map((s) => [s, 0])) as CharacterData['stats'];
  for (const s of PRIMARY_STATS) ch.stats[s] ??= 0;
  ch.personal ??= { type: null, value: 0 };
  ch.skills ??= {};
  ch.skillSlots ??= {};
  ch.equipment ??= {} as CharacterData['equipment'];
  for (const s of EQUIP_SLOTS) ch.equipment[s] ??= null;
  ch.inventory ??= [];
  ch.bag ??= {};
  ch.gold ??= 0;
  ch.builds ??= [];
  while (ch.builds.length < c.balance.builds.slots) ch.builds.push(null);
  ch.titles ??= { unlocked: [], equipped: null };
  ch.counters ??= {};
  ch.rebirths ??= 0;
  ch.playTime ??= 0;
  ch.look ??= { body: 0, hair: 0 };
  ch.location ??= { area: c.balance.world.startArea, x: 0, y: 0 };
  ch.hp ??= 0;
  ch.mp ??= 0;
  ch.appearance ??= { looks: [], selected: {} };
  ch.appearance.looks ??= [];
  ch.appearance.selected ??= {};
  ch.lootFilter ??= { hideBelow: null, sellBelow: null };
  ch.visitedTowns ??= [c.balance.world.startTown];
  ch.codex ??= { monsters: {}, items: {}, materials: {} };
  ch.missions ??= { day: -1, daily: [], week: -1, weekly: [] };
  ch.achievements ??= {};
  ch.tower ??= { best: 0 };
  ch.sub ??= newSub();
  ch.pets ??= [];
  ch.activePet ??= null;
  ch.tutorial ??= { step: 0, count: 0, done: true };
  return ch;
}

/**
 * 読み込んだデータを今の版に合わせる。版が新しすぎる・形が違うときは例外。
 */
export function migrateAccount(raw: unknown, c: Content = CONTENT): AccountData {
  if (!raw || typeof raw !== 'object') throw new Error('save: not an object');
  let d = raw as Record<string, unknown>;
  let v = typeof d.version === 'number' ? d.version : 0;
  if (v > SAVE_VERSION) throw new Error(`save: version ${v} is newer than ${SAVE_VERSION}`);
  while (v < SAVE_VERSION) {
    const fn = MIGRATIONS[v];
    if (!fn) throw new Error(`save: no migration from ${v}`);
    d = fn(d);
    v++;
    d.version = v;
  }
  const acc = d as unknown as AccountData;
  if (!Array.isArray(acc.characters)) throw new Error('save: characters missing');
  acc.nextUid ??= 1;
  acc.lastCharacterId ??= null;
  acc.storage ??= { items: [], bag: {}, capacity: c.storage.base };
  acc.storage.items ??= [];
  acc.storage.bag ??= {};
  acc.storage.capacity ??= c.storage.base;
  acc.world ??= { fieldBoss: {}, invasion: { slot: -1, contribution: {}, rewarded: [] } };
  acc.world.fieldBoss ??= {};
  acc.world.invasion ??= { slot: -1, contribution: {}, rewarded: [] };
  acc.base ??= { levels: {}, paidDay: -1 };
  acc.records ??= { timeAttack: {} };
  // uid が重ならないように
  let maxUid = acc.nextUid;
  for (const ch of acc.characters) {
    normalizeCharacter(ch, c);
    for (const it of [...ch.inventory, ...Object.values(ch.equipment)]) if (it && it.uid >= maxUid) maxUid = it.uid + 1;
  }
  for (const it of acc.storage.items) if (it.uid >= maxUid) maxUid = it.uid + 1;
  acc.nextUid = maxUid;
  return acc;
}

export function serializeAccount(acc: AccountData): string {
  return JSON.stringify(acc);
}

export function deserializeAccount(text: string, c: Content = CONTENT): AccountData {
  return migrateAccount(JSON.parse(text), c);
}
