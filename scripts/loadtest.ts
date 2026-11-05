/**
 * ボットで負荷を試す（npm run loadtest）。
 * Node の中の疑似 Cloudflare（server/test/runtime）で、本物の Worker・Durable Object・通信の流れを動かし、
 * 1人・1エリアあたりのメッセージ数・バイト数・tick の時間を測って、無料枠の見積もりを出す。
 */
import { performance } from 'node:perf_hooks';
import { makeEnv, flush } from '../server/test/runtime';
import { TestClient } from '../server/test/client';
import { platform } from '../server/src/util/platform';
import { loadConfig } from '../server/src/config';
import { Bot, BTN_ATTACK, BTN_DODGE, type World } from '../shared/src';

const MINUTES = Number(process.env.MINUTES ?? 3);
const SIZES = (process.env.SIZES ?? '1,5,10,20').split(',').map(Number);

interface Result { players: number; inPerMin: number; outPerMin: number; outKbPerMin: number; tickMs: number; accountCallsPerMin: number; worldCallsPerMin: number }

async function run(n: number): Promise<Result> {
  let clock = 1_800_000_000_000;
  platform.now = () => clock;
  const env = makeEnv({ TICK_MODE: 'manual' });
  const cfg = loadConfig(env);
  // DO どうしの呼び出しを数える
  let accountCalls = 0, worldCalls = 0;
  const wrap = (ns: any, inc: () => void) => { const g = ns.get.bind(ns); ns.get = (id: any) => { const s = g(id); return { fetch: (r: Request) => { inc(); return s.fetch(r); } }; }; };
  wrap(env.ACCOUNT, () => accountCalls++);
  wrap(env.WORLD, () => worldCalls++);
  const clients: { c: TestClient; bot: Bot; last: string; lastAt: number; sent: number }[] = [];
  for (let i = 0; i < n; i++) {
    const c = await new TestClient(env).guest();
    await c.play(await c.createChar(`B${i}`));
    clients.push({ c, bot: new Bot(10 + i), last: '', lastAt: 0, sent: 0 });
  }
  const area = (env.AREA as any).instances.get(clients[0].c.key);
  for (const x of clients) { const p = area.host.player([...area.host.sessions.keys()].find((s: string) => area.host.sessions.get(s) === x.c.you)); if (p) { p.char.level = 20; p.char.tutorial.done = true; p.statsDirty = true; } }
  accountCalls = 0; worldCalls = 0;
  for (const x of clients) x.c.msgs = [];
  const ticks = MINUTES * 60 * 20;
  let tickTime = 0;
  const minMs = 1000 / cfg.inputRate;
  for (let t = 0; t < ticks; t++) {
    clock += 50;
    for (const x of clients) {
      const w: World = area.host.world;
      const p = w.players.find((pp) => pp.id === x.c.you);
      if (!p) continue;
      const inp = x.bot.think(w, p);
      // client と同じ送り方：方向を丸め、変わったとき（と1秒ごと）だけ、上限の頻度まで
      const q = (v: number) => Math.round(v * 16) / 16;
      const m: [number, number] = [q(inp.move.x), q(inp.move.y)];
      const a: [number, number] | null = inp.aim ? [q(inp.aim.x), q(inp.aim.y)] : null;
      const b = (inp.attack ? BTN_ATTACK : 0) | (inp.dodge ? BTN_DODGE : 0);
      const key = `${m}|${a}|${b}|${inp.skill}`;
      const press = inp.skill >= 0 || inp.dodge || inp.commands.length > 0;
      if ((key !== x.last || clock - x.lastAt > 1000) && (press || clock - x.lastAt >= minMs)) {
        x.c.send({ t: 'in', n: ++x.c.seq, m, a, b, k: inp.skill, c: inp.commands.length ? inp.commands : undefined });
        x.last = key; x.lastAt = clock; x.sent++;
      }
      if (t % 60 === 0) { x.c.send({ t: 'ping', at: clock }); x.sent++; }
    }
    await flush(1);
    const t0 = performance.now();
    await area.tick(50);
    tickTime += performance.now() - t0;
    if (t % 20 === 0) await flush(3);
  }
  await flush(10);
  const sent = clients.reduce((s, x) => s + x.sent, 0);
  const recv = clients.reduce((s, x) => s + x.c.msgs.length, 0);
  const bytes = clients.reduce((s, x) => s + x.c.ws!.received.reduce((b: number, d: unknown) => b + String(d).length, 0), 0);
  return {
    players: n,
    inPerMin: sent / n / MINUTES,
    outPerMin: recv / n / MINUTES,
    outKbPerMin: bytes / n / MINUTES / 1024,
    tickMs: tickTime / ticks,
    accountCallsPerMin: accountCalls / MINUTES,
    worldCallsPerMin: worldCalls / MINUTES,
  };
}

const rows: Result[] = [];
for (const n of SIZES) rows.push(await run(n));
const f = (v: number, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('en-US');
console.log(`\n■ ボットの負荷（1エリア、${MINUTES} 分）`);
console.log('| 人数 | 送信 msg/分/人 | 受信 msg/分/人 | 受信 KB/分/人 | 1tick の CPU ms | AccountDO 呼び出し/分 | WorldDO 呼び出し/分 |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) console.log(`| ${r.players} | ${f(r.inPerMin)} | ${f(r.outPerMin)} | ${f(r.outKbPerMin)} | ${f(r.tickMs, 2)} | ${f(r.accountCallsPerMin)} | ${f(r.worldCallsPerMin)} |`);

// 無料枠の見積もり（Workers Free / Durable Objects Free：1日あたり）
const FREE_REQ = 100_000, FREE_GBS = 13_000, MEM_GB = 0.128;
console.log('\n■ 1プレイヤー時間あたり（1人が1時間遊ぶ）の目安');
for (const r of rows) {
  const wsReq = (r.inPerMin * 60) / 20; // WebSocket の受信は 20 通で 1 リクエスト
  const doCalls = ((r.accountCallsPerMin + r.worldCallsPerMin) * 60) / r.players;
  const reqPerPh = wsReq + doCalls + 10; // ログインなど HTTP は1回あたり約10
  const gbsPerPh = (3600 * MEM_GB) / r.players; // エリアが動いている間の時間を人数で割る
  console.log(`- ${r.players}人で1エリア：リクエスト ${f(reqPerPh, 0)} / 時間・人（無料枠の ${f((reqPerPh / FREE_REQ) * 100, 2)}%）、DO の時間 ${f(gbsPerPh, 1)} GB-s（${f((gbsPerPh / FREE_GBS) * 100, 2)}%）→ 1日に遊べるのは約 ${f(Math.min(FREE_REQ / reqPerPh, FREE_GBS / gbsPerPh), 0)} プレイヤー時間`);
}
process.exit(0);
