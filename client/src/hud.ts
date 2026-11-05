import {
  CONTENT, beatTicks, chargeLevel, comboMax, expToNext, freeSkillPoints, freeStatPoints, interactTarget, magazineSize,
  slotSkill, txt, weaponTypeOf, currentWeather, dayPhase, contribution, bagInfo, type GameEvent, type Item, type Player, type World,
} from '../../shared/src';
import { rarityColor, statusColor } from './colors';
import type { Action, InputManager } from './input';
import { keyLabel } from './keys';
import type { Sfx } from './audio';
import { h } from './ui/dom';

interface Bar { fill: HTMLDivElement; text: HTMLSpanElement }

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** 画面に常に出ているもの（バー・ボタン・通知） */
export class Hud {
  private root: HTMLElement;
  private bars: Record<'hp' | 'mp' | 'st', Bar>;
  private lvText: HTMLSpanElement;
  private expFill: HTMLDivElement;
  private goldText: HTMLSpanElement;
  private buffs: HTMLDivElement;
  private boss: { root: HTMLDivElement; name: HTMLDivElement; fill: HTMLDivElement; brk: HTMLDivElement };
  private skillBtns: { btn: HTMLButtonElement; name: HTMLSpanElement; cd: HTMLDivElement; cdText: HTMLSpanElement }[] = [];
  private interactBtn: HTMLButtonElement;
  private interactName: HTMLSpanElement;
  private potionBtn: HTMLButtonElement;
  private potionCount: HTMLSpanElement;
  private menuBadge: HTMLSpanElement;
  private death: { root: HTMLDivElement; count: HTMLDivElement };
  private toasts: HTMLDivElement;
  private skillKey = '';
  private res: HTMLDivElement;
  private resKey = '';
  private areaInfo: HTMLDivElement;
  private instInfo: HTMLDivElement;
  private leaveBtn: HTMLButtonElement;
  private banner: HTMLDivElement;
  onMenu: (() => void) | null = null;
  onPotion: (() => void) | null = null;
  onCapture: (() => void) | null = null;
  private captureBtn: HTMLButtonElement;
  private keyChips: [HTMLElement, Action][] = [];
  private tut: { root: HTMLDivElement; head: HTMLDivElement; name: HTMLDivElement; keys: HTMLDivElement; fill: HTMLDivElement };
  private tutKey = '';
  private touch = false;

