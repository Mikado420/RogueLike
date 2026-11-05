import type { GameEvent, Player, World } from '../../shared/src/sim';
import { playerSkills } from '../../shared/src/sim';
import { CONTENT } from '../../shared/src/content';
import { itemStat } from '../../shared/src/stats';
import type { Item, ItemSlot } from '../../shared/src/types';
import { ELEMENT_NAME, rarityColor } from './colors';
import type { InputManager } from './input';
import { saveSettings, type DamageDisplay, type Settings } from './settings';
import type { Sfx } from './audio';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const SLOT_NAME: Record<ItemSlot, string> = { weapon: '武器', armor: '防具', accessory: '装飾' };
const STAT_LABEL: [keyof Item['stats'], string][] = [['atk', 'ATK'], ['matk', 'MATK'], ['def', 'DEF'], ['mdef', 'MDEF'], ['maxHp', 'MaxHP']];
const KEY_HINT = ['1', '2', '3', '4'];

interface Bar { fill: HTMLDivElement; text: HTMLSpanElement }

export class Hud {
  private root: HTMLElement;
  private bars: Record<'hp' | 'mp' | 'st', Bar>;
  private boss: { root: HTMLDivElement; name: HTMLDivElement; fill: HTMLDivElement };
  private skillBtns: { btn: HTMLButtonElement; name: HTMLSpanElement; cd: HTMLDivElement; cdText: HTMLSpanElement }[] = [];
  private death: { root: HTMLDivElement; count: HTMLDivElement };
  private toasts: HTMLDivElement;
  private modal: HTMLDivElement | null = null;
  private modalKind: 'inv' | 'settings' | null = null;
  private selectedUid = -1;
  private skillIds: (string | null)[] = [];

