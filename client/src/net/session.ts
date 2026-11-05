import {
  BTN_ATTACK, BTN_DODGE, BTN_INTERACT, CONTENT, LocalHub, applySnapshot, createMirrorWorld, moveCircle,
  type AccountData, type CharacterData, type ClientMsg, type GameEvent, type GameMap, type Player, type PlayerInput, type ServerMsg, type World,
} from '../../../shared/src';
import { LagTransport, WsTransport, type Transport } from './transport';
import { api, ApiError } from './api';

interface Sample { t: number; x: number; y: number }

const params = new URLSearchParams(location.search);
const LAG = Number(params.get('lag') ?? 0);
const LOSS = Number(params.get('loss') ?? 0);

export type SessionState = 'connecting' | 'online' | 'reconnecting' | 'closed';

/**
 * サーバーとの1回のログイン。World の写しを持ち、入力を送り、自分の動きを先に予測し、ほかは補間して描く。
 */
export class NetSession {
  /** 描くための World（エリアが変わっても同じオブジェクトを使い回す） */
  world: World;
  myId = -1;
  myChar: CharacterData | null = null;
  myAccount: AccountData | null = null;
  state: SessionState = 'connecting';
  key = '';
  rtt = 100;
  /** 切られた理由（二重ログインなど） */
  kicked: string | null = null;
  onState: ((s: SessionState) => void) | null = null;
  onKick: ((reason: string) => void) | null = null;

  private transport: Transport | null = null;
  private events: GameEvent[] = [];
  private seq = 0;
  private lastSent = { key: '', at: 0 };
  private pending = { skill: -1, dodge: false, interact: false, commands: [] as PlayerInput['commands'] };
  private samples = new Map<number, Sample[]>();
  private snapshotMs = 100;
  private inputMinMs = 50;
  private pred: { x: number; y: number; dodge: number; dir: { x: number; y: number } } | null = null;
  private corr = { x: 0, y: 0 };
  private resume = '';
  private retries = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private hub: LocalHub | null = null;
  private lastMove = { x: 0, y: 0 };
  private areaEvent: string | null = null;
  private readyResolve: (() => void) | null = null;
  /** 最初に自分が見えたら */
  readonly ready: Promise<void>;

  constructor(private charId: string, local?: { account: AccountData; onSave: (a: AccountData) => void }) {
    this.world = createMirrorWorld(CONTENT.balance.world.startArea);
    this.ready = new Promise((r) => { this.readyResolve = r; });
    if (local) {
      this.hub = new LocalHub(local.account, charId);
      this.hub.onSave = local.onSave;
    }
  }

  get me(): Player | undefined { return this.world.players.find((p) => p.id === this.myId); }

  /** 遊び始める */
  async start() {
    if (this.hub) {
      const hub = this.hub;
      this.transport = { send: (m) => hub.send(m), close: () => hub.stop(), onMessage: null, onClose: null, onOpen: null };
      hub.onMessage = (m) => this.onMessage(m);
      hub.start();
      this.setState('online');
      return;
    }
    const r = await api.play(this.charId);
    this.connect(r.ticket);
    this.pingTimer = setInterval(() => this.send({ t: 'ping', at: performance.now() }), 3000);
  }

  private setState(s: SessionState) {
    if (this.state === s) return;
    this.state = s;
    this.onState?.(s);
  }

  private connect(ticket: string) {
    const old = this.transport;
    if (old) { old.onMessage = null; old.onClose = null; old.close(); }
    let t: Transport = new WsTransport(ticket);
    if (LAG > 0 || LOSS > 0) t = new LagTransport(t, LAG, LOSS);
    this.transport = t;
    // 古いつながりから遅れて届いたものは無視する
    t.onMessage = (m) => { if (this.transport === t) this.onMessage(m); };
    t.onClose = (code) => { if (this.transport === t) void this.onClosed(code); };
  }

  private async onClosed(code: number) {
    if (this.state === 'closed' || this.kicked) return;
    this.setState('reconnecting');
    // 少し待ってからつなぎ直す（はじめは再接続用のチケット、だめなら最初から）
    const wait = Math.min(8000, 500 * 2 ** this.retries);
    this.retries++;
    await new Promise((r) => setTimeout(r, wait));
    if ((this.state as SessionState) === 'closed') return;
    if (this.resume && this.retries <= 3 && code !== 4002) { this.connect(this.resume); return; }
    try {
      const r = await api.play(this.charId);
      this.connect(r.ticket);
    } catch (e) {
      if (e instanceof ApiError && e.status !== 0) { this.kicked = e.code; this.onKick?.(e.code); this.setState('closed'); return; }
      void this.onClosed(code);
    }
  }

