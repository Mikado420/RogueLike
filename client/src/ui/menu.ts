import {
  CONTENT, EQUIP_SLOTS, PERSONAL_STATS, PRIMARY_STATS, canLearnSkill, expToNext, freeSkillPoints, freeStatPoints,
  itemMods, primaryStats, scaled, slotsFor, staticMods, txt, weaponTypeOf,
  type EquipSlot, type Item, type ModKey, type SkillDef, type WeaponType,
} from '../../../shared/src';
import { rarityColor } from '../colors';
import { btn, h, kv } from './dom';
import { elName, modLabel, modText, type Ctx } from './ctx';
import type { DamageDisplay } from '../settings';

export type MenuTab = 'status' | 'skills' | 'items' | 'settings';
const TABS: MenuTab[] = ['status', 'skills', 'items', 'settings'];

export class Menu {
  tab: MenuTab = 'status';
  tree = 'oneHandSword';
  skillSel: string | null = null;
  itemSel: number | string | null = null;
  /** 他のマイルストーンで足すタブ */
  extraTabs: { id: string; label: string; render: (body: HTMLElement) => void }[] = [];

  constructor(private ctx: Ctx) {}

  get isOpen() { return this.ctx.modal.kind === 'menu'; }

  open(tab?: MenuTab | string) {
    if (tab) this.tab = tab as MenuTab;
    this.tree = weaponTypeOf(this.ctx.me().char);
    this.ctx.modal.open('menu', txt('hud.menu'), (body) => this.render(body));
  }

  toggle() {
    if (this.isOpen) this.ctx.modal.close(); else this.open();
  }

  refresh() {
    if (this.isOpen) this.ctx.modal.refresh();
  }

  private render(body: HTMLElement) {
    const tabs = h('div', 'tabs');
    const all: { id: string; label: string }[] = [
      ...TABS.slice(0, 3).map((t) => ({ id: t, label: txt(`menu.${t}`) })),
      ...this.extraTabs.map((t) => ({ id: t.id, label: t.label })),
      { id: 'settings', label: txt('menu.settings') },
    ];
    for (const t of all) {
      const b = btn(t.label, () => { this.tab = t.id as MenuTab; this.refresh(); }, `tab${this.tab === t.id ? ' on' : ''}`);
      if (t.id === 'status' && freeStatPoints(this.ctx.me().char, CONTENT) > 0) b.classList.add('has-dot');
      if (t.id === 'skills' && freeSkillPoints(this.ctx.me().char, CONTENT) > 0) b.classList.add('has-dot');
      tabs.append(b);
    }
    body.append(tabs);
    const content = h('div', 'tab-body');
    body.append(content);
    const extra = this.extraTabs.find((t) => t.id === this.tab);
    if (extra) extra.render(content);
    else if (this.tab === 'status') this.renderStatus(content);
    else if (this.tab === 'skills') this.renderSkills(content);
    else if (this.tab === 'items') this.renderItems(content);
    else this.renderSettings(content);
  }

  // ───────── ステータス ─────────

