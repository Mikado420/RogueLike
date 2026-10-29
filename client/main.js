// クライアントの入口。タイトル → 町 → ダンジョン の画面切り替えと、毎フレームの更新を行う。
import { Renderer } from './render.js';
import { Input } from './input.js';
import { Panels } from './ui.js';
import { NetTransport, LocalTransport, defaultServerUrl, isStaticHost, hasSavedServer } from './net.js';
import { TOWN, SPOTS, moveInTown } from './town.js';
import { sfx, isMuted, setMuted } from './audio.js';
import { moveCircle } from '../shared/dungeon.js';
import { playerStats, WEAPON_TYPES } from '../shared/items.js';

const canvas = document.getElementById('screen');
const hud = document.getElementById('hud');
const touch = document.getElementById('touch');
const toasts = document.getElementById('toasts');
const minimap = document.getElementById('minimap');

const app = {
  transport: null,
  offline: false,
  serverUrl: defaultServerUrl(),
  staticHost: isStaticHost(),
  hasServer: hasSavedServer(),
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
  town: { x: TOWN.spawn.x, y: TOWN.spawn.y, dir: Math.PI / 2, moving: false },
  others: new Map(),
  d: null, // ダンジョンの状態
  pendingNameClose: null,
  pendingCraft: null,
  send(m) { this.transport?.send(m); },
};

const renderer = new Renderer(canvas);
const input = new Input(canvas);
const panels = new Panels(app);
input.blocked = () => panels.open;

// ---------- 起動・ログイン ----------
const tokenKey = () => (app.offline ? 'ed-token-offline' : `ed-token:${app.serverUrl}`);
const getToken = () => { try { return localStorage.getItem(tokenKey()); } catch { return null; } };
const setToken = (t) => { try { localStorage.setItem(tokenKey(), t); } catch { /* 保存できなくても続ける */ } };

app.startOnline = async () => {
  panels.show('title', { message: '接続しています…' });
  const t = new NetTransport(app.serverUrl);
  t.onStatus = (s) => {
    if (s === 'reconnecting') toast('接続が切れました。再接続しています…', true);
    if (s === 'reconnected') { toast('再接続しました'); t.send({ type: 'hello', token: getToken() }); }
  };
  try {
    await t.connect();
  } catch {
    panels.show('title', { message: `サーバー（${app.serverUrl}）に接続できませんでした。「ひとりで遊ぶ」か、接続先を確かめてください。`, error: true });
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
app.setServerUrl = (url) => {
  const u = url.trim();
  try { if (u) localStorage.setItem('ed-server-url', u); else localStorage.removeItem('ed-server-url'); } catch { /* 無視 */ }
  app.hasServer = !!u;
  app.serverUrl = u || defaultServerUrl();
};
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
    case 'profile':
      app.me = m.player;
      if (app.pendingCraft) {
        const made = app.me.equipment.find((e) => !app.pendingCraft.before.has(e.id));
        if (made) {
          if (app.pendingCraft.autoEquip) {
            app.send({ type: 'equip', id: made.id, slot: made.slot === 'acc' ? (app.me.equipped.acc1 ? 'acc2' : 'acc1') : undefined });
            toast(`${made.name}を作って装備した`);
          } else toast(`${made.name}を作った`);
          app.pendingCraft = null;
        }
      }
      return panels.refresh();
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
        if (app.pendingNameClose && m.items.some((n) => n.kind === 'named' && n.speciesId === app.pendingNameClose)) { app.pendingNameClose = null; panels.close(); sfx('rare'); }
      }
      return panels.refresh();
    case 'nameRight':
      if (!app.nameRights.some((r) => r.speciesId === m.speciesId)) app.nameRights.push(m);
      return;
    case 'dungeon:enter': return enterDungeon(m);
    case 'dungeon:floor': return onFloor(m.info);
    case 'dungeon:snap': return onSnap(m.snap, m.me);
    case 'dungeon:end':
      enterTown(true);
      panels.show('result', m);
      sfx(m.escaped ? 'rare' : 'down');
      return;
    case 'toast': return toast(m.text);
    case 'error':
      sfx('error');
      if (app.scene === 'title') return panels.show('title', { ...panels.state, message: m.text, error: true });
      return toast(m.text, true);
    default:
  }
}

