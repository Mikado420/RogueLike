// クライアントの入口。タイトル → 町 → ダンジョン の画面切り替えと、毎フレームの更新を行う。
import { Renderer } from './render.js';
import { Input } from './input.js';
import { Panels } from './ui.js';
import { NetTransport, LocalTransport, defaultServerUrl } from './net.js';
import { TOWN, SPOTS, moveInTown } from './town.js';
import { moveCircle } from '../shared/dungeon.js';
import { playerStats } from '../shared/items.js';
import { ELEMENT_INFO } from '../shared/elements.js';

const canvas = document.getElementById('screen');
const hud = document.getElementById('hud');
const touch = document.getElementById('touch');
const toasts = document.getElementById('toasts');

const app = {
  transport: null,
  offline: false,
  serverUrl: defaultServerUrl(),
  scene: 'title',
  me: null,
  areas: [],
  world: null,
  news: [],
  nextEcoAt: null,
  generation: null,
  market: [],
  codex: [],
  party: null,
  parties: [],
  nameRights: [],
  chat: [],
  town: { x: TOWN.spawn.x, y: TOWN.spawn.y, dir: 0, moving: false },
  others: new Map(),
  d: null, // ダンジョンの状態
  pendingNameClose: null,
  send(m) { this.transport?.send(m); },
};

const renderer = new Renderer(canvas);
const input = new Input(canvas);
const panels = new Panels(app);

// ---------- 起動・ログイン ----------
const tokenKey = () => (app.offline ? 'ed-token-offline' : `ed-token:${app.serverUrl}`);
const getToken = () => { try { return localStorage.getItem(tokenKey()); } catch { return null; } };
const setToken = (t) => { try { localStorage.setItem(tokenKey(), t); } catch { /* 保存できなくても続ける */ } };

app.startOnline = async () => {
  panels.show('title', { message: '接続しています…' });
  const t = new NetTransport(app.serverUrl);
  t.onStatus = (s) => { if (s === 'reconnecting') toast('接続が切れました。再接続しています…', true); if (s === 'reconnected') { toast('再接続しました'); t.send({ type: 'hello', token: getToken() }); } };
  try {
    await t.connect();
  } catch {
    panels.show('title', { message: `サーバー（${app.serverUrl}）に接続できませんでした。オフラインで遊ぶか、接続先を確認してください。`, error: true });
    return;
  }
  app.offline = false;
  attach(t);
};

app.startOffline = () => {
  app.offline = true;
  attach(new LocalTransport());
};

app.resetOffline = () => { LocalTransport.reset(); try { localStorage.removeItem('ed-token-offline'); } catch { /* 無視 */ } };
app.setServerUrl = (url) => { app.serverUrl = url.trim() || defaultServerUrl(); try { localStorage.setItem('ed-server-url', app.serverUrl); } catch { /* 無視 */ } };
app.submitName = (name) => app.send({ type: 'hello', name });

function attach(t) {
  app.transport?.close?.();
  app.transport = t;
  t.onMessage(onMessage);
  t.send({ type: 'hello', token: getToken() });
}