  private renderStatus(el: HTMLElement) {
    const p = this.ctx.me();
    const ch = p.char;
    const head = h('div', 'char-head');
    head.append(h('div', 'char-name', ch.name));
    head.append(h('div', 'char-lv', `${txt('stat.level')} ${ch.level}${ch.rebirths ? `  ${txt('stat.rebirths')} ${ch.rebirths}` : ''}`));
    if (ch.titles.equipped) head.append(h('div', 'char-title', txt(`title.${ch.titles.equipped}`)));
    el.append(head);
    const need = expToNext(ch.level, CONTENT);
    el.append(kv(txt('stat.exp'), ch.level >= CONTENT.balance.progression.maxLevel ? 'MAX' : `${ch.exp.toLocaleString()} / ${need.toLocaleString()}`));

    const free = freeStatPoints(ch, CONTENT);
    const ptsRow = h('div', `points${free > 0 ? ' has' : ''}`);
    ptsRow.append(h('span', 'k', txt('stat.points')), h('span', 'v', String(free)));
    el.append(ptsRow);

    const m = staticMods(ch, CONTENT);
    const P = primaryStats(ch, m, CONTENT);
    const grid = h('div', 'alloc');
    const row = (label: string, value: string, bonus: number, onAdd: (n: number) => void, disabled: boolean) => {
      const r = h('div', 'alloc-row');
      r.append(h('span', 'k', label));
      const v = h('span', 'v', value);
      if (bonus) v.append(h('em', '', ` +${bonus}`));
      r.append(v);
      const b1 = btn('+1', () => onAdd(1), 'mini');
      const b10 = btn('+10', () => onAdd(10), 'mini');
      b1.disabled = disabled; b10.disabled = disabled;
      r.append(b1, b10);
      grid.append(r);
    };
    for (const s of PRIMARY_STATS) {
      row(txt(`stat.${s}`), String(P[s] - Math.round(m[s] ?? 0)), Math.round(m[s] ?? 0), (n) => this.ctx.send({ type: 'allocateStat', stat: s, amount: n }), free <= 0);
    }
    el.append(grid);

    const pers = h('div', 'personal');
    pers.append(h('div', 'sub-title', txt('stat.personal')));
    if (!ch.personal.type || ch.personal.value === 0) {
      const choose = h('div', 'seg');
      for (const t of PERSONAL_STATS) {
        const b = btn(txt(`personal.${t}`), () => this.ctx.send({ type: 'choosePersonal', personal: t }), `seg-btn${ch.personal.type === t ? ' on' : ''}`);
        choose.append(b);
      }
      pers.append(choose);
    }
    if (ch.personal.type) {
      const g2 = h('div', 'alloc');
      const r = h('div', 'alloc-row');
      r.append(h('span', 'k', txt(`personal.${ch.personal.type}`)), h('span', 'v', String(ch.personal.value)));
      const b1 = btn('+1', () => this.ctx.send({ type: 'allocateStat', stat: 'personal', amount: 1 }), 'mini');
      const b10 = btn('+10', () => this.ctx.send({ type: 'allocateStat', stat: 'personal', amount: 10 }), 'mini');
      b1.disabled = free <= 0; b10.disabled = free <= 0;
      r.append(b1, b10);
      g2.append(r);
      pers.append(g2);
      const fx = h('div', 'mods');
      for (const [k, v] of Object.entries(CONTENT.balance.personal[ch.personal.type].mods)) fx.append(h('span', 'mod', modText(k as ModKey, (v as number) * Math.max(1, ch.personal.value))));
      pers.append(fx);
    }
    el.append(pers);

    const st = p.stats;
    const d = h('div', 'stats derived');
    const items: [string, string][] = [
      [txt('d.atk'), String(st.atk)], [txt('d.matk'), String(st.matk)], [txt('d.def'), String(st.def)], [txt('d.mdef'), String(st.mdef)],
      [txt('d.hp'), String(st.maxHp)], [txt('d.mp'), String(st.maxMp)],
      [txt('d.crit'), `${(st.critRate * 100).toFixed(1)}%`], [txt('d.critDmg'), `${Math.round(st.critDamage * 100)}%`],
      [txt('d.aspd'), `${Math.round(st.aspd * 100)}%`], [txt('d.cspd'), `${Math.round(st.cspd * 100)}%`],
      [txt('d.move'), st.moveSpeed.toFixed(2)], [txt('d.eva'), `${st.evasion.toFixed(1)}%`],
      [txt('d.element'), elName(st.element)], [txt('d.weapon'), CONTENT.weapons[weaponTypeOf(ch)]?.name ?? ''],
    ];
    for (const [k, v] of items) d.append(kv(k, v));
    el.append(d);
  }

  // ───────── スキル ─────────

