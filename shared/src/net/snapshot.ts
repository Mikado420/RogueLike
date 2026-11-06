import type { AreaInstance, CharacterData, GameEvent, Player, World } from '../state';
import type { EntityState, SnapshotMsg } from './protocol';

/**
 * スナップショット：サーバーは「関心範囲の中で、前に送ったものから変わったもの」だけを送る。
 * client は受け取ったものを自分の World の写しに入れて描く（描画のコードは今までのまま）。
 */

type Kind = 'pl' | 'mo' | 'pe' | 'dr' | 'st' | 'pr' | 'nd' | 'np';
export const KINDS: Kind[] = ['pl', 'mo', 'pe', 'dr', 'st', 'pr', 'nd', 'np'];

/** ほかの人に見せるキャラの情報（見た目と名前だけ） */
export function publicChar(ch: CharacterData) {
  const eq = (s: 'weapon' | 'body' | 'head') => {
    const it = ch.equipment[s];
    return it ? { kind: it.kind, look: it.look, base: it.base, rarity: it.rarity, slot: it.slot } : null;
  };
  return {
    id: ch.id, name: ch.name, level: ch.level, rebirths: ch.rebirths, look: ch.look,
    appearance: { selected: ch.appearance.selected, unlocked: [] },
    equipment: { weapon: eq('weapon'), body: eq('body'), head: eq('head'), sub: null, accessory: null },
    titles: { equipped: ch.titles.equipped, unlocked: [] },
    activePet: ch.activePet, pets: [], skills: {}, skillSlots: {},
  };
}

function playerState(p: Player): EntityState {
  const { char, account, transition, ...rest } = p;
  void account; void transition;
  return { ...rest, char: publicChar(char) } as unknown as EntityState;
}

function strip<T extends object>(o: T, drop: string[]): EntityState {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (!drop.includes(k)) out[k] = v;
  return out as EntityState;
}

/** その tick の全員分の形（JSON 文字列）を1回だけ作る */
export interface FrameCache {
  tick: number;
  ents: { kind: Kind; id: number; x: number; y: number; json: string; fields: Record<string, string>; ownerId?: number }[];
  areaJson: string;
}

/** 位置と向きは 1/100 に丸める（送る量と、少しの揺れで送り直すのを減らす） */
const ROUND = new Set(['x', 'y', 'facing', 'vx', 'vy', 'homeX', 'homeY']);
function rounded(o: EntityState): EntityState {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k] = ROUND.has(k) && typeof v === 'number' ? Math.round(v * 100) / 100 : v;
  return out as EntityState;
}

export function areaState(a: AreaInstance): Record<string, unknown> {
  return {
    instance: a.instance, safeZones: a.safeZones, safeZoneAt: a.safeZoneAt, safeZonePower: a.safeZonePower,
    name: a.name, level: a.level, fieldBossSlot: a.fieldBossSlot,
  };
}

export function buildFrame(w: World): FrameCache {
  const ents: FrameCache['ents'] = [];
  const add = (kind: Kind, o: { id: number; x: number; y: number }, s: EntityState, ownerId?: number) => {
    const r = rounded(s);
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) fields[k] = JSON.stringify(v) ?? 'null';
    ents.push({ kind, id: o.id, x: o.x, y: o.y, json: JSON.stringify(r), fields, ownerId });
  };
  for (const p of w.players) add('pl', p, playerState(p));
  for (const m of w.area.monsters) if (!m.dead) add('mo', m, strip(m, ['damageBy', 'spawnKey', 'homeX', 'homeY', 'wanderX', 'wanderY', 'timer']));
  for (const m of w.pets) add('pe', m, strip(m, ['damageBy', 'spawnKey']));
  for (const d of w.area.drops) add('dr', d, d as unknown as EntityState, d.ownerId);
  for (const s of w.area.strikes) add('st', s, strip(s, ['spec']) as EntityState);
  for (const s of w.area.projectiles) add('pr', s, strip(s, ['spec', 'hitIds']) as EntityState);
  for (const n of w.area.nodes) add('nd', n, n as unknown as EntityState);
  for (const n of w.area.npcs) add('np', n, n as unknown as EntityState);
  return { tick: w.tick, ents, areaJson: JSON.stringify(areaState(w.area)) };
}

/** 関心範囲の外側の余裕（マス） */
export const KEEP_MARGIN = 4;

/** 1人ぶんの、前回から変わったもの */
export class Viewer {
  private seen = new Map<number, { json: string; fields: Record<string, string> }>();
  private areaJson = '';
  constructor(public radius: number) {}

  reset() { this.seen.clear(); this.areaJson = ''; }