// ---------- 受信 ----------
function onMessage(m) {
  switch (m.type) {
    case 'needName': return panels.show('title', { needName: true });
    case 'welcome':
      setToken(m.token);
      app.me = m.player;
      app.areas = m.areas;
      app.world = m.world;
      app.generation = m.world.generation;
      app.news = m.news || [];
      app.nextEcoAt = Date.now() + m.nextEcoIn * 1000;
      app.offline = !!m.offline;
      enterTown();
      toast(`ようこそ、${app.me.name}`);
      return;
    case 'profile': app.me = m.player; return panels.refresh();
    case 'town:state':
      for (const p of m.players) {
        if (p.id === app.me?.id) continue;
        const o = app.others.get(p.id) || { x: p.x, y: p.y };
        Object.assign(o, { tx: p.x, ty: p.y, name: p.name, dir: p.dir, seen: performance.now(), party: p.party });
        app.others.set(p.id, o);
      }
      for (const [id, o] of app.others) if (performance.now() - o.seen > 2000) app.others.delete(id);
      return;
    case 'chat':
      app.chat.push({ from: m.from, text: m.text, party: m.party, at: Date.now() });
      if (app.chat.length > 30) app.chat.shift();
      return;
    case 'party': app.party = m.party; return panels.refresh();
    case 'parties': app.parties = m.list; return panels.refresh();
    case 'market': app.market = m.list; return panels.refresh();
    case 'codex': app.codex = m.list; app.generation = m.generation; return panels.refresh();
    case 'news':
      if (m.world) { app.world = m.world; app.generation = m.world.generation; }
      if (typeof m.nextEcoIn === 'number') app.nextEcoAt = Date.now() + m.nextEcoIn * 1000;
      if (m.items?.length) {
        const seen = new Set(app.news.map((n) => `${n.gen}:${n.text}`));
        for (const n of m.items) if (!seen.has(`${n.gen}:${n.text}`)) app.news.push(n);
        if (app.news.length > 120) app.news.splice(0, app.news.length - 120);
        if (m.stepped) toast(`生態系が第${m.world.generation}世代に進んだ`);
        for (const n of m.items) if (['apex', 'apexDown', 'apexWin', 'named'].includes(n.kind)) toast(n.text);
        if (app.pendingNameClose && m.items.some((n) => n.kind === 'named' && n.speciesId === app.pendingNameClose)) { app.pendingNameClose = null; panels.close(); }
      }
      return panels.refresh();
    case 'nameRight':
      if (!app.nameRights.some((r) => r.speciesId === m.speciesId)) app.nameRights.push(m);
      return;
    case 'dungeon:enter': return enterDungeon(m);
    case 'dungeon:floor': return onFloor(m.info);
    case 'dungeon:snap': return onSnap(m.snap, m.me);
    case 'dungeon:end': {
      enterTown(true);
      panels.show('result', m);
      return;
    }
    case 'toast': return toast(m.text);
    case 'error':
      if (app.scene === 'title') return panels.show('title', { ...panels.state, message: m.text, error: true });
      return toast(m.text, true);
    default:
  }
}

// ---------- 画面切り替え ----------
function enterTown(fromDungeon = false) {
  app.scene = 'town';
  app.d = null;
  if (fromDungeon || !app.town.placed) {
    app.town.x = fromDungeon ? 15 * 16 : TOWN.spawn.x;
    app.town.y = fromDungeon ? 13 * 16 : TOWN.spawn.y;
    app.town.placed = true;
  }
  if (panels.kind === 'title') panels.close();
  touch.hidden = !isTouch();
  hud.hidden = false;
  buildTownHud();
}

function enterDungeon(m) {
  panels.close();
  app.scene = 'dungeon';
  app.d = {
    area: m.area, raid: m.raid, apex: m.apex, info: null, monsters: new Map(), roster: new Map(),
    snaps: [], latest: null, me: null, pred: null, lastInput: 0, banner: { text: m.raid ? `ワールドレイド ${m.apex?.name || ''}` : m.area.name, t: 2.5 },
    stats: playerStats(app.me), lastAim: 0,
  };
  touch.hidden = !isTouch();
  buildDungeonHud();
}

function onFloor(info) {
  const d = app.d;
  if (!d) return;
  d.info = info;
  d.map = { ...info.map, tiles: info.map.tiles };
  d.monsters = new Map(info.monsters.map((x) => [x.id, x]));
  d.roster = new Map(info.roster.map((x) => [x.id, x]));
  d.snaps = [];
  d.pred = null;
  renderer.buildMap(d.map); // 描画は文字列（'0' 壁 / '1' 床）のまま使う
  d.banner = { text: d.map.raid ? `ワールドレイド ${d.apex?.name || ''}` : `${d.map.areaName} 地下${info.floor}階`, t: 2.2 };
}

