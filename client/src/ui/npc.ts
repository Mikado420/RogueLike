import {
  CONTENT, PRIMARY_STATS, bagInfo, canRebirth, forecast, nextFieldBossAt, crystalFits, refineCost, respecCost, sellPrice, storageExpandCost, txt,
  type Item,
} from '../../../shared/src';
import { rarityColor } from '../colors';
import { btn, h, kv } from './dom';
import type { Ctx } from './ctx';
import { itemCell, itemInfo } from './itemview';

/** NPC の役割ごとの画面。後のマイルストーンで役割を足す */
export type NpcRenderer = (ctx: Ctx, body: HTMLElement, npc: string, state: NpcState) => void;
export interface NpcState { tab: string; sel: number | string | null; refresh: () => void; npcId: number }

export class NpcPanels {
  private renderers: Record<string, NpcRenderer> = {
    memory: renderMemory,
    rebirth: renderRebirth,
    shop: renderShop,
    smith: renderSmith,
    storage: renderStorage,
    board: renderBoard,
    travel: renderTravel,
  };
  private state: NpcState;
  npc: string | null = null;

  constructor(private ctx: Ctx) {
    this.state = { tab: '', sel: null, refresh: () => this.refresh(), npcId: -1 };
  }

  register(role: string, r: NpcRenderer) { this.renderers[role] = r; }

  get isOpen() { return this.ctx.modal.kind === 'npc'; }

  open(npc: string, npcId = -1) {
    const def = CONTENT.npcs[npc];
    const r = def && this.renderers[def.role];
    if (!r) return;
    this.npc = npc;
    this.state.tab = '';
    this.state.sel = null;
    this.state.npcId = npcId;
    this.ctx.modal.open('npc', def.name, (body) => r(this.ctx, body, npc, this.state));
  }

  refresh() {
    if (this.isOpen) this.ctx.modal.refresh();
  }
}

function renderMemory(ctx: Ctx, body: HTMLElement) {
  const ch = ctx.me().char;
  const sec = h('div', 'npc-sec');
  sec.append(h('div', 'sub-title', txt('npc.respec')));
  sec.append(kv(txt('npc.cost'), `${respecCost(ch, CONTENT).toLocaleString()} G`));
  const b = btn(txt('npc.respec'), () => ctx.send({ type: 'respec' }), 'btn primary');
  b.disabled = ch.gold < respecCost(ch, CONTENT);
  sec.append(b);
  body.append(sec);

  const bs = h('div', 'npc-sec');
  bs.append(h('div', 'sub-title', txt('npc.builds')));
  for (let i = 0; i < CONTENT.balance.builds.slots; i++) {
    const bd = ch.builds[i];
    const row = h('div', 'build-row');
    const info = h('div', 'build-info');
    info.append(h('b', '', `${i + 1}`));
    if (bd) {
      const stats = PRIMARY_STATS.filter((s) => bd.stats[s] > 0).map((s) => `${txt(`stat.${s}`)}${bd.stats[s]}`).join(' ');
      const skills = Object.values(bd.skills).reduce((a, v) => a + v, 0);
      const wuid = bd.equipment.weapon;
      const weapon = [...ch.inventory, ...Object.values(ch.equipment)].find((it) => it && it.uid === wuid);
      info.append(h('span', '', `${weapon ? weapon.name : ''}  ${stats}  ${txt('skill.sp')}${skills}`));
    } else {
      info.append(h('span', 'muted', '—'));
    }
    row.append(info);
    row.append(btn(txt('npc.save'), () => ctx.send({ type: 'saveBuild', slot: i }), 'mini'));
    const load = btn(txt('npc.load'), () => ctx.send({ type: 'loadBuild', slot: i }), 'mini');
    load.disabled = !bd;
    row.append(load);
    bs.append(row);
  }
  body.append(bs);
}