  diff(frame: FrameCache, me: { id: number; x: number; y: number } | null, base: Omit<SnapshotMsg, 't'>, events: GameEvent[]): SnapshotMsg {
    const msg: SnapshotMsg = { t: 'snap', ...base };
    const now = new Set<number>();
    const r2 = this.radius * this.radius;
    // 一度見えたものは、少し外に出るまで見せ続ける（範囲の端で出たり消えたりしないように）
    const keep2 = (this.radius + KEEP_MARGIN) ** 2;
    for (const e of frame.ents) {
      const d2 = me ? (e.x - me.x) ** 2 + (e.y - me.y) ** 2 : 0;
      const near = !me || e.id === me.id || e.kind === 'np' || d2 <= r2 || (d2 <= keep2 && this.seen.has(e.id));
      // 落ちているものは自分のもの（持ち主なし含む）だけ
      if (e.kind === 'dr' && me && e.ownerId !== undefined && e.ownerId !== -1 && e.ownerId !== me.id) continue;
      if (!near) continue;
      now.add(e.id);
      const prev = this.seen.get(e.id);
      if (prev?.json === e.json) continue;
      this.seen.set(e.id, { json: e.json, fields: e.fields });
      if (!prev) { (msg[e.kind] ??= []).push(JSON.parse(e.json)); continue; }
      // 前に送ったものとの違い（項目ごと）だけ
      const part: Record<string, unknown> = { id: e.id };
      for (const [k, v] of Object.entries(e.fields)) if (prev.fields[k] !== v) part[k] = JSON.parse(v);
      for (const k of Object.keys(prev.fields)) if (!(k in e.fields)) part[k] = null;
      (msg[e.kind] ??= []).push(part as EntityState);
    }
    const gone: number[] = [];
    for (const id of this.seen.keys()) if (!now.has(id)) { gone.push(id); this.seen.delete(id); }
    if (gone.length) msg.gone = gone;
    if (frame.areaJson !== this.areaJson) { this.areaJson = frame.areaJson; msg.area = JSON.parse(frame.areaJson); }
    if (events.length) msg.ev = events;
    return msg;
  }
}

/** client：スナップショットを World の写しに入れる */
export function applySnapshot(w: World, msg: SnapshotMsg, myId: number, myChar: CharacterData | null) {
  w.tick = msg.tick;
  w.clock = msg.clock;
  const upsert = <T extends { id: number }>(list: T[], items: EntityState[] | undefined, fix?: (o: T) => T): T[] => {
    if (!items) return list;
    const byId = new Map(list.map((x) => [x.id, x]));
    for (const it of items) {
      let o = it as unknown as T;
      if (fix) o = fix(o);
      const prev = byId.get(o.id);
      if (prev) Object.assign(prev, o); else { list.push(o); byId.set(o.id, o); }
    }
    return list;
  };
  w.players = upsert(w.players, msg.pl, (o) => {
    const p = o as unknown as Player;
    if (p.id === myId && myChar) p.char = myChar;
    else if ('char' in p) p.char = { ...(p.char as unknown as object), inventory: [], bag: {}, counters: {}, tutorial: { step: 0, count: 0, done: true } } as unknown as CharacterData;
    return o;
  });
  w.area.monsters = upsert(w.area.monsters, msg.mo);
  w.pets = upsert(w.pets, msg.pe);
  w.area.drops = upsert(w.area.drops, msg.dr);
  w.area.strikes = upsert(w.area.strikes, msg.st);
  w.area.projectiles = upsert(w.area.projectiles, msg.pr);
  w.area.nodes = upsert(w.area.nodes, msg.nd);
  w.area.npcs = upsert(w.area.npcs, msg.np);
  if (msg.gone?.length) {
    const g = new Set(msg.gone);
    w.players = w.players.filter((x) => !g.has(x.id));
    w.area.monsters = w.area.monsters.filter((x) => !g.has(x.id));
    w.pets = w.pets.filter((x) => !g.has(x.id));
    w.area.drops = w.area.drops.filter((x) => !g.has(x.id));
    w.area.strikes = w.area.strikes.filter((x) => !g.has(x.id));
    w.area.projectiles = w.area.projectiles.filter((x) => !g.has(x.id));
    w.area.nodes = w.area.nodes.filter((x) => !g.has(x.id));
    w.area.npcs = w.area.npcs.filter((x) => !g.has(x.id));
  }
  if (msg.area) Object.assign(w.area, msg.area);
}

/** 自分のキャラのデータが変わったかを見るための文字列（毎 tick 変わるプレイ時間などは除く） */
export function charKey(ch: CharacterData): string {
  return JSON.stringify(ch, (k, v) => (k === 'playTime' || k === 'hp' || k === 'mp' ? undefined : v));
}
