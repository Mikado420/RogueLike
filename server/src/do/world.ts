import { CONTENT, Rng, createItem, invasionTier, invasionWindow, pickBase, tierFor, type InstanceSpec, type MailItem } from '../../../shared/src';
import type { Env } from '../env';
import { loadConfig } from '../config';
import { call, dispatch } from '../util/http';
import { platform } from '../util/platform';

interface RescueEntry { id: string; key: string; spec: InstanceSpec | null; name: string; kind: string; dungeon: string; difficulty: string; level: number; floor: number; at: number }
interface RecruitEntry { id: string; leader: string; name: string; goal: string | null; level: number; members: number; at: number }
interface MatchEntry { a: string; sid: string; key: string; name: string; level: number; at: number; returnTo: InstanceSpec['returnTo'] }

/**
 * WorldDO：全体で1つ。チャンネルの割り当て、救援の一覧、パーティ募集の掲示板、ダンジョンの自動マッチング。
 * （ワールド通知・侵攻・フィールドボスは O7）
 */
export class WorldDO {
  private channels = new Map<string, { n: number; at: number }>();
  private rescues: RescueEntry[] = [];
  private recruits: RecruitEntry[] = [];
  private queues = new Map<string, MatchEntry[]>();
  private loaded = false;
  private cfg;
  /** 侵攻：今の区切りの、キャラごとの貢献度（全チャンネルの合計） */
  private invasion: { slot: number; contrib: Record<string, { a: string; name: string; level: number; pts: number }>; rewarded: number } = { slot: -1, contrib: {}, rewarded: -1 };
  /** フィールドボスを倒した区切り（エリアごと） */
  private fieldBoss: Record<string, number> = {};
  /** 最近配った知らせ（同じものを何度も配らない） */
  private announced = new Map<string, number>();
  /** D1 にまとめて書くタイムアタックの記録 */
  private taBuffer: { course: string; time: number; names: string; accounts: string; at: number }[] = [];
  private taFlushAt = 0;
  constructor(private state: DurableObjectState, private env: Env) {
    this.cfg = loadConfig(env);
  }

  private async load() {
    if (this.loaded) return;
    this.rescues = (await this.state.storage.get<RescueEntry[]>('rescues')) ?? [];
    this.recruits = (await this.state.storage.get<RecruitEntry[]>('recruits')) ?? [];
    this.invasion = (await this.state.storage.get<WorldDO['invasion']>('invasion')) ?? this.invasion;
    this.fieldBoss = (await this.state.storage.get<Record<string, number>>('fieldBoss')) ?? {};
    this.taBuffer = (await this.state.storage.get<WorldDO['taBuffer']>('taBuffer')) ?? [];
    this.loaded = true;
  }

  private clockView(now: number) { return { clock: now, content: CONTENT } as unknown as Parameters<typeof invasionWindow>[0]; }

  /** 侵攻が終わった区切りの報酬を、貢献した全員の郵便受けへ（番号つきなので2回は届かない） */
  private async rewardInvasion(now: number) {
    const inv = this.invasion;
    if (inv.slot < 0 || inv.rewarded === inv.slot) return;
    const win = invasionWindow(this.clockView(now));
    if (win.slot === inv.slot && win.active) return;
    const rng = new Rng((inv.slot * 2654435761) >>> 0);
    const pool = CONTENT.invasion.matPool;
    for (const [charId, c] of Object.entries(inv.contrib)) {
      const tier = invasionTier({ content: CONTENT }, c.pts);
      if (tier < 0) continue;
      const t = CONTENT.invasion.tiers[tier];
      const id = `inv:${inv.slot}:${charId}`;
      const mails: MailItem[] = [{ id: `${id}:gold`, from: 'invasion', gold: t.gold, at: now }];
      const mats: Record<string, number> = {};
      for (let i = 0; i < t.mats; i++) { const m = rng.pick(pool); mats[m] = (mats[m] ?? 0) + 1; }
      for (const [m, n] of Object.entries(mats)) mails.push({ id: `${id}:${m}`, from: 'invasion', bag: { id: m, n }, at: now });
      if (rng.chance(t.epicChance)) {
        const uid = rng.int(1, 0x3ffffff) * 0x4000000 + rng.int(0, 0x3ffffff);
        mails.push({ id: `${id}:epic`, from: 'invasion', item: createItem(uid, pickBase(rng, { weapon: 2, sub: 1, body: 1, head: 1, accessory: 1 }, CONTENT), tierFor(c.level, CONTENT), c.level, 'epic', rng, CONTENT), at: now });
      }
      for (const mail of mails) await call(this.env.ACCOUNT.get(this.env.ACCOUNT.idFromName(c.a)), 'mailAdd', { mail }).catch((e) => console.warn('invasion mail', e));
    }
    inv.rewarded = inv.slot;
    await this.state.storage.put('invasion', inv);
    console.log(JSON.stringify({ ev: 'invasionReward', slot: inv.slot, n: Object.keys(inv.contrib).length }));
  }

