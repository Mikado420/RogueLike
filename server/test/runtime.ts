/**
 * サーバーの結合テスト用の、Node の中で動く Cloudflare の代わり。
 * Durable Object（ストレージ・名前で引く）、D1（node:sqlite）、WebSocket の組を最小限まねる。
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { platform } from '../src/util/platform';
import type { Env } from '../src/env';
import worker, { AccountDO, AreaDO, ChatDO, GuildDO, InstanceDO, MarketDO, PartyDO, WorldDO } from '../src/index';

// ───────── ストレージ ─────────
class FakeStorage {
  data = new Map<string, unknown>();
  alarm: number | null = null;
  async get<T>(k: string | string[]): Promise<T | undefined> {
    if (Array.isArray(k)) return new Map(k.filter((x) => this.data.has(x)).map((x) => [x, structuredClone(this.data.get(x))])) as unknown as T;
    return this.data.has(k) ? structuredClone(this.data.get(k)) as T : undefined;
  }
  async put(k: string | Record<string, unknown>, v?: unknown) {
    if (typeof k === 'string') this.data.set(k, structuredClone(v));
    else for (const [a, b] of Object.entries(k)) this.data.set(a, structuredClone(b));
  }
  async delete(k: string | string[]) {
    for (const x of Array.isArray(k) ? k : [k]) this.data.delete(x);
    return true;
  }
  async list<T>(o: { prefix?: string } = {}): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    for (const [k, v] of [...this.data.entries()].sort()) if (!o.prefix || k.startsWith(o.prefix)) out.set(k, structuredClone(v) as T);
    return out;
  }
  async setAlarm(t: number) { this.alarm = t; }
  async getAlarm() { return this.alarm; }
  async deleteAlarm() { this.alarm = null; }
  async transaction<T>(fn: (tx: FakeStorage) => Promise<T>): Promise<T> { return fn(this); }
  sql = makeSql(new DatabaseSync(':memory:'));
}

/** DO の SQLite（ctx.storage.sql.exec）のまね */
function makeSql(db: DatabaseSync) {
  return {
    exec(query: string, ...binds: unknown[]) {
      const trimmed = query.trim();
      if (binds.length === 0 && /;\s*\S/.test(trimmed)) { db.exec(trimmed); return cursor([]); }
      const st = db.prepare(trimmed);
      if (/^\s*(select|with)/i.test(trimmed) || /returning/i.test(trimmed)) return cursor(st.all(...(binds as never[])) as Record<string, unknown>[]);
      const r = st.run(...(binds as never[]));
      const c = cursor([]);
      (c as { rowsWritten: number }).rowsWritten = Number(r.changes);
      return c;
    },
    get databaseSize() { return 0; },
  };
}
function cursor(rows: Record<string, unknown>[]) {
  return { toArray: () => rows, one: () => { if (rows.length !== 1) throw new Error('expected one row'); return rows[0]; }, [Symbol.iterator]: () => rows[Symbol.iterator](), rowsRead: rows.length, rowsWritten: 0 };
}

class FakeState {
  storage = new FakeStorage();
  sockets: FakeSocket[] = [];
  constructor(public id: { name: string; toString(): string }) {}
  waitUntil(p: Promise<unknown>) { void p; }
  async blockConcurrencyWhile<T>(fn: () => Promise<T>) { return fn(); }
  acceptWebSocket(ws: FakeSocket, tags: string[] = []) { ws.tags = tags; ws.hibernatable = true; this.sockets.push(ws); ws.acceptHibernatable(this); }
  getWebSockets(tag?: string) { return this.sockets.filter((s) => !s.closed && (!tag || s.tags.includes(tag))); }
  getTags(ws: FakeSocket) { return ws.tags; }
}

export class FakeNamespace<T extends { fetch(r: Request): Promise<Response> }> {
  instances = new Map<string, T>();
  states = new Map<string, FakeState>();
  constructor(private cls: new (s: never, e: never) => T, private env: () => Env) {}
  idFromName(name: string) { return { name, toString: () => name }; }
  get(id: { name: string }) {
    return { fetch: (req: Request) => this.instance(id.name).fetch(req) };
  }
  instance(name: string): T {
    let o = this.instances.get(name);
    if (!o) {
      const st = new FakeState({ name, toString: () => name });
      o = new this.cls(st as never, this.env() as never);
      this.instances.set(name, o);
      this.states.set(name, st);
    }
    return o;
  }
  /** DO を落とす（メモリから消えた状態。ストレージは残る） */
  evict(name: string) {
    const st = this.states.get(name);
    this.instances.delete(name);
    if (st) {
      const o = new this.cls(st as never, this.env() as never);
      this.instances.set(name, o);
    }
  }
}