function mapForCollision(m) {
  // 共有の当たり判定は数値の配列を前提にしているので変換する
  return { ...m, tiles: [...m.tiles].map(Number) };
}

function onSnap(snap, me) {
  const d = app.d;
  if (!d || !d.info) return;
  if (snap.mapVersion !== d.info.mapVersion) return;
  snap.at = performance.now();
  d.snaps.push(snap);
  if (d.snaps.length > 30) d.snaps.shift();
  d.latest = snap;
  d.me = me;
  if (!d.colMap) d.colMap = mapForCollision(d.map);
  if (d.colMapVersion !== d.info.mapVersion) { d.colMap = mapForCollision(d.map); d.colMapVersion = d.info.mapVersion; }
  for (const ev of snap.ev) onEvent(ev);
}

function onEvent(ev) {
  const d = app.d;
  const myId = app.me.id;
  switch (ev.t) {
    case 'hit': {
      const color = ev.a === 's' ? '#f8b800' : ev.a === 'w' ? '#9c9cb0' : '#fcfcfc';
      renderer.addNum(ev.x, ev.y, ev.v + (ev.a === 's' ? '!' : ''), color, ev.c || ev.a === 's');
      return;
    }
    case 'hurt': renderer.addNum(ev.x, ev.y, ev.v, '#fc6c6c'); if (ev.id === myId) d.hurtT = 0.15; return;
    case 'miss': renderer.addNum(ev.x, ev.y, 'MISS', '#9c9cb0'); return;
    case 'fx': renderer.addFx(ev); return;
    case 'kill': renderer.addFx({ k: 'puff', x: ev.x, y: ev.y, c: '#fcfcfc' }); d.monsters.delete(ev.id); return;
    case 'spawn': d.monsters.set(ev.m.id, ev.m); return;
    case 'drop': if (ev.to === myId && ev.r > 0) toast(`${ev.text} を拾った`, false, ev.r); return;
    case 'down': toast(`${nameOf(ev.id)}が倒れた！ 近くにいると助け起こせます`, true); return;
    case 'revive': toast(`${nameOf(ev.id)}が起き上がった`); return;
    case 'lost': toast(`${nameOf(ev.id)}は力尽きた`, true); return;
    case 'charm': toast(`身代わりの護符が${nameOf(ev.id)}を守った`); return;
    case 'escape': if (ev.id !== myId) toast(`${nameOf(ev.id)}が脱出した`); return;
    case 'bossDown': d.banner = { text: `${ev.name} を討伐した！`, t: 3 }; return;
    case 'wipe': d.banner = { text: '全滅……', t: 3 }; return;
    default:
  }
}

const nameOf = (id) => app.d?.roster.get(id)?.name || '仲間';
const isTouch = () => input.touchMode || matchMedia('(pointer: coarse)').matches;

// ---------- HUD ----------
function buildTownHud() {
  const raid = app.world?.apex;
  hud.innerHTML = `<div class="top">
      <div class="box" id="hud-me"></div>
      <div class="menu-btns">
        <button data-open="equip">装備</button><button data-open="craft">工房</button><button data-open="shop">道具屋</button>
        <button data-open="market">取引所</button><button data-open="codex">図鑑</button><button data-open="board">掲示板</button>
        ${app.offline ? '' : '<button data-open="party">パーティ</button>'}<button data-open="gate">出発</button>
        ${raid ? '<button data-open="raid" class="sel">レイド</button>' : ''}
      </div></div>
    <div class="prompt" id="hud-prompt" hidden></div>
    <div class="chatlog" id="hud-chat"></div>
    ${app.offline ? '' : '<form class="chatbar" id="chatbar"><input id="chat-input" maxlength="80" placeholder="チャット（Enter）" autocomplete="off"><button>送る</button></form>'}`;
  hud.querySelector('.menu-btns').addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) panels.show(b.dataset.open); });
  hud.querySelector('#chatbar')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = hud.querySelector('#chat-input');
    if (inp.value.trim()) app.send({ type: 'chat', text: inp.value, party: false });
    inp.value = '';
    inp.blur();
  });
  hud.lastRaid = !!raid;
}