  private renderSkills(el: HTMLElement) {
    const ch = this.ctx.me().char;
    const sp = freeSkillPoints(ch, CONTENT);
    const top = h('div', `points${sp > 0 ? ' has' : ''}`);
    top.append(h('span', 'k', txt('skill.sp')), h('span', 'v', String(sp)));
    el.append(top);

    const trees = Object.entries(CONTENT.trees).sort((a, b) => a[1].order - b[1].order);
    const chips = h('div', 'chips');
    chips.dataset.keepScroll = '1';
    for (const [id, t] of trees) {
      const count = Object.entries(ch.skills).filter(([s, lv]) => lv > 0 && CONTENT.skills[s]?.tree === id).length;
      const b = btn(t.name, () => { this.tree = id; this.skillSel = null; this.refresh(); }, `chip${this.tree === id ? ' on' : ''}${t.kind === 'general' ? ' general' : ''}`);
      if (count) b.append(h('i', '', String(count)));
      chips.append(b);
    }
    el.append(chips);

    const tree = CONTENT.trees[this.tree];
    const weapon: WeaponType = tree?.weapon ?? weaponTypeOf(ch);
    const slotBar = h('div', 'slotbar');
    slotBar.append(h('span', 'k', `${txt('skill.slots')}（${CONTENT.weapons[weapon]?.name ?? ''}）`));
    const slots = slotsFor(ch, weapon, CONTENT);
    slots.forEach((id, i) => {
      const s = h('span', `slot${id ? '' : ' none'}`);
      s.append(h('b', '', String(i + 1)), h('span', '', id ? CONTENT.skills[id]?.name ?? '' : '—'));
      if (id) s.append(btn('×', () => this.ctx.send({ type: 'setSkillSlot', weapon, slot: i, skill: null }), 'x'));
      slotBar.append(s);
    });
    el.append(slotBar);

    const skills = Object.entries(CONTENT.skills).filter(([, d]) => d.tree === this.tree);
    const wrap = h('div', 'skill-wrap');
    const treeEl = h('div', 'tree');
    if (skills.length === 0) treeEl.append(h('div', 'empty-tree', '—'));
    const tiers = [...new Set(skills.map(([, d]) => d.tier))].sort((a, b) => a - b);
    for (const t of tiers) {
      const rowEl = h('div', 'tier');
      rowEl.append(h('span', 'tier-label', `${txt('stat.level')}${CONTENT.balance.progression.tierLevels[t - 1] ?? 1}`));
      for (const [id, d] of skills.filter(([, x]) => x.tier === t)) {
        const lv = ch.skills[id] ?? 0;
        const err = canLearnSkill(ch, id, CONTENT);
        const locked = lv === 0 && (err === 'err.levelLow' || err === 'err.requires');
        const card = h('button', `skill-card${lv > 0 ? ' learned' : ''}${locked ? ' locked' : ''}${this.skillSel === id ? ' sel' : ''}${d.type === 'passive' ? ' passive' : ''}`);
        card.append(h('span', 'sk-name', d.name), h('span', 'sk-lv', `${lv}/${d.maxLevel}`));
        if (d.type === 'passive') card.append(h('span', 'sk-p', 'P'));
        if (!err && sp > 0) card.classList.add('can');
        card.addEventListener('click', () => { this.skillSel = id; this.refresh(); });
        rowEl.append(card);
      }
      treeEl.append(rowEl);
    }
    wrap.append(treeEl);
    const sel = this.skillSel && CONTENT.skills[this.skillSel] ? this.skillSel : null;
    wrap.append(sel ? this.skillDetail(sel, CONTENT.skills[sel]) : h('div', 'detail empty'));
    el.append(wrap);
  }

