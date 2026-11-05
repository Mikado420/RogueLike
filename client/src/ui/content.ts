import { api } from '../net/api';

/** タイムアタックのランキング（開くたびに読み込む） */
const rankings = new Map<string, { time: number; names: string }[]>();
setInterval(() => rankings.clear(), 60_000);

import {
  CONTENT, DIFFICULTIES, canStartTower, codexPct, codexTotals, contribution, facilityCost, facilityLevel, invasionWindow,
  missionProgress, nextInvasionAt, txt, upkeepCost, baseActive, baseOf, dayIndex, ensureMissions, type ModKey,
} from '../../../shared/src';
import { btn, h, kv } from './dom';
import { modText, type Ctx } from './ctx';
import { extraBoardTabs, type NpcPanels, type NpcState } from './npc';
import type { Menu } from './menu';

/** M5 の画面（ダンジョン・塔・レイドの門、拠点、掲示板のタブ、図鑑・実績） */

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const hhmm = (ms: number) => { const d = new Date(ms); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };

function diffPicker(st: NpcState, onPick: (d: string) => void) {
  const row = h('div', 'seg');
  if (!st.tab) st.tab = 'normal';
  for (const d of DIFFICULTIES) {
    row.append(btn(CONTENT.difficulties[d].name, () => { st.tab = d; onPick(d); st.refresh(); }, `seg-btn${st.tab === d ? ' on' : ''}`));
  }
  return row;
}

