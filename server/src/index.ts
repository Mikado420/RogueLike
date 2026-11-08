import { logger } from './util/log';
import type { Env } from './env';
import { loadConfig } from './config';
import { HttpError, call, corsHeaders, errorResponse, json, readJson } from './util/http';
import { bearer, parseToken, randomCode, randomId, safeEqual, sha256, signTicket, verifyTicket } from './util/auth';
import { platform } from './util/platform';
import type { CharSummary, Ticket } from '../../shared/src/net/protocol';
import { resolveLocation } from '../../shared/src/systems/world';
import { CONTENT } from '../../shared/src/content';

export { AreaDO, InstanceDO } from './do/area';
export { AccountDO } from './do/account';
export { WorldDO } from './do/world';
export { ChatDO } from './do/chat';
export { PartyDO } from './do/party';
export { GuildDO } from './do/guild';
export { MarketDO } from './do/market';

const HANDLE_RE = /^[A-Za-z0-9_]{3,16}$/;

function accountStub(env: Env, id: string) { return env.ACCOUNT.get(env.ACCOUNT.idFromName(id)); }

/** トークンを確かめてアカウント id を返す */
async function authed(req: Request, env: Env): Promise<string> {
  const t = parseToken(bearer(req));
  if (!t) throw new HttpError(401, 'noToken');
  await call(accountStub(env, t.accountId), 'auth', { secret: t.secret });
  return t.accountId;
}

type Route = (req: Request, env: Env, m: RegExpMatchArray) => Promise<Response>;