function renderRebirth(ctx: Ctx, body: HTMLElement) {
  const ch = ctx.me().char;
  const rb = CONTENT.balance.rebirth;
  const sec = h('div', 'npc-sec');
  sec.append(kv(txt('stat.rebirths'), `${ch.rebirths} / ${rb.max}`));
  sec.append(kv(txt('npc.need'), `${txt('stat.level')} ${CONTENT.balance.progression.maxLevel}`));
  sec.append(kv(txt('npc.bonus'), `${txt('stat.points')} +${rb.statPoints}  ${txt('skill.sp')} +${rb.skillPoints}  ${txt('stat.exp')} +${rb.expPct}%`));
  const err = canRebirth(ch, CONTENT);
  const b = btn(txt('npc.rebirth'), () => ctx.send({ type: 'rebirth' }), 'btn primary');
  b.disabled = !!err;
  sec.append(b);
  body.append(sec);
}

function renderShop(ctx: Ctx, body: HTMLElement, npc: string, st: { tab: string; sel: number | string | null; refresh: () => void }) {
  const ch = ctx.me().char;
  const shopId = CONTENT.npcs[npc].shop ?? 'general';
  const shop = CONTENT.shops[shopId];
  if (!st.tab) st.tab = 'buy';
  const tabs = h('div', 'tabs');
  for (const t of ['buy', 'sell']) tabs.append(btn(txt(`npc.${t}`), () => { st.tab = t; st.sel = null; st.refresh(); }, `tab${st.tab === t ? ' on' : ''}`));
  body.append(tabs);
  body.append(kv(txt('stat.gold'), `${ch.gold.toLocaleString()} G`, 'stat gold-row'));
  if (st.tab === 'buy') {
    const list = h('div', 'shop-list');
    for (const id of shop?.items ?? []) {
      const md = CONTENT.materials[id];
      if (!md) continue;
      const row = h('div', 'shop-row');
      const dot = h('i', 'dot');
      dot.style.background = md.color;
      row.append(dot, h('span', 'name', md.name), h('span', 'price', `${md.price} G`), h('span', 'have', `×${ch.bag[id] ?? 0}`));
      for (const n of [1, 10]) {
        const b = btn(`×${n}`, () => ctx.send({ type: 'buy', shop: shopId, id, n }), 'mini');
        b.disabled = ch.gold < md.price * n;
        row.append(b);
      }
      list.append(row);
    }
    body.append(list);
    return;
  }
  const wrap = h('div', 'inv');
  const left = h('div', 'inv-left');
  const grid = h('div', 'grid');
  grid.dataset.keepScroll = '1';
  for (const it of ch.inventory) {
    const c = h('button', `cell${st.sel === it.uid ? ' sel' : ''}`);
    c.style.borderColor = rarityColor(it.rarity);
    c.style.color = rarityColor(it.rarity);
    c.append(h('span', 'cell-name', it.name), h('span', 'cell-price', `${sellPrice(it, CONTENT)} G`));
    if (it.locked) c.append(h('span', 'cell-lock', '🔒'));
    c.addEventListener('click', () => { st.sel = it.uid; st.refresh(); });
    grid.append(c);
  }
  left.append(grid);
  const bag = h('div', 'bag');
  for (const [id, n] of Object.entries(ch.bag)) {
    const md = CONTENT.materials[id];
    if (!md || n <= 0 || md.kind === 'key') continue;
    const row = h('div', 'shop-row');
    const dot = h('i', 'dot');
    dot.style.background = md.color;
    row.append(dot, h('span', 'name', md.name), h('span', 'have', `×${n}`), h('span', 'price', `${Math.round(md.price * CONTENT.balance.sell.materialMul)} G`));
    row.append(btn('×1', () => ctx.send({ type: 'sellBag', id, n: 1 }), 'mini'));
    row.append(btn(txt('settings.all'), () => ctx.send({ type: 'sellBag', id, n }), 'mini'));
    bag.append(row);
  }
  left.append(bag);
  wrap.append(left);
  const det = h('div', 'detail');
  const sel = ch.inventory.find((it) => it.uid === st.sel);
  if (sel) {
    det.append(itemInfo(sel, ch));
    det.append(kv(txt('item.price'), `${sellPrice(sel, CONTENT)} G`));
    const b = btn(txt('item.sell'), () => { ctx.send({ type: 'sell', uid: sel.uid }); st.sel = null; }, 'btn primary');
    b.disabled = !!sel.locked;
    det.append(b);
  } else det.classList.add('empty');
  wrap.append(det);
  body.append(wrap);
}