function updateTownHud(near) {
  const me = app.me;
  const el = hud.querySelector('#hud-me');
  if (!el) return;
  const next = app.nextEcoAt ? Math.max(0, Math.round((app.nextEcoAt - Date.now()) / 1000)) : null;
  el.innerHTML = `${esc(me.name)} <span class="num">Lv${me.level}</span>・<span class="gold num">${me.gold}G</span><br>
    <span class="dim">第${app.generation ?? '-'}世代${next !== null ? `・次まで${Math.floor(next / 60)}:${String(next % 60).padStart(2, '0')}` : ''}${app.party ? `・隊 ${app.party.code}` : ''}</span>`;
  const pr = hud.querySelector('#hud-prompt');
  if (near) { pr.hidden = false; pr.textContent = `${near.label}（${isTouch() ? '「調べる」' : 'E'}）`; } else pr.hidden = true;
  const chat = hud.querySelector('#hud-chat');
  const recent = app.chat.filter((c) => Date.now() - c.at < 20000).slice(-5);
  chat.innerHTML = recent.map((c) => `<div><span class="${c.party ? 'ok' : 'gold'}">${esc(c.from)}</span> ${esc(c.text)}</div>`).join('');
  if (!!app.world?.apex !== hud.lastRaid) buildTownHud();
}

function buildDungeonHud() {
  hud.innerHTML = `<div class="top"><div class="box" id="hud-me"></div><div class="box" id="hud-loot"></div></div>
    <div class="center-msg" id="hud-banner"></div>
    <div class="prompt" id="hud-prompt" hidden></div>
    <div class="skills" id="hud-skills" ${isTouch() ? 'hidden' : ''}></div>`;
}

function updateDungeonHud(meEnt, near) {
  const d = app.d;
  const el = hud.querySelector('#hud-me');
  if (!el || !d.latest) return;
  const st = d.stats;
  const party = d.latest.p.filter((p) => p[0] !== app.me.id).slice(0, 7);
  const hp = meEnt ? meEnt.hp : 0, maxHp = meEnt ? meEnt.maxHp : st.maxHp;
  el.innerHTML = `${esc(d.map.raid ? 'ワールドレイド' : d.map.areaName)} <span class="num">B${d.info.floor}F</span>
    <div class="bar"><i style="width:${(100 * hp) / maxHp}%"></i></div><span class="num">${hp}/${maxHp}</span>
    ${party.length ? `<div class="party">${party.map((p) => `<div style="font-size:12px">${esc(nameOf(p[0]))}${p[6] & 1 ? ` <span class="bad">ダウン ${p[7]}</span>` : ''}<div class="bar ally"><i style="width:${(100 * p[4]) / p[5]}%"></i></div></div>`).join('')}</div>` : ''}`;
  const me = d.me || {};
  hud.querySelector('#hud-loot').innerHTML = `素材 <span class="num">${me.loot ?? 0}</span>・<span class="gold num">${me.gold ?? 0}G</span><br>薬 <span class="num">${me.potions ?? 0}</span>・護符 <span class="num">${me.charms ?? 0}</span>`;
  const sk = hud.querySelector('#hud-skills');
  if (sk && !sk.hidden) {
    const cd = me.cd || {};
    sk.innerHTML = `<div class="skill ${cd.s1 > 0 ? 'cd' : ''}">K 技1 ${st.skill1.ja}${cd.s1 > 0 ? ` <span class="num">${Math.ceil(cd.s1)}</span>` : ''}</div>
      <div class="skill ${cd.s2 > 0 ? 'cd' : ''}">L 技2 ${st.skill2.ja}${cd.s2 > 0 ? ` <span class="num">${Math.ceil(cd.s2)}</span>` : ''}</div>
      <div class="skill">Q 薬 ${me.potions ?? 0}</div>`;
  }
  const b = hud.querySelector('#hud-banner');
  b.textContent = d.banner && d.banner.t > 0 ? d.banner.text : '';
  const pr = hud.querySelector('#hud-prompt');
  if (near) { pr.hidden = false; pr.textContent = near; } else pr.hidden = true;
}

