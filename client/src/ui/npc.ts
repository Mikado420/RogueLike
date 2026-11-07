import {
  CONTENT, PRIMARY_STATS, bagInfo, baseBonus, baseOf, canRebirth, forecast, nextFieldBossAt, crystalFits, refineCost, respecCost, sellPrice, storageExpandCost,
  subExpToNext, txt,
  type Item, type ModKey, type WeaponType,
} from '../../../shared/src';
import { btn, h, kv } from './dom';
import { moveBtn } from './movelock';
import { modText, type Ctx } from './ctx';
import { itemCell, itemInfo } from './itemview';
import { bagIconUrl, iconImg, itemIconUrl } from './icons';
import { approx, refineEstimate, upgradeSign, usesOf } from './itemkit';
import { precious } from './itemactions';

/** NPC の役割ごとの画面。後のマイルストーンで役割を足す */
export type NpcRenderer = (ctx: Ctx, body: HTMLElement, npc: string, state: NpcState) => void;
export interface NpcState {
  tab: string; sel: number | string | null; refresh: () => void; npcId: number;
  /** 道具屋：買う個数（品ごと） */
  qty?: Record<string, number>;
  /** 道具屋：まとめて売るために選んだ装備 */
  picked?: number[];
  /** 鍛冶屋：精錬の目標（0 なら1回だけ） */
  goal?: number;
}

/** 精錬の結果（新しい順）。game.ts が refine イベントを受けたら入れる */
export const refineLog: { uid: number; success: boolean; level: number; at: number }[] = [];
export function pushRefineLog(e: { uid: number; success: boolean; level: number }) {
  refineLog.unshift({ uid: e.uid, success: e.success, level: e.level, at: Date.now() });
  refineLog.length = Math.min(refineLog.length, 12);
}

export class NpcPanels {
  private renderers: Record<string, NpcRenderer> = {
    memory: renderMemory,
    rebirth: renderRebirth,
    shop: renderShop,
    smith: renderSmith,
    storage: renderStorage,
    board: renderBoard,
    travel: renderTravel,
    starter: renderStarter,
  };
  private state: NpcState;
  npc: string | null = null;

  constructor(private ctx: Ctx) {
    this.state = { tab: '', sel: null, refresh: () => this.refresh(), npcId: -1 };
  }

  register(role: string, r: NpcRenderer) { this.renderers[role] = r; }

  get isOpen() { return this.ctx.modal.kind === 'npc'; }