  private onMessage(m: ServerMsg) {
    switch (m.t) {
      case 'welcome': {
        this.retries = 0;
        this.resume = m.resume;
        this.key = m.key;
        this.snapshotMs = 1000 / m.snapshotRate;
        this.inputMinMs = 1000 / m.inputRate;
        const changed = m.area !== this.world.area.id || !!m.spec || !this.world.players.length || m.you !== this.myId;
        if (changed) {
          const next = createMirrorWorld(m.area, { map: m.map as GameMap | undefined, spec: m.spec });
          Object.assign(this.world, next);
          this.samples.clear();
          this.pred = null;
        }
        this.world.tick = m.tick;
        this.world.clock = m.clock;
        this.myId = m.you;
        this.areaEvent = m.area;
        this.setState('online');
        break;
      }
      case 'snap': {
        const now = performance.now();
        applySnapshot(this.world, m, this.myId, this.myChar);
        for (const list of [m.pl, m.mo, m.pe, m.pr]) {
          for (const e of list ?? []) {
            if (e.id === this.myId) continue;
            const x = e.x as number, y = e.y as number;
            const s = this.samples.get(e.id) ?? [];
            s.push({ t: now, x, y });
            if (s.length > 12) s.shift();
            this.samples.set(e.id, s);
          }
        }
        for (const g of m.gone ?? []) this.samples.delete(g);
        const me = this.me;
        const mine = m.pl?.find((e) => e.id === this.myId);
        if (me && mine) this.correct(me, mine.x as number, mine.y as number);
        if (m.ev) this.events.push(...m.ev);
        // エリアが変わった知らせは、自分が見えてから
        if (this.areaEvent && this.me) { this.events.push({ type: 'areaChanged', playerId: this.myId, area: this.areaEvent }); this.areaEvent = null; }
        if (this.me && this.myChar && this.readyResolve) { this.me.char = this.myChar; this.me.account = this.myAccount!; this.readyResolve(); this.readyResolve = null; }
        break;
      }
      case 'char': {
        this.myChar = m.char;
        const prev = this.myAccount;
        this.myAccount = { ...(prev ?? {}), ...(m.account as object), characters: [m.char] } as AccountData;
        const me = this.me;
        if (me) { me.char = m.char; me.account = this.myAccount; }
        this.events.push({ type: 'charChanged', playerId: this.myId });
        break;
      }
      case 'move':
        this.resume = '';
        this.setState('connecting');
        this.connect(m.ticket);
        break;
      case 'kick':
        if (m.reason === 'duplicate' || m.reason === 'banned' || m.reason === 'transfer') {
          this.kicked = m.reason;
          this.onKick?.(m.reason);
          this.close();
        }
        break;
      case 'pong':
        this.rtt = this.rtt * 0.7 + (performance.now() - m.at) * 0.3;
        break;
      case 'notice':
        this.events.push({ type: 'notice', playerId: this.myId, key: m.key, args: m.args });
        break;
    }
  }

  /** 自分の位置のずれを直す（大きくずれたら飛ばす） */
  private correct(me: Player, sx: number, sy: number) {
    if (!this.pred || me.dead) { this.pred = { x: sx, y: sy, dodge: 0, dir: { x: 0, y: 0 } }; this.corr = { x: 0, y: 0 }; return; }
    const lead = Math.min(0.3, (this.rtt / 2 + this.snapshotMs / 2) / 1000);
    const speed = me.stats.moveSpeed;
    const tx = sx + this.lastMove.x * speed * lead, ty = sy + this.lastMove.y * speed * lead;
    const dx = tx - this.pred.x, dy = ty - this.pred.y;
    const d = Math.hypot(dx, dy);
    if (d > 2.5) { this.pred.x = sx; this.pred.y = sy; this.corr = { x: 0, y: 0 }; }
    else if (d > 0.05) this.corr = { x: dx, y: dy };
  }