// ---------- 毎フレーム ----------
let last = performance.now();
let hudT = 0, townSendT = 0, time = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  hudT -= dt;
  try {
    if (app.scene === 'town') tickTown(dt);
    else if (app.scene === 'dungeon') tickDungeon(dt, now);
    else drawTitle();
  } catch (e) { console.error(e); }
  input.endFrame();
  requestAnimationFrame(frame);
}

function drawTitle() {
  renderer.begin(clampCam({ x: TOWN.w * 8 + Math.sin(time * 0.2) * 60, y: TOWN.h * 8 }, TOWN.w * 16, TOWN.h * 16));
  renderer.drawTown(time, false, null);
}

function tickTown(dt) {
  const t = app.town;
  const blocked = panels.open || document.activeElement?.tagName === 'INPUT';
  const mv = blocked ? { x: 0, y: 0 } : input.move();
  t.moving = Math.hypot(mv.x, mv.y) > 0.1;
  if (t.moving) { moveInTown(t, mv.x * 80 * dt, mv.y * 80 * dt); t.dir = Math.atan2(mv.y, mv.x); }
  townSendT -= dt;
  if (townSendT <= 0) { townSendT = 0.1; app.send({ type: 'town:move', x: t.x, y: t.y, dir: +t.dir.toFixed(2) }); }

  const raidOpen = !!app.world?.apex;
  let near = null;
  for (const s of SPOTS) {
    if (s.raidOnly && !raidOpen) continue;
    if (s.id === 'party' && app.offline) continue;
    if (Math.hypot(s.x - t.x, s.y - t.y) < 22) near = s;
  }
  if (!blocked && near && input.wasPressed('act')) panels.show(near.id);
  if (!panels.open && app.nameRights.length) {
    const r = app.nameRights.shift();
    if (!app.me.namingRights || app.me.namingRights.includes(r.speciesId)) panels.show('naming', r);
  }

  renderer.begin(clampCam(t, TOWN.w * 16, TOWN.h * 16));
  renderer.drawTown(time, raidOpen, near);
  const ents = [];
  for (const o of app.others.values()) {
    o.x += (o.tx - o.x) * Math.min(1, dt * 10);
    o.y += (o.ty - o.y) * Math.min(1, dt * 10);
    ents.push({ x: o.x, y: o.y, dir: o.dir, name: o.name, color: hashColor(o.name), moving: Math.hypot(o.tx - o.x, o.ty - o.y) > 0.5, weapon: 'sword' });
  }
  const st = playerStats(app.me);
  ents.push({ x: t.x, y: t.y, dir: t.dir, name: app.me.name, me: true, color: hashColor(app.me.name), moving: t.moving, weapon: st.weaponType, el: st.element });
  ents.sort((a, b) => a.y - b.y).forEach((e) => renderer.drawHero(e, time));
  renderer.drawFx(dt);
  if (hudT <= 0) { hudT = 0.2; updateTownHud(near); }
}

function clampCam(p, mw, mh) {
  const hw = renderer.w / 2, hh = renderer.h / 2;
  return {
    x: mw <= renderer.w ? mw / 2 : Math.max(hw, Math.min(mw - hw, p.x)),
    y: mh <= renderer.h ? mh / 2 : Math.max(hh, Math.min(mh - hh, p.y)),
  };
}

function hashColor(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 8;
}