// ---------- 画面切り替え ----------
function setTouchUi() {
  const on = input.touchMode;
  document.body.classList.toggle('touch-ui', on);
  touch.hidden = !on || app.scene === 'title' || panels.open;
  touch.classList.toggle('town', app.scene === 'town');
}

app.onPanelChanged = () => { setTouchUi(); input.reset(); };

function enterTown(fromDungeon = false) {
  app.scene = 'town';
  app.d = null;
  minimap.hidden = true;
  document.body.classList.add('ingame');
  if (fromDungeon || !app.town.placed) {
    app.town.x = fromDungeon ? 15 * 16 : TOWN.spawn.x;
    app.town.y = fromDungeon ? 13 * 16 : TOWN.spawn.y;
    app.town.placed = true;
  }
  if (panels.kind === 'title') panels.close();
  hud.hidden = false;
  buildTownHud();
  setTouchUi();
}

function enterDungeon(m) {
  panels.close();
  app.scene = 'dungeon';
  app.d = {
    area: m.area, raid: m.raid, apex: m.apex, info: null, monsters: new Map(), roster: new Map(),
    snaps: [], latest: null, me: null, pred: null, lastInput: 0, banner: null,
    stats: playerStats(app.me), lastAim: Math.PI / 2, cam: null, targetId: null, explored: null, lastHp: null,
  };
  minimap.hidden = false;
  buildDungeonHud();
  setTouchUi();
}

function onFloor(info) {
  const d = app.d;
  if (!d) return;
  d.info = info;
  d.map = { ...info.map };
  d.colMap = { ...info.map, tiles: [...info.map.tiles].map(Number) };
  d.monsters = new Map(info.monsters.map((x) => [x.id, x]));
  d.roster = new Map(info.roster.map((x) => [x.id, x]));
  d.snaps = [];
  d.pred = null;
  d.cam = null;
  d.explored = new Uint8Array(d.map.w * d.map.h);
  d.seen = { stairs: false, portal: false };
  minimap.width = d.map.w;
  minimap.height = d.map.h;
  renderer.buildMap(d.map);
  d.banner = { text: d.map.raid ? 'ワールドレイド' : `${d.map.areaName}`, sub: d.map.raid ? (d.apex?.name || '') : `地下${info.floor}階`, t: 2.2 };
  if (info.floor > 1) sfx('floor');
}

function onSnap(snap, me) {
  const d = app.d;
  if (!d || !d.info || snap.mapVersion !== d.info.mapVersion) return;
  snap.at = performance.now();
  d.snaps.push(snap);
  if (d.snaps.length > 30) d.snaps.shift();
  d.latest = snap;
  d.me = me;
  for (const ev of snap.ev) onEvent(ev);
}

