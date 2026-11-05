import { CONTENT } from '../content';
import type { AccountData, PlayerInput } from '../state';
import { LocalServer } from '../host/local';
import { Viewer, buildFrame, charKey } from './snapshot';
import { BTN_ATTACK, BTN_DODGE, BTN_INTERACT, type ClientMsg, type ServerMsg } from './protocol';

/**
 * 開発用：サーバーなしで、ブラウザの中の LocalServer を AreaDO と同じ言葉（ServerMsg）で話させる。
 * 本番では使わない（?local=1 のときだけ）。
 */
export class LocalHub {
  readonly server: LocalServer;
  private sid: string;
  private viewer = new Viewer(18);
  private hostKey = '';
  private charJson = '';
  private seq = 0;
  private tickCount = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  onMessage: ((m: ServerMsg) => void) | null = null;
  /** 保存（開発用は手元に） */
  onSave: ((acc: AccountData) => void) | null = null;

  constructor(private account: AccountData, charId: string) {
    this.server = new LocalServer({ seed: (Math.random() * 2 ** 30) | 0, now: Date.now() });
    this.sid = this.server.connect(account, charId);
  }

  start() {
    this.welcome();
    this.timer = setInterval(() => this.tick(), 1000 / CONTENT.balance.tickRate);
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  private welcome() {
    const h = this.server.host(this.sid)!;
    const p = h.player(this.sid)!;
    this.hostKey = h.key;
    this.viewer.reset();
    this.charJson = '';
    this.emit({
      t: 'welcome', you: p.id, key: h.key, area: h.world.area.id, tick: h.world.tick, clock: h.world.clock, sid: this.sid, resume: '',
      tickRate: CONTENT.balance.tickRate, snapshotRate: 10, inputRate: 20, interest: 18,
      map: h.isInstance ? h.world.area.map : undefined, spec: h.isInstance ? { kind: h.world.area.instance!.kind, id: h.world.area.instance!.id, difficulty: h.world.area.instance!.difficulty, floor: h.world.area.instance!.floor, seed: 0, returnTo: h.world.area.instance!.returnTo, players: 1 } : null,
    });
    this.sendChar(true);
  }

  private sendChar(force = false) {
    const p = this.server.player(this.sid);
    if (!p) return;
    const j = charKey(p.char);
    if (!force && j === this.charJson) return;
    this.charJson = j;
    this.emit({ t: 'char', char: p.char, account: { storage: p.account.storage, base: p.account.base, records: p.account.records, id: p.account.id } });
  }

  private emit(m: ServerMsg) {
    // 本物と同じく JSON を通す（参照を共有しない）
    const copy = JSON.parse(JSON.stringify(m)) as ServerMsg;
    queueMicrotask(() => this.onMessage?.(copy));
  }

  private tick() {
    this.server.tick(Date.now());
    this.tickCount++;
    const h = this.server.host(this.sid);
    if (!h) return;
    if (h.key !== this.hostKey) { this.welcome(); return; }
    if (this.tickCount % 2 !== 0) return;
    const p = h.player(this.sid)!;
    const ev = this.server.drain(this.sid);
    const msg = this.viewer.diff(buildFrame(h.world), p, { tick: h.world.tick, clock: h.world.clock, ack: this.seq }, ev);
    this.emit(msg);
    this.sendChar();
    if (this.tickCount % 200 === 0) this.onSave?.(this.account);
  }

  send(m: ClientMsg) {
    if (m.t === 'ping') { this.emit({ t: 'pong', at: m.at, server: Date.now() }); return; }
    if (m.t !== 'in') return;
    this.seq = m.n;
    const input: PlayerInput = {
      move: { x: m.m[0], y: m.m[1] }, aim: m.a ? { x: m.a[0], y: m.a[1] } : null,
      attack: !!(m.b & BTN_ATTACK), dodge: !!(m.b & BTN_DODGE), interact: !!(m.b & BTN_INTERACT), skill: m.k, commands: m.c ?? [],
    };
    this.server.input(this.sid, input);
  }
}