function tickDungeon(dt, now) {
  const d = app.d;
  if (!d.info || !d.latest) {
    renderer.begin({ x: 0, y: 0 });
    renderer.text('よみこみ中…', renderer.w / 2, renderer.h / 2, '#fcfcfc', 10, 'jp');
    return;
  }
  if (d.banner) d.banner.t -= dt;
  d.hurtT = Math.max(0, (d.hurtT || 0) - dt);

  // サーバーの状態を少し遅らせて補間する
  const delay = app.offline ? 60 : 110;
  const rt = now - delay;
  let a = d.snaps[0], b = d.snaps[d.snaps.length - 1];
  for (let i = d.snaps.length - 1; i > 0; i--) if (d.snaps[i - 1].at <= rt) { a = d.snaps[i - 1]; b = d.snaps[i]; break; }
  const k = b.at === a.at ? 1 : Math.max(0, Math.min(1, (rt - a.at) / (b.at - a.at)));
  const lerpRows = (ra, rb) => {
    const prev = new Map(ra.map((r) => [r[0], r]));
    return rb.map((r) => { const p = prev.get(r[0]); return p ? [r[0], p[1] + (r[1] - p[1]) * k, p[2] + (r[2] - p[2]) * k, ...r.slice(3)] : r; });
  };
  const players = lerpRows(a.p, b.p);
  const monsters = lerpRows(a.m, b.m);
  const latestMe = d.latest.p.find((p) => p[0] === app.me.id);

  // 入力
  const mv = panels.open ? { x: 0, y: 0 } : input.move();
  const meRow = latestMe;
  if (meRow) {
    if (!d.pred) d.pred = { x: meRow[1], y: meRow[2] };
    const down = meRow[6] & 1;
    // 自分の移動だけは手元で先に動かす（通信の遅れを感じさせないため）
    if (!down) {
      const speed = d.stats.speed * (meRow[6] & 64 ? 1.6 : 1) * (meRow[9].includes('slow') ? 0.55 : 1) * (meRow[6] & 4 ? 0.6 : 1);
      if (!meRow[9].includes('freeze') && !(meRow[6] & 2)) moveCircle(d.colMap, d.pred, mv.x * speed * dt, mv.y * speed * dt, 6);
    }
    const ex = meRow[1] - d.pred.x, ey = meRow[2] - d.pred.y;
    const err = Math.hypot(ex, ey);
    if (err > 40 || down || meRow[6] & 2) { d.pred.x += ex * 0.5; d.pred.y += ey * 0.5; }
    else { d.pred.x += ex * Math.min(1, dt * 6); d.pred.y += ey * Math.min(1, dt * 6); }
  }
  const myPos = d.pred || (meRow ? { x: meRow[1], y: meRow[2] } : { x: 0, y: 0 });

  // 狙い：マウスがあればマウス、なければ近くの敵、なければ移動方向
  let aim;
  if (input.useMouseAim()) {
    aim = Math.atan2(input.mouse.y + renderer.cy - myPos.y, input.mouse.x + renderer.cx - myPos.x);
  } else {
    let best = null, bd = 110 * 110;
    for (const m of monsters) { const dd = (m[1] - myPos.x) ** 2 + (m[2] - myPos.y) ** 2; if (dd < bd) { bd = dd; best = m; } }
    if (best) aim = Math.atan2(best[2] - myPos.y, best[1] - myPos.x);
    else if (Math.hypot(mv.x, mv.y) > 0.2) aim = Math.atan2(mv.y, mv.x);
    else aim = d.lastAim;
  }
  d.lastAim = aim;
  if (now - d.lastInput > 45 && !panels.open) {
    d.lastInput = now;
    app.send({
      type: 'input', mx: +mv.x.toFixed(2), my: +mv.y.toFixed(2), aim: +aim.toFixed(2),
      atk: input.isHeld('atk'), s1: input.isHeld('s1') || input.wasPressed('s1'), s2: input.isHeld('s2') || input.wasPressed('s2'),
      dodge: input.isHeld('dodge') || input.wasPressed('dodge'), act: input.isHeld('act'), potion: input.isHeld('potion') || input.wasPressed('potion'),
    });
  }

  // 描画
  renderer.begin(myPos);
  renderer.drawMap();
  renderer.drawMarker(d.map.stairs, 'stairs', time);
  renderer.drawMarker(d.map.portal, 'portal', time);
  const ents = [];
  for (const m of monsters) {
    const info = d.monsters.get(m[0]);
    if (!info) continue;
    ents.push({ y: m[2], draw: () => renderer.drawMonster({ id: m[0], x: m[1], y: m[2], hp: m[3], maxHp: m[4], hurt: m[5] & 1, frozen: m[5] & 2, grounded: m[5] & 4, attacking: m[5] & 8, status: m[7] }, info, time) });
  }
  for (const p of players) {
    const r = d.roster.get(p[0]) || {};
    const isMe = p[0] === app.me.id;
    const x = isMe ? myPos.x : p[1], y = isMe ? myPos.y : p[2];
    const prev = d.prevPos?.get(p[0]);
    const moving = isMe ? Math.hypot(mv.x, mv.y) > 0.1 : prev ? Math.hypot(prev.x - x, prev.y - y) > 0.05 : false;
    ents.push({ y, draw: () => renderer.drawHero({ x, y, dir: isMe ? aim : p[3], name: isMe ? null : r.name, color: hashColor(r.name || ""), weapon: r.weapon, el: r.el, moving, down: p[6] & 1, dodge: p[6] & 2, attack: p[6] & 4, guard: p[6] & 32, haste: p[6] & 64, downT: p[7], revive: p[8], status: p[9], hurt: isMe && d.hurtT > 0 }, time) });
  }
  d.prevPos = new Map(players.map((p) => [p[0], { x: p[1], y: p[2] }]));
  ents.sort((x, y) => x.y - y.y).forEach((e) => e.draw());
  for (const pr of d.latest.pr) renderer.drawProjectile(pr);
  renderer.drawFx(dt);
  // ボスのHP
  const boss = monsters.find((m) => d.monsters.get(m[0])?.boss);
  if (boss) {
    const w = renderer.w * 0.6;
    renderer.ctx.fillStyle = '#000'; renderer.ctx.fillRect(renderer.w * 0.2 - 1, renderer.h - 15, w + 2, 6);
    renderer.ctx.fillStyle = '#d82800'; renderer.ctx.fillRect(renderer.w * 0.2, renderer.h - 14, w * boss[3] / boss[4], 4);
    renderer.text(d.monsters.get(boss[0]).name, renderer.w / 2, renderer.h - 22, '#f8b800', 9, 'jp');
  }
  renderer.drawPointer(d.map.stairs, '#fcfcfc', '下へ');
  renderer.drawPointer(d.map.portal, '#3cbcfc', '脱出');

  let near = null;
  const dist = (pt) => pt && Math.hypot(pt.x - myPos.x, pt.y - myPos.y);
  const key = isTouch() ? '「調べる」' : 'E';
  if (dist(d.map.stairs) < 24) near = players.length > 1 ? `${key}を押し続けると下の階へ（全員がそろうと進みます）` : `${key}で下の階へ`;
  if (dist(d.map.portal) < 24) near = `${key}で脱出（持ち帰る）`;
  if (meRow && meRow[6] & 1) near = `ダウン中… 仲間が近くに来ると起き上がれます（${meRow[7]}秒）`;
  if (hudT <= 0) { hudT = 0.1; updateDungeonHud(meRow ? { hp: meRow[4], maxHp: meRow[5] } : null, near); }
}

// ---------- 小物 ----------
function toast(text, err = false, rarity = 0) {
  const el = document.createElement('div');
  el.className = `t${err ? ' err' : ''}${rarity ? ` r${rarity}` : ''}`;
  el.textContent = text;
  toasts.appendChild(el);
  while (toasts.children.length > 5) toasts.firstChild.remove();
  setTimeout(() => el.remove(), 3300);
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

app.onPanelClosed = () => {};
panels.show('title');
requestAnimationFrame(frame);
window.__app = app; // デバッグ用
void ELEMENT_INFO;