function onEvent(ev) {
  const d = app.d;
  const myId = app.me.id;
  switch (ev.t) {
    case 'hit': {
      const color = ev.a === 's' ? '#f8b800' : ev.a === 'w' ? '#9c9cb0' : '#fcfcfc';
      renderer.addNum(ev.x, ev.y, ev.v + (ev.a === 's' ? '!' : ''), color, ev.c || ev.a === 's');
      sfx(ev.a === 's' ? 'strong' : ev.a === 'w' ? 'weak' : 'hit');
      if (ev.c) renderer.shake(1.5, 0.08);
      return;
    }
    case 'hurt':
      renderer.addNum(ev.x, ev.y, ev.v, '#fc6c6c');
      if (ev.id === myId) { d.hurtT = 0.15; renderer.shake(2.5, 0.15); sfx('hurt'); }
      return;
    case 'miss': renderer.addNum(ev.x, ev.y, 'MISS', '#9c9cb0'); return;
    case 'fx':
      renderer.addFx(ev);
      if (ev.k === 'potion') sfx('potion');
      else if (['ring', 'gale', 'ray', 'buff'].includes(ev.k)) sfx('skill');
      else if (ev.k === 'slash' || ev.k === 'thrust') sfx('swing');
      else if (ev.k === 'roar') sfx('boss');
      return;
    case 'kill': renderer.addFx({ k: 'puff', x: ev.x, y: ev.y, c: '#fcfcfc' }); d.monsters.delete(ev.id); sfx('kill'); return;
    case 'spawn': d.monsters.set(ev.m.id, ev.m); return;
    case 'drop':
      if (ev.to === myId && ev.r > 0) { toast(`${ev.text} を拾った`, false, ev.r); sfx('rare'); }
      else if (ev.to === myId) sfx('drop');
      return;
    case 'down': toast(`${nameOf(ev.id)}が倒れた！ そばに行くと助け起こせる`, true); sfx('down'); return;
    case 'revive': toast(`${nameOf(ev.id)}が起き上がった`); sfx('ok'); return;
    case 'lost': toast(`${nameOf(ev.id)}は力尽きた`, true); return;
    case 'charm': toast(`身代わりの護符が${nameOf(ev.id)}を守った`); sfx('rare'); return;
    case 'escape': if (ev.id !== myId) toast(`${nameOf(ev.id)}が脱出した`); return;
    case 'bossDown': d.banner = { text: `${ev.name} を討伐した！`, t: 3 }; sfx('rare'); return;
    case 'wipe': d.banner = { text: '全滅……', t: 3 }; return;
    default:
  }
}

const nameOf = (id) => app.d?.roster.get(id)?.name || '仲間';

// ---------- キー操作（メニュー） ----------
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if (app.scene !== 'town') return;
  if (!panels.open && (e.code === 'KeyM' || e.key === 'Escape' || e.code === 'Tab')) { e.preventDefault(); panels.show('menu'); }
  else if (panels.open && e.code === 'KeyM' && panels.closable()) { e.preventDefault(); panels.close(); }
  else if (!panels.open && e.code === 'KeyT' && !app.offline) { e.preventDefault(); hud.querySelector('#chat-input')?.focus(); }
});

// ---------- HUD ----------
function muteBtn() { return `<button class="mute" data-hud="mute" aria-label="音のオンオフ">${isMuted() ? '♪ OFF' : '♪ ON'}</button>`; }

function buildTownHud() {
  const raid = app.world?.apex;
  const kb = !input.touchMode;
  hud.innerHTML = `<div class="card" id="hud-me"></div>
    <div class="actions">
      ${raid ? '<button class="raid" data-hud="raid">レイド</button>' : ''}
      <button data-hud="menu">メニュー${kb ? '<kbd>M</kbd>' : ''}</button>
      <button class="primary" data-hud="gate">出発</button>
    </div>
    <div class="prompt" id="hud-prompt" hidden></div>
    <div class="chatlog" id="hud-chat"></div>
    ${app.offline ? '' : `<form class="chatbar" id="chatbar"><input id="chat-input" maxlength="80" placeholder="チャット${kb ? '（T）' : ''}" autocomplete="off" enterkeyhint="send"><button>送る</button></form>`}
    ${muteBtn()}`;
  hud.lastRaid = !!raid;
  hud.lastTouch = input.touchMode;
}

hud.addEventListener('click', (e) => {
  const b = e.target.closest('[data-hud]');
  if (!b) return;
  const k = b.dataset.hud;
  if (k === 'mute') { setMuted(!isMuted()); b.textContent = isMuted() ? '♪ OFF' : '♪ ON'; return; }
  panels.show(k);
});
hud.addEventListener('submit', (e) => {
  e.preventDefault();
  const inp = hud.querySelector('#chat-input');
  if (inp.value.trim()) app.send({ type: 'chat', text: inp.value, party: false });
  inp.value = '';
  inp.blur();
});