  /** 全エリアに知らせる */
  private async broadcast(key: string, args: (string | number)[], rare: boolean) {
    const now = platform.now();
    const keys = [...this.channels.entries()].filter(([, v]) => v.n > 0 && now - v.at < 300_000).map(([k]) => k);
    await Promise.all(keys.map((k) => {
      const ns = k.startsWith('inst:') ? this.env.INSTANCE : this.env.AREA;
      return call(ns.get(ns.idFromName(k)), 'notice', { key, args, rare, world: true }).catch(() => {});
    }));
  }

  /** タイムアタックの記録を D1 にまとめて書く */
  private async flushTa() {
    if (!this.taBuffer.length) return;
    const list = this.taBuffer.splice(0);
    try {
      await this.env.DB.batch(list.map((r) => this.env.DB.prepare('INSERT INTO time_attack (course, time, names, account_ids, at) VALUES (?, ?, ?, ?, ?)').bind(r.course, r.time, r.names, r.accounts, r.at)));
    } catch (e) {
      console.warn('ta flush failed', e);
      this.taBuffer.unshift(...list);
    }
    await this.state.storage.put('taBuffer', this.taBuffer);
  }

  private async schedule() {
    const now = platform.now();
    const times = [now + 3600_000];
    if ([...this.queues.values()].some((q) => q.length)) times.push(now + 5000);
    if (this.taBuffer.length) times.push(this.taFlushAt || now + this.cfg.d1FlushSec * 1000);
    if (this.invasion.slot >= 0 && this.invasion.rewarded !== this.invasion.slot) times.push(Math.max(now + 1000, invasionWindow(this.clockView(now)).end + 2000));
    await this.state.storage.setAlarm(Math.min(...times));
  }

  private prune() {
    const now = platform.now();
    const s = CONTENT.social;
    this.rescues = this.rescues.filter((r) => now - r.at < s.rescue.maxAgeMin * 60000).slice(-s.rescue.listMax);
    this.recruits = this.recruits.filter((r) => now - r.at < s.recruit.maxAgeMin * 60000).slice(-s.recruit.listMax);
  }

  async alarm() {
    await this.load();
    const now = platform.now();
    await this.runMatches(now);
    await this.rewardInvasion(now);
    if (this.taBuffer.length && now >= this.taFlushAt) await this.flushTa();
    await this.schedule();
  }

  /** そろったら（または待ち時間を過ぎて最低人数がいれば）インスタンスへ送る */
  private async runMatches(now: number) {
    const m = CONTENT.social.match;
    for (const [k, q] of this.queues) {
      while (q.length >= m.size || (q.length >= m.minSize && now - q[0].at >= m.waitSec * 1000)) {
        const group = q.splice(0, Math.min(m.size, q.length));
        const [dungeon, difficulty] = k.split(':');
        const seed = (Math.random() * 2 ** 30) | 0 || 1;
        const spec: InstanceSpec = {
          kind: 'dungeon', id: dungeon, difficulty: difficulty as InstanceSpec['difficulty'], floor: 0, seed, returnTo: group[0].returnTo,
          players: group.length, party: group.map((g) => g.a), partyId: `match:${seed}`,
        };
        await Promise.all(group.map((g) => {
          const ns = g.key.startsWith('inst:') ? this.env.INSTANCE : this.env.AREA;
          return call(ns.get(ns.idFromName(g.key)), 'sendTo', { sid: g.sid, spec }).catch(() => {});
        }));
        console.log(JSON.stringify({ ev: 'match', dungeon, n: group.length }));
      }
      if (!q.length) this.queues.delete(k);
    }
  }

