// サーバー本体。静的ファイルの配信と WebSocket（/ws）を1つのポートで行う。
//   npm start                      … 本番（生態系は10分ごと）
//   ECO_INTERVAL_SEC=60 npm start  … 開発用に生態系を速く進める
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from './ws.js';
import { World } from '../shared/world.js';
import { GameHost } from '../shared/host.js';
import { TICK } from '../shared/sim.js';
import { loadState, saveState } from './store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8080);
const ECO_INTERVAL_SEC = Number(process.env.ECO_INTERVAL_SEC || 600);
const DATA_FILE = process.env.DATA_FILE || path.join(ROOT, 'data', 'world.json');

const world = new World(loadState(DATA_FILE));
let dirty = false;
const host = new GameHost(world, { ecoIntervalSec: ECO_INTERVAL_SEC, onChange: () => { dirty = true; } });

// ---- 静的ファイル ----
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.md': 'text/markdown; charset=utf-8' };
const PUBLIC = ['client', 'shared'];

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/' || url === '/index.html') { res.writeHead(302, { location: '/client/' }); return res.end(); }
  if (url.endsWith('/')) url += 'index.html';
  if (url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, generation: world.eco.generation, players: host.sessions.size })); }
  const file = path.normalize(path.join(ROOT, url));
  const top = path.relative(ROOT, file).split(path.sep)[0];
  if (!file.startsWith(ROOT) || !PUBLIC.includes(top)) { res.writeHead(404); return res.end('not found'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
});

// ---- WebSocket ----
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
let nextSid = 1;
wss.on('connection', (ws) => {
  const sid = `c${nextSid++}`;
  host.connect(sid, (msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); });
  let count = 0, windowStart = Date.now();
  ws.on('message', (data) => {
    // 送りすぎる接続は無視する（1秒に60通まで）
    const now = Date.now();
    if (now - windowStart > 1000) { windowStart = now; count = 0; }
    if (++count > 60) return;
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    try { host.handle(sid, msg); } catch (e) { console.error('handle error', e); }
  });
  ws.on('close', () => host.disconnect(sid));
});

// ---- ゲームの時計 ----
setInterval(() => {
  try { host.tick(); } catch (e) { console.error('tick error', e); }
}, TICK * 1000);

setInterval(() => {
  if (!dirty) return;
  dirty = false;
  saveState(DATA_FILE, world.state);
}, 15000);

const shutdown = () => { saveState(DATA_FILE, world.state); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => {
  console.log(`進化の迷宮 サーバー起動: http://localhost:${PORT}  （生態系 ${ECO_INTERVAL_SEC}秒ごと / 第${world.eco.generation}世代）`);
});