  private skillDetail(id: string, d: SkillDef): HTMLElement {
    const ch = this.ctx.me().char;
    const lv = ch.skills[id] ?? 0;
    const shown = Math.max(1, lv);
    const next = Math.min(d.maxLevel, lv + 1);
    const det = h('div', 'detail');
    det.append(h('div', 'd-name', d.name));
    const tags = h('div', 'd-tags');
    tags.append(h('span', 'tag', txt(d.type === 'passive' ? 'skill.passive' : 'skill.active')));
    tags.append(h('span', 'tag', d.weapon ? CONTENT.weapons[d.weapon]?.name ?? CONTENT.trees[d.tree].name : txt('skill.anyWeapon')));
    tags.append(h('span', 'tag', `Lv ${lv}/${d.maxLevel}`));
    det.append(tags);
    const lines = h('div', 'd-lines');
    lines.append(kv(txt('skill.req'), String(CONTENT.balance.progression.tierLevels[d.tier - 1] ?? 1)));
    for (const r of d.requires ?? []) {
      const ok = (ch.skills[r.skill] ?? 0) >= r.level;
      const row = kv(txt('skill.requires'), `${CONTENT.skills[r.skill]?.name ?? r.skill} Lv${r.level}`);
      if (!ok) row.classList.add('bad');
      lines.append(row);
    }
    const nowNext = (f: (l: number) => string) => (lv > 0 && lv < d.maxLevel ? `${f(shown)} → ${f(next)}` : f(lv > 0 ? lv : 1));
    if (d.type === 'active') {
      if (d.mp !== undefined) lines.append(kv(txt('skill.mp'), nowNext((l) => String(Math.round(scaled(d.mp, l))))));
      if (d.cooldown !== undefined) lines.append(kv(txt('skill.ct'), nowNext((l) => `${scaled(d.cooldown, l).toFixed(1)}s`)));
      const atk = d.attack ?? d.attacks?.[0];
      if (atk) {
        lines.append(kv(txt('skill.power'), nowNext((l) => `${Math.round(scaled(atk.power, l) * 100)}%`)));
        const hits = (atk.hits ?? 1) * (atk.projectile?.count ?? atk.count ?? 1);
        if (hits > 1) lines.append(kv(txt('skill.hits'), String(hits)));
        const range = atk.shape ? (atk.shape.type === 'circle' ? atk.shape.radius : atk.shape.type === 'ring' ? atk.shape.outer : atk.shape.range) : atk.projectile?.range;
        if (range) lines.append(kv(txt('skill.range'), String(range)));
        if (atk.element && atk.element !== 'weapon') lines.append(kv(txt('skill.element'), elName(atk.element)));
        for (const s of atk.status ?? []) lines.append(kv(txt('skill.status'), `${CONTENT.statuses[s.id]?.name ?? s.id} ${nowNext((l) => `${Math.round(scaled(s.chance, l))}%`)}`));
      }
      if (d.heal) lines.append(kv(txt('skill.heal'), nowNext((l) => `${Math.round(scaled(d.heal!.power, l) * 100)}%`)));
      if (d.buff) {
        lines.append(kv(txt('skill.duration'), nowNext((l) => `${Math.round(scaled(d.buff!.duration, l))}s`)));
        for (const [k, v] of Object.entries(d.buff.mods)) {
          lines.append(kv(modLabel(k as ModKey).label, nowNext((l) => `${Math.round(scaled(v, l) * 10) / 10}${modLabel(k as ModKey).unit}`)));
        }
      }
    }
    if (d.mods) {
      for (const [k, v] of Object.entries(d.mods)) {
        lines.append(kv(modLabel(k as ModKey).label, nowNext((l) => `${scaled(v, l) > 0 ? '+' : ''}${Math.round(scaled(v, l) * 10) / 10}${modLabel(k as ModKey).unit}`)));
      }
    }
    det.append(lines);
    const act = h('div', 'd-actions');
    const err = canLearnSkill(ch, id, CONTENT);
    const learn = btn(lv > 0 ? txt('skill.levelUp') : txt('skill.learn'), () => this.ctx.send({ type: 'learnSkill', skill: id }), 'btn primary');
    learn.disabled = !!err;
    act.append(learn);
    det.append(act);
    if (d.type === 'active' && lv > 0) {
      const weapon: WeaponType = d.weapon ?? weaponTypeOf(ch);
      const slots = slotsFor(ch, weapon, CONTENT);
      const sb = h('div', 'slot-pick');
      sb.append(h('span', 'k', txt('skill.slots')));
      slots.forEach((sid, i) => {
        sb.append(btn(String(i + 1), () => this.ctx.send({ type: 'setSkillSlot', weapon, slot: i, skill: id }), `mini${sid === id ? ' on' : ''}`));
      });
      det.append(sb);
    }
    return det;
  }