  open(npc: string, npcId = -1, tab = '', sel: number | string | null = null) {
    const def = CONTENT.npcs[npc];
    const r = def && this.renderers[def.role];
    if (!r) return;
    this.npc = npc;
    this.state.tab = tab;
    this.state.sel = sel;
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
  sec.append(kv(txt('npc.need'), `${txt('stat.level')} ${CONTENT.balance.progression.rebirthLevel}`));
  sec.append(kv(txt('npc.bonus'), `${txt('stat.points')} +${rb.statPoints}  ${txt('skill.sp')} +${rb.skillPoints}  ${txt('stat.exp')} +${rb.expPct}%`));
  const err = canRebirth(ch, CONTENT);
  const b = btn(txt('npc.rebirth'), () => ctx.send({ type: 'rebirth' }), 'btn primary');
  b.disabled = !!err;
  sec.append(b);
  body.append(sec);
}

function renderShop(ctx: Ctx, body: HTMLElement, npc: string, st: NpcState) {
  const ch = ctx.me().char;
  const shopId = CONTENT.npcs[npc].shop ?? 'general';
  const shop = CONTENT.shops[shopId];
  if (!st.tab) st.tab = 'buy';
  const tabs = h('div', 'tabs');
  for (const t of ['buy', 'sell']) tabs.append(btn(txt(`npc.${t}`), () => { st.tab = t; st.sel = null; st.picked = []; st.refresh(); }, `tab${st.tab === t ? ' on' : ''}`));
  const head = h('div', 'npc-top');
  head.append(tabs, h('span', 'gold-chip', `${ch.gold.toLocaleString()} G`));
  body.append(head);
  if (st.tab === 'buy') {
    st.qty ??= {};
    const list = h('div', 'shop-list');
    for (const id of shop?.items ?? []) {
      const md = CONTENT.materials[id];
      if (!md) continue;
      const n = Math.max(1, st.qty[id] ?? 1);
      const row = h('div', 'buy-row');
      const info = h('div', 'buy-info');
      info.append(iconImg(bagIconUrl(id), 'row-ico'));
      const t = h('div', 'buy-text');
      t.append(h('span', 'name', md.name), h('span', 'muted small', `${md.price.toLocaleString()} G　${txt('shop.have', ch.bag[id] ?? 0)}`));
      info.append(t);
      const step = h('div', 'stepper');
      const set = (v: number) => { st.qty![id] = Math.max(1, Math.min(99, v)); st.refresh(); };
      const minus = btn('−', () => set(n - 1), 'step-btn'); minus.setAttribute('aria-label', txt('shop.less'));
      const plus = btn('+', () => set(n + 1), 'step-btn'); plus.setAttribute('aria-label', txt('shop.more'));
      step.append(minus, h('span', 'step-n', String(n)), plus, btn('×10', () => set(n === 1 ? 10 : n + 10), 'step-btn wide'));
      const total = md.price * n;
      const buy = btn(n > 1 ? `${txt('npc.buy')} ${total.toLocaleString()} G` : txt('npc.buy'), () => { ctx.send({ type: 'buy', shop: shopId, id, n }); st.qty![id] = 1; }, 'mini primary buy-btn');
      buy.disabled = ch.gold < total;
      const ctl = h('div', 'buy-ctl');
      ctl.append(step, buy);
      row.append(info, ctl);
      list.append(row);
    }
    body.append(list);
    return;
  }

  // 売る：まとめて選んで売る
  const picked = new Set((st.picked ?? []).filter((u) => ch.inventory.some((it) => it.uid === u && !it.locked)));
  const save = () => { st.picked = [...picked]; st.refresh(); };
  const sellable = ch.inventory.filter((it) => !it.locked);
  const quick = h('div', 'fchips');
  const group = (label: string, match: (it: Item) => boolean) => {
    const items = sellable.filter(match);
    if (!items.length) return;
    const all = items.every((it) => picked.has(it.uid));
    quick.append(btn(`${label} ${items.length}`, () => { for (const it of items) { if (all) picked.delete(it.uid); else picked.add(it.uid); } save(); }, `fchip${all ? ' on' : ''}`));
  };
  group(CONTENT.rarities.defs.common.name, (it) => it.rarity === 'common');
  group(CONTENT.rarities.defs.rare.name, (it) => it.rarity === 'rare');
  group(txt('sell.weaker'), (it) => upgradeSign(it, ch) < 0 && !precious(it));
  group(txt('sell.lowLevel', ch.level - 10), (it) => it.reqLevel < ch.level - 10 && !precious(it));
  if (picked.size) quick.append(btn(txt('sell.clear'), () => { picked.clear(); save(); }, 'fchip ghost'));
  body.append(h('div', 'sub-title', txt('sell.quick')), quick);
  body.append(h('div', 'legend', txt('sell.legend')));
  const grid = h('div', 'grid');
  grid.dataset.keepScroll = '1';
  for (const it of ch.inventory) {
    grid.append(itemCell(it, {
      price: true, compare: ch, checked: it.locked ? undefined : picked.has(it.uid), disabled: !!it.locked,
      onClick: () => { if (it.locked) return; if (picked.has(it.uid)) picked.delete(it.uid); else picked.add(it.uid); save(); },
    }));
  }
  if (!ch.inventory.length) grid.append(h('div', 'muted empty-note', txt('item.none')));
  body.append(grid);

  // 素材
  const mats = Object.entries(ch.bag).filter(([id, n]) => n > 0 && CONTENT.materials[id] && CONTENT.materials[id].kind !== 'key');
  if (mats.length) {
    body.append(h('div', 'sub-title', txt('item.materials')));
    const bag = h('div', 'shop-list');
    for (const [id, n] of mats) {
      const md = CONTENT.materials[id];
      const each = Math.round(md.price * CONTENT.balance.sell.materialMul);
      const row = h('div', 'sell-row');
      row.append(iconImg(bagIconUrl(id), 'row-ico'));
      const t = h('div', 'buy-text');
      const used = usesOf(id).filter((u) => u !== txt('use.use')).length > 0;
      t.append(h('span', 'name', `${md.name} ×${n}`), h('span', `muted small${used ? ' warn' : ''}`, `${each.toLocaleString()} G${used ? `　${txt('sell.usedFor')}` : ''}`));
      row.append(t);
      row.append(btn('×1', () => ctx.send({ type: 'sellBag', id, n: 1 }), 'mini'));
      row.append(btn(`${txt('settings.all')} ${(each * n).toLocaleString()} G`, () => {
        const go = () => ctx.send({ type: 'sellBag', id, n });
        if (used && n >= 5) ctx.modal.confirm({ title: txt('confirm.sellBag', md.name, n), body: txt('confirm.sellBagBody'), ok: txt('item.sell'), onOk: go });
        else go();
      }, 'mini'));
      bag.append(row);
    }
    body.append(bag);
  }

  // 下に固定：選んだ数と合計、まとめて売る
  const chosen = ch.inventory.filter((it) => picked.has(it.uid));
  const total = chosen.reduce((s2, it) => s2 + sellPrice(it, CONTENT), 0);
  const bar = h('div', 'sell-bar');
  const sum = h('div', 'sell-sum');
  sum.append(h('span', 'muted small', txt('sell.count', chosen.length)), h('b', 'gold-text', `+${total.toLocaleString()} G`));
  const go = btn(txt('sell.many'), () => {
    const uids = chosen.map((it) => it.uid);
    const done = () => { ctx.send({ type: 'sellMany', uids }); st.picked = []; st.refresh(); };
    const rare = chosen.filter(precious).length;
    ctx.modal.confirm({
      title: txt('confirm.sellMany', chosen.length, total.toLocaleString()),
      body: rare ? txt('confirm.sellManyRare', rare) : undefined,
      ok: txt('sell.many'), danger: rare > 0, onOk: done,
    });
  }, 'btn primary');
  go.disabled = chosen.length === 0;
  bar.append(sum, go);
  body.append(bar);
}

/** 装備中＋持ち物を横に並べた選び出し（選ぶと st.sel に入る）。装備中を先に */
export function itemPicker(ctx: Ctx, st: NpcState, filter: (it: Item) => boolean = () => true): HTMLElement {
  const ch = ctx.me().char;
  const wrap = h('div', 'picker');
  wrap.dataset.keepScroll = '1';
  const eqd = Object.values(ch.equipment).filter(Boolean) as Item[];
  const all = [...eqd, ...ch.inventory].filter(filter);
  for (const it of all) {
    const eq = eqd.includes(it);
    wrap.append(itemCell(it, { equipped: eq, selected: st.sel === it.uid, onClick: () => { st.sel = it.uid; st.refresh(); } }));
  }
  if (!all.length) wrap.append(h('div', 'muted empty-note', txt('smith.nothing')));
  return wrap;
}

/** 選んでいる装備（装備中も含む）。なければ候補の先頭を選ぶ */
function selected(ctx: Ctx, st: NpcState, filter: (it: Item) => boolean): Item | null {
  const ch = ctx.me().char;
  const all = [...Object.values(ch.equipment).filter(Boolean) as Item[], ...ch.inventory].filter(filter);
  let sel = all.find((it) => it.uid === st.sel) ?? null;
  if (!sel && all.length) { sel = all[0]; st.sel = sel.uid; }
  return sel;
}

const SMITH_ICON: Record<string, string> = {
  refine: '<path d="M12 3v10M7 8l5-5 5 5M5 21h14"/>',
  craft: '<path d="M14 4l6 6-9 9H5v-6z"/>',
  crystal: '<path d="M12 3l7 6-7 12-7-12z"/>',
  alchemy: '<path d="M4 12a8 8 0 0 1 14-5M20 12a8 8 0 0 1-14 5M18 3v4h-4M6 21v-4h4"/>',
};

function renderSmith(ctx: Ctx, body: HTMLElement, _npc: string, st: NpcState) {
  if (st.tab === 'named') st.tab = 'craft';
  if (!st.tab) { smithHome(ctx, body, st); return; }
  const top = h('div', 'npc-top');
  const back = btn(`‹ ${txt('smith.home')}`, () => { st.tab = ''; st.sel = null; st.refresh(); }, 'back-btn');
  top.append(back, h('span', 'gold-chip', `${ctx.me().char.gold.toLocaleString()} G`));
  body.append(top);
  body.append(h('div', 'screen-title', txt(`smith.${st.tab}`)));
  const extra = extraSmithTabs.find((x) => x.id === st.tab);
  if (extra) { extra.render(ctx, body, st); return; }
  if (st.tab === 'refine') renderRefine(ctx, body, st);
  else renderCrystal(ctx, body, st);
}

/** 鍛冶屋のホーム：やりたいことを選ぶ（件数のバッジつき） */
function smithHome(ctx: Ctx, body: HTMLElement, st: NpcState) {
  const w = ctx.world, p = ctx.me(), ch = p.char;
  const bonus = baseBonus(baseOf(p), CONTENT, w.clock, 'refineRate');
  const owned = [...Object.values(ch.equipment).filter(Boolean) as Item[], ...ch.inventory];
  const stones = ch.bag[CONTENT.refine.stone] ?? 0;
  const affordable = (it: Item) => { const c = refineCost(it, CONTENT, bonus); return !!c && c.stones <= stones && c.gold <= ch.gold; };
  const canRefine = owned.filter(affordable).length;
  const canRefineEq = (Object.values(ch.equipment).filter(Boolean) as Item[]).filter(affordable).length;
  const crystalsOwned = Object.keys(ch.bag).filter((id) => CONTENT.crystals[id] && (ch.bag[id] ?? 0) > 0);
  const emptySockets = owned.reduce((n, it) => n + it.crystals.filter((c) => !c).length, 0);
  const cat = ch.bag[CONTENT.recipes.alchemy.catalyst] ?? 0;
  const craftable = craftableCount(ctx);
  body.append(h('div', 'npc-greet', txt('smith.greet')));
  const grid = h('div', 'hub-grid');
  const tile = (id: string, title: string, lines: string[], badge: number) => {
    const b = btn('', () => { st.tab = id; st.sel = null; st.refresh(); }, 'hub-tile');
    const ico = h('span', 'hub-ico');
    ico.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SMITH_ICON[id]}</svg>`;
    b.append(ico, h('span', 'hub-title', title));
    for (const l of lines) b.append(h('span', 'hub-sub', l));
    if (badge > 0) b.append(h('span', 'hub-badge', String(badge)));
    grid.append(b);
  };
  tile('refine', txt('smith.refine'), [txt('hub.refineEq', canRefineEq, canRefine), `${bagInfo(CONTENT.refine.stone).name} ${stones.toLocaleString()}`], canRefineEq);
  tile('craft', txt('smith.craft'), [txt('hub.craft', craftable), txt('hub.craftNamed', CONTENT.crafted.recipes.length)], craftable);
  tile('crystal', txt('smith.crystal'), [txt('hub.sockets', emptySockets), txt('hub.crystals', crystalsOwned.length)], crystalsOwned.length && emptySockets ? crystalsOwned.length : 0);
  tile('alchemy', txt('smith.alchemy'), [txt('hub.alchemy'), `${bagInfo(CONTENT.recipes.alchemy.catalyst).name} ${cat}`], 0);
  body.append(grid);
  // 鍛冶 Lv と、次に作れるようになるもの
  const sj = ch.sub.smith;
  const lvBox = h('div', 'lv-box');
  const need = subExpToNext(w, sj.level);
  const head = h('div', 'lv-head');
  head.append(h('b', '', `${txt('sub.smith')} Lv ${sj.level}`), h('span', 'muted small', `${sj.exp.toLocaleString()} / ${need.toLocaleString()}`));
  const bar = h('div', 'mbar');
  const fill = h('div', 'mfill');
  fill.style.width = `${Math.min(1, sj.exp / Math.max(1, need)) * 100}%`;
  bar.append(fill);
  lvBox.append(head, bar);
  const nextTier = CONTENT.recipes.smithing.tiers.find((t) => t.level > sj.level);
  const nextNamed = CONTENT.crafted.recipes.filter((r) => r.smithLevel > sj.level).sort((a, b) => a.smithLevel - b.smithLevel)[0];
  const unlock: string[] = [];
  if (nextTier) unlock.push(txt('hub.nextTier', nextTier.level, CONTENT.equipment.tiers[nextTier.tier].prefix));
  if (nextNamed && (!nextTier || nextNamed.smithLevel <= nextTier.level)) unlock.push(txt('hub.nextNamed', nextNamed.smithLevel, nextNamed.name));
  for (const u of unlock) lvBox.append(h('div', 'muted small', u));
  lvBox.append(h('div', 'muted small', txt('hub.smithExp')));
  body.append(lvBox);
  // おすすめ：装備中の武器の精錬
  const wpn = ch.equipment.weapon;
  const rc = wpn ? refineCost(wpn, CONTENT, bonus) : null;
  if (wpn && rc) {
    const ok = rc.stones <= stones && rc.gold <= ch.gold;
    const rec = btn('', () => { st.tab = 'refine'; st.sel = wpn.uid; st.refresh(); }, `rec-row${ok ? ' ok' : ''}`);
    rec.append(iconImg(itemIconUrl(wpn), 'row-ico'));
    const t = h('span', 'buy-text');
    t.append(h('span', 'name', txt('hub.recRefine', wpn.name, wpn.refine + 1)), h('span', 'muted small', txt('act.refineSub', rc.rate, bagInfo(CONTENT.refine.stone).name, stones, rc.stones, rc.gold.toLocaleString())));
    rec.append(t, h('span', 'act-go', txt('act.open')));
    body.append(h('div', 'sub-title', txt('hub.rec')), rec);
  }
}

/** 今すぐ作れるもの（銘入り＋ふつうの鍛冶のティア） */
export function craftableCount(ctx: Ctx): number {
  const ch = ctx.me().char;
  const has = (m: Record<string, number> | [string, number][]) => (Array.isArray(m) ? m : Object.entries(m)).every(([id, n]) => (ch.bag[id] ?? 0) >= n);
  const named = CONTENT.crafted.recipes.filter((r) => ch.sub.smith.level >= r.smithLevel && ch.gold >= r.gold && has(r.mats)).length;
  const normal = CONTENT.recipes.smithing.tiers.filter((t) => ch.sub.smith.level >= t.level && ch.gold >= t.gold && has([t.ore, t.wood, t.extra])).length;
  return named + normal;
}

/** 精錬：目標まで続けて叩ける */
function renderRefine(ctx: Ctx, body: HTMLElement, st: NpcState) {
  const w = ctx.world, p = ctx.me(), ch = p.char;
  const bonus = baseBonus(baseOf(p), CONTENT, w.clock, 'refineRate');
  const sel = selected(ctx, st, () => true);
  body.append(itemPicker(ctx, st));
  if (!sel) return;
  const card = h('div', 'refine-card');
  const top = h('div', 'refine-top');
  const pic = h('div', 'd-pic big');
  pic.style.setProperty('--rc', CONTENT.rarities.defs[sel.rarity].color);
  pic.append(iconImg(itemIconUrl(sel), 'd-ico'));
  const nm = h('div', 'refine-name', sel.name);
  nm.style.color = CONTENT.rarities.defs[sel.rarity].color;
  top.append(pic, nm);
  card.append(top);
  const cost = refineCost(sel, CONTENT, bonus);
  const per = CONTENT.balance.stats.refineStatPerLevel * 100;
  if (!cost) {
    card.append(h('div', 'refine-steps', `+${sel.refine}`), h('div', 'muted', txt('err.refineMax')));
    body.append(card);
    return;
  }
  const steps = h('div', 'refine-steps');
  steps.append(h('span', 'from', `+${sel.refine}`), h('span', 'arrow', '→'), h('span', 'to', `+${sel.refine + 1}`));
  card.append(steps, h('div', 'muted small center', txt('refine.stat', Math.round(sel.refine * per), Math.round((sel.refine + 1) * per))));
  const base = Math.min(100, cost.rate - sel.refinePity);
  const rate = h('div', 'rate-box');
  const rh = h('div', 'rate-head');
  rh.append(h('span', '', txt('smith.rate')), h('b', 'rate-n', `${cost.rate}%`));
  if (sel.refinePity > 0) rh.append(h('span', 'good small', txt('refine.pity', sel.refinePity)));
  const bar = h('div', 'rate-bar');
  const b1 = h('div', 'rate-base'); b1.style.width = `${Math.max(0, base)}%`;
  const b2 = h('div', 'rate-pity'); b2.style.width = `${Math.min(100 - Math.max(0, base), sel.refinePity)}%`;
  bar.append(b1, b2);
  rate.append(rh, bar);
  const drop = CONTENT.refine.levels[sel.refine].drop;
  if (drop > 0) rate.append(h('div', 'bad small', txt('refine.drop', Math.max(0, sel.refine - drop))));
  else rate.append(h('div', 'muted small', txt('refine.safe')));
  const stones = ch.bag[CONTENT.refine.stone] ?? 0;
  const need = h('div', 'need');
  const stoneRow = h('div', `need-row${stones < cost.stones ? ' bad' : ''}`);
  stoneRow.append(iconImg(bagIconUrl(CONTENT.refine.stone), 'cchip-ico'), h('span', '', bagInfo(CONTENT.refine.stone).name), h('b', '', `${cost.stones}`), h('span', 'muted small', txt('refine.have', stones.toLocaleString())));
  const goldRow = h('div', `need-row${ch.gold < cost.gold ? ' bad' : ''}`);
  goldRow.append(h('span', 'g-dot', 'G'), h('span', '', txt('refine.gold')), h('b', '', `${cost.gold.toLocaleString()}`), h('span', 'muted small', txt('refine.have', ch.gold.toLocaleString())));
  need.append(stoneRow, goldRow);
  card.append(rate, need);
  // 目標
  const max = CONTENT.refine.max;
  const targets = [...new Set([sel.refine + 2, sel.refine + 3, sel.refine + 5, 10, max])].filter((g) => g <= max && g > sel.refine + 1).sort((a, b) => a - b);
  const goals = [0, ...targets.slice(0, 4)];
  if (st.goal !== undefined && st.goal !== 0 && !goals.includes(st.goal)) st.goal = 0;
  const goal = st.goal ?? 0;
  const gw = h('div', 'goal-box');
  gw.append(h('div', 'muted small', txt('refine.goal')));
  const chips = h('div', 'fchips');
  for (const g of goals) chips.append(btn(g === 0 ? txt('refine.once') : `+${g}`, () => { st.goal = g; st.refresh(); }, `fchip${goal === g ? ' on' : ''}`));
  gw.append(chips);
  if (goal > 0) {
    const est = refineEstimate(w, p, sel, goal);
    gw.append(h('div', 'muted small', txt('refine.estimate', goal, approx(est.stones), approx(est.gold), approx(est.tries))));
    const enough = stones >= est.stones && ch.gold >= est.gold;
    gw.append(h('div', `small ${enough ? 'good' : 'warn'}`, enough ? txt('refine.enough') : txt('refine.notEnough')));
  }
  card.append(gw);
  const go = btn(goal > 0 ? txt('refine.goTo', goal) : txt('refine.goOnce'), () => {
    if (goal > 0) ctx.send({ type: 'refineTo', uid: sel.uid, target: goal });
    else ctx.send({ type: 'refine', uid: sel.uid });
  }, 'btn primary big-btn');
  go.disabled = stones < cost.stones || ch.gold < cost.gold;
  card.append(go);
  body.append(card);
  // 結果
  const mine = refineLog.filter((r) => r.uid === sel.uid).slice(0, 6);
  if (mine.length) {
    const log = h('div', 'refine-log');
    log.append(h('div', 'sub-title', txt('refine.log')));
    for (const r of mine) {
      const row = h('div', `log-row ${r.success ? 'good' : 'bad'}`);
      row.append(h('span', '', r.success ? txt('refine.ok', r.level) : txt('refine.fail', r.level)));
      log.append(row);
    }
    body.append(log);
  }
}

/** 結晶：はめる・外す */
function renderCrystal(ctx: Ctx, body: HTMLElement, st: NpcState) {
  const ch = ctx.me().char;
  const filter = (it: Item) => it.crystals.length > 0;
  const sel = selected(ctx, st, filter);
  body.append(h('div', 'muted small', txt('crystal.hint')));
  body.append(itemPicker(ctx, st, filter));
  if (!sel) return;
  const card = h('div', 'refine-card');
  card.append(itemInfo(sel, ch));
  const socks = h('div', 'sockets');
  sel.crystals.forEach((cr, i) => {
    const row = h('div', 'socket-row');
    row.append(h('div', 'socket-label', txt('crystal.slot', i + 1)));
    if (cr) {
      const d = CONTENT.crystals[cr];
      const info = h('div', 'socket-gem');
      info.append(iconImg(bagIconUrl(cr), 'row-ico'));
      const t = h('div', 'buy-text');
      const nm = h('span', 'name', d?.name ?? cr);
      nm.style.color = d?.color ?? '';
      t.append(nm, h('span', 'muted small', Object.entries(d?.mods ?? {}).map(([k, v]) => modText(k as ModKey, v as number)).join('、')));
      info.append(t);
      row.append(info);
      const acts = h('div', 'socket-acts');
      const r = btn(txt('crystal.recover', (d?.recover ?? 0).toLocaleString()), () => ctx.send({ type: 'removeCrystal', uid: sel.uid, socket: i, recover: true }), 'mini');
      r.disabled = ch.gold < (d?.recover ?? 0);
      const brk = btn(txt('smith.break'), () => ctx.modal.confirm({
        title: txt('confirm.break', d?.name ?? cr), body: txt('confirm.breakBody'), ok: txt('smith.break'), danger: true,
        onOk: () => ctx.send({ type: 'removeCrystal', uid: sel.uid, socket: i, recover: false }),
      }), 'mini danger');
      acts.append(r, brk);
      row.append(acts);
    } else {
      const fits = Object.keys(ch.bag).filter((id) => CONTENT.crystals[id] && (ch.bag[id] ?? 0) > 0 && crystalFits(sel, id, CONTENT) && !sel.crystals.includes(id));
      if (!fits.length) row.append(h('div', 'muted small', txt('crystal.none')));
      const list = h('div', 'gem-list');
      for (const id of fits) {
        const d = CONTENT.crystals[id];
        const b = btn('', () => ctx.send({ type: 'insertCrystal', uid: sel.uid, socket: i, crystal: id }), 'gem-btn');
        b.append(iconImg(bagIconUrl(id), 'row-ico'));
        const t = h('span', 'buy-text');
        const nm = h('span', 'name', `${d.name} ×${ch.bag[id]}`);
        nm.style.color = d.color;
        t.append(nm, h('span', 'muted small', Object.entries(d.mods).map(([k, v]) => modText(k as ModKey, v as number)).join('、')));
        b.append(t, h('span', 'act-go', txt('crystal.insert')));
        list.append(b);
      }
      row.append(list);
    }
    socks.append(row);
  });
  card.append(socks);
  body.append(card);
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
        row.append(iconImg(bagIconUrl(id), 'row-ico small'), h('span', 'name', info.name), h('span', 'have', `×${n}`));
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

/** 掲示板に後から足すタブ（M5 のミッション・タイムアタック） */
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
    const b = moveBtn(txt('npc.travel'), () => ctx.world.area.id, () => ctx.send({ type: 'fastTravel', town: id }), 'mini');
    b.disabled = !visited || here || ch.gold < (a.travelCost ?? 0);
    row.append(b);
    list.append(row);
  }
  body.append(list);
}

/** 武器の師範：最初の武器を 1 本だけ選んでもらう */
function renderStarter(ctx: Ctx, body: HTMLElement) {
  const ch = ctx.me().char;
  const sec = h('div', 'npc-sec');
  if (ch.starterWeapon) {
    sec.append(h('p', 'npc-talk', txt('starter.done', starterWeapon(ch.starterWeapon)?.name ?? '')));
    body.append(sec);
    return;
  }
  sec.append(h('p', 'npc-talk', txt('starter.talk')));
  const grid = h('div', 'starter-grid');
  for (const base of CONTENT.balance.start.starterWeapons ?? []) {
    const wd = starterWeapon(base);
    const b = btn('', () => { ctx.send({ type: 'starterWeapon', base }); setTimeout(() => ctx.modal.refresh(), 300); }, 'starter-btn');
    b.append(h('b', '', wd?.name ?? base), h('small', '', txt(`starter.type.${wd?.damageType ?? 'physical'}`)));
    grid.append(b);
  }
  sec.append(grid);
  body.append(sec);
}

function starterWeapon(base: string) {
  const kind = CONTENT.equipment.bases[base]?.kind;
  return kind ? CONTENT.weapons[kind as WeaponType] : undefined;
}
