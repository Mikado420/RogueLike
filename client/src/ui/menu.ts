import {
  CONTENT, EQUIP_SLOTS, PERSONAL_STATS, PRIMARY_STATS, RARITIES, bagInfo, canLearnSkill, expToNext, freeSkillPoints,
  ensureMissions, freeStatPoints, missionProgress, derivePlayerStats, itemMods, lookSlotOf, primaryStats, scaled, slotsFor, staticMods, txt, weaponTypeOf,
  type EquipSlot, type Item, type ModKey, type PrimaryStat, type Rarity, type SkillDef, type WeaponType,
} from '../../../shared/src';
import { lookInfo } from '../colors';
import { bagCell, itemCell, itemInfo } from './itemview';
import { bagIconUrl, iconImg } from './icons';
import { itemPower } from './itemkit';
import { bagDetail, itemActions } from './itemactions';
import { subJobsBox } from './crafting';
import { btn, h, kv } from './dom';
import { elName, modLabel, modText, type Ctx } from './ctx';
import type { DamageDisplay } from '../settings';
import { ACTIONS } from '../input';
import { keyLabel } from '../keys';

export type MenuTab = 'status' | 'skills' | 'items' | 'settings';

type ItemFilter = 'all' | 'weapon' | 'armor' | 'sub' | 'accessory';
const ITEM_FILTERS: ItemFilter[] = ['all', 'weapon', 'armor', 'sub', 'accessory'];
function filterItem(it: Item, f: ItemFilter): boolean {
  if (f === 'all') return true;
  if (f === 'armor') return it.slot === 'body' || it.slot === 'head';
  return it.slot === f;
}
const TABS: MenuTab[] = ['status', 'skills', 'items', 'settings'];

export class Menu {
  tab: MenuTab = 'home' as MenuTab;
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

  /** 下のタブに出すもの（残りは「その他」にまとめる） */
  private static MAIN = ['status', 'skills', 'items', 'missions'];

  private allTabs(): { id: string; label: string }[] {
    return [
      ...TABS.slice(0, 3).map((t) => ({ id: t, label: txt(`menu.${t}`) })),
      { id: 'look', label: txt('menu.look') },
      ...this.extraTabs.map((t) => ({ id: t.id, label: t.label })),
      { id: 'settings', label: txt('menu.settings') },
    ];
  }