  // ───────── 持ち物 ─────────

  private itemCell(it: Item | null, label?: string): HTMLButtonElement {
    const c = h('button', 'cell');
    if (label) c.append(h('span', 'cell-slot', label));
    if (it) {
      c.style.borderColor = rarityColor(it.rarity);
      c.style.color = rarityColor(it.rarity);
      if (CONTENT.rarities.defs[it.rarity].glow) c.classList.add('glow');
      c.style.setProperty('--rc', rarityColor(it.rarity));
      c.append(h('span', 'cell-name', it.name + (it.refine > 0 ? ` +${it.refine}` : '')));
      if (it.locked) c.append(h('span', 'cell-lock', '🔒'));
      if (it.uid === this.itemSel) c.classList.add('sel');
      c.addEventListener('click', () => { this.itemSel = it.uid; this.refresh(); });
    } else {
      c.classList.add('none');
    }
    return c;
  }

  private renderItems(el: HTMLElement) {
    const p = this.ctx.me();
    const ch = p.char;
    const body = h('div', 'inv');
    const left = h('div', 'inv-left');
    const eq = h('div', 'equip');
    for (const slot of EQUIP_SLOTS) eq.append(this.itemCell(ch.equipment[slot], txt(`slot.${slot}`)));
    left.append(eq);
    left.append(h('div', 'sub-title', `${txt('item.equipment')}  ${ch.inventory.length} / ${CONTENT.balance.player.inventorySize}`));
    const grid = h('div', 'grid');
    grid.dataset.keepScroll = '1';
    for (const it of ch.inventory) grid.append(this.itemCell(it));
    left.append(grid);
    left.append(h('div', 'sub-title', txt('item.materials')));
    const bag = h('div', 'bag');
    for (const [id, n] of Object.entries(ch.bag)) {
      const md = CONTENT.materials[id];
      if (!md || n <= 0) continue;
      const b = h('button', `bag-item${this.itemSel === id ? ' sel' : ''}`);
      const dot = h('i', 'dot');
      dot.style.background = md.color;
      b.append(dot, h('span', '', md.name), h('b', '', `×${n}`));
      b.addEventListener('click', () => { this.itemSel = id; this.refresh(); });
      bag.append(b);
    }
    left.append(bag);
    body.append(left);
    body.append(this.itemDetail());
    el.append(body);
  }

  private itemDetail(): HTMLElement {
    const p = this.ctx.me();
    const ch = p.char;
    const det = h('div', 'detail');
    if (typeof this.itemSel === 'string') {
      const md = CONTENT.materials[this.itemSel];
      const n = ch.bag[this.itemSel] ?? 0;
      if (!md || n <= 0) { det.classList.add('empty'); return det; }
      const name = h('div', 'd-name', md.name);
      name.style.color = md.color;
      det.append(name, kv(txt('item.count'), String(n)), kv(txt('item.price'), `${md.price} G`));
      if (md.use) {
        const id = this.itemSel;
        const act = h('div', 'd-actions');
        act.append(btn(txt('item.use'), () => this.ctx.send({ type: 'useItem', id }), 'btn primary'));
        det.append(act);
      }
      return det;
    }
    const all = [...ch.inventory, ...Object.values(ch.equipment)].filter(Boolean) as Item[];
    const sel = all.find((it) => it.uid === this.itemSel);
    if (!sel) { det.classList.add('empty'); return det; }
    det.append(itemInfo(sel, ch.level));
    const equipped = Object.values(ch.equipment).some((e) => e?.uid === sel.uid);
    const act = h('div', 'd-actions');
    if (!equipped) act.append(btn(txt('item.equip'), () => this.ctx.send({ type: 'equip', uid: sel.uid }), 'btn primary'));
    else if (sel.slot !== 'weapon') act.append(btn(txt('item.unequip'), () => this.ctx.send({ type: 'unequip', slot: sel.slot as EquipSlot }), 'btn'));
    act.append(btn(sel.locked ? txt('item.unlock') : txt('item.lock'), () => this.ctx.send({ type: 'lock', uid: sel.uid, locked: !sel.locked }), 'btn'));
    det.append(act);
    return det;
  }