/** 装備中＋持ち物の一覧（選ぶと st.sel に入る） */
function ownedList(ctx: Ctx, st: NpcState, filter: (it: Item) => boolean = () => true): HTMLElement {
  const ch = ctx.me().char;
  const grid = h('div', 'grid');
  grid.dataset.keepScroll = '1';
  const all = [...Object.values(ch.equipment).filter(Boolean) as Item[], ...ch.inventory].filter(filter);
  for (const it of all) {
    const eq = Object.values(ch.equipment).some((e) => e?.uid === it.uid);
    grid.append(itemCell(it, { label: eq ? '★' : undefined, selected: st.sel === it.uid, onClick: () => { st.sel = it.uid; st.refresh(); } }));
  }
  return grid;
}

function renderSmith(ctx: Ctx, body: HTMLElement, _npc: string, st: NpcState) {
  const ch = ctx.me().char;
  if (!st.tab) st.tab = 'refine';
  const tabs = h('div', 'tabs');
  for (const t of ['refine', 'crystal', ...extraSmithTabs.map((x) => x.id)]) {
    const label = extraSmithTabs.find((x) => x.id === t)?.label ?? txt(`smith.${t}`);
    tabs.append(btn(label, () => { st.tab = t; st.refresh(); }, `tab${st.tab === t ? ' on' : ''}`));
  }
  body.append(tabs);
  const extra = extraSmithTabs.find((x) => x.id === st.tab);
  if (extra) { extra.render(ctx, body, st); return; }
  body.append(kv(txt('stat.gold'), `${ch.gold.toLocaleString()} G`, 'stat gold-row'));
  const wrap = h('div', 'inv');
  const left = h('div', 'inv-left');
  left.append(ownedList(ctx, st, st.tab === 'crystal' ? (it) => it.crystals.length > 0 : () => true));
  wrap.append(left);
  const det = h('div', 'detail');
  const all = [...ch.inventory, ...Object.values(ch.equipment)].filter(Boolean) as Item[];
  const sel = all.find((it) => it.uid === st.sel);
  if (!sel) { det.classList.add('empty'); wrap.append(det); body.append(wrap); return; }
  det.append(itemInfo(sel, ch));
  if (st.tab === 'refine') {
    const cost = refineCost(sel, CONTENT);
    if (cost) {
      const stones = ch.bag[CONTENT.refine.stone] ?? 0;
      const lv = CONTENT.refine.levels[sel.refine];
      det.append(kv(txt('smith.refine'), `+${sel.refine} → +${sel.refine + 1}`));
      det.append(kv(txt('smith.rate'), `${cost.rate}%`));
      if (sel.refinePity > 0) det.append(kv(txt('smith.pity'), `+${sel.refinePity}%`));
      det.append(kv(txt('npc.cost'), `${cost.gold.toLocaleString()} G`));
      const sRow = kv(txt('smith.stones'), `${stones} / ${cost.stones}`);
      if (stones < cost.stones) sRow.classList.add('bad');
      det.append(sRow);
      if (lv.drop > 0) det.append(kv(txt('smith.fail'), `-${lv.drop}`));
      const b = btn(txt('smith.refine'), () => ctx.send({ type: 'refine', uid: sel.uid }), 'btn primary');
      b.disabled = ch.gold < cost.gold || stones < cost.stones;
      det.append(b);
    }
  } else {
    const socks = h('div', 'sockets');
    sel.crystals.forEach((cr, i) => {
      const row = h('div', 'socket-row');
      if (cr) {
        const d = CONTENT.crystals[cr];
        const name = h('span', 'name', d?.name ?? cr);
        name.style.color = d?.color ?? '';
        row.append(name);
        row.append(btn(txt('smith.break'), () => ctx.send({ type: 'removeCrystal', uid: sel.uid, socket: i, recover: false }), 'mini danger'));
        const r = btn(`${txt('smith.recover')} ${(d?.recover ?? 0).toLocaleString()} G`, () => ctx.send({ type: 'removeCrystal', uid: sel.uid, socket: i, recover: true }), 'mini');
        r.disabled = ch.gold < (d?.recover ?? 0);
        row.append(r);
      } else {
        row.append(h('span', 'name muted', '◇'));
        const fits = Object.keys(ch.bag).filter((id) => CONTENT.crystals[id] && (ch.bag[id] ?? 0) > 0 && crystalFits(sel, id, CONTENT) && !sel.crystals.includes(id));
        for (const id of fits) {
          const b = btn(`${CONTENT.crystals[id].name} ×${ch.bag[id]}`, () => ctx.send({ type: 'insertCrystal', uid: sel.uid, socket: i, crystal: id }), 'mini');
          b.style.color = CONTENT.crystals[id].color;
          row.append(b);
        }
      }
      socks.append(row);
    });
    det.append(socks);
  }
  wrap.append(det);
  body.append(wrap);
}

