import { logger } from '../util/log';
import { CONTENT, repairSetItem, type Item, type MailItem } from '../../../shared/src';
import type { Env } from '../env';
import { HttpError, call, dispatch } from '../util/http';
import { platform } from '../util/platform';

interface Row { id: string; seller: string; seller_name: string; slot: string; rarity: string; base: string; name: string; ilvl: number; refine: number; opts: string; price: number; item: string; created: number; expires: number; status: string }

/**
 * MarketDO：取引所（全体で1つ）。SQLite に出品を持つ。
 * 受け渡しは「送り状（outbox）」に書いてから相手の郵便受け（AccountDO）へ届ける。
 * 届くまで何度でも送り直し、郵便受けは同じ番号を2回受け取らないので、増えも消えもしない。
 */
export class MarketDO {
  private ready = false;
  constructor(private state: DurableObjectState, private env: Env) {}

  private get sql() { return this.state.storage.sql; }

  private init() {
    if (this.ready) return;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS listings (id TEXT PRIMARY KEY, seller TEXT NOT NULL, seller_name TEXT NOT NULL, slot TEXT NOT NULL, rarity TEXT NOT NULL,
      base TEXT NOT NULL, name TEXT NOT NULL, ilvl INTEGER NOT NULL, refine INTEGER NOT NULL, opts TEXT NOT NULL, price INTEGER NOT NULL, item TEXT NOT NULL,
      created INTEGER NOT NULL, expires INTEGER NOT NULL, status TEXT NOT NULL, buyer TEXT);
      CREATE INDEX IF NOT EXISTS listings_open ON listings(status, slot, rarity, price);
      CREATE INDEX IF NOT EXISTS listings_seller ON listings(seller, status);
      CREATE TABLE IF NOT EXISTS ops (id TEXT PRIMARY KEY, result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, account TEXT NOT NULL, mail TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS fixes (id TEXT PRIMARY KEY);`);
    this.repairSets();
    this.ready = true;
  }

  /** 1回だけ：名前と中身がずれたセット装備の出品を直す（data/sets.json の bases に合わせる） */
  private repairSets() {
    if (this.sql.exec("SELECT id FROM fixes WHERE id = 'setBases'").toArray().length) return;
    const rows = this.sql.exec(`SELECT id, item FROM listings WHERE item LIKE '%"set":"%'`).toArray() as unknown as Pick<Row, 'id' | 'item'>[];
    let n = 0;
    for (const r of rows) {
      const it = JSON.parse(r.item) as Item;
      if (!repairSetItem(it, CONTENT)) continue;
      this.sql.exec('UPDATE listings SET base = ?, name = ?, item = ? WHERE id = ?', it.base, it.name, JSON.stringify(it), r.id);
      n++;
    }
    this.sql.exec("INSERT OR IGNORE INTO fixes (id) VALUES ('setBases')");
    if (n) logger.info('market.repairedSets', { n });
  }

  /** 同じ操作がもう一度来たら、前の結果を返す */
  private done(id: string): unknown | null {
    const r = this.sql.exec('SELECT result FROM ops WHERE id = ?', id).toArray()[0] as { result: string } | undefined;
    return r ? JSON.parse(r.result) : null;
  }
  private remember(id: string, result: unknown) {
    this.sql.exec('INSERT OR REPLACE INTO ops (id, result) VALUES (?, ?)', id, JSON.stringify(result));
  }

  private send(account: string, mail: MailItem) {
    this.sql.exec('INSERT OR IGNORE INTO outbox (id, account, mail) VALUES (?, ?, ?)', mail.id, account, JSON.stringify(mail));
  }

  /** 送り状を届ける（失敗したら残して、あとで送り直す） */
  async deliver() {
    const rows = this.sql.exec('SELECT id, account, mail FROM outbox LIMIT 50').toArray() as { id: string; account: string; mail: string }[];
    for (const r of rows) {
      try {
        await call(this.env.ACCOUNT.get(this.env.ACCOUNT.idFromName(r.account)), 'mailAdd', { mail: JSON.parse(r.mail) });
        this.sql.exec('DELETE FROM outbox WHERE id = ?', r.id);
      } catch (e) {
        logger.warn('deliver failed', [r.id, e]);
      }
    }
    const left = (this.sql.exec('SELECT COUNT(*) AS n FROM outbox').one() as { n: number }).n;
    if (left > 0) await this.state.storage.setAlarm(platform.now() + 10_000);
  }

  /** 期限切れを出品者に返す */
  private expire() {
    const now = platform.now();
    const rows = this.sql.exec("SELECT * FROM listings WHERE status = 'open' AND expires < ? LIMIT 100", now).toArray() as unknown as Row[];
    for (const r of rows) {
      this.sql.exec("UPDATE listings SET status = 'expired' WHERE id = ?", r.id);
      this.send(r.seller, { id: `${r.id}:expired`, from: 'market.expired', item: JSON.parse(r.item), at: now });
    }
  }

  async alarm() {
    this.init();
    this.expire();
    await this.deliver();
    await this.state.storage.setAlarm(platform.now() + 3600_000);
  }

  async fetch(req: Request): Promise<Response> {
    this.init();
    const m = CONTENT.market;
    const res = await dispatch(req, {
      /** 出品（AccountDO から。品はもう出品者の手元から外してある） */
      create: (b: { id: string; seller: string; sellerName: string; item: Item; price: number }) => {
        const prev = this.done(b.id);
        if (prev) return prev;
        if (b.item.trade === 'none') throw new HttpError(400, 'untradable');
        if (!Number.isInteger(b.price) || b.price < m.minPrice || b.price > m.maxPrice) throw new HttpError(400, 'price');
        const n = (this.sql.exec("SELECT COUNT(*) AS n FROM listings WHERE seller = ? AND status = 'open'", b.seller).one() as { n: number }).n;
        if (n >= m.maxListings) throw new HttpError(409, 'tooManyListings');
        const now = platform.now();
        const it = b.item;
        this.sql.exec('INSERT INTO listings (id, seller, seller_name, slot, rarity, base, name, ilvl, refine, opts, price, item, created, expires, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          b.id, b.seller, b.sellerName, it.slot, it.rarity, it.base, it.name, it.ilvl, it.refine, ` ${it.options.map((o) => o.key).join(' ')} `, b.price, JSON.stringify(it), now, now + m.durationHours * 3600_000, 'open');
        const r = { ok: true, id: b.id };
        this.remember(b.id, r);
        return r;
      },
      /** 購入（AccountDO から。代金はもう買い手の手元から引いてある） */
      buy: (b: { op: string; id: string; buyer: string; price: number }) => {
        const prev = this.done(b.op);
        if (prev) return prev;
        const row = this.sql.exec("SELECT * FROM listings WHERE id = ? AND status = 'open'", b.id).toArray()[0] as unknown as Row | undefined;
        let r: { ok: boolean; reason?: string };
        if (!row) r = { ok: false, reason: 'soldOut' };
        else if (row.price !== b.price) r = { ok: false, reason: 'priceChanged' };
        else if (row.seller === b.buyer) r = { ok: false, reason: 'ownListing' };
        else {
          this.sql.exec("UPDATE listings SET status = 'sold', buyer = ? WHERE id = ?", b.buyer, b.id);
          const item = JSON.parse(row.item) as Item;
          // 一度だけ取引できる品は、これで取引できなくなる
          if (item.trade === 'once') item.trade = 'none';
          const fee = Math.floor(row.price * m.feePct / 100);
          const now = platform.now();
          this.send(b.buyer, { id: `${b.op}:item`, from: 'market.bought', item, at: now });
          this.send(row.seller, { id: `${b.op}:gold`, from: 'market.sold', gold: row.price - fee, at: now });
          r = { ok: true };
        }
        this.remember(b.op, r);
        return r;
      },
      cancel: (b: { id: string; seller: string }) => {
        const row = this.sql.exec("SELECT * FROM listings WHERE id = ? AND status = 'open'", b.id).toArray()[0] as unknown as Row | undefined;
        if (!row || row.seller !== b.seller) throw new HttpError(404, 'noListing');
        this.sql.exec("UPDATE listings SET status = 'cancelled' WHERE id = ?", b.id);
        this.send(row.seller, { id: `${b.id}:cancel`, from: 'market.cancelled', item: JSON.parse(row.item), at: platform.now() });
        return { ok: true };
      },
      /** 探す（部位・レアリティ・オプション・値段・名前） */
      search: (q: { slot?: string; rarity?: string; opt?: string; min?: number; max?: number; name?: string; seller?: string; sort?: string }) => {
        this.expire();
        const where = ["status = 'open'"]; const args: unknown[] = [];
        if (q.slot) { where.push('slot = ?'); args.push(String(q.slot)); }
        if (q.rarity) { where.push('rarity = ?'); args.push(String(q.rarity)); }
        if (q.opt) { where.push('opts LIKE ?'); args.push(`% ${String(q.opt).replace(/[%_ ]/g, '')} %`); }
        if (q.min) { where.push('price >= ?'); args.push(Number(q.min)); }
        if (q.max) { where.push('price <= ?'); args.push(Number(q.max)); }
        if (q.name) { where.push('name LIKE ?'); args.push(`%${String(q.name).replace(/[%_]/g, '')}%`); }
        if (q.seller) { where.push('seller = ?'); args.push(String(q.seller)); }
        const order = q.sort === 'new' ? 'created DESC' : q.sort === 'high' ? 'price DESC' : 'price ASC';
        const rows = this.sql.exec(`SELECT id, seller, seller_name, price, item, created, expires FROM listings WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${m.searchLimit}`, ...args).toArray() as unknown as Row[];
        return { list: rows.map((r) => ({ id: r.id, seller: r.seller, sellerName: r.seller_name, price: r.price, item: JSON.parse(r.item), created: r.created, expires: r.expires })) };
      },
      /** テスト・管理用 */
      stats: () => ({
        open: (this.sql.exec("SELECT COUNT(*) AS n FROM listings WHERE status = 'open'").one() as { n: number }).n,
        outbox: (this.sql.exec('SELECT COUNT(*) AS n FROM outbox').one() as { n: number }).n,
      }),
    });
    // 受け渡しはすぐ試す（だめならアラームで送り直す）
    await this.deliver();
    return res;
  }
}
