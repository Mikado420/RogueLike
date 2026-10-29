// 町のメニューやダイアログ（HTML）。ゲーム画面の上に白枠のウィンドウで重ねる。
// 町の機能は1つの「メニュー」にタブでまとめ、どの画面でも右上の × と Esc で閉じられる。
import { ELEMENT_INFO } from '../shared/elements.js';
import { BEHAVIOR_JA, behaviorOf } from '../shared/genome.js';
import { materialLabel, materialPrice, itemSummary, playerStats, craft, WEAPON_TYPES, SHOP, MATERIAL_KINDS, expToNext } from '../shared/items.js';
import { generateSprite } from '../shared/sprite.js';
import { Rng } from '../shared/rng.js';
import { sfx } from './audio.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const elName = (e) => (ELEMENT_INFO[e] || ELEMENT_INFO.none).ja;
const elColor = (e) => (ELEMENT_INFO[e] || ELEMENT_INFO.none).color;
const RARITY_CLASS = ['', 'r1', 'r2'];
const SLOT_JA = { weapon: '武器', armor: '防具', acc1: '装飾品1', acc2: '装飾品2' };
const SLOT_IC = { weapon: '武', armor: '防', acc: '飾' };

const MENU_TABS = [
  ['equip', '装備'], ['craft', '工房'], ['shop', '道具屋'], ['market', '取引所'], ['codex', '図鑑'], ['board', '掲示板'], ['party', 'パーティ'],
];
const MENU_KINDS = new Set(MENU_TABS.map(([k]) => k));