function updateTownHud(near) {
  const me = app.me;
  const el = hud.querySelector('#hud-me');
  if (!el) return;
  const next = app.nextEcoAt ? Math.max(0, Math.round((app.nextEcoAt - Date.now()) / 1000)) : null;
  el.innerHTML = `<div class="name"><span>${esc(me.name)}</span><span class="num">Lv${me.level}</span></div>
    <div class="sub"><span class="gold num">${me.gold}G</span>・素材 ${me.materials.length}・薬 ${me.potions}</div>
    <div class="sub">第${app.generation ?? '-'}世代${next !== null ? `・次の世代まで ${Math.floor(next / 60)}:${String(next % 60).padStart(2, '0')}` : ''}${app.party ? `・隊 ${app.party.code}` : ''}</div>`;
  const pr = hud.querySelector('#hud-prompt');
  if (near) { pr.hidden = false; pr.textContent = input.touchMode ? `${near.label}` : `${near.label}　E で入る`; } else pr.hidden = true;
  const chat = hud.querySelector('#hud-chat');
  const recent = app.chat.filter((c) => Date.now() - c.at < 20000).slice(-5);
  chat.innerHTML = recent.map((c) => `<div><span class="${c.party ? 'ok' : 'gold'}">${esc(c.from)}</span> ${esc(c.text)}</div>`).join('');
  if (!!app.world?.apex !== hud.lastRaid || input.touchMode !== hud.lastTouch) { buildTownHud(); setTouchUi(); }
}

function buildDungeonHud() {
  hud.innerHTML = `<div class="card" id="hud-me"></div>
    <div class="goal" id="hud-goal"></div>
    <div class="banner" id="hud-banner"></div>
    <div class="prompt" id="hud-prompt" hidden></div>
    <div class="skills" id="hud-skills" ${input.touchMode ? 'hidden' : ''}></div>`;
  hud.lastTouch = input.touchMode;
}

function hpBar(hp, max, extra = '') {
  const p = Math.max(0, Math.min(100, (100 * hp) / max));
  return `<div class="hpbar ${p < 30 ? 'low' : ''} ${extra}"><i class="lag" style="width:${p}%"></i><i style="width:${p}%"></i><span>${Math.max(0, hp)}/${max}</span></div>`;
}