  constructor(private world: World, private myId: number, private input: InputManager, private sfx: Sfx) {
    this.root = document.getElementById('ui')!;
    this.root.replaceChildren();
    const touch = 'ontouchstart' in window || matchMedia('(pointer: coarse)').matches;
    document.body.classList.toggle('touch', touch);
    this.touch = touch;

    const bars = h('div', 'bars');
    const top = h('div', 'bar-top');
    this.lvText = h('span', 'lv');
    this.goldText = h('span', 'gold');
    top.append(this.lvText, this.goldText);
    bars.append(top);
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
    const exp = h('div', 'exp-track');
    this.expFill = h('div', 'exp-fill');
    exp.append(this.expFill);
    bars.append(exp);
    this.buffs = h('div', 'buffs');
    bars.append(this.buffs);
    this.root.append(bars);

    const boss = h('div', 'boss');
    const bname = h('div', 'boss-name');
    const btrack = h('div', 'boss-track');
    const bfill = h('div', 'boss-fill');
    btrack.append(bfill);
    const brkTrack = h('div', 'break-track');
    const brk = h('div', 'break-fill');
    brkTrack.append(brk);
    boss.append(bname, btrack, brkTrack);
    this.root.append(boss);
    this.boss = { root: boss, name: bname, fill: bfill, brk };

    const topBtns = h('div', 'top-buttons');
    const menu = h('button', 'pill', txt('hud.menu'));
    this.menuBadge = h('span', 'badge');
    menu.append(this.menuBadge);
    menu.addEventListener('click', () => { this.sfx.unlock(); this.onMenu?.(); });
    topBtns.append(menu);
    this.root.append(topBtns);

    const actions = h('div', 'actions');
    const atk = h('button', 'act attack');
    atk.append(h('span', 'act-name', txt('hud.attack')), this.chip('attack'));
    const hold = (v: boolean) => (e: PointerEvent) => { e.preventDefault(); this.sfx.unlock(); this.input.setAttackHeld(v); };
    atk.addEventListener('pointerdown', (e) => { atk.setPointerCapture(e.pointerId); hold(true)(e); });
    atk.addEventListener('pointerup', hold(false));
    atk.addEventListener('pointercancel', hold(false));
    actions.append(atk);
    for (let i = 0; i < CONTENT.balance.player.skillSlots; i++) {
      const b = h('button', `act skill s${i}`);
      const name = h('span', 'act-name');
      const cd = h('div', 'cd');
      const cdText = h('span', 'cd-text');
      b.append(name, cd, cdText, this.chip(`skill${i + 1}` as Action));
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.sfx.unlock(); this.input.triggerSkill(i); });
      actions.append(b);
      this.skillBtns.push({ btn: b, name, cd, cdText });
    }
    const dodge = h('button', 'act dodge');
    dodge.append(h('span', 'act-name', txt('hud.dodge')), this.chip('dodge'));
    dodge.addEventListener('pointerdown', (e) => { e.preventDefault(); this.sfx.unlock(); this.input.triggerDodge(); });
    actions.append(dodge);
    this.res = h('div', 'weapon-res');
    actions.append(this.res);
    this.root.append(actions);

    // 話す・薬
    const side = h('div', 'side-actions');
    this.interactBtn = h('button', 'act2 interact');
    this.interactName = h('span', 'act-name');
    this.interactBtn.append(this.interactName, this.chip('interact'));
    this.interactBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.sfx.unlock(); this.input.triggerInteract(); });
    this.potionBtn = h('button', 'act2 potion');
    this.potionCount = h('span', 'count');
    this.potionBtn.append(h('span', 'act-name', txt('hud.potion')), this.potionCount, this.chip('potion'));
    this.potionBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.sfx.unlock(); this.onPotion?.(); });
    this.captureBtn = h('button', 'act2 capture');
    this.captureBtn.append(h('span', 'act-name', txt('hud.capture')), this.chip('capture'));
    this.captureBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.sfx.unlock(); this.onCapture?.(); });
    side.append(this.interactBtn, this.potionBtn, this.captureBtn);
    this.root.append(side);

    this.root.append(this.makeStick());

    const death = h('div', 'death');
    const dc = h('div', 'death-count');
    death.append(h('div', 'death-title', txt('hud.dead')), dc);
    this.root.append(death);
    this.death = { root: death, count: dc };

    this.toasts = h('div', 'toasts');
    this.root.append(this.toasts);
    this.areaInfo = h('div', 'area-info');
    this.root.append(this.areaInfo);
    this.banner = h('div', 'banner');
    this.root.append(this.banner);
    this.instInfo = h('div', 'inst-info');
    this.root.append(this.instInfo);
    this.leaveBtn = h('button', 'pill leave', txt('hud.leave'));
    this.leaveBtn.addEventListener('click', () => this.input.pushCommand({ type: 'leaveInstance' }));
    topBtns.prepend(this.leaveBtn);

    const tut = h('div', 'tutorial');
    const tHead = h('div', 'tut-head');
    const tName = h('div', 'tut-name');
    const tKeys = h('div', 'tut-keys');
    const tTrack = h('div', 'tut-track');
    const tFill = h('div', 'tut-fill');
    tTrack.append(tFill);
    const skip = h('button', 'tut-skip', txt('tut.skip'));
    skip.addEventListener('click', () => this.input.pushCommand({ type: 'skipTutorial' }));
    tut.append(tHead, tName, tKeys, tTrack, skip);
    this.root.append(tut);
    this.tut = { root: tut, head: tHead, name: tName, keys: tKeys, fill: tFill };
  }

  private chip(a: Action): HTMLElement {
    const s = h('span', 'key', keyLabel(this.input.currentBindings[a][0] ?? ''));
    this.keyChips.push([s, a]);
    return s;
  }

  /** キー割り当てを変えたら呼ぶ */
  refreshKeys() {
    for (const [s, a] of this.keyChips) s.textContent = keyLabel(this.input.currentBindings[a][0] ?? '');
    this.tutKey = '';
  }

  private updateTutorial(p: Player) {
    const t = p.char.tutorial;
    const steps = CONTENT.tutorial.steps;
    const s = t && !t.done ? steps[t.step] : null;
    this.tut.root.classList.toggle('show', !!s);
    if (!s) return;
    const key = `${t.step}`;
    if (key !== this.tutKey) {
      this.tutKey = key;
      this.tut.head.textContent = `${txt('tut.title')}  ${t.step + 1} / ${steps.length}`;
      this.tut.name.textContent = s.text;
      const chips: string[] = [];
      const b = this.input.currentBindings;
      if (s.dir) chips.push(txt(`dir.${s.dir}`));
      else if (s.keys.includes('menu')) chips.push(this.touch ? txt('hud.menu') : keyLabel(b.menu[0]), txt(`menu.${s.tab}`));
      else if (!this.touch) for (const a of s.keys) chips.push(keyLabel(b[a as Action]?.[0] ?? ''));
      this.tut.keys.replaceChildren(...chips.map((c, i) => h('span', i > 0 && s.keys.includes('menu') ? 'tk tk-tab' : 'tk', c)));
    }
    this.tut.fill.style.width = `${Math.min(1, t.count / s.n) * 100}%`;
    this.tut.fill.parentElement!.classList.toggle('hide', s.n <= 1);
  }

  setWorld(w: World) { this.world = w; }

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
      else this.input.setStick(dx / R, dy / R);
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
    for (const e of events) {
      if (e.type === 'pickup' && e.playerId === this.myId) {
        if (e.item) this.itemToast(e.item);
        else if (e.bag) this.toast(`${CONTENT.materials[e.bag.id]?.name ?? e.bag.id} ×${e.bag.n}`, CONTENT.materials[e.bag.id]?.color ?? '#fff');
      }
      if (e.type === 'notice' && e.playerId === this.myId) {
        this.toast(txt(e.key, ...(e.args ?? [])), e.key.startsWith('err.') ? '#ff8a7a' : '#9fe8ff');
      }
      if (e.type === 'levelUp' && e.playerId === this.myId) this.toast(txt('notice.levelUp', e.level), '#ffe14a');
      if (e.type === 'refine' && e.playerId === this.myId) this.toast(txt(e.success ? 'smith.success' : 'smith.failed', e.level), e.success ? '#ffe14a' : '#ff8a7a');
      if (e.type === 'worldNotice') this.showBanner(txt(e.key, ...e.args), !!e.rare);
      if (e.type === 'petLevel' && e.playerId === this.myId) {
        const pet = this.world.players.find((x) => x.id === this.myId)?.char.pets.find((x) => x.uid === e.uid);
        if (pet) this.toast(txt('notice.petLevel', pet.name, e.level), '#9be04a');
      }
      if (e.type === 'gather' && e.playerId === this.myId) this.toast(txt('notice.gather', bagInfo(e.id).name, e.n), bagInfo(e.id).color);
      if (e.type === 'subLevel' && e.playerId === this.myId) this.toast(txt('notice.subLevel', txt(`sub.${e.job}`), e.level), '#9be04a');
      if (e.type === 'crafted' && e.playerId === this.myId && e.kind === 'smith') {
        const it = this.world.players.find((x) => x.id === this.myId)?.char.inventory.find((x) => x.uid === e.uid);
        if (it) this.itemToast(it);
      }
      if (e.type === 'instance' && e.playerId === this.myId) {
        if (e.what === 'cleared') this.showBanner(`${txt('inst.cleared')}${e.time !== undefined ? `  ${fmtTime(e.time)}` : ''}${e.best ? `  ${txt('inst.best')}` : ''}`, true);
        if (e.what === 'failed') this.showBanner(txt('inst.failed'), false);
        if (e.what === 'floor') this.showBanner(txt('inst.floor', e.floor ?? 0), false);
      }
      if (e.type === 'achievement' && e.playerId === this.myId) {
        const a = CONTENT.achievements.find((x) => x.id === e.id);
        if (a) this.toast(`★ ${a.name}${a.title ? `  ${CONTENT.titles[a.title]?.name ?? ''}` : ''}`, '#ffe28a', 'r-legend');
      }
      if (e.type === 'areaChanged' && e.playerId === this.myId) this.showBanner(CONTENT.areas[e.area]?.name ?? '', false);
      if (e.type === 'tutorial' && e.playerId === this.myId && e.done) this.showBanner(txt('tut.done'), true);
      if (e.type === 'autoSell' && e.playerId === this.myId) this.toast(txt('notice.autoSell', e.gold), '#ffd76a');
    }
  }

  /** 武器の状態（溜め・残弾・コンボ・拍） */
  private updateWeaponRes(p: Player) {
    const mech = CONTENT.weapons[weaponTypeOf(p.char)]?.mechanic;
    let key = mech?.type ?? 'none';
    let html: (() => HTMLElement[]) | null = null;
    switch (mech?.type) {
      case 'charge': {
        const lvl = chargeLevel(this.world, p);
        key += lvl + (p.charge > 0 ? 'c' : '');
        html = () => [0, 1, 2].map((i) => h('i', `pip${i < lvl ? ' on' : ''}${p.charge > 0 ? ' active' : ''}`));
        break;
      }
      case 'ammo': {
        const mag = magazineSize(this.world, p);
        key += `${p.ammo}/${mag}/${p.reloadTicks > 0}`;
        html = () => [h('span', p.reloadTicks > 0 ? 'res-text warn' : 'res-text', p.reloadTicks > 0 ? txt('hud.reload') : `${Math.max(0, p.ammo)} / ${mag}`)];
        break;
      }
      case 'combo': {
        key += `${p.combo}`;
        html = () => p.combo > 0 ? [h('span', 'res-text combo', `${txt('hud.combo')} ${p.combo}`), h('span', 'res-sub', `/${comboMax(this.world, p)}`)] : [];
        break;
      }
      case 'rhythm': {
        const b = beatTicks(this.world, mech.bpm);
        const ph = this.world.tick % b;
        const on = ph <= mech.window || ph >= b - mech.window;
        key += `${p.rhythm}/${on}`;
        html = () => [h('i', `beat${on ? ' on' : ''}`), h('span', 'res-text', `♪ ${p.rhythm}`)];
        break;
      }
    }
    if (key === this.resKey) return;
    this.resKey = key;
    this.res.className = `weapon-res ${mech?.type ?? ''}`;
    this.res.replaceChildren(...(html ? html() : []));
  }

  private bannerTimer = 0;
  showBanner(text: string, rare: boolean) {
    this.banner.textContent = text;
    this.banner.className = `banner show${rare ? ' rare' : ''}`;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('show'), 3500);
  }

  itemToast(item: Item) {
    this.toast(item.name, rarityColor(item.rarity), `r-${item.rarity}`);
  }

  toast(text: string, color: string, cls = '') {
    const t = h('div', `toast ${cls}`, text);
    t.style.color = color;
    this.toasts.prepend(t);
    while (this.toasts.children.length > 6) this.toasts.lastElementChild!.remove();
    setTimeout(() => t.classList.add('out'), 2400);
    setTimeout(() => t.remove(), 3000);
  }

  update() {
    const p = this.me();
    const ch = p.char;
    const set = (b: Bar, v: number, max: number) => {
      b.fill.style.width = `${Math.max(0, Math.min(1, v / max)) * 100}%`;
      b.text.textContent = `${Math.ceil(v)} / ${max}`;
    };
    this.updateTutorial(p);
    set(this.bars.hp, p.hp, p.stats.maxHp);
    set(this.bars.mp, p.mp, p.stats.maxMp);
    set(this.bars.st, p.st, p.stats.maxSt);
    this.lvText.textContent = `${txt('stat.level')} ${ch.level}${ch.rebirths > 0 ? ` ★${ch.rebirths}` : ''}`;
    this.goldText.textContent = `${ch.gold.toLocaleString('ja-JP')} ${txt('stat.gold')}`;
    const need = expToNext(ch.level, CONTENT);
    this.expFill.style.width = `${Math.min(1, ch.exp / Math.max(1, need)) * 100}%`;

    // バフ・デバフ
    const key = p.statuses.map((s) => `${s.id}:${Math.ceil((s.until - this.world.tick) / CONTENT.balance.tickRate)}`).join();
    if (this.buffs.dataset.k !== key) {
      this.buffs.dataset.k = key;
      this.buffs.replaceChildren(...p.statuses.map((s) => {
        const d = CONTENT.statuses[s.id];
        const el = h('span', `buff ${d?.kind ?? ''}`, d?.name ?? s.id);
        el.style.borderColor = `#${statusColor(s.id).toString(16).padStart(6, '0')}`;
        el.append(h('i', '', String(Math.ceil((s.until - this.world.tick) / CONTENT.balance.tickRate))));
        return el;
      }));
    }

    // スキル
    const ids = this.skillBtns.map((_, i) => slotSkill(this.world, p, i));
    const k = ids.join();
    if (k !== this.skillKey) {
      this.skillKey = k;
      ids.forEach((id, i) => {
        const b = this.skillBtns[i];
        b.name.textContent = id ? CONTENT.skills[id].name : '';
        b.btn.classList.toggle('empty', !id);
      });
    }
    ids.forEach((id, i) => {
      const b = this.skillBtns[i];
      if (!id) { b.cd.style.background = ''; b.cdText.textContent = ''; return; }
      const sd = CONTENT.skills[id];
      const cd = p.skillCd[id] ?? 0;
      const frac = cd > 0 ? cd / Math.max(1, p.skillCdMax[id] ?? 1) : 0;
      b.cd.style.background = frac > 0 ? `conic-gradient(rgba(0,0,0,0.65) ${frac * 360}deg, transparent 0deg)` : '';
      b.cdText.textContent = cd > 0 ? (cd / CONTENT.balance.tickRate).toFixed(cd > 20 ? 0 : 1) : '';
      const lv = ch.skills[id] ?? 1;
      const mpCost = Array.isArray(sd.mp) ? sd.mp[0] + sd.mp[1] * (lv - 1) : sd.mp ?? 0;
      b.btn.classList.toggle('nomp', p.mp < mpCost);
      b.btn.classList.toggle('ready', cd <= 0 && p.mp >= mpCost);
    });

    // 話す
    const it = interactTarget(this.world, p);
    this.interactBtn.classList.toggle('show', !!it && !p.dead);
    if (it) this.interactName.textContent = it.kind === 'npc' ? CONTENT.npcs[it.npc]?.name ?? '' : txt(`node.${it.node}`);
    const potions = (ch.bag.potion_s ?? 0) + (ch.bag.potion_m ?? 0);
    this.potionCount.textContent = String(potions);
    this.potionBtn.classList.toggle('none', potions === 0);
    this.captureBtn.classList.toggle('show', (ch.bag.seal_stone ?? 0) + (ch.bag.seal_stone_hi ?? 0) > 0 && this.world.area.type !== 'town');

    const pts = freeStatPoints(ch, CONTENT) + freeSkillPoints(ch, CONTENT);
    this.menuBadge.textContent = pts > 0 ? String(pts) : '';
    this.menuBadge.classList.toggle('show', pts > 0);

    // ボス
    const boss = this.world.area.monsters.find((m) => CONTENT.monsters[m.defId].boss && !m.dead && m.ai === 'chase');
    this.boss.root.classList.toggle('show', !!boss);
    if (boss) {
      this.boss.name.textContent = `${CONTENT.monsters[boss.defId].name}  Lv${boss.level}`;
      this.boss.fill.style.width = `${(boss.hp / boss.stats.maxHp) * 100}%`;
      const broken = this.world.tick < boss.brokenUntil;
      this.boss.brk.style.width = `${broken ? 100 : (1 - boss.poise / boss.poiseMax) * 100}%`;
      this.boss.root.classList.toggle('broken', broken);
      this.boss.root.classList.toggle('enraged', boss.enraged);
    }

    this.updateWeaponRes(p);
    const a = this.world.area;
    const lv = a.type === 'field' ? `  Lv${a.level[0]}-${a.level[1]}` : '';
    const inst = a.instance;
    this.leaveBtn.style.display = inst ? '' : 'none';
    let ii = '';
    if (inst) {
      const tr = CONTENT.balance.tickRate;
      const el = ((inst.cleared || inst.failed ? inst.endTick : this.world.tick) - inst.startTick) / tr;
      if (inst.kind === 'tower') ii = `${txt('inst.floor', inst.floor)}  ${a.monsters.filter((m) => !m.dead).length}`;
      else if (inst.kind === 'raid') ii = `${CONTENT.difficulties[inst.difficulty].name}  ${fmtTime(Math.max(0, (inst.timeLimitTick - this.world.tick) / tr))}`;
      else ii = `${CONTENT.difficulties[inst.difficulty].name}  ${fmtTime(el)}`;
    } else if (a.invasion && !a.invasion.finished) {
      ii = `${txt('invasion.wave')} ${a.invasion.wave}/${CONTENT.invasion.waves}  ${fmtTime(Math.max(0, (a.invasion.endClock - this.world.clock) / 1000))}  ${txt('invasion.points')} ${contribution(this.world, p).toLocaleString()}`;
    }
    if (this.instInfo.textContent !== ii) this.instInfo.textContent = ii;
    this.instInfo.style.display = ii ? '' : 'none';
    const wt = CONTENT.weather.types[currentWeather(this.world)]?.name ?? '';
    const info = a.instance ? a.name : `${a.name}${lv}  ${txt(`phase.${dayPhase(this.world)}`)}  ${wt}`;
    if (this.areaInfo.textContent !== info) this.areaInfo.textContent = info;

    this.death.root.classList.toggle('show', p.dead);
    if (p.dead) this.death.count.textContent = String(Math.ceil(p.respawnTicks / CONTENT.balance.tickRate));
  }
}