/** 鍛冶屋に後から足すタブ（M6 の鍛冶・錬成） */
export const extraSmithTabs: { id: string; label: string; render: (ctx: Ctx, body: HTMLElement, st: NpcState) => void }[] = [];

function renderStorage(ctx: Ctx, body: HTMLElement, _npc: string, st: NpcState) {
  const ch = ctx.me().char;
  const acc = ctx.me().account;
  if (!st.tab) st.tab = 'items';
  const tabs = h('div', 'tabs');
  for (const t of ['items', 'bag']) tabs.append(btn(txt(`storage.${t}`), () => { st.tab = t; st.refresh(); }, `tab${st.tab === t ? ' on' : ''}`));
  body.append(tabs);
  const cost = storageExpandCost(acc, CONTENT);
  const head = h('div', 'storage-head');
  head.append(kv(txt('storage.box'), `${acc.storage.items.length} / ${acc.storage.capacity}`));
  if (cost !== null) {
    const b = btn(`${txt('storage.expand')} ${cost.toLocaleString()} G`, () => ctx.send({ type: 'expandStorage' }), 'mini');
    b.disabled = ch.gold < cost;
    head.append(b);
  }
  body.append(head);
  const cols = h('div', 'storage-cols');
  if (st.tab === 'items') {
    const mk = (title: string, items: Item[], action: (uid: number) => void, label: string) => {
      const col = h('div', 'storage-col');
      col.append(h('div', 'sub-title', title));
      const grid = h('div', 'grid');
      grid.dataset.keepScroll = '1';
      for (const it of items) {
        const c = itemCell(it, { onClick: () => action(it.uid) });
        c.title = label;
        grid.append(c);
      }
      col.append(grid);
      return col;
    };
    cols.append(mk(`${txt('storage.inv')} → ${txt('storage.deposit')}`, ch.inventory, (uid) => ctx.send({ type: 'deposit', uid }), txt('storage.deposit')));
    cols.append(mk(`${txt('storage.box')} → ${txt('storage.withdraw')}`, acc.storage.items, (uid) => ctx.send({ type: 'withdraw', uid }), txt('storage.withdraw')));
  } else {
    const mk = (title: string, bag: Record<string, number>, action: (id: string, n: number) => void) => {
      const col = h('div', 'storage-col');
      col.append(h('div', 'sub-title', title));
      for (const [id, n] of Object.entries(bag)) {
        if (n <= 0) continue;
        const info = bagInfo(id);
        const row = h('div', 'shop-row');
        const dot = h('i', 'dot');
        dot.style.background = info.color;
        row.append(dot, h('span', 'name', info.name), h('span', 'have', `×${n}`));
        row.append(btn('×1', () => action(id, 1), 'mini'), btn(txt('settings.all'), () => action(id, n), 'mini'));
        col.append(row);
      }
      return col;
    };
    cols.append(mk(`${txt('storage.inv')} → ${txt('storage.deposit')}`, ch.bag, (id, n) => ctx.send({ type: 'depositBag', id, n })));
    cols.append(mk(`${txt('storage.box')} → ${txt('storage.withdraw')}`, acc.storage.bag, (id, n) => ctx.send({ type: 'withdrawBag', id, n })));
  }
  body.append(cols);
}

