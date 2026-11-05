import type { Content } from '../content/types';
import { CONTENT } from '../content';
import { Rng } from '../rng';
import type { AccountData, GameEvent, Player, PlayerInput } from '../state';
import { newSharedState, resolveLocation } from '../systems/world';
import { AreaHost, type Transfer } from './area';

export interface LocalServerOptions {
  /** 1チャンネルの人数上限 */
  channelCap?: number;
  seed?: number;
  now?: number;
  content?: Content;
  /** 移動のたびにキャラデータを JSON で書き出して入れ直す（サーバーと同じ流れを試す） */
  serializeTransfers?: boolean;
}

interface SessionInfo { id: string; account: AccountData; charId: string; hostKey: string }

/**
 * ローカル疑似サーバー：複数の AreaHost（エリア×チャンネル、インスタンス）を1つのプロセスで動かす。
 * テスト・ボットの負荷試験・開発用のひとりモードで使う。本番では AreaDO が AreaHost を1つずつ持つ。
 */
export class LocalServer {
  readonly hosts = new Map<string, AreaHost>();
  readonly sessions = new Map<string, SessionInfo>();
  readonly shared = newSharedState();
  readonly content: Content;
  clock: number;
  private rng: Rng;
  private nextSession = 1;
  private nextInstance = 1;
  /** インスタンスのシード → ホスト（同じ指定で入った仲間は同じところへ） */
  private instanceBySeed = new Map<number, string>();
  readonly channelCap: number;
  private serialize: boolean;
  /** セッションごとの、まだ渡していないイベント */
  private outbox = new Map<string, GameEvent[]>();

  constructor(opts: LocalServerOptions = {}) {
    this.content = opts.content ?? CONTENT;
    this.channelCap = opts.channelCap ?? 30;
    this.clock = opts.now ?? 0;
    this.rng = new Rng(opts.seed ?? 1);
    this.serialize = !!opts.serializeTransfers;
  }

  /** そのエリアの空いているチャンネル（なければ作る） */
  private hostFor(areaId: string): AreaHost {
    const list = [...this.hosts.values()].filter((h) => h.areaId === areaId && !h.isInstance).sort((a, b) => a.channel - b.channel);
    const open = list.find((h) => h.population < this.channelCap);
    if (open) return open;
    let ch = 1;
    while (list.some((h) => h.channel === ch)) ch++;
    const key = `${areaId}#${ch}`;
    const h = new AreaHost(key, areaId, ch, { areaId, seed: this.rng.int(1, 2 ** 30), now: this.clock, content: this.content, shared: this.shared });
    this.hosts.set(key, h);
    return h;
  }

  connect(account: AccountData, charId: string): string {
    const ch = account.characters.find((c) => c.id === charId);
    if (!ch) throw new Error('character not found');
    // 同じキャラがすでに入っていたら古い方を切る
    for (const s of this.sessions.values()) if (s.charId === charId) this.disconnect(s.id);
    const id = `s${this.nextSession++}`;
    const loc = resolveLocation(ch, this.content);
    const host = this.hostFor(loc.area);
    host.join(id, account, charId, loc.pos);
    this.sessions.set(id, { id, account, charId, hostKey: host.key });
    this.outbox.set(id, [...host.world.events.filter((e) => 'playerId' in e && (e as { playerId: number }).playerId === host.sessions.get(id))]);
    return id;
  }

  disconnect(sessionId: string) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.hosts.get(s.hostKey)?.leave(sessionId);
    this.sessions.delete(sessionId);
    this.outbox.delete(sessionId);
    this.cleanup();
  }

  input(sessionId: string, input: PlayerInput) {
    const s = this.sessions.get(sessionId);
    if (s) this.hosts.get(s.hostKey)?.setInput(sessionId, input);
  }

  host(sessionId: string): AreaHost | undefined {
    const s = this.sessions.get(sessionId);
    return s ? this.hosts.get(s.hostKey) : undefined;
  }

  player(sessionId: string): Player | undefined {
    return this.host(sessionId)?.player(sessionId);
  }

  /** 全エリアを1tick進める */
  tick(now?: number) {
    this.clock = now ?? this.clock + 1000 / this.content.balance.tickRate;
    const transfers: Transfer[] = [];
    for (const h of [...this.hosts.values()]) {
      if (h.population === 0) continue;
      const r = h.step(this.clock);
      for (const sid of h.sessions.keys()) this.outbox.get(sid)?.push(...h.eventsFor(sid, r.events));
      transfers.push(...r.transfers);
    }
    for (const t of transfers) this.arrive(t);
    this.cleanup();
  }

  private arrive(t: Transfer) {
    const s = this.sessions.get(t.sessionId);
    if (!s) return;
    let account = t.account;
    if (this.serialize) {
      // サーバーと同じく、キャラデータを書き出して入れ直す
      account = JSON.parse(JSON.stringify(t.account));
      s.account = account;
    }
    let host: AreaHost;
    const tr = t.transition;
    if (tr.instance) {
      const known = this.instanceBySeed.get(tr.instance.seed);
      host = known ? this.hosts.get(known)! : (() => {
        const key = `inst#${this.nextInstance++}`;
        const h = new AreaHost(key, 'instance', 0, { areaId: 'instance', seed: tr.instance!.seed, now: this.clock, content: this.content, instance: tr.instance, shared: this.shared });
        this.hosts.set(key, h);
        this.instanceBySeed.set(tr.instance!.seed, key);
        return h;
      })();
    } else {
      host = this.hostFor(tr.to);
    }
    host.join(t.sessionId, account, t.char.id, tr.pos ?? (tr.spawn || null));
    s.hostKey = host.key;
    const pid = host.sessions.get(t.sessionId)!;
    this.outbox.get(t.sessionId)?.push(...host.world.events.filter((e) => 'playerId' in e && (e as { playerId: number }).playerId === pid));
  }

  /** 誰もいないインスタンスを消す */
  private cleanup() {
    for (const [k, h] of this.hosts) {
      if (h.isInstance && h.population === 0) {
        this.hosts.delete(k);
        for (const [seed, key] of this.instanceBySeed) if (key === k) this.instanceBySeed.delete(seed);
      }
    }
  }

  /** そのセッションに届いたイベントを取り出す */
  drain(sessionId: string): GameEvent[] {
    const list = this.outbox.get(sessionId) ?? [];
    this.outbox.set(sessionId, []);
    return list;
  }
}