export function registerContentPanels(npc: NpcPanels, menu: Menu, ctx: Ctx) {
  npc.register('dungeon', (c, body, _n, st) => {
    const gate = c.world.area.npcs.find((x) => x.id === st.npcId);
    const id = gate?.data ?? '';
    const def = CONTENT.dungeons.dungeons[id];
    if (!def) return;
    body.append(h('div', 'd-name', def.name));
    body.append(kv(txt('gate.difficulty'), ''));
    body.append(diffPicker(st, () => {}));
    const d = st.tab as keyof typeof CONTENT.difficulties;
    const dd = CONTENT.difficulties[d];
    body.append(kv(txt('gate.level'), String(def.level + dd.levelBonus)));
    const rec = c.me().account.records.timeAttack[`${id}:${d}`];
    if (rec?.length) body.append(kv(txt('gate.best'), `${fmtTime(rec[0].time)}  ${rec[0].char}`));
    // サーバーのランキング（全員の記録）
    const course = `${id}:${d}`;
    const rk = rankings.get(course);
    if (!rk) {
      rankings.set(course, []);
      void api.get<{ list: { time: number; names: string }[] }>(`/api/ranking?course=${encodeURIComponent(course)}`).then((r) => { rankings.set(course, r.list); c.modal.refresh(); }).catch(() => {});
    } else if (rk.length) {
      body.append(h('div', 'sub-title', txt('gate.ranking')));
      rk.slice(0, 5).forEach((r, i) => body.append(kv(`${i + 1}`, `${fmtTime(r.time)}  ${r.names}`)));
    }
    const acts = h('div', 'set-actions');
    acts.append(btn(txt('gate.enter'), () => c.send({ type: 'enterDungeon', dungeon: id, difficulty: d }), 'btn primary'));
    acts.append(btn(txt('gate.match'), () => c.send({ type: 'matchDungeon', dungeon: id, difficulty: d }), 'btn'));
    acts.append(btn(txt('gate.matchCancel'), () => c.send({ type: 'matchDungeon', dungeon: id, difficulty: d, cancel: true }), 'btn'));
    body.append(acts);
  });

  npc.register('tower', (c, body) => {
    const p = c.me();
    const t = CONTENT.tower;
    body.append(kv(txt('tower.best'), `${p.char.tower.best}F`));
    body.append(h('div', 'sub-title', txt('tower.start')));
    const row = h('div', 'look-row');
    for (let f = 1; f <= p.char.tower.best + 1; f += t.checkpointEvery) {
      if (!canStartTower(c.world, p, f)) continue;
      row.append(btn(`${f}F`, () => c.send({ type: 'enterTower', floor: f }), 'btn'));
    }
    body.append(row);
  });

  npc.register('raid', (c, body, _n, st) => {
    for (const [id, r] of Object.entries(CONTENT.raids)) {
      body.append(h('div', 'd-name', r.name));
      body.append(kv(txt('npc.need'), `${txt('stat.level')} ${r.minLevel}`));
      body.append(kv(txt('raid.limit'), fmtTime(r.timeLimit)));
      body.append(diffPicker(st, () => {}));
      const d = st.tab as keyof typeof CONTENT.difficulties;
      body.append(kv(txt('gate.level'), String(r.level + CONTENT.difficulties[d].levelBonus)));
      const b = btn(txt('gate.enter'), () => c.send({ type: 'enterRaid', raid: id, difficulty: d }), 'btn primary');
      b.disabled = c.me().char.level < r.minLevel;
      body.append(b);
    }
  });

  npc.register('base', (c, body) => {
    const acc = baseOf(c.me());
    const ch = c.me().char;
    const active = baseActive(acc, CONTENT, c.world.clock);
    const up = upkeepCost(acc, CONTENT);
    const head = h('div', 'storage-head');
    head.append(kv(txt('base.upkeep'), `${up.toLocaleString()} G  ${active ? txt('base.active') : txt('base.inactive')}`));
    const pay = btn(txt('base.pay'), () => c.send({ type: 'payUpkeep' }), 'mini');
    pay.disabled = active || ch.gold < up;
    head.append(pay);
    body.append(head);
    for (const [id, f] of Object.entries(CONTENT.base.facilities)) {
      const lv = facilityLevel(acc, id);
      const sec = h('div', 'npc-sec');
      sec.append(h('div', 'sub-title', `${f.name}  Lv ${lv}/${f.max}`));
      const fx = h('div', 'mods');
      for (const [k, v] of Object.entries(f.mods ?? {})) fx.append(h('span', 'mod', modText(k as ModKey, (v as number) * Math.max(1, lv))));
      for (const k of ['storage', 'refineRate', 'craftBonus', 'foodDuration'] as const) if (f[k]) fx.append(h('span', 'mod', `${txt(`base.${k}`)} +${(f[k] ?? 0) * Math.max(1, lv)}`));
      sec.append(fx);
      const cost = facilityCost(CONTENT, id, lv + 1);
      if (cost) {
        const line = h('div', 'cost-line');
        line.append(h('span', '', `${cost.gold.toLocaleString()} G`));
        let ok = ch.gold >= cost.gold;
        for (const [m, n] of Object.entries(cost.mats)) {
          const have = ch.bag[m] ?? 0;
          if (have < n) ok = false;
          line.append(h('span', have < n ? 'bad' : '', `${CONTENT.materials[m]?.name ?? m} ${have}/${n}`));
        }
        sec.append(line);
        const b = btn(lv === 0 ? txt('base.build') : txt('base.upgrade'), () => c.send({ type: 'buildFacility', facility: id }), 'btn primary');
        b.disabled = !ok;
        sec.append(b);
      }
      body.append(sec);
    }
  });

  extraBoardTabs.push({ id: 'missions', label: txt('board.missions'), render: (c, body) => renderMissions(c, body) });
  extraBoardTabs.push({ id: 'invasion', label: txt('board.invasion'), render: (c, body) => {
    const w = c.world;
    const win = invasionWindow(w);
    body.append(kv(win.active ? txt('invasion.now') : txt('invasion.next'), hhmm(win.active ? win.start : nextInvasionAt(w))));
    body.append(kv(txt('invasion.points'), contribution(w, c.me()).toLocaleString()));
    const tiers = h('div', 'shop-list');
    CONTENT.invasion.tiers.forEach((t) => {
      const r = h('div', 'shop-row');
      r.append(h('span', 'name', `${t.min.toLocaleString()}+`), h('span', 'price', `${t.gold.toLocaleString()} G`));
      tiers.append(r);
    });
    body.append(tiers);
  } });
  extraBoardTabs.push({ id: 'ranking', label: txt('board.ranking'), render: (c, body) => {
    for (const [id, d] of Object.entries(CONTENT.dungeons.dungeons)) {
      for (const diff of DIFFICULTIES) {
        const rec = c.me().account.records.timeAttack[`${id}:${diff}`];
        if (!rec?.length) continue;
        const sec = h('div', 'npc-sec');
        sec.append(h('div', 'sub-title', `${d.name}  ${CONTENT.difficulties[diff].name}`));
        rec.forEach((r, i) => sec.append(kv(`${i + 1}. ${r.char}`, fmtTime(r.time))));
        body.append(sec);
      }
    }
  } });

  menu.extraTabs.push({ id: 'codex', label: txt('menu.codex'), render: (body) => renderCodex(ctx, body) });
  menu.extraTabs.push({ id: 'records', label: txt('menu.records'), render: (body) => renderRecords(ctx, body) });
  menu.extraTabs.push({ id: 'missions', label: txt('board.missions'), render: (body) => renderMissions(ctx, body) });
}