const hhmm = (ms: number) => { const d = new Date(ms); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** 掲示板に後から足すタブ（M5 のミッション・侵攻・タイムアタック） */
export const extraBoardTabs: { id: string; label: string; render: (ctx: Ctx, body: HTMLElement, st: NpcState) => void }[] = [];

function renderBoard(ctx: Ctx, body: HTMLElement, _npc: string, st: NpcState) {
  const tabsDef = [{ id: 'weather', label: txt('board.weather') }, { id: 'boss', label: txt('board.boss') }, ...extraBoardTabs.map((x) => ({ id: x.id, label: x.label }))];
  if (!st.tab) st.tab = 'weather';
  const tabs = h('div', 'tabs');
  for (const t of tabsDef) tabs.append(btn(t.label, () => { st.tab = t.id; st.refresh(); }, `tab${st.tab === t.id ? ' on' : ''}`));
  body.append(tabs);
  const extra = extraBoardTabs.find((x) => x.id === st.tab);
  if (extra) { extra.render(ctx, body, st); return; }
  const w = ctx.world;
  const n = CONTENT.weather.forecastSlots;
  if (st.tab === 'weather') {
    const box = h('div', 'forecast');
    const first = forecast(CONTENT, 'meadow', w.clock, n);
    const head = h('div', 'fc-row fc-head');
    head.append(h('span', 'name', ''));
    for (const f of first) head.append(h('span', 'fc-cell', hhmm(f.start)));
    box.append(head);
    for (const [id, a] of Object.entries(CONTENT.areas)) {
      if (!a.weather) continue;
      const row = h('div', 'fc-row');
      row.append(h('span', 'name', a.name));
      for (const f of forecast(CONTENT, id, w.clock, n)) {
        const d = CONTENT.weather.types[f.weather];
        row.append(h('span', `fc-cell${d?.rare ? ' rare' : ''}`, d?.name ?? f.weather));
      }
      box.append(row);
    }
    body.append(box);
    return;
  }
  const list = h('div', 'shop-list');
  for (const [id, a] of Object.entries(CONTENT.areas)) {
    if (!a.fieldBoss) continue;
    const row = h('div', 'shop-row');
    const next = nextFieldBossAt(w, id);
    row.append(h('span', 'name', `${CONTENT.monsters[a.fieldBoss.id]?.name ?? ''}`), h('span', 'have', `${a.name}  Lv${a.fieldBoss.level}`));
    row.append(h('span', 'price', next === null ? txt('board.now') : `${txt('board.next')} ${hhmm(next)}`));
    list.append(row);
  }
  body.append(list);
}

function renderTravel(ctx: Ctx, body: HTMLElement) {
  const ch = ctx.me().char;
  body.append(kv(txt('stat.gold'), `${ch.gold.toLocaleString()} G`, 'stat gold-row'));
  const list = h('div', 'shop-list');
  for (const [id, a] of Object.entries(CONTENT.areas)) {
    if (a.type !== 'town') continue;
    const row = h('div', 'shop-row');
    row.append(h('span', 'name', a.name));
    const visited = ch.visitedTowns.includes(id);
    const here = ctx.world.area.id === id;
    row.append(h('span', 'price', visited ? `${a.travelCost ?? 0} G` : '—'));
    const b = btn(txt('npc.travel'), () => ctx.send({ type: 'fastTravel', town: id }), 'mini');
    b.disabled = !visited || here || ch.gold < (a.travelCost ?? 0);
    row.append(b);
    list.append(row);
  }
  body.append(list);
}
