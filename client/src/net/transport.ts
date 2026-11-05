import type { ClientMsg, ServerMsg } from '../../../shared/src';
import { WS_URL } from './api';

/** サーバーとのつながり（WebSocket・遅延つき・手元の疑似サーバー） */
export interface Transport {
  send(m: ClientMsg): void;
  close(): void;
  onMessage: ((m: ServerMsg) => void) | null;
  onClose: ((code: number) => void) | null;
  onOpen: (() => void) | null;
}

export class WsTransport implements Transport {
  private ws: WebSocket;
  onMessage: ((m: ServerMsg) => void) | null = null;
  onClose: ((code: number) => void) | null = null;
  onOpen: (() => void) | null = null;
  private closedByMe = false;

  constructor(ticket: string) {
    this.ws = new WebSocket(`${WS_URL}/ws?ticket=${encodeURIComponent(ticket)}`);
    this.ws.onopen = () => this.onOpen?.();
    this.ws.onmessage = (ev) => { try { this.onMessage?.(JSON.parse(String(ev.data))); } catch { /* noop */ } };
    this.ws.onclose = (ev) => { if (!this.closedByMe) this.onClose?.(ev.code); };
  }

  send(m: ClientMsg) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
  close() { this.closedByMe = true; try { this.ws.close(1000); } catch { /* noop */ } }
}

/**
 * 遅延と取りこぼしを入れる（試験用。URL に ?lag=200&loss=0.05）。
 * WebSocket は TCP なので「取りこぼし」は再送の待ちとして遅れになる。移動だけの入力は捨てる。
 */
export class LagTransport implements Transport {
  onMessage: ((m: ServerMsg) => void) | null = null;
  onClose: ((code: number) => void) | null = null;
  onOpen: (() => void) | null = null;
  private lastOut = 0;
  private lastIn = 0;
  constructor(private inner: Transport, private lag: number, private loss: number) {
    inner.onMessage = (m) => this.later(() => this.onMessage?.(m), 'in');
    inner.onClose = (c) => this.later(() => this.onClose?.(c), 'in');
    inner.onOpen = () => this.onOpen?.();
  }
  private delay() {
    const j = this.lag * (0.8 + Math.random() * 0.4) / 2;
    return Math.random() < this.loss ? j + this.lag * 2 : j;
  }
  /** 順番は守る（TCP と同じ） */
  private later(fn: () => void, dir: 'in' | 'out') {
    const now = performance.now();
    const at = Math.max(now + this.delay(), dir === 'in' ? this.lastIn : this.lastOut);
    if (dir === 'in') this.lastIn = at; else this.lastOut = at;
    setTimeout(fn, at - now);
  }
  send(m: ClientMsg) {
    if (m.t === 'in' && !m.c?.length && !m.b && m.k < 0 && Math.random() < this.loss) return;
    this.later(() => this.inner.send(m), 'out');
  }
  close() { this.inner.close(); }
}