function renderMissions(c: Ctx, body: HTMLElement) {
  const p = c.me();
  ensureMissions(c.world, p);
  for (const kind of ['daily', 'weekly'] as const) {
    const sec = h('div', 'npc-sec');
    sec.append(h('div', 'sub-title', txt(`mission.${kind}`)));
    (kind === 'daily' ? p.char.missions.daily : p.char.missions.weekly).forEach((m, i) => {
      const row = h('div', 'mission-row');
      const prog = missionProgress(p.char, m);
      row.append(h('span', 'name', txt(`mission.${m.id}`, m.n)));
      const bar = h('div', 'mbar');
      const fill = h('div', 'mfill');
      fill.style.width = `${(prog / m.n) * 100}%`;
      bar.append(fill);
      row.append(bar, h('span', 'have', `${prog}/${m.n}`));
      const b = btn(m.claimed ? txt('mission.done') : txt('mission.claim'), () => c.send({ type: 'claimMission', kind, index: i }), 'mini');
      b.disabled = m.claimed || prog < m.n;
      row.append(b);
      sec.append(row);
    });
    body.append(sec);
  }
  void dayIndex;
}

function renderCodex(c: Ctx, body: HTMLElement) {
  const ch = c.me().char;
  const pct = codexPct(ch, CONTENT);
  const t = codexTotals(CONTENT);
  body.append(kv(txt('codex.rate'), `${pct}%`));
  const th = h('div', 'mods');
  for (const x of CONTENT.codex.thresholds) {
    const s = h('span', `mod${pct >= x.pct ? '' : ' off'}`, `${x.pct}%: ${Object.entries(x.mods).map(([k, v]) => modText(k as ModKey, v as number)).join(' ')}`);
    th.append(s);
  }
  body.append(th);
  const sec = (title: string, ids: string[], name: (id: string) => string, known: (id: string) => number) => {
    const box = h('div', 'npc-sec');
    box.append(h('div', 'sub-title', `${title}  ${ids.filter((id) => known(id) > 0).length}/${ids.length}`));
    const grid = h('div', 'codex-grid');
    for (const id of ids) {
      const k = known(id);
      grid.append(h('span', `codex-cell${k ? ' on' : ''}`, k ? `${name(id)}${k > 1 ? ` ×${k}` : ''}` : '？？？'));
    }
    box.append(grid);
    body.append(box);
  };
  const mons = Object.keys(CONTENT.monsters).filter((id) => !(CONTENT.monsters[id].tags ?? []).includes('dummy') && CONTENT.monsters[id].drops !== 'none');
  sec(txt('codex.monsters'), mons, (id) => CONTENT.monsters[id].name, (id) => ch.codex.monsters[id] ?? 0);
  sec(txt('codex.items'), Object.keys(CONTENT.equipment.bases), (id) => CONTENT.equipment.bases[id].name, (id) => ch.codex.items[id] ?? 0);
  sec(txt('codex.materials'), Object.keys(CONTENT.materials), (id) => CONTENT.materials[id].name, (id) => ch.codex.materials[id] ?? 0);
  void t;
}

function renderRecords(c: Ctx, body: HTMLElement) {
  const ch = c.me().char;
  const ts = h('div', 'npc-sec');
  ts.append(h('div', 'sub-title', txt('records.titles')));
  const row = h('div', 'look-row');
  row.append(btn(txt('records.none'), () => c.send({ type: 'equipTitle', title: null }), `look-btn${ch.titles.equipped === null ? ' on' : ''}`));
  for (const id of ch.titles.unlocked) {
    const t = CONTENT.titles[id];
    if (!t) continue;
    const b = btn(t.name, () => c.send({ type: 'equipTitle', title: id }), `look-btn${ch.titles.equipped === id ? ' on' : ''}`);
    b.title = Object.entries(t.mods).map(([k, v]) => modText(k as ModKey, v as number)).join(' ');
    row.append(b);
  }
  ts.append(row);
  if (ch.titles.equipped) {
    const fx = h('div', 'mods');
    for (const [k, v] of Object.entries(CONTENT.titles[ch.titles.equipped]?.mods ?? {})) fx.append(h('span', 'mod', modText(k as ModKey, v as number)));
    ts.append(fx);
  }
  body.append(ts);
  const as = h('div', 'npc-sec');
  as.append(h('div', 'sub-title', `${txt('records.achievements')}  ${Object.keys(ch.achievements).length}/${CONTENT.achievements.length}`));
  for (const a of CONTENT.achievements) {
    const done = !!ch.achievements[a.id];
    const r = h('div', `mission-row${done ? ' done' : ''}`);
    r.append(h('span', 'name', a.name));
    const prog = Math.min(a.n, ch.counters[a.counter] ?? 0);
    const bar = h('div', 'mbar');
    const fill = h('div', 'mfill');
    fill.style.width = `${(prog / a.n) * 100}%`;
    bar.append(fill);
    r.append(bar, h('span', 'have', `${prog}/${a.n}`));
    if (a.title) r.append(h('span', 'tag', CONTENT.titles[a.title]?.name ?? ''));
    as.append(r);
  }
  body.append(as);
}
