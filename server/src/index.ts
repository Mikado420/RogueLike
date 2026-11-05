import type { Env } from './env';
import { loadConfig } from './config';
import { HttpError, call, corsHeaders, errorResponse, json, readJson } from './util/http';
import { bearer, parseToken, randomCode, randomId, sha256, signTicket, verifyTicket } from './util/auth';
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
  // ゲストのアカウントを作る
  ['POST', /^\/api\/guest$/, async (_req, env) => {
    const accountId = `a_${randomId(12)}`;
    const secret = randomId(24);
    await call(accountStub(env, accountId), 'init', { id: accountId, secretHash: await sha256(secret), now: platform.now() });
    console.log(JSON.stringify({ ev: 'guest' }));
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
