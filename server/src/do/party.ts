import { CONTENT, type ChatFrom, type PartyState, type SocialServerMsg } from '../../../shared/src';
import type { Env } from '../env';
import { HttpError, call, dispatch } from '../util/http';

/**
 * PartyDO：パーティ1つ（最大4人）。仲間の一覧を持ち、変わったら仲間の受け口（ChatDO）とアカウントに知らせる。
 */
export class PartyDO {
  private party: PartyState | null = null;
  private loaded = false;
  constructor(private state: DurableObjectState, private env: Env) {}

  private async load() {
    if (this.loaded) return;
    this.party = (await this.state.storage.get<PartyState>('party')) ?? null;
    this.loaded = true;
  }

  private async save() {
    if (this.party) await this.state.storage.put('party', this.party);
    else await this.state.storage.delete('party');
  }

  private hub(a: string) { return this.env.CHAT.get(this.env.CHAT.idFromName(`user:${a}`)); }
  private account(a: string) { return this.env.ACCOUNT.get(this.env.ACCOUNT.idFromName(a)); }

  /** 仲間全員に今の状態を知らせる */
  private async notify(extra: string[] = []) {
    const msg: SocialServerMsg = { t: 'party', party: this.party };
    const targets = new Set([...(this.party?.members.map((m) => m.a) ?? []), ...extra]);
    await Promise.all([...targets].map((a) => call(this.hub(a), 'push', { msg }).catch(() => {})));
  }

  private async setAccount(a: string, id: string | null) {
    await call(this.account(a), 'setParty', { party: id }).catch(() => {});
  }

  async fetch(req: Request): Promise<Response> {
    await this.load();
    return dispatch(req, {
      create: async (b: { id: string; a: string; name: string; level: number }) => {
        if (this.party) throw new HttpError(409, 'exists');
        this.party = { id: b.id, leader: b.a, members: [{ a: b.a, name: b.name, level: b.level }], open: false, goal: null };
        await this.save();
        await this.setAccount(b.a, b.id);
        await this.notify();
        return { party: this.party };
      },
      get: async () => ({ party: this.party }),
      invite: async (b: { from: ChatFrom; to: string }) => {
        if (!this.party?.members.some((m) => m.a === b.from.a)) throw new HttpError(403, 'notMember');
        if (this.party.members.length >= CONTENT.social.party.max) throw new HttpError(409, 'partyFull');
        const invited = (await this.state.storage.get<string[]>('invited')) ?? [];
        if (!invited.includes(b.to)) invited.push(b.to);
        await this.state.storage.put('invited', invited.slice(-20));
        await call(this.hub(b.to), 'push', { msg: { t: 'invite', kind: 'party', id: this.party.id, from: b.from } satisfies SocialServerMsg, from: b.from.a });
        return { ok: true };
      },
      join: async (b: { a: string; name: string; level: number }) => {
        if (!this.party) throw new HttpError(404, 'noParty');
        if (this.party.members.some((m) => m.a === b.a)) return { party: this.party };
        const invited = (await this.state.storage.get<string[]>('invited')) ?? [];
        if (!this.party.open && !invited.includes(b.a)) throw new HttpError(403, 'notInvited');
        if (this.party.members.length >= CONTENT.social.party.max) throw new HttpError(409, 'partyFull');
        this.party.members.push({ a: b.a, name: b.name, level: b.level });
        await this.state.storage.put('invited', invited.filter((x) => x !== b.a));
        await this.save();
        await this.setAccount(b.a, this.party.id);
        await this.notify();
        return { party: this.party };
      },
      leave: async (b: { a: string; by?: string }) => {
        if (!this.party) return { party: null };
        if (b.by && b.by !== b.a && b.by !== this.party.leader) throw new HttpError(403, 'notLeader');
        this.party.members = this.party.members.filter((m) => m.a !== b.a);
        if (this.party.leader === b.a) this.party.leader = this.party.members[0]?.a ?? '';
        const gone = this.party.members.length === 0;
        if (gone) this.party = null;
        await this.save();
        await this.setAccount(b.a, null);
        await this.notify([b.a]);
        return { party: this.party };
      },
      /** 募集の掲示（誰でも入れるようにする） */
      setOpen: async (b: { a: string; open: boolean; goal: string | null }) => {
        if (!this.party || this.party.leader !== b.a) throw new HttpError(403, 'notLeader');
        this.party.open = b.open;
        this.party.goal = b.goal;
        await this.save();
        await this.notify();
        return { party: this.party };
      },
      chat: async (b: { msg: SocialServerMsg & { from: ChatFrom } }) => {
        if (!this.party?.members.some((m) => m.a === b.msg.from.a)) throw new HttpError(403, 'notMember');
        await Promise.all(this.party.members.map((m) => call(this.hub(m.a), 'push', { msg: b.msg, from: b.msg.from.a }).catch(() => {})));
        return { ok: true };
      },
    });
  }
}
