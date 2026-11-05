import { CONTENT, migrateAccount, newAccount, newCharacter, normalizeCharacter, type AccountData, type CharSummary } from '../../../shared/src';
import type { Env } from '../env';
import { loadConfig } from '../config';
import { HttpError, call, dispatch } from '../util/http';
import { randomId, safeEqual, sha256 } from '../util/auth';

interface Meta {
  id: string;
  secretHash: string;
  createdAt: number;
  handle: string | null;
  name: string | null;
  /** 今のセッションの世代。新しくログインすると増え、古いセッションの保存は受け付けない */
  epoch: number;
  session: { sid: string; char: string; key: string | null; at: number } | null;
  /** オフライン版のセーブを引き継いだか */
  migrated: boolean;
  banned: { reason: string; until: number } | null;
}

/**
 * AccountDO：アカウントごとに1つ。キャラ・持ち物・倉庫・ゴールドの「正」のデータを持つ。
 * エリアに入っている間はエリアが写しを持ち、世代つきで書き戻す（古い世代の書き込みは捨てる）。
 */
export class AccountDO {
  private meta: Meta | null = null;
  private account: AccountData | null = null;
  private cfg;

  constructor(private state: DurableObjectState, private env: Env) {
    this.cfg = loadConfig(env);
  }

  private async load() {
    if (this.meta) return;
    this.meta = (await this.state.storage.get<Meta>('meta')) ?? null;
    const raw = await this.state.storage.get<AccountData>('account');
    this.account = raw ? migrateAccount(raw as unknown as Record<string, unknown>) : null;
  }

  private async persist() {
    await this.state.storage.put({ meta: this.meta, account: this.account });
  }

  private need(): { meta: Meta; account: AccountData } {
    if (!this.meta || !this.account) throw new HttpError(404, 'noAccount');
    return { meta: this.meta, account: this.account };
  }

  private summary(): CharSummary[] {
    return this.need().account.characters.map((c) => ({ id: c.id, name: c.name, level: c.level, rebirths: c.rebirths, area: c.location.area, look: c.look }));
  }

  /** 二重ログイン：今のセッションをエリアに保存させてから切る */
  private async kickCurrent(reason: string) {
    const s = this.meta?.session;
    if (!s) return;
    if (s.key) {
      const ns = s.key.startsWith('inst:') ? this.env.INSTANCE : this.env.AREA;
      try { await call(ns.get(ns.idFromName(s.key)), 'kick', { sid: s.sid, reason }); } catch (e) { console.warn('kick failed', e); }
    }
    this.meta!.session = null;
  }