export class Panels {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById('panel');
    this.kind = null;
    this.state = {};
    this.tabState = {};
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('change', (e) => this.onChange(e));
    this.el.addEventListener('submit', (e) => { e.preventDefault(); this.onSubmit(e); });
    addEventListener('keydown', (e) => {
      if (!this.kind) return;
      if (e.key === 'Escape' && this.closable()) { e.preventDefault(); this.close(); }
      if (MENU_KINDS.has(this.kind) && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && e.target.tagName !== 'INPUT') {
        const tabs = this.menuTabs();
        const i = tabs.findIndex(([k]) => k === this.kind);
        const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length][0];
        this.show(n);
      }
    });
  }

  get open() { return !!this.kind; }
  send(m) { this.app.send(m); }
  closable() { return this.kind !== 'title' && !(this.kind === 'naming' && this.state.forced); }
  menuTabs() { return MENU_TABS.filter(([k]) => !(k === 'party' && this.app.offline)); }

  show(kind, state) {
    if (kind === 'menu') kind = this.lastTab || 'equip';
    const wasOpen = !!this.kind;
    this.kind = kind;
    if (MENU_KINDS.has(kind)) {
      this.lastTab = kind;
      this.state = this.tabState[kind] ||= {};
      if (state) Object.assign(this.state, state);
    } else {
      this.state = state || {};
    }
    if (kind === 'market') this.send({ type: 'market:get' });
    if (kind === 'codex') this.send({ type: 'codex:get' });
    if (kind === 'board') this.send({ type: 'news:get' });
    if (kind === 'party') this.send({ type: 'party:list' });
    this.render(true);
    this.el.hidden = false;
    if (!wasOpen) sfx('open');
    this.app.onPanelChanged?.();
    const first = this.el.querySelector('input[autofocus], button.primary');
    if (first && !matchMedia('(pointer: coarse)').matches) first.focus();
  }

  close() {
    if (!this.kind) return;
    if (this.kind === 'craft' || this.kind === 'shop') { this.state.picked = []; this.state.sell = []; }
    this.kind = null;
    this.el.hidden = true;
    this.el.innerHTML = '';
    sfx('close');
    this.app.onPanelChanged?.();
  }

  refresh() { if (this.kind) this.render(false); }

  render(reset) {
    const fn = this[`view_${this.kind}`];
    if (!fn) return;
    const body = this.el.querySelector('.body');
    const keep = reset ? 0 : body?.scrollTop || 0;
    const v = fn.call(this);
    const tabs = MENU_KINDS.has(this.kind)
      ? `<div class="tabs" role="tablist">${this.menuTabs().map(([k, ja]) => `<button role="tab" data-tab="${k}" class="${k === this.kind ? 'sel' : ''}">${ja}</button>`).join('')}</div>`
      : '';
    this.el.innerHTML = `<div class="sheet ${v.narrow ? 'narrow' : ''}" role="dialog" aria-label="${esc(v.title)}">
      ${v.noHead ? '' : `<div class="head"><h2>${v.title}</h2>${this.closable() ? '<button class="x" data-act="close" aria-label="閉じる">✕</button>' : ''}</div>`}
      ${tabs}
      <div class="body">${v.body}</div>
      ${v.foot ? `<div class="foot">${v.foot}</div>` : ''}
    </div>`;
    const nb = this.el.querySelector('.body');
    if (nb) nb.scrollTop = keep;
    for (const c of this.el.querySelectorAll('canvas[data-g]')) drawThumb(c, JSON.parse(c.dataset.g));
  }

  // ---------- タイトル ----------
  view_title() {
    const s = this.state;
    const app = this.app;
    const solo = app.staticHost && !app.hasServer;
    let main;
    if (s.needName) {
      main = `<form data-form="name" class="big-actions"><label class="dim" for="name">あなたの名前（1〜10文字）</label>
        <input id="name" name="name" maxlength="10" autocomplete="off" required autofocus><button class="primary">冒険をはじめる</button></form>`;
    } else if (solo) {
      main = `<div class="big-actions"><button class="primary" data-act="offline">あそぶ</button></div>
        <p class="dim" style="text-align:center;margin-top:10px">データはこのブラウザに保存されます</p>`;
    } else {
      main = `<div class="big-actions"><button class="primary" data-act="online">オンラインで遊ぶ</button><button data-act="offline">ひとりで遊ぶ</button></div>`;
    }
    return {
      title: '進化の迷宮', narrow: true, noHead: true,
      body: `<div class="title-card"><h1>進化の迷宮</h1><p>狩るほど、狩られにくい魔物が育つ。</p></div>
        ${main}
        ${s.message ? `<p class="${s.error ? 'bad' : 'dim'}" style="text-align:center;margin-top:12px">${esc(s.message)}</p>` : ''}
        <details style="margin-top:16px"><summary>操作方法</summary>${controlsHelp()}</details>
        <details style="margin-top:8px"><summary>接続先の設定</summary>
          <form data-form="server" class="row" style="margin-top:8px"><input id="server-url" name="url" value="${esc(app.hasServer || !app.staticHost ? app.serverUrl : '')}" placeholder="wss://example.com/ws" style="flex:1;min-width:0"><button>保存</button></form>
          <p class="dim" style="margin-top:8px">オフラインのデータを消す <button data-act="reset-offline">消す</button></p>
        </details>`,
    };
  }

  // ---------- 装備 ----------
  view_equip() {
    const me = this.app.me;
    const st = playerStats(me);
    const byId = (id) => me.equipment.find((e) => e.id === id);
    const slotOf = (id) => Object.entries(me.equipped).find(([, v]) => v === id)?.[0];
    const resist = Object.entries(st.resist).filter(([, v]) => Math.abs(v) >= 0.01).map(([e, v]) => `<span style="color:${elColor(e)}">${elName(e)}${v > 0 ? '+' : ''}${Math.round(v * 100)}%</span>`).join(' ') || 'なし';
    const slots = ['weapon', 'armor', 'acc1', 'acc2'].map((s) => {
      const it = byId(me.equipped[s]);
      return `<div class="slot"><span class="k">${SLOT_JA[s]}</span>${it ? `<span class="${RARITY_CLASS[it.rarity]}">${esc(it.name)}</span>` : '<span class="dim">なし</span>'}
        ${it && s.startsWith('acc') ? ` <button data-act="unequip" data-slot="${s}" style="padding:2px 8px;font-size:12px">外す</button>` : ''}</div>`;
    }).join('');
    const cur = { weapon: byId(me.equipped.weapon), armor: byId(me.equipped.armor) };
    const rest = me.equipment.filter((e) => !slotOf(e.id)).sort((a, b) => a.slot.localeCompare(b.slot) || b.rarity - a.rarity);
    const delta = (it) => {
      if (it.slot === 'weapon' && cur.weapon) return deltaTag(it.atk - cur.weapon.atk, '攻撃');
      if (it.slot === 'armor' && cur.armor) return deltaTag(it.hp - cur.armor.hp, 'HP');
      return '';
    };
    return {
      title: '装備',
      body: `<div class="stats">
          <div><span class="k">レベル</span>${me.level}<span class="dim" style="font-size:12px">（次まで${expToNext(me.level) - me.exp}）</span></div>
          <div><span class="k">HP</span>${st.maxHp}</div>
          <div><span class="k">攻撃</span>${st.atk}・${WEAPON_TYPES[st.weaponType].ja}・<span style="color:${elColor(st.element)}">${elName(st.element)}</span></div>
          <div><span class="k">技1 / 技2</span>${st.skill1.ja} / ${st.skill2.ja}</div>
          <div style="grid-column:1/-1"><span class="k">耐性（体の属性 ${elName(st.bodyElement)}）</span>${resist}</div>
        </div>
        <div class="slots">${slots}</div>
        <h3>持っている装備（${me.equipment.length}/30）</h3>
        <div class="list">${rest.map((it) => `<div class="item">
            <span class="ic ${RARITY_CLASS[it.rarity]}">${SLOT_IC[it.slot]}</span>
            <div class="main"><div class="${RARITY_CLASS[it.rarity]}">${esc(it.name)}${delta(it)}</div><div class="sub">${esc(itemSummary(it))}</div></div>
            <div class="acts">${it.slot === 'acc'
              ? `<button data-act="equip" data-id="${it.id}" data-slot="acc1">飾1に</button><button data-act="equip" data-id="${it.id}" data-slot="acc2">飾2に</button>`
              : `<button class="primary" data-act="equip" data-id="${it.id}">装備</button>`}
              <button data-act="discard" data-id="${it.id}">${this.state.confirm === it.id ? '本当に？' : '捨てる'}</button></div></div>`).join('')
          || '<div class="empty">予備の装備はありません。工房で素材から作れます。</div>'}</div>`,
    };
  }

  // ---------- 工房 ----------
  view_craft() {
    const me = this.app.me;
    const s = this.state;
    s.recipe ||= 'weapon';
    s.picked ||= [];
    s.weaponType ||= playerStats(me).weaponType || 'sword';
    if (s.autoEquip === undefined) s.autoEquip = true;
    const need = { weapon: ['fang', 2], armor: ['scale', 2], acc: ['core', 1] }[s.recipe];
    s.picked = s.picked.filter((id) => me.materials.some((m) => m.id === id));
    const mats = me.materials.filter((m) => m.kind === need[0]).sort((a, b) => b.rarity - a.rarity || b.tier - a.tier || (b.g.power - a.g.power));
    const counts = { fang: 0, scale: 0, core: 0 };
    for (const m of me.materials) counts[m.kind]++;
    const picked = s.picked.map((id) => me.materials.find((m) => m.id === id)).filter(Boolean);
    let preview = '';
    if (picked.length === need[1]) {
      const r = craft(new Rng('preview'), s.recipe, picked, s.weaponType);
      if (r.item) {
        const st = playerStats(me);
        const eqW = me.equipment.find((e) => e.id === me.equipped.weapon);
        const eqA = me.equipment.find((e) => e.id === me.equipped.armor);
        const cmp = s.recipe === 'weapon' && eqW ? deltaTag(r.item.atk - eqW.atk, '攻撃') : s.recipe === 'armor' && eqA ? deltaTag(r.item.hp - eqA.hp, 'HP') : '';
        preview = `<div class="preview">できあがり：<span class="${RARITY_CLASS[r.item.rarity]}">${esc(r.item.name)}</span>${cmp}<div class="dim" style="font-size:13px">${esc(itemSummary(r.item))}</div></div>`;
        void st;
      }
    }
    const desc = {
      weapon: '牙を2つ使います。属性は1つ目の牙の魔物の攻撃属性、強さは2つの牙の魔物の力で決まります。',
      armor: '鱗を2つ使います。2つの魔物の耐性を受け継ぎ、1つ目の鱗の体の属性で技2が決まります。',
      acc: '核を1つ使います。魔物の行動パターンで効果が決まります。',
    }[s.recipe];
    return {
      title: '工房',
      body: `<div class="subtabs">${['weapon', 'armor', 'acc'].map((r) => {
          const k = { weapon: 'fang', armor: 'scale', acc: 'core' }[r];
          return `<button data-act="recipe" data-r="${r}" class="${s.recipe === r ? 'sel' : ''}">${{ weapon: '武器', armor: '防具', acc: '装飾品' }[r]} <span class="num">${counts[k]}</span></button>`;
        }).join('')}</div>
        <p class="dim" style="font-size:13px">${desc}</p>
        ${s.recipe === 'weapon' ? `<div class="subtabs">${Object.entries(WEAPON_TYPES).map(([k, v]) => `<button data-act="wtype" data-w="${k}" class="${s.weaponType === k ? 'sel' : ''}">${v.ja}</button>`).join('')}</div>` : ''}
        ${preview}
        <div class="list">${mats.length ? mats.map((m) => {
          const i = s.picked.indexOf(m.id);
          return `<div class="item click ${i >= 0 ? 'picked' : ''}" data-act="pick" data-id="${m.id}">
            <span class="ic ${RARITY_CLASS[m.rarity]}">${i >= 0 ? i + 1 : MATERIAL_KINDS[m.kind]}</span>
            <div class="main"><div class="${RARITY_CLASS[m.rarity]}">${esc(materialLabel(m))} <span class="dim num">T${m.tier}</span></div>
            <div class="sub">体<span style="color:${elColor(m.g.body)}">${elName(m.g.body)}</span>・攻<span style="color:${elColor(m.g.atk)}">${elName(m.g.atk)}</span>・力${Math.round(m.g.power * 100)}・${BEHAVIOR_JA[m.g.behavior]}${m.g.poison ? '・毒' : ''}</div></div>
            <div class="acts"></div></div>`;
        }).join('') : `<div class="empty">${MATERIAL_KINDS[need[0]]}を持っていません。<br>ダンジョンで魔物を倒し、脱出して持ち帰りましょう。</div>`}</div>`,
      foot: `<div class="row"><button data-act="autopick" ${mats.length >= need[1] ? '' : 'disabled'}>おすすめを選ぶ</button>
          <label class="row" style="gap:4px;font-size:13px"><input type="checkbox" id="auto-equip" data-change="autoequip" ${s.autoEquip ? 'checked' : ''} style="width:18px;height:18px">作ったら装備する</label></div>
        <button class="primary" data-act="craft" ${picked.length === need[1] ? '' : 'disabled'}>作る（${picked.length}/${need[1]}）</button>`,
    };
  }

  // ---------- 道具屋 ----------
  view_shop() {
    const me = this.app.me;
    const s = this.state;
    s.sell ||= [];
    s.sell = s.sell.filter((id) => me.materials.some((m) => m.id === id));
    const mats = [...me.materials].sort((a, b) => a.rarity - b.rarity || a.kind.localeCompare(b.kind));
    const total = mats.filter((m) => s.sell.includes(m.id)).reduce((t, m) => t + materialPrice(m), 0);
    return {
      title: `道具屋 <span class="gold num" style="margin-left:8px">${me.gold}G</span>`,
      body: `<h3>買う</h3>
        <div class="list">${Object.entries(SHOP).map(([k, v]) => `<div class="item"><span class="ic">${k === 'potion' ? '薬' : '符'}</span>
          <div class="main">${v.ja}<div class="sub">${v.desc}・持っている数 ${k === 'potion' ? me.potions : me.charms}</div></div>
          <div class="acts"><button class="primary" data-act="buy" data-k="${k}" ${me.gold < v.price ? 'disabled' : ''}>${v.price}G で買う</button></div></div>`).join('')}</div>
        <h3>素材を売る（${me.materials.length}/60）</h3>
        <div class="list">${mats.map((m) => `<div class="item click ${s.sell.includes(m.id) ? 'picked' : ''}" data-act="sellpick" data-id="${m.id}">
          <span class="ic">${MATERIAL_KINDS[m.kind]}</span>
          <div class="main"><span class="${RARITY_CLASS[m.rarity]}">${esc(materialLabel(m))}</span> <span class="dim num">T${m.tier}</span></div>
          <div class="acts"><span class="gold num">${materialPrice(m)}G</span></div></div>`).join('') || '<div class="empty">素材はありません</div>'}</div>`,
      foot: `<button data-act="sellcommon" ${mats.some((m) => m.rarity === 0) ? '' : 'disabled'}>★なしを全部選ぶ</button>
        <button class="primary" data-act="sell" ${s.sell.length ? '' : 'disabled'}>${s.sell.length}個を ${total}G で売る</button>`,
    };
  }

  // ---------- 取引所 ----------
  view_market() {
    const me = this.app.me;
    const s = this.state;
    s.tab ||= 'buy';
    const list = this.app.market || [];
    let body;
    if (s.tab === 'buy') {
      body = list.length ? list.slice().reverse().map((l) => {
        const it = l.item;
        const label = l.kind === 'material' ? materialLabel(it) : it.name;
        const sub = l.kind === 'material' ? `体:${elName(it.g.body)} 攻:${elName(it.g.atk)} T${it.tier}` : itemSummary(it);
        const mine = l.seller === me.id;
        return `<div class="item"><span class="ic">${l.kind === 'material' ? MATERIAL_KINDS[it.kind] : SLOT_IC[it.slot]}</span>
          <div class="main"><div class="${RARITY_CLASS[it.rarity]}">${esc(label)}</div><div class="sub">${esc(sub)}・出品 ${esc(l.sellerName)}</div></div>
          <div class="acts"><button class="${mine ? '' : 'primary'}" data-act="mbuy" data-id="${l.id}" ${!mine && me.gold < l.price ? 'disabled' : ''}>${mine ? '取り消す' : `${l.price}G で買う`}</button></div></div>`;
      }).join('') : '<div class="empty">出品はまだありません</div>';
    } else {
      const eqIds = Object.values(me.equipped);
      const mats = me.materials.map((m) => ({ kind: 'material', id: m.id, label: materialLabel(m), r: m.rarity, ic: MATERIAL_KINDS[m.kind], hint: materialPrice(m) * 2 }));
      const eqs = me.equipment.filter((e) => !eqIds.includes(e.id)).map((e) => ({ kind: 'equipment', id: e.id, label: e.name, r: e.rarity, ic: SLOT_IC[e.slot], hint: 50 + e.tier * 40 }));
      body = [...eqs, ...mats].map((x) => `<div class="item"><span class="ic">${x.ic}</span><div class="main ${RARITY_CLASS[x.r]}">${esc(x.label)}</div>
        <form class="acts" data-form="mlist" data-kind="${x.kind}" data-id="${x.id}"><input name="price" type="number" inputmode="numeric" min="1" max="999999" value="${x.hint}" style="width:96px" aria-label="値段"><button>出品</button></form></div>`).join('') || '<div class="empty">出品できるものがありません</div>';
    }
    return {
      title: `取引所 <span class="gold num" style="margin-left:8px">${me.gold}G</span>`,
      body: `<div class="subtabs"><button data-act="mtab" data-t="buy" class="${s.tab === 'buy' ? 'sel' : ''}">買う</button><button data-act="mtab" data-t="sell" class="${s.tab === 'sell' ? 'sel' : ''}">出品する</button></div>
        <p class="dim" style="font-size:13px">絶滅した種の素材は二度と手に入りません。値段は自由に決められます。</p>
        <div class="list">${body}</div>`,
    };
  }

  // ---------- 図鑑 ----------
  view_codex() {
    const s = this.state;
    s.filter ||= 'alive';
    const all = this.app.codex || [];
    const rights = this.app.me.namingRights || [];
    const list = all.filter((c) => (s.filter === 'alive' ? c.extinctGen === null : s.filter === 'extinct' ? c.extinctGen !== null : !c.named && c.extinctGen === null))
      .sort((a, b) => (rights.includes(b.id) ? 1 : 0) - (rights.includes(a.id) ? 1 : 0) || (a.areaName || '').localeCompare(b.areaName || '') || b.pop - a.pop);
    const nameOf = (id) => all.find((c) => c.id === id)?.name;
    const count = (f) => all.filter((c) => (f === 'alive' ? c.extinctGen === null : f === 'extinct' ? c.extinctGen !== null : !c.named && c.extinctGen === null)).length;
    return {
      title: `図鑑 <span class="dim num" style="margin-left:8px">第${this.app.generation ?? '-'}世代</span>`,
      body: `<div class="subtabs">${[['alive', '生きている種'], ['unnamed', '未命名'], ['extinct', '絶滅した種']].map(([k, v]) => `<button data-act="cfilter" data-f="${k}" class="${s.filter === k ? 'sel' : ''}">${v} <span class="num">${count(k)}</span></button>`).join('')}</div>
        <div class="list">${list.map((c) => {
          const g = c.sample;
          return `<div class="item"><canvas class="thumb" width="20" height="18" data-g='${esc(JSON.stringify(g))}'></canvas>
            <div class="main"><div>${esc(c.name)} ${c.extinctGen !== null ? `<span class="bad">絶滅</span>` : `<span class="dim num">${c.pop}体</span>`}</div>
            <div class="sub">${esc(c.areaName)}・体<span style="color:${elColor(g.body)}">${elName(g.body)}</span>・攻<span style="color:${elColor(g.atk)}">${elName(g.atk)}</span>・${BEHAVIOR_JA[behaviorOf(g)]}${c.parentId ? `・祖先 ${esc(nameOf(c.parentId) || '?')}` : ''}</div>
            <div class="sub">${c.discoveredBy ? `発見 ${esc(c.discoveredBy)}` : '未発見'}${c.namedBy ? `・命名 ${esc(c.namedBy)}` : ''}・第${c.createdGen}世代に誕生${c.extinctGen !== null ? `・第${c.extinctGen}世代に絶滅` : ''}</div></div>
            <div class="acts">${rights.includes(c.id) && !c.named ? `<button class="primary" data-act="nameopen" data-id="${c.id}">名付ける</button>` : ''}</div></div>`;
        }).join('') || '<div class="empty">該当する種はいません</div>'}</div>`,
    };
  }

  // ---------- 掲示板 ----------
  view_board() {
    const ws = this.app.world;
    const news = (this.app.news || []).slice().reverse();
    const next = this.app.nextEcoAt ? Math.max(0, Math.round((this.app.nextEcoAt - Date.now()) / 1000)) : null;
    return {
      title: '掲示板 ― 世界のいま',
      body: `<p>第${ws?.generation ?? '-'}世代${next !== null ? `・次の世代まで約${Math.floor(next / 60)}分${String(next % 60).padStart(2, '0')}秒` : ''}</p>
        ${ws?.apex ? `<p class="gold">ワールドレイド開催中：${esc(ws.apex.name)}（HP ${ws.apex.hp}/${ws.apex.maxHp}）第${ws.apex.endGen}世代まで</p>` : ''}
        ${this.app.offline ? '<div class="row" style="margin-bottom:10px"><button data-act="ecostep">世代を進める</button><span class="dim" style="font-size:13px">ひとりで遊ぶときは手動でも進められます</span></div>' : ''}
        <div class="grid2" style="margin-bottom:12px">${(ws?.areas || []).map((a) => `<div style="font-size:13px;border-left:4px solid ${elColor(a.env)};padding-left:8px">${esc(a.name)}<br><span class="dim num">${a.species}種 ${a.pop}体</span></div>`).join('')}</div>
        <h3>できごと</h3>
        <div class="news">${news.map((n) => `<p class="k-${n.kind}"><span class="dim num">G${n.gen}</span> ${esc(n.text)}</p>`).join('') || '<div class="empty">まだ何も起きていません</div>'}</div>`,
    };
  }

  // ---------- パーティ ----------
  view_party() {
    const p = this.app.party;
    const list = this.app.parties || [];
    return {
      title: 'パーティ',
      body: p ? `<p>あなたのパーティの合言葉</p>
          <p style="font-size:28px;letter-spacing:.3em" class="gold num">${p.code}</p>
          <div class="list">${p.members.map((m) => `<div class="item"><span class="ic">${m.id === p.leader ? '★' : '・'}</span><div class="main">${esc(m.name)}${m.id === p.leader ? ' <span class="dim">リーダー</span>' : ''}</div></div>`).join('')}</div>
          <p class="dim" style="margin-top:10px;font-size:13px">合言葉を仲間に伝えると参加できます（最大4人）。出発はリーダーが「出発」から。</p>`
        : `<div class="row"><button class="primary" data-act="pcreate">パーティを作る</button></div>
          <h3>合言葉で参加</h3>
          <form data-form="pjoin" class="row"><input name="code" maxlength="4" placeholder="ABCD" style="width:120px;text-transform:uppercase;letter-spacing:.2em" autocomplete="off" autocapitalize="characters"><button>参加</button></form>
          <h3>募集中のパーティ</h3>
          <div class="list">${list.map((x) => `<div class="item"><span class="ic">隊</span><div class="main">${x.members.map((m) => esc(m.name)).join('・')}<div class="sub num">${x.code} ${x.members.length}/4</div></div>
            <div class="acts"><button class="primary" data-act="pjoin" data-code="${x.code}">参加</button></div></div>`).join('') || '<div class="empty">いまは募集がありません</div>'}</div>
          <p class="dim" style="margin-top:10px;font-size:13px">攻撃の属性がばらけたパーティほど、適応した魔物に強くなります。</p>`,
      foot: p ? '<button data-act="pleave">パーティを抜ける</button>' : '',
    };
  }

  // ---------- 出発 ----------
  view_gate() {
    const p = this.app.party;
    const leader = !p || p.leader === this.app.me.id;
    const st = playerStats(this.app.me);
    return {
      title: 'どこへ潜る？',
      body: `<p class="dim" style="font-size:13px">${p ? `パーティ ${p.members.length}人で出発します${leader ? '' : '（出発できるのはリーダーだけです）'}` : 'ひとりで出発します。'}
          あなたの攻撃は<span style="color:${elColor(st.element)}">${elName(st.element)}</span>属性。地の属性に強い攻撃だと楽になります。</p>
        <div class="grid2">${(this.app.areas || []).map((a) => {
          const sum = this.app.world?.areas?.find((x) => x.id === a.id);
          const c = ELEMENT_INFO[a.env];
          return `<button class="area" data-act="go" data-area="${a.id}" ${leader ? '' : 'disabled'} style="border-left-color:${c.color}">
            <span>${esc(a.name)}</span><small>${c.ja}の地・${sum ? `${sum.species}種 ${sum.pop}体` : ''}</small></button>`;
        }).join('')}</div>
        <p class="dim" style="margin-top:12px;font-size:13px">各階の奥に「下へ」の階段と「脱出」の魔法陣があります。全滅すると、その回に拾ったものはすべて失います。</p>`,
    };
  }

  view_raid() {
    const ap = this.app.world?.apex;
    return {
      title: 'ワールドレイド', narrow: true,
      body: ap ? `<p class="gold">${esc(ap.name)} が暴れている</p><p>HP ${ap.hp}/${ap.maxHp}・第${ap.endGen}世代までに倒せないと、その系統がエリアを支配します。</p>
          <p class="dim" style="font-size:13px">最大16人が同じ戦場に入ります。途中で抜けても、与えたダメージは残ります。</p>`
        : '<p class="dim">いまは頂点捕食者はいません。生態系で強い種が増えすぎると現れます。</p>',
      foot: ap ? '<span></span><button class="primary" data-act="raid">戦場へ向かう</button>' : '',
    };
  }

  // ---------- 結果・命名 ----------
  view_result() {
    const r = this.state;
    return {
      title: r.escaped ? '無事に脱出した！' : '力尽きた……', narrow: true,
      body: `<div class="stats"><div><span class="k">到達</span>地下${r.floor}階</div><div><span class="k">撃破</span>${r.kills}体</div>
          ${r.escaped ? `<div><span class="k">持ち帰った素材</span><span class="ok">${r.materials}個</span></div><div><span class="k">お金</span><span class="gold">${r.gold}G</span></div>` : `<div><span class="k">失った素材</span><span class="bad">${r.lost}個</span></div>`}</div>
        ${r.autoSold ? `<p class="dim">持ちきれない${r.autoSold}個は売りました</p>` : ''}
        <p class="dim" style="font-size:13px">倒した魔物の記録は生態系に届きました。次の世代の魔物に影響します。</p>`,
      foot: `${r.escaped && r.materials ? '<button data-act="tocraft">工房へ</button>' : '<span></span>'}<button class="primary" data-act="close">町へ</button>`,
    };
  }

  view_naming() {
    const r = this.state;
    return {
      title: '新種を発見した！', narrow: true,
      body: `<div class="row" style="flex-wrap:nowrap"><canvas class="thumb" width="20" height="18" style="width:80px;height:72px;flex:none" data-g='${esc(JSON.stringify(r.sample))}'></canvas>
        <p style="flex:1;min-width:0">${esc(r.area)}で、まだ誰も名付けていない種を最初に倒しました。名前は図鑑にずっと残ります。</p></div>
        <form data-form="naming" class="row" style="margin-top:10px"><input name="name" maxlength="12" placeholder="2〜12文字" autocomplete="off" required autofocus style="flex:1;min-width:0"><button class="primary">名付ける</button></form>`,
      foot: '<span class="dim" style="font-size:13px">あとで図鑑からも名付けられます</span><button data-act="close">あとで</button>',
    };
  }

  // ---------- 操作 ----------
  onClick(e) {
    const tab = e.target.closest('[data-tab]');
    if (tab) return this.show(tab.dataset.tab);
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const a = b.dataset.act;
    const s = this.state;
    const app = this.app;
    switch (a) {
      case 'close': return this.close();
      case 'online': return app.startOnline();
      case 'offline': return app.startOffline();
      case 'reset-offline': {
        if (!s.confirmReset) { s.confirmReset = true; b.textContent = 'もう一度押すと消えます'; return; }
        app.resetOffline();
        s.confirmReset = false;
        s.message = 'オフラインのデータを消しました';
        return this.render();
      }
      case 'equip': sfx('ok'); return this.send({ type: 'equip', id: b.dataset.id, slot: b.dataset.slot });
      case 'unequip': return this.send({ type: 'unequip', slot: b.dataset.slot });
      case 'discard': {
        if (s.confirm !== b.dataset.id) { s.confirm = b.dataset.id; return this.render(); }
        s.confirm = null;
        return this.send({ type: 'discard', id: b.dataset.id });
      }
      case 'recipe': s.recipe = b.dataset.r; s.picked = []; return this.render(true);
      case 'wtype': s.weaponType = b.dataset.w; return this.render();
      case 'pick': {
        const need = { weapon: 2, armor: 2, acc: 1 }[s.recipe];
        const id = b.dataset.id;
        if (s.picked.includes(id)) s.picked = s.picked.filter((x) => x !== id);
        else { if (s.picked.length >= need) s.picked.shift(); s.picked.push(id); }
        return this.render();
      }
      case 'autopick': {
        const kind = { weapon: 'fang', armor: 'scale', acc: 'core' }[s.recipe];
        const need = { weapon: 2, armor: 2, acc: 1 }[s.recipe];
        const score = (m) => m.rarity * 10 + m.tier * 2 + m.g.power + Math.max(0, ...Object.values(m.g.resist));
        s.picked = app.me.materials.filter((m) => m.kind === kind).sort((x, y) => score(y) - score(x)).slice(0, need).map((m) => m.id);
        return this.render();
      }
      case 'craft':
        app.pendingCraft = { autoEquip: s.autoEquip, before: new Set(app.me.equipment.map((x) => x.id)) };
        this.send({ type: 'craft', recipe: s.recipe, ids: s.picked, weaponType: s.weaponType });
        s.picked = [];
        sfx('ok');
        return;
      case 'buy': sfx('ok'); return this.send({ type: 'buy', key: b.dataset.k });
      case 'sellpick': {
        const id = b.dataset.id;
        s.sell = s.sell.includes(id) ? s.sell.filter((x) => x !== id) : [...s.sell, id];
        return this.render();
      }
      case 'sellcommon': s.sell = app.me.materials.filter((m) => m.rarity === 0).map((m) => m.id); return this.render();
      case 'sell': this.send({ type: 'sell', ids: s.sell }); s.sell = []; sfx('ok'); return;
      case 'mtab': s.tab = b.dataset.t; return this.render(true);
      case 'mbuy': return this.send({ type: 'market:buy', id: b.dataset.id });
      case 'cfilter': s.filter = b.dataset.f; return this.render(true);
      case 'nameopen': {
        const c = (app.codex || []).find((x) => x.id === b.dataset.id);
        if (c) this.show('naming', { speciesId: c.id, sample: c.sample, area: c.areaName });
        return;
      }
      case 'ecostep': return this.send({ type: 'eco:step' });
      case 'pcreate': return this.send({ type: 'party:create' });
      case 'pleave': return this.send({ type: 'party:leave' });
      case 'pjoin': return this.send({ type: 'party:join', code: b.dataset.code });
      case 'go': return this.send({ type: 'dungeon:start', area: b.dataset.area });
      case 'raid': return this.send({ type: 'raid:join' });
      case 'tocraft': return this.show('craft');
      default:
    }
  }

  onChange(e) {
    if (e.target.dataset.change === 'autoequip') this.state.autoEquip = e.target.checked;
  }

  onSubmit(e) {
    const f = e.target.closest('form');
    if (!f) return;
    const data = Object.fromEntries(new FormData(f));
    switch (f.dataset.form) {
      case 'name': return this.app.submitName(String(data.name || ''));
      case 'server': this.app.setServerUrl(String(data.url || '')); this.state.message = this.app.hasServer ? '接続先を保存しました' : '接続先を消しました'; return this.render();
      case 'pjoin': return this.send({ type: 'party:join', code: String(data.code || '').toUpperCase() });
      case 'mlist': return this.send({ type: 'market:list', kind: f.dataset.kind, id: f.dataset.id, price: Number(data.price) });
      case 'naming':
        this.send({ type: 'name:species', speciesId: this.state.speciesId, name: String(data.name || '') });
        this.app.pendingNameClose = this.state.speciesId;
        return;
      default:
    }
  }
}