function updateDungeonHud(meRow, near, goal) {
  const d = app.d;
  const el = hud.querySelector('#hud-me');
  if (!el || !d.latest) return;
  if (input.touchMode !== hud.lastTouch) { buildDungeonHud(); setTouchUi(); return; }
  const st = d.stats;
  const party = d.latest.p.filter((p) => p[0] !== app.me.id).slice(0, 7);
  const hp = meRow ? meRow[4] : 0, maxHp = meRow ? meRow[5] : st.maxHp;
  const me = d.me || {};
  el.innerHTML = `<div class="name"><span>${esc(d.map.raid ? 'ワールドレイド' : d.map.areaName)}</span><span class="num">B${d.info.floor}F</span></div>
    ${hpBar(hp, maxHp)}
    <div class="loot"><span>素材 <b>${me.loot ?? 0}</b></span><span class="gold">${me.gold ?? 0}G</span><span>薬 <b>${me.potions ?? 0}</b></span>${me.charms ? `<span>護符 <b>${me.charms}</b></span>` : ''}</div>
    ${party.length ? `<div class="party">${party.map((p) => `<div class="ally">${esc(nameOf(p[0]))}${p[6] & 1 ? ` <span class="bad">ダウン ${p[7]}秒</span>` : ''}${hpBar(p[4], p[5])}</div>`).join('')}</div>` : ''}`;
  hud.querySelector('#hud-goal').textContent = goal;
  const sk = hud.querySelector('#hud-skills');
  const cd = me.cd || {};
  if (sk && !sk.hidden) {
    const cell = (key, label, name, c, max) => `<div class="skill ${c > 0 ? '' : 'ready'}"><span class="k">${key}</span>${label} ${name}
      ${c > 0 ? `<i class="cdfill" style="width:${Math.min(100, (100 * c) / max)}%"></i><span class="cdnum">${Math.ceil(c)}</span>` : ''}</div>`;
    sk.innerHTML = cell('K', '技1', st.skill1.ja, cd.s1, st.skill1.cd) + cell('L', '技2', st.skill2.ja, cd.s2, st.skill2.cd) + cell('Q', '薬', `×${me.potions ?? 0}`, 0, 1) + cell('SPACE', '回避', '', cd.dodge, 0.9);
  }
  // タッチボタン
  const setCd = (sel, c, max, label) => {
    const b = touch.querySelector(sel);
    if (!b) return;
    b.querySelector('.cd')?.style.setProperty('--p', c > 0 ? Math.min(100, (100 * c) / max) : 0);
    b.classList.toggle('ready', !(c > 0));
    if (label) b.querySelector('.lbl').textContent = label;
  };
  setCd('.s1', cd.s1, st.skill1.cd, st.skill1.ja);
  setCd('.s2', cd.s2, st.skill2.cd, st.skill2.ja);
  setCd('.dodge', cd.dodge, 0.9);
  const pc = touch.querySelector('.potion .cnt');
  if (pc) pc.textContent = me.potions ?? 0;
  const b = hud.querySelector('#hud-banner');
  if (d.banner && d.banner.t > 0) { b.innerHTML = `${esc(d.banner.text)}${d.banner.sub ? `<small>${esc(d.banner.sub)}</small>` : ''}`; b.style.opacity = Math.min(1, d.banner.t * 2); }
  else b.innerHTML = '';
  const pr = hud.querySelector('#hud-prompt');
  if (near) { pr.hidden = false; pr.textContent = near; } else pr.hidden = true;
}

function setActButton(label) {
  const b = touch.querySelector('.act');
  if (!b) return;
  b.hidden = !label;
  if (label) b.querySelector('.lbl').textContent = label;
}

