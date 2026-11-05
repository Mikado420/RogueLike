import { CONTENT, type InstanceSpec } from '../../../shared/src';
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
  constructor(private state: DurableObjectState, private env: Env) {
    this.cfg = loadConfig(env);
  }

  private async load() {
    if (this.loaded) return;
    this.rescues = (await this.state.storage.get<RescueEntry[]>('rescues')) ?? [];
    this.recruits = (await this.state.storage.get<RecruitEntry[]>('recruits')) ?? [];
    this.loaded = true;
  }

  private prune() {
    const now = platform.now();
    const s = CONTENT.social;
    this.rescues = this.rescues.filter((r) => now - r.at < s.rescue.maxAgeMin * 60000).slice(-s.rescue.listMax);
    this.recruits = this.recruits.filter((r) => now - r.at < s.recruit.maxAgeMin * 60000).slice(-s.recruit.listMax);
  }

  async alarm() {
    await this.load();
    await this.runMatches(platform.now());
    if ([...this.queues.values()].some((q) => q.length)) await this.state.storage.setAlarm(platform.now() + 5000);
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