const routes: [string, RegExp, Route][] = [
  ['GET', /^\/api\/health$/, async () => json({ ok: true, time: platform.now() })],
  // ブラウザで起きたエラーの報告（ログに残すだけ。原因調べ用）
  ['POST', /^\/api\/client-error$/, async (req) => {
    const b = await readJson<{ where?: unknown; message?: unknown; stack?: unknown; ua?: unknown }>(req).catch(() => ({} as Record<string, unknown>));
    const s = (v: unknown, n: number) => String(v ?? '').slice(0, n);
    logger.warn('clientError', { where: s(b.where, 60), message: s(b.message, 300), stack: s(b.stack, 1500), ua: s(b.ua, 200) });
    return json({ ok: true });
  }],
  // ゲストのアカウントを作る
  ['POST', /^\/api\/guest$/, async (_req, env) => {
    const accountId = `a_${randomId(12)}`;
    const secret = randomId(24);
    await call(accountStub(env, accountId), 'init', { id: accountId, secretHash: await sha256(secret), now: platform.now() });
    logger.info('guest');
    return json({ token: `${accountId}.${secret}`, accountId });
  }],
  ['GET', /^\/api\/me$/, async (req, env) => {
    const id = await authed(req, env);
    return json(await call(accountStub(env, id), 'me'));
  }],
  // 名前と ID（ID は重複不可）
  ['POST', /^\/api\/profile$/, async (req, env) => {
    const id = await authed(req, env);
    const b = await readJson<{ handle: string; name: string }>(req);
    const handle = String(b.handle ?? '').trim();
    const name = String(b.name ?? '').trim().slice(0, 16);
    if (!HANDLE_RE.test(handle) || !name) throw new HttpError(400, 'badHandle');
    const existing = await env.DB.prepare('SELECT account_id FROM profiles WHERE handle = ?').bind(handle).first<{ account_id: string }>();
    if (existing && existing.account_id !== id) throw new HttpError(409, 'handleTaken');
    await env.DB.prepare('INSERT INTO profiles (account_id, handle, name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET handle = excluded.handle, name = excluded.name')
      .bind(id, handle, name, platform.now()).run();
    await call(accountStub(env, id), 'setProfile', { handle, name });
    return json({ ok: true });
  }],
  // 引き継ぎコードを出す
  ['POST', /^\/api\/transfer\/issue$/, async (req, env) => {
    const id = await authed(req, env);
    const cfg = loadConfig(env);
    const code = randomCode(10);
    const expiresAt = platform.now() + cfg.transferCodeTtlHours * 3600_000;
    await env.DB.batch([
      env.DB.prepare('DELETE FROM transfer_codes WHERE account_id = ? OR expires_at < ?').bind(id, platform.now()),
      env.DB.prepare('INSERT INTO transfer_codes (code, account_id, expires_at) VALUES (?, ?, ?)').bind(code, id, expiresAt),
    ]);
    return json({ code, expiresAt });
  }],
  // 引き継ぎコードで入る（前の端末は使えなくなる）
  ['POST', /^\/api\/transfer\/redeem$/, async (req, env) => {
    const b = await readJson<{ code: string }>(req);
    const code = String(b.code ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const row = await env.DB.prepare('SELECT account_id, expires_at FROM transfer_codes WHERE code = ?').bind(code).first<{ account_id: string; expires_at: number }>();
    if (!row || row.expires_at < platform.now()) throw new HttpError(404, 'badCode');
    await env.DB.prepare('DELETE FROM transfer_codes WHERE code = ?').bind(code).run();
    const r = await call<{ token: string }>(accountStub(env, row.account_id), 'rotate');
    return json({ token: r.token, accountId: row.account_id });
  }],
  ['POST', /^\/api\/characters$/, async (req, env) => {
    const id = await authed(req, env);
    const b = await readJson<{ name: string; look: { body: number; hair: number } }>(req);
    return json(await call(accountStub(env, id), 'createCharacter', b));
  }],
  ['DELETE', /^\/api\/characters\/([^/]+)$/, async (req, env, m) => {
    const id = await authed(req, env);
    return json(await call(accountStub(env, id), 'deleteCharacter', { id: decodeURIComponent(m[1]) }));
  }],
  // オフライン版のセーブを引き継ぐ（1回だけ。検証して削ったものを返す）
  ['POST', /^\/api\/migrate$/, async (req, env) => {
    const id = await authed(req, env);
    const b = await readJson<{ account: unknown }>(req);
    return json(await call(accountStub(env, id), 'migrate', b));
  }],
  // 遊び始める：チケットと入るエリアを返す
  ['POST', /^\/api\/play$/, async (req, env) => {
    const id = await authed(req, env);
    const b = await readJson<{ charId: string }>(req);
    const cfg = loadConfig(env);
    const r = await call<{ sid: string; epoch: number; location: { area: string; x: number; y: number }; visitedTowns: string[] }>(accountStub(env, id), 'play', { charId: b.charId, now: platform.now() });
    const loc = resolveLocation({ location: r.location, visitedTowns: r.visitedTowns } as never, CONTENT);
    const world = env.WORLD.get(env.WORLD.idFromName('world'));
    const { key } = await call<{ key: string }>(world, 'assign', { area: loc.area });
    const ticket = await signTicket({ a: id, c: b.charId, s: r.sid, e: r.epoch, k: key, at: loc.pos, exp: platform.now() + cfg.ticketTtlSec * 1000 } satisfies Ticket, env.SESSION_SECRET);
    return json({ ticket, key });
  }],
];

// ───────── 人と遊ぶための API ─────────

async function whoami(env: Env, id: string, charId?: string) {
  const me = await call<{ handle: string | null; name: string | null; characters: { id: string; name: string; level: number }[] }>(accountStub(env, id), 'me');
  const s = await call<{ party: string | null; guild: { id: string; role: string } | null }>(accountStub(env, id), 'social');
  const ch = me.characters.find((c) => c.id === charId) ?? me.characters[0];
  return { a: id, name: ch?.name ?? me.name ?? 'ゲスト', level: ch?.level ?? 1, handle: me.handle, party: s.party, guild: s.guild };
}
const party = (env: Env, id: string) => env.PARTY.get(env.PARTY.idFromName(id));
const guild = (env: Env, id: string) => env.GUILD.get(env.GUILD.idFromName(id));
const worldStub = (env: Env) => env.WORLD.get(env.WORLD.idFromName('world'));
async function byHandle(env: Env, handle: string): Promise<string> {
  const row = await env.DB.prepare('SELECT account_id FROM profiles WHERE handle = ?').bind(String(handle ?? '')).first<{ account_id: string }>();
  if (!row) throw new HttpError(404, 'noUser');
  return row.account_id;
}

routes.push(
  // チャットにつなぐチケット（受け口と全体）
  ['POST', /^\/api\/social$/, async (req, env) => {
    const id = await authed(req, env);
    const b = await readJson<{ charId?: string }>(req);
    const w = await whoami(env, id, b.charId);
    const ticket = await signTicket({ a: id, name: w.name, handle: w.handle, kind: 'social', exp: platform.now() + 600_000 }, env.SESSION_SECRET);
    return json({ ticket, party: w.party, guild: w.guild });
  }],
  // ── パーティ ──
  ['GET', /^\/api\/party$/, async (req, env) => {
    const w = await whoami(env, await authed(req, env));
    return json(w.party ? await call(party(env, w.party), 'get') : { party: null });
  }],
  ['POST', /^\/api\/party\/create$/, async (req, env) => {
    const id = await authed(req, env);
    const b = await readJson<{ charId?: string }>(req);
    const w = await whoami(env, id, b.charId);
    if (w.party) await call(party(env, w.party), 'leave', { a: id });
    const pid = `p_${randomId(9)}`;
    return json(await call(party(env, pid), 'create', { id: pid, a: id, name: w.name, level: w.level }));
  }],
  ['POST', /^\/api\/party\/invite$/, async (req, env) => {
    const id = await authed(req, env);
    const b = await readJson<{ handle: string; charId?: string }>(req);
    const w = await whoami(env, id, b.charId);
    if (!w.party) throw new HttpError(400, 'noParty');
    return json(await call(party(env, w.party), 'invite', { from: { a: id, name: w.name, handle: w.handle }, to: await byHandle(env, b.handle) }));
  }],
  ['POST', /^\/api\/party\/join$/, async (req, env) => {
    const id = await authed(req, env);
    const b = await readJson<{ id: string; charId?: string }>(req);
    const w = await whoami(env, id, b.charId);
    if (w.party === b.id) return json(await call(party(env, b.id), 'get'));
    const r = await call<{ party: { members: unknown[]; open: boolean; leader: string; goal: string | null } }>(party(env, b.id), 'join', { a: id, name: w.name, level: w.level });
    if (w.party) await call(party(env, w.party), 'leave', { a: id }).catch(() => {});
    // 募集の人数を直す
    if (r.party.open) {
      if (r.party.members.length >= CONTENT.social.party.max) await call(worldStub(env), 'recruitRemove', { id: b.id });
    }
    return json(r);
  }],
  ['POST', /^\/api\/party\/leave$/, async (req, env) => {
    const id = await authed(req, env);
    const b = await readJson<{ a?: string }>(req);
    const w = await whoami(env, id);
    if (!w.party) return json({ party: null });
    const r = await call<{ party: unknown }>(party(env, w.party), 'leave', { a: b.a ?? id, by: id });
    if (!r.party) await call(worldStub(env), 'recruitRemove', { id: w.party });
    return json(r);
  }],
  // 募集の掲示（誰でも入れる）
  ['POST', /^\/api\/party\/open$/, async (req, env) => {
    const id = await authed(req, env);
    const b = await readJson<{ open: boolean; goal: string | null; charId?: string }>(req);
    const w = await whoami(env, id, b.charId);
    if (!w.party) throw new HttpError(400, 'noParty');
    const goal = b.goal && (CONTENT.dungeons.dungeons[b.goal] || CONTENT.raids[b.goal] || b.goal === 'tower' || CONTENT.areas[b.goal]) ? b.goal : null;
    const r = await call<{ party: { members: unknown[]; leader: string } }>(party(env, w.party), 'setOpen', { a: id, open: !!b.open, goal });
    if (b.open) await call(worldStub(env), 'recruitPost', { id: w.party, leader: id, name: w.name, goal, level: w.level, members: r.party.members.length });
    else await call(worldStub(env), 'recruitRemove', { id: w.party });
    return json(r);
  }],
  ['GET', /^\/api\/recruit$/, async (req, env) => {
    await authed(req, env);
    return json(await call(worldStub(env), 'recruits'));
  }],
  // ── 救援 ──
  ['GET', /^\/api\/rescue$/, async (req, env) => {
    await authed(req, env);
    return json(await call(worldStub(env), 'rescues'));
  }],
  ['POST', /^\/api\/rescue\/join$/, async (req, env) => {
    const id = await authed(req, env);
    const b = await readJson<{ id: string }>(req);
    const r = await call<{ rescue: { key: string; spec: unknown } | null }>(worldStub(env), 'rescueGet', { id: b.id });
    if (!r.rescue?.spec) throw new HttpError(404, 'noRescue');
    const s = await call<{ session: { sid: string; key: string | null } | null }>(accountStub(env, id), 'session');
    if (!s.session?.key) throw new HttpError(409, 'notPlaying');
    const ns = s.session.key.startsWith('inst:') ? env.INSTANCE : env.AREA;
    const ok = await call<{ ok: boolean }>(ns.get(ns.idFromName(s.session.key)), 'sendTo', { sid: s.session.sid, spec: r.rescue.spec, rescuer: true });
    if (!ok.ok) throw new HttpError(409, 'cannotMove');
    return json({ ok: true });
  }],
  // ── ビルド閲覧（プロフィールカード） ──
  ['POST', /^\/api\/builds\/publish$/, async (req, env) => {
    const id = await authed(req, env);
    const b = await readJson<{ charId: string; visibility: 'public' | 'guild' | 'private' }>(req);
    const vis = ['public', 'guild', 'private'].includes(b.visibility) ? b.visibility : 'private';
    await call(accountStub(env, id), 'setPublished', { charId: b.charId, visibility: vis });
    if (vis === 'private') {
      await env.DB.prepare('DELETE FROM builds WHERE char_id = ? AND account_id = ?').bind(b.charId, id).run();
      return json({ ok: true });
    }
    const r = await call<{ card: { name: string; level: number; weapon: string | null; handle: string | null }; guild: string | null }>(accountStub(env, id), 'card', { charId: b.charId });
    await env.DB.prepare(`INSERT INTO builds (char_id, account_id, handle, name, level, weapon, visibility, data, updated_at, guild_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(char_id) DO UPDATE SET handle = excluded.handle, name = excluded.name, level = excluded.level, weapon = excluded.weapon, visibility = excluded.visibility, data = excluded.data, updated_at = excluded.updated_at, guild_id = excluded.guild_id`)
      .bind(b.charId, id, r.card.handle, r.card.name, r.card.level, r.card.weapon, vis, JSON.stringify(r.card), platform.now(), r.guild).run();
    return json({ ok: true });
  }],
  ['GET', /^\/api\/builds$/, async (req, env) => {
    const id = await authed(req, env);
    const w = await whoami(env, id);
    const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 16);
    const rows = await env.DB.prepare(`SELECT char_id, handle, name, level, weapon, visibility FROM builds
      WHERE (visibility = 'public' OR (visibility = 'guild' AND guild_id = ?) OR account_id = ?) AND (? = '' OR name LIKE ? OR handle = ?)
      ORDER BY updated_at DESC LIMIT 50`).bind(w.guild?.id ?? '', id, q, `%${q}%`, q).all();
    return json({ list: rows.results });
  }],
  ['GET', /^\/api\/builds\/([^/]+)$/, async (req, env, m) => {
    const id = await authed(req, env);
    const w = await whoami(env, id);
    const row = await env.DB.prepare('SELECT data, visibility, guild_id, account_id FROM builds WHERE char_id = ?').bind(decodeURIComponent(m[1])).first<{ data: string; visibility: string; guild_id: string | null; account_id: string }>();
    if (!row || (row.visibility === 'guild' && row.guild_id !== w.guild?.id && row.account_id !== id)) throw new HttpError(404, 'noBuild');
    return json({ card: JSON.parse(row.data), visibility: row.visibility });
  }],
  // ── ギルド ──
  ['GET', /^\/api\/guild$/, async (req, env) => {
    const w = await whoami(env, await authed(req, env));
    return json(w.guild ? await call(guild(env, w.guild.id), 'get') : { guild: null });
  }],
  ['POST', /^\/api\/guild\/create$/, async (req, env) => {
    const id = await authed(req, env);
    const b = await readJson<{ name: string; charId?: string }>(req);
    const w = await whoami(env, id, b.charId);
    if (w.guild) throw new HttpError(409, 'inGuild');
    const name = String(b.name ?? '').trim().slice(0, CONTENT.social.guild.nameMax);
    if (!name) throw new HttpError(400, 'badName');
    const gid = `g_${randomId(9)}`;
    try {
      await env.DB.prepare('INSERT INTO guilds (id, name, master, members, created_at) VALUES (?, ?, ?, 1, ?)').bind(gid, name, id, platform.now()).run();
    } catch { throw new HttpError(409, 'guildTaken'); }
    const dump = await call<{ account: { base: unknown } }>(accountStub(env, id), 'dump');
    return json(await call(guild(env, gid), 'create', { id: gid, name, a: id, who: w.name, base: dump.account.base }));
  }],
  ['POST', /^\/api\/guild\/invite$/, async (req, env) => {
    const id = await authed(req, env);
    const b = await readJson<{ handle: string; charId?: string }>(req);
    const w = await whoami(env, id, b.charId);
    if (!w.guild) throw new HttpError(400, 'noGuild');
    return json(await call(guild(env, w.guild.id), 'invite', { from: { a: id, name: w.name, handle: w.handle }, to: await byHandle(env, b.handle) }));
  }],
  ['POST', /^\/api\/guild\/join$/, async (req, env) => {
    const id = await authed(req, env);
    const b = await readJson<{ id: string; charId?: string }>(req);
    const w = await whoami(env, id, b.charId);
    if (w.guild) throw new HttpError(409, 'inGuild');
    return json(await call(guild(env, b.id), 'join', { a: id, name: w.name }));
  }],
  ['POST', /^\/api\/guild\/leave$/, async (req, env) => {
    const id = await authed(req, env);
    const b = await readJson<{ a?: string }>(req);
    const w = await whoami(env, id);
    if (!w.guild) return json({ guild: null });
    return json(await call(guild(env, w.guild.id), 'leave', { a: b.a ?? id, by: id }));
  }],
  ['POST', /^\/api\/guild\/role$/, async (req, env) => {
    const id = await authed(req, env);
    const b = await readJson<{ a: string; role: 'master' | 'officer' | 'member' }>(req);
    const w = await whoami(env, id);
    if (!w.guild) throw new HttpError(400, 'noGuild');
    return json(await call(guild(env, w.guild.id), 'setRole', { by: id, a: b.a, role: b.role }));
  }],
  // ── 取引所・郵便受け（出品・購入はエリアの中のコマンドで） ──
  ['GET', /^\/api\/market$/, async (req, env) => {
    const id = await authed(req, env);
    const sp = new URL(req.url).searchParams;
    const q: Record<string, string | number | undefined> = {};
    for (const k of ['slot', 'rarity', 'opt', 'name', 'sort']) { const v = sp.get(k); if (v) q[k] = v.slice(0, 32); }
    for (const k of ['min', 'max']) { const v = Number(sp.get(k)); if (v > 0) q[k] = v; }
    if (sp.get('mine')) q.seller = id;
    return json(await call(env.MARKET.get(env.MARKET.idFromName('market')), 'search', q));
  }],
  ['GET', /^\/api\/mail$/, async (req, env) => {
    const id = await authed(req, env);
    return json(await call(accountStub(env, id), 'mail'));
  }],
  // ── タイムアタックのランキング（D1） ──
  ['GET', /^\/api\/ranking$/, async (req, env) => {
    await authed(req, env);
    const course = (new URL(req.url).searchParams.get('course') ?? '').slice(0, 40);
    const rows = await env.DB.prepare('SELECT time, names, at FROM time_attack WHERE course = ? ORDER BY time ASC LIMIT ?').bind(course, CONTENT.dungeons.timeAttackTop).all();
    return json({ list: rows.results });
  }],
  // ── 通報 ──
  ['POST', /^\/api\/report$/, async (req, env) => {
    const id = await authed(req, env);
    const b = await readJson<{ target: string; reason: string; text?: string }>(req);
    await env.DB.prepare('INSERT INTO reports (kind, account_id, target, detail, at) VALUES (?, ?, ?, ?, ?)')
      .bind('report', id, String(b.target ?? '').slice(0, 64), JSON.stringify({ reason: String(b.reason ?? '').slice(0, 32), text: String(b.text ?? '').slice(0, 300) }), platform.now()).run();
    return json({ ok: true });
  }],
);

