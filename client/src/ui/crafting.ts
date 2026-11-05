import { CONTENT, alchemyCost, bagInfo, smithRecipe, subExpToNext, txt, type Item, type WeaponType } from '../../../shared/src';
import { btn, h, kv } from './dom';
import type { Ctx } from './ctx';
import { extraSmithTabs, type NpcPanels, type NpcState } from './npc';
import { itemCell, itemInfo } from './itemview';

/** M6 の画面（鍛冶・錬成・料理） */

function matLine(ch: { bag: Record<string, number> }, mats: [string, number][], gold: number, have: number): { el: HTMLElement; ok: boolean } {
  const line = h('div', 'cost-line');
  let ok = have >= gold;
  line.append(h('span', have < gold ? 'bad' : '', `${gold.toLocaleString()} G`));
  for (const [m, n] of mats) {
    const hv = ch.bag[m] ?? 0;
    if (hv < n) ok = false;
    line.append(h('span', hv < n ? 'bad' : '', `${bagInfo(m).name} ${hv}/${n}`));
  }
  return { el: line, ok };
}

export function registerCraftPanels(npc: NpcPanels) {
  extraSmithTabs.push({ id: 'craft', label: txt('smith.craft'), render: (c, body, st) => renderCraft(c, body, st) });
  extraSmithTabs.push({ id: 'alchemy', label: txt('smith.alchemy'), render: (c, body, st) => renderAlchemy(c, body, st) });
  npc.register('kitchen', (c, body) => {
    const ch = c.me().char;
    body.append(kv(txt('sub.cook'), `Lv ${ch.sub.cook.level}`));
    const list = h('div', 'shop-list');
    for (const [id, r] of Object.entries(CONTENT.recipes.cooking)) {
      const food = CONTENT.materials[id];
      const row = h('div', 'npc-sec');
      const head = h('div', 'storage-head');
      const name = h('b', '', food.name);
      name.style.color = food.color;
      head.append(name, h('span', 'muted', `Lv ${r.level}  ×${ch.bag[id] ?? 0}`));
      row.append(head);
      const fx = h('div', 'mods');
      for (const [k, v] of Object.entries(food.use?.food?.mods ?? {})) fx.append(h('span', 'mod', `${CONTENT.text[`mod.${k}`] ?? CONTENT.options.pool.find((o) => o.key === k)?.label ?? k} +${v}`));
      fx.append(h('span', 'mod', `${food.use?.food?.duration ?? 0}min`));
      row.append(fx);
      const ml = matLine(ch, Object.entries(r.mats), r.gold, ch.gold);
      row.append(ml.el);
      const b = btn(txt('cook.make'), () => c.send({ type: 'cook', recipe: id }), 'btn primary');
      b.disabled = !ml.ok || ch.sub.cook.level < r.level;
      row.append(b);
      list.append(row);
    }
    body.append(list);
  });
}

function renderCraft(c: Ctx, body: HTMLElement, st: NpcState & { craftTier?: number; craftBase?: string }) {
  const ch = c.me().char;
  body.append(kv(txt('sub.smith'), `Lv ${ch.sub.smith.level}  ${ch.gold.toLocaleString()} G`));
  const tiers = h('div', 'seg small');
  const s = st as NpcState & { craftTier?: number; craftBase?: string };
  s.craftTier ??= 0;
  s.craftBase ??= 'w_oneHandSword';
  for (const r of CONTENT.recipes.smithing.tiers) {
    const t = CONTENT.equipment.tiers[r.tier];
    const b = btn(`${t.prefix}`, () => { s.craftTier = r.tier; st.refresh(); }, `seg-btn${s.craftTier === r.tier ? ' on' : ''}`);
    if (ch.sub.smith.level < r.level) b.classList.add('muted');
    tiers.append(b);
  }
  body.append(tiers);
  const bases = h('div', 'look-row');
  for (const [id, b] of Object.entries(CONTENT.equipment.bases)) {
    const label = b.slot === 'weapon' ? CONTENT.weapons[b.kind as WeaponType]?.name ?? b.name : b.name;
    bases.append(btn(label, () => { s.craftBase = id; st.refresh(); }, `look-btn${s.craftBase === id ? ' on' : ''}`));
  }
  body.append(bases);
  const r = smithRecipe(c.world, s.craftTier);
  if (!r) return;
  const tier = CONTENT.equipment.tiers[r.tier];
  const sec = h('div', 'npc-sec');
  sec.append(h('div', 'sub-title', `${tier.prefix}${CONTENT.equipment.bases[s.craftBase].name}  ${txt('item.req')} ${tier.level}  ${txt('sub.smith')} Lv ${r.level}`));
  const ml = matLine(ch, [r.ore, r.wood, r.extra], r.gold, ch.gold);
  sec.append(ml.el);
  const b = btn(txt('craft.make'), () => c.send({ type: 'craft', tier: r.tier, base: s.craftBase! }), 'btn primary');
  b.disabled = !ml.ok || ch.sub.smith.level < r.level;
  sec.append(b);
  body.append(sec);
}

function renderAlchemy(c: Ctx, body: HTMLElement, st: NpcState) {
  const ch = c.me().char;
  body.append(kv(txt('sub.alchemy'), `Lv ${ch.sub.alchemy.level}  ${ch.gold.toLocaleString()} G  ${bagInfo(CONTENT.recipes.alchemy.catalyst).name} ×${ch.bag[CONTENT.recipes.alchemy.catalyst] ?? 0}`));
  const wrap = h('div', 'inv');
  const left = h('div', 'inv-left');
  const grid = h('div', 'grid');
  grid.dataset.keepScroll = '1';
  const all = [...Object.values(ch.equipment).filter(Boolean) as Item[], ...ch.inventory].filter((it) => it.options.length > 0);
  for (const it of all) grid.append(itemCell(it, { selected: st.sel === it.uid, onClick: () => { st.sel = it.uid; st.refresh(); } }));
  left.append(grid);
  wrap.append(left);
  const det = h('div', 'detail');
  const sel = all.find((it) => it.uid === st.sel);
  if (!sel) { det.classList.add('empty'); wrap.append(det); body.append(wrap); return; }
  det.append(itemInfo(sel, ch));
  const one = alchemyCost(c.world, c.me(), sel.tier, 'one');
  const vals = alchemyCost(c.world, c.me(), sel.tier, 'values');
  const cat = ch.bag[CONTENT.recipes.alchemy.catalyst] ?? 0;
  det.append(h('div', 'sub-title', `${txt('alchemy.one')}  ${one.gold.toLocaleString()} G  ×${one.catalyst}`));
  const row = h('div', 'look-row');
  sel.options.forEach((o, i) => {
    const b = btn(`${CONTENT.options.pool.find((x) => x.key === o.key)?.label ?? o.key}`, () => c.send({ type: 'alchemy', uid: sel.uid, mode: 'one', index: i }), 'mini');
    b.disabled = ch.gold < one.gold || cat < one.catalyst;
    row.append(b);
  });
  det.append(row);
  const vb = btn(`${txt('alchemy.values')}  ${vals.gold.toLocaleString()} G  ×${vals.catalyst}`, () => c.send({ type: 'alchemy', uid: sel.uid, mode: 'values', index: 0 }), 'btn');
  vb.disabled = ch.gold < vals.gold || cat < vals.catalyst;
  det.append(vb);
  wrap.append(det);
  body.append(wrap);
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
