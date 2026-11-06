import {
  CONTENT, alchemyCost, bagInfo, baseBonus, baseOf, rarityRank, refineCost, sellPrice, txt, type Item, type ModKey,
} from '../../../shared/src';
import { btn, h } from './dom';
import { modText, type Ctx } from './ctx';
import { bagIconUrl, iconImg } from './icons';
import { near, sourcesOf, usesOf } from './itemkit';

/**
 * 詳細シートの「この装備でできること」。そばにいる NPC に応じて、精錬・結晶・錬成・売るをここから行う。
 * 精錬・結晶・錬成は鍛冶屋の該当画面をこの装備を選んだ状態で開き、売るはその場で売る
 */

const ICON: Record<string, string> = {
  refine: '<path d="M12 3v10M7 8l5-5 5 5M5 21h14"/>',
  crystal: '<path d="M12 3l7 6-7 12-7-12z"/>',
  alchemy: '<path d="M4 12a8 8 0 0 1 14-5M20 12a8 8 0 0 1-14 5M18 3v4h-4M6 21v-4h4"/>',
  sell: '<circle cx="12" cy="12" r="8"/><path d="M12 7v10M9.5 9.5c0-1.6 5-1.6 5 0s-5 1.6-5 3.2 5 1.6 5 0"/>',
};

