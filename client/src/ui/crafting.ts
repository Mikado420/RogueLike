import {
  CONTENT, RARITIES, alchemyCost, bagInfo, smithRecipe, subExpToNext, txt, weaponTypeOf,
  type CraftedDef, type Item, type ModKey, type WeaponType,
} from '../../../shared/src';
import { btn, h, kv } from './dom';
import { modText, type Ctx } from './ctx';
import { extraSmithTabs, itemPicker, type NpcPanels, type NpcState } from './npc';
import { itemInfo, uniqueLines } from './itemview';
import { bagIconUrl, iconImg, itemIconUrl } from './icons';
import { costChips, missingLine } from './itemkit';

/** 鍛冶屋の「作る」（銘入り・ふつう）と「錬成」、料理人の画面 */

export function registerCraftPanels(npc: NpcPanels) {
  extraSmithTabs.push({ id: 'craft', label: txt('smith.craft'), render: (c, body, st) => renderCraft(c, body, st) });
  extraSmithTabs.push({ id: 'alchemy', label: txt('smith.alchemy'), render: (c, body, st) => renderAlchemy(c, body, st) });
  npc.register('kitchen', (c, body) => {
    const ch = c.me().char;
    body.append(kv(txt('sub.cook'), `Lv ${ch.sub.cook.level}　${ch.gold.toLocaleString()} G`));
    const list = h('div', 'card-list');
    const rows = Object.entries(CONTENT.recipes.cooking).map(([id, r]) => {
      const cost = costChips(ch, Object.entries(r.mats), r.gold);
      const lvOk = ch.sub.cook.level >= r.level;
      return { id, r, cost, lvOk, ready: cost.ok && lvOk };
    }).sort((a, b) => Number(b.ready) - Number(a.ready) || a.r.level - b.r.level);
    for (const { id, r, cost, lvOk, ready } of rows) {
      const food = CONTENT.materials[id];
      const card = h('div', `craft-card${ready ? ' ready' : ''}`);
      const head = h('div', 'craft-head');
      head.append(iconImg(bagIconUrl(id), 'craft-ico'));
      const t = h('div', 'craft-title');
      t.append(h('b', '', food.name), h('span', `small ${lvOk ? 'muted' : 'bad'}`, `${txt('sub.cook')} Lv${r.level}　${txt('item.have', ch.bag[id] ?? 0)}`));
      head.append(t);
      if (ready) head.append(h('span', 'ready-tag', txt('craft.ready')));
      card.append(head);
      const fx = h('div', 'craft-eff');
      for (const [k, v] of Object.entries(food.use?.food?.mods ?? {})) fx.append(h('div', '', modText(k as ModKey, v as number)));
      fx.append(h('div', 'muted', txt('use.minutes', food.use?.food?.duration ?? 0)));
      card.append(fx, cost.el);
      const miss = missingLine(cost.missing);
      if (miss) card.append(miss);
      const b = btn(txt('cook.make'), () => c.send({ type: 'cook', recipe: id }), 'btn primary');
      b.disabled = !ready;
      card.append(b);
      list.append(card);
    }
    body.append(list);
  });
}

// ───────── 作る ─────────

type CraftMode = 'named' | 'normal';
type NamedFilter = 'ready' | 'near' | 'all';
let craftMode: CraftMode = 'named';
let namedRegion = '';
let namedFilter: NamedFilter = 'ready';
let onlyMyWeapon = false;
let craftTier = -1;
let craftBase = 'w_oneHandSword';

/** 銘入りのレシピの見た目（イラスト用の仮の装備） */
function namedPreview(r: CraftedDef): Item {
  const base = CONTENT.equipment.bases[r.base];
  return {
    uid: 0, base: r.base, name: r.name, slot: base.slot, kind: base.kind, tier: r.tier, ilvl: 1, reqLevel: 1, rarity: 'legend', refine: 0, refinePity: 0,
    stats: {}, options: [], crystals: [], element: r.element, trade: 'free', look: '', crafted: r.id,
  };
}

