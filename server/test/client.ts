import type { Env } from '../src/env';
import type { ServerMsg, SnapshotMsg, CharacterData, Command } from '../../shared/src';
import { FakeNamespace, FakeSocket, flush, worker } from './runtime';

/** テスト用のプレイヤー（HTTP と WebSocket をまねる） */
export class TestClient {
  token = '';
  accountId = '';
  ws: FakeSocket | null = null;
  msgs: ServerMsg[] = [];
  you = -1;
  key = '';
  seq = 0;
  char: CharacterData | null = null;
  kicked: string | null = null;
  autoMove = true;

  constructor(private env: Env) {}

  async api<T = any>(method: string, path: string, body?: unknown, token = this.token): Promise<{ status: number; data: T }> {
    const res = await worker.fetch(new Request(`https://test${path}`, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', origin: 'http://localhost:5173' },
    }), this.env);
    return { status: res.status, data: (await res.json()) as T };
  }

  async guest() {
    const r = await this.api<{ token: string; accountId: string }>('POST', '/api/guest');
    this.token = r.data.token; this.accountId = r.data.accountId;
    return this;
  }

  async createChar(name = 'T') {
    const r = await this.api<{ id: string }>('POST', '/api/characters', { name, look: { body: 0, hair: 0 } });
    return r.data.id;
  }

  async play(charId: string) {
    const r = await this.api<{ ticket: string; key: string }>('POST', '/api/play', { charId });
    if (r.status !== 200) throw new Error(`play failed ${JSON.stringify(r.data)}`);
    await this.connect(r.data.ticket);
  }

  async connect(ticket: string) {
    const res = (await worker.fetch(new Request(`https://test/ws?ticket=${encodeURIComponent(ticket)}`, { headers: { upgrade: 'websocket' } }), this.env)) as unknown as { status: number; webSocket: FakeSocket };
    if (res.status !== 101) throw new Error(`ws failed ${res.status}`);
    const ws = res.webSocket;
    this.ws = ws;
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data)) as ServerMsg;
      this.msgs.push(m);
      if (m.t === 'welcome') { this.you = m.you; this.key = m.key; }
      if (m.t === 'char') this.char = m.char;
      if (m.t === 'kick') this.kicked = m.reason;
      if (m.t === 'move' && this.autoMove) void this.connect(m.ticket);
    });
    await flush(10);
  }

  send(o: unknown) { this.ws?.send(JSON.stringify(o)); }

  input(o: { m?: [number, number]; a?: [number, number] | null; b?: number; k?: number; c?: Command[] } = {}) {
    this.send({ t: 'in', n: ++this.seq, m: o.m ?? [0, 0], a: o.a ?? null, b: o.b ?? 0, k: o.k ?? -1, c: o.c });
  }

  snaps(): SnapshotMsg[] { return this.msgs.filter((m): m is SnapshotMsg => m.t === 'snap'); }
  last<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }> | undefined {
    for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i].t === t) return this.msgs[i] as Extract<ServerMsg, { t: T }>;
    return undefined;
  }
  /** 今までのスナップショットから見えている選手の id */
  seenPlayers(): Set<number> {
    const s = new Set<number>();
    for (const m of this.snaps()) { for (const p of m.pl ?? []) s.add(p.id); for (const g of m.gone ?? []) s.delete(g); }
    return s;
  }
}

/** 動いているすべてのエリアを n tick 進める */
export async function tickAll(env: Env, n = 1) {
  for (let i = 0; i < n; i++) {
    for (const ns of [env.AREA, env.INSTANCE] as unknown as FakeNamespace<any>[]) {
      for (const o of ns.instances.values()) await o.tick?.(50);
    }
    await flush(2);
  }
  await flush(5);
}