  private render(body: HTMLElement) {
    body.classList.add('menu-body');
    const all = this.allTabs();
    if ((this.tab as string) === 'more') this.tab = 'home' as MenuTab;
    const main = all.filter((t) => Menu.MAIN.includes(t.id));
    const isHome = (this.tab as string) === 'home';
    const inSub = !isHome && !Menu.MAIN.includes(this.tab);
    const nav = h('div', 'menu-nav');
    const icon: Record<string, string> = {
      home: '<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
      status: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-5 15-5 16 0"/>',
      skills: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
      items: '<rect x="4" y="7" width="16" height="13" rx="2"/><path d="M9 7V4h6v3"/>',
      missions: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 12l2 2 4-4"/>',
    };
    const navBtn = (id: string, label: string, on: boolean, go: () => void, dot = false) => {
      const b = btn('', go, `nav-btn${on ? ' on' : ''}${dot ? ' has-dot' : ''}`);
      b.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon[id] ?? icon.home}</svg><span>${label}</span>`;
      nav.append(b);
    };
    const todo = this.todo();
    navBtn('home', txt('menu.home'), isHome || inSub, () => { this.tab = 'home' as MenuTab; this.refresh(); });
    for (const t of main) {
      const dot = (t.id === 'status' && todo.stat > 0) || (t.id === 'skills' && todo.skill > 0) || (t.id === 'missions' && todo.missions > 0);
      navBtn(t.id, t.label, this.tab === t.id, () => { this.tab = t.id as MenuTab; this.refresh(); }, dot);
    }
    const content = h('div', 'tab-body');
    body.append(content, nav);
    if (isHome) { this.renderHome(content, all); return; }
    if (inSub) content.append(btn(`‹ ${txt('menu.home')}`, () => { this.tab = 'home' as MenuTab; this.refresh(); }, 'back-btn'));
    const extra = this.extraTabs.find((t) => t.id === this.tab);
    if (extra) extra.render(content);
    else if (this.tab === 'status') this.renderStatus(content);
    else if (this.tab === 'skills') this.renderSkills(content);
    else if (this.tab === 'items') this.renderItems(content);
    else if ((this.tab as string) === 'look') this.renderLook(content);
    else this.renderSettings(content);
  }

  /** やることの数（振れるポイント・SP・受け取れる依頼） */
  private todo(): { stat: number; skill: number; missions: number } {
    const p = this.ctx.me();
    const ch = p.char;
    let missions = 0;
    try {
      ensureMissions(this.ctx.world, p);
      for (const m of [...ch.missions.daily, ...ch.missions.weekly]) if (!m.claimed && missionProgress(ch, m) >= m.n) missions++;
    } catch { /* 依頼がまだない */ }
    return { stat: freeStatPoints(ch, CONTENT), skill: freeSkillPoints(ch, CONTENT), missions };
  }

  /** メニューのホーム：キャラの要約と、やること・ほかの画面のタイル */
  private renderHome(el: HTMLElement, all: { id: string; label: string }[]) {
    const p = this.ctx.me();
    const ch = p.char;
    const card = h('div', 'me-card');
    const top = h('div', 'me-top');
    const wpn = CONTENT.weapons[weaponTypeOf(ch)]?.name ?? '';
    const name = h('div', 'me-name');
    name.append(h('b', '', ch.name), h('span', 'muted small', `${wpn}・Lv ${ch.level}`));
    top.append(name, h('span', 'gold-chip', `${ch.gold.toLocaleString()} G`));
    card.append(top);
    const need = expToNext(ch.level, CONTENT);
    const max = ch.level >= CONTENT.balance.progression.maxLevel;
    const bar = h('div', 'mbar');
    const fill = h('div', 'mfill exp');
    fill.style.width = `${max ? 100 : Math.min(1, ch.exp / Math.max(1, need)) * 100}%`;
    bar.append(fill);
    card.append(bar);
    const ps = p.stats;
    card.append(h('div', 'muted small', `${max ? 'MAX' : txt('home.next', Math.round((ch.exp / Math.max(1, need)) * 100))}　ATK ${Math.round(ps.atk)}・MATK ${Math.round(ps.matk)}・DEF ${Math.round(ps.def)}・HP ${Math.round(ps.maxHp)}`));
    el.append(card);
    const todo = this.todo();
    const size = CONTENT.balance.player.inventorySize;
    el.append(h('div', 'sub-title', txt('home.todo')));
    const grid = h('div', 'hub-grid');
    const tile = (id: string, title: string, sub: string, hot: boolean, badge = 0) => {
      const b = btn('', () => { this.tab = id as MenuTab; this.refresh(); }, `hub-tile small${hot ? ' hot' : ''}`);
      b.append(h('span', 'hub-title', title), h('span', 'hub-sub', sub));
      if (badge > 0) b.append(h('span', 'hub-badge', String(badge)));
      grid.append(b);
    };
    tile('status', txt('menu.status'), todo.stat ? txt('home.statPoints', todo.stat) : txt('home.statNone'), todo.stat > 0, todo.stat);
    tile('skills', txt('menu.skills'), todo.skill ? txt('home.skillPoints', todo.skill) : txt('home.skillNone'), todo.skill > 0, todo.skill);
    if (all.some((t) => t.id === 'missions')) tile('missions', all.find((t) => t.id === 'missions')!.label, todo.missions ? txt('home.claimable', todo.missions) : txt('home.missionsNone'), todo.missions > 0, todo.missions);
    const full = ch.inventory.length >= size - 5;
    tile('items', txt('menu.items'), `${ch.inventory.length} / ${size}${full ? `　${txt('home.almostFull')}` : ''}`, full);
    el.append(grid);
    const others = all.filter((t) => !Menu.MAIN.includes(t.id) && t.id !== 'missions');
    if (others.length) {
      el.append(h('div', 'sub-title', txt('home.others')));
      const og = h('div', 'hub-grid three');
      for (const t of others) og.append(btn(t.label, () => { this.tab = t.id as MenuTab; this.refresh(); }, 'hub-tile mini'));
      el.append(og);
    }
  }

  /** 今の武器に合わせて、残りのポイントを振る（主な能力 6・次 2・VIT 2 の割合） */
  private autoAllocate() {
    const ch = this.ctx.me().char;
    const free = freeStatPoints(ch, CONTENT);
    if (free <= 0) return;
    const wd = CONTENT.weapons[weaponTypeOf(ch)];
    const sc = (wd?.scaling?.[wd.damageType === 'magic' ? 'matk' : 'atk'] ?? { str: 1 }) as Partial<Record<PrimaryStat, number>>;
    const order = (Object.entries(sc) as [PrimaryStat, number][]).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const plan = new Map<PrimaryStat, number>();
    const main = order[0] ?? 'str', second = order[1] ?? 'vit';
    const nVit = Math.floor(free * 0.2), nSecond = second === 'vit' ? 0 : Math.floor(free * 0.2);
    plan.set('vit', nVit);
    if (nSecond) plan.set(second, nSecond);
    plan.set(main, (plan.get(main) ?? 0) + free - nVit - nSecond);
    for (const [stat, n] of plan) if (n > 0) this.ctx.send({ type: 'allocateStat', stat, amount: n });
  }

  /** 能力を 1 上げたときに大きく変わる値（ATK 24→26 など） */
  private preview(stat: PrimaryStat): string {
    const p = this.ctx.me();
    const now = p.stats;
    const ch2 = { ...p.char, stats: { ...p.char.stats, [stat]: p.char.stats[stat] + 1 } };
    const next = derivePlayerStats(ch2, p.statuses, CONTENT);
    const keys: [keyof typeof now, string, number][] = [
      ['atk', txt('d.atk'), 1], ['matk', txt('d.matk'), 1], ['maxHp', txt('d.hp'), 0.25], ['def', txt('d.def'), 1],
      ['maxMp', txt('d.mp'), 0.25], ['mdef', txt('d.mdef'), 1], ['critRate', txt('d.crit'), 100], ['aspd', txt('d.aspd'), 100], ['evasion', txt('d.eva'), 1],
    ];
    const diffs = keys.map(([k, label, w]) => ({ k, label, d: ((next[k] as number) - (now[k] as number)) * w })).filter((x) => x.d > 0.001).sort((a, b) => b.d - a.d).slice(0, 2);
    const fmt = (k: keyof typeof now, v: number) => (k === 'critRate' ? `${(v * 100).toFixed(1)}%` : k === 'aspd' ? `${Math.round(v * 100)}%` : k === 'evasion' ? `${v.toFixed(1)}%` : String(Math.round(v)));
    return diffs.map((x) => `${x.label} ${fmt(x.k, now[x.k] as number)}→${fmt(x.k, next[x.k] as number)}`).join('  ');
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
    if (free > 0) ptsRow.append(btn(txt('stat.auto'), () => this.autoAllocate(), 'auto-btn'));
    el.append(ptsRow);

    const m = staticMods(ch, CONTENT);
    const P = primaryStats(ch, m, CONTENT);
    const grid = h('div', 'alloc');
    const row = (label: string, desc: string, value: string, bonus: number, onAdd: (n: number) => void, after: string) => {
      const r = h('div', 'alloc-row');
      const k = h('span', 'k', label);
      k.append(h('small', 'desc', desc));
      r.append(k);
      const v = h('span', 'v', value);
      if (bonus) v.append(h('em', '', ` +${bonus}`));
      if (after && free > 0) v.append(h('small', 'after', after));
      r.append(v);
      const b1 = btn('+1', () => onAdd(1), 'mini');
      const b10 = btn('+10', () => onAdd(10), 'mini');
      b1.disabled = free < 1; b10.disabled = free < 10;
      r.append(b1, b10);
      grid.append(r);
    };
    for (const s of PRIMARY_STATS) {
      row(txt(`stat.${s}`), txt(`stat.desc.${s}`), String(P[s] - Math.round(m[s] ?? 0)), Math.round(m[s] ?? 0), (n) => this.ctx.send({ type: 'allocateStat', stat: s, amount: n }), free > 0 ? this.preview(s) : '');
    }
    el.append(grid);

    const pers = h('div', 'personal');
    pers.append(h('div', 'sub-title', txt('stat.personal')));
    if (!ch.personal.type || ch.personal.value === 0) {
      const choose = h('div', 'seg');
      for (const t of PERSONAL_STATS) {
        const b = btn(txt(`personal.${t}`), () => this.ctx.send({ type: 'choosePersonal', personal: t }), `seg-btn${ch.personal.type === t ? ' on' : ''}`);
        b.title = Object.entries(CONTENT.balance.personal[t].mods).map(([k, v]) => modText(k as ModKey, v as number)).join(' ');
        b.append(h('small', 'desc', txt(`personal.desc.${t}`)));
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
      b1.disabled = free < 1; b10.disabled = free < 10;
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
    const more = document.createElement('details');
    more.className = 'fold';
    more.append(h('summary', '', txt('stat.details')), d);
    el.append(more);
    const sub = document.createElement('details');
    sub.className = 'fold';
    sub.append(h('summary', '', txt('stat.subjobs')), subJobsBox(this.ctx));
    el.append(sub);
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

  /** 持ち物の絞り込み（部位）と並び（表示だけの「強さ順」） */
  private itemFilter: ItemFilter = 'all';
  private itemOrder: 'stored' | 'power' = 'stored';

  private renderItems(el: HTMLElement) {
    const p = this.ctx.me();
    const ch = p.char;
    const body = h('div', 'inv');
    const left = h('div', 'inv-left');
    const pick = (sel: number | string) => { this.itemSel = this.itemSel === sel ? null : sel; this.refresh(); };

    // 消耗品：素材に埋もれないよう一番上に分けて、行ごとに「使う」
    const usable = Object.entries(ch.bag).filter(([id, n]) => n > 0 && CONTENT.materials[id]?.use && !CONTENT.materials[id].use!.capture);
    if (usable.length) {
      left.append(h('div', 'sub-title', txt('item.consumables')));
      const cons = h('div', 'use-list');
      for (const [id, n] of usable) {
        const row = h('div', `use-row${this.itemSel === id ? ' sel' : ''}`);
        const name = h('button', 'use-name');
        name.append(iconImg(bagIconUrl(id), 'use-ico'), h('span', 'use-label', bagInfo(id).name), h('b', 'use-n', `×${n}`));
        name.addEventListener('click', () => pick(id));
        row.append(name, btn(txt('item.use'), () => this.ctx.send({ type: 'useItem', id }), 'mini primary use-btn'));
        cons.append(row);
      }
      left.append(cons);
    }

    // 装備中
    left.append(h('div', 'sub-title', txt('item.equipped')));
    const eq = h('div', 'equip');
    for (const slot of EQUIP_SLOTS) {
      const it = ch.equipment[slot];
      eq.append(itemCell(it, { label: txt(`slot.${slot}`), selected: !!it && it.uid === this.itemSel, equipped: true, onClick: it ? () => pick(it.uid) : undefined }));
    }
    left.append(eq);

    // 装備品：部位で絞り、並べ替える
    const tools = h('div', 'inv-tools');
    const size = CONTENT.balance.player.inventorySize;
    const count = h('span', `sub-title${ch.inventory.length >= size ? ' bad' : ch.inventory.length >= size - 5 ? ' warn' : ''}`, `${txt('item.equipment')}  ${ch.inventory.length} / ${size}`);
    tools.append(count);
    const order = h('div', 'seg small');
    order.append(btn(txt('sort.power'), () => { this.itemOrder = 'power'; this.refresh(); }, `seg-btn${this.itemOrder === 'power' ? ' on' : ''}`));
    for (const k of CONTENT.storage.sortKeys) order.append(btn(txt(`sort.${k}`), () => { this.itemOrder = 'stored'; this.ctx.send({ type: 'sortInventory', key: k }); }, 'seg-btn'));
    tools.append(order);
    left.append(tools);
    const chips = h('div', 'fchips');
    for (const f of ITEM_FILTERS) {
      const n = ch.inventory.filter((it) => filterItem(it, f)).length;
      if (f !== 'all' && n === 0) continue;
      chips.append(btn(`${txt(`ifilter.${f}`)} ${n}`, () => { this.itemFilter = f; this.refresh(); }, `fchip${this.itemFilter === f ? ' on' : ''}`));
    }
    left.append(chips);
    left.append(h('div', 'legend', txt('item.cmpLegend')));
    let list = ch.inventory.filter((it) => filterItem(it, this.itemFilter));
    if (this.itemOrder === 'power') list = [...list].sort((a, b) => itemPower(b) - itemPower(a));
    const grid = h('div', 'grid');
    grid.dataset.keepScroll = '1';
    for (const it of list) grid.append(itemCell(it, { selected: it.uid === this.itemSel, compare: ch, onClick: () => pick(it.uid) }));
    if (!list.length) grid.append(h('div', 'muted empty-note', txt('item.none')));
    left.append(grid);

    // 素材・結晶・捕獲石
    const mats = Object.entries(ch.bag).filter(([id, n]) => n > 0 && !usable.some(([u]) => u === id) && CONTENT.materials[id]?.kind !== 'key');
    if (mats.length) {
      left.append(h('div', 'sub-title', txt('item.materials')));
      const bag = h('div', 'grid bag-grid');
      for (const [id, n] of mats) bag.append(bagCell(id, n, { selected: this.itemSel === id, onClick: () => pick(id) }));
      left.append(bag);
    }

    // 拾うときの設定（たまにしか触らないので畳む）
    const f = ch.lootFilter;
    const fold = h('details', 'fold');
    fold.append(h('summary', '', txt('filter.title')));
    const filt = h('div', 'filter-row');
    const pickR = (label: string, cur: Rarity | null, set: (r: Rarity | null) => void) => {
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
    pickR(txt('filter.hide'), f.hideBelow, (r) => this.ctx.send({ type: 'setLootFilter', hideBelow: r, sellBelow: f.sellBelow }));
    pickR(txt('filter.sell'), f.sellBelow, (r) => this.ctx.send({ type: 'setLootFilter', hideBelow: f.hideBelow, sellBelow: r }));
    fold.append(filt);
    if (f.hideBelow || f.sellBelow) fold.open = true;
    left.append(fold);

    body.append(left);
    body.append(this.itemDetail());
    el.append(body);
  }

  /** 選んだもの（装備・袋のアイテム）の詳細。スマホでは下から出るシートになる */
  private itemDetail(): HTMLElement {
    const p = this.ctx.me();
    const ch = p.char;
    const det = h('div', 'detail');
    const closeRow = () => {
      const x = btn('', () => { this.itemSel = null; this.refresh(); }, 'sheet-close');
      x.setAttribute('aria-label', txt('ui.close'));
      x.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      det.classList.add('sheet');
      det.append(h('div', 'sheet-grip'), x);
    };
    if (typeof this.itemSel === 'string') {
      const id = this.itemSel;
      const n = ch.bag[id] ?? 0;
      if (n <= 0) { det.classList.add('empty'); return det; }
      closeRow();
      det.append(bagDetail(this.ctx, id));
      return det;
    }
    const all = [...ch.inventory, ...Object.values(ch.equipment)].filter(Boolean) as Item[];
    const sel = all.find((it) => it.uid === this.itemSel);
    if (!sel) { det.classList.add('empty'); det.append(h('div', 'muted', txt('item.pickHint'))); return det; }
    closeRow();
    det.append(itemInfo(sel, ch));
    const equipped = Object.values(ch.equipment).some((e) => e?.uid === sel.uid);
    if (!equipped) det.append(compareBox(sel, ch));
    const act = h('div', 'd-actions');
    if (!equipped) {
      const b = btn(txt('item.equip'), () => this.ctx.send({ type: 'equip', uid: sel.uid }), 'btn primary grow');
      if (ch.level < sel.reqLevel) { b.disabled = true; b.textContent = txt('item.needLv', sel.reqLevel); }
      act.append(b);
    } else if (sel.slot !== 'weapon') act.append(btn(txt('item.unequip'), () => this.ctx.send({ type: 'unequip', slot: sel.slot as EquipSlot }), 'btn grow'));
    act.append(btn(sel.locked ? txt('item.unlock') : txt('item.lock'), () => this.ctx.send({ type: 'lock', uid: sel.uid, locked: !sel.locked }), 'btn'));
    det.append(act);
    det.append(itemActions(this.ctx, sel, equipped, () => { this.itemSel = null; }));
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
    keys.append(h('div', 'mouse-help', txt('settings.mouseHelp')));
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
/** 今の装備と比べた差（増えるものを上に） */
function compareBox(it: Item, ch: { equipment: Record<string, Item | null> }): HTMLElement {
  const box = h('div', 'compare');
  const cur = ch.equipment[it.slot];
  box.append(h('div', 'cmp-head', cur ? txt('item.vs', cur.name + (cur.refine > 0 ? ` +${cur.refine}` : '')) : txt('item.vsNone')));
  const a = itemMods(it, CONTENT);
  const b = cur ? itemMods(cur, CONTENT) : {};
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])] as ModKey[];
  const rows = keys.map((k) => ({ k, d: (a[k] ?? 0) - (b[k] ?? 0) })).filter((r) => Math.abs(r.d) >= 0.05).sort((x, y) => y.d - x.d);
  for (const { k, d } of rows) {
    const { label, unit } = modLabel(k);
    const row = h('div', `cmp-row ${d > 0 ? 'up' : 'down'}`);
    row.append(h('span', '', label), h('b', '', `${d > 0 ? '+' : ''}${Math.round(d * 10) / 10}${unit}`));
    box.append(row);
  }
  if (!rows.length) box.append(h('div', 'muted', txt('item.same')));
  return box;
}

export { itemInfo };