  async fetch(req: Request): Promise<Response> {
    await this.load();
    return dispatch(req, {
      /** 新しいゲストアカウント */
      init: async (b: { id: string; secretHash: string; now: number }) => {
        if (this.meta) throw new HttpError(409, 'exists');
        const acc = newAccount(b.now, Math.floor(Math.random() * 2 ** 31));
        acc.id = b.id;
        this.meta = { id: b.id, secretHash: b.secretHash, createdAt: b.now, handle: null, name: null, epoch: 0, session: null, migrated: false, banned: null };
        this.account = acc;
        await this.persist();
        return { ok: true };
      },
      auth: async (b: { secret: string }) => {
        const { meta } = this.need();
        if (!safeEqual(await sha256(b.secret), meta.secretHash)) throw new HttpError(401, 'badToken');
        if (meta.banned && meta.banned.until > Date.now()) throw new HttpError(403, 'banned');
        return { ok: true };
      },
      me: async () => {
        const { meta } = this.need();
        return { accountId: meta.id, handle: meta.handle, name: meta.name, characters: this.summary(), migrated: meta.migrated, online: !!meta.session };
      },
      setProfile: async (b: { handle: string; name: string }) => {
        const { meta } = this.need();
        meta.handle = b.handle; meta.name = b.name;
        await this.persist();
        return { ok: true };
      },
      /** 引き継ぎ：秘密を新しくする（前の端末のトークンは使えなくなる） */
      rotate: async () => {
        const { meta } = this.need();
        await this.kickCurrent('transfer');
        const secret = randomId(24);
        meta.secretHash = await sha256(secret);
        meta.epoch++;
        await this.persist();
        return { token: `${meta.id}.${secret}` };
      },
      createCharacter: async (b: { name: string; look: { body: number; hair: number } }) => {
        const { account } = this.need();
        if (account.characters.length >= this.cfg.maxCharacters) throw new HttpError(400, 'tooMany');
        const name = String(b.name ?? '').trim().slice(0, 12);
        const look = { body: Math.max(0, Math.min(7, Math.floor(b.look?.body ?? 0))), hair: Math.max(0, Math.min(7, Math.floor(b.look?.hair ?? 0))) };
        const ch = newCharacter(account, name, look, Date.now(), CONTENT);
        await this.persist();
        return { id: ch.id };
      },
      deleteCharacter: async (b: { id: string }) => {
        const { account, meta } = this.need();
        if (meta.session?.char === b.id) throw new HttpError(409, 'online');
        account.characters = account.characters.filter((c) => c.id !== b.id);
        await this.persist();
        return { ok: true };
      },
      /**
       * 遊び始める：古いセッションを切り、世代を上げて新しいセッションを作る。
       * Worker がこの結果からチケットを作る
       */
      play: async (b: { charId: string; now: number }) => {
        const { account, meta } = this.need();
        const ch = account.characters.find((c) => c.id === b.charId);
        if (!ch) throw new HttpError(404, 'noCharacter');
        await this.kickCurrent('duplicate');
        meta.epoch++;
        const sid = randomId(12);
        meta.session = { sid, char: ch.id, key: null, at: b.now };
        account.lastCharacterId = ch.id;
        await this.persist();
        return { sid, epoch: meta.epoch, location: ch.location, visitedTowns: ch.visitedTowns };
      },
      /** エリアに入ったとき：写しを渡す（世代が今のものでなければ断る） */
      checkout: async (b: { sid: string; epoch: number; key: string }) => {
        const { meta, account } = this.need();
        if (b.epoch !== meta.epoch || meta.session?.sid !== b.sid) throw new HttpError(409, 'stale');
        // 別のエリアに入っている（移る途中の古いチケットなど）なら断る
        if (meta.session.key && meta.session.key !== b.key) throw new HttpError(409, 'elsewhere');
        meta.session.key = b.key;
        await this.state.storage.put('meta', meta);
        return { account };
      },
      /** エリアからの書き戻し */
      save: async (b: { sid: string; epoch: number; account: AccountData; leaving?: boolean; key?: string }) => {
        const { meta } = this.need();
        if (b.epoch !== meta.epoch || meta.session?.sid !== b.sid) throw new HttpError(409, 'stale');
        if (b.key && meta.session.key && meta.session.key !== b.key) throw new HttpError(409, 'elsewhere');
        this.account = migrateAccount(b.account as unknown as Record<string, unknown>);
        for (const c of this.account.characters) normalizeCharacter(c);
        if (b.leaving) meta.session.key = null;
        await this.persist();
        return { ok: true };
      },
      /** 接続が切れた（エリアが最後の保存をしたあと） */
      logout: async (b: { sid: string; epoch: number }) => {
        const { meta } = this.need();
        if (meta.session?.sid === b.sid && b.epoch === meta.epoch) { meta.session = null; await this.persist(); }
        return { ok: true };
      },
      ban: async (b: { reason: string; until: number }) => {
        const { meta } = this.need();
        meta.banned = { reason: b.reason, until: b.until };
        await this.kickCurrent('banned');
        await this.persist();
        return { ok: true };
      },
      /** 管理・テスト用 */
      dump: async () => ({ meta: this.meta, account: this.account }),
    });
  }
}
