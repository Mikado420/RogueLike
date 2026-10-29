// 町のメニューやダイアログ（HTML）。ゲーム画面の上に白枠のウィンドウで重ねる。
import { ELEMENT_INFO } from '../shared/elements.js';
import { BEHAVIOR_JA, behaviorOf } from '../shared/genome.js';
import { materialLabel, materialPrice, itemSummary, playerStats, WEAPON_TYPES, SHOP, MATERIAL_KINDS, expToNext } from '../shared/items.js';
import { generateSprite } from '../shared/sprite.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const elName = (e) => (ELEMENT_INFO[e] || ELEMENT_INFO.none).ja;
const RARITY_CLASS = ['', 'r1', 'r2'];

export class Panels {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById('panel');
    this.kind = null;
    this.state = {};
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('submit', (e) => { e.preventDefault(); this.onSubmit(e); });
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.kind && this.kind !== 'title' && this.kind !== 'naming') this.close(); });
  }

  get open() { return !!this.kind; }
  send(m) { this.app.send(m); }

  show(kind, state = {}) {
    this.kind = kind;
    this.state = state;
    if (kind === 'market') this.send({ type: 'market:get' });
    if (kind === 'codex') this.send({ type: 'codex:get' });
    if (kind === 'board') this.send({ type: 'news:get' });
    if (kind === 'party') this.send({ type: 'party:list' });
    this.render();
    this.el.hidden = false;
    const first = this.el.querySelector('input, button.primary');
    if (first && !matchMedia('(pointer: coarse)').matches) first.focus();
  }

  close() {
    this.kind = null;
    this.el.hidden = true;
    this.el.innerHTML = '';
    this.app.onPanelClosed?.();
  }

  refresh() { if (this.kind) this.render(); }

  render() {
    const fn = this[`view_${this.kind}`];
    if (!fn) return;
    const keepScroll = this.el.querySelector('.list')?.scrollTop || 0;
    this.el.innerHTML = `<div class="pw">${fn.call(this)}</div>`;
    const list = this.el.querySelector('.list');
    if (list) list.scrollTop = keepScroll;
    for (const c of this.el.querySelectorAll('canvas[data-g]')) drawThumb(c, JSON.parse(c.dataset.g));
  }

  footer(extra = '') {
    return `<div class="between">${extra}<button data-act="close">閉じる</button></div>`;
  }

  // ---------- タイトル ----------
  view_title() {
    const s = this.state;
    return `<div class="win title"><h1>進化の迷宮</h1><p>狩るほど、狩られにくい魔物が育つ。</p></div>
      <div class="win">
        ${s.needName ? `<h2>なまえを きめてください</h2>
          <form data-form="name" class="row"><input id="name" name="name" maxlength="10" placeholder="1〜10文字" autocomplete="off" required><button class="primary">はじめる</button></form>` : `
          <h2>あそびかた</h2>
          <div class="row">
            <button class="primary" data-act="online">オンラインで遊ぶ</button>
            <button data-act="offline">ひとりで遊ぶ（オフライン）</button>
          </div>`}
        ${s.message ? `<p class="${s.error ? 'bad' : 'dim'}">${esc(s.message)}</p>` : ''}
      </div>
      <div class="win"><h3>そうさ</h3>
        <p class="dim" style="margin:0">移動 WASD／矢印・攻撃 J／Z／左クリック・技1 K／X／右クリック・技2 L／C・回避 Space・調べる E・回復薬 Q<br>スマホは左のスティックと右のボタン。狙いは近くの敵に自動で向きます。</p>
        <details style="margin-top:8px"><summary class="dim">接続先の設定</summary>
          <form data-form="server" class="row" style="margin-top:6px"><input id="server-url" name="url" value="${esc(this.app.serverUrl)}" style="flex:1;min-width:0"><button>保存</button></form>
          <p class="dim" style="margin:6px 0 0">オフラインのデータを消す <button data-act="reset-offline">消す</button></p>
        </details>
      </div>`;
  }

  // ---------- 装備 ----------
  view_equip() {
    const me = this.app.me;
    const st = playerStats(me);
    const eqIds = me.equipped;
    const slotOf = (id) => Object.entries(eqIds).find(([, v]) => v === id)?.[0];
    const resist = Object.entries(st.resist).filter(([, v]) => Math.abs(v) >= 0.01).map(([e, v]) => `${elName(e)}${v > 0 ? '+' : ''}${Math.round(v * 100)}%`).join(' ') || 'なし';
    const items = [...me.equipment].sort((a, b) => (slotOf(b.id) ? 1 : 0) - (slotOf(a.id) ? 1 : 0) || a.slot.localeCompare(b.slot));
    return `<div class="win"><h2>装備</h2>
      <p style="margin:0 0 6px">Lv ${me.level}（次まで ${expToNext(me.level) - me.exp}）・HP ${st.maxHp}・攻撃 ${st.atk}（${WEAPON_TYPES[st.weaponType].ja}・${elName(st.element)}属性）</p>
      <p class="dim" style="margin:0 0 6px">技1 ${st.skill1.ja}・技2 ${st.skill2.ja}・体の属性 ${elName(st.bodyElement)}・耐性 ${resist}</p>
      <div class="list">${items.map((it) => {
        const s = slotOf(it.id);
        return `<div class="item"><span class="${RARITY_CLASS[it.rarity]}">${{ weapon: '武', armor: '防', acc: '飾' }[it.slot]}</span>
          <div class="main"><div class="${RARITY_CLASS[it.rarity]}">${esc(it.name)} ${s ? '<span class="ok">［装備中］</span>' : ''}</div><div class="sub">${esc(itemSummary(it))}</div></div>
          <div class="acts">${s ? (it.slot === 'acc' ? `<button data-act="unequip" data-slot="${s}">外す</button>` : '') : it.slot === 'acc'
            ? `<button data-act="equip" data-id="${it.id}" data-slot="acc1">飾1に</button><button data-act="equip" data-id="${it.id}" data-slot="acc2">飾2に</button>`
            : `<button data-act="equip" data-id="${it.id}">装備</button>`}
            ${s ? '' : `<button data-act="discard" data-id="${it.id}">捨てる</button>`}</div></div>`;
      }).join('')}</div>
      <p class="dim" style="margin:8px 0 0">装備 ${me.equipment.length}/30</p></div>${this.footer()}`;
  }

  // ---------- 工房 ----------
  view_craft() {
    const me = this.app.me;
    const s = this.state;
    s.recipe ||= 'weapon';
    s.picked ||= [];
    s.weaponType ||= 'sword';
    const need = { weapon: ['fang', 2], armor: ['scale', 2], acc: ['core', 1] }[s.recipe];
    const mats = me.materials.filter((m) => m.kind === need[0]).sort((a, b) => b.rarity - a.rarity || b.tier - a.tier);
    const desc = {
      weapon: '牙2つで武器。属性は1つ目の牙の魔物の攻撃属性、強さは魔物の力で決まります。',
      armor: '鱗2つで防具。2つの鱗の魔物の耐性を受け継ぎます。体の属性で技2が変わります。',
      acc: '核1つで装飾品。魔物の行動パターンで効果が決まります。',
    }[s.recipe];
    return `<div class="win"><h2>工房</h2>
      <div class="tabs">${['weapon', 'armor', 'acc'].map((r) => `<button data-act="recipe" data-r="${r}" class="${s.recipe === r ? 'sel' : ''}">${{ weapon: '武器', armor: '防具', acc: '装飾品' }[r]}</button>`).join('')}</div>
      <p class="dim">${desc}</p>
      ${s.recipe === 'weapon' ? `<div class="tabs" style="margin-bottom:8px">${Object.entries(WEAPON_TYPES).map(([k, v]) => `<button data-act="wtype" data-w="${k}" class="${s.weaponType === k ? 'sel' : ''}">${v.ja}</button>`).join('')}</div>` : ''}
      <div class="list">${mats.length ? mats.map((m) => `<div class="item ${s.picked.includes(m.id) ? 'picked' : ''}">
          <span class="${RARITY_CLASS[m.rarity]}">${MATERIAL_KINDS[m.kind]}</span>
          <div class="main"><div class="${RARITY_CLASS[m.rarity]}">${esc(materialLabel(m))} <span class="dim num">T${m.tier}</span></div>
          <div class="sub">体:${elName(m.g.body)} 攻:${elName(m.g.atk)} 行動:${BEHAVIOR_JA[m.g.behavior]} ${m.g.poison ? '毒' : ''} 耐性:${Object.entries(m.g.resist).map(([e, v]) => `${elName(e)}${Math.round(v * 100)}`).join(' ')}</div></div>
          <div class="acts"><button data-act="pick" data-id="${m.id}">${s.picked.includes(m.id) ? '外す' : '選ぶ'}</button></div></div>`).join('')
        : `<p class="dim">${MATERIAL_KINDS[need[0]]}を持っていません。ダンジョンで魔物を倒して持ち帰りましょう。</p>`}</div>
      <div class="between" style="margin-top:8px"><span>選択 ${s.picked.length}/${need[1]}</span><button class="primary" data-act="craft" ${s.picked.length === need[1] ? '' : 'disabled'}>作る</button></div>
    </div>${this.footer()}`;
  }

  // ---------- 道具屋（素材の売却もここ） ----------
  view_shop() {
    const me = this.app.me;
    const s = this.state;
    s.sell ||= [];
    const mats = [...me.materials].sort((a, b) => a.kind.localeCompare(b.kind) || b.rarity - a.rarity);
    const total = mats.filter((m) => s.sell.includes(m.id)).reduce((t, m) => t + materialPrice(m), 0);
    return `<div class="win"><h2>道具屋 <span class="gold num" style="float:right">${me.gold}G</span></h2>
      <div class="list" style="max-height:none">${Object.entries(SHOP).map(([k, v]) => `<div class="item"><span>品</span><div class="main">${v.ja}<div class="sub">${v.desc}・所持 ${k === 'potion' ? me.potions : me.charms}</div></div>
        <div class="acts"><button data-act="buy" data-k="${k}" ${me.gold < v.price ? 'disabled' : ''}>${v.price}G</button></div></div>`).join('')}</div>
      <h3>素材を売る（${me.materials.length}/60）</h3>
      <div class="list">${mats.map((m) => `<div class="item ${s.sell.includes(m.id) ? 'picked' : ''}"><span>${MATERIAL_KINDS[m.kind]}</span>
        <div class="main"><span class="${RARITY_CLASS[m.rarity]}">${esc(materialLabel(m))}</span> <span class="dim num">T${m.tier}</span></div>
        <div class="acts"><button data-act="sellpick" data-id="${m.id}">${materialPrice(m)}G</button></div></div>`).join('') || '<p class="dim">素材はありません</p>'}</div>
      <div class="between" style="margin-top:8px"><span>選択 ${s.sell.length}個・${total}G</span><button data-act="sell" ${s.sell.length ? '' : 'disabled'}>まとめて売る</button></div>
    </div>${this.footer()}`;
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
        return `<div class="item"><span>${l.kind === 'material' ? MATERIAL_KINDS[it.kind] : '装'}</span>
          <div class="main"><div class="${RARITY_CLASS[it.rarity]}">${esc(label)}</div><div class="sub">${esc(sub)}・出品 ${esc(l.sellerName)}</div></div>
          <div class="acts"><button data-act="mbuy" data-id="${l.id}" ${!mine && me.gold < l.price ? 'disabled' : ''}>${mine ? '取り消す' : `${l.price}G`}</button></div></div>`;
      }).join('') : '<p class="dim">出品はまだありません</p>';
    } else {
      const eqIds = Object.values(me.equipped);
      const mats = me.materials.map((m) => ({ kind: 'material', id: m.id, label: materialLabel(m), r: m.rarity, hint: materialPrice(m) * 2 }));
      const eqs = me.equipment.filter((e) => !eqIds.includes(e.id)).map((e) => ({ kind: 'equipment', id: e.id, label: e.name, r: e.rarity, hint: 50 + e.tier * 40 }));
      body = [...eqs, ...mats].map((x) => `<div class="item"><span>${x.kind === 'material' ? '素' : '装'}</span><div class="main ${RARITY_CLASS[x.r]}">${esc(x.label)}</div>
        <form class="acts" data-form="mlist" data-kind="${x.kind}" data-id="${x.id}"><input name="price" type="number" min="1" max="999999" value="${x.hint}" style="width:90px" aria-label="値段"><button>出品</button></form></div>`).join('') || '<p class="dim">出品できるものがありません</p>';
    }
    return `<div class="win"><h2>取引所 <span class="gold num" style="float:right">${me.gold}G</span></h2>
      <div class="tabs"><button data-act="mtab" data-t="buy" class="${s.tab === 'buy' ? 'sel' : ''}">買う</button><button data-act="mtab" data-t="sell" class="${s.tab === 'sell' ? 'sel' : ''}">出品する</button></div>
      <p class="dim">絶滅した種の素材は二度と手に入りません。値付けは自由です。</p>
      <div class="list">${body}</div></div>${this.footer()}`;
  }

  // ---------- 図鑑 ----------
  view_codex() {
    const s = this.state;
    s.filter ||= 'alive';
    const all = this.app.codex || [];
    const list = all.filter((c) => (s.filter === 'alive' ? c.extinctGen === null : s.filter === 'extinct' ? c.extinctGen !== null : !c.named && c.extinctGen === null))
      .sort((a, b) => (a.areaName || '').localeCompare(b.areaName || '') || b.pop - a.pop);
    const rights = this.app.me.namingRights || [];
    const nameOf = (id) => all.find((c) => c.id === id)?.name;
    return `<div class="win"><h2>図鑑 <span class="dim num" style="float:right">第${this.app.generation ?? '-'}世代</span></h2>
      <div class="tabs">${[['alive', '生きている種'], ['unnamed', '未命名'], ['extinct', '絶滅した種']].map(([k, v]) => `<button data-act="cfilter" data-f="${k}" class="${s.filter === k ? 'sel' : ''}">${v}</button>`).join('')}</div>
      <div class="list" style="margin-top:8px">${list.map((c) => {
        const g = c.sample;
        return `<div class="item"><canvas class="thumb" width="20" height="18" data-g='${esc(JSON.stringify(g))}'></canvas>
          <div class="main"><div>${esc(c.name)} ${c.extinctGen !== null ? `<span class="bad">絶滅（第${c.extinctGen}世代）</span>` : `<span class="dim num">${c.pop}</span>`}</div>
          <div class="sub">${esc(c.areaName)}・体:${elName(g.body)} 攻:${elName(g.atk)}・${BEHAVIOR_JA[behaviorOf(g)]}${c.parentId ? `・祖先:${esc(nameOf(c.parentId) || '?')}` : ''}<br>
          ${c.discoveredBy ? `発見 ${esc(c.discoveredBy)}` : '未発見'}${c.namedBy ? `・命名 ${esc(c.namedBy)}` : ''}・第${c.createdGen}世代に誕生</div></div>
          <div class="acts">${rights.includes(c.id) && !c.named ? `<button data-act="nameopen" data-id="${c.id}">名付ける</button>` : ''}</div></div>`;
      }).join('') || '<p class="dim">該当する種はいません</p>'}</div></div>${this.footer()}`;
  }

  // ---------- 掲示板（世界ニュース） ----------
  view_board() {
    const ws = this.app.world;
    const news = (this.app.news || []).slice().reverse();
    const next = this.app.nextEcoAt ? Math.max(0, Math.round((this.app.nextEcoAt - Date.now()) / 1000)) : null;
    return `<div class="win"><h2>掲示板 ― 世界のいま</h2>
      <p style="margin:0 0 6px">第${ws?.generation ?? '-'}世代${next !== null ? `・次の世代まで約${Math.floor(next / 60)}分${next % 60}秒` : ''}</p>
      ${ws?.apex ? `<p class="gold" style="margin:0 0 6px">ワールドレイド開催中：${esc(ws.apex.name)}（HP ${ws.apex.hp}/${ws.apex.maxHp}）第${ws.apex.endGen}世代まで</p>` : ''}
      <div class="grid2" style="margin-bottom:8px">${(ws?.areas || []).map((a) => `<div class="dim" style="font-size:13px">${esc(a.name)}（${elName(a.env)}）<br><span class="num">${a.species}種 ${a.pop}体</span></div>`).join('')}</div>
      ${this.app.offline ? '<div class="row" style="margin-bottom:8px"><button data-act="ecostep">世代を進める</button><span class="dim">オフラインでは手動でも進められます</span></div>' : ''}
      <div class="list news">${news.map((n) => `<p class="k-${n.kind}"><span class="dim num">G${n.gen}</span> ${esc(n.text)}</p>`).join('') || '<p class="dim">まだ何も起きていません</p>'}</div></div>${this.footer()}`;
  }

  // ---------- パーティ ----------
  view_party() {
    const p = this.app.party;
    const me = this.app.me;
    const list = this.app.parties || [];
    return `<div class="win"><h2>酒場 ― パーティ</h2>
      ${p ? `<p>あなたのパーティ <span class="gold num">${p.code}</span>（${p.members.length}/4）</p>
        <div class="list" style="max-height:none">${p.members.map((m) => `<div>${m.id === p.leader ? '★' : '・'} ${esc(m.name)}</div>`).join('')}</div>
        <p class="dim">合言葉を仲間に伝えると参加できます。出発はリーダーが「迷宮の門」から。</p>
        <div class="row"><button data-act="pleave">パーティを抜ける</button></div>`
      : `<div class="row"><button class="primary" data-act="pcreate">パーティを作る</button></div>
        <h3>合言葉で参加</h3>
        <form data-form="pjoin" class="row"><input name="code" maxlength="4" placeholder="ABCD" style="width:110px;text-transform:uppercase" autocomplete="off"><button>参加</button></form>
        <h3>募集中のパーティ</h3>
        <div class="list">${list.map((x) => `<div class="item"><span>隊</span><div class="main">${x.members.map((m) => esc(m.name)).join('・')}<div class="sub num">${x.code} ${x.members.length}/4</div></div>
          <div class="acts"><button data-act="pjoin" data-code="${x.code}">参加</button></div></div>`).join('') || '<p class="dim">いまは募集がありません</p>'}</div>`}
      <p class="dim" style="margin:8px 0 0">攻撃の属性がばらけたパーティほど、適応した魔物に強くなります。</p>
    </div>${this.footer(this.app.offline ? '<span class="dim">オフラインではひとりで遊びます</span>' : '')}`;
    // me は将来の表示用
  }

  // ---------- 迷宮の門 ----------
  view_gate() {
    const p = this.app.party;
    const leader = !p || p.leader === this.app.me.id;
    return `<div class="win"><h2>迷宮の門 ― どこへ潜る？</h2>
      ${p ? `<p class="dim">パーティ ${p.members.length}人で出発します${leader ? '' : '（出発できるのはリーダーだけです）'}</p>` : '<p class="dim">ひとりで出発します。仲間と行くなら酒場でパーティを。</p>'}
      <div class="grid2">${(this.app.areas || []).map((a) => {
        const sum = this.app.world?.areas?.find((x) => x.id === a.id);
        const c = ELEMENT_INFO[a.env];
        return `<button class="area" data-act="go" data-area="${a.id}" ${leader ? '' : 'disabled'} style="border-color:${c.color}">
          <span>${esc(a.name)}</span><small>${c.ja}の地・${sum ? `${sum.species}種 ${sum.pop}体` : ''}</small></button>`;
      }).join('')}</div>
      <p class="dim" style="margin:8px 0 0">各階の奥に「下へ」の階段と「脱出」の魔法陣があります。全滅すると、その回に拾ったものはすべて失います。</p>
    </div>${this.footer()}`;
  }

  view_raid() {
    const ap = this.app.world?.apex;
    return `<div class="win"><h2>レイドの石碑</h2>
      ${ap ? `<p class="gold">${esc(ap.name)} が暴れている</p><p>HP ${ap.hp}/${ap.maxHp}・第${ap.endGen}世代までに倒せないと、その系統がエリアを支配します。</p>
        <p class="dim">最大16人が同じ戦場に入ります。途中で抜けても、与えたダメージは残ります。</p>
        <div class="row"><button class="primary" data-act="raid">戦場へ向かう</button></div>` : '<p class="dim">いまは頂点捕食者はいません。生態系で強い種が増えすぎると現れます。</p>'}
    </div>${this.footer()}`;
  }

  // ---------- 結果・命名 ----------
  view_result() {
    const r = this.state;
    return `<div class="win"><h2>${r.escaped ? '無事に脱出した！' : '力尽きた……'}</h2>
      <p>到達 地下${r.floor}階・撃破 ${r.kills}体</p>
      ${r.escaped ? `<p class="ok">素材 ${r.materials}個・${r.gold}G を持ち帰った${r.autoSold ? `（持ちきれない${r.autoSold}個は売った）` : ''}</p>` : `<p class="bad">拾った素材 ${r.lost}個を失った</p>`}
      <p class="dim">倒した魔物の記録は生態系に届きました。次の世代の魔物に影響します。</p>
      <div class="row"><button class="primary" data-act="close">町へ</button></div></div>`;
  }

  view_naming() {
    const r = this.state;
    return `<div class="win"><h2>新種を発見した！</h2>
      <div class="row"><canvas class="thumb" width="20" height="18" style="width:80px;height:72px" data-g='${esc(JSON.stringify(r.sample))}'></canvas>
      <p style="flex:1;min-width:0">${esc(r.area)}で、まだ誰も名付けていない種を最初に倒しました。名前は図鑑にずっと残ります。</p></div>
      <form data-form="naming" class="row"><input name="name" maxlength="12" placeholder="2〜12文字" autocomplete="off" required style="flex:1;min-width:0"><button class="primary">名付ける</button></form>
      <div class="row" style="margin-top:8px"><button data-act="close">あとで（図鑑から名付けられます）</button></div></div>`;
  }

  // ---------- 操作 ----------
  onClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
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
        s.message = 'オフラインのデータを消しました';
        return this.render();
      }
      case 'equip': return this.send({ type: 'equip', id: b.dataset.id, slot: b.dataset.slot });
      case 'unequip': return this.send({ type: 'unequip', slot: b.dataset.slot });
      case 'discard': {
        if (s.confirm !== b.dataset.id) { s.confirm = b.dataset.id; b.textContent = '本当に？'; return; }
        return this.send({ type: 'discard', id: b.dataset.id });
      }
      case 'recipe': s.recipe = b.dataset.r; s.picked = []; return this.render();
      case 'wtype': s.weaponType = b.dataset.w; return this.render();
      case 'pick': {
        const need = { weapon: 2, armor: 2, acc: 1 }[s.recipe];
        const id = b.dataset.id;
        if (s.picked.includes(id)) s.picked = s.picked.filter((x) => x !== id);
        else if (s.picked.length < need) s.picked.push(id);
        return this.render();
      }
      case 'craft': this.send({ type: 'craft', recipe: s.recipe, ids: s.picked, weaponType: s.weaponType }); s.picked = []; return;
      case 'buy': return this.send({ type: 'buy', key: b.dataset.k });
      case 'sellpick': {
        const id = b.dataset.id;
        s.sell = s.sell.includes(id) ? s.sell.filter((x) => x !== id) : [...s.sell, id];
        return this.render();
      }
      case 'sell': this.send({ type: 'sell', ids: s.sell }); s.sell = []; return;
      case 'mtab': s.tab = b.dataset.t; return this.render();
      case 'mbuy': return this.send({ type: 'market:buy', id: b.dataset.id });
      case 'cfilter': s.filter = b.dataset.f; return this.render();
      case 'nameopen': {
        const c = (app.codex || []).find((x) => x.id === b.dataset.id);
        if (c) this.show('naming', { speciesId: c.id, sample: c.sample, area: c.areaName });
        return;
      }
      case 'ecostep': return this.send({ type: 'eco:step' });
      case 'pcreate': return this.send({ type: 'party:create' });
      case 'pleave': return this.send({ type: 'party:leave' });
      case 'pjoin': return this.send({ type: 'party:join', code: b.dataset.code });
      case 'go': this.send({ type: 'dungeon:start', area: b.dataset.area }); return;
      case 'raid': this.send({ type: 'raid:join' }); return;
      default:
    }
  }

  onSubmit(e) {
    const f = e.target.closest('form');
    if (!f) return;
    const data = Object.fromEntries(new FormData(f));
    switch (f.dataset.form) {
      case 'name': return this.app.submitName(String(data.name || ''));
      case 'server': this.app.setServerUrl(String(data.url || '')); this.state.message = '接続先を保存しました'; return this.render();
      case 'pjoin': return this.send({ type: 'party:join', code: String(data.code || '').toUpperCase() });
      case 'mlist': return this.send({ type: 'market:list', kind: f.dataset.kind, id: f.dataset.id, price: Number(data.price) });
      case 'naming': {
        this.send({ type: 'name:species', speciesId: this.state.speciesId, name: String(data.name || '') });
        this.app.pendingNameClose = this.state.speciesId;
        return;
      }
      default:
    }
  }
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