  constructor(private world: World, private myId: number, private input: InputManager, private settings: Settings, private sfx: Sfx) {
    this.root = document.getElementById('ui')!;
    const touch = 'ontouchstart' in window || matchMedia('(pointer: coarse)').matches;
    document.body.classList.toggle('touch', touch);

    // バー
    const bars = h('div', 'bars');
    const mk = (cls: string, label: string): Bar => {
      const row = h('div', `bar ${cls}`);
      row.append(h('span', 'bar-label', label));
      const track = h('div', 'bar-track');
      const fill = h('div', 'bar-fill');
      const text = h('span', 'bar-text');
      track.append(fill, text);
      row.append(track);
      bars.append(row);
      return { fill, text };
    };
    this.bars = { hp: mk('hp', 'HP'), mp: mk('mp', 'MP'), st: mk('st', 'ST') };
    this.root.append(bars);

    // ボス
    const boss = h('div', 'boss');
    const bname = h('div', 'boss-name');
    const btrack = h('div', 'boss-track');
    const bfill = h('div', 'boss-fill');
    btrack.append(bfill);
    boss.append(bname, btrack);
    this.root.append(boss);
    this.boss = { root: boss, name: bname, fill: bfill };

    // 右上のボタン
    const top = h('div', 'top-buttons');
    const invBtn = h('button', 'pill', '持ち物');
    invBtn.onclick = () => this.toggleModal('inv');
    const setBtn = h('button', 'pill', '設定');
    setBtn.onclick = () => this.toggleModal('settings');
    top.append(invBtn, setBtn);
    this.root.append(top);

    // 行動ボタン
    const actions = h('div', 'actions');
    const atk = h('button', 'act attack');
    atk.append(h('span', 'act-name', '攻撃'), h('span', 'key', 'J'));
    const hold = (v: boolean) => (e: PointerEvent) => { e.preventDefault(); this.sfx.unlock(); this.input.setAttackHeld(v); };
    atk.addEventListener('pointerdown', (e) => { atk.setPointerCapture(e.pointerId); hold(true)(e); });
    atk.addEventListener('pointerup', hold(false));
    atk.addEventListener('pointercancel', hold(false));
    actions.append(atk);
    for (let i = 0; i < CONTENT.balance.player.skillSlots; i++) {
      const btn = h('button', `act skill s${i}`);
      const name = h('span', 'act-name');
      const cd = h('div', 'cd');
      const cdText = h('span', 'cd-text');
      btn.append(name, cd, cdText, h('span', 'key', KEY_HINT[i]));
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.sfx.unlock(); this.input.triggerSkill(i); });
      actions.append(btn);
      this.skillBtns.push({ btn, name, cd, cdText });
    }
    const dodge = h('button', 'act dodge');
    dodge.append(h('span', 'act-name', '回避'), h('span', 'key', 'Space'));
    dodge.addEventListener('pointerdown', (e) => { e.preventDefault(); this.sfx.unlock(); this.input.triggerDodge(); });
    actions.append(dodge);
    this.root.append(actions);

    // 仮想スティック
    this.root.append(this.makeStick());

    // 死亡
    const death = h('div', 'death');
    const dt = h('div', 'death-title', '戦闘不能');
    const dc = h('div', 'death-count');
    death.append(dt, dc);
    this.root.append(death);
    this.death = { root: death, count: dc };

    this.toasts = h('div', 'toasts');
    this.root.append(this.toasts);

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'KeyB') { e.preventDefault(); this.toggleModal('inv'); }
      if (e.code === 'Escape') this.closeModal();
    });
    window.addEventListener('pointerdown', () => this.sfx.unlock(), { capture: true });
    window.addEventListener('keydown', () => this.sfx.unlock(), { capture: true });
  }

  private me(): Player {
    return this.world.players.find((p) => p.id === this.myId)!;
  }

  private makeStick(): HTMLElement {
    const zone = h('div', 'stick-zone');
    const base = h('div', 'stick-base');
    const knob = h('div', 'stick-knob');
    base.append(knob);
    zone.append(base);
    let active = -1;
    let cx = 0, cy = 0;
    const R = 56;
    const home = () => {
      base.style.left = ''; base.style.top = '';
      base.classList.remove('active');
      knob.style.transform = 'translate(-50%, -50%)';
    };
    const move = (x: number, y: number) => {
      let dx = x - cx, dy = y - cy;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      const m = Math.hypot(dx, dy) / R;
      if (m < 0.15) this.input.setStick(0, 0);
      else this.input.setStick((dx / R), (dy / R));
    };
    zone.addEventListener('pointerdown', (e) => {
      if (active !== -1) return;
      e.preventDefault();
      this.sfx.unlock();
      active = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      const zr = zone.getBoundingClientRect();
      const br = base.getBoundingClientRect();
      const inside = Math.hypot(e.clientX - (br.left + br.width / 2), e.clientY - (br.top + br.height / 2)) < br.width / 2;
      if (inside) { cx = br.left + br.width / 2; cy = br.top + br.height / 2; } else {
        cx = e.clientX; cy = e.clientY;
        base.style.left = `${cx - zr.left}px`;
        base.style.top = `${cy - zr.top}px`;
      }
      base.classList.add('active');
      move(e.clientX, e.clientY);
    });
    zone.addEventListener('pointermove', (e) => { if (e.pointerId === active) move(e.clientX, e.clientY); });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== active) return;
      active = -1;
      this.input.setStick(0, 0);
      home();
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    return zone;
  }

  handleEvents(events: GameEvent[]) {
    let refresh = false;
    for (const e of events) {
      if (e.type === 'pickup' && e.playerId === this.myId) {
        this.toast(e.item);
        refresh = true;
      }
      if (e.type === 'equip' && e.playerId === this.myId) refresh = true;
    }
    if (refresh && this.modalKind === 'inv') this.renderInventory();
  }

  private toast(item: Item) {
    const t = h('div', `toast r-${item.rarity}`, item.name);
    t.style.color = rarityColor(item.rarity);
    this.toasts.prepend(t);
    while (this.toasts.children.length > 5) this.toasts.lastElementChild!.remove();
    setTimeout(() => t.classList.add('out'), 2400);
    setTimeout(() => t.remove(), 3000);
  }

  update() {
    const p = this.me();
    const set = (b: Bar, v: number, max: number) => {
      b.fill.style.width = `${Math.max(0, Math.min(1, v / max)) * 100}%`;
      b.text.textContent = `${Math.ceil(v)} / ${max}`;
    };
    set(this.bars.hp, p.hp, p.stats.maxHp);
    set(this.bars.mp, p.mp, p.maxMp);
    set(this.bars.st, p.st, p.maxSt);

    // スキル
    const ids = playerSkills(this.world, p);
    const changed = ids.join() !== this.skillIds.join();
    this.skillIds = ids;
    ids.forEach((id, i) => {
      const b = this.skillBtns[i];
      const sd = id ? CONTENT.skills[id] : null;
      if (changed) {
        b.name.textContent = sd ? sd.name : '';
        b.btn.classList.toggle('empty', !sd);
      }
      if (!sd) { b.cd.style.background = ''; b.cdText.textContent = ''; return; }
      const cd = p.skillCd[i];
      const frac = cd > 0 ? cd / Math.max(1, p.skillCdMax[i]) : 0;
      b.cd.style.background = frac > 0 ? `conic-gradient(rgba(0,0,0,0.65) ${frac * 360}deg, transparent 0deg)` : '';
      b.cdText.textContent = cd > 0 ? (cd / CONTENT.balance.tickRate).toFixed(cd > 20 ? 0 : 1) : '';
      b.btn.classList.toggle('nomp', p.mp < sd.mp);
      b.btn.classList.toggle('ready', cd <= 0 && p.mp >= sd.mp);
    });

    // ボス
    const boss = this.world.monsters.find((m) => CONTENT.monsters[m.defId].boss && !m.dead && m.ai === 'chase');
    this.boss.root.classList.toggle('show', !!boss);
    if (boss) {
      this.boss.name.textContent = CONTENT.monsters[boss.defId].name;
      this.boss.fill.style.width = `${(boss.hp / boss.stats.maxHp) * 100}%`;
      this.boss.root.classList.toggle('enraged', boss.enraged);
    }

    // 死亡
    this.death.root.classList.toggle('show', p.dead);
    if (p.dead) this.death.count.textContent = String(Math.ceil(p.respawnTicks / CONTENT.balance.tickRate));
  }

  // ───────── モーダル ─────────

  private toggleModal(kind: 'inv' | 'settings') {
    if (this.modalKind === kind) { this.closeModal(); return; }
    this.closeModal();
    this.modalKind = kind;
    this.modal = h('div', 'modal');
    this.modal.addEventListener('pointerdown', (e) => { if (e.target === this.modal) this.closeModal(); });
    this.root.append(this.modal);
    if (kind === 'inv') this.renderInventory();
    else this.renderSettings();
  }

  private closeModal() {
    this.modal?.remove();
    this.modal = null;
    this.modalKind = null;
  }

  private panel(title: string): HTMLDivElement {
    const panel = h('div', 'panel');
    const head = h('div', 'panel-head');
    head.append(h('div', 'panel-title', title));
    const close = h('button', 'close', '×');
    close.onclick = () => this.closeModal();
    head.append(close);
    panel.append(head);
    this.modal!.replaceChildren(panel);
    return panel;
  }

  private itemCell(it: Item | null, label?: string): HTMLButtonElement {
    const c = h('button', 'cell');
    if (label) c.append(h('span', 'cell-slot', label));
    if (it) {
      c.style.borderColor = rarityColor(it.rarity);
      c.style.color = rarityColor(it.rarity);
      if (CONTENT.rarities.defs[it.rarity].glow) c.classList.add('glow');
      c.style.setProperty('--rc', rarityColor(it.rarity));
      c.append(h('span', 'cell-name', it.name + (it.refine > 0 ? ` +${it.refine}` : '')));
      if (it.uid === this.selectedUid) c.classList.add('sel');
      c.onclick = () => { this.selectedUid = it.uid; this.renderInventory(); };
    } else {
      c.classList.add('none');
    }
    return c;
  }

  private renderInventory() {
    if (!this.modal) return;
    const p = this.me();
    const panel = this.panel('持ち物');
    const body = h('div', 'inv');

    const left = h('div', 'inv-left');
    const eq = h('div', 'equip');
    for (const slot of ['weapon', 'armor', 'accessory'] as ItemSlot[]) eq.append(this.itemCell(p.equipment[slot], SLOT_NAME[slot]));
    left.append(eq);

    const st = p.stats;
    const stats = h('div', 'stats');
    const rows: [string, string][] = [
      ['ATK', String(st.atk)], ['MATK', String(st.matk)], ['DEF', String(st.def)], ['MDEF', String(st.mdef)],
      ['CRT', `${Math.round(st.critRate * 100)}%`], ['MaxHP', String(st.maxHp)],
      ['属性', ELEMENT_NAME[st.element]], ['武器', CONTENT.weapons[p.equipment.weapon?.weaponType ?? 'oneHandSword'].name],
    ];
    for (const [k, v] of rows) { const r = h('div', 'stat'); r.append(h('span', 'k', k), h('span', 'v', v)); stats.append(r); }
    left.append(stats);

    const grid = h('div', 'grid');
    for (const it of p.inventory) grid.append(this.itemCell(it));
    const cap = CONTENT.balance.player.inventorySize;
    const count = h('div', 'inv-count', `${p.inventory.length} / ${cap}`);
    left.append(count, grid);

    const detail = h('div', 'detail');
    const all = [...p.inventory, p.equipment.weapon, p.equipment.armor, p.equipment.accessory].filter(Boolean) as Item[];
    const sel = all.find((it) => it.uid === this.selectedUid);
    if (sel) {
      const equipped = Object.values(p.equipment).some((e) => e?.uid === sel.uid);
      const rd = CONTENT.rarities.defs[sel.rarity];
      const name = h('div', 'd-name', sel.name + (sel.refine > 0 ? ` +${sel.refine}` : ''));
      name.style.color = rd.color;
      detail.append(name);
      const tags = h('div', 'd-tags');
      const rt = h('span', 'tag', rd.name);
      rt.style.borderColor = rd.color; rt.style.color = rd.color;
      tags.append(rt, h('span', 'tag', sel.weaponType ? CONTENT.weapons[sel.weaponType].name : SLOT_NAME[sel.slot]));
      if (sel.element !== 'neutral') tags.append(h('span', `tag el-${sel.element}`, ELEMENT_NAME[sel.element]));
      detail.append(tags);
      const lines = h('div', 'd-lines');
      for (const [k, label] of STAT_LABEL) {
        if (!sel.stats[k]) continue;
        const r = h('div', 'stat'); r.append(h('span', 'k', label), h('span', 'v', String(itemStat(sel, k)))); lines.append(r);
      }
      detail.append(lines);
      if (sel.options.length) {
        const ol = h('div', 'd-opts');
        for (const o of sel.options) {
          const od = CONTENT.options.pool.find((x) => x.stat === o.stat)!;
          const r = h('div', 'stat opt'); r.append(h('span', 'k', od.label), h('span', 'v', `+${o.value}${od.unit}`)); ol.append(r);
        }
        detail.append(ol);
      }
      if (sel.crystals.length) {
        const cr = h('div', 'd-crystals');
        cr.append(h('span', 'k', '結晶'));
        for (const c of sel.crystals) cr.append(h('span', c ? 'gem on' : 'gem', '◇'));
        detail.append(cr);
      }
      const act = h('div', 'd-actions');
      if (!equipped) {
        const b = h('button', 'btn primary', '装備');
        b.onclick = () => this.input.pushCommand({ type: 'equip', uid: sel.uid });
        act.append(b);
      } else if (sel.slot !== 'weapon') {
        const b = h('button', 'btn', '外す');
        b.onclick = () => this.input.pushCommand({ type: 'unequip', slot: sel.slot });
        act.append(b);
      }
      detail.append(act);
    } else {
      detail.classList.add('empty');
    }

    body.append(left, detail);
    panel.append(body);
  }

  private renderSettings() {
    const panel = this.panel('設定');
    const body = h('div', 'settings');
    const seg = <T extends string | boolean>(label: string, opts: [T, string][], get: () => T, set: (v: T) => void) => {
      const row = h('div', 'set-row');
      row.append(h('div', 'set-label', label));
      const g = h('div', 'seg');
      for (const [v, name] of opts) {
        const b = h('button', 'seg-btn', name);
        if (get() === v) b.classList.add('on');
        b.onclick = () => { set(v); saveSettings(this.settings); this.renderSettings(); };
        g.append(b);
      }
      row.append(g);
      body.append(row);
    };
    seg<DamageDisplay>('ダメージ表示', [['all', '全部'], ['mine', '自分'], ['total', '合計']], () => this.settings.damageDisplay, (v) => (this.settings.damageDisplay = v));
    seg<boolean>('効果音', [[true, 'ON'], [false, 'OFF']], () => this.settings.sound, (v) => { this.settings.sound = v; this.sfx.enabled = v; });
    seg<boolean>('画面の揺れ', [[true, 'ON'], [false, 'OFF']], () => this.settings.shake, (v) => (this.settings.shake = v));
    panel.append(body);
  }
}