// ---------- 毎フレーム ----------
let last = performance.now();
let hudT = 0, townSendT = 0, time = 0, mapT = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  hudT -= dt;
  mapT -= dt;
  renderer.tickShake(dt);
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
  if (t.moving) { moveInTown(t, mv.x * 96 * dt, mv.y * 96 * dt); t.dir = Math.atan2(mv.y, mv.x); }
  townSendT -= dt;
  if (townSendT <= 0) { townSendT = 0.1; app.send({ type: 'town:move', x: t.x, y: t.y, dir: +t.dir.toFixed(2) }); }

  const raidOpen = !!app.world?.apex;
  let near = null, nd = 26;
  for (const s of SPOTS) {
    if (s.raidOnly && !raidOpen) continue;
    if (s.id === 'party' && app.offline) continue;
    const dd = Math.hypot(s.x - t.x, s.y - t.y);
    if (dd < nd) { nd = dd; near = s; }
  }
  setActButton(near && !panels.open ? `${near.label}へ` : null);
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
  const meRow = d.latest.p.find((p) => p[0] === app.me.id);

  // 自分の移動は手元で先に動かす（通信の遅れを感じさせないため）
  const mv = panels.open ? { x: 0, y: 0 } : input.move();
  if (meRow) {
    if (!d.pred) d.pred = { x: meRow[1], y: meRow[2] };
    const down = meRow[6] & 1;
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

  // 狙い：マウスがあればマウス。なければ近くの敵を自動で狙う（一度決めた相手はしばらく追い続ける）
  let aim;
  let target = null;
  const mouseAim = input.useMouseAim();
  if (!mouseAim) {
    const range2 = (r) => r * r;
    target = monsters.find((m) => m[0] === d.targetId && (m[1] - myPos.x) ** 2 + (m[2] - myPos.y) ** 2 < range2(170));
    if (!target) {
      let bd = range2(140);
      for (const m of monsters) { const dd = (m[1] - myPos.x) ** 2 + (m[2] - myPos.y) ** 2; if (dd < bd) { bd = dd; target = m; } }
    }
    d.targetId = target?.[0] ?? null;
  }
  if (mouseAim) aim = Math.atan2(input.mouse.y + renderer.cy - myPos.y, input.mouse.x + renderer.cx - myPos.x);
  else if (target) aim = Math.atan2(target[2] - myPos.y, target[1] - myPos.x);
  else if (Math.hypot(mv.x, mv.y) > 0.2) aim = Math.atan2(mv.y, mv.x);
  else aim = d.lastAim;
  d.lastAim = aim;

  if (now - d.lastInput > 45 && !panels.open) {
    d.lastInput = now;
    app.send({
      type: 'input', mx: +mv.x.toFixed(2), my: +mv.y.toFixed(2), aim: +aim.toFixed(2),
      atk: input.isHeld('atk') || input.wasPressed('atk'), s1: input.isHeld('s1') || input.wasPressed('s1'), s2: input.isHeld('s2') || input.wasPressed('s2'),
      dodge: input.isHeld('dodge') || input.wasPressed('dodge'), act: input.isHeld('act') || input.wasPressed('act'), potion: input.isHeld('potion') || input.wasPressed('potion'),
    });
    if (input.wasPressed('dodge') && !(d.me?.cd?.dodge > 0)) sfx('dodge');
  }

  // カメラ：なめらかに追いかけ、進む方向を少し先まで見せる
  const look = { x: myPos.x + mv.x * 18, y: myPos.y + mv.y * 14 };
  if (!d.cam) d.cam = { ...look };
  d.cam.x += (look.x - d.cam.x) * Math.min(1, dt * 8);
  d.cam.y += (look.y - d.cam.y) * Math.min(1, dt * 8);
  renderer.begin(clampCam(d.cam, d.map.w * 16, d.map.h * 16));
  renderer.drawMap();
  renderer.drawMarker(d.map.stairs, 'stairs', time);
  renderer.drawMarker(d.map.portal, 'portal', time);
  if (target) {
    const info = d.monsters.get(target[0]);
    if (info) renderer.drawTarget(target[1], target[2], info.boss ? 18 : 6 + info.g.size * 4, time);
  }
  const wt = WEAPON_TYPES[d.stats.weaponType];
  if (meRow && !(meRow[6] & 1)) renderer.drawAim(myPos.x, myPos.y, aim, wt.reach || 40);
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
    ents.push({ y, draw: () => renderer.drawHero({ x, y, dir: isMe ? aim : p[3], name: isMe ? null : r.name, color: hashColor(r.name || ''), weapon: r.weapon, el: r.el, moving, down: p[6] & 1, dodge: p[6] & 2, attack: p[6] & 4, guard: p[6] & 32, haste: p[6] & 64, downT: p[7], revive: p[8], status: p[9], hurt: isMe && d.hurtT > 0 }, time) });
  }
  d.prevPos = new Map(players.map((p) => [p[0], { x: p[1], y: p[2] }]));
  ents.sort((x, y) => x.y - y.y).forEach((e) => e.draw());
  for (const pr of d.latest.pr) renderer.drawProjectile(pr);
  renderer.drawFx(dt);
  const boss = monsters.find((m) => d.monsters.get(m[0])?.boss);
  if (boss) {
    const w = renderer.w * 0.6;
    const y = renderer.h - (input.touchMode ? renderer.h * 0.45 : 26);
    renderer.ctx.fillStyle = '#000'; renderer.ctx.fillRect(renderer.w * 0.2 - 1, y, w + 2, 6);
    renderer.ctx.fillStyle = '#d82800'; renderer.ctx.fillRect(renderer.w * 0.2, y + 1, w * boss[3] / boss[4], 4);
    renderer.text(d.monsters.get(boss[0]).name, renderer.w / 2, y - 7, '#f8b800', 9, 'jp');
  }

  // 探索済みの範囲を広げる
  const T = 16, R = 7;
  const tx = Math.floor(myPos.x / T), ty = Math.floor(myPos.y / T);
  for (let y = ty - R; y <= ty + R; y++) for (let x = tx - R; x <= tx + R; x++) {
    if (x >= 0 && y >= 0 && x < d.map.w && y < d.map.h && (x - tx) ** 2 + (y - ty) ** 2 <= R * R) d.explored[y * d.map.w + x] = 1;
  }
  const isSeen = (pt) => pt && d.explored[Math.floor(pt.y / T) * d.map.w + Math.floor(pt.x / T)];
  if (isSeen(d.map.stairs) && !d.seen.stairs) { d.seen.stairs = true; toast('階段を見つけた'); }
  if (isSeen(d.map.portal) && !d.seen.portal) d.seen.portal = true;
  if (mapT <= 0) { mapT = 0.1; drawMinimap(players, monsters, myPos); }

  // 目的と案内
  const dist = (pt) => pt && Math.hypot(pt.x - myPos.x, pt.y - myPos.y);
  const key = input.touchMode ? '' : '（E）';
  let near = null, act = null;
  if (dist(d.map.stairs) < 26) { near = players.length > 1 ? `全員が階段の上で「調べる」と下の階へ${key}` : `下の階へ進む${key}`; act = '下へ'; }
  if (dist(d.map.portal) < 26) { near = `脱出して素材を持ち帰る${key}`; act = '脱出'; }
  if (meRow && meRow[6] & 1) { near = `ダウン中… 仲間がそばに来ると起き上がれる（${meRow[7]}秒）`; act = null; }
  if (meRow && meRow[6] & 16) near = 'ほかの仲間が階段に来るのを待っています…';
  setActButton(act);
  const goal = d.map.raid ? '頂点捕食者を倒せ' : d.seen.stairs ? '階段で下へ進むか、魔法陣で脱出する' : '階段と脱出の魔法陣を探そう（ミニマップ右上）';
  if (hudT <= 0) { hudT = 0.1; updateDungeonHud(meRow, near, goal); }
}