function renderCraft(c: Ctx, body: HTMLElement, st: NpcState) {
  const ch = c.me().char;
  const seg = h('div', 'seg wide');
  for (const m of ['named', 'normal'] as const) seg.append(btn(txt(`craft.mode.${m}`), () => { craftMode = m; st.refresh(); }, `seg-btn${craftMode === m ? ' on' : ''}`));
  body.append(seg, h('div', 'muted small', `${txt('sub.smith')} Lv ${ch.sub.smith.level}`));
  if (craftMode === 'named') renderNamed(c, body, st);
  else renderNormal(c, body, st);
}

function renderNamed(c: Ctx, body: HTMLElement, st: NpcState) {
  const ch = c.me().char;
  const cr = CONTENT.crafted;
  const myKind = weaponTypeOf(ch);
  const eval_ = (r: CraftedDef) => {
    const cost = costChips(ch, Object.entries(r.mats), r.gold);
    const lvOk = ch.sub.smith.level >= r.smithLevel;
    const ready = cost.ok && lvOk;
    const near = !ready && lvOk && cost.missing.length <= 2;
    return { r, cost, lvOk, ready, near };
  };
  // 最初は「作れるものがある地域」か、鍛冶 Lv で手が届く一番先の地域
  if (!namedRegion) {
    const withReady = cr.regions.find((g) => cr.recipes.some((r) => r.region === g.id && eval_(r).ready));
    const reach = [...cr.regions].reverse().find((g) => cr.recipes.some((r) => r.region === g.id && r.smithLevel <= ch.sub.smith.level));
    namedRegion = (withReady ?? reach ?? cr.regions[0]).id;
  }
  const regions = h('div', 'fchips');
  for (const g of cr.regions) {
    const n = cr.recipes.filter((r) => r.region === g.id && eval_(r).ready).length;
    regions.append(btn(n ? `${g.name} ${n}` : g.name, () => { namedRegion = g.id; st.refresh(); }, `fchip${namedRegion === g.id ? ' on' : ''}`));
  }
  body.append(regions);
  const inRegion = cr.recipes.filter((r) => r.region === namedRegion).map(eval_);
  const kinds = inRegion.filter((x) => !onlyMyWeapon || CONTENT.equipment.bases[x.r.base]?.kind === myKind);
  const filters = h('div', 'fchips');
  const count = { ready: kinds.filter((x) => x.ready).length, near: kinds.filter((x) => x.near).length, all: kinds.length };
  for (const f of ['ready', 'near', 'all'] as const) filters.append(btn(`${txt(`craft.filter.${f}`)} ${count[f]}`, () => { namedFilter = f; st.refresh(); }, `fchip${namedFilter === f ? ' on' : ''}`));
  filters.append(btn(txt('craft.myWeapon', CONTENT.weapons[myKind]?.name ?? ''), () => { onlyMyWeapon = !onlyMyWeapon; st.refresh(); }, `fchip${onlyMyWeapon ? ' on' : ''}`));
  body.append(filters);
  let shown = kinds.filter((x) => namedFilter === 'all' || (namedFilter === 'ready' ? x.ready : x.near));
  shown = shown.sort((a, b) => Number(b.ready) - Number(a.ready) || Number(b.near) - Number(a.near) || a.r.stage - b.r.stage || a.r.smithLevel - b.r.smithLevel);
  const list = h('div', 'card-list');
  if (!shown.length) list.append(h('div', 'muted empty-note', namedFilter === 'ready' ? txt('craft.noneReady') : txt('craft.noneNear')));
  for (const { r, cost, lvOk, ready } of shown) {
    const base = CONTENT.equipment.bases[r.base];
    const card = h('div', `craft-card${ready ? ' ready' : ''}${r.stage === 2 ? ' final' : ''}`);
    const head = h('div', 'craft-head');
    head.append(iconImg(itemIconUrl(namedPreview(r)), 'craft-ico'));
    const t = h('div', 'craft-title');
    const nm = h('b', '', r.name);
    nm.style.color = CONTENT.rarities.defs.legend.color;
    const kindName = base.slot === 'weapon' ? CONTENT.weapons[base.kind as WeaponType]?.name ?? base.name : base.name;
    t.append(nm, h('span', `small ${lvOk ? 'muted' : 'bad'}`, `${kindName}・${CONTENT.equipment.tiers[r.tier]?.prefix ?? ''}　${txt('sub.smith')} Lv${r.smithLevel}${r.stage === 2 ? `　${txt('craft.final')}` : ''}`));
    head.append(t);
    if (ready) head.append(h('span', 'ready-tag', txt('craft.ready')));
    card.append(head);
    const eff = h('div', 'craft-eff');
    for (const l of uniqueLines(CONTENT.uniques[`crafted.${r.id}`])) eff.append(h('div', '', l));
    card.append(eff, cost.el);
    const miss = missingLine(cost.missing);
    if (miss) card.append(miss);
    const b = btn(lvOk ? txt('smith.namedMake') : txt('craft.needLv', r.smithLevel), () => c.send({ type: 'craftNamed', recipe: r.id }), 'btn primary');
    b.disabled = !ready;
    card.append(b);
    list.append(card);
  }
  body.append(list);
}