function actRow(kind: string, title: string, sub: string, go: string, onClick: (() => void) | null): HTMLElement {
  const b = h('button', `act-row${onClick ? '' : ' off'}`);
  const ico = h('span', 'act-ico');
  ico.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[kind]}</svg>`;
  const text = h('span', 'act-text');
  text.append(h('span', 'act-title', title), h('span', 'act-sub', sub));
  b.append(ico, text);
  if (onClick) {
    b.append(h('span', 'act-go', go));
    b.addEventListener('click', onClick);
  } else b.disabled = true;
  return b;
}

/** 売る前に確かめたほうがいい装備か（エピック以上・銘入り・セット・精錬済み） */
export function precious(it: Item): boolean {
  return rarityRank(it.rarity) >= rarityRank('epic') || !!it.crafted || !!it.set || it.refine >= 5;
}

export function itemActions(ctx: Ctx, it: Item, equipped: boolean, onGone: () => void): HTMLElement {
  const w = ctx.world, p = ctx.me(), ch = p.char;
  const box = h('div', 'acts');
  box.append(h('div', 'sub-title', txt('act.title')));
  const atSmith = near(w, p, 'smith');
  const atShop = near(w, p, 'shop');
  if (atSmith) {
    const rc = refineCost(it, CONTENT, baseBonus(baseOf(p), CONTENT, w.clock, 'refineRate'));
    const stones = ch.bag[CONTENT.refine.stone] ?? 0;
    if (rc) {
      box.append(actRow('refine', txt('act.refine', it.refine, it.refine + 1),
        txt('act.refineSub', rc.rate, bagInfo(CONTENT.refine.stone).name, stones, rc.stones, rc.gold.toLocaleString()),
        txt('act.open'), () => ctx.openNpc?.('smith', 'refine', it.uid)));
    } else box.append(actRow('refine', txt('act.refineMax'), '', '', null));
    if (it.crystals.length) {
      const empty = it.crystals.filter((c) => !c).length;
      const owned = Object.keys(ch.bag).filter((id) => CONTENT.crystals[id] && (ch.bag[id] ?? 0) > 0).length;
      box.append(actRow('crystal', txt('act.crystal'), txt('act.crystalSub', empty, owned), txt('act.open'), () => ctx.openNpc?.('smith', 'crystal', it.uid)));
    }
    if (it.options.length) {
      const cost = alchemyCost(w, p, it.tier, 'one');
      const cat = ch.bag[CONTENT.recipes.alchemy.catalyst] ?? 0;
      box.append(actRow('alchemy', txt('act.alchemy'), txt('act.alchemySub', cat, cost.catalyst, cost.gold.toLocaleString()), txt('act.open'), () => ctx.openNpc?.('smith', 'alchemy', it.uid)));
    }
  }
  if (!equipped) {
    const price = sellPrice(it, CONTENT);
    if (atShop && !it.locked) {
      const sell = () => { ctx.send({ type: 'sell', uid: it.uid }); onGone(); };
      box.append(actRow('sell', txt('act.sell', price.toLocaleString()), '', txt('item.sell'), () => {
        if (precious(it)) ctx.modal.confirm({ title: txt('confirm.sellOne', it.name), body: txt('confirm.sellBody'), ok: txt('item.sell'), danger: true, onOk: sell });
        else sell();
      }));
    } else {
      box.append(actRow('sell', txt('act.sell', price.toLocaleString()), it.locked ? txt('act.locked') : txt('act.shopHint'), '', null));
    }
  }
  if (!atSmith) box.append(h('div', 'hint', txt('act.smithHint')));
  return box;
}

/** 袋のアイテムの詳細（イラスト・数・値段・入手先・使い道・使う／売る） */
export function bagDetail(ctx: Ctx, id: string): HTMLElement {
  const w = ctx.world, p = ctx.me(), ch = p.char;
  const n = ch.bag[id] ?? 0;
  const info = bagInfo(id);
  const box = h('div', 'item-info');
  const head = h('div', 'd-head');
  const pic = h('div', 'd-pic');
  pic.style.setProperty('--rc', info.color);
  pic.append(iconImg(bagIconUrl(id), 'd-ico'));
  const titles = h('div', 'd-titles');
  const name = h('div', 'd-name', info.name);
  titles.append(name);
  const tags = h('div', 'd-tags');
  tags.append(h('span', 'tag', txt(`bagkind.${info.kind}`)), h('span', 'tag muted', `×${n}`), h('span', 'tag muted', `${info.price.toLocaleString()} G`));
  titles.append(tags);
  head.append(pic, titles);
  box.append(head);
  const m = CONTENT.materials[id];
  const fx = h('div', 'd-opts');
  if (m?.use?.healPct) fx.append(h('div', 'opt', txt('use.healPct', m.use.healPct)));
  if (m?.use?.mpPct) fx.append(h('div', 'opt', txt('use.mpPct', m.use.mpPct)));
  if (m?.use?.food) {
    for (const [k, v] of Object.entries(m.use.food.mods)) fx.append(h('div', 'opt', modText(k as ModKey, v as number)));
    fx.append(h('div', 'opt muted', txt('use.minutes', m.use.food.duration)));
  }
  const cr = CONTENT.crystals[id];
  if (cr) for (const [k, v] of Object.entries(cr.mods)) fx.append(h('div', 'opt', modText(k as ModKey, v as number)));
  if (fx.childElementCount) box.append(fx);
  const src = sourcesOf(id);
  const sec = (title: string, lines: string[], empty: string) => {
    const s = h('div', 'd-sec');
    s.append(h('div', 'd-sec-title', title));
    if (!lines.length) s.append(h('div', 'muted', empty));
    for (const l of lines.slice(0, 6)) s.append(h('div', 'd-sec-line', l));
    if (lines.length > 6) s.append(h('div', 'muted', txt('ui.andMore', lines.length - 6)));
    return s;
  };
  box.append(sec(txt('item.sources'), src, txt('item.noSource')));
  box.append(sec(txt('item.uses'), usesOf(id), txt('item.onlySell')));
  const act = h('div', 'd-actions');
  if (m?.use && !m.use.capture) act.append(btn(txt('item.use'), () => ctx.send({ type: 'useItem', id }), 'btn primary grow'));
  if (near(w, p, 'shop') && m && m.kind !== 'key') {
    const each = Math.round(m.price * CONTENT.balance.sell.materialMul);
    act.append(btn(`${txt('item.sell')} ×1`, () => ctx.send({ type: 'sellBag', id, n: 1 }), 'btn'));
    act.append(btn(txt('act.sellAll', (each * n).toLocaleString()), () => {
      const go = () => ctx.send({ type: 'sellBag', id, n });
      if (usesOf(id).length > 0 && n >= 5) ctx.modal.confirm({ title: txt('confirm.sellBag', info.name, n), body: txt('confirm.sellBagBody'), ok: txt('item.sell'), onOk: go });
      else go();
    }, 'btn'));
  }
  if (act.childElementCount) box.append(act);
  return box;
}