function drawMinimap(players, monsters, myPos) {
  const d = app.d;
  const c = minimap.getContext('2d');
  const { w, h } = d.map;
  const img = c.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    if (!d.explored[i]) continue;
    const floor = d.map.tiles[i] === '1';
    const o = i * 4;
    img.data[o] = floor ? 92 : 30; img.data[o + 1] = floor ? 92 : 30; img.data[o + 2] = floor ? 112 : 44; img.data[o + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  const dot = (pt, color, s = 1) => { if (!pt) return; c.fillStyle = color; c.fillRect(Math.floor(pt.x / 16) - (s >> 1), Math.floor(pt.y / 16) - (s >> 1), s, s); };
  if (d.seen.stairs) dot(d.map.stairs, '#fcfcfc', 2);
  if (d.seen.portal) dot(d.map.portal, '#3cbcfc', 2);
  for (const m of monsters) if (Math.hypot(m[1] - myPos.x, m[2] - myPos.y) < 160) dot({ x: m[1], y: m[2] }, '#fc4c3c');
  for (const p of players) if (p[0] !== app.me.id) dot({ x: p[1], y: p[2] }, '#58d854', 2);
  dot(myPos, Math.floor(time * 4) % 2 ? '#f8b800' : '#fcfcfc', 2);
}

// ---------- 小物 ----------
function toast(text, err = false, rarity = 0) {
  const el = document.createElement('div');
  el.className = `t${err ? ' err' : ''}${rarity ? ` r${rarity}` : ''}`;
  el.textContent = text;
  toasts.appendChild(el);
  while (toasts.children.length > 3) toasts.firstChild.remove();
  setTimeout(() => el.remove(), 3300);
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

panels.show('title');
setTouchUi();
requestAnimationFrame(frame);
window.__app = app; // デバッグ用
