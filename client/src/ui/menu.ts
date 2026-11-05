import {
  CONTENT, EQUIP_SLOTS, PERSONAL_STATS, PRIMARY_STATS, RARITIES, bagInfo, canLearnSkill, expToNext, freeSkillPoints,
  freeStatPoints, itemMods, lookSlotOf, primaryStats, scaled, slotsFor, staticMods, txt, weaponTypeOf,
  type EquipSlot, type Item, type ModKey, type Rarity, type SkillDef, type WeaponType,
} from '../../../shared/src';
import { lookInfo } from '../colors';
import { itemCell, itemInfo } from './itemview';
import { subJobsBox } from './crafting';
import { btn, h, kv } from './dom';
import { elName, modLabel, modText, type Ctx } from './ctx';
import type { DamageDisplay } from '../settings';
import { ACTIONS } from '../input';
import { keyLabel } from '../keys';

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
      { id: 'look', label: txt('menu.look') },
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
    else if ((this.tab as string) === 'look') this.renderLook(content);
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
    el.append(subJobsBox(this.ctx));
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

  private renderItems(el: HTMLElement) {
    const p = this.ctx.me();
    const ch = p.char;
    const body = h('div', 'inv');
    const left = h('div', 'inv-left');
    const eq = h('div', 'equip');
    for (const slot of EQUIP_SLOTS) {
      const it = ch.equipment[slot];
      eq.append(itemCell(it, { label: txt(`slot.${slot}`), selected: !!it && it.uid === this.itemSel, onClick: () => { if (it) { this.itemSel = it.uid; this.refresh(); } } }));
    }
    left.append(eq);
    const tools = h('div', 'inv-tools');
    tools.append(h('span', 'sub-title', `${txt('item.equipment')}  ${ch.inventory.length} / ${CONTENT.balance.player.inventorySize}`));
    const sorts = h('div', 'seg small');
    for (const k of CONTENT.storage.sortKeys) sorts.append(btn(txt(`sort.${k}`), () => this.ctx.send({ type: 'sortInventory', key: k }), 'seg-btn'));
    tools.append(sorts);
    left.append(tools);
    const grid = h('div', 'grid');
    grid.dataset.keepScroll = '1';
    for (const it of ch.inventory) grid.append(itemCell(it, { selected: it.uid === this.itemSel, onClick: () => { this.itemSel = it.uid; this.refresh(); } }));
    left.append(grid);
    const f = ch.lootFilter;
    const filt = h('div', 'filter-row');
    const pick = (label: string, cur: Rarity | null, set: (r: Rarity | null) => void) => {
      const row = h('div', 'set-row');
      row.append(h('span', 'set-label small', label));
      const g = h('div', 'seg small');
      g.append(btn(txt('filter.none'), () => set(null), `seg-btn${cur === null ? ' on' : ''}`));
      for (const r of RARITIES.slice(1, 4)) {
        const b = btn(CONTENT.rarities.defs[r].name, () => set(r), `seg-btn${cur === r ? ' on' : ''}`);
        if (cur !== r) b.style.color = CONTENT.rarities.defs[r].color;
        g.append(b);
      }
      row.append(g);
      filt.append(row);
    };
    pick(txt('filter.hide'), f.hideBelow, (r) => this.ctx.send({ type: 'setLootFilter', hideBelow: r, sellBelow: f.sellBelow }));
    pick(txt('filter.sell'), f.sellBelow, (r) => this.ctx.send({ type: 'setLootFilter', hideBelow: f.hideBelow, sellBelow: r }));
    left.append(filt);
    left.append(h('div', 'sub-title', txt('item.materials')));
    const bag = h('div', 'bag');
    for (const [id, n] of Object.entries(ch.bag)) {
      if (n <= 0) continue;
      const info = bagInfo(id);
      const b = h('button', `bag-item${this.itemSel === id ? ' sel' : ''}`);
      const dot = h('i', 'dot');
      dot.style.background = info.color;
      b.append(dot, h('span', '', info.name), h('b', '', `×${n}`));
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
      const id = this.itemSel;
      const n = ch.bag[id] ?? 0;
      if (n <= 0) { det.classList.add('empty'); return det; }
      const info = bagInfo(id);
      const name = h('div', 'd-name', info.name);
      name.style.color = info.color;
      det.append(name, kv(txt('item.count'), String(n)), kv(txt('item.price'), `${info.price} G`));
      const cr = CONTENT.crystals[id];
      if (cr) for (const [k, v] of Object.entries(cr.mods)) det.append(h('div', 'opt', modText(k as ModKey, v as number)));
      if (CONTENT.materials[id]?.use) {
        const act = h('div', 'd-actions');
        act.append(btn(txt('item.use'), () => this.ctx.send({ type: 'useItem', id }), 'btn primary'));
        det.append(act);
      }
      return det;
    }
    const all = [...ch.inventory, ...Object.values(ch.equipment)].filter(Boolean) as Item[];
    const sel = all.find((it) => it.uid === this.itemSel);
    if (!sel) { det.classList.add('empty'); return det; }
    det.append(itemInfo(sel, ch));
    const equipped = Object.values(ch.equipment).some((e) => e?.uid === sel.uid);
    if (!equipped) det.append(compareBox(sel, ch));
    const act = h('div', 'd-actions');
    if (!equipped) act.append(btn(txt('item.equip'), () => this.ctx.send({ type: 'equip', uid: sel.uid }), 'btn primary'));
    else if (sel.slot !== 'weapon') act.append(btn(txt('item.unequip'), () => this.ctx.send({ type: 'unequip', slot: sel.slot as EquipSlot }), 'btn'));
    act.append(btn(sel.locked ? txt('item.unlock') : txt('item.lock'), () => this.ctx.send({ type: 'lock', uid: sel.uid, locked: !sel.locked }), 'btn'));
    det.append(act);
    return det;
  }

  // ───────── 見た目 ─────────

  private renderLook(el: HTMLElement) {
    const ch = this.ctx.me().char;
    for (const slot of ['weapon', 'body', 'head'] as const) {
      const sec = h('div', 'npc-sec');
      sec.append(h('div', 'sub-title', txt(`slot.${slot}Look`)));
      const row = h('div', 'look-row');
      const cur = ch.appearance.selected[slot] ?? null;
      row.append(btn(txt('look.auto'), () => this.ctx.send({ type: 'setAppearance', slot, look: null }), `look-btn${cur === null ? ' on' : ''}`));
      for (const look of ch.appearance.looks) {
        if (lookSlotOf(look, CONTENT) !== slot) continue;
        const li = lookInfo(look);
        if (!li) continue;
        const b = btn(li.name, () => this.ctx.send({ type: 'setAppearance', slot, look }), `look-btn${cur === look ? ' on' : ''}`);
        const sw = h('i', 'dot');
        sw.style.background = `#${li.color.toString(16).padStart(6, '0')}`;
        b.prepend(sw);
        row.append(b);
      }
      sec.append(row);
      el.append(sec);
    }
  }

  // ───────── 設定 ─────────

  private renderSettings(el: HTMLElement) {
    const s = this.ctx.settings;
    const body = h('div', 'settings');
    const apply = () => { this.ctx.applySettings(); this.ctx.saveSettings(); };
    const seg = <T extends string | boolean>(label: string, opts: [T, string][], get: () => T, set: (v: T) => void) => {
      const row = h('div', 'set-row');
      row.append(h('div', 'set-label', label));
      const g = h('div', 'seg');
      for (const [v, name] of opts) {
        g.append(btn(name, () => { set(v); apply(); this.refresh(); }, `seg-btn${get() === v ? ' on' : ''}`));
      }
      row.append(g);
      body.append(row);
    };
    seg<DamageDisplay>(txt('settings.damage'), [['all', txt('settings.all')], ['mine', txt('settings.mine')], ['total', txt('settings.total')]], () => s.damageDisplay, (v) => (s.damageDisplay = v));
    seg<boolean>(txt('settings.sound'), [[true, txt('on')], [false, txt('off')]], () => s.sound, (v) => (s.sound = v));
    seg<boolean>(txt('settings.shake'), [[true, txt('on')], [false, txt('off')]], () => s.shake, (v) => (s.shake = v));
    seg<'high' | 'low'>(txt('settings.quality'), [['high', txt('settings.high')], ['low', txt('settings.low')]], () => s.quality, (v) => (s.quality = v));

    // 音量
    const vol = h('div', 'set-sec');
    vol.append(h('div', 'sec-title', txt('settings.volume')));
    for (const k of ['master', 'sfx', 'bgm'] as const) {
      const row = h('label', 'slider-row');
      const input = h('input');
      input.type = 'range'; input.min = '0'; input.max = '100'; input.step = '5';
      input.value = String(Math.round(s.volume[k] * 100));
      const v = h('span', 'v', input.value);
      input.addEventListener('input', () => { s.volume[k] = Number(input.value) / 100; v.textContent = input.value; this.ctx.applySettings(); });
      input.addEventListener('change', () => this.ctx.saveSettings());
      row.append(h('span', '', txt(`settings.${k}`)), input, v);
      vol.append(row);
    }
    body.append(vol);

    // キー割り当て
    const keys = h('div', 'set-sec keys-sec');
    const kh = h('div', 'set-row');
    kh.append(h('div', 'sec-title', txt('settings.keys')), btn(txt('settings.reset'), () => { s.keys = {}; apply(); this.refresh(); }, 'mini'));
    keys.append(kh);
    const grid = h('div', 'keys-grid');
    const b = this.ctx.input.currentBindings;
    for (const a of ACTIONS) {
      const row = h('div', 'key-row');
      const kb = h('button', 'key-btn', b[a].slice(0, 2).map(keyLabel).join(' / '));
      kb.addEventListener('click', (e) => {
        e.stopPropagation();
        kb.textContent = txt('settings.waiting');
        kb.classList.add('wait');
        this.ctx.input.captureNext((code) => {
          if (code) {
            const cur = this.ctx.input.currentBindings;
            // 他の操作に同じキーがあれば外す
            for (const o of ACTIONS) {
              if (o !== a && cur[o].includes(code)) s.keys[o] = cur[o].filter((c) => c !== code);
            }
            s.keys[a] = [code, ...cur[a].filter((c) => c !== code)].slice(0, 2);
            apply();
          }
          this.refresh();
        });
      });
      row.append(h('span', '', txt(`act.${a}`)), kb);
      grid.append(row);
    }
    keys.append(grid);
    body.append(keys);

    const out = h('div', 'set-sec');
    out.append(btn(txt('settings.logout'), () => this.ctx.logout(), 'btn'));
    body.append(out);
    el.append(body);
  }
}

/** 持っている装備と、同じ部位の装備中のものを比べる */
function compareBox(it: Item, ch: { equipment: Record<string, Item | null> }): HTMLElement {
  const box = h('div', 'compare');
  const cur = ch.equipment[it.slot];
  const a = itemMods(it, CONTENT);
  const b = cur ? itemMods(cur, CONTENT) : {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const d = (a[k as ModKey] ?? 0) - (b[k as ModKey] ?? 0);
    if (Math.abs(d) < 0.05) continue;
    box.append(h('span', d > 0 ? 'up' : 'down', `${modLabel(k as ModKey).label} ${d > 0 ? '+' : ''}${Math.round(d * 10) / 10}${modLabel(k as ModKey).unit}`));
  }
  return box;
}

export { itemInfo };