// ───────── 管理用（ADMIN_TOKEN を持つ人だけ） ─────────

function admin(req: Request, env: Env) {
  const t = req.headers.get('x-admin-token') ?? '';
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 8 || !safeEqual(t, env.ADMIN_TOKEN)) throw new HttpError(403, 'notAdmin');
}

routes.push(
  // お知らせを全員に
  ['POST', /^\/admin\/notice$/, async (req, env) => {
    admin(req, env);
    const b = await readJson<{ text: string }>(req);
    const text = String(b.text ?? '').slice(0, 200);
    if (!text) throw new HttpError(400, 'empty');
    const r = await call(worldStub(env), 'adminNotice', { text });
    await call(env.CHAT.get(env.CHAT.idFromName('world')), 'push', { msg: { t: 'msg', ch: 'world', from: { a: 'admin', name: '運営', handle: null }, text, at: platform.now() } });
    return json(r);
  }],
  // 停止・解除
  ['POST', /^\/admin\/ban$/, async (req, env) => {
    admin(req, env);
    const b = await readJson<{ accountId: string; reason: string; hours: number }>(req);
    const until = platform.now() + Math.max(1, Number(b.hours) || 24) * 3600_000;
    await env.DB.prepare('INSERT INTO bans (account_id, reason, until, at) VALUES (?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET reason = excluded.reason, until = excluded.until, at = excluded.at')
      .bind(b.accountId, String(b.reason ?? '').slice(0, 100), until, platform.now()).run();
    await call(accountStub(env, b.accountId), 'ban', { reason: b.reason, until });
    logger.info('ban', { account: b.accountId, until });
    return json({ ok: true, until });
  }],
  ['POST', /^\/admin\/unban$/, async (req, env) => {
    admin(req, env);
    const b = await readJson<{ accountId: string }>(req);
    await env.DB.prepare('DELETE FROM bans WHERE account_id = ?').bind(b.accountId).run();
    await call(accountStub(env, b.accountId), 'unban');
    return json({ ok: true });
  }],
  // ログ（不正の疑い・通報）
  ['GET', /^\/admin\/logs$/, async (req, env) => {
    admin(req, env);
    const sp = new URL(req.url).searchParams;
    const kind = sp.get('kind') ?? '';
    const limit = Math.min(500, Math.max(1, Number(sp.get('limit')) || 100));
    const rows = await env.DB.prepare('SELECT * FROM reports WHERE (? = \'\' OR kind = ?) ORDER BY at DESC LIMIT ?').bind(kind, kind, limit).all();
    return json({ list: rows.results });
  }],
  // 接続数など
  ['GET', /^\/admin\/stats$/, async (req, env) => {
    admin(req, env);
    const ch = await call<{ channels: { key: string; n: number; at: number }[] }>(worldStub(env), 'channels');
    const chat = await call<{ n: number }>(env.CHAT.get(env.CHAT.idFromName('world')), 'online');
    const market = await call(env.MARKET.get(env.MARKET.idFromName('market')), 'stats');
    const now = platform.now();
    const live = ch.channels.filter((c) => c.n > 0 && now - c.at < 300_000);
    return json({ players: live.reduce((s, c) => s + c.n, 0), areas: live, chatSockets: chat.n, market });
  }],
);

