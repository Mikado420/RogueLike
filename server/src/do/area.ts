import {
  type InstanceSpec, type MailItem, AreaHost, BTN_ATTACK, charKey, receiveMail, BTN_DODGE, BTN_INTERACT, CONTENT, Viewer, buildFrame, eventsFor, type AccountData, type ClientMsg,
  type GameEvent, type PlayerInput, type ServerMsg, type Ticket, type Transfer,
} from '../../../shared/src';
import type { Env } from '../env';
import { loadConfig, type ServerConfig } from '../config';
import { HttpError, call, dispatch } from '../util/http';
import { randomId, signTicket, verifyTicket } from '../util/auth';
import { platform } from '../util/platform';
import { RateWindow, checkMovement, type Suspicion } from '../util/guard';

interface Conn {
  sid: string;
  ws: WebSocket;
  ticket: Ticket;
  account: AccountData | null;
  viewer: Viewer;
  events: GameEvent[];
  lastSeq: number;
  lastSave: number;
  charJson: string;
  joined: boolean;
  closed: boolean;
  inputs: RateWindow;
  commands: RateWindow;
  lastPos: { x: number; y: number; tick: number } | null;
  strikes: number;
  /** 切れた時刻（猶予のあいだはエリアに残す） */
  awaySince: number;
  /** 大事な操作（精錬・生産・レベルアップなど）のあと、すぐ保存する */
  dirty: boolean;
  guild: string | null;
  /** 郵便受けに何か届いた（受け取りに行く） */
  mail: boolean;
  /** 取引の処理中（順番に1つずつ） */
  busy: Promise<void>;
}

const IMPORTANT = new Set(['refine', 'crafted', 'levelUp', 'achievement', 'instance', 'petLevel', 'subLevel']);

/**
 * AreaDO：街・フィールド1つ×チャンネル1つ。InstanceDO：ダンジョン・塔・レイドを1つ。
 * 中で shared の step() を回し、入力を受け取り、差分のスナップショットを配る。
 * 誰もいなくなったら tick を止める（無料枠のため）。
 */
export class AreaDO {
  protected host: AreaHost | null = null;
  protected key = '';
  protected conns = new Map<string, Conn>();
  protected cfg: ServerConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickCount = 0;
  private emptySince = 0;
  readonly isInstance: boolean = false;
  protected spec: InstanceSpec | null = null;
  private rescue = false;

  constructor(protected state: DurableObjectState, protected env: Env) {
    this.cfg = loadConfig(env);
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') return this.connect(req);
    return dispatch(req, {
      kick: async (b: { sid: string; reason: string }) => { await this.drop(b.sid, b.reason, true); return { ok: true }; },
      tick: async (b: { n?: number; dt?: number }) => { for (let i = 0; i < (b.n ?? 1); i++) await this.tick(b.dt); return { tick: this.host?.world.tick ?? 0 }; },
      stats: async () => ({ key: this.key, players: this.conns.size, tick: this.host?.world.tick ?? 0, running: !!this.timer }),
      notice: async (b: { key: string; args?: (string | number)[] }) => { this.broadcast({ t: 'notice', key: b.key, args: b.args }); return { ok: true }; },
      mailArrived: async (b: { sid: string }) => { const c = this.conns.get(b.sid); if (c) c.mail = true; return { ok: true }; },
      stallSold: async (b: { sid: string; uid: number }) => {
        const p = this.host?.player(b.sid);
        if (p?.stall) { p.stall.items = p.stall.items.filter((x) => x.uid !== b.uid); if (!p.stall.items.length) p.stall = null; }
        return { ok: true };
      },
      setParty: async (b: { sid: string; party: string | null }) => { const p = this.host?.player(b.sid); if (p) p.partyId = b.party; return { ok: !!p }; },
      setGuild: async (b: { sid: string; base: AccountData['base'] | null }) => { const p = this.host?.player(b.sid); if (p) { p.guildBase = b.base; p.statsDirty = true; } return { ok: !!p }; },
      /** 自動マッチングがそろった・救援に入る：この人をインスタンスへ */
      sendTo: async (b: { sid: string; spec: InstanceSpec; rescuer?: boolean }) => {
        const p = this.host?.player(b.sid);
        if (!p || p.transition || p.dead) return { ok: false };
        p.transition = { to: 'instance', spawn: '', instance: b.spec, rescuer: !!b.rescuer };
        return { ok: true };
      },
      debug: async () => ({ world: this.host ? { players: this.host.world.players.map((p) => ({ id: p.id, char: p.char.id, x: p.x, y: p.y })), monsters: this.host.world.area.monsters.length } : null }),
    });
  }