  /** 1tick ぶん：入力を送り、自分を先に動かす */
  clientTick(inp: PlayerInput) {
    this.world.tick++;
    if (inp.skill >= 0) this.pending.skill = inp.skill;
    if (inp.dodge) this.pending.dodge = true;
    if (inp.interact) this.pending.interact = true;
    if (inp.commands.length) this.pending.commands.push(...inp.commands);
    // 送る量を減らすため、移動と狙いは方向を丸める（変わったときだけ送る）
    const q = (v: number) => Math.round(v * 16) / 16;
    const m: [number, number] = [q(inp.move.x), q(inp.move.y)];
    const a: [number, number] | null = inp.aim ? [q(inp.aim.x), q(inp.aim.y)] : null;
    const b = (inp.attack ? BTN_ATTACK : 0) | (this.pending.dodge ? BTN_DODGE : 0) | (this.pending.interact ? BTN_INTERACT : 0);
    const key = `${m}|${a}|${b}|${this.pending.skill}|${this.pending.commands.length}`;
    const now = performance.now();
    const press = this.pending.skill >= 0 || this.pending.dodge || this.pending.interact || this.pending.commands.length > 0;
    if ((key !== this.lastSent.key || now - this.lastSent.at > 1000) && (press || now - this.lastSent.at >= this.inputMinMs)) {
      this.send({ t: 'in', n: ++this.seq, m, a, b, k: this.pending.skill, c: this.pending.commands.length ? this.pending.commands : undefined });
      this.lastSent = { key, at: now };
      this.predictDodge(inp);
      this.pending = { skill: -1, dodge: false, interact: false, commands: [] };
    }
    this.predict(inp);
  }

  private predictDodge(inp: PlayerInput) {
    const me = this.me;
    if (!me || !this.pred || !this.pending.dodge || this.pred.dodge > 0 || me.dodgeTicks > 0) return;
    const pb = CONTENT.balance.player;
    if (me.st < pb.dodgeCost) return;
    const l = Math.hypot(inp.move.x, inp.move.y);
    const dir = l > 0.05 ? { x: inp.move.x / l, y: inp.move.y / l } : { x: Math.cos(me.facing), y: Math.sin(me.facing) };
    this.pred.dodge = Math.round(pb.dodgeDuration * CONTENT.balance.tickRate);
    this.pred.dir = dir;
  }

  private predict(inp: PlayerInput) {
    const me = this.me;
    if (!me) return;
    if (!this.pred) { this.pred = { x: me.x, y: me.y, dodge: 0, dir: { x: 0, y: 0 } }; }
    const dt = 1 / CONTENT.balance.tickRate;
    const map = this.world.area.map;
    const p = { x: this.pred.x, y: this.pred.y };
    let mx = inp.move.x, my = inp.move.y;
    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    this.lastMove = ml > 0.05 ? { x: mx, y: my } : { x: 0, y: 0 };
    if (this.pred.dodge > 0) {
      this.pred.dodge--;
      const v = CONTENT.balance.player.dodgeSpeed * dt;
      moveCircle(map, p, me.r, this.pred.dir.x * v, this.pred.dir.y * v);
    } else if (!me.dead && me.lock <= 0 && ml > 0.05 && !me.statuses.some((s) => CONTENT.statuses[s.id]?.cannotAct)) {
      const v = me.stats.moveSpeed * dt;
      moveCircle(map, p, me.r, mx * v, my * v);
      me.facing = Math.atan2(my, mx);
    }
    // ずれの分を少しずつ足す
    const k = 0.2;
    const cx = this.corr.x * k, cy = this.corr.y * k;
    moveCircle(map, p, me.r, cx, cy);
    this.corr.x -= cx; this.corr.y -= cy;
    this.pred.x = p.x; this.pred.y = p.y;
  }

  /** 描く前に：自分は予測の位置、ほかは少し前の位置を補間 */
  updateDisplay(now = performance.now()) {
    const me = this.me;
    if (me && this.pred) { me.x = this.pred.x; me.y = this.pred.y; }
    const renderAt = now - this.snapshotMs * 1.5;
    const place = (o: { id: number; x: number; y: number }) => {
      const s = this.samples.get(o.id);
      if (!s || s.length === 0) return;
      let i = s.length - 1;
      while (i > 0 && s[i - 1].t > renderAt) i--;
      const b = s[i], a = s[i - 1];
      if (!a || renderAt >= b.t) { o.x = b.x; o.y = b.y; return; }
      if (renderAt <= a.t) { o.x = a.x; o.y = a.y; return; }
      const k = (renderAt - a.t) / (b.t - a.t);
      o.x = a.x + (b.x - a.x) * k; o.y = a.y + (b.y - a.y) * k;
    };
    for (const p of this.world.players) if (p.id !== this.myId) place(p);
    for (const m of this.world.area.monsters) place(m);
    for (const m of this.world.pets) place(m);
    for (const pr of this.world.area.projectiles) place(pr);
  }

  takeEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  send(m: ClientMsg) { this.transport?.send(m); }

  /** ログアウト（すぐ保存してもらう） */
  close() {
    if (this.state === 'closed') return;
    this.send({ t: 'bye' });
    this.setState('closed');
    if (this.pingTimer) clearInterval(this.pingTimer);
    setTimeout(() => this.transport?.close(), 200);
  }
}
