/**
 * 再現用：ダンジョンの入口で「入る」を 2 回押したときのオンラインの流れを、クライアントと同じ通信でたどる。
 * 使い方：npm run dev:server を動かしてから
 *   npx vite-node scripts/repro-double-enter.ts -- <押す間隔のミリ秒> <押す回数>
 */
import { CONTENT, fieldLayout } from '../shared/src';

const SERVER = process.env.SERVER ?? 'http://localhost:8787';
const WS = SERVER.replace(/^http/, 'ws');
const GAP = Number(process.argv.at(-2) ?? 0);
const TIMES = Number(process.argv.at(-1) ?? 2);
const log = (...a: unknown[]) => console.log(`[${(performance.now() / 1000).toFixed(2)}]`, ...a);

async function api(method: string, path: string, body?: unknown, token?: string) {
  const r = await fetch(SERVER + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'content-type': 'application/json', origin: 'http://localhost:5173', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path} ${r.status} ${JSON.stringify(j)}`);
  return j;
}

let seq = 0;
let ws: WebSocket | null = null;
let me = { id: -1, x: 0, y: 0 };
let area = '';
let gate: { x: number; y: number } | null = null;
const got: string[] = [];

function connect(ticket: string) {
  const old = ws;
  if (old) { old.onmessage = null; old.onclose = null; old.close(1000); }
  const s = new WebSocket(`${WS}/ws?ticket=${encodeURIComponent(ticket)}`);
  ws = s;
  s.onmessage = (ev) => {
    if (ws !== s) return;
    const m = JSON.parse(String(ev.data));
    if (m.t !== 'snap' && m.t !== 'pong') { got.push(m.t); log('recv', m.t, m.t === 'welcome' ? m.area : m.t === 'kick' ? m.reason : m.t === 'notice' ? m.key : ''); }
    if (m.t === 'welcome') { me.id = m.you; area = m.area; }
    if (m.t === 'move') connect(m.ticket);
    if (m.t === 'snap') {
      for (const e of m.pl ?? []) if (e.id === me.id) { if (typeof e.x === 'number') me.x = e.x; if (typeof e.y === 'number') me.y = e.y; }
      for (const n of m.np ?? []) if (n.npc === 'dungeon_gate') gate = { x: n.x, y: n.y };
    }
  };
  s.onclose = (ev) => { if (ws === s) log('closed', ev.code, ev.reason); };
}
const send = (o: object) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); else log('（つながっていないので送らない）', JSON.stringify(o).slice(0, 60)); };
const input = (m: [number, number], c?: object[]) => send({ t: 'in', n: ++seq, m, a: null, b: 0, k: -1, c });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 歩けるマスの上で、今の位置から入口のそばまでの道順（幅優先） */
function route(to: { x: number; y: number }) {
  const g = fieldLayout(CONTENT, 'meadow')!;
  const m = g.map;
  const key = (i: number, j: number) => j * m.width + i;
  const start = key(Math.floor(me.x), Math.floor(me.y));
  const prev = new Map<number, number>([[start, -1]]);
  const q = [start];
  let end = -1;
  while (q.length) {
    const k = q.shift()!;
    const i = k % m.width, j = Math.floor(k / m.width);
    if (Math.hypot(i + 0.5 - to.x, j + 0.5 - to.y) < 1.6) { end = k; break; }
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj, nk = key(ni, nj);
      if (ni < 0 || nj < 0 || ni >= m.width || nj >= m.height || m.solid[nk] || prev.has(nk)) continue;
      prev.set(nk, k); q.push(nk);
    }
  }
  const out: { x: number; y: number }[] = [];
  for (let k = end; k !== -1; k = prev.get(k)!) out.push({ x: (k % m.width) + 0.5, y: Math.floor(k / m.width) + 0.5 });
  return out.reverse();
}

async function main() {
  const g = await api('POST', '/api/guest');
  const c = await api('POST', '/api/characters', { name: `R${Date.now() % 10000}`, look: { body: 0, hair: 0 } }, g.token);
  const p = await api('POST', '/api/play', { charId: c.id }, g.token);
  connect(p.ticket);
  await sleep(1500);
  input([0, 0], [{ type: 'skipTutorial' }]);
  await sleep(500);
  log('start', area, me, 'gate', gate);
  const path = route(gate!);
  for (const wpt of path) {
    for (let t = 0; t < 40 && Math.hypot(wpt.x - me.x, wpt.y - me.y) > 0.35; t++) {
      const dx = wpt.x - me.x, dy = wpt.y - me.y, l = Math.hypot(dx, dy);
      input([dx / l, dy / l]); await sleep(60);
    }
  }
  input([0, 0]); await sleep(300);
  log('at gate', me, 'dist', Math.hypot(gate!.x - me.x, gate!.y - me.y).toFixed(2));
  if (process.env.WALK_ONLY) {
    // ここで切って位置を保存させ、ブラウザで同じゲストのまま続きから入れるようにする
    send({ t: 'bye' }); await sleep(1500);
    console.log('TOKEN=' + g.token);
    process.exit(0);
  }
  const cmd = { type: 'enterDungeon', dungeon: 'dg_meadow', difficulty: 'normal' };
  input([0, 0], [cmd]);
  for (let k = 1; k < TIMES; k++) { await sleep(GAP); input([0, 0], [cmd]); }
  await sleep(6000);
  log('result: area', area, 'messages', got.join(','));
  log(area === 'instance' ? 'OK: ダンジョンに入れた' : 'NG: ダンジョンに入れていない');
  process.exit(0);
}
void main();
