import type { ChatMessage, GuildState, PartyState, SocialClientMsg, SocialServerMsg } from '../../../shared/src';
import { api, WS_URL } from './api';

export interface Invite { kind: 'party' | 'guild'; id: string; from: { a: string; name: string; handle: string | null }; name?: string; at: number }

/**
 * チャットの受け口（個人）と全体チャンネルへのつながり。切れたらつなぎ直す。
 */
export class SocialClient {
  messages: ChatMessage[] = [];
  party: PartyState | null = null;
  guild: GuildState | null = null;
  blocks: string[] = [];
  invites: Invite[] = [];
  error: string | null = null;
  onChange: (() => void) | null = null;
  onMessage: ((m: ChatMessage) => void) | null = null;
  private user: WebSocket | null = null;
  private world: WebSocket | null = null;
  private closed = false;
  private retry = 0;
  private waiting = false;

  constructor(private charId: string) {}

  async start() {
    if (this.closed) return;
    this.waiting = false;
    for (const ws of [this.user, this.world]) { if (ws) { ws.onclose = null; ws.onmessage = null; try { ws.close(); } catch { /* noop */ } } }
    try {
      const r = await api.post<{ ticket: string }>('/api/social', { charId: this.charId });
      this.user = this.open(`${WS_URL}/social?ticket=${encodeURIComponent(r.ticket)}`);
      this.world = this.open(`${WS_URL}/chat?ticket=${encodeURIComponent(r.ticket)}`);
      this.retry = 0;
      void this.refresh();
    } catch {
      this.reconnect();
    }
  }

  private open(url: string): WebSocket {
    const ws = new WebSocket(url);
    ws.onmessage = (ev) => { try { this.handle(JSON.parse(String(ev.data))); } catch { /* noop */ } };
    ws.onclose = () => { if (!this.closed && (ws === this.user || ws === this.world)) this.reconnect(); };
    return ws;
  }

  private reconnect() {
    if (this.closed || this.waiting) return;
    this.waiting = true;
    try { this.user?.close(); this.world?.close(); } catch { /* noop */ }
    this.user = this.world = null;
    const wait = Math.min(15000, 1000 * 2 ** this.retry++);
    setTimeout(() => void this.start(), wait);
  }

  /** パーティとギルドの今の状態を読み直す */
  async refresh() {
    try {
      this.party = (await api.get<{ party: PartyState | null }>('/api/party')).party;
      this.guild = (await api.get<{ guild: GuildState | null }>('/api/guild')).guild;
      this.onChange?.();
    } catch { /* noop */ }
  }

  private push(m: ChatMessage) {
    if (this.blocks.includes(m.from.a)) return;
    this.messages.push(m);
    if (this.messages.length > 200) this.messages.splice(0, this.messages.length - 200);
    this.onMessage?.(m);
  }

  private handle(m: SocialServerMsg) {
    switch (m.t) {
      case 'msg': this.push(m); break;
      case 'history': for (const x of m.list) if (!this.messages.some((y) => y.at === x.at && y.from.a === x.from.a)) this.push(x); break;
      case 'party': this.party = m.party; break;
      case 'guild': this.guild = m.guild; break;
      case 'invite': this.invites = [...this.invites.filter((i) => !(i.kind === m.kind && i.id === m.id)), { kind: m.kind, id: m.id, from: m.from, name: m.name, at: Date.now() }]; break;
      case 'blocks': this.blocks = m.list; break;
      case 'error': this.error = m.code; break;
    }
    this.onChange?.();
  }

  send(m: SocialClientMsg) {
    const ws = m.t === 'say' && m.ch === 'world' ? this.world : this.user;
    if (ws?.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(m)); return true; }
    return false;
  }

  close() {
    this.closed = true;
    try { this.user?.close(); this.world?.close(); } catch { /* noop */ }
  }
}
