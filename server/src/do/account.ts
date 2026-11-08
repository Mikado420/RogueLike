import { logger } from '../util/log';
import { type MailItem, type TradeOp, CONTENT, LIMITS, migrateAccount, repairSetItem, newAccount, newCharacter, normalizeCharacter, sanitizeAccount, type AccountData, type CharSummary, type Item, type Removed } from '../../../shared/src';
import type { Env } from '../env';
import { loadConfig } from '../config';
import { HttpError, call, dispatch } from '../util/http';
import { randomId, safeEqual, sha256 } from '../util/auth';

/** 52bit のアイテム番号 */
function randomUid(): number {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return (a[0] & 0x3ffffff) * 0x4000000 + (a[1] & 0x3ffffff) + 1;
}

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
  party?: string | null;
  guild?: { id: string; role: string; base: AccountData['base'] } | null;
  /** 公開しているビルド（キャラ id → 公開範囲） */
  published?: Record<string, 'public' | 'guild'>;
  /** 露店に並べている品（預かり） */
  stall?: { uid: number; item: Item; price: number }[] | null;
}

/** 出す側で済ませて、相手に届けるのを待っている取引 */
type Pending =
  | { op: string; kind: 'list'; item: Item; price: number; name: string }
  | { op: string; kind: 'buy'; id: string; price: number }
  | { op: string; kind: 'stallBuy'; seller: string; uid: number; price: number };

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

  private mail: MailItem[] = [];
  /** 受け取り済みの郵便の番号（同じものを2回受け取らない） */
  private seen: string[] = [];
  private pending: Pending[] = [];

  private async load() {
    if (this.meta) return;
    this.meta = (await this.state.storage.get<Meta>('meta')) ?? null;
    const raw = await this.state.storage.get<AccountData>('account');
    this.account = raw ? migrateAccount(raw as unknown as Record<string, unknown>) : null;
    this.mail = (await this.state.storage.get<MailItem[]>('mail')) ?? [];
    this.seen = (await this.state.storage.get<string[]>('seen')) ?? [];
    this.pending = (await this.state.storage.get<Pending[]>('pending')) ?? [];
    // 名前と中身がずれたセット装備を直す（郵便受け・露店・送る途中の出品。持ち物と倉庫は migrateAccount が直す）
    for (const m of this.mail) repairSetItem(m.item, CONTENT);
    for (const s of this.meta?.stall ?? []) repairSetItem(s.item, CONTENT);
    for (const p of this.pending) if (p.kind === 'list') repairSetItem(p.item, CONTENT);
  }

  /** アカウント・郵便受け・待ちの取引を一度に書く（どれかだけ書かれることはない） */
  private async persist(extra: Record<string, unknown> = {}) {
    await this.state.storage.put({ meta: this.meta, account: this.account, mail: this.mail, seen: this.seen.slice(-2000), pending: this.pending, ...extra });
  }

  /** 郵便受けに入れる（同じ番号は1回だけ） */
  private addMail(m: MailItem): boolean {
    if (this.seen.includes(m.id)) return false;
    repairSetItem(m.item, CONTENT);
    this.seen.push(m.id);
    this.mail.push(m);
    return true;
  }

  private market() { return this.env.MARKET.get(this.env.MARKET.idFromName('market')); }

  /**
   * 待っている取引を相手へ届ける。相手が断ったら自分の郵便受けに返す。
   * 通信の失敗なら残して、あとで（アラーム）送り直す
   */
  private async flushPending() {
    const meta = this.meta!;
    let changed = false;
    for (const p of [...this.pending]) {
      try {
        if (p.kind === 'list') {
          await call(this.market(), 'create', { id: p.op, seller: meta.id, sellerName: p.name, item: p.item, price: p.price });
        } else if (p.kind === 'buy') {
          const r = await call<{ ok: boolean }>(this.market(), 'buy', { op: p.op, id: p.id, buyer: meta.id, price: p.price });
          if (!r.ok) this.addMail({ id: `${p.op}:refund`, from: 'market.refund', gold: p.price, at: Date.now() });
        } else if (p.kind === 'stallBuy') {
          const r = await call<{ ok: boolean; item?: Item }>(this.env.ACCOUNT.get(this.env.ACCOUNT.idFromName(p.seller)), 'stallSold', { op: p.op, uid: p.uid, price: p.price, buyer: meta.id });
          if (r.ok && r.item) this.addMail({ id: `${p.op}:item`, from: 'stall.bought', item: r.item, at: Date.now() });
          else this.addMail({ id: `${p.op}:refund`, from: 'stall.refund', gold: p.price, at: Date.now() });
        }
        this.pending = this.pending.filter((x) => x !== p);
        changed = true;
      } catch (e) {
        if (e instanceof HttpError && e.status < 500) {
          // 断られた：出した品・代金を返す
          if (p.kind === 'list') this.addMail({ id: `${p.op}:back`, from: 'market.back', item: p.item, at: Date.now() });
          else this.addMail({ id: `${p.op}:refund`, from: 'market.refund', gold: p.price, at: Date.now() });
          this.pending = this.pending.filter((x) => x !== p);
          changed = true;
        } else {
          logger.warn('pending retry later', [p.op, e]);
        }
      }
    }
    if (changed) { await this.persist(); await this.toArea('mailArrived', {}); }
    if (this.pending.length) await this.state.storage.setAlarm(Date.now() + 15_000);
  }

  async alarm() {
    await this.load();
    if (this.meta) await this.flushPending();
  }

  /** 露店を閉じる：残りの品は郵便受けへ */
  private closeStall() {
    const meta = this.meta!;
    for (const s of meta.stall ?? []) this.addMail({ id: `stall:${s.uid}:${Date.now()}`, from: 'stall.back', item: s.item, at: Date.now() });
    meta.stall = null;
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
      try { await call(ns.get(ns.idFromName(s.key)), 'kick', { sid: s.sid, reason }); } catch (e) { logger.warn('kick failed', [e]); }
    }
    this.meta!.session = null;
  }

  /** 今いるエリアに知らせる */
  private async toArea(op: string, body: object) {
    const s = this.meta?.session;
    if (!s?.key) return;
    const ns = s.key.startsWith('inst:') ? this.env.INSTANCE : this.env.AREA;
    await call(ns.get(ns.idFromName(s.key)), op, { sid: s.sid, ...body }).catch(() => {});
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
        return { account, party: meta.party ?? null, guild: meta.guild ?? null, handle: meta.handle };
      },
      /** エリアからの書き戻し */
      /**
       * エリアからの書き戻し。claim があれば郵便受けからその番号を消す（全部そろっていなければ断る）。
       * trade があれば、書き戻しと同じ書き込みで「待ちの取引」を残してから相手に届ける
       */
      save: async (b: { sid: string; epoch: number; account: AccountData; leaving?: boolean; key?: string; claim?: string[]; trade?: { op: string; t: TradeOp } }) => {
        const { meta } = this.need();
        if (b.epoch !== meta.epoch || meta.session?.sid !== b.sid) throw new HttpError(409, 'stale');
        if (b.key && meta.session.key && meta.session.key !== b.key) throw new HttpError(409, 'elsewhere');
        if (b.claim?.length) {
          const ids = new Set(b.claim);
          if (this.mail.filter((m) => ids.has(m.id)).length !== ids.size) throw new HttpError(409, 'claimFailed');
          this.mail = this.mail.filter((m) => !ids.has(m.id));
        }
        this.account = migrateAccount(b.account as unknown as Record<string, unknown>);
        for (const c of this.account.characters) normalizeCharacter(c);
        const t = b.trade?.t;
        const op = b.trade?.op ?? '';
        if (t?.kind === 'list') this.pending.push({ op, kind: 'list', item: t.item, price: t.price, name: this.account.characters.find((c) => c.id === meta.session!.char)?.name ?? '' });
        if (t?.kind === 'buy') this.pending.push({ op, kind: 'buy', id: t.id, price: t.price });
        if (t?.kind === 'stallBuy') this.pending.push({ op, kind: 'stallBuy', seller: t.seller, uid: t.uid, price: t.price });
        if (t?.kind === 'stallOpen') meta.stall = t.items;
        if (t?.kind === 'stallClose') this.closeStall();
        if (b.leaving) { meta.session.key = null; if (meta.stall?.length) this.closeStall(); }
        // ふだんの定期保存はアカウントだけ書く（書き込みの行数を減らす）
        if (!t && !b.claim?.length && !b.leaving) await this.state.storage.put('account', this.account);
        else await this.persist();
        if (t?.kind === 'cancel') await call(this.market(), 'cancel', { id: t.id, seller: meta.id });
        if (t?.kind === 'stallClose' && !b.leaving) await this.toArea('mailArrived', {});
        if (this.pending.length) await this.flushPending();
        return { ok: true, mail: this.mail.length };
      },
      /** 郵便受け（ほかの DO から。同じ番号は1回だけ） */
      mailAdd: async (b: { mail: MailItem }) => {
        this.need();
        if (this.mail.length >= CONTENT.market.mailMax && !this.seen.includes(b.mail.id)) logger.warn('mailbox full', [this.meta!.id]);
        if (this.addMail(b.mail)) { await this.persist(); await this.toArea('mailArrived', {}); }
        return { ok: true };
      },
      mail: async () => ({ mail: this.mail, stall: this.meta?.stall ?? null }),
      /** 露店で売れた（買い手の AccountDO から）。品を渡し、代金は自分の郵便受けへ */
      stallSold: async (b: { op: string; uid: number; price: number; buyer: string }) => {
        const { meta } = this.need();
        const key = `${b.op}:sold`;
        const prev = (await this.state.storage.get<{ ok: boolean; item?: Item }>(`op:${key}`));
        if (prev) return prev;
        const i = (meta.stall ?? []).findIndex((s) => s.uid === b.uid && s.price === b.price);
        let r: { ok: boolean; item?: Item };
        if (i < 0 || b.buyer === meta.id) r = { ok: false };
        else {
          const s = meta.stall!.splice(i, 1)[0];
          if (s.item.trade === 'once') s.item.trade = 'none';
          const fee = Math.floor(b.price * CONTENT.market.stallFeePct / 100);
          this.addMail({ id: `${b.op}:gold`, from: 'stall.sold', gold: b.price - fee, at: Date.now() });
          r = { ok: true, item: s.item };
        }
        await this.persist({ [`op:${key}`]: r });
        await this.toArea('mailArrived', {});
        await this.toArea('stallSold', { uid: b.uid });
        return r;
      },
      /** 接続が切れた（エリアが最後の保存をしたあと） */
      logout: async (b: { sid: string; epoch: number }) => {
        const { meta } = this.need();
        if (meta.session?.sid === b.sid && b.epoch === meta.epoch) { meta.session = null; await this.persist(); }
        return { ok: true };
      },
      /**
       * オフライン版のセーブの引き継ぎ（1アカウント1回）。検証して、おかしいものは削り、何を削ったかを返す
       */
      migrate: async (b: { account: unknown }) => {
        const { meta, account } = this.need();
        if (meta.migrated) throw new HttpError(409, 'migrated');
        if (meta.session) throw new HttpError(409, 'online');
        let clean: AccountData, removed: Removed[];
        try { ({ account: clean, removed } = sanitizeAccount(b.account, CONTENT)); } catch { throw new HttpError(400, 'badSave'); }
        // アイテム番号はサーバーで振り直す（ほかのアカウントと重ならないように）
        const reUid = (it: Item) => { it.uid = randomUid(); return it; };
        let added = 0;
        for (const ch of clean.characters) {
          if (account.characters.length >= this.cfg.maxCharacters) { removed.push({ char: ch.name, what: ch.name, reason: 'count' }); continue; }
          ch.id = `${account.id}.c${account.nextUid++}`;
          ch.inventory.forEach(reUid);
          for (const k of Object.keys(ch.equipment) as (keyof typeof ch.equipment)[]) { const it = ch.equipment[k]; if (it) reUid(it); }
          for (const pt of ch.pets) { const old = pt.uid; pt.uid = randomUid(); if (ch.activePet === old) ch.activePet = pt.uid; }
          account.characters.push(ch);
          added++;
        }
        const st = account.storage;
        st.capacity = Math.max(st.capacity, clean.storage.capacity);
        for (const it of clean.storage.items) {
          if (st.items.length >= st.capacity) { removed.push({ char: null, what: it.name, reason: 'count' }); continue; }
          st.items.push(reUid(it));
        }
        for (const [id, n] of Object.entries(clean.storage.bag)) st.bag[id] = Math.min(LIMITS.bagEach, (st.bag[id] ?? 0) + n);
        if (Object.keys(account.base.levels).length === 0) account.base = clean.base;
        meta.migrated = true;
        await this.persist();
        logger.info('migrate', { account: meta.id, added, removed: removed.length });
        return { ok: true, characters: added, removed };
      },
      session: async () => ({ session: this.need().meta.session }),
      /** チャットのため：パーティとギルド */
      social: async () => {
        const { meta } = this.need();
        return { party: meta.party ?? null, guild: meta.guild ?? null, handle: meta.handle, name: meta.name };
      },
      setParty: async (b: { party: string | null }) => {
        const { meta } = this.need();
        meta.party = b.party;
        await this.state.storage.put('meta', meta);
        await this.toArea('setParty', { party: b.party });
        return { ok: true };
      },
      setGuild: async (b: { guild: Meta['guild'] }) => {
        const { meta } = this.need();
        meta.guild = b.guild;
        await this.state.storage.put('meta', meta);
        await this.toArea('setGuild', { base: b.guild?.base ?? null });
        return { ok: true };
      },
      /** プロフィールカード（ステ振り・スキル・装備・称号） */
      card: async (b: { charId: string }) => {
        const { account, meta } = this.need();
        const ch = account.characters.find((c) => c.id === b.charId);
        if (!ch) throw new HttpError(404, 'noCharacter');
        return { card: buildCard(ch, meta.handle), guild: meta.guild?.id ?? null };
      },
      setPublished: async (b: { charId: string; visibility: 'public' | 'guild' | 'private' }) => {
        const { meta } = this.need();
        meta.published ??= {};
        if (b.visibility === 'private') delete meta.published[b.charId]; else meta.published[b.charId] = b.visibility;
        await this.state.storage.put('meta', meta);
        return { ok: true };
      },
      unban: async () => {
        const { meta } = this.need();
        meta.banned = null;
        await this.persist();
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

/** 公開用のカード（持ち物や素材は出さない） */
export function buildCard(ch: AccountData['characters'][number], handle: string | null) {
  return {
    id: ch.id, name: ch.name, handle, level: ch.level, rebirths: ch.rebirths, look: ch.look,
    stats: ch.stats, personal: ch.personal, skills: ch.skills, skillSlots: ch.skillSlots,
    equipment: ch.equipment, title: ch.titles.equipped, appearance: ch.appearance.selected,
    weapon: ch.equipment.weapon?.kind ?? null, tower: ch.tower.best,
  };
}