  private ensureHost(t: Ticket) {
    if (this.host) return;
    this.key = t.k;
    if (t.inst) {
      this.spec = t.inst;
      this.host = new AreaHost(t.k, 'instance', 0, { areaId: 'instance', seed: t.inst.seed, now: platform.now(), content: CONTENT, instance: t.inst });
    } else {
      const [areaId, ch] = t.k.split('#');
      if (!CONTENT.areas[areaId]) throw new HttpError(400, 'badArea');
      this.host = new AreaHost(t.k, areaId, Number(ch) || 1, { areaId, seed: (Math.random() * 2 ** 30) | 0, now: platform.now(), content: CONTENT });
    }
    this.host.world.online = true;
  }

  private async connect(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const t = await verifyTicket<Ticket>(url.searchParams.get('ticket'), this.env.SESSION_SECRET, platform.now());
    if (!t) return new Response('bad ticket', { status: 401 });
    this.ensureHost(t);
    if (t.k !== this.key) return new Response('wrong area', { status: 400 });
    const [client, server] = platform.pair();
    server.accept();
    const conn: Conn = {
      sid: t.s, ws: server, ticket: t, account: null, viewer: new Viewer(this.cfg.interestRadius), events: [], lastSeq: 0,
      lastSave: platform.now(), charJson: '', joined: false, closed: false,
      inputs: new RateWindow(1000, this.cfg.rate.inputsPerSec), commands: new RateWindow(1000, this.cfg.rate.commandsPerSec),
      lastPos: null, strikes: 0, awaySince: 0, dirty: false, guild: null, mail: true, busy: Promise.resolve(),
    };
    // 同じセッションが残っていたら（再接続）古い方を閉じる
    const old = this.conns.get(t.s);
    if (old && old.ticket.e !== t.e) return new Response('stale', { status: 409 });
    if (old) { old.closed = true; try { old.ws.close(4000, 'replaced'); } catch { /* noop */ } }
    this.conns.set(t.s, conn);
    server.addEventListener('message', (ev) => this.onMessage(conn, ev.data));
    server.addEventListener('close', () => { void this.onClose(conn); });
    server.addEventListener('error', () => { void this.onClose(conn); });
    void this.join(conn, !!old);
    return platform.upgrade(client);
  }

  private accountStub(id: string) { return this.env.ACCOUNT.get(this.env.ACCOUNT.idFromName(id)); }

  private async join(conn: Conn, rejoin: boolean) {
    const t = conn.ticket;
    try {
      const host = this.host!;
      if (rejoin && host.sessions.has(conn.sid)) {
        conn.account = host.player(conn.sid)!.account;
        conn.lastSeq = 0;
      } else {
        const r = await call<{ account: AccountData; party: string | null; guild: { id: string; base: AccountData['base'] } | null }>(this.accountStub(t.a), 'checkout', { sid: t.s, epoch: t.e, key: this.key });
        conn.account = r.account;
        if (!r.account.characters.some((c) => c.id === t.c)) throw new Error('noCharacter');
        if (conn.closed) return;
        const loc = r.account.characters.find((c) => c.id === t.c)!.location;
        const jp = host.join(conn.sid, r.account, t.c, t.at ?? (t.inst ? null : (loc.area === host.areaId ? loc : null)));
        jp.partyId = r.party ?? t.inst?.partyId ?? null;
        jp.guildBase = r.guild?.base ?? null;
        jp.rescuer = !!t.r;
        conn.guild = r.guild?.id ?? null;
        jp.statsDirty = true;
      }
      const p = host.player(conn.sid)!;
      conn.joined = true;
      conn.events.push(...eventsFor(host.world.events, p.id));
      const resume = await signTicket({ ...t, at: null, exp: platform.now() + this.cfg.resumeTicketSec * 1000 } satisfies Ticket, this.env.SESSION_SECRET);
      this.send(conn, {
        resume,
        t: 'welcome', you: p.id, key: this.key, area: host.world.area.id, tick: host.world.tick, clock: host.world.clock, sid: conn.sid,
        tickRate: CONTENT.balance.tickRate, snapshotRate: this.cfg.snapshotRate, inputRate: this.cfg.inputRate, interest: this.cfg.interestRadius,
        map: host.isInstance ? host.world.area.map : undefined, spec: t.inst ?? null,
      });
      conn.viewer.reset();
      this.sendChar(conn, true);
      this.startLoop();
      console.log(JSON.stringify({ ev: 'join', key: this.key, players: this.conns.size }));
    } catch (e) {
      console.warn('join failed', e);
      this.send(conn, { t: 'kick', reason: e instanceof HttpError ? e.code : 'joinFailed' });
      conn.closed = true;
      this.conns.delete(conn.sid);
      try { conn.ws.close(4001, 'join failed'); } catch { /* noop */ }
    }
  }

