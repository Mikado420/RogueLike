import {
  CONTENT, PRIMARY_STATS, canRebirth, respecCost, sellPrice, txt,
} from '../../../shared/src';
import { rarityColor } from '../colors';
import { btn, h, kv } from './dom';
import type { Ctx } from './ctx';
import { itemInfo } from './menu';

/** NPC の役割ごとの画面。後のマイルストーンで役割を足す */
export type NpcRenderer = (ctx: Ctx, body: HTMLElement, npc: string, state: NpcState) => void;
export interface NpcState { tab: string; sel: number | string | null; refresh: () => void }

export class NpcPanels {
  private renderers: Record<string, NpcRenderer> = {
    memory: renderMemory,
    rebirth: renderRebirth,
    shop: renderShop,
  };
  private state: NpcState;
  npc: string | null = null;

  constructor(private ctx: Ctx) {
    this.state = { tab: '', sel: null, refresh: () => this.refresh() };
  }

  register(role: string, r: NpcRenderer) { this.renderers[role] = r; }

  get isOpen() { return this.ctx.modal.kind === 'npc'; }

  open(npc: string) {
    const def = CONTENT.npcs[npc];
    const r = def && this.renderers[def.role];
    if (!r) return;
    this.npc = npc;
    this.state.tab = '';
    this.state.sel = null;
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
    if (!md || n <= 0) continue;
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
    det.append(itemInfo(sel, ch.level));
    det.append(kv(txt('item.price'), `${sellPrice(sel, CONTENT)} G`));
    const b = btn(txt('item.sell'), () => { ctx.send({ type: 'sell', uid: sel.uid }); st.sel = null; }, 'btn primary');
    b.disabled = !!sel.locked;
    det.append(b);
  } else det.classList.add('empty');
  wrap.append(det);
  body.append(wrap);
}