  // ───────── 設定 ─────────

  private renderSettings(el: HTMLElement) {
    const s = this.ctx.settings;
    const body = h('div', 'settings');
    const seg = <T extends string | boolean>(label: string, opts: [T, string][], get: () => T, set: (v: T) => void) => {
      const row = h('div', 'set-row');
      row.append(h('div', 'set-label', label));
      const g = h('div', 'seg');
      for (const [v, name] of opts) {
        g.append(btn(name, () => { set(v); this.ctx.saveSettings(); this.refresh(); }, `seg-btn${get() === v ? ' on' : ''}`));
      }
      row.append(g);
      body.append(row);
    };
    seg<DamageDisplay>(txt('settings.damage'), [['all', txt('settings.all')], ['mine', txt('settings.mine')], ['total', txt('settings.total')]], () => s.damageDisplay, (v) => (s.damageDisplay = v));
    seg<boolean>(txt('settings.sound'), [[true, txt('on')], [false, txt('off')]], () => s.sound, (v) => { s.sound = v; this.ctx.sfx.enabled = v; });
    seg<boolean>(txt('settings.shake'), [[true, txt('on')], [false, txt('off')]], () => s.shake, (v) => (s.shake = v));
    el.append(body);
  }
}

/** 装備の詳細（名前・数値・オプション） */
export function itemInfo(it: Item, level: number): HTMLElement {
  const box = h('div', 'item-info');
  const rd = CONTENT.rarities.defs[it.rarity];
  const name = h('div', 'd-name', it.name + (it.refine > 0 ? ` +${it.refine}` : ''));
  name.style.color = rd.color;
  box.append(name);
  const tags = h('div', 'd-tags');
  const rt = h('span', 'tag', rd.name);
  rt.style.borderColor = rd.color; rt.style.color = rd.color;
  tags.append(rt, h('span', 'tag', it.slot === 'weapon' ? CONTENT.weapons[it.kind as WeaponType]?.name ?? it.kind : txt(`slot.${it.slot}`)));
  if (it.element !== 'neutral') tags.append(h('span', `tag el-${it.element}`, elName(it.element)));
  box.append(tags);
  const lines = h('div', 'd-lines');
  const req = kv(txt('item.req'), String(it.reqLevel));
  if (level < it.reqLevel) req.classList.add('bad');
  lines.append(req);
  const m = itemMods({ ...it, options: [] }, CONTENT);
  for (const [k, v] of Object.entries(m)) lines.append(kv(modLabel(k as ModKey).label, String(v)));
  box.append(lines);
  if (it.options.length) {
    const ol = h('div', 'd-opts');
    for (const o of it.options) ol.append(h('div', 'opt', modText(o.key, o.value)));
    box.append(ol);
  }
  if (it.crystals.length) {
    const cr = h('div', 'd-crystals');
    cr.append(h('span', 'k', txt('item.crystals')));
    for (const c of it.crystals) cr.append(h('span', c ? 'gem on' : 'gem', '◇'));
    box.append(cr);
  }
  return box;
}