/** HTTP の回数の上限（同じ IP から1分あたり。Worker の中だけで数える簡易版） */
const httpHits = new Map<string, { at: number; n: number }>();
function rateLimited(req: Request, env: Env): boolean {
  const ip = req.headers.get('cf-connecting-ip') ?? '';
  if (!ip) return false;
  const now = platform.now();
  const h = httpHits.get(ip);
  if (!h || now - h.at > 60_000) { httpHits.set(ip, { at: now, n: 1 }); if (httpHits.size > 5000) httpHits.clear(); return false; }
  h.n++;
  return h.n > loadConfig(env).rate.httpPerMin;
}

async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  // WebSocket：チケットを確かめて AreaDO / InstanceDO へ
  if (url.pathname === '/ws') {
    if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('expected websocket', { status: 426 });
    const t = await verifyTicket<Ticket>(url.searchParams.get('ticket'), env.SESSION_SECRET, platform.now());
    if (!t) return new Response('bad ticket', { status: 401 });
    const ns = t.k.startsWith('inst:') ? env.INSTANCE : env.AREA;
    return ns.get(ns.idFromName(t.k)).fetch(req);
  }
  // チャット：個人の受け口と全体
  if (url.pathname === '/social' || url.pathname === '/chat') {
    if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('expected websocket', { status: 426 });
    const t = await verifyTicket<{ a: string; kind: string; exp: number }>(url.searchParams.get('ticket'), env.SESSION_SECRET, platform.now());
    if (!t || t.kind !== 'social') return new Response('bad ticket', { status: 401 });
    const name = url.pathname === '/social' ? `user:${t.a}` : 'world';
    return env.CHAT.get(env.CHAT.idFromName(name)).fetch(req);
  }
  if (url.pathname.startsWith('/api/') && rateLimited(req, env)) throw new HttpError(429, 'tooMany');
  for (const [method, re, fn] of routes) {
    if (req.method !== method) continue;
    const m = url.pathname.match(re);
    if (m) return fn(req, env, m);
  }
  throw new HttpError(404, 'notFound');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(req.headers.get('origin'), env.ALLOWED_ORIGINS);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let res: Response;
    try { res = await handle(req, env); } catch (e) { res = errorResponse(e); }
    if (res.status === 101) return res;
    const h = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) h.set(k, v);
    return new Response(res.body, { status: res.status, headers: h });
  },
};

export type { CharSummary };