  async fetch(req: Request): Promise<Response> {
    await this.load();
    return dispatch(req, {
      /** そのエリアの空いているチャンネル */
      assign: (b: { area: string }) => {
        const area = CONTENT.areas[b.area] ? b.area : CONTENT.balance.world.startArea;
        const now = platform.now();
        for (let ch = 1; ch < 100; ch++) {
          const key = `${area}#${ch}`;
          const c = this.channels.get(key);
          // 報告が古いチャンネルは空いているとみなす
          if (!c || now - c.at > 120000 || c.n < this.cfg.channelCap) {
            this.channels.set(key, { n: (c && now - c.at <= 120000 ? c.n : 0) + 1, at: now });
            return { key };
          }
        }
        return { key: `${area}#1` };
      },
      population: (b: { key: string; n: number }) => { this.channels.set(b.key, { n: b.n, at: platform.now() }); return { ok: true }; },

      // ───── 世界の共有 ─────
      /** エリアからの同期：侵攻の貢献度（差分）とフィールドボスを送り、全体の今を返す */
      sync: async (b: { key: string; area: string; fieldBoss?: number | null; contrib?: Record<string, { a: string; name: string; level: number; pts: number }>; slot: number; n: number }) => {
        const now = platform.now();
        this.channels.set(b.key, { n: b.n, at: now });
        let dirty = false;
        if (b.fieldBoss !== undefined && b.fieldBoss !== null && (this.fieldBoss[b.area] ?? -1) < b.fieldBoss) { this.fieldBoss[b.area] = b.fieldBoss; dirty = true; }
        const inv = this.invasion;
        if (b.slot > inv.slot) { await this.rewardInvasion(now); this.invasion = { slot: b.slot, contrib: {}, rewarded: -1 }; dirty = true; }
        if (b.contrib && b.slot === this.invasion.slot) {
          for (const [ch, c] of Object.entries(b.contrib)) {
            const cur = this.invasion.contrib[ch] ?? { a: c.a, name: c.name, level: c.level, pts: 0 };
            cur.pts += Math.max(0, c.pts);
            cur.level = c.level;
            this.invasion.contrib[ch] = cur;
            dirty = true;
          }
        }
        if (dirty) { await this.state.storage.put({ invasion: this.invasion, fieldBoss: this.fieldBoss }); await this.schedule(); }
        return { fieldBoss: this.fieldBoss, invasion: { slot: this.invasion.slot, contribution: Object.fromEntries(Object.entries(this.invasion.contrib).map(([k, v]) => [k, v.pts])) } };
      },
      /** ワールド通知（同じものは10分に1回） */
      announce: async (b: { key: string; args: (string | number)[]; rare?: boolean; dedupe: string }) => {
        const now = platform.now();
        for (const [k, at] of this.announced) if (now - at > 600_000) this.announced.delete(k);
        if (this.announced.has(b.dedupe)) return { ok: true, dup: true };
        this.announced.set(b.dedupe, now);
        await this.broadcast(b.key, b.args, !!b.rare);
        return { ok: true };
      },
      /** タイムアタックの記録（まとめて D1 へ） */
      taRecord: async (b: { course: string; time: number; names: string; accounts: string[] }) => {
        this.taBuffer.push({ course: b.course, time: b.time, names: b.names, accounts: b.accounts.join(','), at: platform.now() });
        if (!this.taFlushAt || this.taFlushAt < platform.now()) this.taFlushAt = platform.now() + this.cfg.d1FlushSec * 1000;
        if (this.taBuffer.length >= 20) await this.flushTa();
        else await this.state.storage.put('taBuffer', this.taBuffer);
        await this.schedule();
        return { ok: true };
      },
      /** テスト・管理用：時間を進める */
      worldTick: async (b: { now: number }) => { await this.rewardInvasion(b.now); await this.flushTa(); return { ok: true }; },
      channels: () => ({ channels: [...this.channels.entries()].map(([key, v]) => ({ key, ...v })) }),

      // ───── 救援 ─────
      rescueAdd: async (b: Omit<RescueEntry, 'at' | 'dungeon' | 'id'> & { id: string }) => {
        this.prune();
        this.rescues = this.rescues.filter((r) => r.key !== b.key);
        this.rescues.push({ ...b, dungeon: b.id, id: b.key, at: platform.now() });
        await this.state.storage.put('rescues', this.rescues);
        return { ok: true };
      },
      rescueDone: async (b: { key: string }) => {
        this.rescues = this.rescues.filter((r) => r.key !== b.key);
        await this.state.storage.put('rescues', this.rescues);
        return { ok: true };
      },
      rescues: () => { this.prune(); return { list: this.rescues.map(({ spec, ...r }) => { void spec; return r; }) }; },
      rescueGet: (b: { id: string }) => ({ rescue: this.rescues.find((r) => r.id === b.id) ?? null }),

      // ───── 募集の掲示板 ─────
      recruitPost: async (b: Omit<RecruitEntry, 'at'>) => {
        this.prune();
        this.recruits = this.recruits.filter((r) => r.id !== b.id);
        this.recruits.push({ ...b, at: platform.now() });
        await this.state.storage.put('recruits', this.recruits);
        return { ok: true };
      },
      recruitRemove: async (b: { id: string }) => {
        this.recruits = this.recruits.filter((r) => r.id !== b.id);
        await this.state.storage.put('recruits', this.recruits);
        return { ok: true };
      },
      recruits: () => { this.prune(); return { list: this.recruits }; },

      // ───── 自動マッチング ─────
      matchJoin: async (b: MatchEntry & { dungeon: string; difficulty: string }) => {
        const k = `${b.dungeon}:${b.difficulty}`;
        for (const q of this.queues.values()) for (let i = q.length - 1; i >= 0; i--) if (q[i].a === b.a) q.splice(i, 1);
        const q = this.queues.get(k) ?? [];
        q.push({ a: b.a, sid: b.sid, key: b.key, name: b.name, level: b.level, at: platform.now(), returnTo: b.returnTo });
        this.queues.set(k, q);
        await this.runMatches(platform.now());
        if (this.queues.size) await this.state.storage.setAlarm(platform.now() + 5000);
        return { ok: true, waiting: this.queues.get(k)?.length ?? 0 };
      },
      matchLeave: (b: { a: string }) => {
        for (const q of this.queues.values()) for (let i = q.length - 1; i >= 0; i--) if (q[i].a === b.a) q.splice(i, 1);
        return { ok: true };
      },
      /** テスト用：時間を進めてマッチングを回す */
      matchTick: async (b: { now: number }) => { await this.runMatches(b.now); return { ok: true }; },
    });
  }
}
