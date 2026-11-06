import {
  CONTENT, itemMods, sellPrice, setCounts, txt, type CharacterData, type Item, type ModKey, type UniqueDef, type WeaponType,
} from '../../../shared/src';
import { rarityColor } from '../colors';
import { h, kv } from './dom';
import { elName, modLabel, modText } from './ctx';
import { bagIconUrl, iconImg, itemIconUrl } from './icons';
import { upgradeSign } from './itemkit';

/** レジェンドの固有効果を短い行にする */
export function uniqueLines(u: UniqueDef): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(u.mods ?? {})) out.push(modText(k as ModKey, v as number));
  if (u.when && u.whenMods) {
    const c = u.when;
    const cond = c.hpBelow !== undefined ? txt('cond.hpBelow', c.hpBelow) : c.afterDodge !== undefined ? txt('cond.afterDodge', c.afterDodge)
      : c.night ? txt('cond.night') : c.fullHp ? txt('cond.fullHp') : c.chargeMax ? txt('cond.chargeMax')
      : c.comboAtLeast !== undefined ? txt('cond.combo', c.comboAtLeast) : c.afterReload !== undefined ? txt('cond.afterReload', c.afterReload)
      : c.rhythmAtLeast !== undefined ? txt('cond.rhythm', c.rhythmAtLeast) : c.afterBlock !== undefined ? txt('cond.afterBlock', c.afterBlock) : '';
    for (const [k, v] of Object.entries(u.whenMods)) out.push(`${cond}  ${modText(k as ModKey, v as number)}`);
  }
  if (u.proc) {
    const on = txt(`proc.on.${u.proc.on}`);
    const eff = u.proc.effect === 'status' && u.proc.status ? CONTENT.statuses[u.proc.status]?.name ?? '' : txt(`proc.eff.${u.proc.effect}`);
    const val = u.proc.effect === 'extraHit' ? ` ${Math.round(u.proc.value * 100)}%` : u.proc.effect === 'heal' ? ` ${u.proc.value}%` : '';
    out.push(`${on} ${u.proc.chance}%  ${eff}${val}`);
  }
  if (u.cheatDeath) out.push(txt('proc.cheatDeath', u.cheatDeath));
  return out;
}

/** 装備の詳細（名前・数値・オプション・固有効果・セット・結晶・取引） */
export function itemInfo(it: Item, ch: CharacterData | null): HTMLElement {
  const box = h('div', 'item-info');
  const rd = CONTENT.rarities.defs[it.rarity];
  const head = h('div', 'd-head');
  const pic = h('div', 'd-pic');
  pic.style.setProperty('--rc', rd.color);
  pic.append(iconImg(itemIconUrl(it), 'd-ico'));
  const titles = h('div', 'd-titles');
  const name = h('div', 'd-name', it.name);
  name.style.color = rd.color;
  if (it.refine > 0) name.append(h('span', 'd-refine', ` +${it.refine}`));
  titles.append(name);
  head.append(pic, titles);
  box.append(head);
  const tags = h('div', 'd-tags');
  const rt = h('span', 'tag', rd.name);
  rt.style.borderColor = rd.color; rt.style.color = rd.color;
  tags.append(rt, h('span', 'tag', it.slot === 'weapon' ? CONTENT.weapons[it.kind as WeaponType]?.name ?? it.kind : txt(`slot.${it.slot}`)));
  if (it.crafted) tags.append(h('span', 'tag named', txt('item.named')));
  if (it.element !== 'neutral') tags.append(h('span', `tag el-${it.element}`, elName(it.element)));
  tags.append(h('span', 'tag muted', txt(`trade.${it.trade}`)));
  titles.append(tags);
  const lines = h('div', 'd-lines');
  const req = kv(txt('item.req'), String(it.reqLevel));
  if (ch && ch.level < it.reqLevel) req.classList.add('bad');
  lines.append(req);
  const base = itemMods({ ...it, options: [], crystals: [], unique: undefined, mythic: undefined }, CONTENT);
  for (const [k, v] of Object.entries(base)) lines.append(kv(modLabel(k as ModKey).label, `${v}${modLabel(k as ModKey).unit}`));
  box.append(lines);
  if (it.options.length) {
    const ol = h('div', 'd-opts');
    for (const o of it.options) ol.append(h('div', 'opt', modText(o.key, o.value)));
    box.append(ol);
  }
  if (it.unique) {
    const u = CONTENT.uniques[it.unique];
    const ub = h('div', 'd-unique');
    ub.append(h('div', 'u-name', u.name));
    for (const l of uniqueLines(u)) ub.append(h('div', 'u-line', l));
    box.append(ub);
  }
  if (it.mythic) {
    const m = CONTENT.mythics[it.mythic];
    const mb = h('div', 'd-mythic');
    mb.append(h('div', 'u-name', m.name), h('div', 'u-line', txt(`mythic.${m.effect}`, m.value)));
    for (const [k, v] of Object.entries(m.mods ?? {})) mb.append(h('div', 'u-line', modText(k as ModKey, v as number)));
    box.append(mb);
  }
  if (it.set) {
    const s = CONTENT.sets[it.set];
    const have = ch ? setCounts(ch)[it.set] ?? 0 : 0;
    const sb = h('div', 'd-set');
    sb.append(h('div', 'u-name', `${s.name}  ${have}/${Object.keys(s.pieces).length}`));
    for (const b of s.bonus) {
      const row = h('div', `u-line${have >= b.count ? ' on' : ''}`, `${b.count}: ${Object.entries(b.mods).map(([k, v]) => modText(k as ModKey, v as number)).join('  ')}`);
      sb.append(row);
    }
    box.append(sb);
  }
  if (it.crystals.length) {
    const cr = h('div', 'd-crystals');
    cr.append(h('span', 'k', txt('item.crystals')));
    for (const c of it.crystals) {
      const g = h('span', c ? 'gem on' : 'gem', c ? CONTENT.crystals[c]?.name ?? '◇' : '◇');
      if (c) g.style.color = CONTENT.crystals[c]?.color ?? '';
      cr.append(g);
    }
    box.append(cr);
  }
  return box;
}

