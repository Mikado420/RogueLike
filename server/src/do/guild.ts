import { CONTENT, type ChatFrom, type GuildState, type SocialServerMsg } from '../../../shared/src';
import type { Env } from '../env';
import { HttpError, call, dispatch } from '../util/http';

type Role = 'master' | 'officer' | 'member';

/**
 * GuildDO：ギルド1つ。仲間と役職、共有の拠点（施設のレベル・維持費を払った日）を持つ。
 */
export class GuildDO {
  private guild: GuildState | null = null;
  private loaded = false;
  constructor(private state: DurableObjectState, private env: Env) {}

  private async load() {
    if (this.loaded) return;
    this.guild = (await this.state.storage.get<GuildState>('guild')) ?? null;
    this.loaded = true;
  }
  private async save() {
    if (this.guild) await this.state.storage.put('guild', this.guild); else await this.state.storage.delete('guild');
  }
  private hub(a: string) { return this.env.CHAT.get(this.env.CHAT.idFromName(`user:${a}`)); }
  private account(a: string) { return this.env.ACCOUNT.get(this.env.ACCOUNT.idFromName(a)); }
  private role(a: string): Role | null { return this.guild?.members.find((m) => m.a === a)?.role ?? null; }

  private async notify(extra: string[] = []) {
    const msg: SocialServerMsg = { t: 'guild', guild: this.guild };
    const targets = new Set([...(this.guild?.members.map((m) => m.a) ?? []), ...extra]);
    await Promise.all([...targets].map((a) => call(this.hub(a), 'push', { msg }).catch(() => {})));
  }
  private async setAccount(a: string, role: Role | null) {
    await call(this.account(a), 'setGuild', { guild: role && this.guild ? { id: this.guild.id, role, base: this.guild.base } : null }).catch(() => {});
  }
  /** 拠点が変わったら、遊んでいる仲間のエリアにも知らせる */
  private async pushBase() {
    if (!this.guild) return;
    await Promise.all(this.guild.members.map((m) => this.setAccount(m.a, m.role)));
  }

  async fetch(req: Request): Promise<Response> {
    await this.load();
    return dispatch(req, {
      /** 作る：作った人の拠点がギルドの拠点のはじまりになる */
      create: async (b: { id: string; name: string; a: string; who: string; base: GuildState['base'] }) => {
        if (this.guild) throw new HttpError(409, 'exists');
        this.guild = { id: b.id, name: b.name, members: [{ a: b.a, name: b.who, role: 'master' }], base: { levels: { ...(b.base?.levels ?? {}) }, paidDay: b.base?.paidDay ?? -1 } };
        await this.save();
        await this.setAccount(b.a, 'master');
        await this.notify();
        return { guild: this.guild };
      },
      get: async () => ({ guild: this.guild }),
      invite: async (b: { from: ChatFrom; to: string }) => {
        const r = this.role(b.from.a);
        if (!r || r === 'member') throw new HttpError(403, 'noRight');
        if (this.guild!.members.length >= CONTENT.social.guild.max) throw new HttpError(409, 'guildFull');
        const invited = (await this.state.storage.get<string[]>('invited')) ?? [];
        if (!invited.includes(b.to)) invited.push(b.to);
        await this.state.storage.put('invited', invited.slice(-50));
        await call(this.hub(b.to), 'push', { msg: { t: 'invite', kind: 'guild', id: this.guild!.id, from: b.from, name: this.guild!.name } satisfies SocialServerMsg, from: b.from.a });
        return { ok: true };
      },
      join: async (b: { a: string; name: string }) => {
        if (!this.guild) throw new HttpError(404, 'noGuild');
        if (this.role(b.a)) return { guild: this.guild };
        const invited = (await this.state.storage.get<string[]>('invited')) ?? [];
        if (!invited.includes(b.a)) throw new HttpError(403, 'notInvited');
        if (this.guild.members.length >= CONTENT.social.guild.max) throw new HttpError(409, 'guildFull');
        this.guild.members.push({ a: b.a, name: b.name, role: 'member' });
        await this.state.storage.put('invited', invited.filter((x) => x !== b.a));
        await this.save();
        await this.env.DB.prepare('UPDATE guilds SET members = ? WHERE id = ?').bind(this.guild.members.length, this.guild.id).run();
        await this.setAccount(b.a, 'member');
        await this.notify();
        return { guild: this.guild };
      },
      leave: async (b: { a: string; by?: string }) => {
        if (!this.guild) return { guild: null };
        const by = b.by ?? b.a;
        const r = this.role(by), target = this.role(b.a);
        if (!target) return { guild: this.guild };
        if (by !== b.a && (!r || r === 'member' || (target !== 'member' && r !== 'master'))) throw new HttpError(403, 'noRight');
        this.guild.members = this.guild.members.filter((m) => m.a !== b.a);
        // マスターが抜けたら、残った人の中から引き継ぐ
        if (target === 'master' && this.guild.members.length) {
          const next = this.guild.members.find((m) => m.role === 'officer') ?? this.guild.members[0];
          next.role = 'master';
        }
        const id = this.guild.id;
        if (this.guild.members.length === 0) {
          this.guild = null;
          await this.env.DB.prepare('DELETE FROM guilds WHERE id = ?').bind(id).run();
        } else {
          await this.env.DB.prepare('UPDATE guilds SET members = ? WHERE id = ?').bind(this.guild.members.length, id).run();
        }
        await this.save();
        await this.setAccount(b.a, null);
        await this.notify([b.a]);
        return { guild: this.guild };
      },
      setRole: async (b: { by: string; a: string; role: Role }) => {
        if (this.role(b.by) !== 'master' || !this.role(b.a) || b.a === b.by) throw new HttpError(403, 'noRight');
        if (b.role === 'master') this.guild!.members.find((m) => m.a === b.by)!.role = 'officer';
        this.guild!.members.find((m) => m.a === b.a)!.role = b.role;
        await this.save();
        await this.notify();
        return { guild: this.guild };
      },
      /** エリアで施設を建てた（素材とゴールドはエリアで払い済み）。同時に建てても上書きしないように前のレベルを確かめる */
      setFacility: async (b: { a: string; facility: string; level: number }) => {
        if (!this.guild || !this.role(b.a)) throw new HttpError(403, 'notMember');
        const cur = this.guild.base.levels[b.facility] ?? 0;
        if (b.level !== cur + 1) return { ok: false, level: cur };
        this.guild.base.levels[b.facility] = b.level;
        await this.save();
        await this.pushBase();
        await this.notify();
        return { ok: true, level: b.level };
      },
      upkeep: async (b: { a: string; day: number }) => {
        if (!this.guild || !this.role(b.a)) throw new HttpError(403, 'notMember');
        this.guild.base.paidDay = Math.max(this.guild.base.paidDay, b.day);
        await this.save();
        await this.pushBase();
        return { ok: true };
      },
      chat: async (b: { msg: SocialServerMsg & { from: ChatFrom } }) => {
        if (!this.role(b.msg.from.a)) throw new HttpError(403, 'notMember');
        await Promise.all(this.guild!.members.map((m) => call(this.hub(m.a), 'push', { msg: b.msg, from: b.msg.from.a }).catch(() => {})));
        return { ok: true };
      },
    });
  }
}