function deltaTag(d, label) {
  if (!d) return `<span class="delta dim">±0</span>`;
  return `<span class="delta ${d > 0 ? 'up' : 'down'}">${label}${d > 0 ? '+' : ''}${d}</span>`;
}

export function controlsHelp() {
  return `<dl class="keys" style="margin-top:8px">
    <dt>移動</dt><dd>WASD・矢印 ／ スマホは画面左を触ってスライド</dd>
    <dt>攻撃</dt><dd>J・Z・左クリック（押しっぱなしで連続）</dd>
    <dt>技1・技2</dt><dd>K・右クリック ／ L</dd>
    <dt>回避</dt><dd>Space（一瞬無敵）</dd>
    <dt>調べる</dt><dd>E（建物・階段・脱出）</dd>
    <dt>回復薬</dt><dd>Q</dd>
    <dt>メニュー</dt><dd>M・Esc（町）</dd>
    <dt>狙い</dt><dd>マウスの方向。使わないときは近くの敵へ自動</dd>
  </dl>`;
}

function drawThumb(c, g) {
  const s = generateSprite(g);
  c.width = s.w; c.height = s.h;
  const x = c.getContext('2d');
  for (let i = 0; i < s.px.length; i++) {
    const v = s.px[i];
    if (!v) continue;
    x.fillStyle = s.palette[v];
    x.fillRect(i % s.w, Math.floor(i / s.w), 1, 1);
  }
}