function renderNormal(c: Ctx, body: HTMLElement, _st: NpcState) {
  const ch = c.me().char;
  const st = _st;
  const tiers = CONTENT.recipes.smithing.tiers;
  if (craftTier < 0) craftTier = [...tiers].reverse().find((t) => t.level <= ch.sub.smith.level)?.tier ?? 0;
  const tierRow = h('div', 'fchips');
  for (const r of tiers) {
    const t = CONTENT.equipment.tiers[r.tier];
    const locked = ch.sub.smith.level < r.level;
    tierRow.append(btn(locked ? `${t.prefix} Lv${r.level}` : t.prefix, () => { craftTier = r.tier; st.refresh(); }, `fchip${craftTier === r.tier ? ' on' : ''}${locked ? ' locked' : ''}`));
  }
  body.append(h('div', 'sub-title', txt('craft.tier')), tierRow);
  const r = smithRecipe(c.world, craftTier);
  if (!r) return;
  const tier = CONTENT.equipment.tiers[r.tier];
  const preview = (baseId: string): Item => {
    const b = CONTENT.equipment.bases[baseId];
    return { uid: 0, base: baseId, name: '', slot: b.slot, kind: b.kind, tier: r.tier, ilvl: 1, reqLevel: tier.level, rarity: 'common', refine: 0, refinePity: 0, stats: {}, options: [], crystals: [], element: 'neutral', trade: 'free', look: '' };
  };
  body.append(h('div', 'sub-title', txt('craft.base')));
  const bases = h('div', 'grid base-grid');
  for (const [id, b] of Object.entries(CONTENT.equipment.bases)) {
    const cell = h('button', `cell base-cell${craftBase === id ? ' sel' : ''}`);
    cell.append(iconImg(itemIconUrl(preview(id)), 'cell-ico'));
    const label = b.slot === 'weapon' ? CONTENT.weapons[b.kind as WeaponType]?.name ?? b.name : b.name;
    cell.append(h('span', 'cell-cap', label));
    cell.setAttribute('aria-label', label);
    cell.addEventListener('click', () => { craftBase = id; st.refresh(); });
    bases.append(cell);
  }
  body.append(bases);
  const base = CONTENT.equipment.bases[craftBase];
  const card = h('div', 'craft-card');
  const head = h('div', 'craft-head');
  head.append(iconImg(itemIconUrl(preview(craftBase)), 'craft-ico'));
  const t = h('div', 'craft-title');
  const label = base.slot === 'weapon' ? CONTENT.weapons[base.kind as WeaponType]?.name ?? base.name : base.name;
  const lvOk = ch.sub.smith.level >= r.level;
  t.append(h('b', '', `${tier.prefix}${label}`), h('span', `small ${lvOk ? 'muted' : 'bad'}`, `${txt('item.req')} ${tier.level}　${txt('sub.smith')} Lv${r.level}`));
  head.append(t);
  card.append(head);
  // レアリティの出やすさ（鍛冶 Lv でレア以上が出やすくなる）
  const weights = CONTENT.recipes.smithing.rarity;
  const total = RARITIES.reduce((s, k) => s + (weights[k] ?? 0), 0) || 1;
  const odds = h('div', 'odds');
  for (const k of RARITIES) {
    const v = weights[k] ?? 0;
    if (!v) continue;
    const o = h('span', 'odd', `${CONTENT.rarities.defs[k].name} ${Math.round((v / total) * 1000) / 10}%`);
    o.style.color = CONTENT.rarities.defs[k].color;
    odds.append(o);
  }
  card.append(odds, h('div', 'muted small', txt('craft.rareBonus', Math.round(CONTENT.subjobs.effects.smithRarePct * ch.sub.smith.level))));
  const cost = costChips(ch, [r.ore, r.wood, r.extra], r.gold);
  card.append(cost.el);
  const miss = missingLine(cost.missing);
  if (miss) card.append(miss);
  const b = btn(lvOk ? txt('craft.make') : txt('craft.needLv', r.level), () => c.send({ type: 'craft', tier: r.tier, base: craftBase }), 'btn primary');
  b.disabled = !cost.ok || !lvOk;
  card.append(b);
  body.append(card);
}

