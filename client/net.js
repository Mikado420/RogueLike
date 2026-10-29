// 通信。オンラインは WebSocket、オフラインはブラウザ内で GameHost を動かす。
// どちらも send(msg) と onMessage(fn) だけを持つので、画面側は区別しなくてよい。
import { World } from '../shared/world.js';
import { GameHost } from '../shared/host.js';
import { TICK } from '../shared/sim.js';

const OFFLINE_KEY = 'ed-offline-world-v1';

export class NetTransport {
  constructor(url) {
    this.url = url;
    this.handlers = [];
    this.queue = [];
    this.closed = false;
    this.ws = null;
    this.retry = 0;
    this.onStatus = () => {};
  }

  connect() {
    return new Promise((resolve, reject) => {
      let opened = false;
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => {
        opened = true;
        this.retry = 0;
        this.onStatus('open');
        for (const m of this.queue) ws.send(JSON.stringify(m));
        this.queue = [];
        resolve();
      };
      ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        for (const h of this.handlers) h(m);
      };
      ws.onclose = () => {
        if (!opened) { reject(new Error('接続できませんでした')); return; }
        if (this.closed) return;
        this.onStatus('reconnecting');
        const wait = Math.min(8000, 1000 * 2 ** this.retry++);
        setTimeout(() => this.connect().then(() => this.onStatus('reconnected')).catch(() => {}), wait);
      };
    });
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
    else if (msg.type !== 'input' && msg.type !== 'town:move') this.queue.push(msg);
  }

  onMessage(fn) { this.handlers.push(fn); }
  close() { this.closed = true; this.ws?.close(); }
}

export class LocalTransport {
  constructor() {
    this.handlers = [];
    let state = null;
    try { state = JSON.parse(localStorage.getItem(OFFLINE_KEY) || 'null'); } catch { state = null; }
    this.world = new World(state);
    this.dirty = false;
    this.host = new GameHost(this.world, { ecoIntervalSec: 180, offline: true, onChange: () => { this.dirty = true; } });
    this.sid = 'local';
    this.host.connect(this.sid, (m) => {
      // 本物の通信と同じく、受け取りは非同期にする
      const copy = structuredClone(m);
      queueMicrotask(() => { for (const h of this.handlers) h(copy); });
    });
    this.timer = setInterval(() => this.host.tick(), TICK * 1000);
    this.saveTimer = setInterval(() => this.save(), 5000);
    addEventListener('pagehide', () => this.save());
  }

  connect() { return Promise.resolve(); }
  send(msg) { this.host.handle(this.sid, structuredClone(msg)); }
  onMessage(fn) { this.handlers.push(fn); }

  save() {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      const text = JSON.stringify(this.world.state, (k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1000) / 1000 : v));
      localStorage.setItem(OFFLINE_KEY, text);
    } catch (e) {
      console.warn('オフラインのデータを保存できませんでした', e);
    }
  }

  close() { this.save(); clearInterval(this.timer); clearInterval(this.saveTimer); }

  static reset() { try { localStorage.removeItem(OFFLINE_KEY); } catch { /* 無視 */ } }
}

export function defaultServerUrl() {
  try {
    const saved = localStorage.getItem('ed-server-url');
    if (saved) return saved;
  } catch { /* 無視 */ }
  if (location.protocol === 'file:') return 'ws://localhost:8080/ws';
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}