export interface CellOpts {
  /** 装備欄の部位名など、左上の小さな文字 */
  label?: string;
  selected?: boolean;
  /** 売値を出す */
  price?: boolean;
  onClick?: () => void;
  /** 今の装備と比べて ▲▼ を出す */
  compare?: CharacterData | null;
  /** 選んだかどうか（まとめて選ぶとき。undefined なら印を出さない） */
  checked?: boolean;
  /** 押せない（ロック中で売れないなど） */
  disabled?: boolean;
  /** 装備中の印 */
  equipped?: boolean;
}

/** 装備の一覧のマス（イラスト・装備Lv・精錬値・強弱・ロック） */
export function itemCell(it: Item | null, opts: CellOpts = {}): HTMLButtonElement {
  const c = h('button', 'cell');
  if (opts.label) c.append(h('span', 'cell-slot', opts.label));
  if (it) {
    const rc = rarityColor(it.rarity);
    c.style.setProperty('--rc', rc);
    c.classList.add(`r-${it.rarity}`);
    if (CONTENT.rarities.defs[it.rarity].glow) c.classList.add('glow');
    c.append(iconImg(itemIconUrl(it), 'cell-ico'));
    const name = it.name + (it.refine > 0 ? ` +${it.refine}` : '');
    c.title = name;
    c.setAttribute('aria-label', `${name}（${CONTENT.rarities.defs[it.rarity].name}・${txt('item.req')} ${it.reqLevel}）`);
    const lv = h('span', 'cell-lv', `Lv${it.reqLevel}`);
    if (opts.compare && opts.compare.level < it.reqLevel) lv.classList.add('bad');
    c.append(lv);
    if (it.refine > 0) c.append(h('span', 'cell-ref', `+${it.refine}`));
    if (opts.compare && !opts.equipped) {
      const s = upgradeSign(it, opts.compare);
      if (s !== 0) c.append(h('span', `cell-cmp ${s > 0 ? 'up' : 'down'}`, s > 0 ? '▲' : '▼'));
    }
    if (it.set) c.append(h('span', 'cell-set', '◆'));
    if (opts.price) c.append(h('span', 'cell-price', `${sellPrice(it, CONTENT).toLocaleString()} G`));
    if (it.locked) c.append(h('span', 'cell-lock', txt('item.lockMark')));
    if (opts.equipped) c.append(h('span', 'cell-eq', 'E'));
    if (opts.checked !== undefined) {
      c.classList.toggle('checked', opts.checked);
      c.append(h('span', 'cell-check', opts.checked ? '✓' : ''));
      c.setAttribute('aria-pressed', String(opts.checked));
    }
    if (opts.selected) c.classList.add('sel');
    if (opts.disabled) { c.classList.add('off'); c.setAttribute('aria-disabled', 'true'); }
    if (opts.onClick) c.addEventListener('click', opts.onClick);
  } else {
    c.classList.add('none');
    c.disabled = !opts.onClick;
    if (opts.onClick) c.addEventListener('click', opts.onClick);
  }
  return c;
}

/** 袋のアイテム（素材・消耗品・結晶）のマス */
export function bagCell(id: string, n: number, opts: { selected?: boolean; onClick?: () => void; need?: number } = {}): HTMLButtonElement {
  const c = h('button', 'cell bag-cell');
  c.append(iconImg(bagIconUrl(id), 'cell-ico'));
  const name = CONTENT.materials[id]?.name ?? CONTENT.crystals[id]?.name ?? id;
  c.title = name;
  c.setAttribute('aria-label', `${name} ×${n}`);
  c.append(h('span', `cell-n${opts.need !== undefined && n < opts.need ? ' bad' : ''}`, opts.need !== undefined ? `${n}/${opts.need}` : `×${n}`));
  if (opts.selected) c.classList.add('sel');
  if (opts.onClick) c.addEventListener('click', opts.onClick);
  return c;
}