// ───────── 錬成 ─────────

function renderAlchemy(c: Ctx, body: HTMLElement, st: NpcState) {
  const ch = c.me().char;
  const catId = CONTENT.recipes.alchemy.catalyst;
  const cat = ch.bag[catId] ?? 0;
  const head = h('div', 'need-row');
  head.append(iconImg(bagIconUrl(catId), 'cchip-ico'), h('span', '', bagInfo(catId).name), h('b', '', `×${cat}`), h('span', 'muted small', `${txt('sub.alchemy')} Lv ${ch.sub.alchemy.level}`));
  body.append(head, h('div', 'muted small', txt('alchemy.hint')));
  const filter = (it: Item) => it.options.length > 0;
  const owned = [...Object.values(ch.equipment).filter(Boolean) as Item[], ...ch.inventory].filter(filter);
  if (!owned.some((it) => it.uid === st.sel) && owned.length) st.sel = owned[0].uid;
  body.append(itemPicker(c, st, filter));
  const sel = owned.find((it) => it.uid === st.sel);
  if (!sel) return;
  const card = h('div', 'refine-card');
  card.append(itemInfo(sel, ch));
  const one = alchemyCost(c.world, c.me(), sel.tier, 'one');
  const vals = alchemyCost(c.world, c.me(), sel.tier, 'values');
  card.append(h('div', 'sub-title', txt('alchemy.oneTitle', one.gold.toLocaleString(), one.catalyst)));
  const rows = h('div', 'opt-rows');
  sel.options.forEach((o, i) => {
    const row = h('div', 'opt-row');
    row.append(h('span', '', modText(o.key, o.value)));
    const b = btn(txt('alchemy.reroll'), () => c.send({ type: 'alchemy', uid: sel.uid, mode: 'one', index: i }), 'mini');
    b.disabled = ch.gold < one.gold || cat < one.catalyst;
    row.append(b);
    rows.append(row);
  });
  card.append(rows);
  const vb = btn(txt('alchemy.valuesBtn', vals.gold.toLocaleString(), vals.catalyst), () => c.send({ type: 'alchemy', uid: sel.uid, mode: 'values', index: 0 }), 'btn');
  vb.disabled = ch.gold < vals.gold || cat < vals.catalyst;
  card.append(vb);
  body.append(card);
}

/** ステータス画面のサブ職の欄 */
export function subJobsBox(c: Ctx): HTMLElement {
  const ch = c.me().char;
  const box = h('div', 'npc-sec');
  box.append(h('div', 'sub-title', txt('menu.sub')));
  for (const job of ['gather', 'smith', 'cook', 'alchemy'] as const) {
    const st = ch.sub[job];
    const r = h('div', 'mission-row');
    r.append(h('span', 'name', txt(`sub.${job}`)));
    const bar = h('div', 'mbar');
    const fill = h('div', 'mfill');
    fill.style.width = `${Math.min(1, st.exp / subExpToNext(c.world, st.level)) * 100}%`;
    bar.append(fill);
    r.append(bar, h('span', 'have', `Lv ${st.level}`));
    box.append(r);
  }
  return box;
}

