import type { AccountData, CharacterData, GameEvent, Player, PlayerInput, Transition, World } from '../state';
import { emptyInput } from '../state';
import { addPlayer, createAreaWorld, removePlayer, step, type AreaWorldOptions } from '../systems/world';
import { eventsFor } from './audience';

export interface Transfer {
  sessionId: string;
  transition: Transition;
  account: AccountData;
  char: CharacterData;
}

/**
 * 1つのエリア×チャンネルを動かす入れ物。ローカル疑似サーバーと AreaDO の両方で使う。
 * 誰がどのプレイヤーか（セッション）・入力のまとめ・移動の取り出しを受け持つ。
 */
export class AreaHost {
  world: World;
  readonly sessions = new Map<string, number>();
  private inputs = new Map<string, PlayerInput>();
  lastEvents: GameEvent[] = [];

  constructor(readonly key: string, readonly areaId: string, readonly channel: number, opts: AreaWorldOptions) {
    this.world = createAreaWorld(opts);
  }

  get population() { return this.sessions.size; }
  get isInstance() { return !!this.world.area.instance; }

  player(sessionId: string): Player | undefined {
    const id = this.sessions.get(sessionId);
    return id === undefined ? undefined : this.world.players.find((p) => p.id === id);
  }

  join(sessionId: string, account: AccountData, charId: string, at: { x: number; y: number } | string | null): Player {
    const p = addPlayer(this.world, account, charId, at);
    this.sessions.set(sessionId, p.id);
    return p;
  }

  leave(sessionId: string) {
    const id = this.sessions.get(sessionId);
    if (id === undefined) return null;
    this.sessions.delete(sessionId);
    this.inputs.delete(sessionId);
    return removePlayer(this.world, id);
  }

  /**
   * 入力を受け取る。次の tick までに何度来ても、押した瞬間の入力（スキル・回避・調べる）とコマンドは消えないようにまとめる
   */
  setInput(sessionId: string, input: PlayerInput) {
    const prev = this.inputs.get(sessionId);
    if (!prev) { this.inputs.set(sessionId, { ...input, commands: [...input.commands] }); return; }
    this.inputs.set(sessionId, {
      move: input.move, aim: input.aim, attack: input.attack || prev.attack,
      skill: input.skill >= 0 ? input.skill : prev.skill,
      dodge: input.dodge || prev.dodge, interact: input.interact || prev.interact,
      commands: [...prev.commands, ...input.commands],
    });
  }

  /** 1tick 進めて、エリアを出る人を取り出す */
  step(now?: number): { events: GameEvent[]; transfers: Transfer[] } {
    const map = new Map<number, PlayerInput>();
    for (const [sid, pid] of this.sessions) {
      const inp = this.inputs.get(sid);
      map.set(pid, inp ?? emptyInput());
      // 移動ベクトルなどは次の入力が来るまで続ける。押した瞬間のものは使ったら消す
      if (inp) this.inputs.set(sid, { ...inp, skill: -1, dodge: false, interact: false, commands: [] });
    }
    const events = step(this.world, map, now);
    this.lastEvents = events;
    const transfers: Transfer[] = [];
    for (const [sid, pid] of [...this.sessions]) {
      const p = this.world.players.find((x) => x.id === pid);
      if (!p?.transition) continue;
      const t = p.transition;
      const out = this.leave(sid)!;
      transfers.push({ sessionId: sid, transition: t, account: out.account, char: out.char });
    }
    return { events, transfers };
  }

  /**
   * 眠っていたエリアが起きたとき：tick で数えていた待ち時間（魔物の復活・採集ポイント）は済んだことにする。
   * 昼夜・天候・侵攻は時計で決まるので、次の step で自然に今に合う
   */
  wake(sleptMs: number) {
    const w = this.world;
    const slept = Math.round(sleptMs / (1000 / w.content.balance.tickRate));
    if (slept <= 0) return;
    for (const sp of w.area.spawns) if (sp.monsterId === -1) sp.respawnAt = Math.min(sp.respawnAt, w.tick);
    for (const n of w.area.nodes) if (n.charges <= 0) n.respawnAt = Math.min(n.respawnAt, w.tick);
    w.area.drops = w.area.drops.filter((d) => d.ticksLeft > slept);
    for (const d of w.area.drops) d.ticksLeft -= slept;
  }

  eventsFor(sessionId: string, events = this.lastEvents): GameEvent[] {
    const id = this.sessions.get(sessionId);
    return id === undefined ? [] : eventsFor(events, id);
  }
}