// ───────── D1 ─────────
class FakeStmt {
  constructor(private db: DatabaseSync, private sql: string, private args: unknown[] = []) {}
  bind(...a: unknown[]) { return new FakeStmt(this.db, this.sql, a); }
  async first<T>(col?: string): Promise<T | null> {
    const r = this.db.prepare(this.sql).get(...(this.args as never[])) as Record<string, unknown> | undefined;
    if (!r) return null;
    return (col ? r[col] : r) as T;
  }
  async all<T>() { return { results: this.db.prepare(this.sql).all(...(this.args as never[])) as T[], success: true }; }
  async run() { const r = this.db.prepare(this.sql).run(...(this.args as never[])); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
  runSync() { return this.db.prepare(this.sql).run(...(this.args as never[])); }
}
export class FakeD1 {
  db = new DatabaseSync(':memory:');
  constructor() {
    const dir = new URL('../migrations/', import.meta.url);
    for (const f of ['0001_init.sql', '0002_social.sql']) this.db.exec(readFileSync(new URL(f, dir), 'utf8'));
  }
  prepare(sql: string) { return new FakeStmt(this.db, sql); }
  async batch(stmts: FakeStmt[]) {
    this.db.exec('BEGIN');
    try { const out = stmts.map((s) => s.runSync()); this.db.exec('COMMIT'); return out.map((r) => ({ success: true, meta: { changes: Number(r.changes) } })); } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  async exec(sql: string) { this.db.exec(sql); }
}

// ───────── WebSocket ─────────
type Listener = (ev: { data?: unknown; code?: number; reason?: string }) => void;
export class FakeSocket {
  peer!: FakeSocket;
  closed = false;
  accepted = false;
  hibernatable = false;
  tags: string[] = [];
  attachment: unknown = null;
  private listeners: Record<string, Listener[]> = {};
  private hib: FakeState | null = null;
  readyState = 1;
  /** client 側で受け取ったもの */
  received: unknown[] = [];
  onmessage: Listener | null = null;
  onclose: Listener | null = null;
  accept() { this.accepted = true; }
  acceptHibernatable(st: FakeState) { this.accepted = true; this.hib = st; }
  serializeAttachment(v: unknown) { this.attachment = structuredClone(v); }
  deserializeAttachment() { return structuredClone(this.attachment); }
  addEventListener(t: string, fn: Listener) { (this.listeners[t] ??= []).push(fn); }
  removeEventListener(t: string, fn: Listener) { this.listeners[t] = (this.listeners[t] ?? []).filter((f) => f !== fn); }
  private emit(t: string, ev: Parameters<Listener>[0]) {
    for (const f of this.listeners[t] ?? []) f(ev);
    if (t === 'message') { this.received.push(ev.data); this.onmessage?.(ev); }
    if (t === 'close') this.onclose?.(ev);
    // Hibernation API：DO の webSocketMessage / webSocketClose を呼ぶ
    if (this.hib) {
      const host = [...registry].find((o) => (o as { state?: FakeState }).state === this.hib) as Record<string, (...a: unknown[]) => unknown> | undefined;
      if (t === 'message') void host?.webSocketMessage?.(this, ev.data);
      if (t === 'close') void host?.webSocketClose?.(this, ev.code, ev.reason, true);
    }
  }
  send(data: unknown) {
    if (this.closed) throw new Error('closed');
    const p = this.peer;
    queueMicrotask(() => { if (!p.closed) p.emit('message', { data }); });
  }
  close(code = 1000, reason = '') {
    if (this.closed) return;
    this.closed = true; this.readyState = 3;
    const p = this.peer;
    queueMicrotask(() => {
      this.emit('close', { code, reason });
      if (!p.closed) { p.closed = true; p.readyState = 3; p.emit('close', { code, reason }); }
    });
  }
}

/** Hibernation の DO を探すための一覧 */
const registry = new Set<unknown>();

export function makeEnv(overrides: Partial<Env> = {}) {
  const box: { env: Env | null } = { env: null };
  const get = () => box.env!;
  const track = <T extends object>(cls: new (s: never, e: never) => T) => class extends (cls as new (s: never, e: never) => object) {
    constructor(s: never, e: never) { super(s, e); registry.add(this); }
  } as unknown as new (s: never, e: never) => T & { fetch(r: Request): Promise<Response> };
  const env = {
    AREA: new FakeNamespace(track(AreaDO), get),
    INSTANCE: new FakeNamespace(track(InstanceDO), get),
    ACCOUNT: new FakeNamespace(track(AccountDO), get),
    WORLD: new FakeNamespace(track(WorldDO), get),
    CHAT: new FakeNamespace(track(ChatDO), get),
    PARTY: new FakeNamespace(track(PartyDO), get),
    GUILD: new FakeNamespace(track(GuildDO), get),
    MARKET: new FakeNamespace(track(MarketDO), get),
    DB: new FakeD1(),
    SESSION_SECRET: 'test-secret',
    ADMIN_TOKEN: 'admin',
    TICK_MODE: 'manual',
    ALLOWED_ORIGINS: '*',
    ...overrides,
  } as unknown as Env;
  box.env = env;
  return env;
}

// Workers の WebSocketPair と 101 応答のまね
platform.pair = () => {
  const a = new FakeSocket(), b = new FakeSocket();
  a.peer = b; b.peer = a;
  return [a as unknown as WebSocket, b as unknown as WebSocket];
};
platform.upgrade = (client: WebSocket) => ({ status: 101, webSocket: client, headers: new Headers() }) as unknown as Response;

export const flush = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

export { worker };
