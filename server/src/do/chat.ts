import { CONTENT, filterChat, type ChatFrom, type SocialClientMsg, type SocialServerMsg } from '../../../shared/src';
import type { Env } from '../env';
import { loadConfig } from '../config';
import { HttpError, call, dispatch } from '../util/http';
import { verifyTicket } from '../util/auth';
import { platform } from '../util/platform';

export interface SocialTicket { a: string; name: string; handle: string | null; exp: number; kind: 'social' }
interface Attach { from: ChatFrom; last: number; window: number; count: number }
type Msg = Extract<SocialServerMsg, { t: 'msg' }>;

/**
 * ChatDO：チャンネルごと。
 * - 'world'：全体チャット（WebSocket を休止させたまま受ける）
 * - 'user:<アカウント>'：その人の受け口（個人・パーティ・ギルドのチャット、招待、お知らせ）。ブロックの一覧もここ
 * パーティとギルドは PartyDO / GuildDO が仲間の受け口へ配る。
 */
export class ChatDO {
  private cfg;
  constructor(private state: DurableObjectState, private env: Env) {
    this.cfg = loadConfig(env);
  }

  private get name(): string { return (this.state.id as unknown as { name?: string }).name ?? ''; }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') return this.connect(req);
    return dispatch(req, {
      /** ほかの DO からの配達（ブロックしている人からは届けない） */
      push: async (b: { msg: SocialServerMsg; from?: string }) => {
        if (b.from && (await this.blocks()).includes(b.from)) return { ok: true, blocked: true };
        if (b.msg.t === 'msg') await this.remember(b.msg);
        this.broadcast(b.msg);
        return { ok: true };
      },
      online: async () => ({ n: this.state.getWebSockets().length }),
    });
  }

  private async connect(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const t = await verifyTicket<SocialTicket>(url.searchParams.get('ticket'), this.env.SESSION_SECRET, platform.now());
    if (!t || t.kind !== 'social') return new Response('bad ticket', { status: 401 });
    if (this.name.startsWith('user:') && this.name !== `user:${t.a}`) return new Response('wrong user', { status: 403 });
    const [client, server] = platform.pair();
    this.state.acceptWebSocket(server, [t.a]);
    const at: Attach = { from: { a: t.a, name: t.name, handle: t.handle }, last: 0, window: 0, count: 0 };
    server.serializeAttachment(at);
    // これまでの会話
    const hist = (await this.state.storage.get<Msg[]>('history')) ?? [];
    const send = (m: SocialServerMsg) => { try { server.send(JSON.stringify(m)); } catch { /* noop */ } };
    if (hist.length) send({ t: 'history', ch: this.name === 'world' ? 'world' : 'dm', list: hist });
    if (this.name.startsWith('user:')) send({ t: 'blocks', list: await this.blocks() });
    return platform.upgrade(client);
  }

  private async blocks(): Promise<string[]> {
    return (await this.state.storage.get<string[]>('blocks')) ?? [];
  }

  private async remember(m: Msg) {
    const hist = (await this.state.storage.get<Msg[]>('history')) ?? [];
    hist.push(m);
    await this.state.storage.put('history', hist.slice(-CONTENT.social.chat.history));
  }

  private broadcast(m: SocialServerMsg) {
    const s = JSON.stringify(m);
    for (const ws of this.state.getWebSockets()) { try { ws.send(s); } catch { /* noop */ } }
  }

  /** 連投の制限 */
  private allow(ws: WebSocket, at: Attach): boolean {
    const now = platform.now();
    const ch = CONTENT.social.chat;
    if (now - at.last < ch.minIntervalMs) return false;
    if (now - at.window > 60000) { at.window = now; at.count = 0; }
    if (at.count >= Math.min(ch.perMin, this.cfg.rate.chatPerMin)) return false;
    at.last = now; at.count++;
    ws.serializeAttachment(at);
    return true;
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    let m: SocialClientMsg;
    try { m = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data)); } catch { return; }
    const at = ws.deserializeAttachment() as Attach;
    const err = (code: string) => { try { ws.send(JSON.stringify({ t: 'error', code } satisfies SocialServerMsg)); } catch { /* noop */ } };
    if (m.t === 'ping') { try { ws.send(JSON.stringify({ t: 'pong' })); } catch { /* noop */ } return; }
    if (m.t === 'block') {
      if (!this.name.startsWith('user:')) return;
      const list = new Set(await this.blocks());
      if (m.on) list.add(String(m.id)); else list.delete(String(m.id));
      await this.state.storage.put('blocks', [...list].slice(0, 500));
      try { ws.send(JSON.stringify({ t: 'blocks', list: [...list] } satisfies SocialServerMsg)); } catch { /* noop */ }
      return;
    }
    if (m.t !== 'say') return;
    const stamp = m.stamp && CONTENT.social.chat.stamps.some((s) => s.id === m.stamp) ? m.stamp : undefined;
    const text = m.text ? filterChat(m.text, CONTENT) : undefined;
    if (!stamp && !text) return;
    if (!this.allow(ws, at)) { err('chatRate'); return; }
    const msg: Msg = { t: 'msg', ch: m.ch, from: at.from, text, stamp, at: platform.now() };
    try {
      if (this.name === 'world') {
        if (m.ch !== 'world') return;
        await this.remember(msg);
        this.broadcast(msg);
        return;
      }
      // 個人の受け口から：パーティ・ギルド・個人へ
      if (m.ch === 'party' || m.ch === 'guild') {
        const acc = await call<{ party: string | null; guild: { id: string } | null }>(this.env.ACCOUNT.get(this.env.ACCOUNT.idFromName(at.from.a)), 'social');
        const id = m.ch === 'party' ? acc.party : acc.guild?.id;
        if (!id) { err(m.ch === 'party' ? 'noParty' : 'noGuild'); return; }
        const ns = m.ch === 'party' ? this.env.PARTY : this.env.GUILD;
        await call(ns.get(ns.idFromName(id)), 'chat', { msg });
      } else if (m.ch === 'dm') {
        const row = await this.env.DB.prepare('SELECT account_id FROM profiles WHERE handle = ?').bind(String(m.to ?? '')).first<{ account_id: string }>();
        if (!row) { err('noUser'); return; }
        msg.to = String(m.to);
        await call(this.env.CHAT.get(this.env.CHAT.idFromName(`user:${row.account_id}`)), 'push', { msg, from: at.from.a });
        await this.remember(msg);
        this.broadcast(msg);
      }
    } catch (e) {
      err(e instanceof HttpError ? e.code : 'error');
    }
  }

  async webSocketClose(ws: WebSocket) { try { ws.close(); } catch { /* noop */ } }
  async webSocketError(ws: WebSocket) { try { ws.close(); } catch { /* noop */ } }
}