  private onMessage(conn: Conn, data: unknown) {
    if (!conn.joined || conn.closed) return;
    let msg: ClientMsg;
    try { msg = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data as ArrayBuffer)); } catch { return; }
    if (msg.t === 'ping') { this.send(conn, { t: 'pong', at: msg.at, server: platform.now() }); return; }
    if (msg.t === 'bye') { void this.drop(conn.sid, 'bye', true).then(() => call(this.accountStub(conn.ticket.a), 'logout', { sid: conn.ticket.s, epoch: conn.ticket.e }).catch(() => {})); return; }
    if (msg.t !== 'in') return;
    if (!conn.inputs.hit(platform.now())) { this.suspect(conn, { kind: 'inputRate' }); return; }
    if (typeof msg.n !== 'number' || msg.n <= conn.lastSeq) return;
    conn.lastSeq = msg.n;
    const clamp = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
    let mx = clamp(msg.m?.[0]), my = clamp(msg.m?.[1]);
    const l = Math.hypot(mx, my);
    if (l > 1) { mx /= l; my /= l; }
    let commands = Array.isArray(msg.c) ? msg.c.slice(0, 4) : [];
    if (commands.length && !conn.commands.hit(platform.now(), commands.length)) { commands = []; this.suspect(conn, { kind: 'commandRate' }); }
    const input: PlayerInput = {
      move: { x: mx, y: my }, aim: msg.a ? { x: clamp(msg.a[0]), y: clamp(msg.a[1]) } : null,
      attack: !!(msg.b & BTN_ATTACK), dodge: !!(msg.b & BTN_DODGE), interact: !!(msg.b & BTN_INTERACT),
      skill: Number.isInteger(msg.k) && msg.k >= -1 && msg.k < 4 ? msg.k : -1, commands,
    };
    this.host?.setInput(conn.sid, input);
  }

  private suspect(conn: Conn, s: Suspicion) {
    conn.strikes++;
    if (conn.strikes === 1 || conn.strikes % 100 === 0) {
      console.warn(JSON.stringify({ ev: 'suspect', account: conn.ticket.a, ...s, n: conn.strikes }));
      this.env.DB?.prepare('INSERT INTO reports (kind, account_id, target, detail, at) VALUES (?, ?, ?, ?, ?)')
        .bind('cheat', conn.ticket.a, this.key, JSON.stringify({ ...s, n: conn.strikes }), platform.now()).run().catch(() => {});
    }
  }

  private send(conn: Conn, msg: ServerMsg) {
    if (conn.closed) return;
    try { conn.ws.send(JSON.stringify(msg)); } catch { /* 切れている */ }
  }

  protected broadcast(msg: ServerMsg) {
    for (const c of this.conns.values()) this.send(c, msg);
  }

  /** 自分のキャラのデータ（持ち物など）が変わったら送る */
  private sendChar(conn: Conn, force = false) {
    const p = this.host?.player(conn.sid);
    if (!p) return;
    const json = charKey(p.char);
    if (!force && json === conn.charJson) return;
    conn.charJson = json;
    const acc = p.account;
    this.send(conn, { t: 'char', char: p.char, account: { storage: acc.storage, base: acc.base, records: acc.records, id: acc.id } });
  }

  private startLoop() {
    if (this.timer || this.env.TICK_MODE === 'manual') return;
    this.timer = setInterval(() => { void this.tick(); }, 1000 / CONTENT.balance.tickRate);
  }

  private stopLoop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 1tick */
  async tick(dt?: number) {
    const host = this.host;
    if (!host) return;
    if (host.population === 0) {
      if (!this.emptySince) this.emptySince = platform.now();
      if (platform.now() - this.emptySince > this.cfg.idleSleepSec * 1000 || this.env.TICK_MODE === 'manual') this.stopLoop();
      return;
    }
    this.emptySince = 0;
    const now = dt ? host.world.clock + dt : platform.now();
    // 速度のチェック用に前の位置を覚える
    const before = new Map<string, { x: number; y: number }>();
    const sidOf = new Map<number, string>([...host.sessions.entries()].map(([s, id]) => [id, s]));
    for (const sid of host.sessions.keys()) { const p = host.player(sid); if (p) before.set(sid, { x: p.x, y: p.y }); }
    const r = host.step(now);
    this.tickCount++;
    for (const [sid, c] of this.conns) {
      if (!c.joined) continue;
      const p = host.player(sid);
      if (p) {
        const mine = eventsFor(r.events, p.id);
        c.events.push(...mine);
        if (mine.some((e) => IMPORTANT.has(e.type) && 'playerId' in e)) c.dirty = true;
        const b = before.get(sid);
        if (b) { const s = checkMovement(host.world, p, b); if (s) this.suspect(c, s); }
      }
    }
    await this.social(r.events);
    this.trades(r.events, sidOf, r.transfers);
    for (const c of this.conns.values()) if (c.joined && c.mail && !c.awaySince) this.claim(c);
    for (const t of r.transfers) await this.transfer(t);
    await this.expireAway();
    const every = Math.max(1, Math.round(CONTENT.balance.tickRate / this.cfg.snapshotRate));
    if (this.tickCount % every === 0) this.flush();
    const nowMs = platform.now();
    for (const c of this.conns.values()) {
      if (!c.joined || c.awaySince) continue;
      if (nowMs - c.lastSave > this.cfg.saveIntervalSec * 1000 || (c.dirty && nowMs - c.lastSave > 3000)) { c.lastSave = nowMs; c.dirty = false; void this.save(c, false); }
    }
  }

  /** 取引：書き戻しと一緒にサーバーへ頼む（順番に1つずつ） */
  private trades(events: GameEvent[], sidOf: Map<number, string>, transfers: Transfer[]) {
    const host = this.host!;
    for (const e of events) {
      if (e.type !== 'trade') continue;
      const sid = sidOf.get(e.playerId);
      const c = sid ? this.conns.get(sid) : undefined;
      if (!c) continue;
      if (e.op.kind === 'claim') { c.mail = true; continue; }
      const op = e.op;
      // 同じ tick にエリアを出た人も、取引を先に書き戻す
      const account = host.player(c.sid)?.account ?? transfers.find((t) => t.sessionId === c.sid)?.account;
      if (!account) continue;
      c.busy = c.busy.then(async () => {
        try {
          await call(this.accountStub(c.ticket.a), 'save', { sid: c.ticket.s, epoch: c.ticket.e, account, key: this.key, trade: { op: `t_${randomId(10)}`, t: op } });
          c.lastSave = platform.now();
        } catch (err) {
          console.warn('trade failed', err);
          // 書き戻せなかった：手元の写しは捨てる（出した品も戻る）
          await this.drop(c.sid, 'stale', false);
        }
      });
    }
  }

  /** 郵便受けの品を受け取る（受け取った番号と一緒に書き戻す。だめなら手元を元に戻す） */
  private claim(c: Conn) {
    c.mail = false;
    c.busy = c.busy.then(async () => {
      const host = this.host!;
      const p = host.player(c.sid);
      if (!p) return;
      const r = await call<{ mail: MailItem[] }>(this.accountStub(c.ticket.a), 'mail').catch(() => ({ mail: [] as MailItem[] }));
      if (!r.mail.length) return;
      const took = receiveMail(p.char, r.mail, CONTENT.balance.player.inventorySize);
      if (!took.length) return;
      try {
        await call(this.accountStub(c.ticket.a), 'save', { sid: c.ticket.s, epoch: c.ticket.e, account: p.account, key: this.key, claim: took });
        c.events.push({ type: 'notice', playerId: p.id, key: 'notice.mail', args: [took.length] });
      } catch {
        // 受け取れなかった分を手元から外す
        for (const m of r.mail.filter((x) => took.includes(x.id))) {
          if (m.item) p.char.inventory = p.char.inventory.filter((i) => i.uid !== m.item!.uid);
          if (m.gold) p.char.gold -= m.gold;
          if (m.bag) { p.char.bag[m.bag.id] = (p.char.bag[m.bag.id] ?? 0) - m.bag.n; if (p.char.bag[m.bag.id] <= 0) delete p.char.bag[m.bag.id]; }
        }
      }
    });
  }

  /** 人と遊ぶための知らせ（救援・自動マッチング・ギルドの拠点） */
  private async social(events: GameEvent[]) {
    const host = this.host!;
    const world = this.env.WORLD.get(this.env.WORLD.idFromName('world'));
    for (const e of events) {
      if (e.type !== 'request' && e.type !== 'facility' && e.type !== 'upkeep') continue;
      const sid = [...host.sessions.entries()].find(([, id]) => id === e.playerId)?.[0];
      const c = sid ? this.conns.get(sid) : undefined;
      const p = sid ? host.player(sid) : undefined;
      if (!c || !p) continue;
      try {
        if (e.type === 'request' && e.what === 'rescue') {
          const inst = host.world.area.instance!;
          await call(world, 'rescueAdd', { key: this.key, spec: this.spec, name: p.char.name, kind: inst.kind, id: inst.id, difficulty: inst.difficulty, level: inst.level, floor: inst.floor });
          this.rescue = true;
          c.events.push({ type: 'notice', playerId: p.id, key: 'notice.rescueSent' });
        } else if (e.type === 'request' && (e.what === 'match' || e.what === 'matchCancel')) {
          await call(world, e.what === 'match' ? 'matchJoin' : 'matchLeave', { a: c.ticket.a, sid: c.sid, key: this.key, name: p.char.name, level: p.char.level, dungeon: e.dungeon, difficulty: e.difficulty, returnTo: { area: host.world.area.id, spawn: null, x: p.x, y: p.y } });
          c.events.push({ type: 'notice', playerId: p.id, key: e.what === 'match' ? 'notice.matching' : 'notice.matchCancel' });
        } else if ((e.type === 'facility' || e.type === 'upkeep') && e.guild && c.guild) {
          const g = this.env.GUILD.get(this.env.GUILD.idFromName(c.guild));
          if (e.type === 'facility') await call(g, 'setFacility', { a: c.ticket.a, facility: e.facility, level: e.level });
          else await call(g, 'upkeep', { a: c.ticket.a, day: e.day });
        }
      } catch (err) { console.warn('social failed', err); }
    }
    // 救援の募集はクリア・失敗で消す
    const inst = host.world.area.instance;
    if (this.rescue && inst && (inst.cleared || inst.failed)) {
      this.rescue = false;
      void call(world, 'rescueDone', { key: this.key }).catch(() => {});
    }
  }

  /** 差分を送る */
  private flush() {
    const host = this.host!;
    const frame = buildFrame(host.world);
    for (const [sid, c] of this.conns) {
      if (!c.joined || c.closed) continue;
      const p = host.player(sid);
      if (!p) continue;
      const msg = c.viewer.diff(frame, p, { tick: host.world.tick, clock: host.world.clock, ack: c.lastSeq }, c.events);
      c.events = [];
      this.send(c, msg);
      if (msg.ev?.some((e) => 'playerId' in e) || this.tickCount % 40 === 0) this.sendChar(c);
    }
  }

  /** エリアを出る：保存して、次の場所のチケットを渡す */
  private async transfer(t: Transfer) {
    const c = this.conns.get(t.sessionId);
    if (!c) return;
    const tr = t.transition;
    // 行き先を保存しておく（つながらなくても次は行き先から始まる。インスタンスは街に戻る）
    if (!tr.instance) {
      const ch = t.account.characters.find((x) => x.id === t.char.id);
      if (ch) ch.location = { area: tr.to, x: tr.pos?.x ?? -1, y: tr.pos?.y ?? -1 };
    }
    await c.busy;
    const ok = await this.saveAccount(c, t.account, true);
    if (!ok) { await this.drop(c.sid, 'stale', false); return; }
    let key: string;
    if (tr.instance) key = `inst:${tr.instance.seed}`;
    else {
      const w = this.env.WORLD.get(this.env.WORLD.idFromName('world'));
      key = (await call<{ key: string }>(w, 'assign', { area: tr.to })).key;
    }
    const ticket = await signTicket({
      a: c.ticket.a, c: c.ticket.c, s: c.ticket.s, e: c.ticket.e, k: key, at: tr.pos ?? (tr.spawn || null), inst: tr.instance, r: tr.rescuer ? 1 : undefined,
      exp: platform.now() + this.cfg.ticketTtlSec * 1000,
    } satisfies Ticket, this.env.SESSION_SECRET);
    this.send(c, { t: 'move', key, ticket });
    c.closed = true;
    this.conns.delete(c.sid);
    try { c.ws.close(1000, 'moved'); } catch { /* noop */ }
    this.reportPopulation();
  }

  private async saveAccount(c: Conn, account: AccountData, leaving: boolean): Promise<boolean> {
    try {
      await call(this.accountStub(c.ticket.a), 'save', { sid: c.ticket.s, epoch: c.ticket.e, account, leaving, key: this.key });
      return true;
    } catch (e) {
      console.warn('save failed', c.ticket.a, e);
      return false;
    }
  }

  /** 定期保存（エリアにいるまま） */
  private async save(c: Conn, leaving: boolean): Promise<boolean> {
    let ok = false;
    // 取引の書き戻しと前後しないよう、同じ順番待ちに並べる
    c.busy = c.busy.then(async () => {
      const host = this.host;
      const p = host?.player(c.sid);
      if (!p) return;
      p.char.location = { area: host!.world.area.id, x: p.x, y: p.y };
      p.char.hp = Math.round(p.hp); p.char.mp = Math.round(p.mp);
      ok = await this.saveAccount(c, p.account, leaving);
    });
    await c.busy;
    if (!ok && this.host?.player(c.sid)) await this.drop(c.sid, 'stale', false);
    return ok;
  }

  /** 接続を切ってエリアから出す（saveFirst なら保存してから） */
  private async drop(sid: string, reason: string, saveFirst: boolean) {
    const c = this.conns.get(sid);
    const host = this.host;
    if (c && saveFirst && host?.player(sid)) await this.save(c, true);
    const out = host?.leave(sid);
    if (c) {
      this.send(c, { t: 'kick', reason });
      c.closed = true;
      this.conns.delete(sid);
      try { c.ws.close(4002, reason); } catch { /* noop */ }
    }
    void out;
    this.reportPopulation();
  }

  private async onClose(conn: Conn) {
    if (conn.closed) return;
    conn.closed = true;
    if (this.conns.get(conn.sid) !== conn) return;
    // しばらくはエリアに残して、つなぎ直しを待つ
    conn.awaySince = platform.now();
    if (!conn.joined) { this.conns.delete(conn.sid); return; }
    console.log(JSON.stringify({ ev: 'away', key: this.key }));
  }

  /** 猶予を過ぎた人を保存して出す */
  private async expireAway() {
    const now = platform.now();
    for (const conn of [...this.conns.values()]) {
      if (!conn.awaySince || now - conn.awaySince < this.cfg.reconnectGraceSec * 1000) continue;
      this.conns.delete(conn.sid);
      const host = this.host;
      const p = host?.player(conn.sid);
      if (p) {
        p.char.location = { area: host!.world.area.id, x: p.x, y: p.y };
        p.char.hp = p.dead ? 0 : Math.round(p.hp); p.char.mp = Math.round(p.mp);
        await conn.busy;
        const ok = await this.saveAccount(conn, p.account, true);
        host!.leave(conn.sid);
        if (ok) await call(this.accountStub(conn.ticket.a), 'logout', { sid: conn.ticket.s, epoch: conn.ticket.e }).catch(() => {});
      }
      console.log(JSON.stringify({ ev: 'leave', key: this.key, players: this.conns.size }));
      this.reportPopulation();
    }
  }

  private reportPopulation() {
    if (this.isInstance || !this.host) return;
    const w = this.env.WORLD.get(this.env.WORLD.idFromName('world'));
    void call(w, 'population', { key: this.key, n: this.host.population }).catch(() => {});
  }
}

/** ダンジョン・塔・レイド（パーティごと。終わって誰もいなくなったら消える） */
export class InstanceDO extends AreaDO {
  readonly isInstance = true;
}
